import {
  InMemorySink,
  resetTracingForTests,
  setSink,
} from "@yellow-ue/tracing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PCGRunRequestSchema } from "../contract.js";
import { spawnTreesToPCGRequest } from "../mapping.js";
import { MockPCGRunner } from "../mock.js";

let runner: MockPCGRunner;
const area = { center: { x: 0, y: 0, z: 0 }, radius: 10 };

beforeEach(() => {
  resetTracingForTests();
  runner = new MockPCGRunner();
});
afterEach(() => resetTracingForTests());

describe("MockPCGRunner", () => {
  it("generates the requested number of points", async () => {
    const r = await runner.run({ graph: "ScatterTrees", area, count: 50 });
    expect(r.count).toBe(50);
    expect(r.points).toHaveLength(50);
  });

  it("is deterministic for a given seed", async () => {
    const a = await runner.run({ graph: "g", area, count: 5, seed: 42 });
    const b = await runner.run({ graph: "g", area, count: 5, seed: 42 });
    expect(a.points[0]).toEqual(b.points[0]);
  });

  it("differs across seeds", async () => {
    const a = await runner.run({ graph: "g", area, count: 5, seed: 1 });
    const b = await runner.run({ graph: "g", area, count: 5, seed: 2 });
    expect(a.points[0]).not.toEqual(b.points[0]);
  });

  it("keeps points within the area radius", async () => {
    const r = await runner.run({ graph: "g", area, count: 200, seed: 7 });
    for (const p of r.points) {
      const d = Math.hypot(p.position.x - area.center.x, p.position.y - area.center.y);
      expect(d).toBeLessThanOrEqual(area.radius + 1e-9);
    }
  });

  it("scales by growth stage", async () => {
    const seedlings = await runner.run({
      graph: "g",
      area,
      count: 1,
      attributes: { growth_stage: "seedling" },
    });
    expect(seedlings.points[0]!.scale).toBeLessThan(0.6);
  });
});

describe("spawnTreesToPCGRequest", () => {
  it("maps a SpawnTrees call into a PCG request", () => {
    const req = spawnTreesToPCGRequest({
      tool: "SpawnTrees",
      args: { area, count: 30, species: "birch", growth_stage: "sapling" },
    });
    const parsed = PCGRunRequestSchema.parse(req);
    expect(parsed.graph).toBe("ScatterTrees");
    expect(parsed.count).toBe(30);
    expect(parsed.attributes.species).toBe("birch");
    expect(parsed.attributes.growth_stage).toBe("sapling");
  });
});

describe("MockPCGRunner — tracing (R3)", () => {
  it("emits a pcg.run boundary event", async () => {
    const sink = new InMemorySink();
    setSink(sink);
    await runner.run({ graph: "g", area, count: 3 });
    expect(sink.byPrefix("pcg.")).toHaveLength(1);
    expect(sink.events[0]?.name).toBe("pcg.run");
  });
});
