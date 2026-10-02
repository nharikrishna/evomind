import type { SimConfig } from "../sim/config";
import { Rng } from "../sim/rng";
import { PREY_SENSOR_COUNT } from "../sim/sensors";
import { GenomeIds, randomGenome, type BrainShape, type Genome } from "./genome";

/** Prey brain: one input per sensor, two outputs (turn, thrust). */
export function preyBrainShape(config: SimConfig): BrainShape {
  return { inputs: PREY_SENSOR_COUNT, hidden: config.brainHidden, outputs: 2 };
}

/**
 * Generation-0 population of random brains. Uses its own RNG stream (derived
 * from the seed) so genome creation never shifts the world's food/spawn layout.
 */
export function randomPopulation(config: SimConfig, ids = new GenomeIds()): Genome[] {
  const rng = new Rng((config.seed ^ 0x9e3779b9) >>> 0);
  const shape = preyBrainShape(config);
  return Array.from({ length: config.creatureCount }, () => randomGenome(shape, rng, ids));
}
