import { spawnTreesToPCGRequest, type PCGRunResult } from "@yellow-ue/pcg";
import { MockPCGRunner } from "@yellow-ue/pcg/mock";
import { withTrace } from "@yellow-ue/tracing";
import { useEffect, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Species = "oak" | "pine" | "birch";
type Growth = "seedling" | "sapling" | "mature";

const speciesColor: Record<Species, string> = {
  oak: "oklch(0.7 0.15 130)",
  pine: "oklch(0.6 0.13 160)",
  birch: "oklch(0.85 0.08 110)",
};

export function PcgInspectorPage() {
  const [runner] = useState(() => new MockPCGRunner());
  const [count, setCount] = useState(50);
  const [radius, setRadius] = useState(10);
  const [species, setSpecies] = useState<Species>("oak");
  const [growth, setGrowth] = useState<Growth>("mature");
  const [seed, setSeed] = useState(1);
  const [result, setResult] = useState<PCGRunResult | null>(null);

  const run = async () => {
    const req = spawnTreesToPCGRequest(
      {
        tool: "SpawnTrees",
        args: {
          area: { center: { x: 0, y: 0, z: 0 }, radius },
          count,
          species,
          growth_stage: growth,
        },
      },
      seed,
    );
    const res = await withTrace(undefined, () => runner.run(req));
    setResult(res);
  };

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <PageShell
      title="05 — PCG Inspector"
      subtitle="Parameterize the ScatterTrees PCG graph and see what it generates. Deterministic per seed — the same inputs reproduce the same point cloud."
      boundary="PCGRunner"
      package="@yellow-ue/pcg (mock)"
      status="mock"
    >
      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Parameters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <Slider label="count" value={count} min={1} max={500} onChange={setCount} />
            <Slider label="radius" value={radius} min={1} max={50} onChange={setRadius} />
            <Slider label="seed" value={seed} min={1} max={20} onChange={setSeed} />
            <Choice label="species" options={["oak", "pine", "birch"]} value={species} onChange={(v) => setSpecies(v as Species)} />
            <Choice label="growth" options={["seedling", "sapling", "mature"]} value={growth} onChange={(v) => setGrowth(v as Growth)} />
            <Button onClick={() => void run()} className="w-full">
              Run PCG graph
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Top-down scatter</CardTitle>
              {result && (
                <span className="font-mono-ui text-xs text-muted">
                  {result.count} pts · {result.durationMs}ms · seed {result.seed}
                </span>
              )}
            </CardHeader>
            <CardContent>
              {result && <Scatter result={result} radius={radius} color={speciesColor[species]} />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>First 8 generated points</CardTitle>
            </CardHeader>
            <CardContent>
              {result && (
                <ol className="space-y-1 font-mono-ui text-[11px]">
                  {result.points.slice(0, 8).map((p, i) => (
                    <li key={i} className="rounded border border-border bg-zinc-900/60 px-2 py-1 text-muted">
                      ({p.position.x.toFixed(1)}, {p.position.y.toFixed(1)}) · scale {p.scale} · yaw {p.rotationYaw}°
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PageShell>
  );
}

function Scatter({ result, radius, color }: { result: PCGRunResult; radius: number; color: string }) {
  const size = 320;
  const c = size / 2;
  const scale = (c - 12) / radius;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto block w-full max-w-md">
      <circle cx={c} cy={c} r={radius * scale} fill="oklch(0.22 0.01 280)" stroke="var(--color-border)" />
      <line x1={c} y1={c - 4} x2={c} y2={c + 4} stroke="var(--color-muted)" />
      <line x1={c - 4} y1={c} x2={c + 4} y2={c} stroke="var(--color-muted)" />
      {result.points.map((p, i) => (
        <circle
          key={i}
          cx={c + p.position.x * scale}
          cy={c + p.position.y * scale}
          r={Math.max(1.5, p.scale * 3)}
          fill={color}
          opacity={0.8}
        />
      ))}
    </svg>
  );
}

function Slider({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <label className="block">
      <div className="mb-1 flex justify-between font-mono-ui text-xs">
        <span className="text-muted">{label}</span>
        <span className="text-accent">{value}</span>
      </div>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[var(--color-accent)]" />
    </label>
  );
}

function Choice({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <div className="mb-1 font-mono-ui text-xs text-muted">{label}</div>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => (
          <Button key={o} size="sm" variant={o === value ? "default" : "outline"} onClick={() => onChange(o)}>
            {o}
          </Button>
        ))}
      </div>
    </div>
  );
}
