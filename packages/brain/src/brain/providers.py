"""LLM providers behind a common Protocol.

`FakeProvider` is deterministic and mirrors the TS `MockLLMClient` rules, so
tests need no API key and the brain has parity with the Phase 1 mock.
`GeminiProvider` is the real thing (lazy-imported; needs GOOGLE_API_KEY).
"""

from __future__ import annotations

import copy
import math
import os
import re
from dataclasses import dataclass
from typing import Optional, Protocol, runtime_checkable

from . import contracts


@dataclass
class ProviderOutput:
    tool_calls: list[dict]
    reasoning: str
    model: str
    input_tokens: int
    output_tokens: int
    finish_reason: str


@dataclass
class ScenePlan:
    """The director's output: a populated scene the LLM reasoned into existence."""

    scene: dict
    reasoning: str
    model: str
    input_tokens: int = 0
    output_tokens: int = 0


@runtime_checkable
class LLMProvider(Protocol):
    name: str

    def generate(self, prompt: str, world_context: Optional[str]) -> ProviderOutput: ...

    def populate(self, prompt: str) -> ScenePlan: ...


# ─────────────────────────────────────────────────────────────────────────────
# FakeProvider — deterministic, mirrors @yellow-ue/llm-brain MockLLMClient
# ─────────────────────────────────────────────────────────────────────────────

_SKY_RULES = [
    (re.compile(r"storm|stormy|thunder|tempest"), "storm", "a storm"),
    (re.compile(r"sunset|dusk|golden hour"), "sunset", "sunset"),
    (re.compile(r"night|midnight|\bdark\b"), "night", "night"),
    (re.compile(r"cloud|overcast|grey sky|gray sky"), "cloudy", "cloudy skies"),
    (re.compile(r"clear|sunny|blue sky|bright"), "clear", "a clear sky"),
]


def _match_sky(p: str) -> Optional[tuple[dict, str]]:
    for regex, preset, phrase in _SKY_RULES:
        if regex.search(p):
            call = {"tool": "SetSkyState", "args": {"preset": preset, "transition_seconds": 5}}
            return call, f"Prompt asks for {phrase}, so SetSkyState({preset})."
    return None


def _match_time(p: str) -> Optional[tuple[dict, str]]:
    hours: Optional[float] = None
    speed: Optional[float] = None

    if re.search(r"week", p):
        hours = 168
    elif re.search(r"\bday\b|tomorrow|24 hours", p):
        hours = 24
    elif re.search(r"morning|dawn|sunrise", p):
        hours = 8
    elif re.search(r"noon|midday", p):
        hours = 12
    elif re.search(r"evening|tonight", p):
        hours = 18

    hour_match = re.search(r"(\d+)\s*hour", p)
    if hour_match:
        hours = float(hour_match.group(1))

    speed_match = re.search(r"(\d+)\s*(?:x|×)", p)
    if speed_match:
        speed = float(speed_match.group(1))
    elif re.search(r"speed|faster|fast forward|fast-forward", p):
        speed = 100

    if hours is None and speed is None:
        return None

    resolved_hours = hours if hours is not None else 1
    call = {
        "tool": "AdvanceTime",
        "args": {
            "hours": resolved_hours,
            "speed_multiplier": speed if speed is not None else 1,
        },
    }
    speed_part = f" at {int(speed)}× speed" if speed is not None else ""
    return call, f"Prompt implies time should advance{speed_part}, so AdvanceTime({int(resolved_hours)}h)."


def _match_trees(p: str) -> Optional[tuple[dict, str]]:
    if not re.search(r"tree|forest|oak|pine|birch|plant|scatter|woods?", p):
        return None
    count_match = re.search(r"(\d+)", p)
    count = int(count_match.group(1)) if count_match else 25
    count = min(count, 10_000)
    species = "pine" if "pine" in p else "birch" if "birch" in p else "oak"
    growth = "seedling" if "seedling" in p else "sapling" if "sapling" in p else "mature"
    call = {
        "tool": "SpawnTrees",
        "args": {
            "area": {"center": {"x": 0, "y": 0, "z": 0}, "radius": 10},
            "count": count,
            "species": species,
            "growth_stage": growth,
        },
    }
    return call, f"Prompt asks to plant trees, so SpawnTrees({count} {species} {growth})."


def _match_creatures(p: str) -> Optional[tuple[list[dict], str]]:
    """Choreograph an elephant herd from a natural-language prompt.

    Mirrors the proven hand-scripted scene (direct_elephant_scene.sh) as an
    ordered list of INTENT verbs: spawn a matriarch + a trailing calf at the
    herd_start, migrate to the watering_hole, then drink. `Wait` carries the
    scripted timing (walk, then drink on arrival) until the read-back loop lets
    actions fire on world events instead."""
    if not re.search(r"elephant|herd|matriarch|calf", p):
        return None

    calls: list[dict] = [
        {"tool": "SpawnCreature", "args": {"species": "elephant_adult", "id": "matriarch", "at": "herd_start"}},
        {"tool": "SpawnCreature", "args": {"species": "elephant_baby", "id": "calf", "at": "herd_start"}},
        {"tool": "SetCreatureLeader", "args": {"id": "calf", "leader_id": "matriarch", "distance_m": 4}},
    ]
    migrates = bool(re.search(r"migrat|walk|move|head|march|watering|water|hole|lake|drink", p))
    if migrates:
        calls.append({"tool": "MoveCreatureTo", "args": {"id": "matriarch", "to": "watering_hole"}})
    if re.search(r"drink|water", p):
        # The migration takes ~75s; drink once the matriarch reaches the shore,
        # the calf a beat later.
        calls.append({"tool": "Wait", "args": {"seconds": 75}})
        calls.append({"tool": "SetCreatureState", "args": {"id": "matriarch", "state": "drink"}})
        calls.append({"tool": "Wait", "args": {"seconds": 4}})
        calls.append({"tool": "SetCreatureState", "args": {"id": "calf", "state": "drink"}})

    reason = (
        "Recognised an elephant herd: spawned a matriarch with a calf trailing ~4 m, "
        + ("migrated them to the watering_hole and had them drink." if migrates else "ready to direct.")
    )
    return calls, reason


class FakeProvider:
    name = "fake"

    def generate(self, prompt: str, world_context: Optional[str]) -> ProviderOutput:
        p = prompt.lower()
        tool_calls: list[dict] = []
        reasons: list[str] = []
        for matcher in (_match_sky, _match_time, _match_trees):
            match = matcher(p)
            if match:
                call, reason = match
                tool_calls.append(call)
                reasons.append(reason)
        creatures = _match_creatures(p)
        if creatures:
            calls, reason = creatures
            tool_calls.extend(calls)
            reasons.append(reason)

        reasoning = (
            " ".join(reasons)
            if reasons
            else (
                "No world-API tool matched this prompt. The real brain may still "
                "respond conversationally; the fake only emits tool calls it recognises."
            )
        )
        return ProviderOutput(
            tool_calls=tool_calls,
            reasoning=reasoning,
            model="fake-brain-v1",
            input_tokens=math.ceil(len(prompt) / 4),
            output_tokens=8 + len(tool_calls) * 14,
            finish_reason="tool_calls" if tool_calls else "stop",
        )

    def populate(self, prompt: str) -> ScenePlan:
        p = prompt.lower()
        if re.search(r"savann?ah?|watering|jeep|safari|serengeti", p):
            scene = copy.deepcopy(_SAVANNA)
            biome = "savanna"
        elif re.search(r"forest|woods?|temperate|deer|wolf|wolves", p):
            scene = copy.deepcopy(_FOREST)
            biome = "temperate forest"
        else:
            scene = copy.deepcopy(_MEADOW)
            biome = "meadow"
        if re.search(r"storm|thunder", p):
            scene["weather"] = {"preset": "storm", "temperature": 0.5, "timeOfDay": 15}
        elif re.search(r"night|midnight", p):
            scene["weather"] = {"preset": "night", "temperature": 0.3, "timeOfDay": 2}
        names = ", ".join(s["species"] for s in scene["species"])
        return ScenePlan(
            scene=scene,
            reasoning=f"Recognised a {biome}; populated it with {names}.",
            model="fake-ecologist-v1",
            input_tokens=math.ceil(len(prompt) / 4),
            output_tokens=40,
        )


# Biome fixtures for the keyless Fake path — full enough to look good on the map.
_SAVANNA: dict = {
    "bounds": 100,
    "weather": {"preset": "clear", "temperature": 0.8, "timeOfDay": 12},
    "species": [
        {"species": "watering_hole", "kind": "feature", "diet": "none", "count": 1, "radius": 7, "color": "#38bdf8", "maxSpeed": 0},
        {"species": "acacia", "kind": "plant", "diet": "none", "count": 14, "radius": 1.5, "color": "#65a30d", "maxSpeed": 0},
        {"species": "buffalo", "kind": "animal", "diet": "prey", "count": 12, "radius": 1.6, "color": "#a16207", "maxSpeed": 7},
        {"species": "zebra", "kind": "animal", "diet": "prey", "count": 10, "radius": 1.3, "color": "#e5e7eb", "maxSpeed": 8},
        {"species": "lion", "kind": "animal", "diet": "predator", "count": 3, "radius": 1.7, "color": "#f59e0b", "maxSpeed": 9},
        {"species": "jeep", "kind": "vehicle", "diet": "none", "count": 1, "radius": 2, "color": "#dc2626", "maxSpeed": 10},
    ],
    "relationships": [
        {"subject": "lion", "predicate": "stalks", "object": "buffalo"},
        {"subject": "lion", "predicate": "stalks", "object": "zebra"},
        {"subject": "buffalo", "predicate": "herds-with", "object": "buffalo"},
        {"subject": "zebra", "predicate": "herds-with", "object": "zebra"},
        {"subject": "buffalo", "predicate": "drinks-at", "object": "watering_hole"},
        {"subject": "zebra", "predicate": "drinks-at", "object": "watering_hole"},
        {"subject": "lion", "predicate": "drinks-at", "object": "watering_hole"},
        {"subject": "jeep", "predicate": "disturbs", "object": "buffalo"},
        {"subject": "jeep", "predicate": "disturbs", "object": "zebra"},
    ],
}

_FOREST: dict = {
    "bounds": 100,
    "weather": {"preset": "cloudy", "temperature": 0.45, "timeOfDay": 9},
    "species": [
        {"species": "river", "kind": "feature", "diet": "none", "count": 1, "radius": 6, "color": "#38bdf8", "maxSpeed": 0},
        {"species": "oak", "kind": "plant", "diet": "none", "count": 20, "radius": 1.7, "color": "#15803d", "maxSpeed": 0},
        {"species": "deer", "kind": "animal", "diet": "prey", "count": 12, "radius": 1.3, "color": "#d6a87a", "maxSpeed": 8},
        {"species": "wolf", "kind": "animal", "diet": "predator", "count": 4, "radius": 1.5, "color": "#9ca3af", "maxSpeed": 9},
    ],
    "relationships": [
        {"subject": "wolf", "predicate": "stalks", "object": "deer"},
        {"subject": "deer", "predicate": "herds-with", "object": "deer"},
        {"subject": "deer", "predicate": "drinks-at", "object": "river"},
        {"subject": "wolf", "predicate": "drinks-at", "object": "river"},
    ],
}

_MEADOW: dict = {
    "bounds": 100,
    "weather": {"preset": "clear", "temperature": 0.4, "timeOfDay": 10},
    "species": [
        {"species": "pond", "kind": "feature", "diet": "none", "count": 1, "radius": 6, "color": "#38bdf8", "maxSpeed": 0},
        {"species": "wildflower", "kind": "plant", "diet": "none", "count": 22, "radius": 1.2, "color": "#a3e635", "maxSpeed": 0},
        {"species": "rabbit", "kind": "animal", "diet": "prey", "count": 16, "radius": 1.0, "color": "#e5e7eb", "maxSpeed": 9},
    ],
    "relationships": [
        {"subject": "rabbit", "predicate": "herds-with", "object": "rabbit"},
        {"subject": "rabbit", "predicate": "drinks-at", "object": "pond"},
    ],
}


# ─────────────────────────────────────────────────────────────────────────────
# GeminiProvider — real provider (lazy import; needs GOOGLE_API_KEY)
# ─────────────────────────────────────────────────────────────────────────────


class GeminiProvider:
    name = "gemini"

    def __init__(self, model: str = "gemini-2.5-flash") -> None:
        self.model = model

    def generate(self, prompt: str, world_context: Optional[str]) -> ProviderOutput:
        # Lazy import so the package installs and tests run without the heavy
        # langchain-google-genai dependency (install with the `gemini` extra).
        from langchain_core.messages import HumanMessage, SystemMessage
        from langchain_google_genai import ChatGoogleGenerativeAI

        llm = ChatGoogleGenerativeAI(model=self.model, temperature=0)
        bound = llm.bind_tools(_GEMINI_TOOLS)
        system = _SYSTEM_PROMPT
        if world_context:
            system += f"\n\nCurrent world state:\n{world_context}"
        response = bound.invoke([SystemMessage(content=system), HumanMessage(content=prompt)])

        tool_calls = [_normalize_tool_call(tc) for tc in (response.tool_calls or [])]
        usage = getattr(response, "usage_metadata", None) or {}
        return ProviderOutput(
            tool_calls=tool_calls,
            reasoning=(response.content if isinstance(response.content, str) else str(response.content))
            or "Tool calls selected by Gemini.",
            model=self.model,
            input_tokens=int(usage.get("input_tokens", 0)),
            output_tokens=int(usage.get("output_tokens", 0)),
            finish_reason="tool_calls" if tool_calls else "stop",
        )

    def populate(self, prompt: str) -> ScenePlan:
        from langchain_core.messages import HumanMessage, SystemMessage
        from langchain_google_genai import ChatGoogleGenerativeAI

        # Gemini's structured-output schema is a subset of JSON Schema, so we
        # strip keywords it rejects (defaults, additionalProperties, numeric
        # bounds) from the canonical artifact — still schema-driven (R4).
        schema = _sanitize_for_gemini(contracts.SCENE_SCHEMA)
        llm = ChatGoogleGenerativeAI(model=self.model, temperature=0.4)
        structured = llm.with_structured_output(schema)
        scene = structured.invoke(
            [SystemMessage(content=_ECOLOGIST_PROMPT), HumanMessage(content=prompt)]
        )
        scene_dict = dict(scene) if not isinstance(scene, dict) else scene
        names = ", ".join(s.get("species", "?") for s in scene_dict.get("species", []))
        return ScenePlan(
            scene=scene_dict,
            reasoning=f"Gemini populated the scene with {names}." if names else "Gemini returned a scene.",
            model=self.model,
        )


def _sanitize_for_gemini(schema: dict) -> dict:
    """Recursively drop JSON-Schema keywords Gemini's structured output rejects."""
    drop = {
        "$schema",
        "default",
        "additionalProperties",
        "minLength",
        "maxLength",
        "minimum",
        "maximum",
        "exclusiveMinimum",
        "exclusiveMaximum",
    }
    if not isinstance(schema, dict):
        return schema
    out: dict = {}
    for key, value in schema.items():
        if key in drop:
            continue
        if key == "properties" and isinstance(value, dict):
            out[key] = {k: _sanitize_for_gemini(v) for k, v in value.items()}
        elif key == "items":
            out[key] = _sanitize_for_gemini(value)
        else:
            out[key] = value
    return out


_ECOLOGIST_PROMPT = (
    "You are an ecologist and scene director for a real-time 3D world. Given a "
    "short, possibly vague description, infer what naturally belongs there and "
    "return a structured scene.\n\n"
    "For `species`, list the flora, fauna, water features and any vehicles that "
    "plausibly exist. Set `kind` to animal | plant | vehicle | feature (a "
    "watering hole, river or pond is a feature). Set `diet` to predator | prey | "
    "none. Choose realistic counts (few predators, prey in herds of 8-14, plants "
    "scattered), a `maxSpeed` in world units (predators slightly faster than "
    "their prey; plants and features 0), a small body `radius`, and a hex "
    "`color` that reads well on a dark map.\n\n"
    "For `relationships`, connect species using ONLY these predicates: `stalks` "
    "(predator hunts prey), `flees-from`, `herds-with` (gregarious animals, "
    "usually a species with itself), `drinks-at` (an animal -> a water feature), "
    "`disturbs` (a vehicle -> the animals it frightens). Always link each "
    "predator to its prey with `stalks`, each herd animal to itself with "
    "`herds-with`, and each drinking animal to the water feature with "
    "`drinks-at`.\n\n"
    "For `weather`, pick a preset (clear|cloudy|storm|sunset|night), a "
    "temperature 0..1 and a timeOfDay 0..24 that match the description (a hot "
    "midday savanna is ~0.8 temperature at 12:00).\n\n"
    "Keep the world to about 6 species. Only include a vehicle if the prompt "
    "mentions one. Be ecologically sensible."
)


def _normalize_tool_call(tc: dict) -> dict:
    """Map a Gemini tool call into a WorldAPICall, filling schema defaults."""
    name = tc.get("name")
    args = dict(tc.get("args") or {})
    if name == "SetSkyState":
        args.setdefault("transition_seconds", 5)
    elif name == "AdvanceTime":
        args.setdefault("speed_multiplier", 1)
    elif name == "SpawnTrees":
        args.setdefault("growth_stage", "mature")
        args.setdefault("area", {"center": {"x": 0, "y": 0, "z": 0}, "radius": 10})
    elif name == "SetCreatureLeader":
        args.setdefault("distance_m", 4)
    elif name == "WanderCreature":
        args.setdefault("radius_m", 15)
    return {"tool": name, "args": args}


_SYSTEM_PROMPT = (
    "You direct a real-time 3D savanna. Translate the user's request into an "
    "ORDERED list of world-API tool calls — you are a scene director, so the "
    "order matters and you may emit several.\n\n"
    "Creatures. You speak in INTENT: a species and a named landmark. The engine "
    "owns the asset details (you never give mesh paths or coordinates).\n"
    "  species: elephant_adult, elephant_baby\n"
    "  landmarks: herd_start (a dry rim where a herd gathers), watering_hole "
    "(the lake shore where animals drink)\n"
    "  states: idle, walk, run, drink, graze\n\n"
    "Verbs: SpawnCreature(species, id, at) places a creature and gives it a "
    "stable id you reuse later; SetCreatureLeader(id, leader_id, distance_m) "
    "makes one trail another (use ~4 m for a calf behind its mother); "
    "MoveCreatureTo(id, to) walks it to a landmark (it auto-stops at the "
    "shoreline); SetCreatureState(id, state) puts it into an action like drink; "
    "WanderCreature(id, around) for idle roaming; DespawnCreature/ClearCreatures "
    "to remove. Wait(seconds) pauses the SCRIPT between steps — use it to let a "
    "migration finish (~75 s to the watering_hole) before you make them drink.\n\n"
    "A herd migrating to drink looks like: spawn the matriarch (elephant_adult), "
    "spawn a calf (elephant_baby), make the calf follow the matriarch, move the "
    "matriarch to the watering_hole, Wait, then set both to drink.\n\n"
    "You can also set the sky (SetSkyState) and time (AdvanceTime). Only call "
    "tools the request implies; do not invent parameters."
)

_GEMINI_TOOLS = [
    {
        "name": "SetSkyState",
        "description": "Set the sky/weather preset.",
        "parameters": {
            "type": "object",
            "properties": {
                "preset": {"type": "string", "enum": ["clear", "cloudy", "storm", "sunset", "night"]},
                "transition_seconds": {"type": "number"},
            },
            "required": ["preset"],
        },
    },
    {
        "name": "AdvanceTime",
        "description": "Advance world time.",
        "parameters": {
            "type": "object",
            "properties": {
                "hours": {"type": "number"},
                "speed_multiplier": {"type": "number"},
            },
            "required": ["hours"],
        },
    },
    {
        "name": "SpawnTrees",
        "description": "Procedurally scatter trees in an area.",
        "parameters": {
            "type": "object",
            "properties": {
                "area": {"type": "object"},
                "count": {"type": "integer"},
                "species": {"type": "string", "enum": ["oak", "pine", "birch"]},
                "growth_stage": {"type": "string", "enum": ["seedling", "sapling", "mature"]},
            },
            "required": ["count", "species"],
        },
    },
    {
        "name": "SpawnCreature",
        "description": "Place a creature of a species at a named landmark, with a stable id to address it later.",
        "parameters": {
            "type": "object",
            "properties": {
                "species": {"type": "string", "enum": ["elephant_adult", "elephant_baby"]},
                "id": {"type": "string"},
                "at": {"type": "string", "enum": ["herd_start", "watering_hole"]},
                "yaw": {"type": "number"},
            },
            "required": ["species", "id", "at"],
        },
    },
    {
        "name": "MoveCreatureTo",
        "description": "Walk a creature to a named landmark (it auto-stops at the shoreline).",
        "parameters": {
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "to": {"type": "string", "enum": ["herd_start", "watering_hole"]},
                "speed": {"type": "number"},
            },
            "required": ["id", "to"],
        },
    },
    {
        "name": "SetCreatureState",
        "description": "Put a creature into a state/action (idle|walk|run|drink|graze).",
        "parameters": {
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "state": {"type": "string", "enum": ["idle", "walk", "run", "drink", "graze"]},
            },
            "required": ["id", "state"],
        },
    },
    {
        "name": "SetCreatureLeader",
        "description": "Make a creature trail another, keeping distance_m metres behind (e.g. a calf behind its mother).",
        "parameters": {
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "leader_id": {"type": "string"},
                "distance_m": {"type": "number"},
            },
            "required": ["id", "leader_id"],
        },
    },
    {
        "name": "WanderCreature",
        "description": "Have a creature roam randomly around a landmark.",
        "parameters": {
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "around": {"type": "string", "enum": ["herd_start", "watering_hole"]},
                "radius_m": {"type": "number"},
                "speed": {"type": "number"},
            },
            "required": ["id", "around"],
        },
    },
    {
        "name": "DespawnCreature",
        "description": "Remove a single creature by id.",
        "parameters": {
            "type": "object",
            "properties": {"id": {"type": "string"}},
            "required": ["id"],
        },
    },
    {
        "name": "ClearCreatures",
        "description": "Remove all creatures.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "Wait",
        "description": "Pause the script for N seconds between steps (e.g. let a migration finish before drinking).",
        "parameters": {
            "type": "object",
            "properties": {"seconds": {"type": "number"}},
            "required": ["seconds"],
        },
    },
]


def make_provider() -> LLMProvider:
    """Pick a provider from the environment: gemini if a key is present, else fake."""
    provider = os.environ.get("BRAIN_PROVIDER", "").lower()
    has_key = bool(os.environ.get("GOOGLE_API_KEY"))
    if provider == "gemini" or (provider == "" and has_key):
        model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
        return GeminiProvider(model=model)
    return FakeProvider()
