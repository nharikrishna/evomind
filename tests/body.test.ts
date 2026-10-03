import { describe, expect, it } from "vitest";
import { BODIES_PRESET, makeConfig } from "../src/sim/config";
import { bodyFromGenes, defaultBody, geneForTrait, randomBodyGenes, traitFromGene, TRAITS } from "../src/sim/body";
import { Rng } from "../src/sim/rng";
import { createWorld, step } from "../src/sim/world";
import { randomPopulation } from "../src/brain/population";
import { neuralFactory } from "../src/brain/neuralController";
import { Evolution } from "../src/evo/generation";
import { preyFitness } from "../src/evo/fitness";
import type { Controller } from "../src/sim/controllers";

const cfg = makeConfig();
const defaultGenes = () => Float32Array.from(TRAITS, (t) => geneForTrait(t, t.key === "size" ? 1 : t.key === "maxSpeed" ? cfg.maxSpeed : t.key === "sensorRange" ? cfg.sensorRange : cfg.maxTurnRate));

describe("body genes", () => {
  it("decode into their allowed range, even for extreme genes", () => {
    for (const t of TRAITS) {
      for (const g of [-50, -3, 0, 3, 50]) {
        const v = traitFromGene(t, g);
        expect(v).toBeGreaterThanOrEqual(t.min);
        expect(v).toBeLessThanOrEqual(t.max);
      }
      const mid = (t.min + t.max) / 2;
      expect(traitFromGene(t, geneForTrait(t, mid))).toBeCloseTo(mid, 5);
    }
  });

  it("the default body costs exactly the old fixed basal cost", () => {
    const b = bodyFromGenes(defaultGenes(), cfg);
    const d = defaultBody(cfg);
    expect(b.maxSpeed).toBeCloseTo(d.maxSpeed, 4);
    expect(b.sensorRange).toBeCloseTo(d.sensorRange, 2);
    expect(b.size).toBeCloseTo(1, 4);
    expect(b.turnRate).toBeCloseTo(d.turnRate, 4);
    expect(b.basal).toBeCloseTo(cfg.basalCost, 4);
    expect(b.eatRadius).toBeCloseTo(cfg.eatRadius, 3);
  });

  it("every trait has a price: raising it raises upkeep (insulation only with temperature)", () => {
    const warm = makeConfig({ temperature: true });
    const base = bodyFromGenes(defaultGenes(), warm).basal;
    for (let i = 0; i < TRAITS.length; i++) {
      const g = defaultGenes();
      g[i] += 1;
      expect(bodyFromGenes(g, warm).basal).toBeGreaterThan(base);
    }
    const g = defaultGenes();
    g[TRAITS.findIndex((t) => t.key === "insulation")] += 1;
    expect(bodyFromGenes(g, cfg).basal).toBeCloseTo(bodyFromGenes(defaultGenes(), cfg).basal, 9);
  });

  it("random generation-0 bodies vary around the default", () => {
    const rng = new Rng(3);
    const sizes = Array.from({ length: 200 }, () => bodyFromGenes(randomBodyGenes(cfg, rng), cfg).size);
    const mean = sizes.reduce((s, x) => s + x, 0) / sizes.length;
    expect(mean).toBeGreaterThan(0.85);
    expect(mean).toBeLessThan(1.15);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeGreaterThan(0.3);
  });
});

describe("bodies in the world", () => {
  it("lab mode has no body genes and default bodies", () => {
    const pop = randomPopulation(makeConfig({ creatureCount: 5 }));
    expect(pop.every((g) => g.genes.body === undefined)).toBe(true);
    const w = createWorld(makeConfig({ creatureCount: 5 }), neuralFactory(pop));
    expect(w.creatures[0].body).toEqual(defaultBody(w.config));
  });

  it("evolved bodies change the physics (speed cap, eat radius)", () => {
    const c = makeConfig({ ...BODIES_PRESET, creatureCount: 1, foodCount: 0 });
    const [g] = randomPopulation(c);
    // Max out speed and size genes.
    g.genes.body![0] = 20;
    g.genes.body![2] = 20;
    const full: Controller = { kind: "neural", act: (_s, o) => { o.turn = 0; o.thrust = 1; } };
    const w = createWorld(c, (creature, i, rng, config) => {
      neuralFactory([g])(creature, i, rng, config);
      return full;
    });
    step(w);
    const cr = w.creatures[0];
    expect(cr.speed).toBeCloseTo(4, 3);
    expect(cr.body.eatRadius).toBeCloseTo(c.eatRadius * 2, 3);
    expect(cr.energySpent).toBeCloseTo(cr.body.basal + c.moveCost * cr.body.moveFactor * 16, 5);
  });

  it("children inherit mutated bodies, and runs save/load with bodies intact", () => {
    const c = makeConfig({ ...BODIES_PRESET, seed: 4, creatureCount: 20, episodeTicks: 200 });
    const evo = new Evolution(c);
    evo.runGeneration();
    const child = evo.population.find((g) => g.parentId !== null)!;
    expect(child.genes.body).toHaveLength(TRAITS.length);
    expect(evo.history[0].sizeSd).toBeGreaterThan(0);

    const resumed = Evolution.fromJSON(JSON.parse(JSON.stringify(evo.toJSON())));
    expect(Array.from(resumed.population[7].genes.body!)).toEqual(Array.from(evo.population[7].genes.body!));
    resumed.runGeneration();
    evo.runGeneration();
    expect(resumed.history).toEqual(evo.history);
  });
});

describe("energy-surplus fitness", () => {
  it("subtracts energy spent in food units when energyWeight = 1", () => {
    const c = makeConfig({ energyWeight: 1 });
    const creature = { foodEaten: 10, age: 100, energySpent: 80 } as Parameters<typeof preyFitness>[0];
    expect(preyFitness(creature, c)).toBeCloseTo(10 - 80 / c.foodEnergy);
    expect(preyFitness(creature, makeConfig())).toBe(10);
  });
});
