import type { BoundaryEvent } from "./types.js";

/**
 * TraceBuilder — assemble synthetic `BoundaryEvent[]` for tests, inspector
 * fixtures, and snapshot regressions.
 *
 * Spans are added by start offset (ms from base) and duration, with optional
 * `parent` label references for nesting. Each call returns the span's label
 * so children can reference it.
 *
 * Example:
 * ```ts
 * const b = new TraceBuilder("test-trace");
 * b.add({ name: "root", label: "r", start_offset_ms: 0, duration_ms: 100 });
 * b.add({ name: "child", parent: "r", start_offset_ms: 10, duration_ms: 50 });
 * const events: BoundaryEvent[] = b.build();
 * ```
 */
export interface AddSpanInput {
  name: string;
  /** Label used to reference this span as a parent in later add() calls. Defaults to `name`. */
  label?: string;
  /** ms offset from the builder's base_ts. */
  start_offset_ms: number;
  /** ms duration of the span. */
  duration_ms: number;
  /** Label of the parent span. Undefined ⇒ this span has no parent. */
  parent?: string;
  status?: "ok" | "error";
  inputs?: unknown;
  output?: unknown;
  error?: { message: string; stack?: string };
}

export class TraceBuilder {
  readonly trace_id: string;
  private readonly base_ts: number;
  private readonly _events: BoundaryEvent[] = [];
  private readonly spansByLabel = new Map<string, BoundaryEvent>();

  constructor(trace_id: string, base_ts?: number) {
    this.trace_id = trace_id;
    this.base_ts = base_ts ?? Date.now();
  }

  add(input: AddSpanInput): string {
    const label = input.label ?? input.name;
    const span_id = `${this.trace_id}-${this._events.length.toString().padStart(3, "0")}`;
    const parent = input.parent ? this.spansByLabel.get(input.parent) : undefined;
    if (input.parent && !parent) {
      throw new Error(`TraceBuilder: parent label "${input.parent}" not found`);
    }
    const start_ts = this.base_ts + input.start_offset_ms;
    const end_ts = start_ts + input.duration_ms;
    const event: BoundaryEvent = {
      trace_id: this.trace_id,
      span_id,
      ...(parent ? { parent_span_id: parent.span_id } : {}),
      name: input.name,
      status: input.status ?? "ok",
      start_ts,
      end_ts,
      duration_ms: input.duration_ms,
      ...(input.inputs !== undefined ? { inputs: input.inputs } : {}),
      ...(input.output !== undefined ? { output: input.output } : {}),
      ...(input.error ? { error: input.error } : {}),
    };
    this._events.push(event);
    this.spansByLabel.set(label, event);
    return label;
  }

  build(): BoundaryEvent[] {
    return [...this._events];
  }
}
