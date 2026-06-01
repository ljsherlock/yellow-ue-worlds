import type {
  AdvanceTimeArgs,
  AdvanceTimeResult,
  SetSkyStateArgs,
  SetSkyStateResult,
  SpawnTreesArgs,
  SpawnTreesResult,
  WorldAPICall,
  WorldAPIDispatchResult,
  WorldAPIResult,
} from "./contract.js";

/**
 * R2: Cross-package boundary contract. Every implementation (mock, RC-bridge,
 * Pixel-Streaming-server, …) implements this interface. Consumers depend on
 * the interface only and have impls injected.
 *
 * R3: Implementations MUST wrap each method in `@boundary` (or its TS
 * equivalent) once `packages/tracing/` lands in Task 0.4. Until then,
 * mark with `// TODO(R3): wrap in @boundary`.
 */
export interface WorldAPIClient {
  setSkyState(args: SetSkyStateArgs): Promise<WorldAPIResult<SetSkyStateResult>>;

  advanceTime(args: AdvanceTimeArgs): Promise<WorldAPIResult<AdvanceTimeResult>>;

  spawnTrees(args: SpawnTreesArgs): Promise<WorldAPIResult<SpawnTreesResult>>;

  /**
   * Dispatch a validated WorldAPICall to its specific method.
   * Useful for LLM-driven flows where the call shape is the source of truth
   * (LLM emits a discriminated tool call; we route it).
   */
  dispatch(call: WorldAPICall): Promise<WorldAPIDispatchResult>;
}
