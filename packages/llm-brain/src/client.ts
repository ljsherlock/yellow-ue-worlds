import type { LLMCompletionRequest, LLMCompletionResult } from "./contract.js";

/**
 * R2: the LLMClient boundary. The inspector (page 01) and, later, the
 * production app depend on this interface only. Implementations are injected.
 *
 * Phase 1: `MockLLMClient` (scripted, deterministic).
 * Phase 2 Track A: `BrainHttpClient` — a thin TS client that POSTs to the
 *   Python LangGraph agent and returns the same `LLMCompletionResult`.
 *   Both implement this interface, so the inspector page never changes.
 */
export interface LLMClient {
  complete(request: LLMCompletionRequest): Promise<LLMCompletionResult>;
}
