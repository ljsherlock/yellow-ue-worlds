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
// Discriminated union — what the LLM brain produces, what dispatchers consume
// ─────────────────────────────────────────────────────────────────────────────

export const WorldAPICallSchema = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("SetSkyState"), args: SetSkyStateArgsSchema }),
  z.object({ tool: z.literal("AdvanceTime"), args: AdvanceTimeArgsSchema }),
  z.object({ tool: z.literal("SpawnTrees"), args: SpawnTreesArgsSchema }),
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
  | { tool: "SpawnTrees"; result: WorldAPIResult<SpawnTreesResult> };
