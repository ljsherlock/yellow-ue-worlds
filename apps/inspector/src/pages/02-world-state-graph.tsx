import { PageShell } from "@/components/page-shell";

export function WorldStateGraphPage() {
  return (
    <PageShell
      title="02 — World State Graph"
      subtitle="What does the world remember? Time-travel through Graphiti facts at any timestamp."
      boundary="WorldMemoryStore"
      package="@yellow-ue/memory-graph (not built yet)"
      status="stub"
    >
      <p className="max-w-3xl text-sm text-muted">
        This page will render the graph at any chosen world-time, list facts
        with their <span className="font-mono-ui text-accent">valid_from</span>{" "}
        / <span className="font-mono-ui text-accent">valid_to</span> envelopes,
        and accept queries.
      </p>
      <p className="mt-4 max-w-3xl text-sm text-muted">
        Filled in when <span className="font-mono-ui text-accent">packages/memory-graph</span>{" "}
        lands in Phase 2 Track B. Phase 1 wires a mock store with synthetic facts.
      </p>
    </PageShell>
  );
}
