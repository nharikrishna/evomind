import type { SimConfig } from "./config";
import { deriveSeed, Rng } from "./rng";
import { wrapCoord } from "./math";
import { BIOMES, MAX_GROWTH, type BiomeMap } from "./biomes";

/**
 * Fertility: a smooth, seed-determined map of how readily plants grow, from
 * barren (near 0) to rich (1). Built from coarse random values with bilinear
 * interpolation, wrapping at the edges like the world does.
 */
export class FertilityMap {
  readonly cols: number;
  readonly rows: number;
  /** Coarse grid values (row-major), already contrast-adjusted, in [minFertility, 1]. */
  readonly values: Float32Array;

  constructor(readonly width: number, readonly height: number, cfg: SimConfig) {
    this.cols = Math.max(2, Math.round(width / cfg.fertilityScale));
    this.rows = Math.max(2, Math.round(height / cfg.fertilityScale));
    const rng = new Rng(deriveSeed(cfg.seed, 0xfe47));
    this.values = new Float32Array(this.cols * this.rows);
    for (let i = 0; i < this.values.length; i++) {
      const v = (rng.next() - 0.5) * cfg.fertilityContrast + 0.5;
      this.values[i] = Math.min(1, Math.max(cfg.minFertility, v));
    }
  }

  /** Fertility at a world position (bilinear between grid points, toroidal). */
  at(x: number, y: number): number {
    return sampleGrid(this.values, this.cols, this.rows, x / this.width, y / this.height);
  }
}

/** Toroidal bilinear sample of a coarse grid at fractional position (u, v) in [0, 1). */
export function sampleGrid(values: ArrayLike<number>, cols: number, rows: number, u: number, v: number): number {
  const gx = u * cols, gy = v * rows;
  const c0 = Math.floor(gx), r0 = Math.floor(gy);
  const fx = gx - c0, fy = gy - r0;
  const cc = ((c0 % cols) + cols) % cols, rr = ((r0 % rows) + rows) % rows;
  const c1 = (cc + 1) % cols, r1 = (rr + 1) % rows;
  const top = values[rr * cols + cc] * (1 - fx) + values[rr * cols + c1] * fx;
  const bot = values[r1 * cols + cc] * (1 - fx) + values[r1 * cols + c1] * fx;
  return top * (1 - fy) + bot * fy;
}

/** Max placement attempts before accepting the last candidate. */
const MAX_TRIES = 8;

/**
 * Where a new plant sprouts. Mostly next to an existing plant (seed dispersal),
 * occasionally anywhere (long-distance seeds recolonise bare ground); either
 * way the spot is accepted with probability = its fertility.
 *
 * `parents` are positions of currently active plants (x0, y0, x1, y1, ...).
 */
export function sproutPosition(
  cfg: SimConfig,
  fertility: FertilityMap,
  parents: ArrayLike<number>,
  rng: Rng,
  biomes: BiomeMap | null = null,
): { x: number; y: number } {
  const nParents = parents.length / 2;
  let x = 0, y = 0;
  for (let t = 0; t < MAX_TRIES; t++) {
    if (nParents > 0 && rng.next() < cfg.seedLocalProb) {
      const p = rng.int(nParents);
      x = wrapCoord(parents[2 * p] + rng.gaussian() * cfg.seedSpread, cfg.width);
      y = wrapCoord(parents[2 * p + 1] + rng.gaussian() * cfg.seedSpread, cfg.height);
    } else {
      x = rng.range(0, cfg.width);
      y = rng.range(0, cfg.height);
    }
    const growth = biomes ? BIOMES[biomes.at(x, y)].growth / MAX_GROWTH : 1;
    if (rng.next() < fertility.at(x, y) * growth) break;
  }
  return { x, y };
}

/**
 * Clark–Evans aggregation index of points on a torus: the mean nearest-neighbour
 * distance divided by its expectation for random scatter. ≈1 random, <1 clustered,
 * >1 evenly spaced. O(n²), fine for a few hundred points.
 */
export function clarkEvans(xs: ArrayLike<number>, ys: ArrayLike<number>, width: number, height: number): number {
  const n = xs.length;
  if (n < 2) return 1;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    let best = Infinity;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      let dx = Math.abs(xs[i] - xs[j]);
      let dy = Math.abs(ys[i] - ys[j]);
      if (dx > width / 2) dx = width - dx;
      if (dy > height / 2) dy = height - dy;
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
    sum += Math.sqrt(best);
  }
  const expected = 0.5 / Math.sqrt(n / (width * height));
  return sum / n / expected;
}
