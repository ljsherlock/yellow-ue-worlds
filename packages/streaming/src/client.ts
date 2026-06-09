import type { StreamConnection, StreamSample } from "./contract.js";

/**
 * R2: the StreamingMetrics boundary — health of the Pixel Streaming session.
 *
 * Note on tracing (R3): `connect()` is a request/response boundary and IS
 * traced (`streaming.connect`) — it models the WebRTC negotiation. The
 * per-sample stream from `subscribe()` is continuous telemetry, NOT individual
 * boundary calls, so it is deliberately not traced (it would flood the trace
 * viewer). This is the one boundary where the request/response `boundary()`
 * wrapper doesn't fit, and that's by design.
 *
 * Phase 1: `MockStreamingMetrics` (synthetic samples).
 * Phase 3: real `RTCPeerConnection.getStats()` adapter, same interface.
 */
export interface StreamingMetrics {
  /** Open the metrics stream; resolves with the negotiated session params. */
  connect(): Promise<StreamConnection>;

  /** Subscribe to live samples. Returns an unsubscribe function. */
  subscribe(listener: (sample: StreamSample) => void): () => void;

  /** The most recent sample, if any. */
  latest(): StreamSample | undefined;
}
