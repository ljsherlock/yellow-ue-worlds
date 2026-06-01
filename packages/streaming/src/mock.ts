import { boundary } from "@yellow-ue/tracing";

import type { StreamingMetrics } from "./client.js";
import type { StreamCodec, StreamConnection, StreamSample } from "./contract.js";

export interface MockStreamingMetricsOptions {
  intervalMs?: number;
  codec?: StreamCodec;
  resolution?: string;
  /** [0,1) source; inject for deterministic tests. Default Math.random. */
  rng?: () => number;
  /** clock; inject for deterministic tests. Default Date.now. */
  now?: () => number;
}

interface Target {
  bitrateKbps: number;
  fps: number;
  rttMs: number;
  packetLossPct: number;
}

const TARGET: Target = { bitrateKbps: 8000, fps: 60, rttMs: 35, packetLossPct: 0.2 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * MockStreamingMetrics — emits synthetic Pixel Streaming health samples that
 * wander realistically around target values (8 Mbps / 60fps / 35ms RTT). Page
 * 06 charts the live stream; the real implementation wraps
 * `RTCPeerConnection.getStats()` behind the same interface.
 */
export class MockStreamingMetrics implements StreamingMetrics {
  private readonly listeners = new Set<(s: StreamSample) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private prev: StreamSample | null = null;

  private readonly intervalMs: number;
  private readonly codec: StreamCodec;
  private readonly resolution: string;
  private readonly rng: () => number;
  private readonly now: () => number;

  constructor(options: MockStreamingMetricsOptions = {}) {
    this.intervalMs = options.intervalMs ?? 500;
    this.codec = options.codec ?? "AV1";
    this.resolution = options.resolution ?? "1920x1080";
    this.rng = options.rng ?? Math.random;
    this.now = options.now ?? Date.now;
  }

  connect = boundary("streaming.connect", async (): Promise<StreamConnection> => {
    return { codec: this.codec, resolution: this.resolution, intervalMs: this.intervalMs };
  });

  subscribe(listener: (sample: StreamSample) => void): () => void {
    this.listeners.add(listener);
    if (!this.timer) this.start();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  }

  latest(): StreamSample | undefined {
    return this.prev ?? undefined;
  }

  private start(): void {
    this.timer = setInterval(() => {
      const sample = this.tick();
      for (const l of this.listeners) l(sample);
    }, this.intervalMs);
  }

  private stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): StreamSample {
    const sample = this.generate();
    this.prev = sample;
    return sample;
  }

  /** Wander each metric toward its target with bounded jitter. */
  private generate(): StreamSample {
    const wander = (cur: number, target: number, jitter: number) =>
      cur + (target - cur) * 0.2 + (this.rng() - 0.5) * jitter;

    const p = this.prev;
    const bitrateKbps = clamp(
      p ? wander(p.bitrateKbps, TARGET.bitrateKbps, 2000) : TARGET.bitrateKbps,
      1000,
      12000,
    );
    const fps = clamp(p ? wander(p.fps, TARGET.fps, 8) : TARGET.fps, 0, 120);
    const rttMs = clamp(p ? wander(p.rttMs, TARGET.rttMs, 20) : TARGET.rttMs, 1, 400);
    const packetLossPct = clamp(
      p ? wander(p.packetLossPct, TARGET.packetLossPct, 0.8) : TARGET.packetLossPct,
      0,
      100,
    );

    return {
      ts: this.now(),
      codec: this.codec,
      bitrateKbps: Math.round(bitrateKbps),
      fps: Math.round(fps),
      rttMs: Math.round(rttMs),
      packetLossPct: Number(packetLossPct.toFixed(2)),
      resolution: this.resolution,
    };
  }
}
