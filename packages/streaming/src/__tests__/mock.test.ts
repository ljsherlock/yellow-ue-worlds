import {
  InMemorySink,
  resetTracingForTests,
  setSink,
} from "@yellow-ue/tracing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StreamSample } from "../contract.js";
import { MockStreamingMetrics } from "../mock.js";

beforeEach(() => {
  resetTracingForTests();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  resetTracingForTests();
});

describe("MockStreamingMetrics — connect (R3 traced)", () => {
  it("resolves negotiated params and emits a streaming.connect event", async () => {
    const sink = new InMemorySink();
    setSink(sink);
    const m = new MockStreamingMetrics({ intervalMs: 250, codec: "AV1" });
    const conn = await m.connect();
    expect(conn).toMatchObject({ codec: "AV1", intervalMs: 250 });
    expect(sink.byPrefix("streaming.")).toHaveLength(1);
    expect(sink.events[0]?.name).toBe("streaming.connect");
  });
});

describe("MockStreamingMetrics — subscribe", () => {
  it("emits samples on the interval", () => {
    const m = new MockStreamingMetrics({ intervalMs: 100, rng: () => 0.5 });
    const seen: StreamSample[] = [];
    const off = m.subscribe((s) => seen.push(s));
    vi.advanceTimersByTime(250);
    expect(seen).toHaveLength(2);
    off();
  });

  it("stops emitting after unsubscribe", () => {
    const m = new MockStreamingMetrics({ intervalMs: 100, rng: () => 0.5 });
    const seen: StreamSample[] = [];
    const off = m.subscribe((s) => seen.push(s));
    vi.advanceTimersByTime(150);
    off();
    vi.advanceTimersByTime(500);
    expect(seen).toHaveLength(1);
  });

  it("produces samples within sane ranges and exposes latest()", () => {
    const m = new MockStreamingMetrics({ intervalMs: 100 });
    const off = m.subscribe(() => {});
    vi.advanceTimersByTime(500);
    const s = m.latest()!;
    expect(s.bitrateKbps).toBeGreaterThanOrEqual(1000);
    expect(s.bitrateKbps).toBeLessThanOrEqual(12000);
    expect(s.fps).toBeGreaterThanOrEqual(0);
    expect(s.fps).toBeLessThanOrEqual(120);
    expect(s.packetLossPct).toBeGreaterThanOrEqual(0);
    expect(s.codec).toBe("AV1");
    off();
  });
});
