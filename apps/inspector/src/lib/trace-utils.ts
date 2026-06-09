import type { BoundaryEvent } from "@yellow-ue/tracing";

export interface TraceNode {
  event: BoundaryEvent;
  children: TraceNode[];
  depth: number;
}

/** Build a parent-child tree from a flat list of events. */
export function buildTraceTree(events: BoundaryEvent[]): TraceNode[] {
  const byId = new Map<string, TraceNode>();
  for (const event of events) {
    byId.set(event.span_id, { event, children: [], depth: 0 });
  }
  const roots: TraceNode[] = [];
  for (const event of events) {
    const node = byId.get(event.span_id)!;
    if (event.parent_span_id) {
      const parent = byId.get(event.parent_span_id);
      if (parent) {
        node.depth = parent.depth + 1;
        parent.children.push(node);
        continue;
      }
    }
    roots.push(node);
  }
  // Recompute depths recursively in case events arrived out of order
  const assignDepth = (node: TraceNode, depth: number) => {
    node.depth = depth;
    for (const child of node.children) assignDepth(child, depth + 1);
  };
  for (const root of roots) assignDepth(root, 0);
  return roots;
}

/** Extreme bounds of a trace — used by the waterfall to scale bars. */
export interface TraceBounds {
  start: number;
  end: number;
  total_ms: number;
}

export function traceBounds(events: BoundaryEvent[]): TraceBounds {
  if (events.length === 0) return { start: 0, end: 0, total_ms: 0 };
  let start = Infinity;
  let end = -Infinity;
  for (const e of events) {
    if (e.start_ts < start) start = e.start_ts;
    if (e.end_ts > end) end = e.end_ts;
  }
  return { start, end, total_ms: end - start };
}

/** Stable color per package prefix — used by tree and waterfall. */
const PACKAGE_COLORS: Record<string, string> = {
  brain: "oklch(0.75 0.18 280)", // purple
  llm: "oklch(0.75 0.18 320)", // magenta
  "memory-graph": "oklch(0.75 0.18 220)", // blue
  graphiti: "oklch(0.65 0.13 220)",
  "world-api": "oklch(0.85 0.18 95)", // yellow (project accent)
  "rc-bridge": "oklch(0.75 0.18 145)", // green
  rc: "oklch(0.65 0.13 145)",
};

export function colorForName(name: string): string {
  const prefix = name.split(".")[0]!;
  return PACKAGE_COLORS[prefix] ?? "oklch(0.55 0.02 280)";
}

/** Flatten a tree to a list in pre-order — used by waterfall. */
export function flattenTree(roots: TraceNode[]): TraceNode[] {
  const out: TraceNode[] = [];
  const walk = (node: TraceNode) => {
    out.push(node);
    for (const child of node.children) walk(child);
  };
  for (const root of roots) walk(root);
  return out;
}
