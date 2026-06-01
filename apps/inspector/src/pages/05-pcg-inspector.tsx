import { PageShell } from "@/components/page-shell";

export function PcgInspectorPage() {
  return (
    <PageShell
      title="05 — PCG Inspector"
      subtitle="What parameters did the procedural graph receive? What did it produce?"
      boundary="PCGRunner"
      package="@yellow-ue/pcg (not built yet)"
      status="stub"
    >
      <p className="max-w-3xl text-sm text-muted">
        This page will show the parameter overrides handed to a PCG graph
        (e.g. <span className="font-mono-ui text-accent">SpawnTrees</span>) and
        the resulting entity list — coordinates, species, growth stages —
        without having to re-run the full pipeline.
      </p>
      <p className="mt-4 max-w-3xl text-sm text-muted">
        Filled in when <span className="font-mono-ui text-accent">packages/pcg</span>{" "}
        lands in Phase 2 Track D.
      </p>
    </PageShell>
  );
}
