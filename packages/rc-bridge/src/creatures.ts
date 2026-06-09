import type { CreatureSpecies, Landmark } from "@yellow-ue/world-api";

import type { RCFunctionCall } from "./contract.js";

/**
 * The creature registry — the bridge's knowledge of the *asset pack* and the
 * *map*, kept out of the brain's contract on purpose (the LLM speaks intent:
 * "spawn an elephant herd at the watering_hole"; this module turns that into
 * mesh paths, clip maps, terrain-probed coordinates and the waterline).
 *
 * Adding a lion or the jeep later = one more SPECIES_PRESETS row + (if needed) a
 * LANDMARKS row. No contract change, no recompile — the same RC verbs drive it.
 */

/** The CreatureDirector actor authored into the Landscape_1 map (logged by
 *  add_creatures.py at author time). Override per-run with RC_CREATURE_PATH. */
export const CREATURE_DIRECTOR_PATH =
  "/Game/8KSavannahLandscapePack/Scenes/Landscapes/Landscape_1.Landscape_1:PersistentLevel.CreatureDirector_0";

export interface SpeciesPreset {
  /** SkeletalMesh object path in the cooked content. */
  meshPath: string;
  /** "state=clipPath;state=clipPath;…" mapping generic states to this pack. */
  clipsCsv: string;
  walkSpeed: number;
  runSpeed: number;
  uniformScale: number;
  /** Corrects the model's forward axis (the elephant walks left-flank-first at
   *  yaw 0; -90 turns the trunk to lead). A pack fact, not a brain decision. */
  meshYawOffset: number;
}

// In-place (Ele_IP_*) locomotion so the legs cycle while the bridge translates
// the actor; Ele_C_* for the in-place actions (idle/drink).
const ELEPHANT_CLIPS =
  "idle=/Game/Elephant/Animations/Ele_C_Idle_01.Ele_C_Idle_01;" +
  "walk=/Game/Elephant/Animations/Ele_IP_Walk.Ele_IP_Walk;" +
  "run=/Game/Elephant/Animations/Ele_IP_Run_Forward.Ele_IP_Run_Forward;" +
  "drink=/Game/Elephant/Animations/Ele_C_Drink.Ele_C_Drink";

export const SPECIES_PRESETS: Record<CreatureSpecies, SpeciesPreset> = {
  elephant_adult: {
    meshPath: "/Game/Elephant/Meshes/SK_Elephant_Re.SK_Elephant_Re",
    clipsCsv: ELEPHANT_CLIPS,
    walkSpeed: 260,
    runSpeed: 600,
    uniformScale: 1,
    meshYawOffset: -90,
  },
  elephant_baby: {
    meshPath: "/Game/Elephant/Meshes/SK_Elephant_Baby_Re.SK_Elephant_Baby_Re",
    clipsCsv: ELEPHANT_CLIPS,
    walkSpeed: 300,
    runSpeed: 650,
    uniformScale: 1,
    meshYawOffset: -90,
  },
};

export interface LandmarkDef {
  /** Reference / spawn point (world cm). */
  x: number;
  y: number;
  /** Default facing for creatures placed or sent here. */
  yaw: number;
  /** Surface Z (cm) of the nearest water, so the herd halts at the shoreline
   *  instead of walking down the collision-less lakebed. */
  waterZ: number;
  /** Multi-point approach path "x,y;x,y;…" (world cm) ending at this landmark.
   *  MoveCreatureTo follows it so the herd takes the proven gentle descent
   *  rather than a beeline over the ridges. */
  approach: string;
}

export const LANDMARKS: Record<Landmark, LandmarkDef> = {
  // Halfway between the old NW rim spawn and the drink spot, so the herd walks a
  // short way in to the water rather than the full ~1.5 km. Terrain-probed dry
  // (~-3700..-4300, well above the -6000 waterline). The drink/stop spot itself is
  // ~(427300,693500) at ~865 m from the lake centre; this is the midpoint to it.
  herd_start: {
    x: 408400,
    y: 719700,
    yaw: -53,
    waterZ: -6000,
    approach: "408400,719700",
  },
  // The lake2 shoreline the herd drinks at, reached via the proven SE descent.
  watering_hole: {
    x: 479552,
    y: 625856,
    yaw: -53,
    waterZ: -6000,
    approach: "430000,690000;460000,655000;479552,625856",
  },
};

/** Steady migration pace (cm/s) for MoveCreatureTo when the brain gives none —
 *  a brisk walk that reads well over the 8 km map (the proven scene used 420). */
export const DEFAULT_MIGRATION_SPEED = 420;

/**
 * Deterministic ~1–3 m scatter per id so a multi-creature herd doesn't stack on
 * one pixel. Small on purpose: members start ADJACENT, then SetCreatureLeader's
 * follow distance tucks them into formation (the follow logic can only maintain
 * a gap, never close one, so they must begin close together).
 */
export function spawnOffset(id: string): { dx: number; dy: number } {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  const ang = (h % 360) * (Math.PI / 180);
  const r = 100 + (h % 200); // 100–300 cm
  return { dx: Math.cos(ang) * r, dy: Math.sin(ang) * r };
}

/** The DefineCreatureType bootstrap call for a species (run once before spawn). */
export function defineSpeciesCall(
  species: CreatureSpecies,
  objectPath: string,
): RCFunctionCall {
  const p = SPECIES_PRESETS[species];
  return {
    objectPath,
    functionName: "DefineCreatureType",
    parameters: {
      Type: species,
      MeshPath: p.meshPath,
      ClipsCsv: p.clipsCsv,
      WalkSpeed: p.walkSpeed,
      RunSpeed: p.runSpeed,
      UniformScale: p.uniformScale,
      MeshYawOffset: p.meshYawOffset,
    },
  };
}

/** The SetWaterLevel bootstrap call for a landmark's waterline (run once). */
export function setWaterLevelCall(
  at: Landmark,
  objectPath: string,
): RCFunctionCall {
  return {
    objectPath,
    functionName: "SetWaterLevel",
    parameters: { SurfaceZ: LANDMARKS[at].waterZ },
  };
}
