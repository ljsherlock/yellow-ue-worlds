import { describe, expect, it } from "vitest";
import {
  BRAIN_PROTOCOL_VERSION,
  LLMCompletionRequestSchema,
  LLMCompletionResultSchema,
} from "../contract.js";

describe("BRAIN_PROTOCOL_VERSION", () => {
  it("is BrainProtocolv1", () => {
    expect(BRAIN_PROTOCOL_VERSION).toBe("BrainProtocolv1");
  });
});

describe("LLMCompletionRequestSchema", () => {
  it("accepts a bare prompt", () => {
    const r = LLMCompletionRequestSchema.safeParse({ prompt: "hello" });
    expect(r.success).toBe(true);
  });

  it("rejects an empty prompt", () => {
    const r = LLMCompletionRequestSchema.safeParse({ prompt: "" });
    expect(r.success).toBe(false);
  });

  it("accepts optional worldContext", () => {
    const r = LLMCompletionRequestSchema.safeParse({
      prompt: "x",
      worldContext: "sky is clear; 0 trees",
    });
    expect(r.success).toBe(true);
  });
});

describe("LLMCompletionResultSchema", () => {
  it("accepts a valid result with one tool call", () => {
    const r = LLMCompletionResultSchema.safeParse({
      toolCalls: [{ tool: "SetSkyState", args: { preset: "storm" } }],
      reasoning: "because",
      model: "mock-llm-v1",
      tokens: { input: 4, output: 22 },
      finishReason: "tool_calls",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an invalid tool call inside the result", () => {
    const r = LLMCompletionResultSchema.safeParse({
      toolCalls: [{ tool: "SetSkyState", args: { preset: "rainbow" } }],
      reasoning: "because",
      model: "mock-llm-v1",
      tokens: { input: 4, output: 22 },
      finishReason: "tool_calls",
    });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown finishReason", () => {
    const r = LLMCompletionResultSchema.safeParse({
      toolCalls: [],
      reasoning: "",
      model: "m",
      tokens: { input: 0, output: 0 },
      finishReason: "exploded",
    });
    expect(r.success).toBe(false);
  });
});
