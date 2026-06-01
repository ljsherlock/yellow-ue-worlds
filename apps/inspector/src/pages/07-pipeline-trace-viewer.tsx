import type { BoundaryEvent } from "@yellow-ue/tracing";
import { useMemo, useState } from "react";

import { EventDetail } from "@/components/event-detail";
import { PageShell } from "@/components/page-shell";
import { TraceTree } from "@/components/trace-tree";
import { TraceWaterfall } from "@/components/trace-waterfall";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { scenarios } from "@/lib/mock-traces";
import { cn } from "@/lib/utils";

type ViewMode = "tree" | "waterfall";

export function PipelineTraceViewerPage() {
  const [scenarioId, setScenarioId] = useState(scenarios[0]!.id);
  const [view, setView] = useState<ViewMode>("waterfall");
  const [selectedSpanId, setSelectedSpanId] = useState<string | undefined>();

  const scenario = scenarios.find((s) => s.id === scenarioId)!;
  const events: BoundaryEvent[] = useMemo(() => scenario.build(), [scenario]);

  const selected = useMemo(
    () => events.find((e) => e.span_id === selectedSpanId),
    [events, selectedSpanId],
  );

  // Reset selection when scenario changes
  const onScenarioChange = (id: string) => {
    setScenarioId(id);
    setSelectedSpanId(undefined);
  };

  return (
    <PageShell
      title="07 — Pipeline Trace Viewer"
      subtitle="One user prompt, every boundary it crossed, in order. The keystone inspector — wired live when real backends arrive."
      boundary="cross-cutting"
      package="@yellow-ue/tracing"
      status="mock"
    >
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Scenario</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {scenarios.map((s) => (
                <Button
                  key={s.id}
                  variant={s.id === scenarioId ? "default" : "outline"}
                  size="sm"
                  onClick={() => onScenarioChange(s.id)}
                >
                  {s.label}
                </Button>
              ))}
            </div>
            <p className="text-sm text-muted">{scenario.description}</p>
            <div className="rounded border border-border bg-zinc-900/60 p-2 font-mono-ui text-xs">
              <span className="text-muted">prompt</span>{" "}
              <span className="text-accent">"{scenario.prompt}"</span>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Trace ({events.length} spans)</CardTitle>
              <div className="flex gap-1">
                <ViewToggle current={view} value="waterfall" onClick={setView}>
                  waterfall
                </ViewToggle>
                <ViewToggle current={view} value="tree" onClick={setView}>
                  tree
                </ViewToggle>
              </div>
            </CardHeader>
            <CardContent>
              {view === "tree" ? (
                <TraceTree
                  events={events}
                  selectedSpanId={selectedSpanId}
                  onSelect={(e) => setSelectedSpanId(e.span_id)}
                />
              ) : (
                <TraceWaterfall
                  events={events}
                  selectedSpanId={selectedSpanId}
                  onSelect={(e) => setSelectedSpanId(e.span_id)}
                />
              )}
            </CardContent>
          </Card>

          <div>
            <EventDetail event={selected} />
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>What this page proves</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted">
            <p>
              The renderers above (
              <span className="font-mono-ui text-accent">TraceTree</span> and{" "}
              <span className="font-mono-ui text-accent">TraceWaterfall</span>
              ) accept any{" "}
              <span className="font-mono-ui text-accent">BoundaryEvent[]</span>{" "}
              — they don't know whether the events came from a mock fixture
              or a real run. When the Brain (Phase 2 Track A) hands real
              prompts to the real World API (Phase 2 Track C) on a real UE
              instance (Phase 3), this same page renders the live trace by
              reading from{" "}
              <span className="font-mono-ui text-accent">InMemorySink</span>{" "}
              instead of{" "}
              <span className="font-mono-ui text-accent">
                scenarios[…].build()
              </span>
              .
            </p>
            <p>
              That replacement is the only diff. Everything else — the parent /
              child tree, the timing, the colour-per-package, the
              click-to-inspect detail — already works.
            </p>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}

function ViewToggle<T extends string>({
  current,
  value,
  onClick,
  children,
}: {
  current: T;
  value: T;
  onClick: (next: T) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      className={cn(
        "rounded px-2 py-1 text-xs font-mono-ui transition-colors",
        current === value
          ? "bg-zinc-800 text-fg"
          : "text-muted hover:bg-zinc-900 hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}
