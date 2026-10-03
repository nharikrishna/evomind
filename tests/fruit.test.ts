import { describe, expect, it } from "vitest";
import { GEOGRAPHY_PRESET, makeConfig } from "../src/sim/config";
import { createWorld, fruitSeason, step } from "../src/sim/world";
import { digestion } from "../src/sim/body";
import { BIOMES } from "../src/sim/biomes";
import { preySensorCount, preySensorLabels } from "../src/sim/sensors";
import type { Controller } from "../src/sim/controllers";
import { torusDistSq } from "../src/sim/math";

const still: Controller = { kind: "scripted", act: (_s, o) => { o.turn = 0; o.thrust = 0; } };

describe("digestion trade-off", () => {
  it("grazers get grass, fruit-eaters get fruit, generalists get some of both", () => {
    expect(digestion(0)).toMatchObject({ grassEff: 1, fruitEff: 0.3 });
    expect(digestion(1).grassEff).toBeCloseTo(0.3);
    expect(digestion(1).fruitEff).toBeCloseTo(1);
    const g = digestion(0.5);
    expect(g.grassEff).toBeCloseTo(0.65);
    expect(g.fruitEff).toBeCloseTo(0.65);
  });
});

describe("fruit season", () => {
  const cfg = makeConfig({ seasonLength: 1000 });
  it("peaks in late summer/autumn and is zero in winter and spring", () => {
    expect(fruitSeason(cfg, 375)).toBeCloseTo(1); // late summer / autumn
    expect(fruitSeason(cfg, 750)).toBe(0); // midwinter
    expect(fruitSeason(cfg, 50)).toBe(0); // early spring
    expect(fruitSeason(makeConfig(), 750)).toBe(0.5); // no seasons
  });
});

describe("fruit trees", () => {
  const geo = makeConfig({ ...GEOGRAPHY_PRESET, fruit: true, seed: 2, creatureCount: 0 });
  const w = createWorld(geo, () => still);

  it("trees cluster in forest and fruit hangs near its tree", () => {
    const map = w.biomeMap!;
    const perBiome = BIOMES.map(() => 0);
    for (const t of w.trees) perBiome[map.at(t.x, t.y)]++;
    const cover = map.coverage();
    const density = perBiome.map((n, b) => n / cover[b]);
    const forest = BIOMES.findIndex((b) => b.name === "Forest");
    const desert = BIOMES.findIndex((b) => b.name === "Desert");
    expect(w.trees.length).toBe(geo.fruitTrees);
    expect(density[forest]).toBeGreaterThan(density[desert] * 3);
    for (const f of w.food) {
      expect(f.tree).toBeGreaterThanOrEqual(0);
      if (!f.active) continue;
      const t = w.trees[f.tree];
      // Wrap-aware distance (the world is a torus).
      expect(Math.sqrt(torusDistSq(f.x, f.y, t.x, t.y, geo.width, geo.height))).toBeLessThan(geo.fruitSpread * 6);
    }
  });

  it("fruit rots after fruitLife if nobody eats it", () => {
    const c = makeConfig({ ...geo, fruitLife: 5, fruitRate: 0 });
    const w2 = createWorld(c, () => still);
    expect(w2.food.some((f) => f.active)).toBe(true);
    for (let t = 0; t < 7; t++) step(w2);
    expect(w2.food.some((f) => f.active)).toBe(false);
  });

  it("adds 3 fruit-sense inputs", () => {
    expect(preySensorCount(makeConfig({ fruit: true }))).toBe(7);
    expect(preySensorLabels(makeConfig({ fruit: true })).slice(-3)).toEqual(["fruit L/R", "fruit ahead", "fruit near"]);
  });
});

describe("eating fruit", () => {
  it("a fruit-eater gets more energy from the same fruit than a grazer", () => {
    const gain = (diet: number) => {
      const c = makeConfig({ ...GEOGRAPHY_PRESET, fruit: true, seed: 5, creatureCount: 1, satiety: true, fruitRate: 0 });
      const w = createWorld(c, () => still, { enforceNeuralPrey: false });
      const cr = w.creatures[0];
      Object.assign(cr.body, digestion(diet));
      cr.energy = 1;
      const f = w.food.find((x) => x.active)!;
      // Stand right on the fruit, on bare ground (no grass to graze).
      Object.assign(cr, { x: f.x, y: f.y });
      w.vegetation!.biomass.fill(0);
      step(w);
      return cr.fruitEaten;
    };
    expect(gain(1)).toBeGreaterThan(gain(0) * 2.5);
  });
});
