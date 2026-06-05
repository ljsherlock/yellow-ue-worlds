import type { RCBridge } from "./client.js";
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

/**
 * Event channel (the UE→brain push half of installment 6.3): rather than the
 * brain polling each creature's full state, the CreatureDirector buffers
 * discrete transitions (arrived / atWater / thirsty / tired) and hands them over
 * in one shot via DrainEvents, clearing its queue. This is the seam a slow LLM
 * loop reads from: drain, react, drain again — no per-creature QueryCreature
 * storm, and nothing is missed between reads.
 */
export interface CreatureEvent {
  id: string;
  /** e.g. "arrived" | "atWater" | "thirsty" | "tired". */
  event: string;
}

/** RC call that returns buffered creature events as a JSON array and clears the queue. */
export function drainEventsCall(
  creaturePath: string = CREATURE_DIRECTOR_PATH,
): RCFunctionCall {
  return {
    objectPath: creaturePath,
    functionName: "DrainEvents",
    parameters: {},
    // Draining mutates the queue, but it's a read-and-clear, not a world edit —
    // no undo transaction (matches the other perception reads).
    generateTransaction: false,
  };
}

/** Parse a DrainEvents response into an array (empty if absent/unparseable). */
export function parseEvents(returnValue: unknown): CreatureEvent[] {
  const s = extractReturnString(returnValue);
  if (!s) {
    return [];
  }
  try {
    const arr = JSON.parse(s);
    if (!Array.isArray(arr)) {
      return [];
    }
    return (arr as Partial<CreatureEvent>[]).filter(
      (e): e is CreatureEvent =>
        !!e && typeof e.id === "string" && typeof e.event === "string",
    );
  } catch {
    return [];
  }
}

export interface DrainEventLoopOptions {
  paths?: { creatureDirector?: string };
  /** How often to drain, ms. Default 1000. */
  pollMs?: number;
  /** Injectable sleep (tests pass a controllable one); defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Stop the loop. When this returns true the loop exits after the next drain. */
  stop?: () => boolean;
}

/**
 * Poll DrainEvents on an interval and invoke `onEvents` with each non-empty
 * batch. Returns when `stop()` reports true (or never, if no stop is given —
 * callers typically race it against an AbortController-style flag). Designed as
 * the brain's perception pump: keep it draining while the LLM deliberates so
 * events accumulate in UE and arrive in order on the next tick.
 */
export async function drainEventLoop(
  bridge: RCBridge,
  onEvents: (events: CreatureEvent[]) => void | Promise<void>,
  options: DrainEventLoopOptions = {},
): Promise<void> {
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pollMs = options.pollMs ?? 1000;
  const creaturePath = options.paths?.creatureDirector ?? CREATURE_DIRECTOR_PATH;
  const call = drainEventsCall(creaturePath);

  for (;;) {
    const res = await bridge.callFunction(call);
    const events = parseEvents(res.returnValue);
    if (events.length > 0) {
      await onEvents(events);
    }
    if (options.stop?.()) {
      return;
    }
    await sleep(pollMs);
  }
}
