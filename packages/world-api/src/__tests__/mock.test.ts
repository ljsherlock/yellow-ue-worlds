import { beforeEach, describe, expect, it } from "vitest";
import { MockWorldAPIClient } from "../mock.js";

const fixedNow = () => new Date("2026-06-01T12:00:00.000Z");

let idSeed = 0;
const deterministicId = () => {
  idSeed += 1;
  return `t-${idSeed}`;
};

beforeEach(() => {
  idSeed = 0;
});

describe("MockWorldAPIClient — setSkyState", () => {
  it("transitions sky and reports previous/current", async () => {
    const client = new MockWorldAPIClient({ now: fixedNow });
    const r = await client.setSkyState({ preset: "storm", transition_seconds: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.previous).toBe("clear");
      expect(r.data.current).toBe("storm");
      expect(r.data.transition_seconds).toBe(2);
      expect(r.data.applied_at).toBe("2026-06-01T12:00:00.000Z");
    }
    expect(client.snapshot().sky).toBe("storm");
  });

  it("returns INVALID_ARGS for an unknown preset", async () => {
    const client = new MockWorldAPIClient();
    // @ts-expect-error — intentionally bad input
    const r = await client.setSkyState({ preset: "rainbow" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("INVALID_ARGS");
  });
});

describe("MockWorldAPIClient — advanceTime", () => {
  it("advances and reports envelope", async () => {
    const client = new MockWorldAPIClient({ now: fixedNow });
    const r = await client.advanceTime({ hours: 6 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.previous_world_time_hours).toBe(0);
      expect(r.data.current_world_time_hours).toBe(6);
      expect(r.data.hours_advanced).toBe(6);
      expect(r.data.speed_multiplier).toBe(1);
    }
    expect(client.snapshot().worldTimeHours).toBe(6);
  });

  it("ages trees from seedling → sapling → mature", async () => {
    const client = new MockWorldAPIClient({
      now: fixedNow,
      randomId: deterministicId,
    });
    await client.spawnTrees({
      area: { center: { x: 0, y: 0, z: 0 }, radius: 1 },
      count: 1,
      species: "oak",
      growth_stage: "seedling",
    });
    expect(client.snapshot().trees[0]?.growth_stage).toBe("seedling");

    await client.advanceTime({ hours: 30 });
    expect(client.snapshot().trees[0]?.growth_stage).toBe("sapling");

    await client.advanceTime({ hours: 24 * 7 });
    expect(client.snapshot().trees[0]?.growth_stage).toBe("mature");
  });
});

describe("MockWorldAPIClient — spawnTrees", () => {
  it("spawns N trees with deterministic IDs", async () => {
    const client = new MockWorldAPIClient({
      now: fixedNow,
      randomId: deterministicId,
    });
    const r = await client.spawnTrees({
      area: { center: { x: 100, y: 200, z: 0 }, radius: 5 },
      count: 3,
      species: "pine",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.count).toBe(3);
      expect(r.data.spawned.map((t) => t.id)).toEqual(["t-1", "t-2", "t-3"]);
      expect(r.data.spawned.every((t) => t.species === "pine")).toBe(true);
      expect(r.data.spawned.every((t) => t.growth_stage === "mature")).toBe(true);
    }
    expect(client.snapshot().trees).toHaveLength(3);
  });

  it("rejects count above the safety cap", async () => {
    const client = new MockWorldAPIClient();
    const r = await client.spawnTrees({
      area: { center: { x: 0, y: 0, z: 0 }, radius: 1 },
      count: 999_999,
      species: "oak",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("INVALID_ARGS");
  });
});

describe("MockWorldAPIClient — dispatch", () => {
  it("routes a validated WorldAPICall to the right handler", async () => {
    const client = new MockWorldAPIClient({ now: fixedNow });
    const r = await client.dispatch({
      tool: "SetSkyState",
      args: { preset: "sunset", transition_seconds: 5 },
    });
    expect(r.tool).toBe("SetSkyState");
    if (r.tool === "SetSkyState" && r.result.ok) {
      expect(r.result.data.current).toBe("sunset");
    }
  });

  it("preserves the discriminator across all tools", async () => {
    const client = new MockWorldAPIClient({
      now: fixedNow,
      randomId: deterministicId,
    });

    const sky = await client.dispatch({
      tool: "SetSkyState",
      args: { preset: "clear", transition_seconds: 5 },
    });
    expect(sky.tool).toBe("SetSkyState");

    const time = await client.dispatch({
      tool: "AdvanceTime",
      args: { hours: 1, speed_multiplier: 1 },
    });
    expect(time.tool).toBe("AdvanceTime");

    const trees = await client.dispatch({
      tool: "SpawnTrees",
      args: {
        area: { center: { x: 0, y: 0, z: 0 }, radius: 1 },
        count: 1,
        species: "birch",
        growth_stage: "mature",
      },
    });
    expect(trees.tool).toBe("SpawnTrees");
  });
});
