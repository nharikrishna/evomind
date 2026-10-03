import type { SimConfig } from "./config";
import type { FertilityMap } from "./food";
import { BIOMES, MAX_GROWTH, NO_BARRIER, type BiomeMap } from "./biomes";

/**
 * Vegetation as living ground cover: the land is a grid of cells, each holding
 * plant biomass (energy). Plants grow logistically from what is already there,
 * colonise bare cells from vegetated neighbours, and get a trickle of
 * long-distance seed rain. Capacity comes from soil fertility and biome; seasons
 * scale growth and capacity (winter die-back). Creatures graze the cell they
 * stand on.
 */
export class Vegetation {
  readonly cols: number;
  readonly rows: number;
  readonly cell: number;
  /** Current biomass per cell. */
  readonly biomass: Float32Array;
  /** Full-season carrying capacity per cell. */
  readonly capacity: Float32Array;
  private next: Float32Array;

  constructor(readonly width: number, readonly height: number, cfg: SimConfig, fertility: FertilityMap | null, biomes: BiomeMap | null) {
    this.cell = cfg.vegCell;
    this.cols = Math.ceil(width / this.cell);
    this.rows = Math.ceil(height / this.cell);
    const n = this.cols * this.rows;
    this.biomass = new Float32Array(n);
    this.capacity = new Float32Array(n);
    this.next = new Float32Array(n);
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const x = (c + 0.5) * this.cell, y = (r + 0.5) * this.cell;
        let k = cfg.vegCapacity * (fertility ? fertility.at(x, y) : 0.5);
        if (biomes) {
          // Nothing grows in rivers or on ridges.
          if (cfg.barriers && biomes.barrierAt(x, y) !== NO_BARRIER) k = 0;
          else k *= BIOMES[biomes.at(x, y)].growth / MAX_GROWTH;
        }
        const i = r * this.cols + c;
        this.capacity[i] = k;
        this.biomass[i] = k * 0.6;
      }
    }
  }

  index(x: number, y: number): number {
    const c = Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.cell)));
    const r = Math.min(this.rows - 1, Math.max(0, Math.floor(y / this.cell)));
    return r * this.cols + c;
  }

  at(x: number, y: number): number {
    return this.biomass[this.index(x, y)];
  }

  /**
   * One growth step. `growth` scales the rate (season × environment shift);
   * `capacityScale` scales capacity (winter die-back when < 1).
   *   dB = r · (B + colonise · meanNeighbours + seedRain) · (1 − B / K)
   * Above capacity (after die-back) the same term is negative, so plants shrink.
   */
  grow(cfg: SimConfig, growth: number, capacityScale: number): void {
    const { cols, rows, biomass: b, capacity, next } = this;
    const r = cfg.vegGrowth * growth;
    for (let y = 0; y < rows; y++) {
      const up = ((y - 1 + rows) % rows) * cols, down = ((y + 1) % rows) * cols, row = y * cols;
      for (let x = 0; x < cols; x++) {
        const i = row + x;
        const k = capacity[i] * capacityScale;
        if (k <= 0) {
          next[i] = 0;
          continue;
        }
        const left = row + ((x - 1 + cols) % cols), right = row + ((x + 1) % cols);
        const neighbours = (b[up + x] + b[down + x] + b[left] + b[right]) / 4;
        const v = b[i];
        const nv = v + r * (v + cfg.vegColonise * neighbours + cfg.vegSeedRain) * (1 - v / k);
        next[i] = nv < 0 ? 0 : nv;
      }
    }
    b.set(next);
  }

  /** Remove up to `amount` from the cell at (x, y); returns what was actually taken. */
  graze(x: number, y: number, amount: number): number {
    const i = this.index(x, y);
    const take = Math.min(amount, this.biomass[i]);
    this.biomass[i] -= take;
    return take;
  }

  total(): number {
    let s = 0;
    for (const v of this.biomass) s += v;
    return s;
  }

  /**
   * Richest vegetation within `range`: samples 8 directions at 3 distances.
   * Returns the offset to the richest sample and its biomass (null if all bare).
   */
  richest(x: number, y: number, range: number): { dx: number; dy: number; amount: number } | null {
    let best: { dx: number; dy: number; amount: number } | null = null;
    for (let d = 1; d <= 3; d++) {
      const dist = (range * d) / 3;
      for (let a = 0; a < 8; a++) {
        const ang = (a * Math.PI) / 4;
        const dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist;
        const px = ((x + dx) % this.width + this.width) % this.width;
        const py = ((y + dy) % this.height + this.height) % this.height;
        const v = this.at(px, py);
        // Prefer richer; on ties prefer nearer (smaller d visited first).
        if (!best || v > best.amount) best = { dx, dy, amount: v };
      }
    }
    return best && best.amount > 0.05 ? best : null;
  }
}
