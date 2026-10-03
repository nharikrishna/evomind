import { describe, expect, it } from "vitest";
import { makeConfig, NATURAL_PRESET } from "../src/sim/config";
import { clarkEvans, FertilityMap, sampleGrid, sproutPosition } from "../src/sim/food";
import { Rng } from "../src/sim/rng";
import { createWorld, stateHash, step } from "../src/sim/world";
import { randomPopulation } from "../src/brain/population";
import { neuralFactory } from "../src/brain/neuralController";

const plants = makeConfig({ foodModel: "plants" });

describe("fertility map", () => {
  it("stays within [minFertility, 1], wraps smoothly, and is seed-determined", () => {
    const a = new FertilityMap(800, 600, plants);
    const b = new FertilityMap(800, 600, plants);
    const c = new FertilityMap(800, 600, makeConfig({ foodModel: "plants", seed: 2 }));
    expect(Array.from(a.values)).toEqual(Array.from(b.values));
    expect(Array.from(a.values)).not.toEqual(Array.from(c.values));
    for (let k = 0; k < 500; k++) {
      const v = a.at((k * 37) % 800, (k * 53) % 600);
      expect(v).toBeGreaterThanOrEqual(plants.minFertility - 1e-6);
      expect(v).toBeLessThanOrEqual(1);
    }
    // Toroidal: the far edge blends back into the near edge.
    expect(a.at(799.999, 300)).toBeCloseTo(a.at(0, 300), 2);
  });

  it("bilinear sampling hits grid values exactly at grid points", () => {
    const values = [0, 1, 0.5, 0.25];
    expect(sampleGrid(values, 2, 2, 0, 0)).toBe(0);
    expect(sampleGrid(values, 2, 2, 0.5, 0)).toBe(1);
    expect(sampleGrid(values, 2, 2, 0.25, 0)).toBeCloseTo(0.5);
  });
});

describe("plant growth", () => {
  it("sprouts cluster near parents (Clark–Evans well below 1)", () => {
    const fert = new FertilityMap(800, 600, plants);
    const rng = new Rng(4);
    const pts: number[] = [];
    for (let i = 0; i < 200; i++) {
      const p = sproutPosition(plants, fert, pts, rng);
      pts.push(p.x, p.y);
    }
    const xs = pts.filter((_, i) => i % 2 === 0), ys = pts.filter((_, i) => i % 2 === 1);
    expect(clarkEvans(xs, ys, 800, 600)).toBeLessThan(0.6);
  });

  it("favours fertile ground", () => {
    const fert = new FertilityMap(800, 600, plants);
    const rng = new Rng(5);
    let sum = 0, uniform = 0;
    for (let i = 0; i < 2000; i++) {
      const p = sproutPosition({ ...plants, seedLocalProb: 0 }, fert, [], rng);
      sum += fert.at(p.x, p.y);
      uniform += fert.at(rng.range(0, 800), rng.range(0, 600));
    }
    expect(sum / 2000).toBeGreaterThan(uniform / 2000 + 0.1);
  });

  it("random scatter has Clark–Evans ≈ 1", () => {
    const rng = new Rng(6);
    const xs = Array.from({ length: 300 }, () => rng.range(0, 800));
    const ys = Array.from({ length: 300 }, () => rng.range(0, 600));
    const r = clarkEvans(xs, ys, 800, 600);
    expect(r).toBeGreaterThan(0.85);
    expect(r).toBeLessThan(1.15);
  });

  it("plant worlds are deterministic and patchy; the natural preset uses plants", () => {
    const run = () => {
      const c = makeConfig({ foodModel: "plants", creatureCount: 20, seed: 9 });
      const w = createWorld(c, neuralFactory(randomPopulation(c)));
      for (let t = 0; t < 500; t++) step(w);
      return w;
    };
    const a = run(), b = run();
    expect(stateHash(a)).toBe(stateHash(b));
    const act = a.food.filter((f) => f.active);
    expect(clarkEvans(act.map((f) => f.x), act.map((f) => f.y), 800, 600)).toBeLessThan(0.8);
    expect(NATURAL_PRESET.foodModel).toBe("plants");
  });
});
