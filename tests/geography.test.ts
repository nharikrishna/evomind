import { describe, expect, it } from "vitest";
import { GEOGRAPHY_PRESET, makeConfig } from "../src/sim/config";
import { BiomeMap, MOUNTAIN, NO_BARRIER, RIVER } from "../src/sim/biomes";
import { createWorld, step } from "../src/sim/world";
import type { Controller } from "../src/sim/controllers";
import { NaturalEvolution } from "../src/evo/natural";
import { Rng } from "../src/sim/rng";

const geo = makeConfig({ ...GEOGRAPHY_PRESET, seed: 3 });

describe("barrier map", () => {
  const map = new BiomeMap(geo.width, geo.height, geo);

  it("puts barriers exactly on region borders, of both kinds", () => {
    let barrier = 0, river = 0, mountain = 0;
    for (let r = 0; r < map.rows; r++) {
      for (let c = 0; c < map.cols; c++) {
        const b = map.barrierCells[r * map.cols + c];
        if (b === NO_BARRIER) continue;
        barrier++;
        if (b === RIVER) river++;
        if (b === MOUNTAIN) mountain++;
      }
    }
    expect(barrier).toBeGreaterThan(0);
    expect(barrier / map.barrierCells.length).toBeLessThan(0.15); // thin strips, not whole regions
    expect(river + mountain).toBe(barrier);
    // Region interiors are barrier-free.
    for (const r of map.regions) {
      if (map.regionAt(r.x, r.y) === map.regions.indexOf(r)) expect(map.barrierAt(r.x, r.y)).toBe(NO_BARRIER);
    }
  });

  it("finds random points inside a region, off the barriers", () => {
    const rng = new Rng(1);
    for (let k = 0; k < map.regions.length; k++) {
      const p = map.randomPointIn(k, rng)!;
      expect(map.regionAt(p.x, p.y)).toBe(k);
      expect(map.barrierAt(p.x, p.y)).toBe(NO_BARRIER);
    }
  });

  it("no barriers without geography", () => {
    const flat = new BiomeMap(800, 600, makeConfig({ biomes: true }));
    expect(flat.barrierCells.every((b) => b === NO_BARRIER)).toBe(true);
  });
});

describe("barrier physics", () => {
  const go: Controller = { kind: "scripted", act: (_s, o) => { o.turn = 0; o.thrust = 1; } };

  /** A spot just outside a barrier strip of the given kind, plus the heading that walks into it. */
  function approach(map: BiomeMap, kind: number): { x: number; y: number; heading: number } {
    for (let y = 20; y < map.height - 20; y += 5) {
      for (let x = 20; x < map.width - 20; x += 5) {
        if (map.barrierAt(x, y) !== NO_BARRIER) continue;
        for (const [dx, h] of [[4, 0], [-4, Math.PI]] as const) {
          if (map.barrierAt(x + dx, y) === kind) return { x, y, heading: h };
        }
      }
    }
    throw new Error("no approach found");
  }

  it("rivers usually turn creatures back", () => {
    const c = makeConfig({ ...geo, creatureCount: 1, foodCount: 0, riverCrossing: 0 });
    const w = createWorld(c, () => go, { enforceNeuralPrey: false });
    const p = approach(w.biomeMap!, RIVER);
    Object.assign(w.creatures[0], p);
    for (let t = 0; t < 5; t++) step(w);
    expect(w.biomeMap!.barrierAt(w.creatures[0].x, w.creatures[0].y)).not.toBe(RIVER);
  });

  it("mountain ridges are passable but movement there is expensive", () => {
    const c = makeConfig({ ...geo, creatureCount: 1, foodCount: 0, acceleration: 0, agingScale: 0 });
    const w = createWorld(c, () => go, { enforceNeuralPrey: false });
    const p = approach(w.biomeMap!, MOUNTAIN);
    // Start on the ridge itself.
    Object.assign(w.creatures[0], { ...p, x: p.x + (p.heading === 0 ? 5 : -5) });
    expect(w.biomeMap!.barrierAt(w.creatures[0].x, w.creatures[0].y)).toBe(MOUNTAIN);
    const before = w.creatures[0].energySpent;
    step(w);
    const body = w.creatures[0].body;
    const move = c.moveCost * body.moveFactor * body.maxSpeed ** 2;
    expect(w.creatures[0].energySpent - before).toBeGreaterThan(move * (c.mountainCost - 1));
  });
});

describe("storm founders and genetic separation", () => {
  it("storms move groups between regions, and separation is measured", () => {
    const nat = new NaturalEvolution(makeConfig({ ...geo, founderRate: 0.01, labTestEvery: 0, seasonLength: 0 }));
    for (let t = 0; t < 1500; t++) nat.step();
    expect(nat.founderEvents).toBeGreaterThan(3);
    expect(nat.pendingEvents.length).toBeGreaterThan(0);
    const s = nat.stats.at(-1)!;
    expect(s.geneticSeparation).toBeGreaterThanOrEqual(0);
    expect(s.geneticSeparation).toBeLessThan(1);
  });
});
