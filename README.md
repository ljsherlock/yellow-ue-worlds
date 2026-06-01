# Yellow UE Worlds

An LLM-controlled, real-time, stateful 3D world built on Unreal Engine 5.7,
delivered to the browser via Pixel Streaming.

The user types a prompt; an LLM brain translates intent into world-API calls;
the world updates in real time (trees grow, weather shifts, biomes mutate);
state is persisted in a temporal knowledge graph so the world has memory.

---

## Status

| Phase | State | Notes |
|---|---|---|
| Research / de-risking | ✅ Complete (2026-06-01) | See `## De-risking findings` |
| Architecture decisions | ✅ Locked | See `## Tech stack decisions` |
| First world-API tools | ✅ Locked 2026-06-01 | See `## First world-API tools` (`SetSkyState`, `AdvanceTime`, `SpawnTrees`) |
| GCP L4 quota | ✅ Confirmed 2026-06-01 | 16 on-demand + 16 preemptible in `us-central1`, project `task-assistant-project`. No request needed for MVP. |
| Project rules | ✅ Complete 2026-06-01 | R1–R5 live in `.cursor/rules/` |
| Monorepo bootstrap | ✅ Complete 2026-06-01 | pnpm 11.5.0 + uv (Python 3.14), workspace scaffolded |
| Phase 0 — Foundation | ✅ Complete 2026-06-01 | Workspace + rules + `world-api` + `tracing` + inspector skeleton + page 07 keystone, 52 tests green |
| Inspector pages 01–06 | ⏳ Not started | Phase 1 of MVP plan |
| Real components | ⏳ Not started | Phase 2 of MVP plan |
| GCP infrastructure | ⏳ Not started | Phase 3 of MVP plan |
| End-to-end loop | ⏳ Not started | Phase 4 of MVP plan |

---

## Vision

> The user gives a prompt. The world becomes that prompt — and remembers it.

- **Stateful environment** — not just generation at t=0, but ongoing mutation
  with persistence (a tree planted at t=10 is still there at t=100, having
  grown).
- **LLM as world author** — the LLM is the brain, not a chatbot bolted on top.
  Procedural generation parameters, weather, time-of-day, biomes, creatures
  are all driven by LLM tool calls.
- **Real-time updates** — "trees growing at 100× speed, weather changes" —
  the world is in continuous motion, not request/response.
- **Browser-delivered** — zero install, runs on any modern browser including
  mobile, no client GPU requirements.

---

## Architecture

### End-to-end pipeline

```
Browser (WebRTC client + control surface)
   ↑   rendered frames ↓ / input + prompts ↑
   │
GPU streaming host (GCP G2 + NVIDIA L4)
   ├─ UE 5.7 packaged build
   │     ├─ Pixel Streaming 2 plugin           (WebRTC video out)
   │     └─ Remote Control plugin              (HTTP :30010 / WS :30020 in)
   ↑    HTTP/WS function calls + property writes
   │
LLM brain process (own service)
   ├─ LangGraph agent                          (durable, checkpointed)
   ├─ Graphiti world-state graph               (temporal knowledge graph)
   └─ Tool surface = Remote Control Preset     (SetWeather, AdvanceTime,
                                                SpawnBiome, RegrowTree, …)
```

### De-risking findings (verified 2026-06-01)

All findings checked against live primary sources, not search summaries.

1. **Memory graph** — Solved problem. 2026 stack:
   - **LangGraph** for agent orchestration + Postgres checkpointer for durable
     resumable execution.
   - **Graphiti** (Zep's open-source temporal knowledge graph engine,
     self-hostable, MIT) for world state with `valid_from`/`valid_to`
     timestamps on every fact. Perfect fit for evolving entities (trees,
     biomes, weather, creatures).
   - Mem0 added later for per-user personalization. Skipped for prototype.

2. **UE API control scope** — Larger than expected.
   - **Remote Control API** (HTTP :30010 + WebSocket :30020) works in
     packaged shipping builds with `-RCWebControlEnable -RCWebInterfaceEnable`.
     Exposes any Blueprint/Python function or property. Still officially
     Beta in UE 5.7 — thin abstraction layer recommended.
   - **PCG (Procedural Content Generation) is Production Ready in UE 5.7**
     (released late 2025). Blueprint-callable at runtime, async generation,
     hierarchical LOD, parameter overrides, new `Execute Python Script`
     PCG node. **This is the single feature that makes the project viable
     now rather than a research bet.**

3. **Browser compatibility** — No native UE-in-browser is viable.
   - HTML5 dropped in UE 4.24. SpeculativeCoder fork actively maintained but
     UE 4.27 only (no Lumen, Nanite, PCG, compute shaders).
   - SimplyStream / Wonder Interactive: real commercial UE5→WebGPU port with
     real customers, but WebGPU's lack of 64-bit atomics caps Nanite at
     research grade and Lumen is "not interesting to implement." Chrome-only
     in practice. UE 5.6 max as of 2026-06-01. **Watch list, not viable for
     this project.**
   - **Pixel Streaming** is the only path. WebRTC, every modern browser
     including mobile Safari, no client GPU.

4. **GPU cloud streaming** — Mature market, GCP chosen.
   - **GCP G2 (NVIDIA L4)** at $0.85/hr on-demand (~$0.30/hr spot).
     Cheaper than AWS g5 by ~15%, same NVENC silicon.
   - **L4 has hardware AV1 encoder** (T4 and A10G do not) — ~30% bitrate
     reduction at same visual quality. Small but genuine quality win over AWS.
   - **TensorWorks** (Pixel Streaming infrastructure maintainers) publishes
     a GCP-specific deployment guide — well-trodden path.
   - **Immersive Stream for XR** (Google's managed UE service) considered
     and rejected: UE 5.3 only, 30 FPS target, ≤2s load target — wrong
     shape for this project.

### What we explicitly chose NOT to do (and why)

| Choice | Why rejected |
|---|---|
| UE 4.27 HTML5 forks (SpeculativeCoder) | No UE5 features (no Lumen, Nanite, PCG, compute shaders) — defeats the point of using UE |
| SimplyStream WebGPU port | WebGPU lacks 64-bit atomics → Nanite degraded, Lumen absent, Chrome-only, vendor lock-in to single company |
| Consumer cloud gaming (GeForce NOW, Xbox Cloud) | Curated catalogs only, can't ship arbitrary UE builds |
| AWS over GCP | No quality difference, GCP L4 ~15% cheaper, GCP has AV1 hardware encoder, TensorWorks publishes GCP guide |
| Immersive Stream for XR (GCP managed) | UE 5.3 max, 30 FPS / 2s load targets, mobile-AR-first positioning |
| Unreal MCP servers (community) | Editor-time only, not runtime control of packaged builds |

---

## First world-API tools (locked 2026-06-01)

These three tools form the initial vocabulary the LLM uses to talk to the
world. They were chosen because together they hit three different mechanism
families (atmospheric, temporal, procedural-spawn), each produces a visually
unmistakable change, each maps to a natural English phrase, and they
interact meaningfully (time advances → trees grow; sky becomes storm →
trees sway).

**Scene assumption:** open landscape with a sky, terrain, and room for
trees. The MVP world is outdoor and natural; we can add interiors and
abstract spaces in later iterations.

### 1. `SetSkyState(preset, transition_seconds?)`

```ts
SetSkyState(
  preset: "clear" | "cloudy" | "storm" | "sunset" | "night",
  transition_seconds?: number   // default 5
)
```

- **Tests:** instant property change with smooth transition. Lumen GI
  re-bakes correctly when sky shifts. Remote Control can drive UE state.
- **Schema:** one `SkyState` entity with overwrite semantics. New fact
  invalidates the previous one (`valid_to = now`, new fact `valid_from = now`).
- **Natural prompts:** *"make it stormy"*, *"sunset please"*, *"go dark"*

### 2. `AdvanceTime(hours, speed_multiplier?)`

```ts
AdvanceTime(
  hours: number,                  // world-hours to advance
  speed_multiplier?: number       // 1 = real-time, 100 = "trees grow 100× speed"
)
```

- **Tests:** temporal control. Forces the world-state graph to be properly
  time-aware from day one (Graphiti's native model).
- **Schema:** one `Clock` entity. Every other entity's facts get a
  temporal envelope from this clock.
- **Natural prompts:** *"skip to morning"*, *"speed everything up 100×"*,
  *"a week passes"*

### 3. `SpawnTrees(area, count, species, growth_stage?)`

```ts
SpawnTrees(
  area: { center: Vec3, radius: number },
  count: number,
  species: "oak" | "pine" | "birch",
  growth_stage?: "seedling" | "sapling" | "mature"   // default "mature"
)
```

- **Tests:** **PCG runtime generation** — the killer UE 5.7 feature. LLM
  tool call parameterizes a PCG graph at runtime. Entity lifecycle in the
  world graph.
- **Schema:** each spawned tree is a `Tree` entity with `species`,
  `position`, `growth_stage`, `planted_at`. Growth stage evolves when
  `AdvanceTime` runs.
- **Natural prompts:** *"plant 50 oaks here"*, *"scatter pines along the
  ridge"*, *"a forest of birch saplings"*

### Versioning

These are `WorldAPIv1`. We expect to add 5–10 more tools in Phase 2 once
the inspector pages reveal what the LLM wishes existed. We may rename
tools and bump to `WorldAPIv2`. This is normal — the contract is designed
to evolve, not to be perfect on day one.

---

## Tech stack decisions

| Layer | Choice | Why |
|---|---|---|
| Engine | **UE 5.7** | PCG production-ready, Remote Control stable, latest Lumen/Nanite |
| Procedural generation | **PCG (built-in, UE 5.7)** | Runtime Blueprint-callable, async, parameter overrides, Python interop |
| LLM control bridge | **Remote Control plugin** (HTTP + WS) | Works in packaged builds, exposes BP/Python surface |
| LLM orchestration | **LangGraph** (Python) | Durable execution, checkpointed, mature in 2026 |
| World state | **Graphiti** (self-hosted) | Temporal knowledge graph, MIT, fits stateful world perfectly |
| Per-user memory | **Mem0** (later, not MVP) | Vendor-supported, integrates with LangGraph |
| Streaming infrastructure | **GCP Compute Engine G2 + NVIDIA L4** | Cheapest L4 tier, AV1 hardware encoder, official guide exists |
| Streaming protocol | **Pixel Streaming 2** (built-in, UE 5.5+) | Mature, WebRTC, every browser |
| Web frontend | **TypeScript + React** | Modern, composable, function components + hooks |
| Inspector pages | **Same React app as production** | Shared code with main app — see `## Project rules` R1 |
| Shared types | **TypeScript + Python pydantic, generated from one source** | Contract integrity across language boundaries |

---

## Methodology — interface-driven design with dependency injection

**Not** classical OOP everywhere. The principle is:

- **Explicit interfaces between subsystems** — TypeScript `interface` / Python
  `Protocol`. The contract lives in the type, not in someone's head.
- **Dependency injection** — components receive collaborators rather than
  constructing them. Inspector pages can swap real components for fakes
  *using the same code paths the main app runs*.
- **Composition over inheritance** — small, single-purpose modules wired
  together.
- **Pure functions wherever possible** — they need unit tests, not inspectors.

| Layer | Style | Why |
|---|---|---|
| LLM brain | Composition + Protocols + dataclasses | LangGraph is already function-graph shaped; light OO |
| Memory graph | Repository pattern behind `WorldStateStore` Protocol | Lets you swap Graphiti for in-memory fake in inspectors |
| RC bridge | Adapter pattern — one `WorldAPI` interface, multiple transports | Test with mock transport, production with real |
| UE C++ / Blueprints | OOP (forced by engine) | But: thin Actor classes, gameplay logic in Blueprint Function Libraries |
| Web frontend | React function components + hooks | Modern idiom, clean seams for inspectors |
| Shared types | One source, generated to TS + Python | See R4 below |

The unifying rule: **the main app is the canonical implementation. Inspector
pages render the same code paths with different injections. No parallel
implementations.**

---

## Repository structure

```
yellow-ue-worlds/
├── packages/                                 SHARED PACKAGES — imported by both main app and inspectors
│   ├── world-api/                            single-source contract for the LLM tool surface
│   │   ├── schema.ts                         TypeScript types
│   │   ├── schema.py                         Python pydantic (generated from above)
│   │   └── tools.ts                          tool definitions for LLM
│   ├── llm-brain/                            Python — LangGraph agent
│   │   ├── agent.py
│   │   ├── interfaces.py                     Protocols (WorldStateStore, WorldAPIClient, LLMClient)
│   │   └── fakes/                            in-memory implementations for testing
│   ├── memory-graph/                         Python — Graphiti wrapper
│   │   ├── store.py                          implements WorldStateStore Protocol
│   │   └── fakes/
│   ├── rc-bridge/                            TS — Remote Control HTTP/WS client
│   │   ├── client.ts                         implements WorldAPIClient interface
│   │   └── fakes/
│   └── tracing/                              shared observability
│       └── boundary.ts                       decorator that logs structured I/O at boundaries
├── ue-project/                               UE 5.7 project
│   ├── Content/Blueprints/WorldAPI/          the Remote Control Preset surface
│   └── ...
├── apps/
│   ├── web/                                  MAIN APP — production
│   │   ├── src/
│   │   └── package.json
│   └── inspector/                            INSPECTOR PAGES — development only
│       ├── pages/
│       │   ├── 07-pipeline-trace.tsx         ← BUILD THIS FIRST (with mocks)
│       │   ├── 01-prompt-to-tools.tsx
│       │   ├── 02-world-state-graph.tsx
│       │   ├── 03-world-api-mock.tsx
│       │   ├── 04-rc-round-trip.tsx
│       │   ├── 05-pcg-inspector.tsx
│       │   └── 06-streaming-diagnostics.tsx
│       └── package.json
├── infra/                                    GCP deployment (Terraform / scripts)
├── .cursor/rules/                            project rules R1–R5
└── README.md                                 this file
```

---

## Inspector-first development

Build the inspector page **before** the real component, populated with mock
data flowing through the same interfaces the real component will satisfy.

This forces every boundary to expose structured I/O from day one.

| # | Inspector page | Inspects | Proves |
|---|---|---|---|
| **07** | **Pipeline Trace Viewer** ← BUILD FIRST | End-to-end: prompt → LLM → tool calls → RC messages → UE responses → world state delta. Each layer's I/O side-by-side. | Every boundary is observable. Generalizes the "Gemini prompt before Skybox" debugging from The Body Field. |
| 01 | Prompt → Tool Calls | User prompt in → list of `WorldAPI` tool calls + reasoning trace out | LLM understands the world API. Catches prompt-engineering regressions. |
| 02 | World State Graph | Graphiti queries, writes, time-travel reads. Graph visualized at any timestamp. | Memory works correctly across time. Catches schema drift. |
| 03 | World API Mock Bench | Send tool calls to a fake UE (in-memory); see what the contract requires. | Validates the API surface in isolation from UE. |
| 04 | RC Round-Trip | Send a tool call → real UE Remote Control → see the response. No LLM, no graph. | Proves the UE bridge works. Measures latency. |
| 05 | PCG Parameter Inspector | Visualize what parameters PCG graphs received and what they generated. | Debug procedural output without re-running full pipeline. |
| 06 | Streaming Diagnostics | Live codec, bitrate, FPS, RTT, packet loss. | Catches network/streaming regressions. |

---

## Project rules

To live in `.cursor/rules/`. Cursor will enforce these on every edit.

| # | Rule file | What it enforces |
|---|---|---|
| **R1** | `shared-modules-only.mdc` | Inspector pages MUST import from `packages/`. No re-implementing production logic in `apps/inspector/`. |
| **R2** | `interface-first-design.mdc` | Every cross-package boundary MUST be a TypeScript `interface` / Python `Protocol`. Implementations are injected, not constructed inline. |
| **R3** | `observable-boundaries.mdc` | Every boundary call MUST be wrapped in the `@boundary` decorator (or equivalent) so the Pipeline Trace Viewer can render it. No hidden state mutations. |
| **R4** | `one-source-of-truth-per-contract.mdc` | The `WorldAPI` types are defined in `packages/world-api/` and generated to other languages. No parallel hand-maintained definitions. |
| **R5** | `inspector-per-boundary.mdc` | When adding a new cross-package boundary, a corresponding inspector page MUST be added to `apps/inspector/` in the same PR. Inspector is part of "done", not a follow-up. |

CI checks to add later: grep for forbidden imports (R1), schema-diff between
generated TS and Python types (R4), lint rule that PRs touching `packages/`
also touch `apps/inspector/` (R5).

---

## De-risking MVP checklist

The goal of the MVP is to prove the full end-to-end loop works:
**user prompt → LLM tool call → UE world change → next streamed frame.**

### Phase 0 — Foundation (sequential, must be done first)

- [x] **Monorepo bootstrap** — pnpm workspaces + uv (Python) workspaces ✅ 2026-06-01
  - `package.json` + `pnpm-workspace.yaml` (TS workspace, root scripts)
  - `pyproject.toml` (uv root; ruff/mypy/pytest configured; workspace members commented in, ready for Phase 0.4)
  - `tsconfig.base.json` (strict mode, ES2022, bundler resolution)
  - `.gitignore`, `.editorconfig`
  - Placeholder dirs: `packages/`, `apps/`, `infra/` (with `.gitkeep`)
  - Verified: `pnpm install` ✓, `uv sync` ✓ (`.venv` on Python 3.14)
  - Deferred: `justfile` — npm scripts cover the current task surface; revisit if cross-language orchestration grows hairy
- [x] **`.cursor/rules/` populated** with R1, R2, R3, R4, R5 ✅ 2026-06-01
  - `shared-modules-only.mdc` (R1) — scoped to `apps/inspector/**`
  - `interface-first-design.mdc` (R2) — scoped to `{packages,apps}/**/*.{ts,tsx,py}`
  - `observable-boundaries.mdc` (R3) — scoped to `{packages,apps}/**/*.{ts,tsx,py}` (notes that `@boundary` arrives in Task 0.4)
  - `one-source-of-truth-per-contract.mdc` (R4) — scoped to `{packages,apps}/**/*.{ts,tsx,py}` (notes that codegen arrives in Phase 2)
  - `inspector-per-boundary.mdc` (R5) — scoped to `packages/**/*.{ts,tsx,py}`
- [x] **`packages/world-api/`** — first draft of `WorldAPIv1` contract ✅ 2026-06-01
  - Schema layer: **Zod 4.4** (chosen for runtime validation + JSON Schema codegen path + native LLM-tooling integration)
  - All 3 tools defined: `SetSkyState`, `AdvanceTime`, `SpawnTrees`
  - `WorldAPIClient` interface (R2) with `dispatch()` for LLM-driven discriminated calls
  - `MockWorldAPIClient` impl with realistic in-memory world state (sky, world-time, trees with toy growth model) — ready for inspector pages to consume per R1
  - Test runner: **Vitest 4.1**. 23 tests pass; typecheck clean
  - Boundary tracing marked with `// TODO(R3): wrap in @boundary` comments — gets fulfilled in Task 0.4
- [x] **`packages/tracing/`** — `boundary()` HOF + structured event format ✅ 2026-06-01
  - TS `boundary("name", fn)` higher-order wrapper (works on methods, arrows, top-level functions)
  - Python `@boundary(name=…)` decorator arrives with `packages/llm-brain/` in Phase 2 (equivalent semantics)
  - `BoundaryEvent` shape: `trace_id`, `span_id`, `parent_span_id`, `name`, `status`, `start_ts`, `end_ts`, `duration_ms`, `inputs`, `output`/`error`
  - Sinks: `InMemorySink` (inspector/tests), `ConsoleSink` (dev), `NoopSink` (prod), `MultiSink` (fan-out)
  - `withTrace(id, fn)` for grouping a logical request's spans
  - Wired into `MockWorldAPIClient` — all 4 methods now emit events. R3's TODOs in mock.ts replaced.
  - 19 tracing tests + 5 integration tests in world-api. **47 tests total green across the workspace.**
  - Known limitation: module-level span stack works only for single-flight execution. Multi-tenant server in Phase 2 swaps to `AsyncLocalStorage`.
- [x] **`apps/inspector/`** skeleton with routing ✅ 2026-06-01
  - Stack: Vite 8 + React 19 + React Router 7 + Tailwind CSS 4 + shadcn-style components (hand-rolled Button + Card)
  - 8 routes: `/` overview, `/01`…`/07` for each boundary
  - Path alias `@/*` → `apps/inspector/src/*` (TS paths + Vite resolve)
  - Layout shell with sidebar nav, active-state highlighting
  - Page 03 (World API Mock Bench) is **live** — imports `MockWorldAPIClient` from `@yellow-ue/world-api/mock`, drives it from the UI, renders boundary events from the `@yellow-ue/tracing` `InMemorySink`. This page proves the full stack works end-to-end and verifies R1, R2, R3 are all enforced.
  - Pages 01, 02, 04, 05, 06, 07 are intentional stubs — they declare the boundary they'll cover and point to the future package
  - Home page renders `WORLD_API_VERSION` from the world-api package as a workspace-link sanity check
  - Build verified: typecheck clean, `pnpm build` produces 123 kB gzipped, `pnpm dev` boots in 120ms, dev server resolves workspace package imports correctly via `/@fs/...` links
- [x] **Inspector page 07 (Pipeline Trace Viewer)** with mock data ✅ 2026-06-01
  - `TraceBuilder` added to `@yellow-ue/tracing` (generic span synthesizer; 5 new tests)
  - Two scenarios in `apps/inspector/src/lib/mock-traces.ts`: "make it stormy" success (11 spans across 5 packages) and "plant 50 oaks" RC-timeout error (6 spans, end-to-end failure)
  - `TraceTree` — recursive nested view with depth indent + per-package colour + status pill
  - `TraceWaterfall` — bar chart with start offset + duration scaled to trace bounds; visually highlights the long pole on errors
  - `EventDetail` — click any span to see trace/span/parent ids, timing, inputs, output, error payload, stack
  - Toggle between waterfall / tree views; scenario picker at top
  - Renderers accept any `BoundaryEvent[]` — when real backends arrive in Phase 2, the same components render real traces by reading from `InMemorySink` instead of `scenarios[…].build()`
  - 52 tests green workspace-wide (24 tracing + 28 world-api); inspector typecheck clean; build 412 kB raw / 127 kB gzipped

### Phase 1 — Inspector pages with mock data (parallelizable)

- [ ] **01** Prompt → Tool Calls (mock LLM client)
- [ ] **02** World State Graph (mock Graphiti store)
- [ ] **03** World API Mock Bench (in-memory fake UE)
- [ ] **04** RC Round-Trip (mock RC transport, real wire format)
- [ ] **05** PCG Inspector (mock PCG output)
- [ ] **06** Streaming Diagnostics (mock metrics)

### Phase 2 — Real implementations (four parallel tracks)

| Track | Owner-of-attention | Tasks |
|---|---|---|
| **A** Brain | Python | LangGraph agent, LLM client adapter, tool router, Postgres checkpointer |
| **B** Memory | Python | Graphiti integration, schema for world entities, time-travel queries |
| **C** Bridge | TypeScript | `rc-bridge` HTTP+WS client implementing `WorldAPIClient` interface |
| **D** UE | C++/Blueprint | Packaged UE 5.7 build with: Pixel Streaming 2, Remote Control, one world API function (`SetSkyColor`), PCG graph triggered by Remote Control |

Each track replaces a mock from Phase 1 with the real thing. **Inspectors continue to work throughout — they're the integration test.**

### Phase 3 — GCP infrastructure

**Quota status (verified 2026-06-01):** Project `task-assistant-project` in
`us-central1` has 16 on-demand + 16 preemptible `NVIDIA_L4_GPUS` already
approved. No quota request needed for MVP.

**Important distinction:** the existing Cloud Run GPU L4 quota (used by
hy-motion) is a *separate* quota system from Compute Engine GPU. Both are
in place. Pixel Streaming uses Compute Engine GPU (G2 series), not Cloud
Run GPU, because Cloud Run's 60–120s cold starts and per-request lifecycle
are wrong shape for persistent UE streaming sessions.

- [ ] GCE G2 (NVIDIA L4) instance provisioning script in `us-central1`
- [ ] NVIDIA driver + Vulkan setup
- [ ] UE build deployment to instance
- [ ] Signalling server + Pixel Streaming frontend
- [ ] Firewall rules for WebRTC + Remote Control
- [ ] Domain + HTTPS for the web client

### Phase 4 — End-to-end loop

- [ ] User types "make the sky red" in the production web app
- [ ] LLM brain emits `SetSkyColor(red)` tool call
- [ ] World state graph records the change with timestamp
- [ ] RC bridge sends the call to UE
- [ ] UE updates the sky in the live scene
- [ ] Browser sees the next streamed frame with red sky
- [ ] **Pipeline Trace Viewer shows the full chain visibly**

**MVP success criterion**: a non-engineer can type a prompt and see the world
respond, with the full LLM→UE chain visible in the inspector.

---

## Open questions for future research

- [ ] **Multi-tenancy GPU ratio** — can we run 2–3 UE instances per L4? Depends on scene complexity.
- [ ] **Warm pool strategy** — cold-start is 30–90s; how many idle GPUs do we keep warm?
- [ ] **Session length / pricing model** — see CCU cost-model deliverable (separate doc)
- [ ] **Geographic strategy** — single region at MVP; multi-region timeline?
- [ ] **Audio over WebRTC** — Pixel Streaming carries audio but spatial audio in browser needs validation
- [ ] **UE 5.8** — Epic typically ships annual major versions; PCG may evolve; Remote Control may leave Beta
- [ ] **WebGPU 64-bit atomics** — if added, SimplyStream becomes a realistic alternative for V2

---

## Related projects in this repo

- `../yellow-worlds` — earlier exploration, web-based
- `../generative-demos/the-body-field` — prior generative project; lessons applied here
- `../hy-motion` — motion retargeting work; "test page first" methodology born here

---

## Source documentation

Primary sources verified 2026-06-01:

- [UE 5.7 Release Notes](https://dev.epicgames.com/documentation/unreal-engine/unreal-engine-5-7-release-notes?lang=en-US)
- [Pixel Streaming Infrastructure docs](https://dev.epicgames.com/documentation/en-us/unreal-engine/pixel-streaming-infrastructure)
- [Remote Control for UE](https://dev.epicgames.com/documentation/en-us/unreal-engine/remote-control-for-unreal-engine)
- [TensorWorks Pixel Streaming Cloud Guide (GCP Linux)](https://github.com/TensorWorks/PixelStreamingCloudGuide/blob/main/Guides_UE_5/Pixel%20Streaming%20on%20GCP%20(Linux).md)
- [GCP Compute Engine GPU machine types](https://cloud.google.com/compute/docs/gpus)
- [LangGraph](https://github.com/langchain-ai/langgraph)
- [Graphiti (Zep open-source)](https://github.com/getzep/graphiti)
- [Mem0](https://github.com/mem0ai/mem0)
