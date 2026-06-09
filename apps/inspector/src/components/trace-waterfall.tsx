import type { BoundaryEvent } from "@yellow-ue/tracing";

import {
  buildTraceTree,
  colorForName,
  flattenTree,
  traceBounds,
} from "@/lib/trace-utils";
import { cn } from "@/lib/utils";

interface TraceWaterfallProps {
  events: BoundaryEvent[];
  selectedSpanId: string | undefined;
  onSelect: (event: BoundaryEvent) => void;
}

export function TraceWaterfall({
  events,
  selectedSpanId,
  onSelect,
}: TraceWaterfallProps) {
  const tree = buildTraceTree(events);
  const ordered = flattenTree(tree);
  const bounds = traceBounds(events);

  if (bounds.total_ms === 0) {
    return <div className="text-sm text-muted">No events.</div>;
  }

  return (
    <div className="flex flex-col gap-1">
      {ordered.map((node) => {
        const { event, depth } = node;
        const left = ((event.start_ts - bounds.start) / bounds.total_ms) * 100;
        const widthRaw = (event.duration_ms / bounds.total_ms) * 100;
        // Floor at 0.4% so very short spans remain visible
        const width = Math.max(widthRaw, 0.4);
        const isError = event.status === "error";
        const isSelected = event.span_id === selectedSpanId;

        return (
          <button
            type="button"
            key={event.span_id}
            onClick={() => onSelect(event)}
            className={cn(
              "group grid grid-cols-[18rem_1fr] items-center rounded px-2 py-1 text-left hover:bg-zinc-900",
              isSelected && "bg-zinc-800",
            )}
          >
            <div
              className="truncate font-mono-ui text-xs"
              style={{ paddingLeft: `${depth * 12}px` }}
            >
              <span className="text-fg">{event.name}</span>
            </div>
            <div className="relative h-5">
              <div className="absolute inset-y-0 left-0 right-0 rounded bg-zinc-900/40" />
              <div
                className={cn(
                  "absolute inset-y-0 rounded",
                  isError ? "border border-danger" : "",
                )}
                style={{
                  left: `${left}%`,
                  width: `${width}%`,
                  background: isError
                    ? "color-mix(in oklch, var(--color-danger) 40%, transparent)"
                    : colorForName(event.name),
                  opacity: isError ? 1 : 0.85,
                }}
              />
              <span className="absolute inset-y-0 right-2 flex items-center font-mono-ui text-[10px] text-muted">
                {event.duration_ms.toFixed(0)}ms
              </span>
            </div>
          </button>
        );
      })}
      <div className="mt-2 text-[10px] text-muted font-mono-ui">
        total {bounds.total_ms.toFixed(0)}ms · {events.length} spans
      </div>
    </div>
  );
}
