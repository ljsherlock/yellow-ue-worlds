import { z } from "zod";

export const WORLD_MEMORY_VERSION = "WorldMemoryv1" as const;

/**
 * The temporal axis is **world-time in hours**, not wall-clock. This is what
 * `AdvanceTime` moves and what `SpawnTrees` stamps onto trees. Graphiti's real
 * model is bitemporal (event time + ingestion time); for the MVP we track the
 * single world-time axis, which is the one users actually scrub.
 */

export const NewFactSchema = z.object({
  type: z.string().min(1),
  entityId: z.string().min(1),
  properties: z.record(z.string(), z.unknown()).default({}),
  validFrom: z.number().nonnegative(),
});
export type NewFact = z.input<typeof NewFactSchema>;

export interface Fact {
  id: string;
  type: string;
  entityId: string;
  properties: Record<string, unknown>;
  /** world-time hours from which this fact holds. */
  validFrom: number;
  /** world-time hours at which this fact was superseded; null = still valid. */
  validTo: number | null;
  /** id of the fact this one superseded, if any. */
  invalidates?: string;
}

export interface FactQuery {
  type?: string;
  entityId?: string;
}

/** A fact holds at world-time `at` iff it started by then and hasn't ended. */
export function isValidAt(fact: Fact, at: number): boolean {
  return fact.validFrom <= at && (fact.validTo === null || fact.validTo > at);
}
