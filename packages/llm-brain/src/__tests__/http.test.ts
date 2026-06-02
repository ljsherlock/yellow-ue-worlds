import {
  InMemorySink,
  resetTracingForTests,
  setSink,
  withTrace,
  type BoundaryEvent,
} from "@yellow-ue/tracing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LLMCompletionResultSchema } from "../contract.js";
import { BrainHttpClient } from "../http.js";

beforeEach(() => resetTracingForTests());
afterEach(() => resetTracingForTests());

const goodResult = {
  toolCalls: [{ tool: "SetSkyState", args: { preset: "storm", transition_seconds: 5 } }],
  reasoning: "storm requested",
  model: "gemini-test",
  tokens: { input: 10, output: 12 },
  finishReason: "tool_calls",
};

function fakeFetch(
  status: number,
  payload: unknown,
): typeof fetch {
  return (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      statusText: "x",
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    }) as unknown as Response) as unknown as typeof fetch;
}

describe("BrainHttpClient", () => {
  it("posts the prompt and returns a validated result", async () => {
    const client = new BrainHttpClient({
      fetchImpl: fakeFetch(200, { result: goodResult, spans: [] }),
    });
    const result = await client.complete({ prompt: "make it stormy" });
    expect(() => LLMCompletionResultSchema.parse(result)).not.toThrow();
    expect(result.toolCalls[0]?.tool).toBe("SetSkyState");
  });

  it("throws on non-2xx", async () => {
    const client = new BrainHttpClient({
      fetchImpl: fakeFetch(500, "boom"),
    });
    await expect(client.complete({ prompt: "x" })).rejects.toThrow(/Brain HTTP 500/);
  });

  it("rejects a result that violates the contract", async () => {
    const client = new BrainHttpClient({
      fetchImpl: fakeFetch(200, { result: { toolCalls: "nope" } }),
    });
    await expect(client.complete({ prompt: "x" })).rejects.toThrow();
  });

  it("merges brain spans into the current trace, re-parented", async () => {
    const sink = new InMemorySink();
    setSink(sink);
    const brainSpan: BoundaryEvent = {
      trace_id: "brain-trace",
      span_id: "s1",
      name: "brain.agent.plan",
      status: "ok",
      start_ts: 1,
      end_ts: 2,
      duration_ms: 1,
    };
    const client = new BrainHttpClient({
      fetchImpl: fakeFetch(200, { result: goodResult, spans: [brainSpan] }),
    });

    await withTrace(undefined, () => client.complete({ prompt: "make it stormy" }));

    const completeEvent = sink.events.find((e) => e.name === "llm-brain.complete")!;
    const merged = sink.events.find((e) => e.name === "brain.agent.plan")!;
    expect(merged.span_id).toBe("brain:s1");
    expect(merged.trace_id).toBe(completeEvent.trace_id);
    expect(merged.parent_span_id).toBe(completeEvent.span_id);
  });
});
