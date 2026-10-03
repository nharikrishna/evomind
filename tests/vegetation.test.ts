import { describe, expect, it } from "vitest";
import { GEOGRAPHY_PRESET, makeConfig } from "../src/sim/config";
import { Vegetation } from "../src/sim/vegetation";
import { createWorld, step } from "../src/sim/world";
import type { Controller } from "../src/sim/controllers";

const cfg = makeConfig({ foodModel: "vegetation", width: 200, height: 200 });

describe("vegetation ground cover", () => {
  it("grows logistically toward capacity and no further", () => {
    const v = new Vegetation(200, 200, cfg, null, null);
    v.biomass.fill(1);
    const k = v.capacity[0];
    for (let t = 0; t < 5000; t++) v.grow(cfg, 1, 1);
    expect(v.biomass[0]).toBeGreaterThan(k * 0.95);
    expect(v.biomass[0]).toBeLessThanOrEqual(k + 1e-4);
  });

  it("bare ground recovers from vegetated neighbours much faster than from seed rain alone", () => {
    const edge = new Vegetation(200, 200, cfg, null, null);
    edge.biomass.fill(0);
    for (let x = 0; x < edge.cols; x++) edge.biomass[x] = edge.capacity[x]; // one green row
    const bare = new Vegetation(200, 200, cfg, null, null);
    bare.biomass.fill(0);
    for (let t = 0; t < 300; t++) {
      edge.grow(cfg, 1, 1);
      bare.grow(cfg, 1, 1);
    }
    const nextRow = edge.cols; // first cell of the row next to the green one
    expect(edge.biomass[nextRow]).toBeGreaterThan(bare.biomass[nextRow] * 5);
    expect(bare.biomass[nextRow]).toBeGreaterThan(0); // seed rain still works, slowly
  });

  it("winter die-back: lower capacity makes plants shrink", () => {
    const v = new Vegetation(200, 200, cfg, null, null);
    v.biomass.set(v.capacity);
    const full = v.biomass[0];
    for (let t = 0; t < 300; t++) v.grow(cfg, 0.4, 0.4);
    expect(v.biomass[0]).toBeLessThan(full * 0.6);
    expect(v.biomass[0]).toBeGreaterThan(full * 0.3);
  });

  it("finds the richest direction and grazes", () => {
    const v = new Vegetation(200, 200, cfg, null, null);
    v.biomass.fill(0);
    v.biomass[v.index(150, 100)] = 20;
    const r = v.richest(100, 100, 60)!;
    expect(r.dx).toBeCloseTo(40); // the sample 40px to the right lands in the rich cell
    expect(Math.abs(r.dy)).toBeLessThan(1e-6);
    expect(v.graze(150, 100, 8)).toBe(8);
    expect(v.graze(150, 100, 100)).toBeCloseTo(12);
    expect(v.richest(100, 100, 60)).toBeNull();
  });

  it("nothing grows on rivers or ridges", () => {
    const geo = makeConfig({ ...GEOGRAPHY_PRESET, seed: 3 });
    const w = createWorld({ ...geo, creatureCount: 0 }, () => { throw new Error("no creatures"); });
    const veg = w.vegetation!;
    const map = w.biomeMap!;
    let barrierCells = 0;
    for (let i = 0; i < veg.capacity.length; i++) {
      const x = (i % veg.cols + 0.5) * veg.cell, y = (Math.floor(i / veg.cols) + 0.5) * veg.cell;
      if (map.barrierAt(x, y) !== 0) {
        barrierCells++;
        expect(veg.capacity[i]).toBe(0);
      }
    }
    expect(barrierCells).toBeGreaterThan(0);
  });
});

describe("grazing and satiety", () => {
  const still: Controller = { kind: "scripted", act: (_s, o) => { o.turn = 0; o.thrust = 0; } };
  const go: Controller = { kind: "scripted", act: (_s, o) => { o.turn = 0; o.thrust = 1; } };

  it("a full creature can't eat; food stays for others", () => {
    const c = makeConfig({ ...cfg, creatureCount: 1, satiety: true, initialEnergy: 1000 });
    const w = createWorld(c, () => still, { enforceNeuralPrey: false });
    const cr = w.creatures[0];
    cr.energy = cr.body.maxEnergy;
    const before = w.vegetation!.at(cr.x, cr.y);
    step(w);
    // It only refills what one tick of upkeep burned.
    expect(cr.foodEaten * c.foodEnergy).toBeCloseTo(cr.energySpent, 6);
    expect(w.vegetation!.at(cr.x, cr.y)).toBeGreaterThan(before - c.vegBite);
  });

  it("grazing at full speed takes much smaller bites than at rest", () => {
    const eatOne = (ctrl: Controller) => {
      const c = makeConfig({ ...cfg, creatureCount: 1, satiety: true, initialEnergy: 10 });
      const w = createWorld(c, () => ctrl, { enforceNeuralPrey: false });
      step(w);
      return w.creatures[0].foodEaten;
    };
    expect(eatOne(go)).toBeLessThan(eatOne(still) * 0.5);
  });
});
