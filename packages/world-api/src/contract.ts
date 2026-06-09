import { z } from "zod";
import { EntityIdSchema, TimestampSchema, Vec3Schema } from "./primitives.js";

export const WORLD_API_VERSION = "WorldAPIv1" as const;

// ─────────────────────────────────────────────────────────────────────────────
// 1. SetSkyState
// ─────────────────────────────────────────────────────────────────────────────

export const SkyPresetSchema = z.enum([
  "clear",
  "cloudy",
  "storm",
  "sunset",
  "night",
]);
export type SkyPreset = z.infer<typeof SkyPresetSchema>;

export const SetSkyStateArgsSchema = z.object({
  preset: SkyPresetSchema,
  transition_seconds: z.number().nonnegative().default(5),
});
// Caller-facing type — defaults are optional in the input
export type SetSkyStateArgs = z.input<typeof SetSkyStateArgsSchema>;

export const SetSkyStateResultSchema = z.object({
  previous: SkyPresetSchema,
  current: SkyPresetSchema,
  transition_seconds: z.number().nonnegative(),
  applied_at: TimestampSchema,
});
export type SetSkyStateResult = z.infer<typeof SetSkyStateResultSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// 2. AdvanceTime
// ─────────────────────────────────────────────────────────────────────────────

export const AdvanceTimeArgsSchema = z.object({
  hours: z.number().positive(),
  speed_multiplier: z.number().positive().default(1),
});
// Caller-facing type — defaults are optional in the input
export type AdvanceTimeArgs = z.input<typeof AdvanceTimeArgsSchema>;

export const AdvanceTimeResultSchema = z.object({
  previous_world_time_hours: z.number().nonnegative(),
  current_world_time_hours: z.number().nonnegative(),
  hours_advanced: z.number().positive(),
  speed_multiplier: z.number().positive(),
  applied_at: TimestampSchema,
});
export type AdvanceTimeResult = z.infer<typeof AdvanceTimeResultSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// 3. SpawnTrees
// ─────────────────────────────────────────────────────────────────────────────

export const TreeSpeciesSchema = z.enum(["oak", "pine", "birch"]);
export type TreeSpecies = z.infer<typeof TreeSpeciesSchema>;

export const GrowthStageSchema = z.enum(["seedling", "sapling", "mature"]);
export type GrowthStage = z.infer<typeof GrowthStageSchema>;

export const AreaSchema = z.object({
  center: Vec3Schema,
  radius: z.number().positive(),
});
export type Area = z.infer<typeof AreaSchema>;

export const SpawnTreesArgsSchema = z.object({
  area: AreaSchema,
  count: z.number().int().positive().max(10_000),
  species: TreeSpeciesSchema,
  growth_stage: GrowthStageSchema.default("mature"),
});
// Caller-facing type — defaults are optional in the input
export type SpawnTreesArgs = z.input<typeof SpawnTreesArgsSchema>;

export const SpawnedTreeSchema = z.object({
  id: EntityIdSchema,
  position: Vec3Schema,
  species: TreeSpeciesSchema,
  growth_stage: GrowthStageSchema,
  planted_at_world_time_hours: z.number().nonnegative(),
});
export type SpawnedTree = z.infer<typeof SpawnedTreeSchema>;

export const SpawnTreesResultSchema = z.object({
  spawned: z.array(SpawnedTreeSchema),
  count: z.number().int().nonnegative(),
  applied_at: TimestampSchema,
});
export type SpawnTreesResult = z.infer<typeof SpawnTreesResultSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// 4. Creatures — INTENT-level verbs
//
// The brain speaks in *intent*: a species and a named landmark, never a mesh
// path or a terrain-probed coordinate. The rc-bridge owns the pack facts (which
// SkeletalMesh, which clips, the model's yaw offset) and the map facts (where a
// landmark actually is, the waterline to stop at). This keeps the LLM uncoupled
// from the asset pipeline — adding a lion later is a new species row in the
// bridge registry, not a contract change — and is the shape the drives-based
// ecosystem (installment B) extends without re-cutting.
// ─────────────────────────────────────────────────────────────────────────────

/** Creature kinds the bridge knows how to resolve to a Fab asset + clip map. */
export const CreatureSpeciesSchema = z.enum(["elephant_adult", "elephant_baby"]);
export type CreatureSpecies = z.infer<typeof CreatureSpeciesSchema>;

/** Named places in the world. The bridge maps each to coordinates / an approach
 *  path / a waterline, so the brain can say "migrate to the watering_hole". */
export const LandmarkSchema = z.enum(["herd_start", "watering_hole"]);
export type Landmark = z.infer<typeof LandmarkSchema>;

/** Locomotion + in-place actions a creature can be put into. */
export const CreatureStateSchema = z.enum([
  "idle",
  "walk",
  "run",
  "drink",
  "graze",
]);
export type CreatureState = z.infer<typeof CreatureStateSchema>;

export const SpawnCreatureArgsSchema = z.object({
  species: CreatureSpeciesSchema,
  /** Stable handle the brain uses to address this creature later (e.g. "matriarch"). */
  id: EntityIdSchema,
  at: LandmarkSchema,
  /** Optional facing in degrees; the bridge defaults to the landmark's facing. */
  yaw: z.number().optional(),
});
export type SpawnCreatureArgs = z.input<typeof SpawnCreatureArgsSchema>;

export const MoveCreatureToArgsSchema = z.object({
  id: EntityIdSchema,
  to: LandmarkSchema,
  /** Travel speed cm/s; the bridge defaults to the species' walk speed. */
  speed: z.number().positive().optional(),
});
export type MoveCreatureToArgs = z.input<typeof MoveCreatureToArgsSchema>;

export const SetCreatureStateArgsSchema = z.object({
  id: EntityIdSchema,
  state: CreatureStateSchema,
});
export type SetCreatureStateArgs = z.input<typeof SetCreatureStateArgsSchema>;

export const SetCreatureLeaderArgsSchema = z.object({
  id: EntityIdSchema,
  leader_id: EntityIdSchema,
  /** Trailing gap in METRES (brain-friendly); the bridge converts to cm. */
  distance_m: z.number().positive().default(4),
});
export type SetCreatureLeaderArgs = z.input<typeof SetCreatureLeaderArgsSchema>;

export const WanderCreatureArgsSchema = z.object({
  id: EntityIdSchema,
  around: LandmarkSchema,
  radius_m: z.number().positive().default(15),
  speed: z.number().positive().optional(),
});
export type WanderCreatureArgs = z.input<typeof WanderCreatureArgsSchema>;

export const DespawnCreatureArgsSchema = z.object({ id: EntityIdSchema });
export type DespawnCreatureArgs = z.input<typeof DespawnCreatureArgsSchema>;

export const ClearCreaturesArgsSchema = z.object({});
export type ClearCreaturesArgs = z.input<typeof ClearCreaturesArgsSchema>;

/** Director-level pause between steps. Runner-only: the bridge sleeps locally
 *  and never forwards this to Unreal. The scripted-timing stopgap until the
 *  read-back/perception loop (installment B) lets actions fire on world events. */
export const WaitArgsSchema = z.object({
  seconds: z.number().positive().max(600),
});
export type WaitArgs = z.input<typeof WaitArgsSchema>;

/** Read-back gate: pause the plan until creature `id` reports arrived=true (via
 *  the CreatureDirector QueryCreature read-back) or `timeout_seconds` elapses.
 *  Runner-only: the bridge POLLS Unreal's perception, it does not forward this
 *  verb raw. This is the perception primitive that replaces a blind `Wait` for
 *  sequencing — "drink once you actually reach the water", not "drink in 75s". */
export const WaitForArrivalArgsSchema = z.object({
  id: EntityIdSchema,
  timeout_seconds: z.number().positive().max(600).default(120),
});
export type WaitForArrivalArgs = z.input<typeof WaitForArrivalArgsSchema>;

/** Creature verbs are fire-and-forget over Remote Control (UE returns no value),
 *  so their dispatch result is a simple acknowledgement. */
export const CreatureAckSchema = z.object({
  detail: z.string(),
  applied_at: TimestampSchema,
});
export type CreatureAck = z.infer<typeof CreatureAckSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Discriminated union — what the LLM brain produces, what dispatchers consume
// ─────────────────────────────────────────────────────────────────────────────

export const WorldAPICallSchema = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("SetSkyState"), args: SetSkyStateArgsSchema }),
  z.object({ tool: z.literal("AdvanceTime"), args: AdvanceTimeArgsSchema }),
  z.object({ tool: z.literal("SpawnTrees"), args: SpawnTreesArgsSchema }),
  z.object({ tool: z.literal("SpawnCreature"), args: SpawnCreatureArgsSchema }),
  z.object({ tool: z.literal("MoveCreatureTo"), args: MoveCreatureToArgsSchema }),
  z.object({ tool: z.literal("SetCreatureState"), args: SetCreatureStateArgsSchema }),
  z.object({ tool: z.literal("SetCreatureLeader"), args: SetCreatureLeaderArgsSchema }),
  z.object({ tool: z.literal("WanderCreature"), args: WanderCreatureArgsSchema }),
  z.object({ tool: z.literal("DespawnCreature"), args: DespawnCreatureArgsSchema }),
  z.object({ tool: z.literal("ClearCreatures"), args: ClearCreaturesArgsSchema }),
  z.object({ tool: z.literal("Wait"), args: WaitArgsSchema }),
  z.object({ tool: z.literal("WaitForArrival"), args: WaitForArrivalArgsSchema }),
]);
// Caller-facing type — args defaults are optional in the input
export type WorldAPICall = z.input<typeof WorldAPICallSchema>;

export type WorldAPIToolName = WorldAPICall["tool"];

// ─────────────────────────────────────────────────────────────────────────────
// Result envelope — LLM-friendly Result<T> pattern
// ─────────────────────────────────────────────────────────────────────────────

export const WorldAPIErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});
export type WorldAPIError = z.infer<typeof WorldAPIErrorSchema>;

export type WorldAPIResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: WorldAPIError };

export type WorldAPIDispatchResult =
  | { tool: "SetSkyState"; result: WorldAPIResult<SetSkyStateResult> }
  | { tool: "AdvanceTime"; result: WorldAPIResult<AdvanceTimeResult> }
  | { tool: "SpawnTrees"; result: WorldAPIResult<SpawnTreesResult> }
  | { tool: "SpawnCreature"; result: WorldAPIResult<CreatureAck> }
  | { tool: "MoveCreatureTo"; result: WorldAPIResult<CreatureAck> }
  | { tool: "SetCreatureState"; result: WorldAPIResult<CreatureAck> }
  | { tool: "SetCreatureLeader"; result: WorldAPIResult<CreatureAck> }
  | { tool: "WanderCreature"; result: WorldAPIResult<CreatureAck> }
  | { tool: "DespawnCreature"; result: WorldAPIResult<CreatureAck> }
  | { tool: "ClearCreatures"; result: WorldAPIResult<CreatureAck> }
  | { tool: "Wait"; result: WorldAPIResult<CreatureAck> }
  | { tool: "WaitForArrival"; result: WorldAPIResult<CreatureAck> };
