/**
 * Seeded PRNG (mulberry32). All randomness in the simulation flows through an
 * Rng instance so a run is fully reproducible from (config, seed).
 * Never call Math.random() inside src/sim, src/brain or src/evo.
 */
/** Mix several integers into one well-scrambled 32-bit seed (for independent streams). */
export function deriveSeed(...parts: number[]): number {
  let h = 0x9e3779b9;
  for (const p of parts) {
    h = Math.imul(h ^ (p >>> 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

export class Rng {
  private state: number;
  private spareGaussian: number | null = null;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Full internal state, for saving a run and resuming it bit-identically. */
  getState(): [number, number | null] {
    return [this.state, this.spareGaussian];
  }

  setState([state, spare]: [number, number | null]): void {
    this.state = state >>> 0;
    this.spareGaussian = spare;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Standard normal sample (Box-Muller, caches the second value). */
  gaussian(): number {
    if (this.spareGaussian !== null) {
      const g = this.spareGaussian;
      this.spareGaussian = null;
      return g;
    }
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spareGaussian = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }
}
