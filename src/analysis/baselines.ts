import type { SimConfig } from "../sim/config";
import type { Controller } from "../sim/controllers";
import type { Action } from "../sim/types";
import { deriveSeed } from "../sim/rng";
import { PREY_SENSORS } from "../sim/sensors";
import type { Genome } from "../brain/genome";
import { attachGenome, NeuralController } from "../brain/neuralController";
import { randomPopulation } from "../brain/population";
import { createWorld, isEpisodeOver, step, type World } from "../sim/world";
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
 * An evaluation that can run in slices (`advance`) so a long test never blocks
 * the simulation, or all at once (`runToEnd`). Runs `episodes` unseen worlds
 * (seeds disjoint from any training seed), optionally with some senses blinded.
 */
export class EvaluationJob {
  private zeroed: number[];
  private episode = 0;
  private world: World | null = null;
  private fit = 0;
  private food = 0;
  private align = 0;
  result: EvalResult | null = null;

  constructor(
    private config: SimConfig,
    private genomes: readonly Genome[],
    private episodes: number,
    blind: readonly SensorName[] = [],
  ) {
    this.zeroed = blind.map((s) => PREY_SENSORS.indexOf(s));
  }

  get done(): boolean {
    return this.result !== null;
  }

  /** Simulate up to `ticks` test-world ticks. Returns true once finished. */
  advance(ticks: number): boolean {
    const { genomes, config } = this;
    for (let t = 0; t < ticks && !this.result; t++) {
      if (!this.world) {
        const seed = deriveSeed(config.seed, 0x7e57, this.episode);
        this.world = createWorld({ ...config, seed, creatureCount: genomes.length }, (creature, i, _rng, cfg) => {
          attachGenome(creature, genomes[i], cfg);
          const nc = new NeuralController(genomes[i]);
          return this.zeroed.length ? new AblatedController(nc, this.zeroed) : nc;
        });
      }
      if (!isEpisodeOver(this.world)) {
        step(this.world);
        continue;
      }
      const cs = this.world.creatures;
      this.fit += cs.reduce((s, c) => s + preyFitness(c, config), 0) / genomes.length;
      this.food += cs.reduce((s, c) => s + c.foodEaten, 0) / genomes.length;
      this.align += episodeMetrics(cs).alignment;
      this.world = null;
      if (++this.episode >= this.episodes) {
        const n = this.episodes;
        this.result = { meanFitness: this.fit / n, meanFood: this.food / n, alignment: this.align / n };
      }
    }
    return this.done;
  }

  runToEnd(): EvalResult {
    while (!this.advance(10_000));
    return this.result!;
  }
}

/** Evaluate a population all at once (see EvaluationJob). */
export function evaluate(
  config: SimConfig,
  genomes: readonly Genome[],
  episodes: number,
  blind: readonly SensorName[] = [],
): EvalResult {
  return new EvaluationJob(config, genomes, episodes, blind).runToEnd();
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
