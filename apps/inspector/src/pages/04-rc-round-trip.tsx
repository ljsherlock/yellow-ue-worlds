import { toRCFunctionCall, type RCResponse } from "@yellow-ue/rc-bridge";
import { MockRCBridge } from "@yellow-ue/rc-bridge/mock";
import { withTrace } from "@yellow-ue/tracing";
import type { WorldAPICall } from "@yellow-ue/world-api";
import { useMemo, useRef, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const examples: { label: string; call: WorldAPICall }[] = [
  { label: "SetSkyState(storm)", call: { tool: "SetSkyState", args: { preset: "storm" } } },
  { label: "AdvanceTime(6h, 100×)", call: { tool: "AdvanceTime", args: { hours: 6, speed_multiplier: 100 } } },
  {
    label: "SpawnTrees(50 oak)",
    call: {
      tool: "SpawnTrees",
      args: { area: { center: { x: 0, y: 0, z: 0 }, radius: 10 }, count: 50, species: "oak" },
    },
  },
];

interface LogEntry {
  id: string;
  fn: string;
  ok: boolean;
  status: number;
  latencyMs: number;
}

export function RcRoundTripPage() {
  const failRef = useRef(false);
  const [{ bridge }] = useState(() => ({
    bridge: new MockRCBridge({
      failOn: () => (failRef.current ? "ETIMEDOUT after 5000ms (UE unreachable)" : null),
    }),
  }));

  const [selected, setSelected] = useState(0);
  const [simulateFailure, setSimulateFailure] = useState(false);
  const [last, setLast] = useState<RCResponse | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [running, setRunning] = useState(false);

  const call = examples[selected]!.call;
  const rcCall = useMemo(() => toRCFunctionCall(call), [call]);

  const send = async () => {
    if (running) return;
    failRef.current = simulateFailure;
    setRunning(true);
    const res = await withTrace(undefined, () => bridge.callFunction(rcCall));
    setLast(res);
    setLog((prev) =>
      [{ id: res.requestId, fn: rcCall.functionName, ok: res.ok, status: res.httpStatus, latencyMs: res.latencyMs }, ...prev].slice(0, 12),
    );
    setRunning(false);
  };

  const latencies = log.map((l) => l.latencyMs);
  const avg = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;

  return (
    <PageShell
      title="04 — RC Round-Trip"
      subtitle="Send a WorldAPI tool call through the Unreal Remote Control transport. See the exact wire request, the response, and the latency. No LLM, no graph."
      boundary="RCBridge"
      package="@yellow-ue/rc-bridge (mock)"
      status="mock"
    >
      <div className="mb-6 rounded-md border border-border bg-zinc-900/40 p-3 text-xs text-muted">
        ⚠️ Wire format is modeled after UE Remote Control and{" "}
        <span className="text-accent">not yet verified against UE 5.7</span> —
        that happens in Phase 2 Track C against a running engine.
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>1 · Pick a tool call</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {examples.map((ex, i) => (
                <Button
                  key={ex.label}
                  size="sm"
                  variant={i === selected ? "default" : "outline"}
                  onClick={() => setSelected(i)}
                >
                  {ex.label}
                </Button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={simulateFailure}
                onChange={(e) => setSimulateFailure(e.target.checked)}
              />
              simulate UE unreachable (timeout)
            </label>
            <Button onClick={() => void send()} disabled={running}>
              {running ? "sending…" : "Send to UE (mock)"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2 · Wire request</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-2 font-mono-ui text-xs text-muted">
              <span className="text-accent">PUT</span> /remote/object/call
            </div>
            <pre className="overflow-auto font-mono-ui text-[11px] text-fg">
              {JSON.stringify(rcCall, null, 2)}
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>3 · Response</CardTitle>
          </CardHeader>
          <CardContent>
            {!last ? (
              <p className="text-sm text-muted">Send a call to see the response.</p>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2 font-mono-ui text-xs">
                  <Pill className={last.ok ? "text-ok" : "text-danger"}>
                    {last.ok ? "200 OK" : `${last.httpStatus} ERR`}
                  </Pill>
                  <Pill>{last.latencyMs.toFixed(0)}ms</Pill>
                  <Pill>{last.requestId}</Pill>
                </div>
                <pre className="overflow-auto font-mono-ui text-[11px] text-fg">
                  {JSON.stringify(last.error ?? last.returnValue, null, 2)}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Round-trip log</CardTitle>
            {log.length > 0 && (
              <span className="font-mono-ui text-xs text-muted">avg {avg.toFixed(0)}ms</span>
            )}
          </CardHeader>
          <CardContent>
            {log.length === 0 ? (
              <p className="text-sm text-muted">No sends yet.</p>
            ) : (
              <ol className="space-y-1 font-mono-ui text-xs">
                {log.map((l) => (
                  <li
                    key={l.id}
                    className="flex items-center justify-between rounded border border-border bg-zinc-900/60 px-2 py-1"
                  >
                    <span className="text-fg">{l.fn}</span>
                    <span className="flex items-center gap-3">
                      <span className={cn(l.ok ? "text-ok" : "text-danger")}>
                        {l.ok ? l.status : `${l.status} err`}
                      </span>
                      <span className="text-muted">{l.latencyMs.toFixed(0)}ms</span>
                    </span>
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

function Pill({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex h-5 items-center rounded bg-zinc-900 px-2 ${className}`}>
      {children}
    </span>
  );
}
