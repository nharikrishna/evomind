import type { Rng } from "../sim/rng";

export interface MutationParams {
  /** Per-weight probability of a gaussian nudge. */
  rate: number;
  sigma: number;
  /** Per-weight probability of replacement by a fresh random value. */
  resetRate: number;
}

/** Scale of a freshly re-randomized weight (roughly the init scale). */
const RESET_SCALE = 0.5;

/** Mutates weights in place. Returns how many weights changed. */
export function mutate(w: Float32Array, p: MutationParams, rng: Rng): number {
  let changed = 0;
  for (let i = 0; i < w.length; i++) {
    if (rng.next() < p.resetRate) {
      w[i] = rng.gaussian() * RESET_SCALE;
      changed++;
    } else if (rng.next() < p.rate) {
      w[i] += rng.gaussian() * p.sigma;
      changed++;
    }
  }
  return changed;
}
