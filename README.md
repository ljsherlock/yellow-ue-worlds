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
| Phase 1 — Inspector pages 01–07 | ✅ Complete 2026-06-01 | All boundaries mocked behind R2 interfaces; 7 live pages; 94 tests green |
| Phase 2 Track A — Brain | ✅ Complete 2026-06-01 | Python LangGraph brain (`packages/brain`) + `BrainHttpClient`; R4 Zod→JSON-Schema codegen; page 01 mock↔live toggle; 109 tests green (99 TS + 10 py) |
| **Vision update — LLM-directed ecosystem** | 🧭 Adopted 2026-06-02 | Two-tier (LLM director + deterministic behaviour sim) over a relationship graph. See `## World model`. Reshapes Track B + adds a 2D ecosystem-sim inspector page (08). |
| Phase 2 Track B — World model + ecologist | ✅ Shipped 2026-06-02 | `SceneSpec` + behaviour sim + LLM `/populate` (Gemini-verified). See `## World model` |
| Phase 2 Track C — RC bridge (real transport) | ✅ Done 2026-06-02 | `HttpRCBridge` + CLI; wire format verified vs UE 5.7 docs |
| Phase 2 Track D — UE on GPU | 🟢 Spikes 1a + 1b PROVEN 2026-06-02 | Streamed from GCP T4 **and** drove `WorldDirector.SetSkyState` live over Remote Control. See `ue/README.md` |
| GCP infrastructure | ✅ Core done 2026-06-02 | Provision/driver/build/stream/firewall scripted + npm ops wrapper (`ue/`). L4 perf/cost benchmark deferred |
| End-to-end loop | ⏳ Partial | Control loop closed (1b). Remaining: brain→bridge wiring + believable scene. See `## Remaining for the savanna vision` |

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
- **A living ecosystem, not a diorama** — the LLM populates a scene with the
  entities that naturally belong (flora, fauna, weather) **and the
  relationships between them** (predator/prey, herd, territory). Those
  relationships, modulated by weather and internal state, drive ongoing
  behaviour: prey flee an approaching predator, a sated lion sleeps, midday
  heat pulls the herd to the watering hole.

---

## World model: entities, relationships & behaviour (vision update 2026-06-02)

The core loop is an **LLM-directed ecosystem**. Example: *"a savanna with a
watering hole and a jeep driving around"* → the brain reasons about what
belongs (acacia, grass, buffalo, zebra, a lion or two, vultures, heat) **and
how they relate** (lion `stalks` buffalo, buffalo `herd-with` buffalo, prey
`flee-from` lion, everything `drinks-at` the watering hole), then those
relationships play out over time.

### Two tiers — keep the LLM out of the frame loop

| Tier | Cadence | Responsibility | Where it runs |
|---|---|---|---|
| **LLM director / "ecologist"** | occasional (scene creation, story beats, user prompts) | *what exists*, *the relationships*, *dispositions* (hungry/sated, alert/calm), weather & behaviour modifiers | brain service (LangGraph) |
| **Behaviour simulation** | every tick (real-time) | perception, threat evaluation, flee/stalk/herd/rest/drink, steering — **emergent** behaviour parameterised by the graph + weather | UE (behaviour trees / utility AI); prototyped in a 2D inspector first |

**Why the split is non-negotiable:** an LLM cannot drive per-frame movement —
latency, cost, and nondeterminism make it impossible. The LLM sets the stage
and the rules; the deterministic sim plays them out. This is the standard
directed game-AI separation.

### The relationship graph IS the "memory graph"

Entities = nodes, relationships = typed edges (`stalks`, `flees-from`,
`herds-with`, `drinks-at`, `territory-of`), dispositions = node/edge state.
This authoritative **world-model graph** — structured, deterministic, on our
own world-time axis — is what `WorldMemoryStore` becomes. It is **not**
Graphiti: Graphiti builds graphs by LLM-extracting *unstructured* episodes,
whereas our world state is authoritative and known (we *command* that the lion
stalks the buffalo; we don't infer it from text).

**Graphiti's real home** is one tier up — the director's **semantic / episodic
memory** ("this user favours predators", "last session a drought thinned the
herd"): fuzzy context the LLM reads to make better creative choices. Deferred
until an LLM/embedder key is available (verified 2026-06-02: Graphiti requires
a graph backend — Kuzu runs embedded, no server — plus an LLM + embedder for
ingestion).

### Director contract — `SceneSpec` (✅ locked 2026-06-02)

We chose a **scene-level** director contract over incremental mutation tools.
Rather than the LLM emitting a stream of `SpawnEntities` / `SetRelationship`
calls, the **ecologist emits one whole `SceneSpec`** — the species that belong,
their typed relationships, dispositions and weather — which the deterministic
sim then runs. This is far more reliable for an LLM (one structured object,
validated once) and keeps the LLM doing *semantics*, not numeric layout
(`buildWorld` places everything deterministically).

`SceneSpec` is now a **canonical, generated contract** (R4): the Zod schema in
`@yellow-ue/world-model` is emitted to `schemas/scene-spec.schema.json` and
vendored to the Python brain, which validates its own output against it.

- `species[]` — `species`, `kind` (animal/plant/vehicle/feature), `diet`
  (predator/prey/none), `count`, `maxSpeed`, `radius`, `color`.
- `relationships[]` — typed edges: `stalks` / `flees-from` / `herds-with` /
  `drinks-at` / `disturbs`.
- `weather` — preset, temperature (0–1), timeOfDay (0–24).

**Later (not yet needed):** incremental in-session mutation tools
(`SetRelationship`, `SetDisposition`, `SetBehaviourModifier`) for the LLM to
*adjust* a live world rather than re-populate it. Deferred until the director
needs mid-session edits.

### Next concrete step (inspector-first) — ✅ SHIPPED 2026-06-02

The biggest *new* risk is the **believability of emergent behaviour** — and it
has nothing to do with UE or GPUs. So we built a **2D top-down ecosystem-sim
inspector page** (page **08**, `@yellow-ue/world-model`): entities as dots, a
watering hole, a live weather state; a deterministic per-tick sim runs the
behaviours; you watch lions stalk, prey scatter, heat pull the herd to water,
and a sated lion rest. What landed:

- **`@yellow-ue/world-model` package** — `Entity` / `Relationship` (typed edges:
  `stalks`/`flees-from`/`herds-with`/`drinks-at`/`disturbs`) / `Weather` /
  `SceneSpec` (Zod-validated), `InMemoryWorldModel` store, and a pure,
  **seedable** `stepWorld(state, dt, rng)` behaviour sim.
- **Two-tier in practice** — director mutations (`loadScene`, `setWeather`) are
  `boundary`-traced (R3); the 60 Hz `step` is intentionally untraced.
- **6 behaviour tests** lock the rules: prey flees, a sated predator rests,
  thirst pulls grazers to water under heat, same-seed determinism, in-bounds,
  R3 tracing.

#### Follow-up — the LLM actually infers the ecosystem (✅ SHIPPED 2026-06-02)

The first cut populated page 08 from a hand-authored scene via keyword lookup.
Now the **LLM genuinely reasons the scene from a vague prompt**:

- **`Ecologist` boundary** (`@yellow-ue/world-model`, R2): `populate(prompt) →
  SceneSpec`. `MockEcologist` is the keyless stand-in; `BrainHttpClient`
  (`@yellow-ue/llm-brain/http`) is the live implementation of the *same*
  interface.
- **Python brain `/populate`** — an `Ecologist` over the provider abstraction.
  `GeminiProvider.populate` uses **Gemini structured output** bound to a
  sanitized scene-spec schema (the model decides species, counts,
  relationships, weather); `FakeProvider.populate` gives keyless biome tables
  (savanna / forest / meadow) for offline/CI.
- **Schema-driven defaults + validation** — the brain fills defaults straight
  from the generated artifact and validates against it before returning (R4).
- **Page 08 mock ↔ live (Gemini) toggle** — shows the director's reasoning,
  the active model, and surfaces brain errors. Cross-process spans fold into
  the Pipeline Trace Viewer (R3).
- **Tests:** Python 14 passed (incl. `/populate` + Fake parity); TS llm-brain
  23 (incl. `populate`). Live `/populate` smoke verified end-to-end with the
  Fake provider.

**Live Gemini path — ✅ VERIFIED 2026-06-02 (`gemini-2.5-flash`).** With a
`GOOGLE_API_KEY` in `packages/brain/.env` (auto-loaded), a real `/populate` for
*"a misty mangrove swamp at dawn with crocodiles and wading birds"* returned a
schema-valid scene: crocodile (predator) `stalks` wading bird (prey), birds
`herd-with` themselves, both `drink-at` swamp water, mangroves scattered, dawn
weather. This confirms the model name, that Gemini's structured output survives
the schema sanitizer, and that the relationships come back in the exact shape
the sim consumes. Without a key the brain auto-falls back to the Fake ecologist.

Whatever rules survive become the spec UE's behaviour trees implement in
Phase 2 Track D.

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

   > **Correction (2026-06-02, verified against the live Graphiti README):**
   > Graphiti builds its graph by **LLM-extracting unstructured episodes** and
   > requires an LLM + embedder (Kuzu can serve as an embedded, server-less
   > backend). That is the wrong tool for *authoritative* world state, which we
   > *command* rather than infer. The authoritative world state is reframed as a
   > structured **relationship graph** (`WorldMemoryStore`); Graphiti is moved up
   > a tier to the director's **semantic memory**. See `## World model`.

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

- [x] **01** Prompt → Tool Calls (mock LLM client) ✅ 2026-06-01
  - New package `@yellow-ue/llm-brain`: `LLMClient` interface (R2) + `MockLLMClient` (deterministic, rules-based)
  - Mock keyword-maps prompts to `WorldAPICall[]` (sky / time / trees), reusing `WorldAPICallSchema` from world-api (R4); validates its own output
  - `complete()` boundary-wrapped as `llm-brain.complete` (R3); 17 tests pass
  - Page 01 is a live prompt bench: type a prompt → see tool calls, reasoning, tokens, finishReason, boundary latency. Example-prompt chips included.
  - Note: real brain is Python (LangGraph) in Phase 2 Track A; the TS side gains `BrainHttpClient implements LLMClient` then — page 01 swaps mock→http with no other change
- [x] **02** World State Graph (mock Graphiti store) ✅ 2026-06-01
  - New package `@yellow-ue/memory-graph`: `WorldMemoryStore` interface (R2) + `MockWorldMemoryStore` (in-memory **bitemporal** log on the world-time axis)
  - Overwrite semantics: writing a new fact for the same `(entityId, type)` closes the prior one (`validTo`) and records `invalidates`; `snapshotAt(t)` returns facts valid at world-time `t`
  - `seedDemoWorld()` fixture gives a scrubable timeline (sky clear→storm→sunset, oaks seedling→sapling→mature); `write`/`read`/`snapshotAt`/`history` boundary-wrapped (`memory-graph.*`)
  - Page 02: world-time slider → snapshot of valid facts + a gantt-style validity-span timeline with a playhead. Real Graphiti adapter lands in Phase 2 Track B with the same interface.
- [x] **03** World API Mock Bench (in-memory fake UE) ✅ 2026-06-01
  - `MockWorldAPIClient` from `@yellow-ue/world-api/mock`; live bench to call `SetSkyState`/`AdvanceTime`/`SpawnTrees` and watch in-memory world state mutate
- [x] **04** RC Round-Trip (mock RC transport, real wire format) ✅ 2026-06-01
  - New package `@yellow-ue/rc-bridge`: `RCBridge` interface (R2) + `MockRCBridge` + `toRCFunctionCall` mapping (WorldAPICall → RC function call)
  - Produces the exact UE Remote Control wire request (`PUT /remote/object/call`), simulates latency (jitter 80–160ms) and failures; `rc-bridge.*` boundary-wrapped
  - ✅ Wire format **verified against the live UE 5.7 Remote Control HTTP reference** (2026-06-02) and proven against a running engine in Spike 1b — `MockRCBridge` and the real `HttpRCBridge` share this contract
  - Page 04: pick a tool call → see the wire request → send → response + latency log; failure-simulation toggle
- [x] **05** PCG Inspector (mock PCG output) ✅ 2026-06-01
  - New package `@yellow-ue/pcg`: `PCGRunner` interface (R2) + `MockPCGRunner` (seeded deterministic disk scatter) + `spawnTreesToPCGRequest` mapping
  - Same seed ⇒ same point cloud; scale tracks growth stage; `pcg.run` boundary-wrapped
  - Page 05: parameter sliders (count/radius/seed/species/growth) → top-down SVG scatter + first-8 point dump. Real UE PCG runner lands in Phase 2 Track D.
- [x] **06** Streaming Diagnostics (mock metrics) ✅ 2026-06-01
  - New package `@yellow-ue/streaming`: `StreamingMetrics` interface (R2) + `MockStreamingMetrics` (synthetic samples wandering around 8Mbps / 60fps / 35ms RTT)
  - `connect()` is the traced boundary (`streaming.connect`, models WebRTC negotiation); the per-sample `subscribe()` stream is telemetry, **deliberately not traced** (the one boundary where request/response `boundary()` doesn't fit — documented in the package)
  - Page 06: live sparklines (bitrate / FPS / RTT / packet loss) with threshold coloring + pause/resume. Real `RTCPeerConnection.getStats()` adapter lands in Phase 3.

**Phase 1 complete ✅ 2026-06-01** — all seven inspector pages live against real package boundaries (R1), 94 tests green, inspector builds + typechecks clean.

### Phase 2 — Real implementations (four parallel tracks)

| Track | Owner-of-attention | Tasks | Status |
|---|---|---|---|
| **A** Brain | Python | LangGraph agent, LLM client adapter, tool router, Postgres checkpointer | ✅ core done 2026-06-01 (checkpointer deferred) |
| **B** Memory | TS + Python | **Reframed 2026-06-02.** ✅ Authoritative `WorldModel` relationship graph + deterministic behaviour sim (`@yellow-ue/world-model`); ✅ **`SceneSpec` director contract locked & generated** (R4); ✅ **LLM ecologist** (`Ecologist` boundary + brain `/populate`, Gemini structured output, Fake fallback) so a vague prompt infers the whole scene; ✅ **page 08** with mock↔live toggle; ✅ **live Gemini path verified** end-to-end (`gemini-2.5-flash`). Remaining: referential-integrity check on LLM scenes (warn/repair when a relationship names a missing species); Graphiti → director's *semantic* memory, later. See `## World model`. | 🟢 ecologist shipped & Gemini-verified |
| **C** Bridge | TypeScript | `rc-bridge` HTTP client implementing `RCBridge` | 🟢 **Done 2026-06-02** — `HttpRCBridge` (real `fetch` transport, `PUT /remote/object/call` + `/property`) + a `tsx` CLI (`ping`/`sky`/`call`). Wire format **verified against the live UE 5.7 Remote Control HTTP reference**. WS transport not needed yet. |
| **D** UE | C++/Blueprint | Packaged UE 5.7 build with: Pixel Streaming 2, Remote Control, `WorldDirector.SetSkyState`, (PCG later) | 🟢 **Spikes 1a + 1b PROVEN 2026-06-02** — (1a) headless cook+package in `dev-5.7` container → streamed to browser from a GCP **T4** (L4 capacity-exhausted; L4 perf/cost deferred); (1b) drove `WorldDirector.SetSkyState` live over Remote Control via the rc-bridge CLI through an SSH tunnel — sun rotates in-stream. See `ue/README.md`. |

Each track replaces a mock from Phase 1 with the real thing. **Inspectors continue to work throughout — they're the integration test.**

#### Track A — Brain ✅ 2026-06-01

- **R4 contract codegen**: `pnpm --filter @yellow-ue/llm-brain codegen` emits the Zod contracts → JSON Schema (`packages/llm-brain/schemas/` + vendored into `packages/brain/src/brain/_schemas/`). The gen step also runs on every `pnpm test`, so the cross-language contract can't drift. **Python never hand-maintains a parallel contract — it validates against the generated artifact.**
- **`packages/brain` (Python, uv, 3.12)**: `LLMProvider` Protocol + `FakeProvider` (deterministic, mirrors the Phase 1 mock — tests need no key) + `GeminiProvider` (real, lazy-imported, `--extra gemini` + `GOOGLE_API_KEY`). LangGraph agent (`plan → assemble`) validates its output against the generated schema. FastAPI `POST /complete` → `{ result, spans }`, `GET /health`.
- **Cross-process tracing (R3)**: a Python `@boundary` shim emits BoundaryEvents byte-compatible with the TS shape; the service returns its spans, and `BrainHttpClient` re-parents them (`brain:*`) under `llm-brain.complete` — so page 07 shows TS → HTTP → Python agent → provider in one tree.
- **`BrainHttpClient implements LLMClient`** (`@yellow-ue/llm-brain/http`): page 01 gained a **mock ↔ live brain** toggle; flipping to "live brain" POSTs to `http://localhost:8000` with zero other changes (R2 proven end-to-end).
- **Verified**: 99 TS tests + 10 Python tests green; inspector builds + typechecks clean; live service smoke-tested (`uv run python -m brain` → real `/complete` round-trip).
- **Deferred**: LangGraph Postgres checkpointer (durable multi-turn) and wiring the brain to read world state from Track B's memory store. (Real Gemini call ✅ verified 2026-06-02 with `gemini-2.5-flash`.)

Run the brain: `cd packages/brain && uv sync && uv run python -m brain` (FakeProvider by default; no key needed).

### Phase 3 — GCP infrastructure

**Quota status (verified 2026-06-01):** Project `task-assistant-project` in
`us-central1` has 16 on-demand + 16 preemptible `NVIDIA_L4_GPUS` already
approved. No quota request needed for MVP.

**Important distinction:** the existing Cloud Run GPU L4 quota (used by
hy-motion) is a *separate* quota system from Compute Engine GPU. Both are
in place. Pixel Streaming uses Compute Engine GPU (G2 series), not Cloud
Run GPU, because Cloud Run's 60–120s cold starts and per-request lifecycle
are wrong shape for persistent UE streaming sessions.

- [x] GCE instance provisioning script (`ue/gcp/provision-l4.sh`, `GPU=l4|t4`, spot/on-demand, firewall) — proven on T4 (L4 capacity-blocked)
- [x] NVIDIA driver setup (GCP `cuda_installer.pyz` via `ue/gcp/startup.sh`) — Vulkan loader (`libvulkan1`) TBD-verify on next run
- [x] UE build deployment to instance (headless `dev-5.7` container build, `ue/build/build-in-container.sh`)
- [x] Signalling server + Pixel Streaming frontend (`ue/run/run-stream.sh` → PixelStreamingInfrastructure UE5.7 Cirrus)
- [x] Firewall rules for WebRTC (`provision-l4.sh`: 80/443/3478/5349/UDP 49152-65535) — Remote Control ports for Spike 1b
- [ ] Domain + HTTPS for the web client
- [ ] **L4 perf/cost benchmark** (deferred — ran Spike 1a on T4 due to L4 stockout)

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

> **Mechanism proven (Spike 1b, 2026-06-02):** prompt-free, the chain
> *HTTP → `WorldDirector.SetSkyState` → world mutates → next streamed frame*
> works end-to-end. What's left for Phase 4 is wiring the **brain** to the
> bridge (so a *prompt* drives it) and pointing the **production web app** at
> the stream. See below.

---

## Remaining for the savanna vision

Decision (2026-06-02): **build a believable scene first, add characters/animals
later.** This aligns with what UE 5.7 actually provides (below).

### What UE 5.7 can and can't generate (verified 2026-06-02, UE 5.7 GA'd 2025-11-12)

| Need | UE 5.7 native capability | Verdict |
|---|---|---|
| Terrain, biome scatter, rocks/clutter | **PCG** (Procedural Content Generation) — production-ready; runtime Blueprint-callable, GPU-accelerated | ✅ engine-native |
| Trees / plants (authoring the mesh itself) | **Procedural Vegetation Editor** (Experimental) — node-graph custom plants, export static/skeletal, Nanite Foliage + procedural wind | ✅ engine-native (experimental) |
| Human characters | **MetaHuman Creator** — in-editor, now on **Linux**/macOS, Python/Blueprint batch API | ✅ humans only |
| Lighting / materials fidelity | MegaLights (Beta), Substrate (production-ready), Lumen/Nanite | ✅ |
| **Animals (lion, zebra, birds), vehicles (jeep)** | **none** — no creature generator, no native text-to-3D (the new "AI Assistant" is a coding helper, not a mesh generator) | ❌ must come from a pre-rigged catalog |

So: the **environment** is fully covered by the engine; **animals/vehicles are
not** and require imported, rigged, animated assets. Hence scene-first.

### Ordered remaining work

1. **[next] Editor on the GPU VM (de-risk asset/PCG authoring)** — headless
   cooking gave us primitives; PCG graphs, PVE vegetation, and asset import need
   the **UE Editor** running on the VM over a remote desktop (VNC/RDP) or an
   automated import pipeline. This is the gate to everything visual.
2. **Believable savanna scene (no animals yet)** — landscape terrain, PCG
   ground scatter, PVE acacia/grass with Nanite Foliage + wind, Substrate
   ground materials, the existing dynamic sky, MegaLights. Target: a scene that
   *reads* as a savanna at golden hour.
3. **`BuildWorld(SceneSpec)` verbs in UE** — extend `WorldDirector` beyond
   `SetSkyState`: spawn-by-`SceneSpec` (vegetation via PCG, features like the
   watering hole), `AdvanceTime`. Reconcile the `world-api`/`world-model`
   contracts with the real C++ signatures (the preset-vs-floats mismatch noted
   in `## World model`).
4. **Brain → bridge wiring** — connect the Python ecologist `/populate` →
   `SceneSpec` → `rc-bridge` → `BuildWorld`, so a vague prompt populates the 3D
   scene (both halves already exist and are tested in isolation).
5. **Authoritative world state** — persist `WorldMemoryStore` so the scene has
   memory across prompts and world-time.
6. **Characters & behaviour (deferred)** — import a pre-rigged animal catalog +
   a jeep; port the page-08 behaviour sim (stalk/flee/herd/drink/rest) to UE
   behaviour trees + navmesh; Chaos Vehicle for the jeep.
7. **Productionize** — point the production web app at the stream; domain +
   HTTPS; L4 perf/cost benchmark when capacity returns.

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
