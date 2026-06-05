import type { WorldAPICall } from "@yellow-ue/world-api";

import type { RCBridge } from "./client.js";
import type { RCResponse } from "./contract.js";
import {
  CREATURE_DIRECTOR_PATH,
  defineSpeciesCall,
  setWaterLevelCall,
} from "./creatures.js";
import { toRCFunctionCall, WORLD_DIRECTOR_PATH, type RCPaths } from "./mapping.js";

/**
 * Execute a brain plan — an ordered list of `WorldAPICall`s — against a live
 * Unreal instance. This is the Phase-4 wire: the brain emits intent, this runs
 * it in order over Remote Control.
 *
 * Responsibilities the pure mapping can't own (it is 1 call → 1 RC call):
 *  - Bootstrap: before the first `SpawnCreature` of a species, register the
 *    type (DefineCreatureType) and tell the herd the landmark's waterline
 *    (SetWaterLevel) — once each, derived from the creature registry.
 *  - Sequencing: `Wait` is honoured locally (a director pause) and never sent
 *    to UE — the scripted-timing stopgap until the read-back loop (installment
 *    B) lets actions fire on world events instead of wall-clock sleeps.
 */
export interface RunPlanOptions {
  paths?: RCPaths;
  /** Injectable sleep (tests pass a no-op); defaults to real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Called for each step so callers can stream progress. */
  onStep?: (step: RunStep) => void;
  /** Stop on the first failed RC call. Default true. */
  stopOnError?: boolean;
}

export interface RunStep {
  index: number;
  tool: WorldAPICall["tool"];
  /** "rc" for a forwarded RC call, "wait" for a local pause, "bootstrap" for an
   *  injected DefineCreatureType/SetWaterLevel. */
  kind: "rc" | "wait" | "bootstrap";
  detail: string;
  response?: RCResponse;
}

const realSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function runPlan(
  calls: WorldAPICall[],
  bridge: RCBridge,
  options: RunPlanOptions = {},
): Promise<RunStep[]> {
  const sleep = options.sleep ?? realSleep;
  const stopOnError = options.stopOnError ?? true;
  const creaturePath = options.paths?.creatureDirector ?? CREATURE_DIRECTOR_PATH;
  const worldPath = options.paths?.worldDirector ?? WORLD_DIRECTOR_PATH;
  const paths: RCPaths = {
    worldDirector: worldPath,
    creatureDirector: creaturePath,
  };

  const steps: RunStep[] = [];
  const definedSpecies = new Set<string>();
  let waterSetFor: string | null = null;

  const record = (step: RunStep) => {
    steps.push(step);
    options.onStep?.(step);
  };

  for (const [i, call] of calls.entries()) {
    if (call.tool === "Wait") {
      const ms = Math.round(call.args.seconds * 1000);
      record({ index: i, tool: "Wait", kind: "wait", detail: `sleep ${call.args.seconds}s` });
      await sleep(ms);
      continue;
    }

    // Bootstrap a species/landmark the first time we spawn into it.
    if (call.tool === "SpawnCreature") {
      if (!definedSpecies.has(call.args.species)) {
        const def = defineSpeciesCall(call.args.species, creaturePath);
        const res = await bridge.callFunction(def);
        record({
          index: i,
          tool: "SpawnCreature",
          kind: "bootstrap",
          detail: `DefineCreatureType ${call.args.species}`,
          response: res,
        });
        definedSpecies.add(call.args.species);
        if (!res.ok && stopOnError) return steps;
      }
      if (waterSetFor !== call.args.at) {
        const water = setWaterLevelCall(call.args.at, creaturePath);
        const res = await bridge.callFunction(water);
        record({
          index: i,
          tool: "SpawnCreature",
          kind: "bootstrap",
          detail: `SetWaterLevel @ ${call.args.at}`,
          response: res,
        });
        waterSetFor = call.args.at;
        if (!res.ok && stopOnError) return steps;
      }
    }

    const rc = toRCFunctionCall(call, paths);
    const res = await bridge.callFunction(rc);
    record({
      index: i,
      tool: call.tool,
      kind: "rc",
      detail: `${rc.functionName}(${JSON.stringify(rc.parameters)})`,
      response: res,
    });
    if (!res.ok && stopOnError) return steps;
  }

  return steps;
}
