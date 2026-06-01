import { WorldAPICallSchema } from "@yellow-ue/world-api";
import { z } from "zod";

export const BRAIN_PROTOCOL_VERSION = "BrainProtocolv1" as const;

/**
 * What the caller hands the brain. The system prompt and tool schemas are
 * owned by the brain, not the caller — the caller only supplies the user's
 * words and (optionally) a summary of current world state to condition on.
 */
export const LLMCompletionRequestSchema = z.object({
  prompt: z.string().min(1),
  worldContext: z.string().optional(),
});
export type LLMCompletionRequest = z.input<typeof LLMCompletionRequestSchema>;

export const TokenUsageSchema = z.object({
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

export const FinishReasonSchema = z.enum([
  "stop",
  "length",
  "tool_calls",
  "content_filter",
]);
export type FinishReason = z.infer<typeof FinishReasonSchema>;

/**
 * What the brain produces. `toolCalls` are validated `WorldAPICall`s from
 * `@yellow-ue/world-api` (R4 — one source of truth for the contract).
 */
export const LLMCompletionResultSchema = z.object({
  toolCalls: z.array(WorldAPICallSchema),
  reasoning: z.string(),
  model: z.string(),
  tokens: TokenUsageSchema,
  finishReason: FinishReasonSchema,
});
export type LLMCompletionResult = z.infer<typeof LLMCompletionResultSchema>;
