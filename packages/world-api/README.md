# `@yellow-ue/world-api`

**Single source of truth for the LLM-to-Unreal contract (R4).**

This package defines the entire vocabulary the LLM uses to act on the
world. Every other language — Python (brain, memory graph) and Unreal C++
/ Blueprint (engine) — consumes generated artefacts from this package.
There are no parallel, hand-maintained type definitions anywhere else.

## What's here

| File | Owns |
|---|---|
| `src/primitives.ts` | `Vec3`, `Timestamp`, `EntityId` |
| `src/contract.ts` | Tool argument schemas, result schemas, discriminated union, result envelope |
| `src/client.ts` | `WorldAPIClient` interface (R2) |
| `src/mock.ts` | `MockWorldAPIClient` — in-memory impl for inspector pages & brain dev |

## WorldAPIv1 — the three tools

| Tool | Mechanism family | One-line purpose |
|---|---|---|
| `SetSkyState` | atmospheric | Switch the sky to a preset with a smooth transition |
| `AdvanceTime` | temporal | Advance world-time; ages trees, drives day/night cycle |
| `SpawnTrees` | procedural-spawn | Run a PCG graph to place N trees of a species in an area |

See the project root `README.md` "First world-API tools" for the design rationale.

## How to add a new tool

1. **Edit `src/contract.ts`** — add args schema, result schema, extend the
   discriminated union and dispatch result.
2. **Update `src/client.ts`** — add the new method to `WorldAPIClient`.
3. **Update `src/mock.ts`** — implement the mock behaviour with realistic
   in-memory state. Inspector pages will rely on this.
4. **Add tests** — at minimum: schema accepts good / rejects bad, mock
   behaviour, dispatch routing.
5. **Update the corresponding inspector page** (R5) — same change, not a
   follow-up.
6. **In Phase 2:** re-run `pnpm gen:types` to regenerate Python and UE
   bindings. (Codegen lands later — for now the contract is TS-only and
   we know we'll have to bridge by hand once.)

## Why Zod and not just `interface`?

Three reasons:

1. **Runtime validation at the boundary.** The LLM is an untrusted producer of
   tool calls — we validate at the world-API boundary, not at the UE C++
   layer. Pure TS types vanish at compile time.
2. **Single source for codegen** to Pydantic (Python) and C++ structs (UE).
   Zod → JSON Schema → those targets.
3. **LLM tooling integration.** OpenAI / Anthropic / LangGraph / Mastra all
   consume Zod schemas directly as tool definitions. Avoids a parallel
   "tool schema" layer.

## Versioning

The `WORLD_API_VERSION` constant is the contract handshake. When breaking
changes happen, bump it (`WorldAPIv2`) and treat that as a coordinated
update across brain + memory + bridge + UE.

## What this package does NOT contain

- HTTP / WebSocket transport (lives in `packages/rc-bridge`, Phase 2)
- LLM prompt definitions (lives in `packages/llm-brain`, Phase 2)
- World state persistence (lives in `packages/memory-graph`, Phase 2)
- UE Blueprint implementations (live in `ue-project/`, Phase 2)

This package is the **contract**. Implementations live elsewhere.
