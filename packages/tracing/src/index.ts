export type { BoundaryEvent, TraceSink, TracingOptions } from "./types.js";
export {
  boundary,
  configure,
  currentSpan,
  getSink,
  resetTracingForTests,
  setSink,
  withTrace,
} from "./boundary.js";
export { ConsoleSink, InMemorySink, MultiSink, NoopSink } from "./sinks.js";
export { generateId } from "./id.js";
