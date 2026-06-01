import type { BoundaryEvent, TraceSink } from "./types.js";

/**
 * Collects events in memory. Inspector pages and tests consume this.
 */
export class InMemorySink implements TraceSink {
  readonly events: BoundaryEvent[] = [];

  onEvent(event: BoundaryEvent): void {
    this.events.push(event);
  }

  clear(): void {
    this.events.length = 0;
  }

  /** Returns events that share a trace_id. */
  trace(trace_id: string): BoundaryEvent[] {
    return this.events.filter((e) => e.trace_id === trace_id);
  }

  /** Returns events whose name matches a prefix, e.g. "world-api." */
  byPrefix(prefix: string): BoundaryEvent[] {
    return this.events.filter((e) => e.name.startsWith(prefix));
  }
}

/**
 * Prints a one-line summary per event. For dev / debug runs.
 */
export class ConsoleSink implements TraceSink {
  constructor(private readonly verbose = false) {}

  onEvent(event: BoundaryEvent): void {
    const dur = `${event.duration_ms.toFixed(1)}ms`;
    const status = event.status === "ok" ? "ok" : "ERR";
    const tag = `[trace ${event.trace_id.slice(0, 8)}]`;
    // eslint-disable-next-line no-console
    console.log(`${tag} ${event.name} ${status} ${dur}`);
    if (this.verbose && event.status === "error") {
      // eslint-disable-next-line no-console
      console.log("  error:", event.error?.message);
    }
  }
}

/**
 * Drops every event. Used in production paths where we don't want any
 * tracing overhead.
 */
export class NoopSink implements TraceSink {
  onEvent(_event: BoundaryEvent): void {
    // intentionally empty
  }
}

/**
 * Fans out a single event to multiple sinks. Use when you want to e.g.
 * collect in memory for the inspector AND log to console.
 */
export class MultiSink implements TraceSink {
  constructor(private readonly sinks: readonly TraceSink[]) {}

  onEvent(event: BoundaryEvent): void {
    for (const sink of this.sinks) sink.onEvent(event);
  }
}
