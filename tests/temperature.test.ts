import { describe, expect, it } from "vitest";
import { makeConfig } from "../src/sim/config";
import { ambientTemp, createWorld, step, thermalCost } from "../src/sim/world";
import { defaultBody } from "../src/sim/body";
import { TorusGrid } from "../src/sim/spatial";
import type { Controller } from "../src/sim/controllers";

const cfg = makeConfig({ temperature: true });
const body = (over: Partial<ReturnType<typeof defaultBody>> = {}) => ({ ...defaultBody(cfg), insulation: 0, ...over });

describe("heat budget", () => {
  it("costs nothing inside the comfort zone", () => {
    expect(thermalCost(cfg, 0, 0.2, body(), 0)).toBe(0);
    expect(thermalCost(cfg, 0, -0.3, body(), 0)).toBe(0);
  });

  it("cold: heat loss grows with size (surface) and insulation blocks most of it", () => {
    const small = thermalCost(cfg, 0, -1, body({ size: 0.5 }), 0);
    const big = thermalCost(cfg, 0, -1, body({ size: 2 }), 0);
    expect(big).toBeCloseTo(small * 4, 6); // ∝ size
    // ...but per unit of energy store (∝ size² with size scaling), big bodies lose less.
    expect(big / 4).toBeLessThan(small / 0.25);
    const furry = thermalCost(cfg, 0, -1, body({ insulation: 1 }), 0);
    expect(furry).toBeCloseTo(thermalCost(cfg, 0, -1, body(), 0) * 0.15, 6);
  });

  it("heat: insulation, size and movement all make overheating worse", () => {
    const base = thermalCost(cfg, 0, 1, body(), 0);
    expect(base).toBeCloseTo(cfg.thermalCost * (1 - cfg.thermalComfort), 6);
    expect(thermalCost(cfg, 0, 1, body({ insulation: 1 }), 0)).toBeCloseTo(base * 3, 6);
    expect(thermalCost(cfg, 0, 1, body({ size: 2 }), 0)).toBeCloseTo(base * 2 ** 1.5, 6);
    expect(thermalCost(cfg, 0, 1, body(), cfg.maxSpeed)).toBeCloseTo(base * 2, 6);
  });

  it("seasons swing temperature: summer warmer, winter colder", () => {
    const s = makeConfig({ seasonLength: 1000, seasonTempSwing: 0.3 });
    expect(ambientTemp(s, 250, 0)).toBeCloseTo(0.3);
    expect(ambientTemp(s, 750, 0)).toBeCloseTo(-0.3);
    expect(ambientTemp(makeConfig(), 750, 0.4)).toBe(0.4);
  });
});

describe("crowding", () => {
  it("counts neighbours within a radius, wrapping, excluding self", () => {
    const g = new TorusGrid(800, 600, 50);
    g.insert(0, 10, 10);
    g.insert(1, 30, 10);
    g.insert(2, 795, 10); // 15px away through the edge
    g.insert(3, 400, 300);
    expect(g.countWithin(10, 10, 40, 0)).toBe(2);
    g.clear();
    expect(g.countWithin(10, 10, 40)).toBe(0);
  });

  it("crowded creatures pay stress beyond the tolerance", () => {
    const still: Controller = { kind: "scripted", act: (_s, o) => { o.turn = 0; o.thrust = 0; } };
    const c = makeConfig({ crowding: true, creatureCount: 10, foodCount: 0, crowdTolerance: 6 });
    const w = createWorld(c, () => still, { enforceNeuralPrey: false });
    w.creatures.forEach((cr, k) => Object.assign(cr, { x: 100 + k, y: 100 }));
    step(w);
    expect(w.creatures[0].crowding).toBe(9);
    expect(w.creatures[0].energySpent).toBeCloseTo(c.basalCost + c.crowdStress * 3, 6);
  });
});

describe("plant biomass", () => {
  it("grazing takes bites; a plant dies only when eaten to nothing; plants regrow", () => {
    const still: Controller = { kind: "scripted", act: (_s, o) => { o.turn = 0; o.thrust = 0; } };
    const c = makeConfig({ plantBiomass: true, foodModel: "plants", creatureCount: 1, foodCount: 2, respawnRate: 0, initialEnergy: 10 });
    const w = createWorld(c, () => still, { enforceNeuralPrey: false });
    const [f, other] = w.food;
    w.foodGrid.remove(0);
    Object.assign(f, { x: w.creatures[0].x + 1, y: w.creatures[0].y });
    w.foodGrid.insert(0, f.x, f.y);
    w.foodGrid.remove(1);
    Object.assign(other, { x: (w.creatures[0].x + 300) % 800, y: w.creatures[0].y, energy: c.foodEnergy / 2 });
    w.foodGrid.insert(1, other.x, other.y);
    step(w);
    expect(w.creatures[0].foodEaten).toBeCloseTo(c.biteSize / c.foodEnergy);
    expect(f.active).toBe(true);
    expect(other.energy).toBeGreaterThan(c.foodEnergy / 2); // regrew a little
    for (let t = 0; t < 10; t++) step(w);
    expect(f.active).toBe(false); // grazed to nothing
  });
});
