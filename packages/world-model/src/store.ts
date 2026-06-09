import { boundary } from "@yellow-ue/tracing";

import { type WorldModelState, type Weather, type SceneSpec } from "./types.js";
import { buildWorld } from "./scene.js";
import { stepWorld } from "./behaviour.js";
import { mulberry32 } from "./rng.js";

/**
 * WorldModel — the authoritative relationship graph + behaviour state.
 *
 * The LLM *director* mutates it coarsely (load a scene, change the weather);
 * the deterministic sim advances it every tick. Coarse, director-level
 * mutations are traced (R3). Per-frame `step` is intentionally NOT traced —
 * tracing 60 events/second would drown the pipeline (same exception we make
 * for streaming sample subscriptions).
 */
export interface WorldModel {
  loadScene(spec: SceneSpec, seed?: number): Promise<WorldModelState>;
  setWeather(patch: Partial<Weather>): Promise<WorldModelState>;
  step(dt: number): WorldModelState;
  getState(): WorldModelState;
}

export interface InMemoryWorldModelOptions {
  /** seed for both scene layout and the behaviour RNG → fully deterministic. */
  seed?: number;
}

export class InMemoryWorldModel implements WorldModel {
  private state: WorldModelState;
  private rng: () => number;
  private readonly seed: number;

  constructor(options: InMemoryWorldModelOptions = {}) {
    this.seed = options.seed ?? 1;
    this.rng = mulberry32(this.seed);
    this.state = {
      entities: [],
      relationships: [],
      weather: { preset: "clear", temperature: 0.5, timeOfDay: 12 },
      elapsed: 0,
      bounds: 100,
    };
  }

  loadScene = boundary(
    "world-model.loadScene",
    async (spec: SceneSpec, seed?: number): Promise<WorldModelState> => {
      const s = seed ?? this.seed;
      this.rng = mulberry32(s);
      this.state = buildWorld(spec, s);
      return this.snapshot();
    },
  );

  setWeather = boundary(
    "world-model.setWeather",
    async (patch: Partial<Weather>): Promise<WorldModelState> => {
      this.state = { ...this.state, weather: { ...this.state.weather, ...patch } };
      return this.snapshot();
    },
  );

  step(dt: number): WorldModelState {
    this.state = stepWorld(this.state, dt, this.rng);
    return this.state;
  }

  getState(): WorldModelState {
    return this.snapshot();
  }

  private snapshot(): WorldModelState {
    return {
      ...this.state,
      entities: this.state.entities.map((e) => ({ ...e, pos: { ...e.pos }, vel: { ...e.vel } })),
      relationships: this.state.relationships.map((r) => ({ ...r })),
      weather: { ...this.state.weather },
    };
  }
}
