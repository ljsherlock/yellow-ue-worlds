import { boundary } from "@yellow-ue/tracing";

import type { WorldMemoryStore } from "./client.js";
import {
  NewFactSchema,
  isValidAt,
  type Fact,
  type FactQuery,
  type NewFact,
} from "./contract.js";

export interface MockWorldMemoryStoreOptions {
  idGen?: () => string;
}

/**
 * MockWorldMemoryStore — an in-memory bitemporal fact log.
 *
 * Overwrite semantics: writing a new fact for an existing (entityId, type)
 * closes the prior fact at the new fact's `validFrom`. This is exactly how
 * the world graph should evolve — the storm "ends" the moment it becomes
 * sunset; the prior sky fact remains queryable in history.
 */
export class MockWorldMemoryStore implements WorldMemoryStore {
  private readonly facts: Fact[] = [];
  private counter = 0;
  private readonly idGen: () => string;

  constructor(options: MockWorldMemoryStoreOptions = {}) {
    this.idGen = options.idGen ?? (() => `fact-${(this.counter += 1)}`);
  }

  write = boundary("memory-graph.write", async (input: NewFact): Promise<Fact> => {
    const f = NewFactSchema.parse(input);
    const prior = this.facts.find(
      (x) => x.entityId === f.entityId && x.type === f.type && x.validTo === null,
    );
    if (prior) prior.validTo = f.validFrom;
    const fact: Fact = {
      id: this.idGen(),
      type: f.type,
      entityId: f.entityId,
      properties: f.properties,
      validFrom: f.validFrom,
      validTo: null,
      ...(prior ? { invalidates: prior.id } : {}),
    };
    this.facts.push(fact);
    return { ...fact };
  });

  read = boundary(
    "memory-graph.read",
    async (query: FactQuery, at?: number): Promise<Fact[]> => {
      return this.facts
        .filter((f) => (query.type ? f.type === query.type : true))
        .filter((f) => (query.entityId ? f.entityId === query.entityId : true))
        .filter((f) => (at === undefined ? true : isValidAt(f, at)))
        .map((f) => ({ ...f }));
    },
  );

  snapshotAt = boundary(
    "memory-graph.snapshotAt",
    async (at: number): Promise<Fact[]> => {
      return this.facts.filter((f) => isValidAt(f, at)).map((f) => ({ ...f }));
    },
  );

  history = boundary(
    "memory-graph.history",
    async (entityId: string): Promise<Fact[]> => {
      return this.facts
        .filter((f) => f.entityId === entityId)
        .sort((a, b) => a.validFrom - b.validFrom)
        .map((f) => ({ ...f }));
    },
  );
}
