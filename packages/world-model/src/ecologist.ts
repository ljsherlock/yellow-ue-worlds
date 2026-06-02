import { boundary } from "@yellow-ue/tracing";

import type { SceneSpec } from "./types.js";
import { mockEcologist } from "./scene.js";

export interface EcologistResult {
  scene: SceneSpec;
  reasoning: string;
  model: string;
}

/**
 * The director's ecologist boundary (R2): a prompt → a populated SceneSpec.
 *
 * `MockEcologist` is the keyless stand-in (keyword biome lookup). The live
 * implementation is `BrainHttpClient` in `@yellow-ue/llm-brain/http`, which
 * satisfies this same interface by calling the Python brain's `/populate`.
 * Page 08 swaps one for the other with no other change.
 */
export interface Ecologist {
  populate(prompt: string): Promise<EcologistResult>;
}

export class MockEcologist implements Ecologist {
  populate = boundary(
    "ecologist.populate",
    async (prompt: string): Promise<EcologistResult> => {
      const scene = mockEcologist(prompt);
      const names = scene.species.map((s) => s.species).join(", ");
      return {
        scene,
        reasoning: `Mock ecologist matched a scene: ${names}.`,
        model: "mock-ecologist-v1",
      };
    },
  );
}
