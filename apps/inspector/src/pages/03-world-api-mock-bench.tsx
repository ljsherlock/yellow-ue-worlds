import type { SkyPreset } from "@yellow-ue/world-api";
import { MockWorldAPIClient } from "@yellow-ue/world-api/mock";
import { InMemorySink, setSink, withTrace } from "@yellow-ue/tracing";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageShell } from "@/components/page-shell";

const skyPresets: SkyPreset[] = ["clear", "cloudy", "storm", "sunset", "night"];

/**
 * Page 03 — World API Mock Bench.
 *
 * R1 in action: imports the real `MockWorldAPIClient` and `boundary` sink from
 * the workspace packages. This page renders no business logic of its own —
 * it just shows what the boundary said.
 *
 * For the skeleton (Task 0.5) this page exists primarily to prove the
 * workspace linking is correct and React renders a real package's classes.
 * Full controls and event-stream rendering land in Task 0.6 / Phase 1.
 */
export function WorldApiMockBenchPage() {
  // Initialise the sink + client once
  const [{ client, sink }] = useState(() => {
    const sink = new InMemorySink();
    setSink(sink);
    const client = new MockWorldAPIClient();
    return { client, sink };
  });

  const [tick, setTick] = useState(0);
  const refresh = () => setTick((n) => n + 1);

  const setSky = async (preset: SkyPreset) => {
    await withTrace(undefined, () => client.setSkyState({ preset }));
    refresh();
  };

  const state = useMemo(() => {
    void tick; // re-read when refresh() bumps tick
    return client.snapshot();
  }, [client, tick]);

  return (
    <PageShell
      title="03 — World API Mock Bench"
      subtitle="Drive the in-memory MockWorldAPIClient. Inspector imports the real class; no business logic lives here."
      boundary="WorldAPIClient"
      package="@yellow-ue/world-api"
      status="mock"
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>setSkyState</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {skyPresets.map((preset) => (
              <Button
                key={preset}
                variant={state.sky === preset ? "default" : "outline"}
                size="sm"
                onClick={() => setSky(preset)}
              >
                {preset}
              </Button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Current world state</CardTitle>
          </CardHeader>
          <CardContent className="font-mono-ui text-xs">
            <pre>{JSON.stringify(state, null, 2)}</pre>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Boundary events ({sink.events.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {sink.events.length === 0 ? (
              <p className="text-sm text-muted">
                Click a preset above to emit a boundary event from{" "}
                <span className="font-mono-ui text-accent">world-api.setSkyState</span>.
              </p>
            ) : (
              <ol className="space-y-2 font-mono-ui text-xs">
                {sink.events.slice(-10).reverse().map((e) => (
                  <li
                    key={e.span_id}
                    className="rounded border border-border bg-zinc-900/60 p-2"
                  >
                    <div className="flex justify-between gap-2 text-muted">
                      <span className="text-accent">{e.name}</span>
                      <span>{e.duration_ms.toFixed(1)}ms · {e.status}</span>
                    </div>
                    <div className="mt-1 text-muted">trace {e.trace_id.slice(0, 12)}…</div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
