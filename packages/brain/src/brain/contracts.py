"""Contract validation against the JSON Schemas generated from the TS Zod source.

R4: the Zod schemas in `@yellow-ue/llm-brain` / `@yellow-ue/world-api` are the
single source of truth. `pnpm --filter @yellow-ue/llm-brain codegen` emits the
`_schemas/*.json` files this module loads — Python never hand-maintains a
parallel contract; it validates against the generated artifact.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import jsonschema

_SCHEMA_DIR = Path(__file__).parent / "_schemas"


def _load(name: str) -> dict:
    return json.loads((_SCHEMA_DIR / f"{name}.schema.json").read_text())


REQUEST_SCHEMA = _load("llm-completion-request")
RESULT_SCHEMA = _load("llm-completion-result")
WORLD_API_CALL_SCHEMA = _load("world-api-call")
SCENE_SCHEMA = _load("scene-spec")


def validate_request(data: Any) -> None:
    jsonschema.validate(data, REQUEST_SCHEMA)


def validate_result(data: Any) -> None:
    jsonschema.validate(data, RESULT_SCHEMA)


def validate_tool_call(data: Any) -> None:
    jsonschema.validate(data, WORLD_API_CALL_SCHEMA)


def apply_defaults(data: Any, schema: dict) -> Any:
    """Fill in schema `default`s for any missing fields, recursively.

    Zod emits every defaulted field as `required`, so the LLM's (possibly
    partial) output would otherwise fail validation. We fill defaults straight
    from the generated artifact — staying schema-driven (R4) rather than
    hand-coding the defaults a second time.
    """
    schema_type = schema.get("type")
    if schema_type == "object" and isinstance(data, dict):
        for key, subschema in schema.get("properties", {}).items():
            if key not in data and "default" in subschema:
                data[key] = copy.deepcopy(subschema["default"])
            if key in data and isinstance(subschema, dict):
                data[key] = apply_defaults(data[key], subschema)
        return data
    if schema_type == "array" and isinstance(data, list):
        items = schema.get("items")
        if isinstance(items, dict):
            return [apply_defaults(item, items) for item in data]
    return data


def coerce_scene(data: Any) -> dict:
    """Fill defaults from the canonical scene-spec schema, then validate.

    The TS `SceneSpecSchema.parse` in `loadScene` is the final gate; this is the
    brain validating its *own* output against the same generated contract."""
    filled = apply_defaults(copy.deepcopy(data), SCENE_SCHEMA)
    jsonschema.validate(filled, SCENE_SCHEMA)
    return filled


def validate_scene(data: Any) -> None:
    jsonschema.validate(data, SCENE_SCHEMA)
