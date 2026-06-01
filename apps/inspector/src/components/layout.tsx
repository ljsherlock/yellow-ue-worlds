import { NavLink, Outlet } from "react-router";

import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  num: string;
  label: string;
  blurb: string;
}

const navItems: NavItem[] = [
  { to: "/01-prompt-to-tool-calls", num: "01", label: "Prompt → Tool Calls", blurb: "LLMClient" },
  { to: "/02-world-state-graph", num: "02", label: "World State Graph", blurb: "WorldMemoryStore" },
  { to: "/03-world-api-mock-bench", num: "03", label: "World API Mock Bench", blurb: "WorldAPIClient" },
  { to: "/04-rc-round-trip", num: "04", label: "RC Round-Trip", blurb: "RCBridge" },
  { to: "/05-pcg-inspector", num: "05", label: "PCG Inspector", blurb: "PCGRunner" },
  { to: "/06-streaming-diagnostics", num: "06", label: "Streaming Diagnostics", blurb: "StreamingMetrics" },
  { to: "/07-pipeline-trace-viewer", num: "07", label: "Pipeline Trace Viewer", blurb: "cross-cutting" },
];

export function Layout() {
  return (
    <div className="flex h-full">
      <aside className="flex w-72 flex-col border-r border-border bg-zinc-900/40">
        <div className="border-b border-border px-6 py-5">
          <NavLink to="/" className="block">
            <div className="text-xs font-mono-ui uppercase tracking-widest text-muted">
              yellow-ue-worlds
            </div>
            <div className="mt-1 text-lg font-semibold leading-tight">
              Inspector
            </div>
            <div className="text-xs text-muted">phase 1 — all boundaries mocked</div>
          </NavLink>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="space-y-1">
            {navItems.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      "flex items-baseline gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                      isActive
                        ? "bg-zinc-800 text-fg"
                        : "text-muted hover:bg-zinc-900 hover:text-fg",
                    )
                  }
                >
                  <span className="w-6 shrink-0 font-mono-ui text-xs text-accent">
                    {item.num}
                  </span>
                  <span className="flex-1">
                    <span className="block leading-tight">{item.label}</span>
                    <span className="block font-mono-ui text-xs text-muted">
                      {item.blurb}
                    </span>
                  </span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="border-t border-border px-6 py-4 text-xs text-muted">
          Every page consumes a real package boundary (R1).
        </div>
      </aside>
      <div className="flex flex-1 flex-col">
        <Outlet />
      </div>
    </div>
  );
}
