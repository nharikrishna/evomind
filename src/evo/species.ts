import type { Genome } from "../brain/genome";
import type { Rng } from "../sim/rng";

/**
 * Species as genetic clusters (asexual creatures have no interbreeding test).
 *
 * Each species keeps a representative genome vector. A newborn joins its
 * parent's species if it is within `threshold` (RMS per-gene distance) of that
 * representative; otherwise the closest living species within threshold; if
 * none, it founds a new species, recorded as a branch of its parent's species.
 * Representatives are refreshed from living members, so a species can change
 * gradually without splitting, unless part of it drifts away.
 */
export interface Species {
  id: number;
  /** Species it branched from (null for founders). */
  parent: number | null;
  /** Tick it appeared. */
  born: number;
  /** Tick its last member died (null while alive). */
  extinct: number | null;
  /** Living members at the last census. */
  size: number;
  /** Largest census size ever. */
  peak: number;
  rep: Float32Array;
}

export function genomeVector(g: Genome): Float32Array {
  const parts = [g.genes.brain, g.genes.body, g.genes.repro].filter((x): x is Float32Array => !!x);
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let k = 0;
  for (const p of parts) {
    out.set(p, k);
    k += p.length;
  }
  return out;
}

/** RMS per-gene distance (comparable across genome sizes). */
export function geneticDistance(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s / Math.max(1, n));
}

export class SpeciesTracker {
  readonly species = new Map<number, Species>();
  /** Species of each living (or recently living) genome id. */
  private of = new Map<number, number>();
  private nextId = 1;
  /** New species founded (speciation events), not counting the initial founders. */
  speciations = 0;

  constructor(private threshold: number) {}

  speciesOf(genomeId: number): number | undefined {
    return this.of.get(genomeId);
  }

  private found(parent: number | null, v: Float32Array, tick: number): number {
    const id = this.nextId++;
    this.species.set(id, { id, parent, born: tick, extinct: null, size: 0, peak: 0, rep: v });
    return id;
  }

  /** Closest living species within threshold, or null. */
  private nearest(v: Float32Array, exclude?: number): number | null {
    let best: number | null = null, bestD = this.threshold;
    for (const s of this.species.values()) {
      if (s.extinct !== null || s.id === exclude) continue;
      const d = geneticDistance(v, s.rep);
      if (d <= bestD) {
        bestD = d;
        best = s.id;
      }
    }
    return best;
  }

  /** Assign a founder genome (no parent): join a close species or start one. */
  assignFounder(g: Genome, tick: number): number {
    const v = genomeVector(g);
    const sp = this.nearest(v) ?? this.found(null, v, tick);
    this.of.set(g.id, sp);
    return sp;
  }

  /** Assign a newborn, preferring its parent's species. */
  assignChild(child: Genome, parentId: number, tick: number): number {
    const v = genomeVector(child);
    const ps = this.of.get(parentId);
    const parentSpecies = ps !== undefined ? this.species.get(ps) : undefined;
    let sp: number;
    if (parentSpecies && parentSpecies.extinct === null && geneticDistance(v, parentSpecies.rep) <= this.threshold) {
      sp = parentSpecies.id;
    } else {
      const other = this.nearest(v, ps);
      if (other !== null) sp = other;
      else {
        sp = this.found(ps ?? null, v, tick);
        if (ps !== undefined) this.speciations++;
      }
    }
    this.of.set(child.id, sp);
    return sp;
  }

  /**
   * Count living members, mark empty species extinct, refresh representatives
   * from random living members, and forget dead genomes.
   */
  census(living: readonly Genome[], tick: number, rng: Rng): void {
    const members = new Map<number, Genome[]>();
    const alive = new Set<number>();
    for (const g of living) {
      const sp = this.of.get(g.id);
      if (sp === undefined) continue;
      alive.add(g.id);
      if (!members.has(sp)) members.set(sp, []);
      members.get(sp)!.push(g);
    }
    for (const s of this.species.values()) {
      const m = members.get(s.id);
      s.size = m ? m.length : 0;
      s.peak = Math.max(s.peak, s.size);
      if (!m) {
        if (s.extinct === null) s.extinct = tick;
        continue;
      }
      s.rep = genomeVector(m[rng.int(m.length)]);
    }
    for (const id of this.of.keys()) if (!alive.has(id)) this.of.delete(id);
  }

  livingSpecies(): Species[] {
    return [...this.species.values()].filter((s) => s.extinct === null);
  }

  /** Drop long-extinct species with no living descendants (keeps the tree readable and memory bounded). */
  prune(keepRecent: number, tick: number): void {
    const needed = new Set<number>();
    for (const s of this.livingSpecies()) {
      let cur: number | null = s.id;
      while (cur !== null && !needed.has(cur)) {
        needed.add(cur);
        cur = this.species.get(cur)?.parent ?? null;
      }
    }
    for (const s of [...this.species.values()]) {
      if (s.extinct !== null && !needed.has(s.id) && tick - s.extinct > keepRecent) this.species.delete(s.id);
    }
  }
}
