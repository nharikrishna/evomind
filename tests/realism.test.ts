import { describe, expect, it } from "vitest";
import { BODIES_PRESET, makeConfig } from "../src/sim/config";
import { bodyFromGenes, geneForTrait, TRAITS } from "../src/sim/body";
import { createWorld, stateHash, step } from "../src/sim/world";
import { randomPopulation } from "../src/brain/population";
import { neuralFactory } from "../src/brain/neuralController";
import type { Controller } from "../src/sim/controllers";

/** Body genes for the given size, every other trait at its default. */
function genesWithSize(size: number, cfg = makeConfig()): Float32Array {
  return Float32Array.from(TRAITS, (t) =>
    geneForTrait(t, t.key === "size" ? size : t.key === "maxSpeed" ? cfg.maxSpeed : t.key === "sensorRange" ? cfg.sensorRange : cfg.maxTurnRate),
  );
}

describe("size scaling (Kleiber)", () => {
  const on = makeConfig({ sizeScaling: true });

  it("leaves a size-1 body exactly as before", () => {
    const a = bodyFromGenes(genesWithSize(1), on);
    const b = bodyFromGenes(genesWithSize(1), makeConfig());
    expect(a.basal).toBeCloseTo(b.basal, 6);
    expect(a.maxEnergy).toBeCloseTo(on.maxEnergy, 3);
    expect(a.moveFactor).toBeCloseTo(1, 4);
  });

  it("big bodies store more energy and pay less per unit mass", () => {
    const big = bodyFromGenes(genesWithSize(1.8), on);
    const mass = 1.8 * 1.8;
    expect(big.maxEnergy).toBeCloseTo(on.maxEnergy * mass, 0);
    // Metabolic size term grows with mass^0.75, i.e. slower than mass.
    const old = bodyFromGenes(genesWithSize(1.8), makeConfig());
    expect(big.basal).toBeLessThan(old.basal);
    expect(big.moveFactor).toBeCloseTo(mass ** 0.75, 2);
  });

  it("small bodies start with energy clamped to their smaller store", () => {
    const c = makeConfig({ ...BODIES_PRESET, sizeScaling: true, creatureCount: 1 });
    const [g] = randomPopulation(c);
    g.genes.body = genesWithSize(0.6, c);
    const w = createWorld(c, neuralFactory([g]));
    expect(w.creatures[0].body.maxEnergy).toBeCloseTo(c.maxEnergy * 0.36, 1);
    expect(w.creatures[0].energy).toBeCloseTo(c.maxEnergy * 0.36, 1);
  });
});

describe("inertia", () => {
  const full: Controller = { kind: "scripted", act: (_s, o) => { o.turn = 0; o.thrust = 1; } };

  it("speed ramps up by at most `acceleration` per tick", () => {
    const c = makeConfig({ creatureCount: 1, foodCount: 0, acceleration: 0.5 });
    const w = createWorld(c, () => full, { enforceNeuralPrey: false });
    const speeds = [];
    for (let t = 0; t < 6; t++) { step(w); speeds.push(w.creatures[0].speed); }
    expect(speeds.map((s) => +s.toFixed(3))).toEqual([0.5, 1, 1.5, 2, 2, 2]);
  });

  it("heavier bodies accelerate slower", () => {
    const c = makeConfig({ acceleration: 0.2 });
    expect(bodyFromGenes(genesWithSize(2), c).accel).toBeCloseTo(0.05, 3);
    expect(bodyFromGenes(genesWithSize(0.5), c).accel).toBeCloseTo(0.8, 2);
  });

  it("acceleration 0 means instant speed (lab mode)", () => {
    const c = makeConfig({ creatureCount: 1, foodCount: 0 });
    const w = createWorld(c, () => full, { enforceNeuralPrey: false });
    step(w);
    expect(w.creatures[0].speed).toBe(c.maxSpeed);
  });
});

describe("sensor noise", () => {
  it("perturbs what the brain sees but stays deterministic and in range", () => {
    const run = (noise: number) => {
      const c = makeConfig({ seed: 8, creatureCount: 20, sensorNoise: noise });
      const w = createWorld(c, neuralFactory(randomPopulation(c)));
      for (let t = 0; t < 50; t++) step(w);
      return w;
    };
    const a = run(0.1), b = run(0.1), clean = run(0);
    expect(stateHash(a)).toBe(stateHash(b));
    expect(stateHash(a)).not.toBe(stateHash(clean));
    expect(a.sensorViews.every((s) => Array.from(s).every((v) => v >= -1 && v <= 1))).toBe(true);
  });
});
