"""Contract validation against the JSON Schemas generated from the TS Zod source.

R4: the Zod schemas in `@yellow-ue/llm-brain` / `@yellow-ue/world-api` are the
single source of truth. `pnpm --filter @yellow-ue/llm-brain codegen` emits the
`_schemas/*.json` files this module loads — Python never hand-maintains a
parallel contract; it validates against the generated artifact.
"""

from __future__ import annotations

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


def validate_request(data: Any) -> None:
    jsonschema.validate(data, REQUEST_SCHEMA)


def validate_result(data: Any) -> None:
    jsonschema.validate(data, RESULT_SCHEMA)


def validate_tool_call(data: Any) -> None:
    jsonschema.validate(data, WORLD_API_CALL_SCHEMA)
