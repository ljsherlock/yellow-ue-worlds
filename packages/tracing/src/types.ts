/**
 * BoundaryEvent — the structured record emitted for every cross-package call.
 *
 * The Pipeline Trace Viewer (inspector page 07) reads a stream of these to
 * render the full lifecycle of one user prompt.
 */
export interface BoundaryEvent {
  /** Logical request id — all events from one user-prompt share this. */
  trace_id: string;
  /** Unique id for this single boundary call. */
  span_id: string;
  /** Parent span when this boundary is called inside another boundary. */
  parent_span_id?: string;
  /** Stable identifier, e.g. `world-api.setSkyState`, `memory-graph.write`. */
  name: string;
  /** Outcome of the call. */
  status: "ok" | "error";
  /** ms since epoch when the wrapped function was invoked. */
  start_ts: number;
  /** ms since epoch when the wrapped function returned or threw. */
  end_ts: number;
  /** end_ts - start_ts, surfaced for convenience. */
  duration_ms: number;
  /** Arguments passed to the wrapped function (post-redaction). */
  inputs?: unknown;
  /** Return value (only when status === "ok"). */
  output?: unknown;
  /** Error info (only when status === "error"). */
  error?: { message: string; stack?: string };
}

/**
 * TraceSink — anything that consumes BoundaryEvents.
 * Sinks must not throw; if they need to swallow errors, they do it internally.
 */
export interface TraceSink {
  onEvent(event: BoundaryEvent): void;
}

/**
 * Configuration applied to every boundary call.
 */
export interface TracingOptions {
  /**
   * Transform inputs before they're attached to the event. Use this to redact
   * PII, drop bulky binary, etc. Default is identity (no redaction).
   */
  redactInputs?: (name: string, inputs: unknown) => unknown;

  /**
   * Transform output before it's attached. Default is identity.
   */
  redactOutput?: (name: string, output: unknown) => unknown;
}
