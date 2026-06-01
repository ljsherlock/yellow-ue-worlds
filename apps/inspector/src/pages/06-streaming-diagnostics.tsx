import type { StreamConnection, StreamSample } from "@yellow-ue/streaming";
import { MockStreamingMetrics } from "@yellow-ue/streaming/mock";
import { useEffect, useRef, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const BUFFER = 48;

export function StreamingDiagnosticsPage() {
  const [metrics] = useState(() => new MockStreamingMetrics({ intervalMs: 400 }));
  const [conn, setConn] = useState<StreamConnection | null>(null);
  const [buf, setBuf] = useState<StreamSample[]>([]);
  const [running, setRunning] = useState(true);
  const offRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    void metrics.connect().then(setConn);
  }, [metrics]);

  useEffect(() => {
    if (running) {
      offRef.current = metrics.subscribe((s) =>
        setBuf((prev) => [...prev, s].slice(-BUFFER)),
      );
    }
    return () => {
      offRef.current?.();
      offRef.current = null;
    };
  }, [running, metrics]);

  const latest = buf[buf.length - 1];

  return (
    <PageShell
      title="06 — Streaming Diagnostics"
      subtitle="Live Pixel Streaming health. connect() is a traced boundary (WebRTC negotiation); the per-sample stream is telemetry, not traced."
      boundary="StreamingMetrics"
      package="@yellow-ue/streaming (mock)"
      status="mock"
    >
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <Button onClick={() => setRunning((r) => !r)} variant={running ? "outline" : "default"}>
          {running ? "Pause" : "Resume"}
        </Button>
        {conn && (
          <span className="font-mono-ui text-xs text-muted">
            codec <span className="text-accent">{conn.codec}</span> · {conn.resolution} ·{" "}
            {conn.intervalMs}ms interval · {running ? "live" : "paused"}
          </span>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Bitrate"
          unit="kbps"
          value={latest?.bitrateKbps}
          samples={buf.map((s) => s.bitrateKbps)}
          color="oklch(0.7 0.15 230)"
        />
        <Stat
          label="FPS"
          unit=""
          value={latest?.fps}
          samples={buf.map((s) => s.fps)}
          color="oklch(0.75 0.15 145)"
          status={latest && latest.fps < 30 ? "bad" : latest && latest.fps < 50 ? "warn" : "ok"}
        />
        <Stat
          label="RTT"
          unit="ms"
          value={latest?.rttMs}
          samples={buf.map((s) => s.rttMs)}
          color="oklch(0.8 0.13 80)"
          status={latest && latest.rttMs > 120 ? "bad" : latest && latest.rttMs > 70 ? "warn" : "ok"}
        />
        <Stat
          label="Packet loss"
          unit="%"
          value={latest?.packetLossPct}
          samples={buf.map((s) => s.packetLossPct)}
          color="oklch(0.7 0.18 25)"
          status={latest && latest.packetLossPct > 2 ? "bad" : latest && latest.packetLossPct > 0.5 ? "warn" : "ok"}
        />
      </div>
    </PageShell>
  );
}

const statusColor = { ok: "text-ok", warn: "text-accent", bad: "text-danger" } as const;

function Stat({
  label,
  unit,
  value,
  samples,
  color,
  status = "ok",
}: {
  label: string;
  unit: string;
  value: number | undefined;
  samples: number[];
  color: string;
  status?: "ok" | "warn" | "bad";
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xs uppercase tracking-wider text-muted">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`mb-2 font-mono-ui text-2xl ${statusColor[status]}`}>
          {value === undefined ? "—" : value}
          <span className="ml-1 text-xs text-muted">{unit}</span>
        </div>
        <Sparkline samples={samples} color={color} />
      </CardContent>
    </Card>
  );
}

function Sparkline({ samples, color }: { samples: number[]; color: string }) {
  const w = 220;
  const h = 44;
  if (samples.length < 2) {
    return <div className="h-11 text-xs text-muted">collecting…</div>;
  }
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const span = max - min || 1;
  const pts = samples
    .map((v, i) => {
      const x = (i / (samples.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}
