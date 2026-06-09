# `@yellow-ue/pcg`

**The `PCGRunner` boundary — parameterize a PCG graph, get points.**

Procedural Content Generation at runtime is the UE 5.7 feature this whole
project leans on. `SpawnTrees` is, concretely, a PCG graph invocation:
parameters in (area, count, species, growth), generated transforms out.

## Phase status

| Phase | What ships |
|---|---|
| **1 (now)** | `PCGRunner` interface, `MockPCGRunner` (seeded deterministic scatter), `spawnTreesToPCGRequest` mapping |
| **2 Track D** | Real runner triggering a UE PCG graph via Remote Control, returning the engine's generated transforms |

## `MockPCGRunner`

Scatters `count` points uniformly in the area disk using a seeded PRNG
(`mulberry32`). Same seed ⇒ same scatter, so page 05 is reproducible and
the output is inspectable without a running engine. Scale reflects growth
stage (seedling 0.3 → mature 1.0).

```ts
const runner = new MockPCGRunner();
const req = spawnTreesToPCGRequest(
  { tool: "SpawnTrees", args: { area: { center: { x: 0, y: 0, z: 0 }, radius: 10 }, count: 50, species: "oak" } },
);
const result = await runner.run(req);
// result.points = 50 deterministic { position, scale, rotationYaw, attributes }
```

`run` is boundary-wrapped (`pcg.run`) for the Pipeline Trace Viewer (R3).
