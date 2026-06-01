import type { WorldAPICall } from "@yellow-ue/world-api";

import type { PCGRunRequest } from "./contract.js";

type SpawnTreesCall = Extract<WorldAPICall, { tool: "SpawnTrees" }>;

/**
 * Map a `SpawnTrees` world-API call to the PCG run that realises it. This is
 * the real translation the Phase 2 runner uses — `SpawnTrees` is literally a
 * parameterized PCG graph invocation.
 */
export function spawnTreesToPCGRequest(
  call: SpawnTreesCall,
  seed = 1,
): PCGRunRequest {
  return {
    graph: "ScatterTrees",
    seed,
    area: call.args.area,
    count: call.args.count,
    attributes: {
      species: call.args.species,
      growth_stage: call.args.growth_stage ?? "mature",
    },
  };
}
