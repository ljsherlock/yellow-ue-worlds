import type { WorldAPICall } from "@yellow-ue/world-api";

import type { RCFunctionCall } from "./contract.js";
import {
  CREATURE_DIRECTOR_PATH,
  DEFAULT_MIGRATION_SPEED,
  LANDMARKS,
  spawnOffset,
} from "./creatures.js";

/**
 * The object path of the world director actor that exposes the world-API
 * functions to Remote Control. Confirmed against the built spike level
 * (make_map.py spawns AWorldDirector into /Game/Maps/Spike). Override per-call
 * with the CLI `--path` flag or the RC_OBJECT_PATH env var.
 */
export const WORLD_DIRECTOR_PATH =
  "/Game/Maps/Spike.Spike:PersistentLevel.WorldDirector_0";

/** Per-family object paths, overridable so the same mapping drives a different
 *  map/actor without editing this module (the runner injects env overrides). */
export interface RCPaths {
  worldDirector?: string;
  creatureDirector?: string;
}

/**
 * Translate a high-level `WorldAPICall` into the low-level Remote Control
 * function call that drives Unreal. Atmosphere/time/tree verbs target the
 * WorldDirector; creature verbs target the CreatureDirector. INTENT args
 * (species + landmark) are resolved to pack/map facts here via the creature
 * registry, so the brain never emits a mesh path or a coordinate.
 *
 * `Wait` is runner-only (a local pause) and has no RC mapping — callers must
 * intercept it before reaching this function.
 */
export function toRCFunctionCall(
  call: WorldAPICall,
  paths: RCPaths = {},
): RCFunctionCall {
  const worldPath = paths.worldDirector ?? WORLD_DIRECTOR_PATH;
  const creaturePath = paths.creatureDirector ?? CREATURE_DIRECTOR_PATH;

  switch (call.tool) {
    case "SetSkyState":
      // The brain speaks named moods (clear/sunset/storm/…); WorldDirector's
      // preset entry point is SetWeatherPreset(FString). (The legacy float-based
      // SetSkyState(pitch,cloud,fog) is NOT this — mapping there silently no-ops.)
      // SetWeatherPreset is instant, so transition_seconds is dropped.
      return {
        objectPath: worldPath,
        functionName: "SetWeatherPreset",
        parameters: { Preset: call.args.preset },
      };
    case "AdvanceTime":
      // WorldDirector exposes SetTimeOfDay(Hours) (absolute, 0–24, Fmod'd), not an
      // incremental AdvanceTime; treat `hours` as the target hour-of-day.
      return {
        objectPath: worldPath,
        functionName: "SetTimeOfDay",
        parameters: { Hours: call.args.hours },
      };
    case "SpawnTrees":
      return {
        objectPath: worldPath,
        functionName: "SpawnTrees",
        parameters: {
          CenterX: call.args.area.center.x,
          CenterY: call.args.area.center.y,
          CenterZ: call.args.area.center.z,
          Radius: call.args.area.radius,
          Count: call.args.count,
          Species: call.args.species,
          GrowthStage: call.args.growth_stage ?? "mature",
        },
      };

    case "SpawnCreature": {
      const lm = LANDMARKS[call.args.at];
      const off = spawnOffset(call.args.id);
      return {
        objectPath: creaturePath,
        functionName: "SpawnCreature",
        parameters: {
          Type: call.args.species,
          Id: call.args.id,
          X: lm.x + off.dx,
          Y: lm.y + off.dy,
          Yaw: call.args.yaw ?? lm.yaw,
        },
      };
    }
    case "MoveCreatureTo": {
      const lm = LANDMARKS[call.args.to];
      return {
        objectPath: creaturePath,
        functionName: "FollowPath",
        parameters: {
          Id: call.args.id,
          PointsCsv: lm.approach,
          bLoop: false,
          Speed: call.args.speed ?? DEFAULT_MIGRATION_SPEED,
        },
      };
    }
    case "SetCreatureState":
      return {
        objectPath: creaturePath,
        functionName: "SetCreatureState",
        parameters: { Id: call.args.id, State: call.args.state },
      };
    case "SetCreatureLeader":
      return {
        objectPath: creaturePath,
        functionName: "SetCreatureLeader",
        parameters: {
          Id: call.args.id,
          LeaderId: call.args.leader_id,
          // metres -> cm for the engine.
          Distance: (call.args.distance_m ?? 4) * 100,
        },
      };
    case "WanderCreature": {
      const lm = LANDMARKS[call.args.around];
      return {
        objectPath: creaturePath,
        functionName: "WanderCreature",
        parameters: {
          Id: call.args.id,
          CenterX: lm.x,
          CenterY: lm.y,
          Radius: (call.args.radius_m ?? 15) * 100,
          Speed: call.args.speed ?? 0,
        },
      };
    }
    case "DespawnCreature":
      return {
        objectPath: creaturePath,
        functionName: "DespawnCreature",
        parameters: { Id: call.args.id },
      };
    case "ClearCreatures":
      return {
        objectPath: creaturePath,
        functionName: "ClearCreatures",
        parameters: {},
      };

    case "Wait":
      throw new Error(
        "toRCFunctionCall: 'Wait' is runner-only and has no RC mapping; " +
          "intercept it before mapping (see runPlan).",
      );
    case "WaitForArrival":
      throw new Error(
        "toRCFunctionCall: 'WaitForArrival' is runner-only (it polls " +
          "QueryCreature); intercept it before mapping (see runPlan).",
      );
  }
}
