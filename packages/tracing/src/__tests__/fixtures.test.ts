import { describe, expect, it } from "vitest";
import { TraceBuilder } from "../fixtures.js";

describe("TraceBuilder", () => {
  it("builds a flat trace with shared trace_id", () => {
    const b = new TraceBuilder("t-1", 1000);
    b.add({ name: "a", start_offset_ms: 0, duration_ms: 10 });
    b.add({ name: "b", start_offset_ms: 15, duration_ms: 20 });
    const events = b.build();
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.trace_id === "t-1")).toBe(true);
    expect(events[0]?.start_ts).toBe(1000);
    expect(events[0]?.end_ts).toBe(1010);
    expect(events[1]?.start_ts).toBe(1015);
  });

  it("nests via parent label", () => {
    const b = new TraceBuilder("t-2", 0);
    b.add({ name: "root", label: "r", start_offset_ms: 0, duration_ms: 100 });
    b.add({
      name: "child",
      parent: "r",
      start_offset_ms: 10,
      duration_ms: 50,
    });
    const events = b.build();
    expect(events[1]?.parent_span_id).toBe(events[0]?.span_id);
  });

  it("throws when parent label is unknown", () => {
    const b = new TraceBuilder("t-3", 0);
    expect(() =>
      b.add({
        name: "x",
        parent: "missing",
        start_offset_ms: 0,
        duration_ms: 1,
      }),
    ).toThrow(/parent label/);
  });

  it("records errors and sets status correctly", () => {
    const b = new TraceBuilder("t-4", 0);
    b.add({
      name: "boom",
      start_offset_ms: 0,
      duration_ms: 5,
      status: "error",
      error: { message: "timeout" },
    });
    const e = b.build()[0]!;
    expect(e.status).toBe("error");
    expect(e.error?.message).toBe("timeout");
  });

  it("omits inputs/output when undefined (exactOptionalPropertyTypes)", () => {
    const b = new TraceBuilder("t-5", 0);
    b.add({ name: "x", start_offset_ms: 0, duration_ms: 1 });
    const e = b.build()[0]!;
    expect("inputs" in e).toBe(false);
    expect("output" in e).toBe(false);
  });
});
