import { describe, expect, it } from "vitest";
import { makeConfig, NATURAL_PRESET } from "../src/sim/config";
import { seasonFactor, seasonInfo } from "../src/sim/seasons";
import { createWorld, step } from "../src/sim/world";
import type { Controller } from "../src/sim/controllers";
import { NaturalEvolution } from "../src/evo/natural";

describe("season clock", () => {
  const cfg = makeConfig({ seasonLength: 1000, seasonAmplitude: 0.8 });

  it("swings regrowth between 1 ± amplitude over the year", () => {
    expect(seasonFactor(cfg, 0)).toBeCloseTo(1);
    expect(seasonFactor(cfg, 250)).toBeCloseTo(1.8);
    expect(seasonFactor(cfg, 750)).toBeCloseTo(0.2);
    expect(seasonFactor(makeConfig(), 750)).toBe(1); // seasons off
  });

  it("names the quarters around the peak and trough", () => {
    expect(seasonInfo(cfg, 0)!.name).toBe("Spring");
    expect(seasonInfo(cfg, 250)!.name).toBe("Summer");
    expect(seasonInfo(cfg, 500)!.name).toBe("Autumn");
    expect(seasonInfo(cfg, 750)!.name).toBe("Winter");
    expect(seasonInfo(cfg, 2250)!.year).toBe(2);
    expect(seasonInfo(cfg, 600)!.lean).toBe(true);
    expect(seasonInfo(cfg, 100)!.lean).toBe(false);
    expect(seasonInfo(makeConfig(), 100)).toBeNull();
  });
});

describe("regrowth follows seasons and environment shifts", () => {
  const still: Controller = { kind: "scripted", act: (_s, o) => { o.turn = 0; o.thrust = 0; } };

  /** Count regrowth events over a window starting at `from`, with all food eaten each tick. */
  function regrowth(cfg: ReturnType<typeof makeConfig>, from: number, boost = 1): number {
    const w = createWorld(cfg, () => still, { enforceNeuralPrey: false });
    w.tick = from;
    w.foodBoost = boost;
    let n = 0;
    for (let t = 0; t < 100; t++) {
      for (let i = 0; i < w.food.length; i++) {
        if (w.food[i].active) { w.food[i].active = false; w.foodGrid.remove(i); }
      }
      step(w);
      n += w.food.filter((f) => f.active).length;
    }
    return n;
  }

  const cfg = makeConfig({ creatureCount: 0, foodCount: 200, respawnRate: 0.05, seasonLength: 1000, seasonAmplitude: 0.8 });

  it("is much faster in summer than in winter", () => {
    expect(regrowth(cfg, 200)).toBeGreaterThan(regrowth(cfg, 700) * 4);
  });

  it("food boost scales regrowth at runtime", () => {
    const flat = makeConfig({ creatureCount: 0, foodCount: 200, respawnRate: 0.05 });
    const base = regrowth(flat, 0);
    expect(regrowth(flat, 0, 2)).toBeGreaterThan(base * 1.6);
    expect(regrowth(flat, 0, 0.25)).toBeLessThan(base * 0.4);
  });

  it("natural stats record the season and the boost", () => {
    const nat = new NaturalEvolution(makeConfig({ ...NATURAL_PRESET, creatureCount: 20, seasonLength: 1000, labTestEvery: 0 }));
    nat.world.foodBoost = 0.5;
    for (let t = 0; t < 1000; t++) nat.step();
    const lean = nat.stats.filter((s) => s.lean === 1);
    expect(lean.length).toBeGreaterThan(0);
    expect(lean.every((s) => s.seasonFactor <= 1.0001)).toBe(true);
    expect(nat.stats.at(-1)!.foodBoost).toBe(0.5);
  });
});
