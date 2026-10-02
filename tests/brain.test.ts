import { describe, expect, it } from "vitest";
import { Brain } from "../src/brain/mlp";
import { brainWeightCount, GenomeIds, randomGenome } from "../src/brain/genome";
import { NeuralController } from "../src/brain/neuralController";
import { randomPopulation } from "../src/brain/population";
import { makeConfig } from "../src/sim/config";
import { Rng } from "../src/sim/rng";

describe("mlp", () => {
  it("matches a hand-computed forward pass", () => {
    // 2 inputs -> 2 hidden -> 1 output
    const shape = { inputs: 2, hidden: 2, outputs: 1 };
    // W1 = [[0.5, -1], [1, 1]], b1 = [0, -0.5], W2 = [[1, -2]], b2 = [0.25]
    const w = new Float32Array([0.5, -1, 1, 1, 0, -0.5, 1, -2, 0.25]);
    expect(w.length).toBe(brainWeightCount(shape));
    const brain = new Brain(shape, w);
    const out = brain.forward([1, 2]);
    const h0 = Math.tanh(0.5 * 1 - 1 * 2 + 0);
    const h1 = Math.tanh(1 * 1 + 1 * 2 - 0.5);
    const o = Math.tanh(1 * h0 - 2 * h1 + 0.25);
    expect(brain.hiddenAct[0]).toBeCloseTo(h0, 5);
    expect(brain.hiddenAct[1]).toBeCloseTo(h1, 5);
    expect(out[0]).toBeCloseTo(o, 5);
    expect(brain.w1(0, 1)).toBe(-1);
    expect(brain.w2(0, 1)).toBe(-2);
  });

  it("rejects wrong weight counts", () => {
    expect(() => new Brain({ inputs: 2, hidden: 2, outputs: 1 }, new Float32Array(3))).toThrow();
  });
});

describe("genome", () => {
  it("has the expected size and unique ids", () => {
    const shape = { inputs: 4, hidden: 8, outputs: 2 };
    const ids = new GenomeIds();
    const rng = new Rng(1);
    const a = randomGenome(shape, rng, ids);
    const b = randomGenome(shape, rng, ids);
    expect(a.genes.brain.length).toBe(58);
    expect(a.id).not.toBe(b.id);
    expect(a.parentId).toBeNull();
    expect(a.generation).toBe(0);
  });

  it("random populations are reproducible per seed and varied within", () => {
    const cfg = makeConfig({ seed: 3, creatureCount: 10 });
    const p1 = randomPopulation(cfg);
    const p2 = randomPopulation(cfg);
    expect(Array.from(p1[4].genes.brain)).toEqual(Array.from(p2[4].genes.brain));
    expect(Array.from(p1[0].genes.brain)).not.toEqual(Array.from(p1[1].genes.brain));
  });
});

describe("neural controller", () => {
  it("maps outputs to turn in [-1,1] and thrust in [0,1], deterministically", () => {
    const cfg = makeConfig({ seed: 9, creatureCount: 20 });
    const sensors = new Float32Array([0.3, 0.9, 0.5, 0.7]);
    for (const g of randomPopulation(cfg)) {
      const a = { turn: 0, thrust: 0 };
      const b = { turn: 0, thrust: 0 };
      new NeuralController(g).act(sensors, a);
      new NeuralController(g).act(sensors, b);
      expect(a).toEqual(b);
      expect(a.turn).toBeGreaterThanOrEqual(-1);
      expect(a.turn).toBeLessThanOrEqual(1);
      expect(a.thrust).toBeGreaterThanOrEqual(0);
      expect(a.thrust).toBeLessThanOrEqual(1);
    }
  });
});
