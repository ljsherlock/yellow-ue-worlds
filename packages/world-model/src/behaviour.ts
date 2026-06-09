import {
  type Entity,
  type Relationship,
  type WorldModelState,
  type Vec2,
  add,
  scale,
  sub,
  norm,
  dist,
  clampLen,
} from "./types.js";

// Perception / behaviour tuning. World units assume a ~100-unit arena.
const PERCEPTION = 22; // how far an animal "sees" threats / herd-mates
const HUNT_RADIUS = 36; // how far a hungry predator will commit to a target
const ATTACK_RANGE = 4; // within this, a stalk becomes an attack burst
const HUNGER_RATE = 0.018; // hunger gained per sim-second
const HUNGRY_THRESHOLD = 0.45; // above this a predator wants to hunt
const ALERT_DECAY = 0.35; // fear bled off per sim-second

interface RelIndex {
  stalks: Set<string>; // `${predator}>${prey}`
  fears: Set<string>; // `${prey}>${threat}`
  herds: Set<string>; // `${a}>${b}` (same-species implied separately)
  drinksAt: Map<string, Set<string>>; // species -> feature species
  disturbs: Set<string>; // `${disturber}>${victim}`
}

function key(a: string, b: string): string {
  return `${a}>${b}`;
}

export function indexRelationships(rels: Relationship[]): RelIndex {
  const idx: RelIndex = {
    stalks: new Set(),
    fears: new Set(),
    herds: new Set(),
    drinksAt: new Map(),
    disturbs: new Set(),
  };
  for (const r of rels) {
    switch (r.predicate) {
      case "stalks":
        idx.stalks.add(key(r.subject, r.object));
        // a stalked species implicitly fears its stalker
        idx.fears.add(key(r.object, r.subject));
        break;
      case "flees-from":
        idx.fears.add(key(r.subject, r.object));
        break;
      case "herds-with":
        idx.herds.add(key(r.subject, r.object));
        break;
      case "drinks-at": {
        const set = idx.drinksAt.get(r.subject) ?? new Set<string>();
        set.add(r.object);
        idx.drinksAt.set(r.subject, set);
        break;
      }
      case "disturbs":
        idx.disturbs.add(key(r.subject, r.object));
        idx.fears.add(key(r.object, r.subject));
        break;
    }
  }
  return idx;
}

interface StepCtx {
  next: Entity[];
  features: Entity[];
  rel: RelIndex;
  thirstPull: number;
  stormy: boolean;
  bounds: number;
  dt: number;
  rng: () => number;
}

/**
 * Advance the world one tick. Pure w.r.t. the input state (returns a new state);
 * deterministic given the same `rng`. This is the layer that turns the LLM's
 * declared relationships + dispositions into visible, emergent behaviour.
 */
export function stepWorld(
  state: WorldModelState,
  dt: number,
  rng: () => number = Math.random,
): WorldModelState {
  const rel = indexRelationships(state.relationships);
  const next = state.entities.map((e) => ({
    ...e,
    pos: { ...e.pos },
    vel: { ...e.vel },
  }));

  const features = next.filter((e) => e.kind === "feature");

  // Weather-derived scalars. Midday peaks at noon and drives both thirst and
  // predator lethargy (lions rest through the heat of the day).
  const heat = state.weather.temperature;
  const midday = 1 - Math.min(Math.abs(state.weather.timeOfDay - 12) / 6, 1);
  const thirstPull = heat * (0.5 + 0.5 * midday);
  const stormy = state.weather.preset === "storm";

  const ctx: StepCtx = { next, features, rel, thirstPull, stormy, bounds: state.bounds, dt, rng };

  for (const e of next) {
    if (e.kind === "vehicle") stepVehicle(e, ctx);
    else if (e.kind === "animal") {
      if (e.diet === "predator") stepPredator(e, ctx, heat * midday);
      else stepPrey(e, ctx);
    }
    integrate(e, ctx);
  }

  return { ...state, entities: next, elapsed: state.elapsed + dt };
}

// ─────────────────────────────────────────────────────────────────────────────

function stepPrey(e: Entity, ctx: StepCtx): void {
  e.alert = Math.max(0, e.alert - ALERT_DECAY * ctx.dt);

  // 1) Threats: predators that stalk us, or vehicles that disturb us, in range.
  let flee: Vec2 = { x: 0, y: 0 };
  let threatened = false;
  for (const o of ctx.next) {
    if (o.id === e.id) continue;
    const isPredator = o.kind === "animal" && o.diet === "predator";
    const isDisturber = o.kind === "vehicle" && ctx.rel.disturbs.has(`${o.species}>${e.species}`);
    if (!isPredator && !isDisturber) continue;
    if (isPredator && !ctx.rel.fears.has(`${e.species}>${o.species}`)) continue;
    const d = dist(e.pos, o.pos);
    if (d > PERCEPTION) continue;
    // closer + actively hunting = scarier
    const aggression = o.state === "attack" ? 2 : o.state === "stalk" ? 1.4 : 1;
    const w = ((PERCEPTION - d) / PERCEPTION) * aggression;
    flee = add(flee, scale(norm(sub(e.pos, o.pos)), w));
    threatened = true;
  }

  if (threatened) {
    e.alert = Math.min(1, e.alert + 1.6 * ctx.dt);
    e.state = "flee";
    e.desired = scale(norm(flee), e.maxSpeed);
    return;
  }

  // 2) Thirst: drawn to a watering hole when it's hot.
  const holes = ctx.rel.drinksAt.get(e.species);
  if (holes && ctx.thirstPull > 0.3) {
    const hole = nearest(e, ctx.features, (f) => holes.has(f.species));
    if (hole) {
      const d = dist(e.pos, hole.pos);
      if (d > hole.radius + 2) {
        e.state = "drink";
        e.desired = scale(norm(sub(hole.pos, e.pos)), e.maxSpeed * 0.6);
      } else {
        e.state = "drink";
        e.desired = scale(e.vel, 0.2); // arrived — settle and drink
      }
      return;
    }
  }

  // 3) Otherwise graze + herd with own kind (boids-lite).
  e.state = "graze";
  e.desired = grazeForce(e, ctx);
}

function stepPredator(e: Entity, ctx: StepCtx, middayHeat: number): void {
  e.hunger = Math.min(1, e.hunger + HUNGER_RATE * ctx.dt);

  // Heat makes a predator lazier — it tolerates more hunger before bothering.
  const threshold = HUNGRY_THRESHOLD + 0.3 * middayHeat;

  if (e.hunger <= threshold) {
    // Sated / too hot: rest. Drift away from the herd and settle (sleep far off).
    const prey = nearest(e, ctx.next, (o) => o.diet === "prey");
    e.state = "rest";
    e.desired = prey
      ? scale(norm(sub(e.pos, prey.pos)), e.maxSpeed * 0.12)
      : scale(e.vel, 0.1);
    return;
  }

  // Hungry: find the nearest prey species we stalk, within commit range.
  const target = nearest(
    e,
    ctx.next,
    (o) => o.diet === "prey" && ctx.rel.stalks.has(`${e.species}>${o.species}`),
    HUNT_RADIUS,
  );
  if (!target) {
    e.state = "patrol";
    e.desired = wander(e, ctx, e.maxSpeed * 0.4);
    return;
  }

  const d = dist(e.pos, target.pos);
  if (d > ATTACK_RANGE) {
    e.state = "stalk"; // slow, deliberate approach
    e.desired = scale(norm(sub(target.pos, e.pos)), e.maxSpeed * 0.55);
  } else {
    e.state = "attack"; // burst
    e.desired = scale(norm(sub(target.pos, e.pos)), e.maxSpeed);
    if (d < e.radius + target.radius + 0.5) {
      // caught: predator is sated; the prey "escapes" to the herd's edge so
      // counts stay stable and the scene keeps running.
      e.hunger = 0;
      e.state = "rest";
      respawnAtEdge(target, ctx);
    }
  }
}

function stepVehicle(e: Entity, ctx: StepCtx): void {
  e.state = "patrol";
  // occasional heading change → a lazy wandering patrol
  if (ctx.rng() < 0.02) {
    const ang = ctx.rng() * Math.PI * 2;
    e.desired = { x: Math.cos(ang) * e.maxSpeed, y: Math.sin(ang) * e.maxSpeed };
  } else {
    const keep = clampLen(e.vel, e.maxSpeed);
    e.desired = len2(keep) > 0.01 ? keep : wander(e, ctx, e.maxSpeed);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

function grazeForce(e: Entity, ctx: StepCtx): Vec2 {
  let cohesion: Vec2 = { x: 0, y: 0 };
  let separation: Vec2 = { x: 0, y: 0 };
  let count = 0;
  for (const o of ctx.next) {
    if (o.id === e.id || o.kind !== "animal") continue;
    const sameHerd = o.species === e.species || ctx.rel.herds.has(`${e.species}>${o.species}`);
    if (!sameHerd) continue;
    const d = dist(e.pos, o.pos);
    if (d > PERCEPTION) continue;
    cohesion = add(cohesion, o.pos);
    if (d < e.radius * 4 && d > 1e-6) {
      separation = add(separation, scale(norm(sub(e.pos, o.pos)), (e.radius * 4 - d) / (e.radius * 4)));
    }
    count++;
  }
  let force = wander(e, ctx, e.maxSpeed * 0.4);
  if (count > 0) {
    const center = scale(cohesion, 1 / count);
    force = add(force, scale(norm(sub(center, e.pos)), e.maxSpeed * 0.25));
    force = add(force, scale(separation, e.maxSpeed * 0.5));
  }
  if (ctx.stormy) force = scale(force, 0.6); // hunker down in a storm
  return clampLen(force, e.maxSpeed * 0.5);
}

function wander(e: Entity, ctx: StepCtx, speed: number): Vec2 {
  const ang = ctx.rng() * Math.PI * 2;
  const jitter = { x: Math.cos(ang), y: Math.sin(ang) };
  // bias toward current heading so wandering looks smooth, not jittery
  const heading = len2(e.vel) > 0.01 ? norm(e.vel) : jitter;
  return scale(norm(add(scale(heading, 0.7), scale(jitter, 0.3))), speed);
}

function integrate(e: Entity, ctx: StepCtx): void {
  const desired = e.desired ?? { x: 0, y: 0 };
  // smooth toward desired velocity, then clamp to the entity's top speed
  e.vel = clampLen(add(scale(e.vel, 0.6), scale(desired, 0.4)), e.maxSpeed);
  e.pos = add(e.pos, scale(e.vel, ctx.dt));
  delete e.desired;

  // keep inside the arena; bounce velocity off the walls
  const lo = e.radius;
  const hi = ctx.bounds - e.radius;
  if (e.pos.x < lo) {
    e.pos.x = lo;
    e.vel.x = Math.abs(e.vel.x);
  } else if (e.pos.x > hi) {
    e.pos.x = hi;
    e.vel.x = -Math.abs(e.vel.x);
  }
  if (e.pos.y < lo) {
    e.pos.y = lo;
    e.vel.y = Math.abs(e.vel.y);
  } else if (e.pos.y > hi) {
    e.pos.y = hi;
    e.vel.y = -Math.abs(e.vel.y);
  }
}

function respawnAtEdge(e: Entity, ctx: StepCtx): void {
  const b = ctx.bounds;
  const r = ctx.rng();
  if (r < 0.25) e.pos = { x: e.radius, y: ctx.rng() * b };
  else if (r < 0.5) e.pos = { x: b - e.radius, y: ctx.rng() * b };
  else if (r < 0.75) e.pos = { x: ctx.rng() * b, y: e.radius };
  else e.pos = { x: ctx.rng() * b, y: b - e.radius };
  e.vel = { x: 0, y: 0 };
  e.alert = 1;
  e.state = "flee";
}

function nearest(
  e: Entity,
  pool: Entity[],
  pred: (o: Entity) => boolean,
  maxDist = Infinity,
): Entity | undefined {
  let best: Entity | undefined;
  let bestD = maxDist;
  for (const o of pool) {
    if (o.id === e.id || !pred(o)) continue;
    const d = dist(e.pos, o.pos);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

function len2(a: Vec2): number {
  return a.x * a.x + a.y * a.y;
}
