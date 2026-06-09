import {
  InMemorySink,
  resetTracingForTests,
  setSink,
} from "@yellow-ue/tracing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MockLLMClient } from "../mock.js";

let client: MockLLMClient;

beforeEach(() => {
  resetTracingForTests();
  client = new MockLLMClient();
});

afterEach(() => {
  resetTracingForTests();
});

describe("MockLLMClient — sky", () => {
  it("maps 'make it stormy' to a single SetSkyState(storm)", async () => {
    const r = await client.complete({ prompt: "make it stormy" });
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0]).toMatchObject({
      tool: "SetSkyState",
      args: { preset: "storm" },
    });
    expect(r.finishReason).toBe("tool_calls");
  });

  it("maps 'go dark' to SetSkyState(night)", async () => {
    const r = await client.complete({ prompt: "please go dark now" });
    expect(r.toolCalls[0]).toMatchObject({
      tool: "SetSkyState",
      args: { preset: "night" },
    });
  });
});

describe("MockLLMClient — time", () => {
  it("maps 'skip to morning' to AdvanceTime(8h)", async () => {
    const r = await client.complete({ prompt: "skip to morning" });
    expect(r.toolCalls[0]).toMatchObject({
      tool: "AdvanceTime",
      args: { hours: 8 },
    });
  });

  it("maps 'speed everything up 100x' to a speed multiplier", async () => {
    const r = await client.complete({ prompt: "speed everything up 100x" });
    const call = r.toolCalls[0];
    expect(call?.tool).toBe("AdvanceTime");
    if (call?.tool === "AdvanceTime") {
      expect(call.args.speed_multiplier).toBe(100);
    }
  });

  it("maps 'a week passes' to AdvanceTime(168h)", async () => {
    const r = await client.complete({ prompt: "a week passes" });
    expect(r.toolCalls[0]).toMatchObject({
      tool: "AdvanceTime",
      args: { hours: 168 },
    });
  });
});

describe("MockLLMClient — trees", () => {
  it("maps 'plant 50 oaks here' to SpawnTrees(50, oak)", async () => {
    const r = await client.complete({ prompt: "plant 50 oaks here" });
    const call = r.toolCalls[0];
    expect(call?.tool).toBe("SpawnTrees");
    if (call?.tool === "SpawnTrees") {
      expect(call.args.count).toBe(50);
      expect(call.args.species).toBe("oak");
    }
  });

  it("detects species and growth stage", async () => {
    const r = await client.complete({
      prompt: "scatter a forest of birch saplings",
    });
    const call = r.toolCalls[0];
    if (call?.tool === "SpawnTrees") {
      expect(call.args.species).toBe("birch");
      expect(call.args.growth_stage).toBe("sapling");
      expect(call.args.count).toBe(25); // default when no number given
    }
  });
});

describe("MockLLMClient — composition", () => {
  it("emits multiple tool calls for a compound prompt", async () => {
    const r = await client.complete({
      prompt: "make it stormy and plant 50 oaks",
    });
    expect(r.toolCalls).toHaveLength(2);
    expect(r.toolCalls.map((c) => c.tool)).toEqual([
      "SetSkyState",
      "SpawnTrees",
    ]);
  });

  it("returns no tool calls and finishReason 'stop' for unrecognised prompts", async () => {
    const r = await client.complete({ prompt: "tell me a joke" });
    expect(r.toolCalls).toHaveLength(0);
    expect(r.finishReason).toBe("stop");
  });
});

describe("MockLLMClient — tracing (R3)", () => {
  it("emits an llm-brain.complete boundary event", async () => {
    const sink = new InMemorySink();
    setSink(sink);
    await client.complete({ prompt: "make it stormy" });
    expect(sink.byPrefix("llm-brain.")).toHaveLength(1);
    expect(sink.events[0]?.name).toBe("llm-brain.complete");
    expect(sink.events[0]?.status).toBe("ok");
  });
});
