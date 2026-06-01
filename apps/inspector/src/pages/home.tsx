import { WORLD_API_VERSION } from "@yellow-ue/world-api";
import { NavLink } from "react-router";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageShell } from "@/components/page-shell";

const pages = [
  { num: "01", to: "/01-prompt-to-tool-calls", title: "Prompt → Tool Calls", desc: "What does the LLM say when shown a prompt?" },
  { num: "02", to: "/02-world-state-graph", title: "World State Graph", desc: "Memory at time t, time-travel reads, schema." },
  { num: "03", to: "/03-world-api-mock-bench", title: "World API Mock Bench", desc: "Call any WorldAPI tool against a fake UE." },
  { num: "04", to: "/04-rc-round-trip", title: "RC Round-Trip", desc: "Real Remote Control transport, latency, errors." },
  { num: "05", to: "/05-pcg-inspector", title: "PCG Inspector", desc: "Inputs and outputs of procedural graphs." },
  { num: "06", to: "/06-streaming-diagnostics", title: "Streaming Diagnostics", desc: "Codec, bitrate, FPS, RTT, packet loss." },
  { num: "07", to: "/07-pipeline-trace-viewer", title: "Pipeline Trace Viewer", desc: "End-to-end trace of one user prompt across every boundary." },
];

export function HomePage() {
  return (
    <PageShell
      title="Inspector"
      subtitle="One window per cross-package boundary. Each page is the integration test for that boundary."
      status="stub"
    >
      <div className="mb-6 rounded-md border border-border bg-zinc-900/40 p-4 text-sm">
        <div className="text-muted">Loaded from <span className="font-mono-ui text-accent">@yellow-ue/world-api</span>:</div>
        <div className="mt-1 font-mono-ui text-lg">{WORLD_API_VERSION}</div>
        <div className="mt-2 text-xs text-muted">
          If you can see this, the workspace package linking works and R1 is enforceable —
          the inspector consumed a real package, not a re-implementation.
        </div>
      </div>

      <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-muted">Pages</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {pages.map((page) => (
          <NavLink key={page.to} to={page.to} className="block">
            <Card className="h-full hover:border-accent transition-colors">
              <CardHeader>
                <CardTitle className="flex items-baseline gap-3">
                  <span className="font-mono-ui text-xs text-accent">{page.num}</span>
                  <span>{page.title}</span>
                </CardTitle>
                <CardDescription>{page.desc}</CardDescription>
              </CardHeader>
              <CardContent className="text-xs text-muted">
                Open inspector
              </CardContent>
            </Card>
          </NavLink>
        ))}
      </div>
    </PageShell>
  );
}
