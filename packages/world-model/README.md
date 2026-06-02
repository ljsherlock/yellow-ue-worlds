# @yellow-ue/world-model

The **authoritative world-model relationship graph** plus the **deterministic
behaviour simulation** that animates it. This is the real Track B: the store the
LLM *director* commands, and the per-tick sim that turns its declared
relationships + dispositions into emergent behaviour.

## Two tiers

1. **Director (occasional, LLM)** — decides *what exists* and *how things
   relate*: spawns species, sets typed relationships (`lion stalks buffalo`),
   tunes dispositions and weather. Emitted as a validated `SceneSpec`.
2. **Behaviour sim (every tick, deterministic)** — `stepWorld(state, dt, rng)`
   reads the relationship graph + weather and produces motion: prey flee
   stalkers, herds stay cohesive, the heat of midday pulls grazers to water, a
   sated lion rests far from the herd, a jeep spooks everything it disturbs.

The sim is **pure and seedable** — same seed, same evolution — so the inspector,
tests, and (later) the UE host all agree frame-for-frame.

## Contract

- `Entity` — id, species, `kind` (animal/plant/vehicle/feature), `diet`
  (predator/prey/none), pos/vel, `hunger`, `alert`, `state`, traits.
- `Relationship` — typed edge: `stalks | flees-from | herds-with | drinks-at |
  disturbs`. Species-level by default.
- `Weather` — preset, `temperature` (0–1), `timeOfDay` (0–24).
- `SceneSpec` (Zod-validated) — what the director emits; `mockEcologist(prompt)`
  is the stand-in until the real brain is wired in.

## Tracing (R3)

Director-level mutations (`loadScene`, `setWeather`) are `boundary`-wrapped.
Per-frame `step` is **not** traced — 60 events/sec would drown the pipeline
(same exception we make for streaming sample subscriptions).

## Inspector

Page **08 — Ecosystem Sim** renders this package live on a canvas.
