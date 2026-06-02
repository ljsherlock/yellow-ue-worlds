"""LLM providers behind a common Protocol.

`FakeProvider` is deterministic and mirrors the TS `MockLLMClient` rules, so
tests need no API key and the brain has parity with the Phase 1 mock.
`GeminiProvider` is the real thing (lazy-imported; needs GOOGLE_API_KEY).
"""

from __future__ import annotations

import math
import os
import re
from dataclasses import dataclass
from typing import Optional, Protocol, runtime_checkable


@dataclass
class ProviderOutput:
    tool_calls: list[dict]
    reasoning: str
    model: str
    input_tokens: int
    output_tokens: int
    finish_reason: str


@runtime_checkable
class LLMProvider(Protocol):
    name: str

    def generate(self, prompt: str, world_context: Optional[str]) -> ProviderOutput: ...


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


# ─────────────────────────────────────────────────────────────────────────────
# GeminiProvider — real provider (lazy import; needs GOOGLE_API_KEY)
# ─────────────────────────────────────────────────────────────────────────────


class GeminiProvider:
    name = "gemini"

    def __init__(self, model: str = "gemini-2.0-flash") -> None:
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
    return {"tool": name, "args": args}


_SYSTEM_PROMPT = (
    "You control a real-time 3D world. Translate the user's request into the "
    "available world-API tool calls. Only call tools that are clearly implied. "
    "Do not invent parameters."
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
]


def make_provider() -> LLMProvider:
    """Pick a provider from the environment: gemini if a key is present, else fake."""
    provider = os.environ.get("BRAIN_PROVIDER", "").lower()
    has_key = bool(os.environ.get("GOOGLE_API_KEY"))
    if provider == "gemini" or (provider == "" and has_key):
        return GeminiProvider()
    return FakeProvider()
