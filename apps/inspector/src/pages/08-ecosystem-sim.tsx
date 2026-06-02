import {
  InMemoryWorldModel,
  MockEcologist,
  SAVANNA_SCENE,
  type Ecologist,
  type SceneSpec,
  type WorldModelState,
  type BehaviourState,
  type Weather,
} from "@yellow-ue/world-model";
import { BrainHttpClient } from "@yellow-ue/llm-brain/http";
import { withTrace } from "@yellow-ue/tracing";
import { useEffect, useMemo, useRef, useState } from "react";

import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const STATE_COLOR: Record<BehaviourState, string> = {
  idle: "#52525b",
  graze: "#4ade80",
  flee: "#f87171",
  stalk: "#fb923c",
  attack: "#ef4444",
  rest: "#818cf8",
  drink: "#38bdf8",
  patrol: "#fbbf24",
};

const WEATHER_PRESETS: Weather["preset"][] = ["clear", "cloudy", "storm", "sunset", "night"];

const CANVAS = 560;

export function EcosystemSimPage() {
  const modelRef = useRef<InMemoryWorldModel>(new InMemoryWorldModel({ seed: 7 }));
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runningRef = useRef(true);
  const speedRef = useRef(1);

  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [weather, setWeatherState] = useState<Weather>({ preset: "clear", temperature: 0.8, timeOfDay: 12 });
  const [prompt, setPrompt] = useState("A savanna with a watering hole and a jeep driving around");
  const [mode, setMode] = useState<"mock" | "live">("mock");
  const [reasoning, setReasoning] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{ counts: Record<string, number>; rels: WorldModelState["relationships"]; elapsed: number }>(
    { counts: {}, rels: [], elapsed: 0 },
  );

  runningRef.current = running;
  speedRef.current = speed;

  // The director boundary: MockEcologist (keyless) or the live Python brain.
  // Both satisfy the same `Ecologist` interface, so this is the only line that
  // changes between offline and Gemini-backed reasoning (R2).
  const ecologist = useMemo<Ecologist>(
    () => (mode === "live" ? new BrainHttpClient() : new MockEcologist()),
    [mode],
  );

  const loadScene = async (spec: SceneSpec) => {
    const s = await modelRef.current.loadScene(spec);
    setWeatherState(s.weather);
  };

  const direct = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await withTrace(undefined, () => ecologist.populate(prompt));
      setReasoning(`${result.reasoning} · ${result.model}`);
      await loadScene(result.scene);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const setWeather = async (patch: Partial<Weather>) => {
    const s = await modelRef.current.setWeather(patch);
    setWeatherState(s.weather);
  };

  // load the savanna once on mount
  useEffect(() => {
    void loadScene(SAVANNA_SCENE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // render + step loop
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const realDt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const model = modelRef.current;
      if (runningRef.current) {
        const dt = realDt * speedRef.current;
        const substeps = Math.max(1, Math.ceil(dt / 0.05));
        for (let i = 0; i < substeps; i++) model.step(dt / substeps);
      }
      draw(canvasRef.current, model.getState());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // sample stats a few times a second (avoid 60fps React churn)
  useEffect(() => {
    const id = setInterval(() => {
      const s = modelRef.current.getState();
      const counts: Record<string, number> = {};
      for (const e of s.entities) {
        if (e.kind !== "animal") continue;
        counts[e.state] = (counts[e.state] ?? 0) + 1;
      }
      setStats({ counts, rels: s.relationships, elapsed: s.elapsed });
    }, 250);
    return () => clearInterval(id);
  }, []);

  return (
    <PageShell
      title="08 — Ecosystem Sim"
      subtitle="The LLM director declares species, relationships and weather; a deterministic per-tick sim turns that into emergent behaviour. Watch lions stalk the herd, prey flee, the midday heat pull grazers to water, and a sated lion rest."
      boundary="WorldModel + stepWorld"
      package="@yellow-ue/world-model"
      status="real"
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Top-down arena</CardTitle>
              <span className="font-mono-ui text-xs text-muted">
                t={stats.elapsed.toFixed(1)}s · {weather.preset} · {(weather.temperature * 100) | 0}% heat · {weather.timeOfDay.toFixed(0)}:00
              </span>
            </CardHeader>
            <CardContent>
              <canvas
                ref={canvasRef}
                width={CANVAS}
                height={CANVAS}
                className="mx-auto block w-full max-w-[560px] rounded-md border border-border"
                style={{ background: "oklch(0.18 0.01 110)" }}
              />
              <StateLegend />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Director</CardTitle>
              <div className="flex gap-1">
                <Button size="sm" variant={mode === "mock" ? "default" : "outline"} onClick={() => setMode("mock")}>
                  mock
                </Button>
                <Button size="sm" variant={mode === "live" ? "default" : "outline"} onClick={() => setMode("live")}>
                  live (Gemini)
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                className="w-full resize-none rounded-md border border-border bg-zinc-900/60 px-3 py-2 font-mono-ui text-xs"
              />
              <Button className="w-full" disabled={busy} onClick={() => void direct()}>
                {busy ? "Directing…" : `Direct scene (${mode === "live" ? "Gemini brain" : "mock ecologist"})`}
              </Button>
              {reasoning && <p className="font-mono-ui text-[11px] text-accent">{reasoning}</p>}
              {error && (
                <p className="rounded border border-danger/40 bg-danger/10 px-2 py-1 font-mono-ui text-[11px] text-danger">
                  {error}
                </p>
              )}
              <p className="text-xs text-muted">
                {mode === "live"
                  ? "Calls the Python brain at :8000 → Gemini infers the species, relationships and weather. Needs the brain running (uv run python -m brain) with GOOGLE_API_KEY; otherwise it falls back to the Fake ecologist."
                  : "Keyless stand-in: keyword biome lookup. Same SceneSpec contract the live brain emits."}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Simulation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="flex gap-2">
                <Button className="flex-1" variant={running ? "default" : "outline"} onClick={() => setRunning((r) => !r)}>
                  {running ? "Pause" : "Play"}
                </Button>
                <Button className="flex-1" variant="outline" onClick={() => void loadScene(SAVANNA_SCENE)}>
                  Reset
                </Button>
              </div>
              <Slider label="speed" value={speed} min={0.25} max={6} step={0.25} onChange={setSpeed} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Weather</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="flex flex-wrap gap-1">
                {WEATHER_PRESETS.map((p) => (
                  <Button key={p} size="sm" variant={p === weather.preset ? "default" : "outline"} onClick={() => void setWeather({ preset: p })}>
                    {p}
                  </Button>
                ))}
              </div>
              <Slider label="temperature" value={weather.temperature} min={0} max={1} step={0.05} onChange={(v) => void setWeather({ temperature: v })} />
              <Slider label="time of day" value={weather.timeOfDay} min={0} max={24} step={1} onChange={(v) => void setWeather({ timeOfDay: v })} />
              <p className="text-xs text-muted">Midday heat pulls grazers to water and makes predators rest.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>What's happening</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 font-mono-ui text-xs">
              {Object.entries(stats.counts).length === 0 && <span className="text-muted">—</span>}
              {Object.entries(stats.counts)
                .sort((a, b) => b[1] - a[1])
                .map(([state, n]) => (
                  <div key={state} className="flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-2 w-2 rounded-full" style={{ background: STATE_COLOR[state as BehaviourState] }} />
                      {state}
                    </span>
                    <span className="text-accent">{n}</span>
                  </div>
                ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Relationships</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 font-mono-ui text-[11px] text-muted">
              {stats.rels.map((r, i) => (
                <div key={i}>
                  {r.subject} <span className="text-accent">{r.predicate}</span> {r.object}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </PageShell>
  );
}

function draw(canvas: HTMLCanvasElement | null, state: WorldModelState): void {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const scale = CANVAS / state.bounds;
  ctx.clearRect(0, 0, CANVAS, CANVAS);

  // features (watering hole) first, as ground
  for (const e of state.entities) {
    if (e.kind !== "feature") continue;
    ctx.beginPath();
    ctx.arc(e.pos.x * scale, e.pos.y * scale, e.radius * scale, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(56,189,248,0.25)";
    ctx.fill();
    ctx.strokeStyle = e.color;
    ctx.stroke();
  }

  // plants
  for (const e of state.entities) {
    if (e.kind !== "plant") continue;
    ctx.beginPath();
    ctx.arc(e.pos.x * scale, e.pos.y * scale, Math.max(2, e.radius * scale * 0.7), 0, Math.PI * 2);
    ctx.fillStyle = e.color;
    ctx.globalAlpha = 0.7;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // animals + vehicles
  for (const e of state.entities) {
    if (e.kind === "feature" || e.kind === "plant") continue;
    const x = e.pos.x * scale;
    const y = e.pos.y * scale;
    const r = Math.max(3, e.radius * scale);

    // heading line
    const sp = Math.hypot(e.vel.x, e.vel.y);
    if (sp > 0.01) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (e.vel.x / sp) * r * 1.8, y + (e.vel.y / sp) * r * 1.8);
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    if (e.kind === "vehicle") {
      ctx.fillStyle = e.color;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    } else {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = e.color;
      ctx.fill();
      // state ring + thicker for predators
      ctx.lineWidth = e.diet === "predator" ? 3 : 2;
      ctx.strokeStyle = STATE_COLOR[e.state];
      ctx.stroke();
    }
  }
}

function StateLegend() {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono-ui text-[11px] text-muted">
      {(Object.keys(STATE_COLOR) as BehaviourState[]).map((s) => (
        <span key={s} className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: STATE_COLOR[s] }} />
          {s}
        </span>
      ))}
    </div>
  );
}

function Slider({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (n: number) => void }) {
  return (
    <label className="block">
      <div className="mb-1 flex justify-between font-mono-ui text-xs">
        <span className="text-muted">{label}</span>
        <span className="text-accent">{value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[var(--color-accent)]" />
    </label>
  );
}
