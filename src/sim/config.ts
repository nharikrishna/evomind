/** Every tunable of the world lives here. UI and headless runner edit a copy. */
/** lab = generational (we score and pick parents); natural = creatures reproduce on their own. */
export type SimMode = "lab" | "natural";

export interface SimConfig {
  mode: SimMode;
  seed: number;

  // World
  width: number;
  height: number;

  // Population
  creatureCount: number;

  // Food
  foodCount: number;
  foodEnergy: number;
  /** Per-tick probability that an eaten food item respawns somewhere random. */
  respawnRate: number;

  // Creature body
  maxEnergy: number;
  initialEnergy: number;
  /** Energy lost every tick just for being alive. */
  basalCost: number;
  /** Energy lost per tick = moveCost * speed^2. */
  moveCost: number;
  maxSpeed: number;
  /** Radians per tick at turn = +-1. */
  maxTurnRate: number;
  eatRadius: number;
  sensorRange: number;

  // Brain
  brainHidden: number;

  // Episode
  episodeTicks: number;

  // Evolution
  /** Episodes per generation; fitness is averaged across them to reduce luck. */
  episodesPerGeneration: number;
  /** Top genomes copied unchanged into the next generation. */
  eliteCount: number;
  tournamentSize: number;
  /** Per-weight probability of a gaussian nudge. */
  mutationRate: number;
  mutationSigma: number;
  /** Per-weight probability of being replaced by a fresh random value. */
  resetRate: number;
  /** Probability a child gets uniform crossover of two parents (0 = off). */
  crossoverRate: number;
  /** fitness = foodEaten + survivalBonus * ticksAlive (0 = pure food). */
  survivalBonus: number;
  /**
   * Weight of energy spent in fitness, measured in food-equivalents:
   * fitness -= energyWeight * energySpent / foodEnergy. 0 = food only, 1 = net energy surplus.
   */
  energyWeight: number;

  // Evolvable bodies (Phase 4.5)
  /** Off = every creature has the fixed default body (the Phase 1-4 lab setup). */
  evolveBodies: boolean;
  /** Per-tick basal cost terms; at default traits they sum to basalCost. */
  costSize: number;
  costSensor: number;
  costSpeed: number;
  costTurn: number;
  /** Spread of generation-0 body genes around the default body (gene space). */
  bodyInitSigma: number;
  bodyMutationRate: number;
  bodyMutationSigma: number;

  // Realism (all off in the lab setup so earlier results stay reproducible)
  /**
   * Biological size scaling. Mass = size² (2D bodies). Energy storage grows with mass,
   * and metabolism and movement cost grow with mass^0.75 (Kleiber's law).
   */
  sizeScaling: boolean;
  /** Max speed change per tick for a mass-1 body (heavier bodies accelerate slower). 0 = instant. */
  acceleration: number;
  /** Std-dev of gaussian noise added to every sensor reading each tick. 0 = perfect senses. */
  sensorNoise: number;
  /** Proprioception: brains get their own speed as a 5th input. */
  senseSpeed: boolean;

  // Natural mode (Phase 5)
  /** Upkeep multiplier 1 + (age / agingScale)²: doubles at this age. 0 = no ageing. */
  agingScale: number;
  /** Ticks before a creature can reproduce. */
  maturityAge: number;
  /** Fraction of the energy a parent gives up that actually reaches the child. */
  birthEfficiency: number;
  /** Hard cap for performance; births are skipped while the population is at the cap. */
  maxPopulation: number;
  /** Ticks between recorded stats samples. */
  sampleEvery: number;
  /** Ticks between standardized lab tests of the living population (0 = off). */
  labTestEvery: number;
}

export const DEFAULT_CONFIG: SimConfig = {
  mode: "lab",
  seed: 1,

  width: 800,
  height: 600,

  creatureCount: 100,

  foodCount: 60,
  foodEnergy: 40,
  respawnRate: 0.02,

  maxEnergy: 100,
  initialEnergy: 60,
  basalCost: 0.05,
  moveCost: 0.02,
  maxSpeed: 2,
  maxTurnRate: 0.15,
  eatRadius: 6,
  sensorRange: 200,

  brainHidden: 8,

  episodeTicks: 2000,

  episodesPerGeneration: 1,
  eliteCount: 5,
  tournamentSize: 3,
  mutationRate: 0.1,
  mutationSigma: 0.2,
  resetRate: 0.002,
  crossoverRate: 0,
  survivalBonus: 0,
  energyWeight: 0,

  evolveBodies: false,
  // Sum = basalCost (0.05), so the default body costs exactly what pre-4.5 creatures paid.
  // Tuned headlessly: speed upkeep (cubic) dominates; traits settle inside their ranges.
  costSize: 0.01,
  costSensor: 0.008,
  costSpeed: 0.03,
  costTurn: 0.002,
  bodyInitSigma: 0.5,
  bodyMutationRate: 0.2,
  bodyMutationSigma: 0.15,

  sizeScaling: false,
  acceleration: 0,
  sensorNoise: 0,
  senseSpeed: false,

  agingScale: 0,
  maturityAge: 150,
  birthEfficiency: 0.8,
  maxPopulation: 400,
  sampleEvery: 250,
  labTestEvery: 5000,
};

export function makeConfig(overrides: Partial<SimConfig> = {}): SimConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

/**
 * Body evolution setup: evolvable bodies, and fitness = net energy surplus so
 * that the energy cost of a body actually matters to selection.
 */
export const BODIES_PRESET: Partial<SimConfig> = { evolveBodies: true, energyWeight: 1 };

/** Bodies plus the Phase 4.6 realism tweaks: Kleiber size scaling, inertia, noisy senses. */
export const REALISM_PRESET: Partial<SimConfig> = {
  ...BODIES_PRESET,
  sizeScaling: true,
  acceleration: 0.2,
  sensorNoise: 0.05,
  senseSpeed: true,
};

/**
 * Natural reproduction on top of the realism preset. Tuned headlessly so the
 * population is limited by food (~200-300), not by the cap, and ageing keeps it turning over.
 */
export const NATURAL_PRESET: Partial<SimConfig> = {
  ...REALISM_PRESET,
  mode: "natural",
  agingScale: 3000,
  respawnRate: 0.01,
  // Pure safety net: efficiency keeps evolving, and a 300k-tick run crept up to ~540.
  maxPopulation: 1000,
};
