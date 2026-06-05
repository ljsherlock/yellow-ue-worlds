# Step 6 — Brain → creatures, then the behaviour tier

_Planned 2026-06-04, progress updated 2026-06-05. Companion to
[TASKS.md](./TASKS.md); this is the focused work plan for connecting the LLM
brain to the live creature system and the ecosystem that follows._

## Progress at a glance (2026-06-05)

| Item | Status | Note |
|---|---|---|
| 6.1 WorldAPI contract (creature verbs) | ✅ done | verbs + runner-only `Wait`/`WaitForArrival` in `contract.ts`, mock + codegen |
| 6.2 rc-bridge mapping → CreatureDirector | ✅ done* | registry in `creatures.ts`; path via constant + `RC_CREATURE_PATH`/`--creature-path` override (not yet a stable in-map tag) |
| 6.3 Read-back / perception | ✅ done | `QueryCreature(s)` RC verbs return live JSON; `arrived`/`atWater` flags on `ASceneCreature`; bridge `perception.ts` + `query` CLI; `WaitForArrival` polls until arrived. **Verified live.** |
| 6.4 LangGraph: NL → live scene | ✅ fake / ⚠ Gemini | `plan.py` + `scene.sh` + `runPlan`; proven end-to-end with the FakeProvider. Gemini path no longer trips 6.5 (sky fixed); Gemini still needs a real-key smoke test |
| 6.5 Reconcile (sky/time, SceneSpec) | ✅ done | `WorldDirector` baked into the savanna map (`add_worlddirector.py` + `ADD_WORLDDIRECTOR` build flag); mapping fixed (`SetSkyState`→`SetWeatherPreset`, `AdvanceTime`→`SetTimeOfDay`); runner `--keep-going`. **`sunset` verified live on savanna.** `SceneSpec`↔verbs still to reconcile (next installment) |

End-to-end **is live**: `scene.sh "…sunset…drinks"` → brain plan → `rc-bridge run`
→ herd spawns, migrates, and drinks **on perceived arrival** (`WaitForArrival`),
with `sunset` applied to the savanna sky. The chain runs locally over the SSH RC
tunnel to the VM, as decided.

**Findings since planning (feed the behaviour tier):**

- **Ground trace hits the water surface.** `GroundZ` (WorldStatic line trace)
  returns the lake's collision plane (`-6000`) over the wetted area, so the
  shoreline-stop fires at the *true* near shore — not a lakebed walk-in. lake2 is
  huge (~1.7 km across), so the herd halts ~865 m from centre on the near bank;
  it reads as "stopping short". `herd_start` moved to the midpoint of the
  approach for a shorter, reliable walk-in (data-only, `creatures.ts`).
- **The camera is fully drivable over RC** (no new verb yet): `GetPlayerPawn`
  → set `MaxSpeed`/`CruiseSpeed`; `PlayerController` look scale. Proves read-back
  + actuation of arbitrary actors is feasible over plain RC — useful for 6.3 and
  observability. Sane fly-cam defaults (40 m/s cruise, 400 turbo, half mouse-look)
  are now **baked into the build**.

## Context

The engine creature surface is **live and proven** — `ACreatureDirector` +
`ASceneCreature` + `FCreatureDef`, driven over Remote Control (elephant matriarch
+ trailing calf migrate to lake2 and drink; facing/yaw and shoreline-stop fixed).

Of the original 6-step plan, the engine side (steps 2–5: movement, control
surface, RC verbs, entity registry) is **done**. Step 1 was **substituted** —
single-node clip playback instead of a blendspace AnimBP; an AnimBP can drop in
later with no code change via `ApplyDef`/`AnimClass`. What remains is **step 6**:
connect the brain — and build it to **anticipate** a drives-based ecosystem so the
contract doesn't need re-cutting later.

The relevant packages already exist (`world-api`, `rc-bridge`/`HttpRCBridge`, the
LangGraph brain, a 2D `world-model` behaviour prototype) but were written **before**
the creature verbs existed — so this is mostly **extend + reconcile**, not greenfield.

---

## NOW — Step 6: Brain integration (verbs out **+** state in)

6.1 + 6.2 + 6.3 + 6.4 + 6.5 landed; only the Gemini real-key smoke test and the
`SceneSpec`↔verb reconcile remain (next installment).

- [x] **6.1 WorldAPI contract** — creature verbs added (`spawn_creature`,
  `move_creature_to`/`follow_path`, `set_creature_state`, `set_creature_leader`,
  `wander`, `despawn`/`clear`) + a runner-only `Wait`; `define_creature_type` and
  `set_water_level` are handled as **bridge bootstrap** (registry-derived, not
  brain verbs) so the LLM speaks intent. Schema shaped for drives/relationships later.
- [x] **6.2 `rc-bridge` mapping → CreatureDirector** — `creatures.ts` registry
  (pack facts + landmarks) maps each verb to real RC calls; `runner.ts` injects the
  bootstrap calls per species/landmark. _Caveat:_ `objectPath` resolves via a
  default constant + `RC_CREATURE_PATH`/`--creature-path` override — a **stable
  in-map tag** is still the clean follow-up (no editor-only `GetAllLevelActors`).
- [x] **6.3 Read-back / perception** (the under-rated half, **the gate**) — **done.**
  `CreatureDirector::QueryCreature(s)` return live JSON (`id,type,state,x,y,z,speed,
  arrived,atWater`); `ASceneCreature` now carries `bArrived`/`bAtWater` (set on
  goal/shoreline, cleared on new orders). Bridge: `perception.ts` (`queryCreature(s)Call`
  + parsers), a `query` CLI, and a `WaitForArrival` verb the runner honours by
  **polling until arrived**. Verified live: the drink fires on real arrival, not a
  clock (`#5 wait: matriarch: arrived … atWater=true`).
- [x] **6.4 LangGraph** — verbs + planning prompt registered (`providers.py`),
  one-shot `plan.py`, `scene.sh` wrapper, `runPlan` executor. NL → live scene
  **proven** with the FakeProvider (creature-only prompt); the hand-scripted
  `direct_elephant_scene.sh` is now LLM-emitted. Gemini path wired but see 6.5.
- [x] **6.5 Reconcile** — **done** (both fixes applied): (a) runner `--keep-going`
  (`stopOnError=false`, wired to `scene.sh`) so a stray world-verb never kills the
  scene; (b) a `WorldDirector` is now **baked into the savanna map** via
  `add_worlddirector.py` + the `ADD_WORLDDIRECTOR` build flag — `CacheActors` finds
  the pack's own sun/sky, so `SetWeatherPreset` drives them. Mapping bug also fixed:
  the brain's preset now maps to `SetWeatherPreset` (not the float `SetSkyState`),
  and `AdvanceTime`→`SetTimeOfDay`. `sunset` confirmed live on `Landscape_1`.
  _Remaining:_ `SceneSpec` ↔ creature verbs (next installment).

---

## Prerequisites before the ecosystem (easy to miss)

- [x] **Read-back loop (6.3)** — **done.** `QueryCreature(s)` + `WaitForArrival`
  give the LLM/sim live state to act on.
- [x] **Entity addressing** — id ↔ actor in the `CreatureDirector` registry now
  **exposed back** via `QueryCreature(Id)` for perception.
- [ ] **Event/tick channel** — so the slow LLM loop is triggered by world events,
  not polling. **Still open** (`WaitForArrival` polls; a push channel is the upgrade).
- [~] **Observability** — the camera is now drivable over RC and has sane baked
  defaults (free-cam usable), but a first-class **snap-to / follow-creature** verb
  (and screenshot) is still missing.
- [x] **World clock** — `AdvanceTime`/`SetTimeOfDay` already exist.

---

## NEXT INSTALLMENT — minimal Drives/Primitives ecosystem (NOT now)

Zoology-grounded. Start minimal; expansion = LLM data, **no engine code**.
Architecture = drive/utility **core** + thin **reflex** layer (mirrors ethology:
slow motivation + fast reflex), with the **LLM authoring all the content**.

- [ ] **Fast tier** (UE, per-tick) on `ASceneCreature`: a small **drive vector**
  — hunger, thirst, fear, fatigue, social — + **utility action-selection** over
  existing actions (seek / flee / drink / graze / idle / wander).
- [ ] **Reflex layer** — a thin set of threshold triggers (e.g. flight-initiation
  distance) for genuinely binary responses.
- [ ] **Relationships as data** — predator/prey/herd (`stalks` / `flees-from` /
  `herds-with`); vocabulary already in `SceneSpec`.
- [ ] **LLM authors the content** — per-species drives, relationships, parameters,
  reflexes set via verbs; LLM **re-tunes** via the slow director loop.
- [ ] **Start scope** — ~5 drives, ~8 actions, 3 relationships, 2 species
  (elephant + lion). Expand from there.

### Why this shape (decided 2026-06-04)

- Pure **rules** are cheap to author but scale badly (arbitration conflicts +
  brittle thresholds). **Drives/utility** cost a one-time substrate but give
  graded behaviour and automatic arbitration, and map directly to ethology.
- It's **not either/or** — real ethology has both motivation *and* reflex, so we
  keep both substrates and let the LLM use whichever fits.
- The LLM is the **ethology knowledge source**; realism is bounded by the engine's
  drive/action vocabulary (an asymptote a small substrate reaches quickly).
