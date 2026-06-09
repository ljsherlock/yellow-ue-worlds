/**
 * Integration test — proves R3 is satisfied: every cross-package call on
 * MockWorldAPIClient emits a BoundaryEvent the inspector can consume.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  InMemorySink,
  resetTracingForTests,
  setSink,
  withTrace,
} from "@yellow-ue/tracing";

import { MockWorldAPIClient } from "../mock.js";

let sink: InMemorySink;

beforeEach(() => {
  resetTracingForTests();
  sink = new InMemorySink();
  setSink(sink);
});

afterEach(() => {
  resetTracingForTests();
});

describe("world-api boundary tracing", () => {
  it("emits a world-api.setSkyState event per call", async () => {
    const client = new MockWorldAPIClient();
    await client.setSkyState({ preset: "storm" });
    expect(sink.byPrefix("world-api.")).toHaveLength(1);
    expect(sink.events[0]?.name).toBe("world-api.setSkyState");
    expect(sink.events[0]?.status).toBe("ok");
  });

  it("groups all calls within withTrace under one trace_id", async () => {
    const client = new MockWorldAPIClient();
    await withTrace("user-prompt-1", async () => {
      await client.setSkyState({ preset: "sunset" });
      await client.advanceTime({ hours: 2 });
      await client.spawnTrees({
        area: { center: { x: 0, y: 0, z: 0 }, radius: 1 },
        count: 1,
        species: "oak",
      });
    });
    const events = sink.trace("user-prompt-1");
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.name)).toEqual([
      "world-api.setSkyState",
      "world-api.advanceTime",
      "world-api.spawnTrees",
    ]);
  });

  it("dispatch becomes a parent span of the routed tool call", async () => {
    const client = new MockWorldAPIClient();
    await withTrace("dispatch-test", async () => {
      await client.dispatch({
        tool: "SetSkyState",
        args: { preset: "night", transition_seconds: 1 },
      });
    });
    const events = sink.trace("dispatch-test");
    const dispatchEvent = events.find((e) => e.name === "world-api.dispatch");
    const skyEvent = events.find((e) => e.name === "world-api.setSkyState");
    expect(dispatchEvent).toBeDefined();
    expect(skyEvent).toBeDefined();
    expect(skyEvent?.parent_span_id).toBe(dispatchEvent?.span_id);
  });

  it("records ok status with the result envelope as output", async () => {
    const client = new MockWorldAPIClient();
    await client.setSkyState({ preset: "clear" });
    const event = sink.events[0]!;
    expect(event.status).toBe("ok");
    // The boundary records what the function returned — in our case, a Result<T>
    // envelope with ok: true. This is on purpose: inspector can show both the
    // boundary outcome and the application-level outcome.
    expect(event.output).toMatchObject({ ok: true });
  });

  it("emits ok status even when the call returns an INVALID_ARGS Result", async () => {
    // We use Result<T, E> envelopes for app-level errors, not exceptions.
    // The boundary considers any returned value as ok; only thrown errors
    // produce status: "error". This is the documented contract.
    const client = new MockWorldAPIClient();
    // @ts-expect-error — bad input on purpose
    await client.setSkyState({ preset: "rainbow" });
    expect(sink.events[0]?.status).toBe("ok");
    expect(sink.events[0]?.output).toMatchObject({ ok: false });
  });
});
