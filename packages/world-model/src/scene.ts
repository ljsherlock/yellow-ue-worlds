import {
  type Entity,
  type WorldModelState,
  type SceneSpec,
  type Relationship,
  SceneSpecSchema,
} from "./types.js";
import { mulberry32 } from "./rng.js";

/** Instantiate a concrete, positioned world from a (validated) SceneSpec. */
export function buildWorld(spec: SceneSpec, seed = 1): WorldModelState {
  const scene = SceneSpecSchema.parse(spec);
  const rng = mulberry32(seed);
  const bounds = scene.bounds;
  const entities: Entity[] = [];

  for (const s of scene.species) {
    for (let i = 0; i < s.count; i++) {
      const isPredator = s.diet === "predator";
      // features (e.g. watering hole) sit near the middle; everything else scatters
      const pos =
        s.kind === "feature"
          ? { x: bounds * (0.35 + rng() * 0.3), y: bounds * (0.35 + rng() * 0.3) }
          : { x: rng() * bounds, y: rng() * bounds };
      entities.push({
        id: `${s.species}-${i}`,
        species: s.species,
        kind: s.kind,
        diet: s.diet,
        pos,
        vel: { x: 0, y: 0 },
        hunger: isPredator ? 0.4 + rng() * 0.2 : 0,
        alert: 0,
        state: s.kind === "animal" ? "graze" : "idle",
        maxSpeed: s.maxSpeed,
        radius: s.radius,
        color: s.color,
      });
    }
  }

  return {
    entities,
    relationships: scene.relationships as Relationship[],
    weather: scene.weather as WorldModelState["weather"],
    elapsed: 0,
    bounds,
  };
}

/**
 * The canonical demo: a savanna watering hole with a predator/prey dynamic and
 * a jeep that spooks the herds. This is the shape the LLM director will emit.
 */
export const SAVANNA_SCENE: SceneSpec = {
  bounds: 100,
  weather: { preset: "clear", temperature: 0.8, timeOfDay: 12 },
  species: [
    { species: "watering_hole", kind: "feature", diet: "none", count: 1, radius: 7, color: "#38bdf8", maxSpeed: 0 },
    { species: "acacia", kind: "plant", diet: "none", count: 14, radius: 1.5, color: "#65a30d", maxSpeed: 0 },
    { species: "buffalo", kind: "animal", diet: "prey", count: 12, radius: 1.6, color: "#a16207", maxSpeed: 7 },
    { species: "zebra", kind: "animal", diet: "prey", count: 10, radius: 1.3, color: "#e5e7eb", maxSpeed: 8 },
    { species: "lion", kind: "animal", diet: "predator", count: 3, radius: 1.7, color: "#f59e0b", maxSpeed: 9 },
    { species: "jeep", kind: "vehicle", diet: "none", count: 1, radius: 2, color: "#dc2626", maxSpeed: 10 },
  ],
  relationships: [
    { subject: "lion", predicate: "stalks", object: "buffalo" },
    { subject: "lion", predicate: "stalks", object: "zebra" },
    { subject: "buffalo", predicate: "herds-with", object: "buffalo" },
    { subject: "zebra", predicate: "herds-with", object: "zebra" },
    { subject: "buffalo", predicate: "drinks-at", object: "watering_hole" },
    { subject: "zebra", predicate: "drinks-at", object: "watering_hole" },
    { subject: "lion", predicate: "drinks-at", object: "watering_hole" },
    { subject: "jeep", predicate: "disturbs", object: "buffalo" },
    { subject: "jeep", predicate: "disturbs", object: "zebra" },
  ],
};

/**
 * Stand-in for the LLM "ecologist" director until the real brain is wired in.
 * Keyword-maps a prompt to a SceneSpec — same contract the brain will satisfy.
 */
export function mockEcologist(prompt: string): SceneSpec {
  const p = prompt.toLowerCase();
  if (p.includes("savanna") || p.includes("savannah") || p.includes("watering") || p.includes("jeep")) {
    const scene: SceneSpec = { ...SAVANNA_SCENE };
    if (p.includes("night")) scene.weather = { preset: "night", temperature: 0.3, timeOfDay: 2 };
    else if (p.includes("storm")) scene.weather = { preset: "storm", temperature: 0.5, timeOfDay: 15 };
    return scene;
  }
  // Fallback: a calm meadow with grazers and no predator pressure.
  return {
    bounds: 100,
    weather: { preset: "clear", temperature: 0.4, timeOfDay: 10 },
    species: [
      { species: "watering_hole", kind: "feature", diet: "none", count: 1, radius: 6, color: "#38bdf8", maxSpeed: 0 },
      { species: "oak", kind: "plant", diet: "none", count: 18, radius: 1.6, color: "#15803d", maxSpeed: 0 },
      { species: "deer", kind: "animal", diet: "prey", count: 14, radius: 1.3, color: "#d6a87a", maxSpeed: 8 },
    ],
    relationships: [
      { subject: "deer", predicate: "herds-with", object: "deer" },
      { subject: "deer", predicate: "drinks-at", object: "watering_hole" },
    ],
  };
}
