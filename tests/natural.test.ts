import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, makeConfig, NATURAL_PRESET, type SimConfig } from "../src/sim/config";
import { addCreature, createWorld, newCreature, removeDead, step } from "../src/sim/world";
import { decodeRepro, REPRO_TRAITS } from "../src/sim/lifeHistory";
import { geneForTrait } from "../src/sim/body";
import { randomPopulation } from "../src/brain/population";
import { NeuralController, neuralFactory } from "../src/brain/neuralController";
import { NaturalEvolution } from "../src/evo/natural";
import type { Controller } from "../src/sim/controllers";

const natural = (over: Partial<SimConfig> = {}) =>
  makeConfig({ ...NATURAL_PRESET, creatureCount: 30, labTestEvery: 0, ...over });

describe("dynamic population", () => {
  it("adds creatures with stable ids and removes the dead from every array", () => {
    const c = makeConfig({ creatureCount: 3, foodCount: 0 });
    const w = createWorld(c, neuralFactory(randomPopulation(c)));
    const extra = newCreature(w, 10, 10, 0);
    addCreature(w, extra, new NeuralController(randomPopulation(makeConfig({ creatureCount: 1, seed: 9 }))[0]));
    expect(w.creatures.map((x) => x.id)).toEqual([0, 1, 2, 3]);
    w.creatures[1].alive = false;
    const dead = removeDead(w);
    expect(dead.map((x) => x.id)).toEqual([1]);
    expect(w.creatures.map((x) => x.id)).toEqual([0, 2, 3]);
    expect(w.controllers).toHaveLength(3);
    expect(w.sensorViews).toHaveLength(3);
    expect(w.nearestFood).toHaveLength(3);
    step(w); // arrays stay consistent
  });

  it("ageing raises upkeep: doubled basal cost at age = agingScale", () => {
    const still: Controller = { kind: "scripted", act: (_s, o) => { o.turn = 0; o.thrust = 0; } };
    const c = makeConfig({ creatureCount: 1, foodCount: 0, agingScale: 100 });
    const w = createWorld(c, () => still, { enforceNeuralPrey: false });
    w.creatures[0].age = 100;
    const before = w.creatures[0].energy;
    step(w);
    expect(before - w.creatures[0].energy).toBeCloseTo(2 * c.basalCost, 6);
  });

  it("own-speed sense is a 5th input only when enabled", () => {
    const on = makeConfig({ creatureCount: 1, senseSpeed: true });
    const w = createWorld(on, neuralFactory(randomPopulation(on)));
    step(w);
    expect(w.sensorViews[0]).toHaveLength(5);
    expect(randomPopulation(makeConfig({ creatureCount: 1 }))[0].shape.inputs).toBe(4);
  });
});

describe("life history genes", () => {
  it("decode into their ranges and only exist in natural mode", () => {
    const g = Float32Array.from(REPRO_TRAITS, (t) => geneForTrait(t, t.default));
    const lh = decodeRepro(g);
    expect(lh.reproThreshold).toBeCloseTo(0.7, 4);
    expect(lh.offspringShare).toBeCloseTo(0.4, 4);
    expect(randomPopulation(natural())[0].genes.repro).toHaveLength(2);
    expect(randomPopulation(makeConfig())[0].genes.repro).toBeUndefined();
  });
});

describe("natural evolution", () => {
  it("is deterministic per seed", () => {
    const a = new NaturalEvolution(natural({ seed: 3 }));
    const b = new NaturalEvolution(natural({ seed: 3 }));
    for (let t = 0; t < 1500; t++) { a.step(); b.step(); }
    expect(a.stats).toEqual(b.stats);
    expect(a.world.creatures.map((c) => c.id)).toEqual(b.world.creatures.map((c) => c.id));
  });

  it("births conserve energy: parent loses what it gives, child gets it times efficiency", () => {
    const nat = new NaturalEvolution(natural({ seed: 5, creatureCount: 1, foodCount: 0, maturityAge: 0 }));
    const parent = nat.world.creatures[0];
    const lh = decodeRepro(nat.genomeAt(0).genes.repro!);
    parent.energy = parent.body.maxEnergy; // rich enough to breed
    const before = parent.energy;
    nat.step();
    expect(nat.world.creatures).toHaveLength(2);
    const child = nat.world.creatures[1];
    const afterUpkeep = before - parent.energySpent;
    const give = afterUpkeep * lh.offspringShare;
    expect(parent.energy).toBeCloseTo(afterUpkeep - give, 4);
    expect(child.energy).toBeCloseTo(Math.min(child.body.maxEnergy, give * nat.config.birthEfficiency), 4);
    expect(parent.children).toBe(1);
    const cg = nat.genomeAt(1);
    expect(cg.parentId).toBe(nat.genomeAt(0).id);
    expect(nat.lineage.get(cg.id)!.founder).toBe(nat.genomeAt(0).id);
  });

  it("the population sustains itself, turns over, and accumulates generations", () => {
    const nat = new NaturalEvolution(natural({ seed: 1, creatureCount: 100 }));
    for (let t = 0; t < 6000; t++) nat.step();
    const last = nat.stats[nat.stats.length - 1];
    expect(last.population).toBeGreaterThan(40);
    expect(last.population).toBeLessThan(nat.config.maxPopulation);
    expect(last.meanGeneration).toBeGreaterThan(3);
    expect(nat.stats.reduce((s, x) => s + x.births, 0)).toBeGreaterThan(200);
  });

  it("re-seeds after an extinction instead of ending the run", () => {
    const nat = new NaturalEvolution(natural({ seed: 2, foodCount: 0, initialEnergy: 5 }));
    for (let t = 0; t < 400; t++) nat.step();
    expect(nat.extinctions).toBeGreaterThan(0);
    expect(nat.world.creatures.length).toBeGreaterThan(0);
  });

  it("lab tests use the standard food supply and score evolved pools above random", () => {
    const nat = new NaturalEvolution(natural({ seed: 1, creatureCount: 100 }));
    for (let t = 0; t < 5000; t++) nat.step();
    const score = nat.labTest()!;
    expect(nat.labBaseline).not.toBeNull();
    expect(score.meanFood).toBeGreaterThan(nat.labBaseline! * 2);
    expect(DEFAULT_CONFIG.respawnRate).not.toBe(nat.config.respawnRate); // test world differs from the natural world
  });

  it("pruning forgets extinct branches but keeps every living ancestry intact", () => {
    const nat = new NaturalEvolution(natural({ seed: 6, creatureCount: 60 }));
    for (let t = 0; t < 4000; t++) nat.step();
    const living = nat.livingGenomes();
    const chainsBefore = living.map((g) => nat.ancestry(g.id, 1e6));
    const familiesBefore = living.map((g) => nat.founderOf(g.id));
    const before = nat.lineage.size;
    nat.pruneLineage();
    expect(nat.lineage.size).toBeLessThan(before);
    expect(living.map((g) => nat.ancestry(g.id, 1e6))).toEqual(chainsBefore);
    expect(living.map((g) => nat.founderOf(g.id))).toEqual(familiesBefore);
  });

  it("lab tests run in slices alongside the world instead of blocking it", () => {
    const nat = new NaturalEvolution(natural({ seed: 1, creatureCount: 60, labTestEvery: 1000 }));
    for (let t = 0; t < 1000; t++) nat.step();
    expect(nat.labTestRunning).toBe(true);
    expect(nat.labScores).toHaveLength(0);
    // Baseline + score = 2 jobs × 2 episodes × ~2000 test ticks at 10 per tick ≈ 800 ticks.
    for (let t = 0; t < 900; t++) nat.step();
    expect(nat.labTestRunning).toBe(false);
    expect(nat.labBaseline).not.toBeNull();
    expect(nat.labScores).toHaveLength(1);
    expect(nat.labScores[0].tick).toBe(1000);
  });

  it("saves and restores the gene pool and history", () => {
    const nat = new NaturalEvolution(natural({ seed: 4 }));
    for (let t = 0; t < 1000; t++) nat.step();
    const back = NaturalEvolution.fromJSON(JSON.parse(JSON.stringify(nat.toJSON())));
    expect(back.tick).toBe(nat.tick);
    expect(back.stats).toEqual(nat.stats);
    expect(back.world.creatures).toHaveLength(nat.world.creatures.length);
    expect(Array.from(back.genomeAt(0).genes.repro!)).toEqual(Array.from(nat.genomeAt(0).genes.repro!));
    back.step(); // continues without error
  });
});
