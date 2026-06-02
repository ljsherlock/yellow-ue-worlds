import { boundary, currentSpan, getSink, type BoundaryEvent } from "@yellow-ue/tracing";
import type { Ecologist, EcologistResult, SceneSpec } from "@yellow-ue/world-model";

import type { LLMClient } from "./client.js";
import {
  LLMCompletionResultSchema,
  type LLMCompletionRequest,
  type LLMCompletionResult,
} from "./contract.js";

export interface BrainHttpClientOptions {
  baseUrl?: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

interface BrainResponse {
  result: unknown;
  spans?: BoundaryEvent[];
}

/**
 * BrainHttpClient — the real `LLMClient`, talking to the Python LangGraph brain
 * over HTTP. Same interface as `MockLLMClient`, so page 01 swaps one for the
 * other with no other change (R2).
 *
 * The brain returns its own internal boundary spans alongside the result; we
 * re-parent them under this `llm-brain.complete` span so the Pipeline Trace
 * Viewer shows the full lifecycle *across the process boundary* (R3).
 *
 * It satisfies two boundaries: `LLMClient` (prompt → tool calls) and
 * `Ecologist` (prompt → a populated SceneSpec) — both swap in for their mock
 * counterparts with no other change (R2).
 */
export class BrainHttpClient implements LLMClient, Ecologist {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: BrainHttpClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "http://localhost:8000").replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  complete = boundary(
    "llm-brain.complete",
    async (request: LLMCompletionRequest): Promise<LLMCompletionResult> => {
      const body = await this.post("/complete", request);
      mergeBrainSpans(body.spans);
      return LLMCompletionResultSchema.parse(body.result);
    },
  );

  populate = boundary(
    "llm-brain.populate",
    async (prompt: string): Promise<EcologistResult> => {
      const body = await this.post("/populate", { prompt });
      mergeBrainSpans(body.spans);
      const r = body.result as { scene: SceneSpec; reasoning: string; model: string };
      // The brain validated against the generated scene-spec schema; loadScene's
      // SceneSpecSchema.parse is the final gate, so we pass the scene straight on.
      return { scene: r.scene, reasoning: r.reasoning, model: r.model };
    },
  );

  private async post(path: string, payload: unknown): Promise<BrainResponse> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Brain HTTP ${res.status}: ${text || res.statusText}`);
    }
    return (await res.json()) as BrainResponse;
  }
}

/**
 * Fold the brain's spans into the current trace: rewrite their trace_id to the
 * caller's, namespace their ids under `brain:` to avoid collisions, and parent
 * the brain's roots under the current span.
 */
function mergeBrainSpans(spans: BoundaryEvent[] | undefined): void {
  if (!spans || spans.length === 0) return;
  const cur = currentSpan();
  if (!cur) return;
  const sink = getSink();
  for (const s of spans) {
    const remapped: BoundaryEvent = {
      ...s,
      trace_id: cur.trace_id,
      span_id: `brain:${s.span_id}`,
      parent_span_id: s.parent_span_id ? `brain:${s.parent_span_id}` : cur.span_id,
    };
    try {
      sink.onEvent(remapped);
    } catch {
      // sinks must not affect the call
    }
  }
}
