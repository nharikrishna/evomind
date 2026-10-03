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
  /** Ambient temperature relative to body comfort: 0 = comfortable, -1 = very cold, +1 = very hot. */
  temp: number;
  /** Movement cost multiplier. */
  mud: boolean;
  /** Sensor range multiplier. */
  fog: boolean;
}

export const BIOMES: readonly BiomeSpec[] = [
  { name: "Tundra", color: "#3987e5", growth: 0.6, temp: -1, mud: false, fog: false },
  { name: "Forest", color: "#d95926", growth: 1.0, temp: 0, mud: false, fog: true },
  { name: "Grassland", color: "#199e70", growth: 1.2, temp: 0.1, mud: false, fog: false },
  { name: "Swamp", color: "#c98500", growth: 1.3, temp: 0.4, mud: true, fog: false },
  { name: "Desert", color: "#d55181", growth: 0.5, temp: 1, mud: false, fog: false },
];
export const GRASSLAND = 2;
/** Highest growth multiplier: growth is normalised by it so acceptance stays ≤ 1. */
export const MAX_GROWTH = Math.max(...BIOMES.map((b) => b.growth));

/** Cell size (px) of the biome lookup grid. */
export const BIOME_CELL = 10;
const CELL = BIOME_CELL;

/** Barrier kinds along region borders (geography). */
export const NO_BARRIER = 0, RIVER = 1, MOUNTAIN = 2;

/**
 * Voronoi regions around evenly spread seed points (toroidal distance), each
 * assigned a biome so every biome appears. With `barriers`, every border between
 * two regions becomes a river or a mountain ridge. Stored as lookup grids.
 */
export class BiomeMap {
  readonly cols: number;
  readonly rows: number;
  /** Biome per cell. */
  readonly cells: Uint8Array;
  /** Region index per cell. */
  readonly regionCells: Uint8Array;
  /** Barrier kind per cell (NO_BARRIER / RIVER / MOUNTAIN). */
  readonly barrierCells: Uint8Array;
  /** Region centres and their biome, for labels. */
  readonly regions: { x: number; y: number; biome: number }[];

  constructor(readonly width: number, readonly height: number, cfg: SimConfig) {
    const rng = new Rng(deriveSeed(cfg.seed, 0xb10e));
    const n = Math.max(BIOMES.length, cfg.biomeRegions);
    const types = Array.from({ length: n }, (_, k) => k % BIOMES.length);
    rng.shuffle(types);
    // Best-candidate sampling: each centre is the candidate farthest from the others,
    // so regions come out roughly even in size.
    const centres: { x: number; y: number }[] = [];
    for (let k = 0; k < n; k++) {
      let best = { x: 0, y: 0 }, bestD = -1;
      for (let t = 0; t < 30; t++) {
        const p = { x: rng.range(0, width), y: rng.range(0, height) };
        const d = centres.length
          ? Math.min(...centres.map((q) => torusDelta(p.x, q.x, width) ** 2 + torusDelta(p.y, q.y, height) ** 2))
          : 1;
        if (d > bestD) { bestD = d; best = p; }
      }
      centres.push(best);
    }
    this.regions = centres.map((p, k) => ({ ...p, biome: types[k] }));
    this.cols = Math.ceil(width / CELL);
    this.rows = Math.ceil(height / CELL);
    this.cells = new Uint8Array(this.cols * this.rows);
    this.regionCells = new Uint8Array(this.cols * this.rows);
    this.barrierCells = new Uint8Array(this.cols * this.rows);
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const x = (c + 0.5) * CELL, y = (r + 0.5) * CELL;
        let best = 0, bestD = Infinity;
        this.regions.forEach((p, k) => {
          const dx = torusDelta(x, p.x, width), dy = torusDelta(y, p.y, height);
          const d = dx * dx + dy * dy;
          if (d < bestD) { bestD = d; best = k; }
        });
        this.regionCells[r * this.cols + c] = best;
        this.cells[r * this.cols + c] = this.regions[best].biome;
      }
    }
    if (cfg.barriers) {
      // Each pair of neighbouring regions gets one kind of barrier for its whole border.
      const kind = new Map<string, number>();
      const pairKind = (a: number, b: number) => {
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        if (!kind.has(key)) kind.set(key, rng.next() < cfg.riverShare ? RIVER : MOUNTAIN);
        return kind.get(key)!;
      };
      // A cell is barrier if a neighbour (8-connected, wrapping) belongs to another region.
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          const here = this.regionCells[r * this.cols + c];
          for (let dr = -1; dr <= 1 && !this.barrierCells[r * this.cols + c]; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              const rr = (r + dr + this.rows) % this.rows, cc = (c + dc + this.cols) % this.cols;
              const other = this.regionCells[rr * this.cols + cc];
              if (other !== here) {
                this.barrierCells[r * this.cols + c] = pairKind(here, other);
                break;
              }
            }
          }
        }
      }
    }
  }

  private index(x: number, y: number): number {
    const c = Math.min(this.cols - 1, Math.max(0, Math.floor(x / CELL)));
    const r = Math.min(this.rows - 1, Math.max(0, Math.floor(y / CELL)));
    return r * this.cols + c;
  }

  /** Biome index at a world position. */
  at(x: number, y: number): number {
    return this.cells[this.index(x, y)];
  }

  regionAt(x: number, y: number): number {
    return this.regionCells[this.index(x, y)];
  }

  barrierAt(x: number, y: number): number {
    return this.barrierCells[this.index(x, y)];
  }

  /** A random non-barrier point inside a region (rejection sampling). */
  randomPointIn(region: number, rng: Rng): { x: number; y: number } | null {
    for (let t = 0; t < 400; t++) {
      const x = rng.range(0, this.width), y = rng.range(0, this.height);
      if (this.regionAt(x, y) === region && this.barrierAt(x, y) === NO_BARRIER) return { x, y };
    }
    return null;
  }

  /** Fraction of the map covered by each biome. */
  coverage(): number[] {
    const out = BIOMES.map(() => 0);
    for (const b of this.cells) out[b]++;
    return out.map((v) => v / this.cells.length);
  }
}
