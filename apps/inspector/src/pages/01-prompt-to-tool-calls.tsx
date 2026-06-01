import { PageShell } from "@/components/page-shell";

export function PromptToToolCallsPage() {
  return (
    <PageShell
      title="01 — Prompt → Tool Calls"
      subtitle="Given a user prompt, what tool calls does the LLM produce and why?"
      boundary="LLMClient"
      package="@yellow-ue/llm-brain (not built yet)"
      status="stub"
    >
      <p className="max-w-3xl text-sm text-muted">
        This page will accept a user prompt, run it through an LLM (real or
        mocked), and show the resulting <span className="font-mono-ui text-accent">WorldAPICall[]</span>{" "}
        plus the model's reasoning trace.
      </p>
      <p className="mt-4 max-w-3xl text-sm text-muted">
        Filled in when <span className="font-mono-ui text-accent">packages/llm-brain</span>{" "}
        lands in Phase 2 Track A. The mock variant for Phase 1 returns a
        scripted tool-call sequence per prompt.
      </p>
    </PageShell>
  );
}
