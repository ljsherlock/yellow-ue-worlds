# `@yellow-ue/llm-brain`

**The `LLMClient` boundary — prompt in, `WorldAPICall[]` out.**

This package owns the contract between "a user said something" and "the
world should do these things." It does **not** own the world API itself
(that's `@yellow-ue/world-api`) — it owns the *translation* boundary.

## Phase status

| Phase | What ships |
|---|---|
| **1 (now)** | `LLMClient` interface + `MockLLMClient` (deterministic, rules-based) |
| **2 Track A** | Real LangGraph agent in **Python**, plus a TS `BrainHttpClient implements LLMClient` that POSTs to it. Inspector page 01 swaps the mock for the HTTP client with no other change. |

## Why the TS package exists if the real brain is Python

The inspector and production frontend are TypeScript. They need a typed
boundary to talk to the brain. In Phase 2 the brain itself is a Python
service; the TS side reaches it over HTTP via `BrainHttpClient`. Both the
mock and the HTTP client implement the same `LLMClient` interface, so the
UI is identical regardless of what's behind it.

## `MockLLMClient` behaviour

Keyword-matches the prompt and emits the matching `WorldAPICall`s:

| Prompt contains | Emits |
|---|---|
| storm / sunset / night / cloud / clear | `SetSkyState(preset)` |
| morning / week / "N hours" / "100x" / speed | `AdvanceTime(hours, speed_multiplier?)` |
| tree / forest / oak / pine / birch / plant | `SpawnTrees(area, count, species, growth_stage?)` |

Multiple categories combine: *"make it stormy and plant 50 oaks"* →
`[SetSkyState(storm), SpawnTrees(50, oak)]`.

It is deliberately not intelligent — it exercises the **boundary**, not
reasoning. Its value is that page 01 becomes a zero-cost, reproducible
"what tool calls does this prompt produce?" bench.

## Output is validated

`complete()` validates its own result against `LLMCompletionResultSchema`,
whose `toolCalls` reuse `WorldAPICallSchema` from `@yellow-ue/world-api`
(R4: one source of truth). A malformed tool call throws before it can
reach the rest of the pipeline.

## Tracing

`complete()` is wrapped in `boundary("llm-brain.complete", …)` (R3), so
every call shows up in the Pipeline Trace Viewer.
