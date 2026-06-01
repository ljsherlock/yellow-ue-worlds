import type { ReactNode } from "react";

interface PageShellProps {
  title: string;
  subtitle?: string;
  boundary?: string;
  package?: string;
  status: "mock" | "real" | "stub";
  children: ReactNode;
}

const statusStyles: Record<PageShellProps["status"], string> = {
  stub: "bg-zinc-800 text-muted",
  mock: "bg-zinc-800 text-accent",
  real: "bg-zinc-800 text-ok",
};

const statusLabels: Record<PageShellProps["status"], string> = {
  stub: "stub",
  mock: "mock data",
  real: "real backend",
};

export function PageShell({
  title,
  subtitle,
  boundary,
  package: packageName,
  status,
  children,
}: PageShellProps) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-border px-8 py-6">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {subtitle && (
              <p className="mt-1 max-w-3xl text-sm text-muted">{subtitle}</p>
            )}
          </div>
          <span
            className={`inline-flex h-6 items-center rounded-md px-2 text-xs font-medium ${statusStyles[status]}`}
          >
            {statusLabels[status]}
          </span>
        </div>
        {(boundary || packageName) && (
          <div className="mt-3 flex flex-wrap gap-4 text-xs font-mono-ui text-muted">
            {boundary && (
              <span>
                boundary <span className="text-accent">{boundary}</span>
              </span>
            )}
            {packageName && (
              <span>
                package <span className="text-accent">{packageName}</span>
              </span>
            )}
          </div>
        )}
      </header>
      <main className="flex-1 overflow-auto px-8 py-6">{children}</main>
    </div>
  );
}
