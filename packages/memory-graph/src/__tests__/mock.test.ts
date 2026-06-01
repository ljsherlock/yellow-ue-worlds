import {
  InMemorySink,
  resetTracingForTests,
  setSink,
} from "@yellow-ue/tracing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MockWorldMemoryStore } from "../mock.js";
import { seedDemoWorld } from "../seed.js";

let store: MockWorldMemoryStore;

beforeEach(() => {
  resetTracingForTests();
  store = new MockWorldMemoryStore();
});
afterEach(() => resetTracingForTests());

describe("MockWorldMemoryStore — overwrite semantics", () => {
  it("closes the prior fact when a new one is written for same entity+type", async () => {
    await store.write({ type: "SkyState", entityId: "sky", properties: { preset: "clear" }, validFrom: 0 });
    const storm = await store.write({ type: "SkyState", entityId: "sky", properties: { preset: "storm" }, validFrom: 2 });

    const hist = await store.history("sky");
    expect(hist).toHaveLength(2);
    expect(hist[0]?.validTo).toBe(2);
    expect(hist[1]?.validFrom).toBe(2);
    expect(hist[1]?.validTo).toBeNull();
    expect(storm.invalidates).toBe(hist[0]?.id);
  });
});

describe("MockWorldMemoryStore — snapshotAt", () => {
  it("returns the fact valid at a given world-time", async () => {
    await store.write({ type: "SkyState", entityId: "sky", properties: { preset: "clear" }, validFrom: 0 });
    await store.write({ type: "SkyState", entityId: "sky", properties: { preset: "storm" }, validFrom: 2 });

    const at1 = await store.snapshotAt(1);
    expect(at1[0]?.properties.preset).toBe("clear");

    const at5 = await store.snapshotAt(5);
    expect(at5[0]?.properties.preset).toBe("storm");
  });

  it("excludes facts not yet valid", async () => {
    await store.write({ type: "Tree", entityId: "tree-1", properties: {}, validFrom: 10 });
    expect(await store.snapshotAt(5)).toHaveLength(0);
    expect(await store.snapshotAt(10)).toHaveLength(1);
  });
});

describe("MockWorldMemoryStore — read query", () => {
  it("filters by type and entityId", async () => {
    await store.write({ type: "SkyState", entityId: "sky", properties: {}, validFrom: 0 });
    await store.write({ type: "Tree", entityId: "tree-1", properties: {}, validFrom: 0 });
    expect(await store.read({ type: "Tree" })).toHaveLength(1);
    expect(await store.read({ entityId: "sky" })).toHaveLength(1);
    expect(await store.read({})).toHaveLength(2);
  });
});

describe("seedDemoWorld", () => {
  it("produces a scrubable timeline", async () => {
    await seedDemoWorld(store);
    // at t=1: sky clear, 3 seedlings, clock
    const at1 = await store.snapshotAt(1);
    const sky1 = at1.find((f) => f.type === "SkyState");
    expect(sky1?.properties.preset).toBe("clear");

    // at t=5: sky storm
    const at5 = await store.snapshotAt(5);
    expect(at5.find((f) => f.type === "SkyState")?.properties.preset).toBe("storm");

    // at t=30: sky sunset, trees mature
    const at30 = await store.snapshotAt(30);
    expect(at30.find((f) => f.type === "SkyState")?.properties.preset).toBe("sunset");
    const tree = at30.find((f) => f.type === "Tree");
    expect(tree?.properties.growth_stage).toBe("mature");
  });
});

describe("MockWorldMemoryStore — tracing (R3)", () => {
  it("emits memory-graph.* boundary events", async () => {
    const sink = new InMemorySink();
    setSink(sink);
    await store.write({ type: "X", entityId: "e", properties: {}, validFrom: 0 });
    await store.snapshotAt(0);
    expect(sink.byPrefix("memory-graph.").length).toBeGreaterThanOrEqual(2);
  });
});
