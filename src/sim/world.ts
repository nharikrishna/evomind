import type { SimConfig } from "./config";
import type { Action, Creature, Food } from "./types";
import type { Controller } from "./controllers";
import { Rng } from "./rng";
import { TorusGrid } from "./spatial";
import { preySensorCount, sensePrey } from "./sensors";
import { clamp, wrapAngle, wrapCoord } from "./math";
import { defaultBody } from "./body";

/**
 * The world. Arrays are parallel: creatures[i] is driven by controllers[i] and
 * senses into sensorViews[i]. In lab mode the population is fixed; in natural
 * mode creatures are added (births) and removed (deaths) between ticks, so code
 * outside the step loop should identify creatures by `id`, not by index.
 */
export interface World {
  readonly config: SimConfig;
  readonly rng: Rng;
  tick: number;
  creatures: Creature[];
  controllers: Controller[];
  food: Food[];
  foodGrid: TorusGrid;
  /** Nearest sensed food per creature (-1 = none), refreshed every tick. */
  nearestFood: number[];
  /** Last sensor vector per creature (each its own buffer, reused every tick). */
  sensorViews: Float32Array[];
  /** Next unused creature id. */
  nextCreatureId: number;
  readonly enforceNeuralPrey: boolean;
}

/**
 * Builds the controller for creature `index`. Factories that attach a genome may
 * also replace `creature.body` with the genome's evolved body.
 */
export type ControllerFactory = (creature: Creature, index: number, rng: Rng, config: SimConfig) => Controller;

export interface WorldOptions {
  /**
   * Project rule: prey behavior must come from an evolved brain. Only physics
   * tests turn this off so they can drive creatures with fixed actions.
   */
  enforceNeuralPrey?: boolean;
}

/** A fresh creature with no genome yet (default body, starting energy). */
export function newCreature(world: World, x: number, y: number, heading: number): Creature {
  return {
    id: world.nextCreatureId++,
    speciesId: "prey",
    x,
    y,
    heading,
    speed: 0,
    energy: world.config.initialEnergy,
    alive: true,
    foodEaten: 0,
    age: 0,
    genomeId: null,
    body: defaultBody(world.config),
    children: 0,
    distanceTraveled: 0,
    energySpent: 0,
    alignmentSum: 0,
    alignmentTicks: 0,
    ticksTowardFood: 0,
  };
}

/** Add a creature (initial population or a birth). */
export function addCreature(world: World, c: Creature, ctrl: Controller): void {
  if (world.enforceNeuralPrey && c.speciesId === "prey" && ctrl.kind !== "neural") {
    throw new Error(`Prey ${c.id} has a "${ctrl.kind}" controller; prey must be neural.`);
  }
  // The genome may have given this creature a smaller energy store than its starting energy.
  c.energy = Math.min(c.energy, c.body.maxEnergy);
  world.creatures.push(c);
  world.controllers.push(ctrl);
  world.nearestFood.push(-1);
  world.sensorViews.push(new Float32Array(preySensorCount(world.config)));
}

/** Drop dead creatures from all parallel arrays. Returns the removed creatures. */
export function removeDead(world: World): Creature[] {
  const dead: Creature[] = [];
  let w = 0;
  for (let i = 0; i < world.creatures.length; i++) {
    const c = world.creatures[i];
    if (!c.alive) {
      dead.push(c);
      continue;
    }
    world.creatures[w] = c;
    world.controllers[w] = world.controllers[i];
    world.nearestFood[w] = world.nearestFood[i];
    world.sensorViews[w] = world.sensorViews[i];
    w++;
  }
  world.creatures.length = w;
  world.controllers.length = w;
  world.nearestFood.length = w;
  world.sensorViews.length = w;
  return dead;
}

export function createWorld(
  config: SimConfig,
  makeController: ControllerFactory,
  { enforceNeuralPrey = true }: WorldOptions = {},
): World {
  const rng = new Rng(config.seed);
  const foodGrid = new TorusGrid(config.width, config.height, 100);

  const food: Food[] = [];
  for (let i = 0; i < config.foodCount; i++) {
    const f: Food = {
      id: i,
      x: rng.range(0, config.width),
      y: rng.range(0, config.height),
      energy: config.foodEnergy,
      active: true,
    };
    food.push(f);
    foodGrid.insert(i, f.x, f.y);
  }

  const world: World = {
    config,
    rng,
    tick: 0,
    creatures: [],
    controllers: [],
    food,
    foodGrid,
    nearestFood: [],
    sensorViews: [],
    nextCreatureId: 0,
    enforceNeuralPrey,
  };

  for (let i = 0; i < config.creatureCount; i++) {
    const c = newCreature(world, rng.range(0, config.width), rng.range(0, config.height), rng.range(-Math.PI, Math.PI));
    addCreature(world, c, makeController(c, i, rng, config));
  }
  return world;
}

const action: Action = { turn: 0, thrust: 0 };
/** Below this speed a creature counts as "not moving" for alignment stats. */
const MOVING_SPEED = 0.1;
/** cos(25 deg): heading counts as "toward food" inside this cone. */
const TOWARD_FOOD_COS = Math.cos((25 * Math.PI) / 180);

/** Advance the world by one fixed tick. */
export function step(world: World): void {
  const cfg = world.config;
  const { creatures, controllers, food, foodGrid, sensorViews } = world;

  for (let i = 0; i < creatures.length; i++) {
    const c = creatures[i];
    if (!c.alive) continue;

    // Sense
    const body = c.body;
    const near = foodGrid.nearest(c.x, c.y, body.sensorRange);
    world.nearestFood[i] = near;
    const sensors = sensorViews[i];
    const nf = near >= 0 ? food[near] : null;
    sensePrey(c, near, nf ? nf.x : 0, nf ? nf.y : 0, foodGrid.foundDistSq, cfg, sensors);
    // Stats use the true bearing; the brain gets the (possibly noisy) reading.
    const trueCos = sensors[1];
    if (cfg.sensorNoise > 0) {
      for (let k = 0; k < sensors.length; k++) {
        sensors[k] = clamp(sensors[k] + world.rng.gaussian() * cfg.sensorNoise, -1, 1);
      }
    }

    // Decide (the organism's business, not ours)
    controllers[i].act(sensors, action);

    // Physics
    const turn = clamp(Number.isFinite(action.turn) ? action.turn : 0, -1, 1);
    const thrust = clamp(Number.isFinite(action.thrust) ? action.thrust : 0, 0, 1);
    c.heading = wrapAngle(c.heading + turn * body.effTurn);
    // Inertia: speed moves toward the target by at most body.accel per tick.
    const target = thrust * body.maxSpeed;
    c.speed = body.accel === Infinity ? target : c.speed + clamp(target - c.speed, -body.accel, body.accel);
    c.x = wrapCoord(c.x + Math.cos(c.heading) * c.speed, cfg.width);
    c.y = wrapCoord(c.y + Math.sin(c.heading) * c.speed, cfg.height);

    // Metabolism. Ageing: upkeep grows with age (doubles at age = agingScale).
    const aging = cfg.agingScale > 0 ? 1 + (c.age / cfg.agingScale) ** 2 : 1;
    const cost = body.basal * aging + cfg.moveCost * body.moveFactor * c.speed * c.speed;
    c.energy -= cost;

    // Recorded-only stats (true cos of bearing to food, pre-move)
    c.energySpent += cost;
    c.distanceTraveled += c.speed;
    if (near >= 0 && c.speed > MOVING_SPEED) {
      c.alignmentSum += trueCos;
      c.alignmentTicks++;
      if (trueCos > TOWARD_FOOD_COS) c.ticksTowardFood++;
    }

    // Eating
    const bite = foodGrid.nearest(c.x, c.y, body.eatRadius);
    if (bite >= 0) {
      const f = food[bite];
      c.energy = Math.min(body.maxEnergy, c.energy + f.energy);
      c.foodEaten++;
      f.active = false;
      foodGrid.remove(bite);
    }

    c.age++;
    if (c.energy <= 0) {
      c.energy = 0;
      c.alive = false;
      c.speed = 0;
    }
  }

  // Food regrowth
  for (let i = 0; i < food.length; i++) {
    const f = food[i];
    if (f.active || world.rng.next() >= cfg.respawnRate) continue;
    f.x = world.rng.range(0, cfg.width);
    f.y = world.rng.range(0, cfg.height);
    f.active = true;
    foodGrid.insert(i, f.x, f.y);
  }

  world.tick++;
}

export function aliveCount(world: World): number {
  let n = 0;
  for (const c of world.creatures) if (c.alive) n++;
  return n;
}

export function isEpisodeOver(world: World): boolean {
  return world.tick >= world.config.episodeTicks || aliveCount(world) === 0;
}

/** Cheap FNV-1a hash over the dynamic world state, for determinism tests. */
export function stateHash(world: World): number {
  let h = 0x811c9dc5;
  const buf = new Float64Array(1);
  const bytes = new Uint8Array(buf.buffer);
  const mix = (v: number) => {
    buf[0] = v;
    for (let k = 0; k < 8; k++) {
      h ^= bytes[k];
      h = Math.imul(h, 0x01000193);
    }
  };
  mix(world.tick);
  for (const c of world.creatures) {
    mix(c.x); mix(c.y); mix(c.heading); mix(c.energy); mix(c.foodEaten); mix(c.alive ? 1 : 0);
  }
  for (const f of world.food) {
    mix(f.x); mix(f.y); mix(f.active ? 1 : 0);
  }
  return h >>> 0;
}
