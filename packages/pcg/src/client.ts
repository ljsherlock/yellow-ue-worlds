import type { PCGRunRequest, PCGRunResult } from "./contract.js";

/**
 * R2: the PCGRunner boundary — parameterize a PCG graph and get generated
 * points back. In UE this is `SpawnTrees` running a real PCG graph at runtime
 * (the killer UE 5.7 feature); here it's a deterministic scatter.
 *
 * Phase 1: `MockPCGRunner` (seeded, deterministic).
 * Phase 2 Track D: real runner that triggers a PCG graph in the engine via
 *   Remote Control and returns the generated transform list.
 */
export interface PCGRunner {
  run(request: PCGRunRequest): Promise<PCGRunResult>;
}
