import type { SimConfig } from "./config";
import type { Action, Creature, Food } from "./types";
import type { Controller } from "./controllers";
import { Rng } from "./rng";
import { TorusGrid } from "./spatial";
import { preySensorCount, sensePrey, type ExtraSenses } from "./sensors";
import { clamp, wrapAngle, wrapCoord } from "./math";
import { defaultBody, type Body } from "./body";
import { FertilityMap, sproutPosition } from "./food";
import { Vegetation } from "./vegetation";
import { seasonFactor } from "./seasons";
import { BiomeMap, BIOMES, GRASSLAND, MOUNTAIN, RIVER } from "./biomes";

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
  /** Plant food model only: where plants grow well. */
  fertility: FertilityMap | null;
  /** Runtime food-supply multiplier (environment shifts, changed mid-run). 1 = normal. */
  foodBoost: number;
  /** Biome regions (null = uniform world). */
  biomeMap: BiomeMap | null;
  /** Crowding only: creature positions, rebuilt every tick for neighbour counts. */
  creatureGrid: TorusGrid | null;
  /** Vegetation food model: living ground cover (null for item-based food). */
  vegetation: Vegetation | null;
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
    biome: -1,
    region: -1,
    thermalSpent: 0,
    crowding: 0,
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

  const veg = config.foodModel === "vegetation";
  const fertility = config.foodModel === "plants" || veg ? new FertilityMap(config.width, config.height, config) : null;
  const biomeMap = config.biomes ? new BiomeMap(config.width, config.height, config) : null;
  const vegetation = veg ? new Vegetation(config.width, config.height, config, fertility, biomeMap) : null;
  const food: Food[] = [];
  const placed: number[] = [];
  for (let i = 0; i < (veg ? 0 : config.foodCount); i++) {
    // Plants seed the initial meadow from each other, so it starts out patchy.
    const pos = fertility ? sproutPosition(config, fertility, placed, rng, biomeMap) : { x: rng.range(0, config.width), y: rng.range(0, config.height) };
    const growth = fertility ? localGrowth(fertility, biomeMap, pos.x, pos.y) : 1;
    const f: Food = { id: i, x: pos.x, y: pos.y, energy: config.foodEnergy, active: true, growth };
    if (fertility) placed.push(f.x, f.y);
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
    fertility,
    foodBoost: 1,
    biomeMap,
    creatureGrid: config.crowding || config.senseCrowd ? new TorusGrid(config.width, config.height, 50) : null,
    vegetation,
    enforceNeuralPrey,
  };

  for (let i = 0; i < config.creatureCount; i++) {
    const c = newCreature(world, rng.range(0, config.width), rng.range(0, config.height), rng.range(-Math.PI, Math.PI));
    addCreature(world, c, makeController(c, i, rng, config));
  }
  return world;
}

/** How well plants grow at a spot: fertility × biome growth. */
function localGrowth(fertility: FertilityMap, biomes: BiomeMap | null, x: number, y: number): number {
  return fertility.at(x, y) * (biomes ? BIOMES[biomes.at(x, y)].growth : 1);
}

/** Biome temperature right now: its base plus the seasonal swing (summer warmer, winter colder). */
export function ambientTemp(cfg: SimConfig, tick: number, base: number): number {
  return cfg.seasonLength > 0 ? base + cfg.seasonTempSwing * Math.sin((2 * Math.PI * tick) / cfg.seasonLength) : base;
}

/**
 * Energy spent keeping body temperature comfortable this tick.
 * - Cold: heat leaks out through the surface (∝ size, while the energy store ∝ size², so
 *   small bodies suffer more per unit of reserve); insulation blocks most of the leak.
 * - Heat: metabolic heat (∝ mass^0.75 = size^1.5) can't be shed; insulation traps it and
 *   movement makes more. Big, furry, fast bodies overheat.
 */
export function thermalCost(cfg: SimConfig, tick: number, biomeTemp: number, body: Body, speed: number): number {
  const t = ambientTemp(cfg, tick, biomeTemp);
  // Only the part outside the thermoneutral zone costs anything.
  const cold = Math.max(0, -t - cfg.thermalComfort);
  const hot = Math.max(0, t - cfg.thermalComfort);
  if (cold > 0) return cfg.thermalCost * body.size * cold * (1 - 0.85 * body.insulation);
  if (hot > 0) {
    const activity = 1 + (speed / cfg.maxSpeed) ** 2;
    return cfg.thermalCost * body.size ** 1.5 * hot * (1 + 2 * body.insulation) * activity;
  }
  return 0;
}

const action: Action = { turn: 0, thrust: 0 };
const NO_NEIGHBOURS = { n: 0, dx: 0, dy: 0 };
/** Below this speed a creature counts as "not moving" for alignment stats. */
const MOVING_SPEED = 0.1;
/** cos(25 deg): heading counts as "toward food" inside this cone. */
const TOWARD_FOOD_COS = Math.cos((25 * Math.PI) / 180);

/** Advance the world by one fixed tick. */
export function step(world: World): void {
  const cfg = world.config;
  const { creatures, controllers, food, foodGrid, sensorViews } = world;

  // Crowding: index where everyone is this tick, for neighbour counts.
  const crowd = world.creatureGrid;
  if (crowd) {
    crowd.clear();
    for (let i = 0; i < creatures.length; i++) if (creatures[i].alive) crowd.insert(i, creatures[i].x, creatures[i].y);
  }

  for (let i = 0; i < creatures.length; i++) {
    const c = creatures[i];
    if (!c.alive) continue;

    // Sense
    const body = c.body;
    const biomeIdx = world.biomeMap ? world.biomeMap.at(c.x, c.y) : -1;
    const biome = biomeIdx >= 0 ? BIOMES[biomeIdx] : null;
    c.biome = biomeIdx;
    c.region = world.biomeMap ? world.biomeMap.regionAt(c.x, c.y) : -1;
    const terrain = world.biomeMap && cfg.barriers ? world.biomeMap.barrierAt(c.x, c.y) : 0;
    const range = biome?.fog ? body.sensorRange * cfg.fogFactor : body.sensorRange;
    const veg = world.vegetation;
    // Vegetation: "nearest food" becomes the richest vegetation within range (a sight/smell gradient).
    const rich = veg ? veg.richest(c.x, c.y, range) : null;
    const near = veg ? (rich ? 0 : -1) : foodGrid.nearest(c.x, c.y, range);
    world.nearestFood[i] = veg ? -1 : near;
    const sensors = sensorViews[i];
    const nf = veg ? (rich ? { x: wrapCoord(c.x + rich.dx, cfg.width), y: wrapCoord(c.y + rich.dy, cfg.height), energy: rich.amount } : null) : near >= 0 ? food[near] : null;
    const nearDistSq = veg ? (rich ? rich.dx * rich.dx + rich.dy * rich.dy : Infinity) : foodGrid.foundDistSq;
    // Neighbours (positions at the start of the tick): crowding stress, breeding, crowd sense.
    const nb = crowd ? crowd.neighbours(c.x, c.y, cfg.crowdRadius, i) : NO_NEIGHBOURS;
    c.crowding = nb.n;
    let extra: ExtraSenses | null = null;
    if (cfg.senseFoodAmount || cfg.senseCrowd || veg) {
      let richest: ExtraSenses["rich"] = null;
      if (cfg.senseFoodAmount && veg) {
        if (nf) richest = { x: nf.x, y: nf.y, amount: nf.energy / cfg.vegCapacity };
      } else if (cfg.senseFoodAmount) {
        const ri = foodGrid.bestWithin(c.x, c.y, range, (k) => food[k].energy);
        if (ri >= 0) richest = { x: food[ri].x, y: food[ri].y, amount: food[ri].energy / cfg.foodEnergy };
      }
      const here = veg ? Math.min(1, veg.at(c.x, c.y) / cfg.vegCapacity) : undefined;
      extra = {
        nearAmount: veg ? (here ?? 0) : nf ? nf.energy / cfg.foodEnergy : 0,
        rich: richest,
        crowd: nb,
        here,
      };
    }
    sensePrey(c, near, nf ? nf.x : 0, nf ? nf.y : 0, nearDistSq, cfg, sensors, range, biomeIdx >= 0 ? biomeIdx : GRASSLAND, extra);
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
    const nx = wrapCoord(c.x + Math.cos(c.heading) * c.speed, cfg.width);
    const ny = wrapCoord(c.y + Math.sin(c.heading) * c.speed, cfg.height);
    // Rivers: stepping in usually fails (turn back); once in, you can wade across.
    const intoRiver = terrain !== RIVER && world.biomeMap !== null && cfg.barriers && world.biomeMap.barrierAt(nx, ny) === RIVER;
    // Old-style biome walls (no geography): a failed crossing stops and turns the creature.
    const wall = world.biomeMap && !cfg.barriers && cfg.biomeCrossing < 1 && world.biomeMap.at(nx, ny) !== biomeIdx;
    if ((intoRiver && world.rng.next() >= cfg.riverCrossing) || (wall && world.rng.next() >= cfg.biomeCrossing)) {
      c.heading = wrapAngle(c.heading + Math.PI);
      c.speed = 0;
    } else {
      c.x = nx;
      c.y = ny;
    }

    // Metabolism. Ageing: upkeep grows with age (doubles at age = agingScale).
    const aging = cfg.agingScale > 0 ? 1 + (c.age / cfg.agingScale) ** 2 : 1;
    const mud = (biome?.mud ? cfg.mudFactor : 1) * (terrain === MOUNTAIN ? cfg.mountainCost : 1);
    const thermal = biome && cfg.temperature ? thermalCost(cfg, world.tick, biome.temp, body, c.speed) : 0;
    // Crowding stress: each neighbour beyond the tolerance costs a little extra upkeep.
    const stress = cfg.crowding ? cfg.crowdStress * Math.max(0, c.crowding - cfg.crowdTolerance) : 0;
    const cost = body.basal * aging + thermal + stress + cfg.moveCost * body.moveFactor * c.speed * c.speed * mud;
    c.thermalSpent += thermal;
    c.energy -= cost;

    // Recorded-only stats (true cos of bearing to food, pre-move)
    c.energySpent += cost;
    c.distanceTraveled += c.speed;
    if (near >= 0 && c.speed > MOVING_SPEED) {
      c.alignmentSum += trueCos;
      c.alignmentTicks++;
      if (trueCos > TOWARD_FOOD_COS) c.ticksTowardFood++;
    }

    // Eating. With satiety you can only take in what you have room for.
    const room = cfg.satiety ? Math.max(0, body.maxEnergy - c.energy) : Infinity;
    if (veg) {
      // Graze the cell you stand on; you can't graze well at a gallop.
      const want = Math.min(room, cfg.vegBite * (1 - 0.8 * Math.min(1, c.speed / body.maxSpeed)));
      const take = want > 0 ? veg.graze(c.x, c.y, want) : 0;
      c.energy += take;
      c.foodEaten += take / cfg.foodEnergy;
    }
    let bite = veg || room <= 0 ? -1 : foodGrid.nearest(c.x, c.y, body.eatRadius);
    // Whole food items are indivisible: with satiety, only eat one if there's room for at least half of it.
    if (bite >= 0 && cfg.satiety && !cfg.plantBiomass && room < food[bite].energy / 2) bite = -1;
    if (bite >= 0) {
      const f = food[bite];
      if (cfg.plantBiomass) {
        // Graze: one bite per tick; the plant shrinks and dies only if eaten to nothing.
        const take = Math.min(f.energy, cfg.biteSize, room);
        c.energy = Math.min(body.maxEnergy, c.energy + take);
        c.foodEaten += take / cfg.foodEnergy;
        f.energy -= take;
        if (f.energy < 0.5) {
          f.active = false;
          foodGrid.remove(bite);
        }
      } else {
        c.energy = Math.min(body.maxEnergy, c.energy + f.energy);
        c.foodEaten++;
        f.active = false;
        foodGrid.remove(bite);
      }
    }

    c.age++;
    if (c.energy <= 0) {
      c.energy = 0;
      c.alive = false;
      c.speed = 0;
    }
  }

  // Standing plants regrow logistically from what's left (slow when tiny, fastest at half size).
  const season = seasonFactor(cfg, world.tick);
  // Ground cover: growth follows the season; winter also lowers capacity (die-back).
  world.vegetation?.grow(cfg, season * world.foodBoost, Math.min(1, season));
  if (cfg.plantBiomass) {
    const k = cfg.foodEnergy, r = cfg.plantGrowth * season * world.foodBoost;
    for (const f of food) if (f.active) f.energy = Math.min(k, f.energy + r * f.growth * f.energy * (1 - f.energy / k));
  }

  // New sprouts in empty slots (scaled by season and any environment shift)
  const regrow = Math.min(1, cfg.respawnRate * season * world.foodBoost);
  let parents: number[] | null = null;
  for (let i = 0; i < food.length; i++) {
    const f = food[i];
    if (f.active || world.rng.next() >= regrow) continue;
    if (world.fertility) {
      // Seed dispersal from the plants standing right now (built lazily, once per tick).
      if (!parents) {
        parents = [];
        for (const p of food) if (p.active) parents.push(p.x, p.y);
      }
      const pos = sproutPosition(cfg, world.fertility, parents, world.rng, world.biomeMap);
      f.x = pos.x;
      f.y = pos.y;
      f.growth = localGrowth(world.fertility, world.biomeMap, f.x, f.y);
    } else {
      f.x = world.rng.range(0, cfg.width);
      f.y = world.rng.range(0, cfg.height);
    }
    f.energy = cfg.plantBiomass ? cfg.foodEnergy * cfg.seedling : cfg.foodEnergy;
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
