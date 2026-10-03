import type { SimConfig } from "../sim/config";
import { Rng } from "../sim/rng";
import { preySensorCount } from "../sim/sensors";
import { GenomeIds, randomGenome, type BrainShape, type Genome } from "./genome";
import { randomBodyGenes } from "../sim/body";
import { randomReproGenes } from "../sim/lifeHistory";

/** Prey brain: one input per sensor, two outputs (turn, thrust). */
export function preyBrainShape(config: SimConfig): BrainShape {
  return { inputs: preySensorCount(config), hidden: config.brainHidden, outputs: 2 };
}

/**
 * Generation-0 population of random brains. Uses its own RNG stream (derived
 * from the seed) so genome creation never shifts the world's food/spawn layout.
 */
export function randomPopulation(config: SimConfig, ids = new GenomeIds()): Genome[] {
  const rng = new Rng((config.seed ^ 0x9e3779b9) >>> 0);
  const shape = preyBrainShape(config);
  return Array.from({ length: config.creatureCount }, () => {
    const g = randomGenome(shape, rng, ids);
    // Only draw body genes when bodies evolve, so lab-mode runs stay identical to Phase 3.
    if (config.evolveBodies) g.genes.body = randomBodyGenes(config, rng);
    if (config.mode === "natural") g.genes.repro = randomReproGenes(config, rng);
    return g;
  });
}
