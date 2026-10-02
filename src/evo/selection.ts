import type { Rng } from "../sim/rng";

/** Indices sorted by fitness, best first. Ties keep index order (deterministic). */
export function rankByFitness(fitness: readonly number[]): number[] {
  return fitness.map((_, i) => i).sort((a, b) => fitness[b] - fitness[a] || a - b);
}

/** Pick k random contestants (with replacement); the fittest wins. */
export function tournament(fitness: readonly number[], k: number, rng: Rng): number {
  let best = rng.int(fitness.length);
  for (let i = 1; i < k; i++) {
    const c = rng.int(fitness.length);
    if (fitness[c] > fitness[best]) best = c;
  }
  return best;
}
