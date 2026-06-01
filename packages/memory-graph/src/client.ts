import type { Fact, FactQuery, NewFact } from "./contract.js";

/**
 * R2: the WorldMemoryStore boundary. The brain reads context from it and
 * writes new facts after each world change; the inspector reads it to
 * visualize state over time.
 *
 * Phase 1: `MockWorldMemoryStore` (in-memory bitemporal log).
 * Phase 2 Track B: Graphiti-backed implementation with the same interface.
 */
export interface WorldMemoryStore {
  /**
   * Write a new fact. If a currently-valid fact exists for the same
   * (entityId, type), it is closed (`validTo = newFact.validFrom`) and the
   * new fact records `invalidates`.
   */
  write(fact: NewFact): Promise<Fact>;

  /** Query facts, optionally restricted to those valid at world-time `at`. */
  read(query: FactQuery, at?: number): Promise<Fact[]>;

  /** All facts valid at world-time `at`. */
  snapshotAt(at: number): Promise<Fact[]>;

  /** Every fact ever recorded for an entity, oldest first. */
  history(entityId: string): Promise<Fact[]>;
}
