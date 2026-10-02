/** Every tunable of the world lives here. UI and headless runner edit a copy. */
export interface SimConfig {
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
}

export const DEFAULT_CONFIG: SimConfig = {
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
};

export function makeConfig(overrides: Partial<SimConfig> = {}): SimConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}
