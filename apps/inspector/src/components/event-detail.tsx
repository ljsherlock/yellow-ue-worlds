import type { BoundaryEvent } from "@yellow-ue/tracing";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface EventDetailProps {
  event: BoundaryEvent | undefined;
}

export function EventDetail({ event }: EventDetailProps) {
  if (!event) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No span selected</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted">
          Click a row to see its inputs, output, and metadata.
        </CardContent>
      </Card>
    );
  }

  const isError = event.status === "error";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="break-all">{event.name}</CardTitle>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <Pill className={isError ? "text-danger" : "text-ok"}>
            {event.status}
          </Pill>
          <Pill>{event.duration_ms.toFixed(1)}ms</Pill>
          <Pill>span {event.span_id.slice(-6)}</Pill>
          {event.parent_span_id && (
            <Pill>parent {event.parent_span_id.slice(-6)}</Pill>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Section title="trace">
          <KV k="trace_id" v={event.trace_id} mono />
          <KV k="span_id" v={event.span_id} mono />
          {event.parent_span_id && <KV k="parent_span_id" v={event.parent_span_id} mono />}
        </Section>

        <Section title="timing">
          <KV k="start_ts" v={new Date(event.start_ts).toISOString()} mono />
          <KV k="end_ts" v={new Date(event.end_ts).toISOString()} mono />
          <KV k="duration_ms" v={event.duration_ms.toFixed(2)} mono />
        </Section>

        {event.inputs !== undefined && (
          <Section title="inputs">
            <Json value={event.inputs} />
          </Section>
        )}

        {event.output !== undefined && (
          <Section title="output">
            <Json value={event.output} />
          </Section>
        )}

        {event.error && (
          <Section title="error">
            <KV k="message" v={event.error.message} />
            {event.error.stack && (
              <pre className="mt-2 max-h-48 overflow-auto rounded bg-zinc-900 p-2 text-[10px] font-mono-ui text-muted">
                {event.error.stack}
              </pre>
            )}
          </Section>
        )}
      </CardContent>
    </Card>
  );
}

function Pill({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex h-5 items-center rounded bg-zinc-900 px-2 font-mono-ui text-[10px] ${className}`}
    >
      {children}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted">
        {title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function KV({ k, v, mono = false }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex gap-3 text-xs">
      <span className="w-32 shrink-0 text-muted">{k}</span>
      <span className={`flex-1 ${mono ? "font-mono-ui" : ""} break-all`}>{v}</span>
    </div>
  );
}

function Json({ value }: { value: unknown }) {
  return (
    <pre className="max-h-72 overflow-auto rounded bg-zinc-900 p-2 text-[11px] font-mono-ui text-fg">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
