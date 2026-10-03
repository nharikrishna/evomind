import { describe, expect, it } from "vitest";
import { Rng } from "../src/sim/rng";
import { torusDelta, wrapAngle, wrapCoord } from "../src/sim/math";
import { makeConfig } from "../src/sim/config";
import { TorusGrid } from "../src/sim/spatial";
import { sensePrey } from "../src/sim/sensors";
import { createWorld, isEpisodeOver, stateHash, step } from "../src/sim/world";
import type { Controller } from "../src/sim/controllers";
import type { Creature } from "../src/sim/types";
import { randomPopulation } from "../src/brain/population";
import { neuralFactory } from "../src/brain/neuralController";
import { defaultBody } from "../src/sim/body";

describe("rng", () => {
  it("is deterministic per seed", () => {
    const a = new Rng(42), b = new Rng(42), c = new Rng(43);
    const sa = Array.from({ length: 5 }, () => a.next());
    const sb = Array.from({ length: 5 }, () => b.next());
    const sc = Array.from({ length: 5 }, () => c.next());
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
  });

  it("gaussian has roughly zero mean, unit variance", () => {
    const r = new Rng(7);
    const n = 20000;
    let s = 0, s2 = 0;
    for (let i = 0; i < n; i++) { const g = r.gaussian(); s += g; s2 += g * g; }
    expect(Math.abs(s / n)).toBeLessThan(0.03);
    expect(Math.abs(s2 / n - 1)).toBeLessThan(0.05);
  });
});

describe("math", () => {
  it("wraps angles into (-PI, PI]", () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI / 2 - 2 * Math.PI)).toBeCloseTo(-Math.PI / 2);
    expect(wrapAngle(0.5)).toBeCloseTo(0.5);
  });

  it("wraps coordinates and takes shortest torus delta", () => {
    expect(wrapCoord(-1, 100)).toBe(99);
    expect(wrapCoord(101, 100)).toBe(1);
    expect(torusDelta(95, 5, 100)).toBe(10);
    expect(torusDelta(5, 95, 100)).toBe(-10);
  });
});

describe("spatial grid", () => {
  it("finds the nearest item across the wrap boundary", () => {
    const xs = [790, 400], ys = [300, 300];
    const g = new TorusGrid(800, 600, 50);
    g.insert(0, xs[0], ys[0]);
    g.insert(1, xs[1], ys[1]);
    expect(g.nearest(5, 300, 200)).toBe(0);
    expect(Math.sqrt(g.foundDistSq)).toBeCloseTo(15);
    g.remove(0);
    expect(g.nearest(5, 300, 200)).toBe(-1);
  });

  it("matches brute force on random layouts (incl. ties and wrap)", () => {
    const rng = new Rng(99);
    for (const [w, h, cell] of [[800, 600, 50], [300, 200, 100], [120, 90, 50]] as const) {
      const n = 80;
      // Snap to a coarse lattice so exact distance ties actually occur.
      const xs = Array.from({ length: n }, () => Math.floor(rng.range(0, w) / 10) * 10);
      const ys = Array.from({ length: n }, () => Math.floor(rng.range(0, h) / 10) * 10);
      const g = new TorusGrid(w, h, cell);
      xs.forEach((x, i) => g.insert(i, x, ys[i]));
      for (let t = 0; t < 300; t++) {
        const px = rng.range(0, w), py = rng.range(0, h), maxD = rng.range(5, 250);
        let best = -1, bestD = maxD * maxD;
        for (let i = 0; i < n; i++) {
          const dx = torusDelta(px, xs[i], w), dy = torusDelta(py, ys[i], h);
          const d = dx * dx + dy * dy;
          if (d < bestD || (d === bestD && (best < 0 || i < best))) { best = i; bestD = d; }
        }
        expect(g.nearest(px, py, maxD)).toBe(best);
      }
    }
  });
});

describe("sensors", () => {
  const cfg = makeConfig();
  const creature = (heading: number): Creature => ({
    id: 0, speciesId: "prey", x: 10, y: 300, heading, speed: 0,
    energy: 50, alive: true, foodEaten: 0, age: 0, genomeId: null,
    body: defaultBody(cfg), children: 0, biome: -1, region: -1, thermalSpent: 0, crowding: 0, fruitEaten: 0,
    distanceTraveled: 0, energySpent: 0, alignmentSum: 0, alignmentTicks: 0, ticksTowardFood: 0,
  });

  it("food straight ahead gives cos=1, sin=0", () => {
    const out = new Float32Array(4);
    sensePrey(creature(0), 0, 110, 300, 100 * 100, cfg, out);
    expect(out[0]).toBeCloseTo(0);
    expect(out[1]).toBeCloseTo(1);
    expect(out[2]).toBeCloseTo(0.5);
    expect(out[3]).toBeCloseTo(0.5);
  });

  it("food behind across the wrap edge is sensed correctly", () => {
    const out = new Float32Array(4);
    // Creature at x=10 facing +x; food at x=790 is 20px behind it through the edge.
    sensePrey(creature(0), 0, 790, 300, 20 * 20, cfg, out);
    expect(out[1]).toBeCloseTo(-1);
  });
});

describe("world", () => {
  const neuralWorld = (seed: number) => {
    const cfg = makeConfig({ seed });
    return createWorld(cfg, neuralFactory(randomPopulation(cfg)));
  };

  it("same seed produces identical runs", () => {
    const a = neuralWorld(5);
    const b = neuralWorld(5);
    for (let i = 0; i < 1000; i++) { step(a); step(b); }
    expect(stateHash(a)).toBe(stateHash(b));
    const c = neuralWorld(6);
    for (let i = 0; i < 1000; i++) step(c);
    expect(stateHash(c)).not.toBe(stateHash(a));
  });

  const still: Controller = { kind: "scripted", act: (_s, o) => { o.turn = 0; o.thrust = 0; } };
  const physicsOnly = { enforceNeuralPrey: false };

  it("refuses non-neural prey (project rule)", () => {
    expect(() => createWorld(makeConfig({ creatureCount: 1 }), () => still)).toThrow(/must be neural/);
  });

  it("creatures starve without food", () => {
    const cfg = makeConfig({ creatureCount: 3, foodCount: 0, initialEnergy: 1, basalCost: 0.1 });
    const w = createWorld(cfg, () => still, physicsOnly);
    for (let i = 0; i < 9; i++) step(w);
    expect(w.creatures.every((c) => c.alive)).toBe(true);
    step(w);
    step(w);
    expect(w.creatures.every((c) => !c.alive)).toBe(true);
    expect(isEpisodeOver(w)).toBe(true);
  });

  it("eating restores energy and removes the food", () => {
    const cfg = makeConfig({ creatureCount: 1, foodCount: 1, respawnRate: 0, initialEnergy: 10 });
    const w = createWorld(cfg, () => still, physicsOnly);
    const f = w.food[0];
    w.foodGrid.remove(0);
    f.x = w.creatures[0].x + 2;
    f.y = w.creatures[0].y;
    w.foodGrid.insert(0, f.x, f.y);
    step(w);
    const c = w.creatures[0];
    expect(c.foodEaten).toBe(1);
    expect(c.energy).toBeCloseTo(10 - cfg.basalCost + cfg.foodEnergy);
    expect(f.active).toBe(false);
  });

  it("movement costs energy quadratically in speed", () => {
    const fast: Controller = { kind: "scripted", act: (_s, o) => { o.turn = 0; o.thrust = 1; } };
    const cfg = makeConfig({ creatureCount: 1, foodCount: 0 });
    const w = createWorld(cfg, () => fast, physicsOnly);
    step(w);
    expect(w.creatures[0].energy).toBeCloseTo(
      cfg.initialEnergy - cfg.basalCost - cfg.moveCost * cfg.maxSpeed ** 2,
    );
  });
});
