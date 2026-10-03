import { describe, expect, it } from "vitest";
import { makeConfig } from "../src/sim/config";
import { TorusGrid } from "../src/sim/spatial";
import { preySensorCount, preySensorLabels, sensePrey } from "../src/sim/sensors";
import { defaultBody } from "../src/sim/body";
import type { Creature } from "../src/sim/types";

describe("grid queries", () => {
  const g = new TorusGrid(400, 300, 50);
  const xs = [100, 130, 100, 395, 300];
  const ys = [100, 100, 140, 100, 250];
  xs.forEach((x, i) => g.insert(i, x, ys[i]));

  it("neighbours: count and mean offset (wrapping)", () => {
    const nb = g.neighbours(100, 100, 50, 0);
    expect(nb.n).toBe(2); // items 1 and 2
    expect(nb.dx).toBeCloseTo(15);
    expect(nb.dy).toBeCloseTo(20);
    const edge = g.neighbours(5, 100, 20);
    expect(edge.n).toBe(1); // item 3 through the edge
    expect(edge.dx).toBeCloseTo(-10);
  });

  it("bestWithin picks the highest value in range, nearer on ties", () => {
    const value = [1, 5, 5, 9, 100];
    expect(g.bestWithin(100, 100, 60, (i) => value[i])).toBe(1); // 1 and 2 tie at 5, 1 is nearer
    expect(g.bestWithin(100, 100, 400, (i) => value[i])).toBe(4);
    expect(g.bestWithin(200, 20, 10, (i) => value[i])).toBe(-1);
  });

  it("large radius on a small grid never double-counts", () => {
    const small = new TorusGrid(200, 200, 100); // 2×2 cells
    small.insert(0, 50, 50);
    small.insert(1, 150, 150);
    expect(small.countWithin(10, 10, 500)).toBe(2);
  });
});

describe("extra senses", () => {
  const cfg = makeConfig({ senseFoodAmount: true, senseCrowd: true, crowdTolerance: 5 });
  const creature: Creature = {
    id: 0, speciesId: "prey", x: 100, y: 100, heading: 0, speed: 0, energy: 50, alive: true, foodEaten: 0, age: 0,
    genomeId: null, body: defaultBody(cfg), children: 0, biome: -1, region: -1, thermalSpent: 0, crowding: 0,
    distanceTraveled: 0, energySpent: 0, alignmentSum: 0, alignmentTicks: 0, ticksTowardFood: 0,
  };

  it("layout: 4 base + 4 food-amount + 3 crowd inputs, with labels", () => {
    expect(preySensorCount(cfg)).toBe(11);
    expect(preySensorLabels(cfg)).toEqual([
      "food L/R", "food ahead", "food near", "energy",
      "food amount", "richest L/R", "richest ahead", "richest amount",
      "crowding", "crowd L/R", "crowd ahead",
    ]);
  });

  it("encodes food amount, richest-plant direction and crowd direction relative to heading", () => {
    const out = new Float32Array(11);
    sensePrey(creature, 0, 150, 100, 2500, cfg, out, 200, 0, {
      nearAmount: 0.25,
      rich: { x: 100, y: 150, amount: 1 }, // straight to the right of a creature heading +x (y down)
      crowd: { n: 5, dx: -10, dy: 0 }, // crowd directly behind
    });
    expect(out[4]).toBeCloseTo(0.25);
    expect(out[5]).toBeCloseTo(1); // richest L/R: sin(+90°)
    expect(out[6]).toBeCloseTo(0);
    expect(out[7]).toBeCloseTo(1);
    expect(out[8]).toBeCloseTo(0.5); // 5 of 2×tolerance
    expect(out[9]).toBeCloseTo(0);
    expect(out[10]).toBeCloseTo(-1); // crowd behind
  });

  it("all zeros when there's nothing to sense", () => {
    const out = new Float32Array(11).fill(9);
    sensePrey(creature, -1, 0, 0, Infinity, cfg, out, 200, 0, { nearAmount: 0, rich: null, crowd: { n: 0, dx: 0, dy: 0 } });
    expect(Array.from(out.slice(4))).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});
