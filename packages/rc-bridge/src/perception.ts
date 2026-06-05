import type { RCFunctionCall } from "./contract.js";
import { CREATURE_DIRECTOR_PATH } from "./creatures.js";

/**
 * Read-back (installment 6.3): the brain/sim PERCEIVES the world instead of
 * guessing with wall-clock sleeps. The CreatureDirector exposes QueryCreature /
 * QueryCreatures over Remote Control, returning a JSON string (UE wraps a
 * UFUNCTION's FString return as `{ "ReturnValue": "<json>" }`). These helpers
 * build the RC calls and parse that envelope back into typed state.
 */
export interface CreatureState {
  id: string;
  type: string;
  state: string;
  x: number;
  y: number;
  z: number;
  speed: number;
  /** Stopped at its goal (path/target finished, or halted at the shoreline). */
  arrived: boolean;
  /** The stop was specifically the water's edge (a drink-ready arrival). */
  atWater: boolean;
}

/** RC call that returns one creature's state as a JSON object (or "{}"). */
export function queryCreatureCall(
  id: string,
  creaturePath: string = CREATURE_DIRECTOR_PATH,
): RCFunctionCall {
  return {
    objectPath: creaturePath,
    functionName: "QueryCreature",
    parameters: { Id: id },
    // Pure read — no undo transaction.
    generateTransaction: false,
  };
}

/** RC call that returns every live creature's state as a JSON array. */
export function queryCreaturesCall(
  creaturePath: string = CREATURE_DIRECTOR_PATH,
): RCFunctionCall {
  return {
    objectPath: creaturePath,
    functionName: "QueryCreatures",
    parameters: {},
    generateTransaction: false,
  };
}

/** Pull the JSON string out of UE's `{ ReturnValue: "<json>" }` envelope. */
function extractReturnString(returnValue: unknown): string | null {
  if (typeof returnValue === "string") {
    return returnValue;
  }
  if (
    returnValue &&
    typeof returnValue === "object" &&
    "ReturnValue" in returnValue
  ) {
    const v = (returnValue as { ReturnValue: unknown }).ReturnValue;
    return typeof v === "string" ? v : null;
  }
  return null;
}

/** Parse a QueryCreature response into state, or null if absent/unparseable. */
export function parseCreature(returnValue: unknown): CreatureState | null {
  const s = extractReturnString(returnValue);
  if (!s) {
    return null;
  }
  try {
    const o = JSON.parse(s) as Partial<CreatureState>;
    if (!o || typeof o.id !== "string" || o.id.length === 0) {
      return null;
    }
    return o as CreatureState;
  } catch {
    return null;
  }
}

/** Parse a QueryCreatures response into an array (empty if absent/unparseable). */
export function parseCreatures(returnValue: unknown): CreatureState[] {
  const s = extractReturnString(returnValue);
  if (!s) {
    return [];
  }
  try {
    const arr = JSON.parse(s);
    return Array.isArray(arr) ? (arr as CreatureState[]) : [];
  } catch {
    return [];
  }
}
