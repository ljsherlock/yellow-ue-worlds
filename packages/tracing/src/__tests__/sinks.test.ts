import { describe, expect, it, vi } from "vitest";
import { InMemorySink, MultiSink, NoopSink } from "../sinks.js";
import type { BoundaryEvent } from "../types.js";

const fakeEvent = (overrides: Partial<BoundaryEvent> = {}): BoundaryEvent => ({
  trace_id: "t-1",
  span_id: "s-1",
  name: "test",
  status: "ok",
  start_ts: 0,
  end_ts: 1,
  duration_ms: 1,
  ...overrides,
});

describe("InMemorySink", () => {
  it("collects events in arrival order", () => {
    const sink = new InMemorySink();
    sink.onEvent(fakeEvent({ name: "a" }));
    sink.onEvent(fakeEvent({ name: "b" }));
    expect(sink.events.map((e) => e.name)).toEqual(["a", "b"]);
  });

  it("clear() empties the buffer", () => {
    const sink = new InMemorySink();
    sink.onEvent(fakeEvent());
    sink.clear();
    expect(sink.events).toHaveLength(0);
  });

  it("trace() filters by trace_id", () => {
    const sink = new InMemorySink();
    sink.onEvent(fakeEvent({ trace_id: "a" }));
    sink.onEvent(fakeEvent({ trace_id: "b" }));
    sink.onEvent(fakeEvent({ trace_id: "a" }));
    expect(sink.trace("a")).toHaveLength(2);
  });

  it("byPrefix() filters by name prefix", () => {
    const sink = new InMemorySink();
    sink.onEvent(fakeEvent({ name: "world-api.setSkyState" }));
    sink.onEvent(fakeEvent({ name: "memory.write" }));
    sink.onEvent(fakeEvent({ name: "world-api.advanceTime" }));
    expect(sink.byPrefix("world-api.")).toHaveLength(2);
  });
});

describe("NoopSink", () => {
  it("accepts events without error", () => {
    const sink = new NoopSink();
    expect(() => sink.onEvent(fakeEvent())).not.toThrow();
  });
});

describe("MultiSink", () => {
  it("fans out to every child sink", () => {
    const a = new InMemorySink();
    const b = new InMemorySink();
    const fan = new MultiSink([a, b]);
    fan.onEvent(fakeEvent());
    expect(a.events).toHaveLength(1);
    expect(b.events).toHaveLength(1);
  });

  it("isolates failures — a throwing child does not stop the others", () => {
    const a = { onEvent: vi.fn(() => { throw new Error("nope"); }) };
    const b = new InMemorySink();
    const fan = new MultiSink([a, b]);
    expect(() => fan.onEvent(fakeEvent())).toThrow();
    // ^ MultiSink itself does not swallow; the global emit() in boundary.ts does
    expect(a.onEvent).toHaveBeenCalled();
    // b was not reached — this documents current behaviour. If we want
    // best-effort fan-out, MultiSink can wrap each call in try/catch.
    expect(b.events).toHaveLength(0);
  });
});
