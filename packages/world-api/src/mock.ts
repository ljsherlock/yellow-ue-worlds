import type { WorldAPIClient } from "./client.js";
import {
  AdvanceTimeArgsSchema,
  type AdvanceTimeArgs,
  type AdvanceTimeResult,
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
 * The mock maintains plausible world state so the inspector renders something
 * meaningful: trees persist, time advances, the sky remembers its last preset.
 */
export interface MockWorldState {
  sky: SkyPreset;
  worldTimeHours: number;
  trees: SpawnedTree[];
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
    };
  }

  // TODO(R3): wrap in @boundary once packages/tracing/ lands (Task 0.4)
  async setSkyState(
    args: SetSkyStateArgs,
  ): Promise<WorldAPIResult<SetSkyStateResult>> {
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
  }

  // TODO(R3): wrap in @boundary once packages/tracing/ lands (Task 0.4)
  async advanceTime(
    args: AdvanceTimeArgs,
  ): Promise<WorldAPIResult<AdvanceTimeResult>> {
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
  }

  // TODO(R3): wrap in @boundary once packages/tracing/ lands (Task 0.4)
  async spawnTrees(
    args: SpawnTreesArgs,
  ): Promise<WorldAPIResult<SpawnTreesResult>> {
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
  }

  // TODO(R3): wrap in @boundary once packages/tracing/ lands (Task 0.4)
  async dispatch(call: WorldAPICall): Promise<WorldAPIDispatchResult> {
    switch (call.tool) {
      case "SetSkyState":
        return { tool: "SetSkyState", result: await this.setSkyState(call.args) };
      case "AdvanceTime":
        return { tool: "AdvanceTime", result: await this.advanceTime(call.args) };
      case "SpawnTrees":
        return { tool: "SpawnTrees", result: await this.spawnTrees(call.args) };
    }
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
    Math.max(0, hoursAdvanced) +
    estimateAgeFromStage(tree.growth_stage);
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
