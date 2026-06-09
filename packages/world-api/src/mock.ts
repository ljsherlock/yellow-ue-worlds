import { boundary } from "@yellow-ue/tracing";

import type { WorldAPIClient } from "./client.js";
import {
  AdvanceTimeArgsSchema,
  type AdvanceTimeArgs,
  type AdvanceTimeResult,
  type CreatureAck,
  type CreatureSpecies,
  SetSkyStateArgsSchema,
  type SetSkyStateArgs,
  type SetSkyStateResult,
  type SkyPreset,
  type SpawnTreesArgs,
  SpawnTreesArgsSchema,
  type SpawnTreesResult,
  type SpawnedTree,
  type WorldAPICall,
  type WorldAPIDispatchResult,
  type WorldAPIError,
  type WorldAPIResult,
} from "./contract.js";

/**
 * In-memory MockWorldAPIClient.
 *
 * Purpose:
 * 1. Inspector pages (R1) import this so they can render real data flow
 *    against a fake UE without standing up a GPU instance.
 * 2. The Brain (LangGraph agent) can be developed and tested against this
 *    before the RC bridge exists.
 *
 * Every cross-package method is wrapped in `boundary()` (R3) so the
 * Pipeline Trace Viewer can render the call lifecycle.
 *
 * The mock maintains plausible world state so the inspector renders something
 * meaningful: trees persist, time advances, the sky remembers its last preset.
 */
export interface MockCreature {
  id: string;
  species: CreatureSpecies;
  state: string;
  at: string;
}

export interface MockWorldState {
  sky: SkyPreset;
  worldTimeHours: number;
  trees: SpawnedTree[];
  creatures: MockCreature[];
}

export interface MockWorldAPIClientOptions {
  initialState?: Partial<MockWorldState>;
  now?: () => Date;
  randomId?: () => string;
}

const defaultState = (): MockWorldState => ({
  sky: "clear",
  worldTimeHours: 0,
  trees: [],
  creatures: [],
});

const defaultNow = () => new Date();

let idCounter = 0;
const defaultRandomId = () => {
  idCounter += 1;
  return `mock-${idCounter.toString(36)}`;
};

const ok = <T>(data: T): WorldAPIResult<T> => ({ ok: true, data });
const err = (error: WorldAPIError): WorldAPIResult<never> => ({ ok: false, error });

export class MockWorldAPIClient implements WorldAPIClient {
  private readonly state: MockWorldState;
  private readonly now: () => Date;
  private readonly randomId: () => string;

  constructor(options: MockWorldAPIClientOptions = {}) {
    this.state = { ...defaultState(), ...(options.initialState ?? {}) };
    this.now = options.now ?? defaultNow;
    this.randomId = options.randomId ?? defaultRandomId;
  }

  // For inspector pages: read current state without going through API
  snapshot(): MockWorldState {
    return {
      sky: this.state.sky,
      worldTimeHours: this.state.worldTimeHours,
      trees: [...this.state.trees],
      creatures: this.state.creatures.map((c) => ({ ...c })),
    };
  }

  // R3: class-field arrow + boundary() — `this` is captured at field init
  // and resolved at call time, so this.state etc. are always the live
  // instance state by the time the boundary fires.

  setSkyState = boundary(
    "world-api.setSkyState",
    async (
      args: SetSkyStateArgs,
    ): Promise<WorldAPIResult<SetSkyStateResult>> => {
      const parsed = SetSkyStateArgsSchema.safeParse(args);
      if (!parsed.success) {
        return err({
          code: "INVALID_ARGS",
          message: "setSkyState received invalid arguments",
          details: parsed.error.issues,
        });
      }
      const previous = this.state.sky;
      this.state.sky = parsed.data.preset;
      return ok<SetSkyStateResult>({
        previous,
        current: parsed.data.preset,
        transition_seconds: parsed.data.transition_seconds,
        applied_at: this.now().toISOString(),
      });
    },
  );

  advanceTime = boundary(
    "world-api.advanceTime",
    async (
      args: AdvanceTimeArgs,
    ): Promise<WorldAPIResult<AdvanceTimeResult>> => {
      const parsed = AdvanceTimeArgsSchema.safeParse(args);
      if (!parsed.success) {
        return err({
          code: "INVALID_ARGS",
          message: "advanceTime received invalid arguments",
          details: parsed.error.issues,
        });
      }
      const previous = this.state.worldTimeHours;
      this.state.worldTimeHours = previous + parsed.data.hours;
      this.state.trees = this.state.trees.map((tree) =>
        growTree(tree, parsed.data.hours),
      );
      return ok<AdvanceTimeResult>({
        previous_world_time_hours: previous,
        current_world_time_hours: this.state.worldTimeHours,
        hours_advanced: parsed.data.hours,
        speed_multiplier: parsed.data.speed_multiplier,
        applied_at: this.now().toISOString(),
      });
    },
  );

  spawnTrees = boundary(
    "world-api.spawnTrees",
    async (
      args: SpawnTreesArgs,
    ): Promise<WorldAPIResult<SpawnTreesResult>> => {
      const parsed = SpawnTreesArgsSchema.safeParse(args);
      if (!parsed.success) {
        return err({
          code: "INVALID_ARGS",
          message: "spawnTrees received invalid arguments",
          details: parsed.error.issues,
        });
      }
      const { area, count, species, growth_stage } = parsed.data;
      const spawned: SpawnedTree[] = [];
      for (let i = 0; i < count; i += 1) {
        // deterministic placement when randomId is deterministic — important
        // for inspector snapshot testing
        const angle = (i / count) * Math.PI * 2;
        const r = area.radius * Math.sqrt((i + 1) / count);
        spawned.push({
          id: this.randomId(),
          position: {
            x: area.center.x + Math.cos(angle) * r,
            y: area.center.y + Math.sin(angle) * r,
            z: area.center.z,
          },
          species,
          growth_stage,
          planted_at_world_time_hours: this.state.worldTimeHours,
        });
      }
      this.state.trees.push(...spawned);
      return ok<SpawnTreesResult>({
        spawned,
        count: spawned.length,
        applied_at: this.now().toISOString(),
      });
    },
  );

  dispatch = boundary(
    "world-api.dispatch",
    async (call: WorldAPICall): Promise<WorldAPIDispatchResult> => {
      switch (call.tool) {
        case "SetSkyState":
          return {
            tool: "SetSkyState",
            result: await this.setSkyState(call.args),
          };
        case "AdvanceTime":
          return {
            tool: "AdvanceTime",
            result: await this.advanceTime(call.args),
          };
        case "SpawnTrees":
          return {
            tool: "SpawnTrees",
            result: await this.spawnTrees(call.args),
          };
        case "SpawnCreature": {
          const { id, species, at } = call.args;
          const existing = this.state.creatures.find((c) => c.id === id);
          if (existing) {
            existing.species = species;
            existing.at = at;
            existing.state = "idle";
          } else {
            this.state.creatures.push({ id, species, at, state: "idle" });
          }
          return {
            tool: "SpawnCreature",
            result: this.ack(`spawned ${species} '${id}' at ${at}`),
          };
        }
        case "MoveCreatureTo": {
          const c = this.state.creatures.find((x) => x.id === call.args.id);
          if (c) {
            c.state = "walk";
            c.at = call.args.to;
          }
          return {
            tool: "MoveCreatureTo",
            result: this.ack(`'${call.args.id}' -> ${call.args.to}`),
          };
        }
        case "SetCreatureState": {
          const c = this.state.creatures.find((x) => x.id === call.args.id);
          if (c) c.state = call.args.state;
          return {
            tool: "SetCreatureState",
            result: this.ack(`'${call.args.id}' state=${call.args.state}`),
          };
        }
        case "SetCreatureLeader":
          return {
            tool: "SetCreatureLeader",
            result: this.ack(
              `'${call.args.id}' follows '${call.args.leader_id}'`,
            ),
          };
        case "WanderCreature": {
          const c = this.state.creatures.find((x) => x.id === call.args.id);
          if (c) c.state = "wander";
          return {
            tool: "WanderCreature",
            result: this.ack(`'${call.args.id}' wanders ${call.args.around}`),
          };
        }
        case "DespawnCreature": {
          this.state.creatures = this.state.creatures.filter(
            (x) => x.id !== call.args.id,
          );
          return {
            tool: "DespawnCreature",
            result: this.ack(`despawned '${call.args.id}'`),
          };
        }
        case "ClearCreatures": {
          const n = this.state.creatures.length;
          this.state.creatures = [];
          return {
            tool: "ClearCreatures",
            result: this.ack(`cleared ${n} creature(s)`),
          };
        }
        case "Wait":
          // Runner-only in the live bridge; the mock just acknowledges.
          return {
            tool: "Wait",
            result: this.ack(`wait ${call.args.seconds}s`),
          };
        case "WaitForArrival":
          // Runner-only: the live bridge polls QueryCreature; the mock (no live
          // perception) just acknowledges as if the creature arrived instantly.
          return {
            tool: "WaitForArrival",
            result: this.ack(`await arrival of ${call.args.id}`),
          };
      }
    },
  );

  private ack(detail: string): WorldAPIResult<CreatureAck> {
    return ok<CreatureAck>({ detail, applied_at: this.now().toISOString() });
  }
}

const STAGE_ORDER: ReadonlyArray<SpawnedTree["growth_stage"]> = [
  "seedling",
  "sapling",
  "mature",
];

// Toy growth model — seedling → sapling at 24h, sapling → mature at 24*7h.
// Real growth lives in UE; this exists so the inspector shows trees evolving
// when AdvanceTime is called.
function growTree(tree: SpawnedTree, hoursAdvanced: number): SpawnedTree {
  const ageHours =
    Math.max(0, hoursAdvanced) + estimateAgeFromStage(tree.growth_stage);
  let stage: SpawnedTree["growth_stage"] = "seedling";
  if (ageHours >= 24 * 7) stage = "mature";
  else if (ageHours >= 24) stage = "sapling";
  if (stage === tree.growth_stage) return tree;
  const idx = STAGE_ORDER.indexOf(stage);
  const prevIdx = STAGE_ORDER.indexOf(tree.growth_stage);
  if (idx <= prevIdx) return tree;
  return { ...tree, growth_stage: stage };
}

function estimateAgeFromStage(stage: SpawnedTree["growth_stage"]): number {
  switch (stage) {
    case "seedling":
      return 0;
    case "sapling":
      return 24;
    case "mature":
      return 24 * 7;
  }
}
