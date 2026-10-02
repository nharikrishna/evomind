import type { SimConfig } from "../sim/config";
import { deriveSeed, Rng } from "../sim/rng";
import { createWorld, isEpisodeOver, step, type ControllerFactory, type World } from "../sim/world";
import { GenomeIds, meanPairwiseDistance, type Genome } from "../brain/genome";
import { neuralFactory } from "../brain/neuralController";
import { randomPopulation } from "../brain/population";
import {
  averageMetrics, episodeMetrics, fitnessSummary,
  type EpisodeMetrics, type GenerationStats,
} from "../analysis/metrics";
import { preyFitness } from "./fitness";
import { rankByFitness, tournament } from "./selection";
import { mutate } from "./mutation";
import { uniformCrossover } from "./crossover";
import { genomeFromJSON, genomeToJSON } from "../analysis/history";

/** Seed of the world for (run seed, generation, episode): new food layout every time. */
export function episodeSeed(runSeed: number, generation: number, episode: number): number {
  return deriveSeed(runSeed, generation, episode, 0x77);
}

/** Run a world to completion. */
export function runToEnd(world: World): World {
  while (!isEpisodeOver(world)) step(world);
  return world;
}

/** Build and fully run one episode for a population. */
export function runEpisode(
  config: SimConfig,
  genomes: readonly Genome[],
  seed: number,
  factory: ControllerFactory = neuralFactory(genomes),
): World {
  return runToEnd(createWorld({ ...config, seed, creatureCount: genomes.length }, factory));
}

/**
 * The evolutionary loop. Owns the population; the UI or headless runner drives it:
 *   const world = evo.createEpisodeWorld(0); ...run it...; evo.completeGeneration([world]);
 * or simply evo.runGeneration().
 */
export interface LineageEntry {
  parentId: number | null;
  generation: number;
}

/** Everything needed to resume a run bit-identically. */
export interface RunFile {
  format: "evomind-run";
  version: 1;
  config: SimConfig;
  generation: number;
  bestEver: number;
  bestEverGenome: object | null;
  population: object[];
  history: GenerationStats[];
  rngState: [number, number | null];
  nextGenomeId: number;
  /** [id, parentId, generation] for every genome ever created. */
  lineage: [number, number | null, number][];
}

export class Evolution {
  ids = new GenomeIds();
  population: Genome[];
  generation = 0;
  bestEver = -Infinity;
  bestEverGenome: Genome | null = null;
  readonly history: GenerationStats[] = [];
  /** Parent/generation of every genome ever created in this run (for ancestry). */
  readonly lineage = new Map<number, LineageEntry>();
  private rng: Rng;

  constructor(readonly config: SimConfig) {
    this.population = randomPopulation(config, this.ids);
    for (const g of this.population) this.lineage.set(g.id, { parentId: null, generation: 0 });
    this.rng = new Rng(deriveSeed(config.seed, 0xe70));
  }

  /** The generation-0 random brains of this run (regenerated deterministically). */
  initialPopulation(): Genome[] {
    return randomPopulation(this.config);
  }

  /** Ancestor ids of a genome, nearest first, up to `max` steps. */
  ancestry(id: number, max = 50): number[] {
    const out: number[] = [];
    let cur = this.lineage.get(id)?.parentId ?? null;
    while (cur !== null && out.length < max) {
      out.push(cur);
      cur = this.lineage.get(cur)?.parentId ?? null;
    }
    return out;
  }

  /** The ancestor `depth` generations of descent above `id` (or the oldest known). */
  ancestorAt(id: number, depth: number): number {
    let cur = id;
    for (let d = 0; d < depth; d++) {
      const p = this.lineage.get(cur)?.parentId ?? null;
      if (p === null) break;
      cur = p;
    }
    return cur;
  }

  toJSON(): RunFile {
    return {
      format: "evomind-run",
      version: 1,
      config: this.config,
      generation: this.generation,
      bestEver: this.bestEver,
      bestEverGenome: this.bestEverGenome && genomeToJSON(this.bestEverGenome),
      population: this.population.map(genomeToJSON),
      history: this.history,
      rngState: this.rng.getState(),
      nextGenomeId: this.ids.peek(),
      lineage: [...this.lineage].map(([id, e]) => [id, e.parentId, e.generation]),
    };
  }

  static fromJSON(run: RunFile): Evolution {
    if (run.format !== "evomind-run") throw new Error("Not an EvoMind run file");
    const evo = new Evolution(run.config);
    evo.generation = run.generation;
    evo.bestEver = run.bestEver ?? -Infinity;
    evo.bestEverGenome = run.bestEverGenome ? genomeFromJSON(run.bestEverGenome) : null;
    evo.population = run.population.map(genomeFromJSON);
    evo.history.push(...run.history);
    evo.rng.setState(run.rngState);
    evo.ids = new GenomeIds(run.nextGenomeId);
    evo.lineage.clear();
    for (const [id, parentId, generation] of run.lineage) evo.lineage.set(id, { parentId, generation });
    return evo;
  }

  createEpisodeWorld(episode: number): World {
    const seed = episodeSeed(this.config.seed, this.generation, episode);
    return createWorld(
      { ...this.config, seed, creatureCount: this.population.length },
      neuralFactory(this.population),
    );
  }

  /** Runs all episodes of the current generation headlessly and breeds the next. */
  runGeneration(): GenerationStats {
    const worlds: World[] = [];
    for (let e = 0; e < this.config.episodesPerGeneration; e++) {
      worlds.push(runToEnd(this.createEpisodeWorld(e)));
    }
    return this.completeGeneration(worlds);
  }

  /**
   * Score the finished episode worlds (creature i = population[i]), record stats,
   * and replace the population with the next generation.
   */
  completeGeneration(worlds: readonly World[]): GenerationStats {
    const n = this.population.length;
    const fitness = new Array<number>(n).fill(0);
    for (const w of worlds) {
      for (let i = 0; i < n; i++) fitness[i] += preyFitness(w.creatures[i], this.config) / worlds.length;
    }

    const ranked = rankByFitness(fitness);
    const summary = fitnessSummary(fitness);
    if (summary.best > this.bestEver) {
      this.bestEver = summary.best;
      this.bestEverGenome = this.population[ranked[0]];
    }
    const metrics: EpisodeMetrics = averageMetrics(worlds.map((w) => episodeMetrics(w.creatures)));
    const stats: GenerationStats = {
      generation: this.generation,
      ...summary,
      bestEver: this.bestEver,
      diversity: meanPairwiseDistance(this.population),
      ...metrics,
    };
    this.history.push(stats);

    this.population = this.breed(fitness, ranked);
    this.generation++;
    return stats;
  }

  private breed(fitness: number[], ranked: number[]): Genome[] {
    const cfg = this.config;
    const n = this.population.length;
    const next: Genome[] = [];

    // Elites survive unchanged (same genome, same id).
    for (let k = 0; k < Math.min(cfg.eliteCount, n); k++) next.push(this.population[ranked[k]]);

    const params = { rate: cfg.mutationRate, sigma: cfg.mutationSigma, resetRate: cfg.resetRate };
    while (next.length < n) {
      const parent = this.population[tournament(fitness, cfg.tournamentSize, this.rng)];
      let weights: Float32Array;
      if (cfg.crossoverRate > 0 && this.rng.next() < cfg.crossoverRate) {
        const other = this.population[tournament(fitness, cfg.tournamentSize, this.rng)];
        weights = uniformCrossover(parent.genes.brain, other.genes.brain, this.rng);
      } else {
        weights = new Float32Array(parent.genes.brain);
      }
      mutate(weights, params, this.rng);
      const child: Genome = {
        id: this.ids.take(),
        parentId: parent.id,
        generation: this.generation + 1,
        shape: parent.shape,
        genes: { brain: weights },
      };
      this.lineage.set(child.id, { parentId: parent.id, generation: child.generation });
      next.push(child);
    }
    return next;
  }
}
