# Step 6 — Brain → creatures, then the behaviour tier

_Planned 2026-06-04, progress updated 2026-06-05. Companion to
[TASKS.md](./TASKS.md); this is the focused work plan for connecting the LLM
brain to the live creature system and the ecosystem that follows._

## Progress at a glance (2026-06-05)

| Item | Status | Note |
|---|---|---|
| 6.1 WorldAPI contract (creature verbs) | ✅ done | verbs + runner-only `Wait`/`WaitForArrival` in `contract.ts`, mock + codegen |
| 6.2 rc-bridge mapping → CreatureDirector | ✅ done* | registry in `creatures.ts`; path via constant + `RC_CREATURE_PATH`/`--creature-path` override (not yet a stable in-map tag) |
| 6.3 Read-back / perception | ✅ done | `QueryCreature(s)` RC verbs return live JSON (`thirst`/`fatigue` included); `arrived`/`atWater`; bridge `perception.ts` + `drainEventLoop`; `WaitForArrival` polls until arrived. **Verified live.** |
| 6.4 LangGraph: NL → live scene | ✅ fake / ⚠ Gemini | `plan.py` + `scene.sh` + `runPlan`; proven end-to-end with the FakeProvider. Gemini path no longer trips 6.5 (sky fixed); Gemini still needs a real-key smoke test |
| 6.5 Reconcile (sky/time, SceneSpec) | ✅ done | `WorldDirector` baked into the savanna map (`add_worlddirector.py` + `ADD_WORLDDIRECTOR` build flag); mapping fixed (`SetSkyState`→`SetWeatherPreset`, `AdvanceTime`→`SetTimeOfDay`); runner `--keep-going`. **`sunset` verified live on savanna.** `SceneSpec`↔verbs still to reconcile (next installment) |
| 6.6 Minimal drives substrate (brought forward) | ✅ done | `ASceneCreature` thirst/fatigue evolve + thin utility layer (graze → seek water → drink → rest); `SetCreatureDrive` seeds from prompt/brain; director orders suspend autonomy. **Verified live** on streamed savanna. |
| 6.7 Event channel + observability UI | ✅ done | `DrainEvents` RC verb + `rc-bridge` `drainEventLoop`; `FocusCamera`/`StopFocus`/`FocusHerdOverview`; custom PS2 frontend (drives panel, default UI hidden); `AStreamBridge` pushes `QueryCreatures` ~2 Hz. |
| 6.8 Demo mode | ✅ done | `demo_herd.sh` (20 adults + 3 calves) + `run-stream.sh` `DEMO=1` default; follow-cam on `a01` at boot. Shoreline/collision fixes + west-bank home in cook (2026-06-05). |

End-to-end **is live**: `scene.sh "…sunset…drinks"` → brain plan → `rc-bridge run`
→ herd spawns, migrates, and drinks **on perceived arrival** (`WaitForArrival`),
with `sunset` applied to the savanna sky. The chain runs locally over the SSH RC
tunnel to the VM, as decided.

**Findings since planning (feed the behaviour tier):**

- **Shoreline stop must be lake-gated, not Z-only.** A global
  `groundZ <= waterZ` halt fires on *any* terrain below the waterline — including
  cliffs 1+ km from lake2. Fix: `SetWaterSource(X,Y,Z,Radius)` + path to the
  **nearest rim point** (not lake centre) + only `atWater` when planar distance
  to the lake centre is within the spline radius. Demo home moved to dry ground
  just west of the visible bank (`445000,626000`).
- **PlayerStart ≠ herd.** `add_water_lake.py` places the stream spawn over the
  lake centre; the demo herd grazes hundreds of metres away. **Follow-cam**
  (`FocusCamera`) at demo boot is required for a sensible first frame; free-fly
  starts over empty water unless the user flies to the herd.
- **NL prompts today = shell only.** `scripts/scene.sh "<prompt>"` (brain →
  rc-bridge → RC). The PS2 overlay is receive-only (drives panel). A prompt box
  in the stream UI needs a thin HTTP wrapper around `scene.sh` — not engine work.
- **Sane fly-cam defaults** (40 m/s cruise, 400 turbo, half mouse-look) are
  **baked into the build**; `FocusCamera` / `FocusHerdOverview` / `StopFocus`
  are first-class RC verbs on `CreatureDirector`.

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

6.1–6.5 + the **minimal drives substrate** (6.6), **event/UI/demo** slice (6.7–6.8)
landed. Next: Gemini real-key smoke test, `SceneSpec`↔verb reconcile, full
ecosystem expansion (remaining drives/reflexes/relationships), stream UI prompt
box, cook/stream map guard (infra fix below).

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

## Active infra fix (happened twice — 2026-06-05)

**Cook/stream map mismatch** — running `build-in-container.sh` on the VM *without*
`MAP=…` packages **`/Game/Maps/Spike`** (the script default) while `run-stream.sh`
opens **`Landscape_1`** (its default). Symptom: stream segfaults on boot with
`Failed to load package … Landscape_1`; the pak is tiny (~10 MB) and the savanna
is missing. Easy to trigger when kicking off a cook from tmux/SSH and forgetting
`YELLOW_MAP` / `MAP=… SKIP_MAKE_MAP=1`.

- [ ] **Permanent fix (do not skip):**
  1. **Align defaults** — `build-in-container.sh` default `MAP` must match
     `run-stream.sh` `STREAM_MAP` (savanna `Landscape_1`), or the build must
     **fail fast** if they diverge.
  2. **Guard in `build-in-container.sh`** — before cook: echo resolved `MAP`, and
     abort (or require `FORCE_SPIKE=1`) when `MAP` is Spike but
     `STREAM_MAP`/`YELLOW_MAP` env points at the savanna.
  3. **Guard in `vm.sh` / npm scripts** — `ue:build` always threads
     `YELLOW_MAP` → remote `MAP` + `SKIP_MAKE_MAP=1` (already there; document
     that bare SSH cooks are unsafe).
  4. **Post-cook verify** — script step that asserts the pak contains
     `Landscape_1` (or `UnrealPak -List` grep) before declaring success.
  5. **Runbook note** — never `bash ~/ue/build/build-in-container.sh` on the VM
     without `MAP=/Game/8KSavannahLandscapePack/Scenes/Landscapes/Landscape_1
     SKIP_MAKE_MAP=1` (or `npm run ue:build` with `YELLOW_MAP` set).

Until this lands, **every manual cook on the VM needs the savannah `MAP` env** or
the stream will look fine in logs but crash when a browser connects.

---

## Prerequisites before the ecosystem (easy to miss)

- [x] **Read-back loop (6.3)** — **done.** `QueryCreature(s)` + `WaitForArrival`
  give the LLM/sim live state to act on.
- [x] **Entity addressing** — id ↔ actor in the `CreatureDirector` registry now
  **exposed back** via `QueryCreature(Id)` for perception.
- [x] **Event/tick channel** — **done (substrate).** `CreatureDirector::DrainEvents`
  buffers transitions (`arrived`/`atWater`/`thirsty`/`tired`/`seek_water`/…);
  `rc-bridge` `drainEventLoop` is the brain-side seam. `WaitForArrival` still polls
  for scripted plans; the slow LLM loop should **drain + react** next.
- [x] **Observability** — **done (camera).** `FocusCamera(Id)` follow-cam,
  `FocusHerdOverview` wide static shot, `StopFocus` free-fly. Screenshot verb still
  open.
- [x] **World clock** — `AdvanceTime`/`SetTimeOfDay` already exist.

---

## NEXT INSTALLMENT — Drives/Primitives ecosystem (partially started 2026-06-05)

Zoology-grounded. Start minimal; expansion = LLM data, **no engine code**.
Architecture = drive/utility **core** + thin **reflex** layer (mirrors ethology:
slow motivation + fast reflex), with the **LLM authoring all the content**.

**Brought forward early** (so the stream demo and drives panel show real behaviour):

- [x] **Fast tier (minimal)** — `ASceneCreature` **thirst + fatigue** evolve per
  tick; utility layer chooses graze / seek water / drink / rest when idle;
  `SetCreatureDrive` + `SetCreatureAutonomy` RC verbs; `bExplicitOrder` suspends
  autonomy for director/brain choreography. Query JSON includes `thirst`/`fatigue`.
- [x] **Stream observability** — custom PS2 frontend (`player.html`/`player.ts`):
  default UI hidden, top-right drives panel fed by `AStreamBridge` +
  `SendPixelStreaming2Response`. Deploy via `deploy_frontend.sh`.
- [x] **Demo mode** — `demo_herd.sh` + `run-stream.sh` `DEMO=1`; seeds drives from
  the scene (staggered thirst → procession to water); follow-cam on `a01`.
- [x] **Creature locomotion** — `ACharacter` + `UCharacterMovementComponent`
  (UE swept movement, terrain + pawn blocking). Replaces kinematic lerp (2026-06-05).
- [x] **Camp lake + water colour** — visual lake at `(445000,626000)`; default
  `WATER_TINT=0` restores raw UE water material.
- [x] **Stream camera UI** — PS overlay: free fly / follow / overview + per-creature
  follow via `emitUIInteraction` → `AStreamBridge`.

**Still open** (original full ecosystem scope):

- [ ] **Fast tier (full)** — extend drive vector to hunger, fear, social (~5 drives);
  more actions (flee, stalk, herd-with, …).
- [ ] **Reflex layer** — threshold triggers (e.g. flight-initiation distance) for
  genuinely binary responses.
- [ ] **Relationships as data** — predator/prey/herd (`stalks` / `flees-from` /
  `herds-with`); vocabulary already in `SceneSpec`.
- [ ] **LLM authors the content** — per-species drives, relationships, parameters,
  reflexes set via verbs; LLM **re-tunes** via the slow director loop (`DrainEvents`).
- [ ] **Stream UI prompt box** — thin HTTP API wrapping `scene.sh` / `brain.plan` +
  `rc-bridge run` (shell works today; browser needs a backend).
- [ ] **Start scope (remainder)** — lion + relationships; expand from the two-drive
  elephant substrate.

### Why this shape (decided 2026-06-04)

- Pure **rules** are cheap to author but scale badly (arbitration conflicts +
  brittle thresholds). **Drives/utility** cost a one-time substrate but give
  graded behaviour and automatic arbitration, and map directly to ethology.
- It's **not either/or** — real ethology has both motivation *and* reflex, so we
  keep both substrates and let the LLM use whichever fits.
- The LLM is the **ethology knowledge source**; realism is bounded by the engine's
  drive/action vocabulary (an asymptote a small substrate reaches quickly).
