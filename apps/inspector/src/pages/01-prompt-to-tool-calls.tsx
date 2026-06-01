import type { LLMCompletionResult } from "@yellow-ue/llm-brain";
import { MockLLMClient } from "@yellow-ue/llm-brain/mock";
import { InMemorySink, setSink, withTrace } from "@yellow-ue/tracing";
import { useState } from "react";

import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const examplePrompts = [
  "make it stormy",
  "skip to morning",
  "plant 50 oaks here",
  "scatter a forest of birch saplings",
  "make it stormy and plant 50 oaks",
  "speed everything up 100x",
  "tell me a joke",
];

export function PromptToToolCallsPage() {
  const [{ client, sink }] = useState(() => {
    const sink = new InMemorySink();
    setSink(sink);
    return { client: new MockLLMClient(), sink };
  });

  const [prompt, setPrompt] = useState("make it stormy and plant 50 oaks");
  const [result, setResult] = useState<LLMCompletionResult | null>(null);
  const [lastMs, setLastMs] = useState<number | null>(null);
  const [running, setRunning] = useState(false);

  const run = async (p: string) => {
    if (!p.trim() || running) return;
    setRunning(true);
    const result = await withTrace(undefined, () => client.complete({ prompt: p }));
    const last = sink.byPrefix("llm-brain.").at(-1);
    setResult(result);
    setLastMs(last?.duration_ms ?? null);
    setRunning(false);
  };

  return (
    <PageShell
      title="01 — Prompt → Tool Calls"
      subtitle="Type a prompt; see exactly which WorldAPI tool calls the brain emits. Deterministic, zero-cost, reproducible."
      boundary="LLMClient"
      package="@yellow-ue/llm-brain (mock)"
      status="mock"
    >
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Prompt</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void run(prompt);
              }}
            >
              <input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="make it stormy…"
                className="flex-1 rounded-md border border-border bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-accent"
              />
              <Button type="submit" disabled={running}>
                {running ? "…" : "Run"}
              </Button>
            </form>
            <div className="flex flex-wrap gap-2">
              {examplePrompts.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => {
                    setPrompt(ex);
                    void run(ex);
                  }}
                  className="rounded-full border border-border px-3 py-1 text-xs text-muted hover:border-accent hover:text-fg"
                >
                  {ex}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {result && (
          <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
            <div className="space-y-4">
              <Card>
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle>
                    Tool calls ({result.toolCalls.length})
                  </CardTitle>
                  <span
                    className={`inline-flex h-5 items-center rounded px-2 font-mono-ui text-[10px] ${
                      result.finishReason === "tool_calls"
                        ? "bg-zinc-800 text-ok"
                        : "bg-zinc-800 text-muted"
                    }`}
                  >
                    {result.finishReason}
                  </span>
                </CardHeader>
                <CardContent className="space-y-3">
                  {result.toolCalls.length === 0 ? (
                    <p className="text-sm text-muted">
                      No tool calls. The brain recognised nothing actionable in
                      this prompt.
                    </p>
                  ) : (
                    result.toolCalls.map((call, i) => (
                      <div
                        key={i}
                        className="rounded-md border border-border bg-zinc-900/60 p-3"
                      >
                        <div className="mb-2 font-mono-ui text-sm text-accent">
                          {call.tool}
                        </div>
                        <pre className="overflow-auto font-mono-ui text-xs text-fg">
                          {JSON.stringify(call.args, null, 2)}
                        </pre>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Reasoning</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted">
                  {result.reasoning}
                </CardContent>
              </Card>
            </div>

            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Metadata</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 font-mono-ui text-xs">
                  <KV k="model" v={result.model} />
                  <KV k="tokens.in" v={String(result.tokens.input)} />
                  <KV k="tokens.out" v={String(result.tokens.output)} />
                  <KV
                    k="boundary"
                    v={lastMs !== null ? `${lastMs.toFixed(1)}ms` : "—"}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Raw result</CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="max-h-80 overflow-auto font-mono-ui text-[11px] text-fg">
                    {JSON.stringify(result, null, 2)}
                  </pre>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3">
      <span className="w-24 shrink-0 text-muted">{k}</span>
      <span className="flex-1 break-all text-fg">{v}</span>
    </div>
  );
}
