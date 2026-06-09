import {
  isValidAt,
  seedDemoWorld,
  type Fact,
} from "@yellow-ue/memory-graph";
import { MockWorldMemoryStore } from "@yellow-ue/memory-graph/mock";
import { useEffect, useMemo, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const MAX_T = 30;

export function WorldStateGraphPage() {
  const [store] = useState(() => new MockWorldMemoryStore());
  const [allFacts, setAllFacts] = useState<Fact[]>([]);
  const [t, setT] = useState(5);

  useEffect(() => {
    let alive = true;
    void (async () => {
      await seedDemoWorld(store);
      const facts = await store.read({});
      if (alive) setAllFacts(facts);
    })();
    return () => {
      alive = false;
    };
  }, [store]);

  const snapshot = useMemo(
    () => allFacts.filter((f) => isValidAt(f, t)),
    [allFacts, t],
  );

  const byType = useMemo(() => {
    const m = new Map<string, Fact[]>();
    for (const f of snapshot) {
      const list = m.get(f.type) ?? [];
      list.push(f);
      m.set(f.type, list);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [snapshot]);

  return (
    <PageShell
      title="02 — World State Graph"
      subtitle="Scrub world-time and see which facts were valid. Memory is temporal: the storm ended when sunset began, but it's still in history."
      boundary="WorldMemoryStore"
      package="@yellow-ue/memory-graph (mock)"
      status="mock"
    >
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>World-time</CardTitle>
            <span className="font-mono-ui text-sm text-accent">t = {t}h</span>
          </CardHeader>
          <CardContent>
            <input
              type="range"
              min={0}
              max={MAX_T}
              value={t}
              onChange={(e) => setT(Number(e.target.value))}
              className="w-full accent-[var(--color-accent)]"
            />
            <div className="mt-1 flex justify-between font-mono-ui text-[10px] text-muted">
              <span>0h</span>
              <span>{MAX_T}h</span>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Snapshot at t = {t}h ({snapshot.length} facts)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {byType.length === 0 ? (
                <p className="text-sm text-muted">No facts valid yet.</p>
              ) : (
                byType.map(([type, facts]) => (
                  <div key={type}>
                    <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted">
                      {type} ({facts.length})
                    </div>
                    <div className="space-y-1">
                      {facts.map((f) => (
                        <div
                          key={f.id}
                          className="rounded border border-border bg-zinc-900/60 px-2 py-1 font-mono-ui text-xs"
                        >
                          <span className="text-accent">{f.entityId}</span>{" "}
                          {JSON.stringify(f.properties)}
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Fact timeline (validity spans)</CardTitle>
            </CardHeader>
            <CardContent>
              <FactTimeline facts={allFacts} maxT={MAX_T} t={t} />
            </CardContent>
          </Card>
        </div>
      </div>
    </PageShell>
  );
}

function FactTimeline({ facts, maxT, t }: { facts: Fact[]; maxT: number; t: number }) {
  if (facts.length === 0) {
    return <p className="text-sm text-muted">Loading…</p>;
  }
  const sorted = [...facts].sort(
    (a, b) => a.type.localeCompare(b.type) || a.validFrom - b.validFrom,
  );
  const playheadPct = (t / maxT) * 100;

  return (
    <div className="relative space-y-1">
      <div
        className="pointer-events-none absolute bottom-0 top-0 z-10 w-px bg-accent"
        style={{ left: `calc(12rem + ${playheadPct}% * (1 - 12rem / 100))` }}
        aria-hidden
      />
      {sorted.map((f) => {
        const start = (f.validFrom / maxT) * 100;
        const end = ((f.validTo ?? maxT) / maxT) * 100;
        const width = Math.max(end - start, 1.5);
        const active = isValidAt(f, t);
        return (
          <div key={f.id} className="grid grid-cols-[12rem_1fr] items-center gap-2">
            <span className="truncate font-mono-ui text-[11px] text-muted">
              {f.type}/{f.entityId}
            </span>
            <div className="relative h-4">
              <div className="absolute inset-0 rounded bg-zinc-900/40" />
              <div
                className={cn(
                  "absolute inset-y-0 rounded",
                  active ? "opacity-100" : "opacity-40",
                )}
                style={{
                  left: `${start}%`,
                  width: `${width}%`,
                  background: active
                    ? "var(--color-accent)"
                    : "var(--color-muted)",
                }}
                title={`${f.type}/${f.entityId} · ${f.validFrom}h → ${f.validTo ?? "now"}`}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
