import type { WorldMemoryStore } from "./client.js";

/**
 * Seed a store with a small demo timeline so the inspector (page 02) has
 * something to scrub. Mirrors a plausible session:
 *
 *   t=0   sky clear, clock starts, 3 oak seedlings planted
 *   t=2   sky → storm
 *   t=10  oaks grow to saplings
 *   t=14  sky → sunset
 *   t=24  oaks grow to mature
 *
 * This is fixture data, not store logic — it lives here (not in the inspector)
 * so any consumer/test can reuse the same canonical timeline (R1).
 */
export async function seedDemoWorld(store: WorldMemoryStore): Promise<void> {
  await store.write({ type: "Clock", entityId: "clock", properties: { worldTimeHours: 0 }, validFrom: 0 });
  await store.write({ type: "SkyState", entityId: "sky", properties: { preset: "clear" }, validFrom: 0 });

  for (const n of [1, 2, 3]) {
    await store.write({
      type: "Tree",
      entityId: `tree-${n}`,
      properties: { species: "oak", growth_stage: "seedling", plantedAt: 0 },
      validFrom: 0,
    });
  }

  await store.write({ type: "SkyState", entityId: "sky", properties: { preset: "storm" }, validFrom: 2 });

  for (const n of [1, 2, 3]) {
    await store.write({
      type: "Tree",
      entityId: `tree-${n}`,
      properties: { species: "oak", growth_stage: "sapling", plantedAt: 0 },
      validFrom: 10,
    });
  }

  await store.write({ type: "SkyState", entityId: "sky", properties: { preset: "sunset" }, validFrom: 14 });

  for (const n of [1, 2, 3]) {
    await store.write({
      type: "Tree",
      entityId: `tree-${n}`,
      properties: { species: "oak", growth_stage: "mature", plantedAt: 0 },
      validFrom: 24,
    });
  }
}
