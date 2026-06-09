import type { BoundaryEvent } from "@yellow-ue/tracing";

import {
  buildTraceTree,
  colorForName,
  flattenTree,
  type TraceNode,
} from "@/lib/trace-utils";
import { cn } from "@/lib/utils";

interface TraceTreeProps {
  events: BoundaryEvent[];
  selectedSpanId: string | undefined;
  onSelect: (event: BoundaryEvent) => void;
}

export function TraceTree({ events, selectedSpanId, onSelect }: TraceTreeProps) {
  const tree = buildTraceTree(events);
  const flat = flattenTree(tree);

  return (
    <ol className="font-mono-ui text-xs">
      {flat.map((node) => (
        <Row
          key={node.event.span_id}
          node={node}
          selected={node.event.span_id === selectedSpanId}
          onSelect={onSelect}
        />
      ))}
    </ol>
  );
}

interface RowProps {
  node: TraceNode;
  selected: boolean;
  onSelect: (event: BoundaryEvent) => void;
}

function Row({ node, selected, onSelect }: RowProps) {
  const { event, depth, children } = node;
  const isError = event.status === "error";
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(event)}
        className={cn(
          "flex w-full items-baseline gap-2 rounded px-2 py-1 text-left hover:bg-zinc-900",
          selected && "bg-zinc-800",
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <span
          aria-hidden
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ background: isError ? "var(--color-danger)" : colorForName(event.name) }}
        />
        <span className="flex-1 truncate text-fg">{event.name}</span>
        {children.length > 0 && (
          <span className="text-muted">({children.length})</span>
        )}
        <span className="text-muted">{event.duration_ms.toFixed(1)}ms</span>
        <span
          className={cn(
            "ml-2 inline-flex h-4 items-center rounded px-1 text-[10px] uppercase",
            isError ? "bg-zinc-800 text-danger" : "bg-zinc-900 text-ok",
          )}
        >
          {event.status}
        </span>
      </button>
    </li>
  );
}
