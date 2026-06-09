import { createBrowserRouter } from "react-router";

import { Layout } from "@/components/layout";
import { HomePage } from "@/pages/home";
import { PromptToToolCallsPage } from "@/pages/01-prompt-to-tool-calls";
import { WorldStateGraphPage } from "@/pages/02-world-state-graph";
import { WorldApiMockBenchPage } from "@/pages/03-world-api-mock-bench";
import { RcRoundTripPage } from "@/pages/04-rc-round-trip";
import { PcgInspectorPage } from "@/pages/05-pcg-inspector";
import { StreamingDiagnosticsPage } from "@/pages/06-streaming-diagnostics";
import { PipelineTraceViewerPage } from "@/pages/07-pipeline-trace-viewer";
import { EcosystemSimPage } from "@/pages/08-ecosystem-sim";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "01-prompt-to-tool-calls", element: <PromptToToolCallsPage /> },
      { path: "02-world-state-graph", element: <WorldStateGraphPage /> },
      { path: "03-world-api-mock-bench", element: <WorldApiMockBenchPage /> },
      { path: "04-rc-round-trip", element: <RcRoundTripPage /> },
      { path: "05-pcg-inspector", element: <PcgInspectorPage /> },
      { path: "06-streaming-diagnostics", element: <StreamingDiagnosticsPage /> },
      { path: "07-pipeline-trace-viewer", element: <PipelineTraceViewerPage /> },
      { path: "08-ecosystem-sim", element: <EcosystemSimPage /> },
    ],
  },
]);
