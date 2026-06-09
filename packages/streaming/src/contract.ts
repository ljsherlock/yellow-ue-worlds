export const STREAM_METRICS_VERSION = "StreamMetricsv1" as const;

export type StreamCodec = "AV1" | "H264" | "VP9";

export interface StreamSample {
  /** wall-clock timestamp (ms). */
  ts: number;
  codec: StreamCodec;
  bitrateKbps: number;
  fps: number;
  rttMs: number;
  packetLossPct: number;
  resolution: string;
}

/** Result of opening the stream — the negotiated session parameters. */
export interface StreamConnection {
  codec: StreamCodec;
  resolution: string;
  intervalMs: number;
}
