import { z } from "zod";

export const PCG_RUN_VERSION = "PCGRunv1" as const;

const Vec3Schema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
});

export const PCGRunRequestSchema = z.object({
  graph: z.string().min(1),
  seed: z.number().int().default(1),
  area: z.object({ center: Vec3Schema, radius: z.number().positive() }),
  count: z.number().int().positive().max(10_000),
  attributes: z.record(z.string(), z.unknown()).default({}),
});
export type PCGRunRequest = z.input<typeof PCGRunRequestSchema>;

export interface PCGPoint {
  position: { x: number; y: number; z: number };
  scale: number;
  rotationYaw: number;
  attributes: Record<string, unknown>;
}

export interface PCGRunResult {
  graph: string;
  seed: number;
  count: number;
  durationMs: number;
  points: PCGPoint[];
}
