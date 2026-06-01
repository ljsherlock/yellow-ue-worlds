import { generateId } from "./id.js";
import { NoopSink } from "./sinks.js";
import type { BoundaryEvent, TraceSink, TracingOptions } from "./types.js";

interface SpanContext {
  trace_id: string;
  span_id: string;
}

// Module-level state. See README "Concurrency model" — this works for
// single-flight execution (one LLM turn at a time). Multi-tenant server
// usage in Phase 2 will replace this with AsyncLocalStorage.
const _spanStack: SpanContext[] = [];
let _sink: TraceSink = new NoopSink();
let _options: TracingOptions = {};

export function setSink(sink: TraceSink): void {
  _sink = sink;
}

export function getSink(): TraceSink {
  return _sink;
}

export function configure(options: TracingOptions): void {
  _options = { ..._options, ...options };
}

export function resetTracingForTests(): void {
  _spanStack.length = 0;
  _sink = new NoopSink();
  _options = {};
}

/**
 * Read-only view of the current span — useful for inspectors and
 * for log-correlation in code that wants to attach trace ids.
 */
export function currentSpan(): Readonly<SpanContext> | undefined {
  const top = _spanStack[_spanStack.length - 1];
  return top ? { trace_id: top.trace_id, span_id: top.span_id } : undefined;
}

/**
 * Start a logical trace. Every boundary() call inside the callback inherits
 * trace_id from this. Use this at the top of a user-prompt-handler, an
 * inspector test run, etc.
 *
 * If trace_id is omitted, a new one is generated.
 */
export async function withTrace<R>(
  trace_id: string | undefined,
  fn: () => Promise<R>,
): Promise<R> {
  const id = trace_id ?? generateId();
  const root: SpanContext = { trace_id: id, span_id: id };
  _spanStack.push(root);
  try {
    return await fn();
  } finally {
    _spanStack.pop();
  }
}

/**
 * Wrap a function so every call emits a BoundaryEvent.
 *
 * Usage:
 * ```ts
 * const setSkyState = boundary("world-api.setSkyState", async (args) => { ... });
 * ```
 *
 * The wrapped function:
 *   - Inherits trace_id from the enclosing withTrace() call, OR starts a
 *     new trace if there isn't one.
 *   - Emits one BoundaryEvent to the configured sink on completion (success
 *     OR error). Errors are re-thrown after recording.
 *   - Applies redactInputs / redactOutput from configure() if set.
 */
export function boundary<Args extends readonly unknown[], R>(
  name: string,
  fn: (...args: Args) => Promise<R>,
): (...args: Args) => Promise<R> {
  return async (...args: Args): Promise<R> => {
    const parent = _spanStack[_spanStack.length - 1];
    const span_id = generateId();
    const trace_id = parent?.trace_id ?? span_id;

    const start_ts = Date.now();
    const inputs = _options.redactInputs
      ? _options.redactInputs(name, args)
      : args;

    _spanStack.push({ trace_id, span_id });
    try {
      const output = await fn(...args);
      const end_ts = Date.now();
      const recordedOutput = _options.redactOutput
        ? _options.redactOutput(name, output)
        : output;
      emit({
        trace_id,
        span_id,
        ...(parent ? { parent_span_id: parent.span_id } : {}),
        name,
        status: "ok",
        start_ts,
        end_ts,
        duration_ms: end_ts - start_ts,
        inputs,
        output: recordedOutput,
      });
      return output;
    } catch (err) {
      const end_ts = Date.now();
      const error = toErrorPayload(err);
      emit({
        trace_id,
        span_id,
        ...(parent ? { parent_span_id: parent.span_id } : {}),
        name,
        status: "error",
        start_ts,
        end_ts,
        duration_ms: end_ts - start_ts,
        inputs,
        error,
      });
      throw err;
    } finally {
      _spanStack.pop();
    }
  };
}

function emit(event: BoundaryEvent): void {
  try {
    _sink.onEvent(event);
  } catch {
    // Sinks must not affect the wrapped call. Swallow.
  }
}

function toErrorPayload(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) {
    return err.stack
      ? { message: err.message, stack: err.stack }
      : { message: err.message };
  }
  return { message: String(err) };
}
