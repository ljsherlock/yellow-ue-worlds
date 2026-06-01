# `@yellow-ue/tracing`

**Observable boundaries (R3).** Wraps cross-package calls so the Pipeline
Trace Viewer (inspector page 07) can render the full lifecycle of one
user prompt.

## Why this exists

R3 says: every cross-package boundary method MUST emit a structured trace
event. This package provides the wrapper and the event shape. Without it,
the inspector can't show what happened, why a request was slow, or where
an error originated.

## Usage

```ts
import { boundary, withTrace, InMemorySink, setSink } from "@yellow-ue/tracing";

const sink = new InMemorySink();
setSink(sink);

// Wrap any async function so each call emits one BoundaryEvent
const setSkyState = boundary(
  "world-api.setSkyState",
  async (args: SetSkyStateArgs): Promise<SetSkyStateResult> => {
    // … real impl …
  },
);

// Group a request's calls under one trace_id
await withTrace("request-42", async () => {
  await setSkyState({ preset: "storm" });
});

console.log(sink.events);
// [{ trace_id: "request-42", name: "world-api.setSkyState", status: "ok", … }]
```

## BoundaryEvent shape

```ts
interface BoundaryEvent {
  trace_id: string;        // groups a logical user-prompt-handler
  span_id: string;         // unique per call
  parent_span_id?: string; // when a boundary is called inside another
  name: string;            // e.g. "world-api.setSkyState"
  status: "ok" | "error";
  start_ts: number;        // ms since epoch
  end_ts: number;
  duration_ms: number;
  inputs?: unknown;        // post-redaction
  output?: unknown;        // present when status === "ok"
  error?: { message: string; stack?: string };
}
```

## Sinks

| Sink | Use |
|---|---|
| `InMemorySink` | Inspector pages and tests — query by trace_id, by name prefix |
| `ConsoleSink` | Dev — one line per event |
| `NoopSink` | Production paths where you want zero overhead |
| `MultiSink` | Fan-out (e.g. inspector + console at the same time) |

## Why a HOF and not a TypeScript decorator

ES decorators (Stage 3) only work on class members, require specific
tsconfig flags, and don't compose cleanly with arrow-function methods.
A higher-order function `boundary("name", fn)` works on any async
function — methods, arrows, top-level functions — and stays portable
between Node and browser.

The Python sibling (`yellow_ue.tracing.boundary`, Phase 2) will use real
`@boundary` decorator syntax because Python decorators work everywhere.
R3's text covers both: "wrapped in `boundary()` / `@boundary`".

## Concurrency model — known limitation

The current span stack is a **module-level array**. This works for
**single-flight** execution (one LLM turn at a time, which is what we
have through MVP), but **breaks under concurrent async** (e.g. two
`Promise.all`-ed boundary calls would corrupt each other's parent
relationships).

The proper fix is `AsyncLocalStorage` (Node) — but it isn't available
in browsers, and inspector pages run in browsers. We revisit this in
Phase 2 when the brain server becomes multi-tenant; until then, do
not call boundaries concurrently inside the same `withTrace`.

## Redaction

Inputs and outputs are attached to events as-is. For PII or large blobs,
configure:

```ts
configure({
  redactInputs: (name, inputs) => {
    if (name === "llm.complete") return { redacted: true };
    return inputs;
  },
});
```

## What this package does NOT contain

- OTLP / OpenTelemetry export (Phase 3, when we ship to GCP)
- Sampling logic (everything is currently recorded)
- Distributed trace propagation across services (Phase 2 brain server)
- Browser AsyncLocalStorage polyfill (revisited if/when concurrency demands)
