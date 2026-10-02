import type { Rng } from "../sim/rng";

/** Layer sizes of a fully-connected feed-forward brain with one hidden layer. */
export interface BrainShape {
  inputs: number;
  hidden: number;
  outputs: number;
}

/** Number of weights + biases needed for a brain of this shape. */
export function brainWeightCount(s: BrainShape): number {
  return s.hidden * s.inputs + s.hidden + s.outputs * s.hidden + s.outputs;
}

/**
 * Heritable material of one organism. Genes are stored in named segments so new
 * kinds of genes (e.g. `body` in Phase 4.5) can be appended without touching
 * the brain code.
 */
export interface Genome {
  id: number;
  /** Genome this one was copied/mutated from; null for generation-0 randoms. */
  parentId: number | null;
  generation: number;
  shape: BrainShape;
  genes: {
    brain: Float32Array;
  };
}

/** Hands out unique genome ids within a run. */
export class GenomeIds {
  constructor(private next = 0) {}
  take(): number {
    return this.next++;
  }
  peek(): number {
    return this.next;
  }
}

/** Mean pairwise Euclidean distance between brain weight vectors (population diversity). */
export function meanPairwiseDistance(genomes: readonly Genome[]): number {
  const n = genomes.length;
  if (n < 2) return 0;
  let total = 0;
  for (let a = 0; a < n; a++) {
    const wa = genomes[a].genes.brain;
    for (let b = a + 1; b < n; b++) {
      const wb = genomes[b].genes.brain;
      let s = 0;
      for (let k = 0; k < wa.length; k++) {
        const d = wa[k] - wb[k];
        s += d * d;
      }
      total += Math.sqrt(s);
    }
  }
  return total / ((n * (n - 1)) / 2);
}

/**
 * Random generation-0 genome. Weights ~ N(0, 1/sqrt(fan_in)) so activations
 * start in tanh's responsive range and behavior is varied rather than saturated.
 */
export function randomGenome(shape: BrainShape, rng: Rng, ids: GenomeIds): Genome {
  const w = new Float32Array(brainWeightCount(shape));
  let k = 0;
  const s1 = 1 / Math.sqrt(shape.inputs);
  for (let i = 0; i < shape.hidden * shape.inputs + shape.hidden; i++) w[k++] = rng.gaussian() * s1;
  const s2 = 1 / Math.sqrt(shape.hidden);
  for (let i = 0; i < shape.outputs * shape.hidden + shape.outputs; i++) w[k++] = rng.gaussian() * s2;
  return { id: ids.take(), parentId: null, generation: 0, shape, genes: { brain: w } };
}
