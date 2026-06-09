# `@yellow-ue/streaming`

**The `StreamingMetrics` boundary — Pixel Streaming session health.**

When the world is being streamed from a GPU in the cloud, this is how we know
it's healthy: codec, bitrate, FPS, round-trip time, packet loss. Page 06
charts it live.

## Phase status

| Phase | What ships |
|---|---|
| **1 (now)** | `StreamingMetrics` interface, `MockStreamingMetrics` (synthetic wandering samples) |
| **3** | Real adapter over `RTCPeerConnection.getStats()`, same interface |

## Tracing (R3) — the one exception

`connect()` is request/response and IS traced (`streaming.connect`) — it models
WebRTC negotiation. The continuous per-sample stream from `subscribe()` is
telemetry, **not** individual boundary calls, so it is deliberately not traced
(it would flood the trace viewer). This is the single boundary where the
request/response `boundary()` wrapper doesn't fit, and that's by design.

```ts
const metrics = new MockStreamingMetrics({ intervalMs: 500 });
const conn = await metrics.connect();        // { codec: "AV1", resolution, intervalMs }
const off = metrics.subscribe((s) => render(s));
// …later
off();
```
