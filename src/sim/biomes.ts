import type { SimConfig } from "./config";
import { deriveSeed, Rng } from "./rng";
import { torusDelta } from "./math";

/**
 * Biomes: regions of the world with different physical conditions. Creatures
 * move freely between them; what differs is what it costs to live there.
 */
export interface BiomeSpec {
  name: string;
  /** Chart/map identity colour (validated categorical slots 1-4, dark mode). */
  color: string;
  /** Plant growth multiplier (applied to fertility when plants sprout). */
  growth: number;
  /** Heat loss: extra upkeep per tick per unit of body size (surface ∝ size, store ∝ size²). */
  cold: boolean;
  /** Movement cost multiplier. */
  mud: boolean;
  /** Sensor range multiplier. */
  fog: boolean;
}

export const BIOMES: readonly BiomeSpec[] = [
  { name: "Tundra", color: "#3987e5", growth: 0.6, cold: true, mud: false, fog: false },
  { name: "Forest", color: "#d95926", growth: 1.0, cold: false, mud: false, fog: true },
  { name: "Grassland", color: "#199e70", growth: 1.2, cold: false, mud: false, fog: false },
  { name: "Swamp", color: "#c98500", growth: 1.3, cold: false, mud: true, fog: false },
];
export const GRASSLAND = 2;
/** Highest growth multiplier: growth is normalised by it so acceptance stays ≤ 1. */
export const MAX_GROWTH = Math.max(...BIOMES.map((b) => b.growth));

/** Cell size (px) of the biome lookup grid. */
const CELL = 10;

/**
 * Voronoi regions around seed points (toroidal distance), each assigned a biome
 * so every biome appears and the rest are shuffled. Stored as a lookup grid.
 */
export class BiomeMap {
  readonly cols: number;
  readonly rows: number;
  readonly cells: Uint8Array;
  /** Region centres and their biome, for labels. */
  readonly regions: { x: number; y: number; biome: number }[];

  constructor(readonly width: number, readonly height: number, cfg: SimConfig) {
    const rng = new Rng(deriveSeed(cfg.seed, 0xb10e));
    const n = Math.max(BIOMES.length, cfg.biomeRegions);
    const types = Array.from({ length: n }, (_, k) => k % BIOMES.length);
    rng.shuffle(types);
    this.regions = types.map((biome) => ({ x: rng.range(0, width), y: rng.range(0, height), biome }));
    this.cols = Math.ceil(width / CELL);
    this.rows = Math.ceil(height / CELL);
    this.cells = new Uint8Array(this.cols * this.rows);
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const x = (c + 0.5) * CELL, y = (r + 0.5) * CELL;
        let best = 0, bestD = Infinity;
        this.regions.forEach((p, k) => {
          const dx = torusDelta(x, p.x, width), dy = torusDelta(y, p.y, height);
          const d = dx * dx + dy * dy;
          if (d < bestD) { bestD = d; best = k; }
        });
        this.cells[r * this.cols + c] = this.regions[best].biome;
      }
    }
  }

  /** Biome index at a world position. */
  at(x: number, y: number): number {
    const c = Math.min(this.cols - 1, Math.floor(x / CELL));
    const r = Math.min(this.rows - 1, Math.floor(y / CELL));
    return this.cells[r * this.cols + c];
  }

  /** Fraction of the map covered by each biome. */
  coverage(): number[] {
    const out = BIOMES.map(() => 0);
    for (const b of this.cells) out[b]++;
    return out.map((v) => v / this.cells.length);
  }
}
