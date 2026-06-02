import type { WorldAPICall } from "@yellow-ue/world-api";

import type { RCFunctionCall } from "./contract.js";

/**
 * The object path of the world director actor that exposes the world-API
 * functions to Remote Control. Confirmed against the built spike level
 * (make_map.py spawns AWorldDirector into /Game/Maps/Spike). Override per-call
 * with the CLI `--path` flag or the RC_OBJECT_PATH env var.
 */
export const WORLD_DIRECTOR_PATH =
  "/Game/Maps/Spike.Spike:PersistentLevel.WorldDirector_0";

/**
 * Translate a high-level `WorldAPICall` into the low-level Remote Control
 * function call that drives Unreal. This is the real mapping logic the
 * Phase 2 bridge will use — not throwaway inspector code (R1).
 */
export function toRCFunctionCall(call: WorldAPICall): RCFunctionCall {
  switch (call.tool) {
    case "SetSkyState":
      return {
        objectPath: WORLD_DIRECTOR_PATH,
        functionName: "SetSkyState",
        parameters: {
          Preset: call.args.preset,
          TransitionSeconds: call.args.transition_seconds ?? 5,
        },
      };
    case "AdvanceTime":
      return {
        objectPath: WORLD_DIRECTOR_PATH,
        functionName: "AdvanceTime",
        parameters: {
          Hours: call.args.hours,
          SpeedMultiplier: call.args.speed_multiplier ?? 1,
        },
      };
    case "SpawnTrees":
      return {
        objectPath: WORLD_DIRECTOR_PATH,
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
  }
}
