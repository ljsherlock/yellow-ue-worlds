import { describe, expect, it } from "vitest";
import {
  AdvanceTimeArgsSchema,
  SetSkyStateArgsSchema,
  SpawnTreesArgsSchema,
  WorldAPICallSchema,
  WORLD_API_VERSION,
} from "../contract.js";

describe("WORLD_API_VERSION", () => {
  it("is WorldAPIv1", () => {
    expect(WORLD_API_VERSION).toBe("WorldAPIv1");
  });
});

describe("SetSkyStateArgsSchema", () => {
  it("accepts a valid preset", () => {
    const result = SetSkyStateArgsSchema.safeParse({ preset: "storm" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.preset).toBe("storm");
      expect(result.data.transition_seconds).toBe(5);
    }
  });

  it("applies the default transition_seconds", () => {
    const result = SetSkyStateArgsSchema.parse({ preset: "clear" });
    expect(result.transition_seconds).toBe(5);
  });

  it("rejects an unknown preset", () => {
    const result = SetSkyStateArgsSchema.safeParse({ preset: "rainbow" });
    expect(result.success).toBe(false);
  });

  it("rejects a negative transition", () => {
    const result = SetSkyStateArgsSchema.safeParse({
      preset: "clear",
      transition_seconds: -1,
    });
    expect(result.success).toBe(false);
  });
});

describe("AdvanceTimeArgsSchema", () => {
  it("accepts positive hours", () => {
    const result = AdvanceTimeArgsSchema.safeParse({ hours: 24 });
    expect(result.success).toBe(true);
  });

  it("rejects zero or negative hours", () => {
    expect(AdvanceTimeArgsSchema.safeParse({ hours: 0 }).success).toBe(false);
    expect(AdvanceTimeArgsSchema.safeParse({ hours: -1 }).success).toBe(false);
  });

  it("applies default speed_multiplier of 1", () => {
    const result = AdvanceTimeArgsSchema.parse({ hours: 1 });
    expect(result.speed_multiplier).toBe(1);
  });
});

describe("SpawnTreesArgsSchema", () => {
  const validArgs = {
    area: { center: { x: 0, y: 0, z: 0 }, radius: 10 },
    count: 50,
    species: "oak" as const,
  };

  it("accepts a complete valid call", () => {
    const result = SpawnTreesArgsSchema.safeParse(validArgs);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.growth_stage).toBe("mature");
  });

  it("rejects non-integer count", () => {
    const result = SpawnTreesArgsSchema.safeParse({ ...validArgs, count: 1.5 });
    expect(result.success).toBe(false);
  });

  it("rejects negative radius", () => {
    const result = SpawnTreesArgsSchema.safeParse({
      ...validArgs,
      area: { ...validArgs.area, radius: -1 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects unbounded counts (>10_000)", () => {
    const result = SpawnTreesArgsSchema.safeParse({ ...validArgs, count: 10_001 });
    expect(result.success).toBe(false);
  });
});

describe("WorldAPICallSchema (discriminated union)", () => {
  it("routes a SetSkyState call", () => {
    const result = WorldAPICallSchema.safeParse({
      tool: "SetSkyState",
      args: { preset: "night" },
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.tool).toBe("SetSkyState");
  });

  it("rejects unknown tool names", () => {
    const result = WorldAPICallSchema.safeParse({
      tool: "MakeMagic",
      args: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects valid tool name with wrong args", () => {
    const result = WorldAPICallSchema.safeParse({
      tool: "AdvanceTime",
      args: { hours: -1 },
    });
    expect(result.success).toBe(false);
  });
});
