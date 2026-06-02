import { z } from "zod";

export const WORLD_MODEL_VERSION = "WorldModelv1" as const;

// ─────────────────────────────────────────────────────────────────────────────
// Vec2 — the sim is 2D top-down (UE will lift this to 3D later)
// ─────────────────────────────────────────────────────────────────────────────

export interface Vec2 {
  x: number;
  y: number;
}

export const v = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export function norm(a: Vec2): Vec2 {
  const l = len(a);
  return l > 1e-9 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
}
export function clampLen(a: Vec2, max: number): Vec2 {
  const l = len(a);
  return l > max ? scale(a, max / l) : a;
}

// ─────────────────────────────────────────────────────────────────────────────
// Entities, relationships, dispositions
// ─────────────────────────────────────────────────────────────────────────────

export type EntityKind = "animal" | "plant" | "vehicle" | "feature";
export type Diet = "predator" | "prey" | "none";

/** Behaviour state — the visible "what is it doing right now". */
export type BehaviourState =
  | "idle"
  | "graze"
  | "flee"
  | "stalk"
  | "attack"
  | "rest"
  | "drink"
  | "patrol";

export interface Entity {
  id: string;
  species: string;
  kind: EntityKind;
  diet: Diet;
  pos: Vec2;
  vel: Vec2;
  /** 0 (full) → 1 (starving); drives predator hunting. */
  hunger: number;
  /** 0 (calm) → 1 (panicked); drives prey flight, decays over time. */
  alert: number;
  state: BehaviourState;
  maxSpeed: number;
  /** body radius (world units) — perception/collision scale off this. */
  radius: number;
  color: string;
  /** transient per-tick steering target; set during a step, cleared on integrate. */
  desired?: Vec2;
}

/** A typed edge the LLM director declares; the sim reads these to drive behaviour. */
export type Predicate =
  | "stalks" // subject hunts object
  | "flees-from" // subject fears object
  | "herds-with" // subject flocks with object
  | "drinks-at" // subject is drawn to object (a feature)
  | "disturbs"; // subject frightens object (e.g. jeep)

export interface Relationship {
  /** species-level by default (e.g. "lion" stalks "buffalo"). */
  subject: string;
  predicate: Predicate;
  object: string;
}

export interface Weather {
  preset: "clear" | "cloudy" | "storm" | "sunset" | "night";
  /** 0 (cold) → 1 (scorching). Drives thirst + midday lethargy. */
  temperature: number;
  /** world hours, 0–24. */
  timeOfDay: number;
}

export interface WorldModelState {
  entities: Entity[];
  relationships: Relationship[];
  weather: Weather;
  /** world-time seconds elapsed in the sim. */
  elapsed: number;
  /** square arena side length in world units. */
  bounds: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// SceneSpec — what the LLM director emits to populate a world (validated)
// ─────────────────────────────────────────────────────────────────────────────

export const SpeciesSpecSchema = z.object({
  species: z.string().min(1),
  kind: z.enum(["animal", "plant", "vehicle", "feature"]),
  diet: z.enum(["predator", "prey", "none"]).default("none"),
  count: z.number().int().positive().max(500).default(1),
  maxSpeed: z.number().nonnegative().default(6),
  radius: z.number().positive().default(1),
  color: z.string().default("#9ca3af"),
});
export type SpeciesSpec = z.input<typeof SpeciesSpecSchema>;

export const RelationshipSchema = z.object({
  subject: z.string().min(1),
  predicate: z.enum(["stalks", "flees-from", "herds-with", "drinks-at", "disturbs"]),
  object: z.string().min(1),
});

export const SceneSpecSchema = z.object({
  species: z.array(SpeciesSpecSchema),
  relationships: z.array(RelationshipSchema).default([]),
  weather: z
    .object({
      preset: z.enum(["clear", "cloudy", "storm", "sunset", "night"]).default("clear"),
      temperature: z.number().min(0).max(1).default(0.5),
      timeOfDay: z.number().min(0).max(24).default(12),
    })
    .default({ preset: "clear", temperature: 0.5, timeOfDay: 12 }),
  bounds: z.number().positive().default(100),
});
export type SceneSpec = z.input<typeof SceneSpecSchema>;
