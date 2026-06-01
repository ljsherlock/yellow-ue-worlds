import { PageShell } from "@/components/page-shell";

export function PipelineTraceViewerPage() {
  return (
    <PageShell
      title="07 — Pipeline Trace Viewer"
      subtitle="The cross-cutting view: one user prompt, every boundary it crosses, every event in order."
      boundary="cross-cutting"
      package="@yellow-ue/tracing"
      status="stub"
    >
      <p className="max-w-3xl text-sm text-muted">
        This page reads <span className="font-mono-ui text-accent">BoundaryEvent</span>s
        from the configured sink and renders them as a tree (parent-child
        spans) and a waterfall (timing).
      </p>
      <p className="mt-4 max-w-3xl text-sm text-muted">
        Filled in next, as Task 0.6 — first with mock events flowing through
        every stage; then wired to live events as the real backends arrive.
      </p>
    </PageShell>
  );
}
