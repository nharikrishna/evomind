/** Every tunable of the world lives here. UI and headless runner edit a copy. */
/** lab = generational (we score and pick parents); natural = creatures reproduce on their own. */
export type SimMode = "lab" | "natural";

/** random = food reappears anywhere; plants = sprouts near other plants, on fertile ground. */
export type FoodModel = "random" | "plants";

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
  /** Per-tick probability that an eaten food item regrows. */
  respawnRate: number;
  foodModel: FoodModel;
  /** Plants: size (px) of fertility patches. */
  fertilityScale: number;
  /** Plants: how extreme fertility is (higher = starker rich vs barren ground). */
  fertilityContrast: number;
  /** Plants: fertility floor, so no ground is completely dead. */
  minFertility: number;
  /** Plants: chance a new plant sprouts near an existing one (else anywhere: long-distance seed). */
  seedLocalProb: number;
  /** Plants: typical seed dispersal distance (px). */
  seedSpread: number;
  /** Ticks per year (0 = no seasons). */
  seasonLength: number;
  /** Regrowth swings between 1 ± this over the year (0.8 = summer 1.8×, winter 0.2×). */
  seasonAmplitude: number;

  // Biomes (Phase 6c)
  biomes: boolean;
  /** Number of Voronoi regions (each one of the 4 biomes). */
  biomeRegions: number;
  /** Brains get 4 inputs saying which biome they're in. */
  biomeSense: boolean;
  /**
   * Temperature and heat budget (Phase 6c step 2). Needs biomes. Cold costs heat lost
   * through the body surface; heat costs shedding metabolic and movement heat.
   */
  temperature: boolean;
  /** Energy per tick per unit of temperature mismatch for a size-1, uninsulated body at rest. */
  thermalCost: number;
  /** Upkeep per tick of full insulation (fur/fat). */
  costInsulation: number;
  /** How much warmer summer is and colder winter is (added to biome temperature). */
  seasonTempSwing: number;
  /**
   * Thermoneutral zone half-width: within ±this of the ideal temperature a body spends
   * nothing extra on staying warm or cool (as real animals do); costs start outside it.
   */
  thermalComfort: number;
  /** Swamp: movement cost multiplier. */
  mudFactor: number;
  /** Forest: sensor range multiplier. */
  fogFactor: number;
  /**
   * Chance per attempt that a creature can cross into a different biome
   * (1 = free movement, 0 = impassable walls). Models barriers like rivers or ridges.
   */
  biomeCrossing: number;

  // Geography (Phase 6c step 1)
  /** Borders between regions become rivers or mountain ridges. */
  barriers: boolean;
  /** Fraction of borders that are rivers (the rest are mountains). */
  riverShare: number;
  /** Chance an attempt to step into a river succeeds (otherwise the creature turns back). */
  riverCrossing: number;
  /** Movement cost multiplier while on a mountain ridge. */
  mountainCost: number;
  /** Chance per tick of a storm carrying a small group to another region (rafting founders). */
  founderRate: number;
  /** Size of a storm-carried founder group. */
  founderGroup: number;
  /** Species threshold: RMS per-gene distance from a species' representative. */
  speciesThreshold: number;

  // Population brakes (Phase 6c, before temperature tuning)
  /** Density dependence: crowded creatures get stressed and breed less. */
  crowding: boolean;
  /** Neighbour-counting radius (px). */
  crowdRadius: number;
  /** Neighbours tolerated without stress; breeding is half as likely at this many. */
  crowdTolerance: number;
  /** Extra upkeep per tick per neighbour beyond the tolerance. */
  crowdStress: number;
  /** Plants hold biomass: grazed down bite by bite, regrow logistically from what's left. */
  plantBiomass: boolean;
  /** Logistic regrowth rate per tick (scaled by fertility, biome, season, food boost). */
  plantGrowth: number;
  /** Energy taken per tick of grazing. */
  biteSize: number;
  /** A new sprout starts at this fraction of full size. */
  seedling: number;

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
  foodModel: "random",
  fertilityScale: 160,
  fertilityContrast: 2.5,
  minFertility: 0.05,
  seedLocalProb: 0.95,
  seedSpread: 30,
  seasonLength: 0,
  seasonAmplitude: 0.8,

  biomes: false,
  biomeRegions: 8,
  biomeSense: false,
  temperature: false,
  // Rule of thumb, fixed (not tuned to outcomes): at the extreme (|temp| = 1) a size-1,
  // uninsulated body at rest pays as much again as its normal living cost (basalCost 0.05).
  thermalCost: 0.05,
  costInsulation: 0.01,
  seasonTempSwing: 0.3,
  thermalComfort: 0.3,
  mudFactor: 2.5,
  fogFactor: 0.5,
  biomeCrossing: 1,

  barriers: false,
  riverShare: 0.5,
  riverCrossing: 0.03,
  mountainCost: 8,
  founderRate: 0.00015,
  founderGroup: 6,
  speciesThreshold: 0.4,

  // Set from reasoning, not tuned to outcomes: crowding counted within ~3 body lengths;
  // each neighbour past the tolerance costs 4% of normal living cost (basalCost 0.05).
  crowding: false,
  crowdRadius: 40,
  crowdTolerance: 6,
  crowdStress: 0.002,
  // A full plant (foodEnergy 40) takes 4 bites. r is chosen so peak sustained yield matches the
  // random-respawn model (≈ foodEnergy × respawnRate = 0.4/tick per plant): r·K·g/4 ≈ 0.4 with
  // average local growth g ≈ 0.8. (r = 0.01 starved the world: ~5-8x less food.)
  plantBiomass: false,
  plantGrowth: 0.05,
  biteSize: 10,
  seedling: 0.25,

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
  foodModel: "plants",
  // Tuned: visible boom/bust with no extinctions on 3 seeds (±0.8 or 20k-tick years wiped populations out).
  seasonLength: 5000,
  seasonAmplitude: 0.6,
  agingScale: 3000,
  respawnRate: 0.01,
  // Pure safety net: efficiency keeps evolving, and a 300k-tick run crept up to ~540.
  maxPopulation: 1000,
};

/**
 * Natural mode in a bigger world (4x the area, same food density) with biome
 * regions separated by rivers and mountain ridges, plus occasional
 * storm-carried founders. Tuned on 3 seeds: genetic separation between regions
 * 0.09 without barriers -> 0.24 with these barriers; populations ~370-460.
 * (2.5x food was too sparse: populations of 13-330 with extinctions.)
 */
export const GEOGRAPHY_PRESET: Partial<SimConfig> = {
  ...NATURAL_PRESET,
  width: 1600,
  height: 1200,
  foodCount: 240,
  creatureCount: 300,
  maxPopulation: 2000,
  biomes: true,
  biomeRegions: 5,
  biomeSense: true,
  temperature: true,
  mudFactor: 1.8,
  barriers: true,
  riverCrossing: 0.005,
  mountainCost: 20,
  // Population brake: without it, boom-and-bust crashes caused 9-10 extinctions per 100k ticks.
  crowding: true,
};
