import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { InMemorySink, resetTracingForTests, setSink } from "@yellow-ue/tracing";

import {
  type Entity,
  type WorldModelState,
  type Relationship,
  type Diet,
  type EntityKind,
  dist,
} from "../types.js";
import { stepWorld } from "../behaviour.js";
import { mulberry32 } from "../rng.js";
import { InMemoryWorldModel } from "../store.js";
import { SAVANNA_SCENE } from "../scene.js";

function entity(
  id: string,
  species: string,
  kind: EntityKind,
  diet: Diet,
  x: number,
  y: number,
  extra: Partial<Entity> = {},
): Entity {
  return {
    id,
    species,
    kind,
    diet,
    pos: { x, y },
    vel: { x: 0, y: 0 },
    hunger: 0,
    alert: 0,
    state: kind === "animal" ? "graze" : "idle",
    maxSpeed: kind === "animal" ? 8 : 0,
    radius: 1.5,
    color: "#fff",
    ...extra,
  };
}

function world(entities: Entity[], relationships: Relationship[], patch: Partial<WorldModelState> = {}): WorldModelState {
  return {
    entities,
    relationships,
    weather: { preset: "clear", temperature: 0.5, timeOfDay: 12 },
    elapsed: 0,
    bounds: 100,
    ...patch,
  };
}

function run(state: WorldModelState, steps: number, seed = 42, dt = 0.1): WorldModelState {
  const rng = mulberry32(seed);
  let s = state;
  for (let i = 0; i < steps; i++) s = stepWorld(s, dt, rng);
  return s;
}

describe("prey flees an approaching predator", () => {
  it("a rabbit that fears a hungry lion runs away from it", () => {
    const lion = entity("lion-0", "lion", "animal", "predator", 50, 50, { hunger: 1, maxSpeed: 9 });
    const rabbit = entity("rabbit-0", "rabbit", "animal", "prey", 62, 50, { maxSpeed: 8 });
    const rels: Relationship[] = [{ subject: "lion", predicate: "stalks", object: "rabbit" }];

    const out = run(world([lion, rabbit], rels), 25);
    const r = out.entities.find((e) => e.id === "rabbit-0")!;
    const l = out.entities.find((e) => e.id === "lion-0")!;

    expect(r.state).toBe("flee");
    expect(r.alert).toBeGreaterThan(0);
    // it fled away from the lion's starting side (toward +x)
    expect(r.pos.x).toBeGreaterThan(62);
    // a faster prey opens distance on a stalking predator
    expect(dist(r.pos, l.pos)).toBeGreaterThan(12);
  });
});

describe("a sated predator rests instead of hunting", () => {
  it("a full lion next to prey does not close the distance", () => {
    const lion = entity("lion-0", "lion", "animal", "predator", 50, 50, { hunger: 0, maxSpeed: 9 });
    const buffalo = entity("buffalo-0", "buffalo", "animal", "prey", 58, 50, { maxSpeed: 7 });
    const rels: Relationship[] = [{ subject: "lion", predicate: "stalks", object: "buffalo" }];

    const before = dist(lion.pos, buffalo.pos);
    const out = run(world([lion, buffalo], rels), 20);
    const l = out.entities.find((e) => e.id === "lion-0")!;
    const b = out.entities.find((e) => e.id === "buffalo-0")!;

    expect(l.state).toBe("rest");
    expect(dist(l.pos, b.pos)).toBeGreaterThanOrEqual(before - 1);
  });
});

describe("thirst draws grazers to the watering hole when it's hot", () => {
  it("a buffalo with no threats moves toward the hole in the heat", () => {
    const hole = entity("watering_hole-0", "watering_hole", "feature", "none", 50, 50, { radius: 7, maxSpeed: 0 });
    const buffalo = entity("buffalo-0", "buffalo", "animal", "prey", 12, 12, { maxSpeed: 7 });
    const rels: Relationship[] = [{ subject: "buffalo", predicate: "drinks-at", object: "watering_hole" }];

    const before = dist(buffalo.pos, hole.pos);
    const out = run(world([hole, buffalo], rels, { weather: { preset: "clear", temperature: 1, timeOfDay: 12 } }), 30);
    const b = out.entities.find((e) => e.id === "buffalo-0")!;

    expect(b.state).toBe("drink");
    expect(dist(b.pos, hole.pos)).toBeLessThan(before);
  });
});

describe("determinism", () => {
  it("same seed → byte-identical evolution", async () => {
    const a = new InMemoryWorldModel({ seed: 7 });
    const b = new InMemoryWorldModel({ seed: 7 });
    await a.loadScene(SAVANNA_SCENE);
    await b.loadScene(SAVANNA_SCENE);
    for (let i = 0; i < 60; i++) {
      a.step(0.1);
      b.step(0.1);
    }
    expect(JSON.stringify(a.getState().entities)).toBe(JSON.stringify(b.getState().entities));
  });
});

describe("entities stay inside the arena", () => {
  it("nothing escapes the bounds after a long run", async () => {
    const m = new InMemoryWorldModel({ seed: 3 });
    const s0 = await m.loadScene(SAVANNA_SCENE);
    let s = s0;
    for (let i = 0; i < 300; i++) s = m.step(0.1);
    for (const e of s.entities) {
      expect(e.pos.x).toBeGreaterThanOrEqual(0);
      expect(e.pos.x).toBeLessThanOrEqual(s.bounds);
      expect(e.pos.y).toBeGreaterThanOrEqual(0);
      expect(e.pos.y).toBeLessThanOrEqual(s.bounds);
    }
  });
});

describe("tracing (R3)", () => {
  beforeEach(() => resetTracingForTests());
  afterEach(() => resetTracingForTests());

  it("traces director-level mutations but not per-frame steps", async () => {
    const sink = new InMemorySink();
    setSink(sink);
    const m = new InMemoryWorldModel({ seed: 1 });
    await m.loadScene(SAVANNA_SCENE);
    await m.setWeather({ preset: "storm" });
    const afterDirectives = sink.byPrefix("world-model.").length;
    expect(afterDirectives).toBeGreaterThanOrEqual(2);

    for (let i = 0; i < 30; i++) m.step(0.1);
    // per-frame stepping must not add boundary events
    expect(sink.byPrefix("world-model.").length).toBe(afterDirectives);
  });
});
