import { TraceBuilder, type BoundaryEvent } from "@yellow-ue/tracing";

/**
 * Mock traces for the Pipeline Trace Viewer (page 07).
 *
 * Each scenario reflects what one user prompt looks like as it crosses
 * every boundary. When the real backends arrive in Phase 2, the renderers
 * in `@/components/trace-*` will visualize their events the same way.
 *
 * R1 note: these scenarios reference boundary names from packages that
 * don't exist yet (`brain.*`, `memory-graph.*`, `rc-bridge.*`). They live
 * here in the inspector because they encode app-shaped assumptions, not
 * package logic. When the real packages land, the scenarios get deleted
 * or repurposed as snapshot-test fixtures.
 */

export interface MockScenario {
  id: string;
  label: string;
  prompt: string;
  description: string;
  build: () => BoundaryEvent[];
}

const BASE = 1_717_300_000_000; // a fixed instant — stable snapshots

function makeStormSuccessTrace(): BoundaryEvent[] {
  const b = new TraceBuilder("demo-storm-success", BASE);

  b.add({
    name: "brain.handle-prompt",
    label: "root",
    start_offset_ms: 0,
    duration_ms: 445,
    inputs: { prompt: "make it stormy", user_id: "demo" },
    output: { tool_calls_applied: 1, world_facts_written: 1 },
  });

  b.add({
    name: "llm.complete",
    start_offset_ms: 5,
    duration_ms: 195,
    parent: "root",
    inputs: {
      model: "claude-4.6-sonnet",
      system: "You drive a real-time 3D world via the WorldAPI…",
      user: "make it stormy",
    },
    output: {
      tool_calls: [{ tool: "SetSkyState", args: { preset: "storm" } }],
      reasoning: "User wants an atmospheric change. Sky preset 'storm' matches.",
      tokens: { input: 412, output: 38 },
    },
  });

  b.add({
    name: "memory-graph.read-context",
    label: "mem-read",
    start_offset_ms: 205,
    duration_ms: 6,
    parent: "root",
    inputs: { query: "current world state", at: null },
    output: { facts_returned: 3 },
  });

  b.add({
    name: "graphiti.query",
    start_offset_ms: 206,
    duration_ms: 4,
    parent: "mem-read",
    inputs: {
      cypher:
        "MATCH (s:SkyState) WHERE s.valid_to IS NULL RETURN s ORDER BY s.valid_from DESC LIMIT 1",
    },
    output: { rows: 1, current: { preset: "clear", valid_from: "2026-06-01T21:59:00Z" } },
  });

  b.add({
    name: "brain.plan-tool-calls",
    start_offset_ms: 215,
    duration_ms: 5,
    parent: "root",
    inputs: {
      context_facts: 3,
      proposed: [{ tool: "SetSkyState", args: { preset: "storm" } }],
    },
    output: { dispatched: 1, skipped: 0 },
  });

  b.add({
    name: "world-api.dispatch",
    label: "dispatch",
    start_offset_ms: 225,
    duration_ms: 215,
    parent: "root",
    inputs: { tool: "SetSkyState", args: { preset: "storm" } },
    output: {
      tool: "SetSkyState",
      result: { ok: true, data: { current: "storm" } },
    },
  });

  b.add({
    name: "world-api.setSkyState",
    label: "set-sky",
    start_offset_ms: 226,
    duration_ms: 213,
    parent: "dispatch",
    inputs: [{ preset: "storm", transition_seconds: 5 }],
    output: {
      ok: true,
      data: {
        previous: "clear",
        current: "storm",
        transition_seconds: 5,
        applied_at: "2026-06-01T22:00:00.225Z",
      },
    },
  });

  b.add({
    name: "rc-bridge.send",
    label: "rc-send",
    start_offset_ms: 230,
    duration_ms: 205,
    parent: "set-sky",
    inputs: {
      endpoint: "/remote/preset/MainAtmosphere/SkyPreset",
      method: "PUT",
      body: { Value: "storm", TransitionSeconds: 5 },
    },
    output: { http_status: 200, applied_at_frame: 1240387 },
  });

  b.add({
    name: "rc.http.PUT",
    start_offset_ms: 232,
    duration_ms: 201,
    parent: "rc-send",
    inputs: {
      url: "http://ue-instance.local:30010/remote/preset/MainAtmosphere/SkyPreset",
      method: "PUT",
    },
    output: { status: 200, ms: 201 },
  });

  b.add({
    name: "memory-graph.write",
    label: "mem-write",
    start_offset_ms: 435,
    duration_ms: 8,
    parent: "root",
    inputs: {
      fact: {
        type: "SkyState",
        preset: "storm",
        valid_from: "2026-06-01T22:00:00.225Z",
        invalidates: "fact-871",
      },
    },
    output: { fact_id: "fact-872" },
  });

  b.add({
    name: "graphiti.add-fact",
    start_offset_ms: 437,
    duration_ms: 5,
    parent: "mem-write",
    inputs: { node_label: "SkyState", properties: { preset: "storm" } },
    output: { id: "fact-872" },
  });

  return b.build();
}

function makeRcTimeoutTrace(): BoundaryEvent[] {
  const b = new TraceBuilder("demo-rc-timeout", BASE);

  b.add({
    name: "brain.handle-prompt",
    label: "root",
    start_offset_ms: 0,
    duration_ms: 5_220,
    status: "error",
    inputs: { prompt: "plant 50 oaks here", user_id: "demo" },
    error: {
      message:
        "tool dispatch failed: rc-bridge.send timed out after 5000ms (UE instance unreachable?)",
    },
  });

  b.add({
    name: "llm.complete",
    start_offset_ms: 5,
    duration_ms: 188,
    parent: "root",
    inputs: { model: "claude-4.6-sonnet", user: "plant 50 oaks here" },
    output: {
      tool_calls: [
        {
          tool: "SpawnTrees",
          args: {
            area: { center: { x: 0, y: 0, z: 0 }, radius: 10 },
            count: 50,
            species: "oak",
          },
        },
      ],
      tokens: { input: 415, output: 62 },
    },
  });

  b.add({
    name: "world-api.dispatch",
    label: "dispatch",
    start_offset_ms: 200,
    duration_ms: 5_018,
    parent: "root",
    status: "error",
    inputs: { tool: "SpawnTrees", args: { species: "oak", count: 50 } },
    error: { message: "downstream rc-bridge timeout" },
  });

  b.add({
    name: "world-api.spawnTrees",
    label: "spawn",
    start_offset_ms: 201,
    duration_ms: 5_016,
    parent: "dispatch",
    status: "error",
    inputs: [
      {
        area: { center: { x: 0, y: 0, z: 0 }, radius: 10 },
        count: 50,
        species: "oak",
      },
    ],
    error: { message: "rc-bridge.send did not respond within timeout" },
  });

  b.add({
    name: "rc-bridge.send",
    label: "rc-send",
    start_offset_ms: 205,
    duration_ms: 5_010,
    parent: "spawn",
    status: "error",
    inputs: {
      endpoint: "/remote/function/PCG/SpawnTrees",
      method: "PUT",
      timeout_ms: 5_000,
    },
    error: { message: "ETIMEDOUT after 5000ms" },
  });

  b.add({
    name: "rc.http.PUT",
    start_offset_ms: 207,
    duration_ms: 5_000,
    parent: "rc-send",
    status: "error",
    inputs: {
      url: "http://ue-instance.local:30010/remote/function/PCG/SpawnTrees",
    },
    error: { message: "socket timeout" },
  });

  return b.build();
}

export const scenarios: MockScenario[] = [
  {
    id: "storm-success",
    label: "make it stormy ✓",
    prompt: "make it stormy",
    description:
      "Successful prompt: LLM → memory read → world-api dispatch → setSkyState → RC bridge → memory write. 11 spans across 5 packages.",
    build: makeStormSuccessTrace,
  },
  {
    id: "rc-timeout",
    label: "plant 50 oaks (RC timeout) ✗",
    prompt: "plant 50 oaks here",
    description:
      "RC bridge times out reaching the UE instance. Error propagates up through 5 boundaries; the inspector shows where it originated.",
    build: makeRcTimeoutTrace,
  },
];
