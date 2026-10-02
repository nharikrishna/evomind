import type { SimConfig } from "./config";
import type { Action, Creature, Food } from "./types";
import type { Controller } from "./controllers";
import { Rng } from "./rng";
import { TorusGrid } from "./spatial";
import { PREY_SENSOR_COUNT, sensePrey } from "./sensors";
import { clamp, wrapAngle, wrapCoord } from "./math";
import { defaultBody } from "./body";

export interface World {
  readonly config: SimConfig;
  readonly rng: Rng;
  tick: number;
  creatures: Creature[];
  /** controllers[i] drives creatures[i]. */
  controllers: Controller[];
  food: Food[];
  foodGrid: TorusGrid;
  /** Nearest sensed food per creature (-1 = none), refreshed every tick. */
  nearestFood: Int32Array;
  /** Last sensor vector per creature, flattened (creature i at i*PREY_SENSOR_COUNT). */
  sensors: Float32Array;
  /** sensorViews[i] = creature i's slice of `sensors` (precomputed, no per-tick allocation). */
  sensorViews: Float32Array[];
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

  const creatures: Creature[] = [];
  const controllers: Controller[] = [];
  for (let i = 0; i < config.creatureCount; i++) {
    const c: Creature = {
      id: i,
      speciesId: "prey",
      x: rng.range(0, config.width),
      y: rng.range(0, config.height),
      heading: rng.range(-Math.PI, Math.PI),
      speed: 0,
      energy: config.initialEnergy,
      alive: true,
      foodEaten: 0,
      age: 0,
      genomeId: null,
      body: defaultBody(config),
      distanceTraveled: 0,
      energySpent: 0,
      alignmentSum: 0,
      alignmentTicks: 0,
      ticksTowardFood: 0,
    };
    const ctrl = makeController(c, i, rng, config);
    if (enforceNeuralPrey && c.speciesId === "prey" && ctrl.kind !== "neural") {
      throw new Error(`Prey ${i} has a "${ctrl.kind}" controller; prey must be neural.`);
    }
    creatures.push(c);
    controllers.push(ctrl);
  }

  const sensors = new Float32Array(config.creatureCount * PREY_SENSOR_COUNT);
  return {
    config,
    rng,
    tick: 0,
    creatures,
    controllers,
    food,
    foodGrid,
    nearestFood: new Int32Array(config.creatureCount).fill(-1),
    sensors,
    sensorViews: Array.from({ length: config.creatureCount }, (_, i) =>
      sensors.subarray(i * PREY_SENSOR_COUNT, (i + 1) * PREY_SENSOR_COUNT),
    ),
  };
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

    // Decide (the organism's business, not ours)
    controllers[i].act(sensors, action);

    // Physics
    const turn = clamp(Number.isFinite(action.turn) ? action.turn : 0, -1, 1);
    const thrust = clamp(Number.isFinite(action.thrust) ? action.thrust : 0, 0, 1);
    c.heading = wrapAngle(c.heading + turn * body.effTurn);
    c.speed = thrust * body.maxSpeed;
    c.x = wrapCoord(c.x + Math.cos(c.heading) * c.speed, cfg.width);
    c.y = wrapCoord(c.y + Math.sin(c.heading) * c.speed, cfg.height);

    // Metabolism
    const cost = body.basal + cfg.moveCost * body.moveFactor * c.speed * c.speed;
    c.energy -= cost;

    // Recorded-only stats (sensors[1] = cos of bearing to food, pre-move)
    c.energySpent += cost;
    c.distanceTraveled += c.speed;
    if (near >= 0 && c.speed > MOVING_SPEED) {
      c.alignmentSum += sensors[1];
      c.alignmentTicks++;
      if (sensors[1] > TOWARD_FOOD_COS) c.ticksTowardFood++;
    }

    // Eating
    const bite = foodGrid.nearest(c.x, c.y, body.eatRadius);
    if (bite >= 0) {
      const f = food[bite];
      c.energy = Math.min(cfg.maxEnergy, c.energy + f.energy);
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
