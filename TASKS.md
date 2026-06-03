# Tasks & roadmap

Task tracking, vision, and phase checklists for **Yellow UE Worlds**. Technical
architecture, contracts, and ops commands live in [README.md](./README.md) and
[ue/README.md](./ue/README.md).

---

## Status

| Phase | State | Notes |
|---|---|---|
| Research / de-risking | ✅ Complete (2026-06-01) | See README → De-risking findings |
| Architecture decisions | ✅ Locked | See README → Tech stack |
| First world-API tools | ✅ Locked 2026-06-01 | `SetSkyState`, `AdvanceTime`, `SpawnTrees` |
| GCP L4 quota | ✅ Confirmed 2026-06-01 | 16 on-demand + 16 preemptible in `us-central1`, project `task-assistant-project` |
| Project rules | ✅ Complete 2026-06-01 | R1–R5 in `.cursor/rules/` |
| Monorepo bootstrap | ✅ Complete 2026-06-01 | pnpm 11.5.0 + uv, workspace scaffolded |
| Phase 0 — Foundation | ✅ Complete 2026-06-01 | 52 tests green |
| Phase 1 — Inspector pages 01–07 | ✅ Complete 2026-06-01 | 94 tests green |
| Phase 2 Track A — Brain | ✅ Complete 2026-06-01 | 109 tests green (99 TS + 10 py) |
| **Vision — LLM-directed ecosystem** | 🧭 Adopted 2026-06-02 | See [World model](#world-model-entities-relationships--behaviour) |
| Phase 2 Track B — World model + ecologist | ✅ Shipped 2026-06-02 | `SceneSpec` + behaviour sim + LLM `/populate` |
| Phase 2 Track C — RC bridge | ✅ Done 2026-06-02 | `HttpRCBridge` + CLI |
| Phase 2 Track D — UE on GPU | 🟢 Live 2026-06-03 | Full Tier-1 `WorldDirector` surface + manual exposure; flat ground + Water lake |
| GCP infrastructure | ✅ Core done 2026-06-02 | T4 spike VM; L4 benchmark deferred |
| Water plugin spike (Option A) | ✅ Proven 2026-06-03 | Cooks headless, `WaterBodyLake` spawns in `make_map.py`, streams on T4 |
| End-to-end loop | ⏳ Partial | RC control loop closed; brain→bridge + production app→stream remain |

---

## Vision

> The user gives a prompt. The world becomes that prompt — and remembers it.

- **Stateful environment** — ongoing mutation with persistence (a tree planted
  at t=10 is still there at t=100, having grown).
- **LLM as world author** — procedural params, weather, time-of-day, biomes,
  creatures driven by LLM tool calls.
- **Real-time updates** — continuous motion, not request/response.
- **Browser-delivered** — Pixel Streaming; no client GPU.
- **Living ecosystem** — entities plus **relationships** (predator/prey, herd,
  territory) driving emergent behaviour over world-time.

---

## World model: entities, relationships & behaviour

The core loop is an **LLM-directed ecosystem**. Example: *"a savanna with a
watering hole and a jeep"* → the brain emits a `SceneSpec` (species,
relationships, weather); a deterministic sim plays it out.

### Two tiers — keep the LLM out of the frame loop

| Tier | Cadence | Responsibility | Where |
|---|---|---|---|
| **LLM director / ecologist** | occasional | *what exists*, relationships, dispositions, weather modifiers | brain (LangGraph) |
| **Behaviour simulation** | every tick | flee/stalk/herd/rest/drink — emergent from graph + weather | UE behaviour trees (page 08 prototypes this in 2D) |

### Relationship graph vs Graphiti

The authoritative **world-model graph** (`WorldMemoryStore`) is structured state
we command — not LLM-extracted from text. **Graphiti** is deferred for the
director's semantic/episodic memory ("user favours predators", etc.).

### Director contract — `SceneSpec` (✅ locked 2026-06-02)

One whole `SceneSpec` per populate call (Zod → JSON Schema → Python brain).
`buildWorld` places layout deterministically later.

- `species[]`, `relationships[]` (`stalks`, `flees-from`, `herds-with`,
  `drinks-at`, `disturbs`), `weather`.

### Shipped: page 08 + ecologist (✅ 2026-06-02)

- `@yellow-ue/world-model` — seedable `stepWorld`, 6 behaviour tests.
- Brain `/populate` — Gemini structured output + Fake fallback; page 08 mock↔live.
- **Live Gemini verified** (`gemini-2.5-flash`, 2026-06-02).

**Follow-up:** referential-integrity check on LLM scenes (warn/repair missing
species in relationships).

**Preset mismatch:** `world-api` `SetSkyState` presets vs `WorldDirector`
floats — reconcile when wiring `BuildWorld(SceneSpec)`.

---

## Track D — live control surface (2026-06-03)

`AWorldDirector` + `make_map.py` spawn stock actors (atmosphere sun, sky, fog,
clouds, wind, post-process, camera, procedural ground, **WaterBodyLake**).

Drive live via `packages/rc-bridge` CLI (see `ue/README.md`).

**Exposure:** `AEM_Manual`, baseline **−13 EV**; `SetTimeOfDay` drives sun/sky
lux. **Startup gap:** `BeginPlay` does not yet call `SetTimeOfDay` — fresh
streams need one `time` RC call (or bake `StartHour` in `BeginPlay` + rebuild).

**Caveats:**

- `storm` preset crashes Pixel Streaming on T4 (`CUDA 700` / NVENC) — avoid.
- Flat ground only; no Landscape/PCG vegetation verbs yet.
- `SetCameraView` locks WASD (view targets static camera); no `free` release verb yet.
- `SetCloudiness` is on/off only.

---

## De-risking MVP checklist

Goal: **user prompt → LLM tool call → UE world change → next streamed frame.**

### Phase 0 — Foundation ✅ 2026-06-01

- [x] Monorepo bootstrap (pnpm + uv)
- [x] `.cursor/rules/` R1–R5
- [x] `packages/world-api/` — WorldAPIv1
- [x] `packages/tracing/` — `boundary()`
- [x] `apps/inspector/` skeleton
- [x] Page 07 Pipeline Trace Viewer (mock)

### Phase 1 — Inspector pages ✅ 2026-06-01

- [x] 01 Prompt → Tool Calls
- [x] 02 World State Graph
- [x] 03 World API Mock Bench
- [x] 04 RC Round-Trip (mock wire format)
- [x] 05 PCG Inspector
- [x] 06 Streaming Diagnostics

### Phase 2 — Real implementations

| Track | Status | Notes |
|---|---|---|
| **A** Brain | ✅ core | LangGraph + FastAPI; Postgres checkpointer deferred |
| **B** World model | 🟢 ecologist shipped | Graphiti semantic memory later |
| **C** RC bridge | ✅ | `HttpRCBridge` + CLI |
| **D** UE | 🟢 | Spikes 1a+1b; expanded `WorldDirector`; Water Option A ✅ |

**Track A deferred:** Postgres checkpointer; brain reads `WorldMemoryStore`.

**Track B remaining:** referential integrity on `/populate` scenes.

### Phase 3 — GCP infrastructure

- [x] GCE provision + NVIDIA driver + Docker (`ue/gcp/`)
- [x] Headless build in `dev-5.7` container
- [x] Pixel Streaming + signalling (`ue/run/`)
- [x] Firewall for WebRTC
- [ ] Domain + HTTPS
- [ ] L4 perf/cost benchmark (deferred; spike on T4)

### Phase 4 — End-to-end loop

- [ ] Prompt in production web app → brain → RC → UE → streamed frame
- [ ] Pipeline Trace Viewer shows full live chain
- [ ] Inspector page 04 wired to live RC (not mock)

**Proven (Spike 1b):** HTTP → `WorldDirector` → world mutates → next frame.
**Remaining:** brain → bridge; production app → stream.

---

## Savanna vision — remaining work

**Decision (2026-06-02):** believable scene first; animals later.

### What UE 5.7 can and can't generate (verified 2026-06-02)

| Need | UE 5.7 | Verdict |
|---|---|---|
| Terrain, scatter | PCG | ✅ |
| Plant authoring | PVE (experimental) | ✅ |
| Humans | MetaHuman | ✅ |
| Lighting | Lumen/Nanite/Substrate | ✅ |
| Animals, vehicles | — | ❌ pre-rigged catalog |

### Ordered work

> **2026-06-03:** headless path went further than planned — atmosphere, exposure,
> procedural ground, Water lake all live without the editor.

1. **Editor on GPU VM** — likely gate for PCG graphs, PVE, savanna asset pack;
   deliberately deferred while testing headless limits. 🔄
2. **Believable savanna (no animals)** — 🔄 **Ground:** Megascans **South African
   Slate Quarry** surface (`uddmcgbia`) → `ThirdParty/` + headless import in
   `make_map.py`. Done: sky, exposure, water lake. Next: **Landscape** + water
   dip, PCG scatter, acacia/grass, Substrate.
3. **`BuildWorld(SceneSpec)` in UE** — spawn from `SceneSpec`; reconcile API contracts.
4. **Brain → bridge** — `/populate` → `rc-bridge` → `BuildWorld`.
5. **Authoritative world state** — persist `WorldMemoryStore`.
6. **Characters & behaviour (deferred)** — rigged catalog, behaviour trees, jeep.
7. **Productionize** — production web app → stream; domain/HTTPS; L4 benchmark.

### Deferred / skipped

- Animals & vehicles until scene reads as savanna.
- `storm` preset on T4 until softened.
- Brain → bridge (Phase 4) — not connected yet.
- Production web app → stream; inspector still mostly mock.
- `WorldMemoryStore` persistence.
- Graphiti, Postgres checkpointer, WS RC, multi-tenancy, L4 benchmark.
- True volumetric cloud density.
- `BeginPlay` → `SetTimeOfDay(StartHour)` (no post-up RC for lighting).
- `SetCameraView("free")` to restore WASD after director framing.

---

## Open questions

- [ ] Multi-tenancy: 2–3 UE instances per L4?
- [ ] Warm pool vs 30–90s cold start
- [ ] Session length / pricing model
- [ ] Geographic strategy at MVP
- [ ] Spatial audio over WebRTC
- [ ] UE 5.8 / Remote Control GA
- [ ] WebGPU 64-bit atomics → SimplyStream viability

---

## Related

- [README.md](./README.md) — architecture & contracts
- [ue/README.md](./ue/README.md) — Track D ops, `WorldDirector` verbs, VM scripts
