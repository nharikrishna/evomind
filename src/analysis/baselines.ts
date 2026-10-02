import type { SimConfig } from "../sim/config";
import type { Controller } from "../sim/controllers";
import type { Action } from "../sim/types";
import { deriveSeed } from "../sim/rng";
import { PREY_SENSORS } from "../sim/sensors";
import type { Genome } from "../brain/genome";
import { attachGenome, NeuralController } from "../brain/neuralController";
import { randomPopulation } from "../brain/population";
import { runEpisode } from "../evo/generation";
import { preyFitness } from "../evo/fitness";
import { episodeMetrics } from "./metrics";

type SensorName = (typeof PREY_SENSORS)[number];

/**
 * Wraps a brain and zeroes chosen senses before it sees them (a "blindfold").
 * Works on a private copy so the world's recorded sensor values stay intact.
 */
export class AblatedController implements Controller {
  readonly kind = "neural";
  private buf: Float32Array;

  constructor(private inner: NeuralController, private zeroed: readonly number[]) {
    this.buf = new Float32Array(inner.brain.shape.inputs);
  }

  act(sensors: Float32Array, out: Action): void {
    this.buf.set(sensors);
    for (const i of this.zeroed) this.buf[i] = 0;
    this.inner.act(this.buf, out);
  }
}

export interface EvalResult {
  meanFitness: number;
  /** Mean food eaten per creature (independent of the fitness formula). */
  meanFood: number;
  alignment: number;
}

/**
 * Mean fitness of a population over several unseen worlds, optionally with some
 * senses blinded. Seeds are disjoint from any training seed.
 */
export function evaluate(
  config: SimConfig,
  genomes: readonly Genome[],
  episodes: number,
  blind: readonly SensorName[] = [],
): EvalResult {
  const zeroed = blind.map((s) => PREY_SENSORS.indexOf(s));
  let fit = 0, food = 0, align = 0;
  for (let e = 0; e < episodes; e++) {
    const seed = deriveSeed(config.seed, 0x7e57, e);
    const world = runEpisode(config, genomes, seed, (creature, i, _rng, cfg) => {
      attachGenome(creature, genomes[i], cfg);
      const nc = new NeuralController(genomes[i]);
      return zeroed.length ? new AblatedController(nc, zeroed) : nc;
    });
    fit += world.creatures.reduce((s, c) => s + preyFitness(c, config), 0) / genomes.length;
    food += world.creatures.reduce((s, c) => s + c.foodEaten, 0) / genomes.length;
    align += episodeMetrics(world.creatures).alignment;
  }
  return { meanFitness: fit / episodes, meanFood: food / episodes, alignment: align / episodes };
}

export interface ProofReport {
  randomBaseline: EvalResult;
  evolved: EvalResult;
  /** Evolved brains with food direction (sin/cos) zeroed. */
  directionBlind: EvalResult;
  /** Evolved brains with all food senses zeroed. */
  fullyBlind: EvalResult;
}

/** The Phase 3 evidence: does the evolved population really use its senses? */
export function proofReport(config: SimConfig, evolved: readonly Genome[], episodes = 5): ProofReport {
  const randoms = randomPopulation({ ...config, seed: deriveSeed(config.seed, 0xba5e) });
  return {
    randomBaseline: evaluate(config, randoms, episodes),
    evolved: evaluate(config, evolved, episodes),
    directionBlind: evaluate(config, evolved, episodes, ["foodSin", "foodCos"]),
    fullyBlind: evaluate(config, evolved, episodes, ["foodSin", "foodCos", "foodNear"]),
  };
}
