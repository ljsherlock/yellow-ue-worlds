import { PageShell } from "@/components/page-shell";

export function StreamingDiagnosticsPage() {
  return (
    <PageShell
      title="06 — Streaming Diagnostics"
      subtitle="Live Pixel Streaming health: codec, bitrate, FPS, RTT, packet loss."
      boundary="StreamingMetrics"
      package="@yellow-ue/streaming (not built yet)"
      status="stub"
    >
      <p className="max-w-3xl text-sm text-muted">
        This page will render live metrics from the Pixel Streaming 2 player
        — codec in use (AV1/H.264), measured bitrate, FPS, round-trip time,
        and packet loss. The same panel appears in the production app's
        admin view (R1: shared data source).
      </p>
      <p className="mt-4 max-w-3xl text-sm text-muted">
        Filled in when Pixel Streaming integration lands in Phase 3 GCP infrastructure.
      </p>
    </PageShell>
  );
}
