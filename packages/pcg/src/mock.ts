import { boundary } from "@yellow-ue/tracing";

import type { PCGRunner } from "./client.js";
import {
  PCGRunRequestSchema,
  type PCGPoint,
  type PCGRunRequest,
  type PCGRunResult,
} from "./contract.js";

/** Deterministic PRNG so the same seed always produces the same scatter. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function baseScaleFor(growth: unknown): number {
  if (growth === "seedling") return 0.3;
  if (growth === "sapling") return 0.6;
  return 1.0;
}

/**
 * MockPCGRunner — a deterministic stand-in for UE's runtime PCG. Scatters
 * `count` points uniformly within the area disk using a seeded PRNG, so the
 * inspector (page 05) shows a stable, inspectable point cloud and the same
 * seed reproduces it exactly.
 */
export class MockPCGRunner implements PCGRunner {
  run = boundary("pcg.run", async (request: PCGRunRequest): Promise<PCGRunResult> => {
    const r = PCGRunRequestSchema.parse(request);
    const rng = mulberry32(r.seed);
    const base = baseScaleFor(r.attributes.growth_stage);

    const points: PCGPoint[] = [];
    for (let i = 0; i < r.count; i += 1) {
      const angle = rng() * Math.PI * 2;
      // sqrt for uniform disk distribution
      const radius = r.area.radius * Math.sqrt(rng());
      points.push({
        position: {
          x: r.area.center.x + Math.cos(angle) * radius,
          y: r.area.center.y + Math.sin(angle) * radius,
          z: r.area.center.z,
        },
        scale: Number((base + rng() * 0.2).toFixed(3)),
        rotationYaw: Number((rng() * 360).toFixed(1)),
        attributes: { ...r.attributes },
      });
    }

    return {
      graph: r.graph,
      seed: r.seed,
      count: points.length,
      durationMs: Number((r.count * 0.05).toFixed(2)),
      points,
    };
  });
}
