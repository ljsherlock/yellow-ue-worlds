import { PageShell } from "@/components/page-shell";

export function RcRoundTripPage() {
  return (
    <PageShell
      title="04 — RC Round-Trip"
      subtitle="Send a tool call to real Unreal Remote Control. Measure latency. Inspect the wire."
      boundary="RCBridge"
      package="@yellow-ue/rc-bridge (not built yet)"
      status="stub"
    >
      <p className="max-w-3xl text-sm text-muted">
        This page will send a single <span className="font-mono-ui text-accent">WorldAPICall</span>{" "}
        through the real Remote Control HTTP/WebSocket transport, show the
        request and response payloads, and chart round-trip latency.
      </p>
      <p className="mt-4 max-w-3xl text-sm text-muted">
        Filled in when <span className="font-mono-ui text-accent">packages/rc-bridge</span>{" "}
        lands in Phase 2 Track C. Until then, a mock bridge emits realistic
        timing so the UI can be designed.
      </p>
    </PageShell>
  );
}
