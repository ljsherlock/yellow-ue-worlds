# `@yellow-ue/inspector`

The dev/test surface for every cross-package boundary in `yellow-ue-worlds`.

> **Inspector pages are not debug tooling. They ARE the integration tests.**
> Per R5, every cross-package boundary must have a corresponding inspector
> page kept in sync. The production app is the *clean* runtime; the
> inspector is the *observable* runtime — same code, different UI.

## Stack

| Choice | Why |
|---|---|
| **Vite 8** | dev-server + build, fastest TS/JSX HMR |
| **React 19** | latest stable; class-field methods, transitions, `use()` |
| **React Router 7** | library mode, `createBrowserRouter` |
| **Tailwind CSS 4** | `@tailwindcss/vite` plugin, theme in CSS via `@theme` |
| **shadcn-style components** | hand-rolled Button / Card here; we add Radix-based components when we need them |

## Run

```sh
pnpm --filter @yellow-ue/inspector dev
# or from the root:
pnpm dev
```

## Page roster

| # | Route | Boundary | Source package |
|---|---|---|---|
| home | `/` | — | overview / R1 sanity |
| 01 | `/01-prompt-to-tool-calls` | `LLMClient` | `@yellow-ue/llm-brain` (Phase 2) |
| 02 | `/02-world-state-graph` | `WorldMemoryStore` | `@yellow-ue/memory-graph` (Phase 2) |
| 03 | `/03-world-api-mock-bench` | `WorldAPIClient` | `@yellow-ue/world-api` ✅ live |
| 04 | `/04-rc-round-trip` | `RCBridge` | `@yellow-ue/rc-bridge` (Phase 2) |
| 05 | `/05-pcg-inspector` | `PCGRunner` | `@yellow-ue/pcg` (Phase 2) |
| 06 | `/06-streaming-diagnostics` | `StreamingMetrics` | `@yellow-ue/streaming` (Phase 3) |
| 07 | `/07-pipeline-trace-viewer` | cross-cutting | `@yellow-ue/tracing` ✅ live (page 0.6 fills this) |

## R1 verification

The home page imports `WORLD_API_VERSION` from `@yellow-ue/world-api` and
prints it. If the workspace linking is broken, the page fails. If the
inspector ever needs to re-implement workspace logic, that's an R1
violation — fix in the package, not here.

## Path alias

`@/` resolves to `apps/inspector/src/`. Configured in
`tsconfig.json` (`paths`) and `vite.config.ts` (`resolve.alias`).
