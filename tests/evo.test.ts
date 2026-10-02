import { describe, expect, it } from "vitest";
import { Rng } from "../src/sim/rng";
import { makeConfig } from "../src/sim/config";
import { rankByFitness, tournament } from "../src/evo/selection";
import { mutate } from "../src/evo/mutation";
import { uniformCrossover } from "../src/evo/crossover";
import { Evolution } from "../src/evo/generation";
import { AblatedController } from "../src/analysis/baselines";
import { NeuralController } from "../src/brain/neuralController";
import { randomPopulation } from "../src/brain/population";
import { historyToCSV, genomeFromJSON, genomeToJSON } from "../src/analysis/history";

describe("selection", () => {
  it("ranks best first with deterministic ties", () => {
    expect(rankByFitness([3, 7, 7, 1])).toEqual([1, 2, 0, 3]);
  });

  it("tournament favours fitter individuals", () => {
    const fitness = Array.from({ length: 100 }, (_, i) => i);
    const rng = new Rng(1);
    let sum = 0;
    for (let k = 0; k < 2000; k++) sum += tournament(fitness, 3, rng);
    // Expected max of 3 uniform picks ~ 75; random pick would be ~ 50.
    expect(sum / 2000).toBeGreaterThan(70);
  });
});

describe("mutation", () => {
  it("changes roughly rate * n weights by about sigma", () => {
    const w = new Float32Array(10000);
    const changed = mutate(w, { rate: 0.1, sigma: 0.2, resetRate: 0 }, new Rng(2));
    expect(changed / w.length).toBeGreaterThan(0.08);
    expect(changed / w.length).toBeLessThan(0.12);
    const nz = Array.from(w).filter((x) => x !== 0);
    const sd = Math.sqrt(nz.reduce((s, x) => s + x * x, 0) / nz.length);
    expect(sd).toBeGreaterThan(0.17);
    expect(sd).toBeLessThan(0.23);
  });

  it("rate 0 leaves weights untouched", () => {
    const w = new Float32Array([1, 2, 3]);
    expect(mutate(w, { rate: 0, sigma: 1, resetRate: 0 }, new Rng(3))).toBe(0);
    expect(Array.from(w)).toEqual([1, 2, 3]);
  });
});

describe("crossover", () => {
  it("takes each weight from one of the parents", () => {
    const a = new Float32Array(100).fill(1);
    const b = new Float32Array(100).fill(2);
    const c = uniformCrossover(a, b, new Rng(4));
    expect(c.every((x) => x === 1 || x === 2)).toBe(true);
    const ones = c.filter((x) => x === 1).length;
    expect(ones).toBeGreaterThan(30);
    expect(ones).toBeLessThan(70);
  });
});

describe("evolution", () => {
  const small = makeConfig({ seed: 11, creatureCount: 30, episodeTicks: 300 });

  it("is deterministic per seed", () => {
    const a = new Evolution(small), b = new Evolution(small);
    for (let g = 0; g < 3; g++) { a.runGeneration(); b.runGeneration(); }
    expect(a.history).toEqual(b.history);
    expect(Array.from(a.population[7].genes.brain)).toEqual(Array.from(b.population[7].genes.brain));
  });

  it("keeps population size, preserves elites and records lineage", () => {
    const evo = new Evolution(small);
    evo.runGeneration();
    const gen0Ids = new Set(randomPopulation(small).map((g) => g.id));
    expect(evo.population).toHaveLength(30);
    const elites = evo.population.slice(0, small.eliteCount);
    expect(elites.every((g) => g.generation === 0 && gen0Ids.has(g.id))).toBe(true);
    const children = evo.population.slice(small.eliteCount);
    expect(children.every((g) => g.generation === 1 && g.parentId !== null)).toBe(true);
    expect(new Set(evo.population.map((g) => g.id)).size).toBe(30);
  });

  it("save -> load -> continue is bit-identical to never stopping", () => {
    const straight = new Evolution(small);
    for (let g = 0; g < 5; g++) straight.runGeneration();

    const first = new Evolution(small);
    for (let g = 0; g < 3; g++) first.runGeneration();
    const resumed = Evolution.fromJSON(JSON.parse(JSON.stringify(first.toJSON())));
    for (let g = 0; g < 2; g++) resumed.runGeneration();

    expect(resumed.history).toEqual(straight.history);
    expect(resumed.population.map((g) => g.id)).toEqual(straight.population.map((g) => g.id));
    expect(Array.from(resumed.population[12].genes.brain)).toEqual(Array.from(straight.population[12].genes.brain));
  });

  it("tracks ancestry back to generation 0", () => {
    const evo = new Evolution(small);
    for (let g = 0; g < 4; g++) evo.runGeneration();
    const child = evo.population.find((g) => g.generation === 4)!;
    const chain = evo.ancestry(child.id);
    expect(chain[0]).toBe(child.parentId);
    const root = chain[chain.length - 1];
    expect(evo.lineage.get(root)).toEqual({ parentId: null, generation: 0 });
    expect(evo.ancestorAt(child.id, 100)).toBe(root);
    expect(evo.history[0].diversity).toBeGreaterThan(0);
  });

  it("improves average fitness over a few generations", () => {
    const evo = new Evolution(makeConfig({ seed: 2, episodeTicks: 1000 }));
    for (let g = 0; g < 15; g++) evo.runGeneration();
    const first = evo.history[0].mean;
    const lastFew = evo.history.slice(-3).reduce((s, h) => s + h.mean, 0) / 3;
    expect(lastFew).toBeGreaterThan(first * 2);
  });
});

describe("analysis", () => {
  it("ablation zeroes chosen senses without touching the world's copy", () => {
    const [g] = randomPopulation(makeConfig({ creatureCount: 1 }));
    const inner = new NeuralController(g);
    const ablated = new AblatedController(inner, [0, 1]);
    const sensors = new Float32Array([0.5, 0.5, 0.3, 0.9]);
    ablated.act(sensors, { turn: 0, thrust: 0 });
    expect(Array.from(inner.brain.lastInputs)).toEqual([0, 0, Math.fround(0.3), Math.fround(0.9)]);
    expect(sensors[0]).toBe(0.5);
  });

  it("serializes history and genomes", () => {
    const evo = new Evolution(makeConfig({ creatureCount: 10, episodeTicks: 100 }));
    evo.runGeneration();
    const csv = historyToCSV(evo.history).trim().split("\n");
    expect(csv).toHaveLength(2);
    expect(csv[0]).toMatch(/^generation,best,mean/);
    const g = evo.population[3];
    const back = genomeFromJSON(JSON.parse(JSON.stringify(genomeToJSON(g))));
    expect(Array.from(back.genes.brain)).toEqual(Array.from(g.genes.brain));
  });
});
