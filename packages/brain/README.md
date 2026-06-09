# `yellow-ue-brain` (Phase 2 Track A)

**The real `LLMClient` — a LangGraph agent that turns prompts into validated
WorldAPI tool calls, served over HTTP.**

This is the Python side of the brain boundary. The TS `BrainHttpClient`
(`@yellow-ue/llm-brain/http`) POSTs here; page 01 swaps `MockLLMClient` →
`BrainHttpClient` with no other change (R2).

## Layout

```
src/brain/
  tracing.py     Python @boundary mirroring the TS BoundaryEvent (R3)
  contracts.py   validates against JSON Schemas generated from the Zod source (R4)
  providers.py   LLMProvider Protocol + FakeProvider (deterministic) + GeminiProvider
  agent.py       LangGraph agent: plan → assemble, with a validated boundary
  app.py         FastAPI: POST /complete -> { result, spans }, GET /health
  _schemas/      GENERATED — emitted by `pnpm --filter @yellow-ue/llm-brain codegen`
tests/           run with the FakeProvider; no API key needed
```

## Run it

```bash
cd packages/brain
uv sync                      # creates the venv (Python 3.12)
uv run pytest                # tests (FakeProvider, no key)
uv run python -m brain       # serve on http://127.0.0.1:8000
```

By default the service uses the **FakeProvider** (deterministic, mirrors the
Phase 1 mock). To use Gemini:

```bash
uv sync --extra gemini
export GOOGLE_API_KEY=...     # and optionally BRAIN_PROVIDER=gemini
uv run python -m brain
```

## Contract source of truth (R4)

`contracts.py` validates against `_schemas/*.json`, which are **generated** from
the Zod schemas in `@yellow-ue/llm-brain` and `@yellow-ue/world-api`. Never edit
them by hand — run the TS codegen. This guarantees the Python brain and the TS
client agree on the contract.

## Tracing across the process boundary (R3)

`/complete` runs the agent inside a `trace_context()` and returns the collected
`spans` alongside the result. The TS `BrainHttpClient` re-parents those spans
(`brain:*`) under its own `llm-brain.complete` span, so the Pipeline Trace
Viewer shows the full lifecycle — TS → HTTP → Python agent → provider — in one
tree.
