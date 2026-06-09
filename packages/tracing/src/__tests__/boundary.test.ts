import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  boundary,
  configure,
  currentSpan,
  InMemorySink,
  resetTracingForTests,
  setSink,
  withTrace,
} from "../index.js";

let sink: InMemorySink;

beforeEach(() => {
  resetTracingForTests();
  sink = new InMemorySink();
  setSink(sink);
});

afterEach(() => {
  resetTracingForTests();
});

describe("boundary — happy path", () => {
  it("emits one ok event with inputs and output", async () => {
    const add = boundary("math.add", async (a: number, b: number) => a + b);
    const result = await add(2, 3);
    expect(result).toBe(5);
    expect(sink.events).toHaveLength(1);
    const e = sink.events[0]!;
    expect(e.name).toBe("math.add");
    expect(e.status).toBe("ok");
    expect(e.inputs).toEqual([2, 3]);
    expect(e.output).toBe(5);
    expect(e.duration_ms).toBeGreaterThanOrEqual(0);
    expect(e.end_ts).toBeGreaterThanOrEqual(e.start_ts);
  });

  it("generates trace_id and span_id when no enclosing trace", async () => {
    const fn = boundary("solo", async () => "x");
    await fn();
    const e = sink.events[0]!;
    expect(e.trace_id).toBeDefined();
    expect(e.span_id).toBeDefined();
    expect(e.parent_span_id).toBeUndefined();
  });
});

describe("boundary — error path", () => {
  it("emits one error event and rethrows", async () => {
    const broken = boundary("broken", async () => {
      throw new Error("boom");
    });
    await expect(broken()).rejects.toThrow("boom");
    expect(sink.events).toHaveLength(1);
    const e = sink.events[0]!;
    expect(e.status).toBe("error");
    expect(e.error?.message).toBe("boom");
    expect(e.output).toBeUndefined();
  });

  it("handles non-Error throws", async () => {
    const broken = boundary("broken", async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw "string-error";
    });
    await expect(broken()).rejects.toBe("string-error");
    expect(sink.events[0]?.error?.message).toBe("string-error");
  });
});

describe("withTrace + nested boundaries", () => {
  it("shares trace_id across nested calls and sets parent_span_id", async () => {
    const inner = boundary("inner", async () => "inner-result");
    const outer = boundary("outer", async () => {
      await inner();
      return "outer-result";
    });

    await withTrace("test-trace-1", async () => {
      await outer();
    });

    expect(sink.events).toHaveLength(2);
    const innerEvent = sink.events.find((e) => e.name === "inner")!;
    const outerEvent = sink.events.find((e) => e.name === "outer")!;
    expect(innerEvent.trace_id).toBe("test-trace-1");
    expect(outerEvent.trace_id).toBe("test-trace-1");
    expect(innerEvent.parent_span_id).toBe(outerEvent.span_id);
    expect(outerEvent.parent_span_id).toBe("test-trace-1");
  });

  it("generates a fresh trace_id when withTrace gets undefined", async () => {
    const fn = boundary("inside", async () => "y");
    let captured: string | undefined;
    await withTrace(undefined, async () => {
      captured = currentSpan()?.trace_id;
      await fn();
    });
    expect(captured).toBeDefined();
    expect(sink.events[0]?.trace_id).toBe(captured);
  });

  it("pops span stack even when fn throws", async () => {
    const fn = boundary("will-throw", async () => {
      throw new Error("x");
    });
    await expect(
      withTrace("t", async () => {
        await fn();
      }),
    ).rejects.toThrow("x");
    expect(currentSpan()).toBeUndefined();
  });
});

describe("configure — redaction", () => {
  it("applies redactInputs", async () => {
    configure({
      redactInputs: (_name, _inputs) => "[REDACTED]",
    });
    const fn = boundary("with-secret", async (token: string) => token.length);
    await fn("super-secret");
    expect(sink.events[0]?.inputs).toBe("[REDACTED]");
  });

  it("applies redactOutput", async () => {
    configure({
      redactOutput: (_name, _output) => "[OMITTED]",
    });
    const fn = boundary("big-blob", async () => ({ big: "data" }));
    await fn();
    expect(sink.events[0]?.output).toBe("[OMITTED]");
  });

  it("redactInputs receives the boundary name", async () => {
    let seenName: string | undefined;
    configure({
      redactInputs: (name, inputs) => {
        seenName = name;
        return inputs;
      },
    });
    const fn = boundary("named.thing", async () => 1);
    await fn();
    expect(seenName).toBe("named.thing");
  });
});

describe("currentSpan", () => {
  it("returns undefined outside any boundary", () => {
    expect(currentSpan()).toBeUndefined();
  });

  it("returns the active span inside a boundary", async () => {
    const fn = boundary("peek", async () => {
      return currentSpan();
    });
    const inside = await fn();
    expect(inside).toBeDefined();
    expect(inside?.trace_id).toBeDefined();
  });
});
