# `@yellow-ue/memory-graph`

**The `WorldMemoryStore` boundary — temporal world state.**

The world remembers. A tree planted at world-time 5 is still there at
world-time 100, having grown. The sky was clear, then stormy, then sunset —
and you can ask "what was the sky at t=3?" This package owns that memory.

## Temporal model

Facts carry `validFrom` / `validTo` on the **world-time (hours)** axis — the
axis `AdvanceTime` moves. Writing a new fact for an existing
`(entityId, type)` closes the prior one:

```
SkyState(sky): clear  [validFrom 0,  validTo 2]
SkyState(sky): storm  [validFrom 2,  validTo 14]   invalidates the clear fact
SkyState(sky): sunset [validFrom 14, validTo null] ← currently valid
```

`snapshotAt(t)` returns every fact valid at world-time `t`. That's what the
inspector's time-slider reads.

## Phase status

| Phase | What ships |
|---|---|
| **1 (now)** | `WorldMemoryStore` interface, `MockWorldMemoryStore` (in-memory), `seedDemoWorld` fixture |
| **2 Track B** | Graphiti-backed implementation, same interface; real entity schema + queries |

## Why world-time, not wall-clock

Graphiti is bitemporal (event time + ingestion time). For the MVP the axis
users care about is **world-time** — "show me the world after a week passes."
The interface takes plain numbers (hours) so the real Graphiti adapter can
map them onto its timestamp model later without changing callers.

## Tracing

`write`, `read`, `snapshotAt`, `history` are all boundary-wrapped
(`memory-graph.*`) so memory access shows up in the Pipeline Trace Viewer (R3).
