import { describe, expect, it } from "vitest";
import { geneticDistance, genomeVector, SpeciesTracker } from "../src/evo/species";
import type { Genome } from "../src/brain/genome";
import { Rng } from "../src/sim/rng";
import { makeConfig, NATURAL_PRESET } from "../src/sim/config";
import { NaturalEvolution } from "../src/evo/natural";

let nextId = 1;
const genome = (values: number[], parentId: number | null = null): Genome => ({
  id: nextId++,
  parentId,
  generation: 0,
  shape: { inputs: 1, hidden: 1, outputs: 1 },
  genes: { brain: Float32Array.from(values) },
});
const shifted = (g: Genome, by: number) => genome(Array.from(g.genes.brain, (v) => v + by), g.id);

describe("genetic distance", () => {
  it("is RMS per gene, so comparable across genome sizes", () => {
    expect(geneticDistance(Float32Array.from([0, 0]), Float32Array.from([3, 4]))).toBeCloseTo(Math.sqrt(12.5));
    expect(geneticDistance(Float32Array.from([1, 1, 1, 1]), Float32Array.from([1.5, 1.5, 1.5, 1.5]))).toBeCloseTo(0.5);
  });

  it("concatenates all gene segments", () => {
    const g = genome([1, 2]);
    g.genes.body = Float32Array.from([3]);
    g.genes.repro = Float32Array.from([4, 5]);
    expect(Array.from(genomeVector(g))).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("species tracker", () => {
  it("groups close founders, separates distant ones", () => {
    const t = new SpeciesTracker(0.4);
    const a = t.assignFounder(genome([0, 0, 0]), 0);
    const b = t.assignFounder(genome([0.1, 0, 0]), 0);
    const c = t.assignFounder(genome([5, 5, 5]), 0);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
    expect(t.speciations).toBe(0); // founders aren't speciation events
  });

  it("children stay in the parent's species unless they drift too far, then branch off", () => {
    const t = new SpeciesTracker(0.4);
    const p = genome([0, 0, 0]);
    const sp = t.assignFounder(p, 0);
    expect(t.assignChild(shifted(p, 0.2), p.id, 10)).toBe(sp);
    const far = shifted(p, 1);
    const sp2 = t.assignChild(far, p.id, 20);
    expect(sp2).not.toBe(sp);
    expect(t.species.get(sp2)!.parent).toBe(sp);
    expect(t.species.get(sp2)!.born).toBe(20);
    expect(t.speciations).toBe(1);
  });

  it("census counts members, marks empty species extinct, and prune keeps ancestors of the living", () => {
    const t = new SpeciesTracker(0.4);
    const p = genome([0, 0]);
    const a = t.assignFounder(p, 0);
    const kid = shifted(p, 2);
    const b = t.assignChild(kid, p.id, 5);
    t.census([kid], 100, new Rng(1)); // the parent died
    expect(t.species.get(a)!.extinct).toBe(100);
    expect(t.species.get(b)!.size).toBe(1);
    t.prune(0, 1_000_000);
    expect(t.species.has(a)).toBe(true); // ancestor of a living species
    const lone = t.assignFounder(genome([9, 9]), 0);
    t.census([kid], 200, new Rng(1));
    t.prune(0, 1_000_000);
    expect(t.species.has(lone)).toBe(false); // extinct, no descendants
  });
});

describe("species in natural evolution", () => {
  it("every living creature has a species; founders collapse to a few", () => {
    const nat = new NaturalEvolution(makeConfig({ ...NATURAL_PRESET, seed: 2, labTestEvery: 0 }));
    expect(nat.species.livingSpecies().length).toBeGreaterThan(20); // unrelated random founders
    for (let t = 0; t < 8000; t++) nat.step();
    for (const g of nat.livingGenomes()) expect(nat.speciesOf(g.id)).toBeDefined();
    expect(nat.stats.at(-1)!.speciesAlive).toBeLessThan(15);
    expect(nat.speciesList.some((s) => s.extinct === null)).toBe(true);
  });
});
