# Yellow UE Worlds

An LLM-controlled, real-time, stateful 3D world built on Unreal Engine 5.7,
delivered to the browser via Pixel Streaming. The user types a prompt; an LLM
brain translates intent into world-API calls; Remote Control drives a packaged
UE build on a GPU VM; frames stream over WebRTC.

**Tasks, vision, phase checklist, and savanna roadmap:** [TASKS.md](./TASKS.md)

---

## Run the stream

All commands below use the npm ops wrapper in `ue/` (see
[ue/README.md](./ue/README.md) for env vars, firewall, Docker login, and
`WorldDirector` RC verbs).

**Terminal A — VM + stream** (`cd yellow-ue-worlds/ue`)

```bash
npm run ue:status          # RUNNING? note NAT_IP
npm run ue:up              # start VM if TERMINATED
npm run ue:stop-app        # kill stale UE + signalling (clean restart)
npm run ue:run:rc          # stream packaged build + Remote Control (:30010)
npm run ue:open            # browser → http://<NAT_IP>
```

After a code change on your Mac: `npm run ue:sync` then `npm run ue:build`
(~10–15 min), then `stop-app` + `run:rc` again. Skip sync if nothing local changed.

Stop GPU billing when done: `npm run ue:down`

If `ue:status` / `ue:sync` **hang on gcloud** (API slowness), the ops scripts use a
cached IP in `ue/.vm-ip` and **direct SSH** instead (fast). After `ue:up`, the cache
updates; or set the IP manually. Force the slow API path: `UE_FORCE_GCLOUD=1 npm run ue:status`.

**Terminal B — RC from your Mac** (optional; only if driving the scene via
`packages/rc-bridge`)

```bash
cd yellow-ue-worlds/ue
npm run ue:rc-tunnel       # blocks: localhost:30010 → VM:30010
```

```bash
cd ../packages/rc-bridge
pnpm cli -- ping
pnpm cli -- time --hours 12    # if scene is dark on first load (until BeginPlay bakes this in)
# avoid: pnpm cli -- camera --view aerial   # locks WASD to static camera
```

**Terminal C — watch**

Open the Pixel Streaming page (Terminal A `ue:open` or `http://<NAT_IP>`). WASD +
mouse move the default pawn unless `SetCameraView` was called over RC.

---

## Architecture

### End-to-end pipeline

```
Browser (WebRTC client + control surface)
   ↑   rendered frames ↓ / input + prompts ↑
   │
GPU streaming host (GCP G2 + NVIDIA L4 / T4)
   ├─ UE 5.7 packaged build
   │     ├─ Pixel Streaming 2 plugin           (WebRTC video out)
   │     └─ Remote Control plugin              (HTTP :30010 / WS :30020 in)
   ↑    HTTP/WS function calls + property writes
   │
LLM brain process (own service)
   ├─ LangGraph agent
   ├─ World-model graph (authoritative; Graphiti for semantic memory later)
   └─ Tool surface → Remote Control / WorldDirector
```

### De-risking findings (verified 2026-06-01)

Checked against live primary sources, not search summaries.

1. **Memory** — LangGraph + durable checkpointer (deferred). Authoritative world
   state is a structured relationship graph (`WorldMemoryStore`), not Graphiti
   episode extraction. Graphiti fits director semantic memory later.

2. **UE control** — Remote Control (HTTP :30010) in packaged builds with
   `-RCWebControlEnable`. **PCG is production-ready in UE 5.7** — runtime
   Blueprint-callable; key enabler for procedural worlds.

3. **Browser** — Pixel Streaming only viable path for UE 5.7 + Lumen/Nanite/PCG
   (HTML5 forks and WebGPU ports ruled out; see TASKS.md).

4. **GPU cloud** — GCP G2 + L4 ($0.85/hr on-demand); T4 used for spikes when L4
   capacity-blocked. L4 has hardware AV1.

### What we explicitly chose NOT to do

| Choice | Why rejected |
|---|---|
| UE 4.27 HTML5 forks | No UE5 features |
| SimplyStream WebGPU | Nanite/Lumen degraded, Chrome-only |
| Consumer cloud gaming | No arbitrary UE builds |
| AWS over GCP | GCP L4 cheaper + AV1 + TensorWorks GCP guide |
| Immersive Stream for XR | UE 5.3 max, wrong shape |
| Unreal MCP (community) | Editor-time only |

---

## First world-API tools (WorldAPIv1)

Three tools — atmospheric, temporal, procedural-spawn — locked 2026-06-01.
Implemented in `packages/world-api/`; UE surface is evolving via
`WorldDirector` (see `ue/README.md`).

### `SetSkyState(preset, transition_seconds?)`

Presets: `clear` | `cloudy` | `storm` | `sunset` | `night`. Overwrite semantics
in world-memory model.

### `AdvanceTime(hours, speed_multiplier?)`

World-clock entity; other facts get temporal envelopes.

### `SpawnTrees(area, count, species, growth_stage?)`

PCG runtime path (inspector mock today; UE PCG in Track D follow-up).

Contract evolves (`WorldAPIv2` expected); types are generated from
`packages/world-api/` (R4).

---

## Tech stack

| Layer | Choice |
|---|---|
| Engine | UE 5.7 |
| Procedural generation | PCG (built-in) |
| LLM bridge | Remote Control (HTTP + WS) |
| LLM orchestration | LangGraph (Python) |
| World state (authoritative) | Relationship graph / `WorldMemoryStore` |
| Streaming | GCP Compute Engine G2 + L4; Pixel Streaming 2 |
| Web | TypeScript + React |
| Shared types | Zod → JSON Schema → Python (R4) |

---

## Methodology — interface-driven design

- **Interfaces** at package boundaries (TS `interface` / Python `Protocol`).
- **Dependency injection** — inspectors swap fakes without parallel implementations.
- **Composition** over inheritance in TS/Python; thin UE Actors + BP libraries.
- **`@boundary` tracing** (R3) for Pipeline Trace Viewer.

| Layer | Style |
|---|---|
| Brain | LangGraph + Protocols |
| Memory | `WorldMemoryStore` Protocol |
| RC bridge | `RCBridge` adapter |
| UE | OOP (engine); `WorldDirector` as control surface |
| Web | React function components |

---

## Repository structure

```
yellow-ue-worlds/
├── packages/
│   ├── world-api/          LLM tool contract (Zod)
│   ├── world-model/        SceneSpec + behaviour sim
│   ├── brain/              Python LangGraph service
│   ├── llm-brain/          TS client + codegen
│   ├── memory-graph/       WorldMemoryStore
│   ├── rc-bridge/          Remote Control HTTP client + CLI
│   ├── pcg/                PCG runner (mock)
│   ├── streaming/          Metrics (mock)
│   └── tracing/            boundary()
├── ue/                     GPU VM ops + YellowWorld UE project
│   └── project/YellowWorld/
├── apps/
│   ├── web/                production (future)
│   └── inspector/          dev pages 01–08
├── infra/
├── TASKS.md                vision, status, phases, roadmap
└── README.md               this file
```

---

## Inspector-first development

Build inspector pages **before** production wiring; same interfaces, mock
injections (R1–R5 in `.cursor/rules/`).

| # | Page | Boundary |
|---|---|---|
| **07** | Pipeline Trace Viewer | All layers (build first) |
| 01 | Prompt → Tool Calls | `LLMClient` |
| 02 | World State Graph | `WorldMemoryStore` |
| 03 | World API Mock Bench | `WorldAPIClient` |
| 04 | RC Round-Trip | `RCBridge` |
| 05 | PCG Inspector | `PCGRunner` |
| 06 | Streaming Diagnostics | `StreamingMetrics` |
| 08 | Ecosystem sim (2D) | `world-model` + `Ecologist` |

Run inspector: `cd apps/inspector && pnpm dev`. Run brain:
`cd packages/brain && uv sync && uv run python -m brain`.

---

## Project rules (R1–R5)

| # | Enforces |
|---|---|
| R1 | Inspectors import from `packages/` only |
| R2 | Boundaries are interfaces; DI for implementations |
| R3 | `@boundary` on every boundary call |
| R4 | One contract source; generated TS + Python |
| R5 | New boundary → new inspector page in same PR |

---

## Related projects

- `../yellow-worlds` — earlier web exploration
- `../generative-demos/the-body-field` — prior generative work
- `../hy-motion` — motion retargeting; inspector-first methodology

---

## Source documentation

Verified 2026-06-01 unless noted:

- [UE 5.7 Release Notes](https://dev.epicgames.com/documentation/unreal-engine/unreal-engine-5-7-release-notes?lang=en-US)
- [Pixel Streaming Infrastructure](https://dev.epicgames.com/documentation/en-us/unreal-engine/pixel-streaming-infrastructure)
- [Remote Control for UE](https://dev.epicgames.com/documentation/en-us/unreal-engine/remote-control-for-unreal-engine)
- [TensorWorks Pixel Streaming on GCP (Linux)](https://github.com/TensorWorks/PixelStreamingCloudGuide/blob/main/Guides_UE_5/Pixel%20Streaming%20on%20GCP%20(Linux).md)
- [GCP Compute Engine GPUs](https://cloud.google.com/compute/docs/gpus)
- [LangGraph](https://github.com/langchain-ai/langgraph)
- [Graphiti](https://github.com/getzep/graphiti)
