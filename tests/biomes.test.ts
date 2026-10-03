import { describe, expect, it } from "vitest";
import { makeConfig, NATURAL_PRESET } from "../src/sim/config";
import { BiomeMap, BIOMES } from "../src/sim/biomes";
import { createWorld, step } from "../src/sim/world";
import { preySensorCount, preySensorLabels } from "../src/sim/sensors";
import type { Controller } from "../src/sim/controllers";
import { NaturalEvolution } from "../src/evo/natural";

const TUNDRA = 0, FOREST = 1, SWAMP = 3;

/** Find a point well inside a region of the given biome (all 8 neighbours same biome). */
function interior(map: BiomeMap, biome: number): { x: number; y: number } {
  for (let y = 30; y < map.height - 30; y += 7) {
    for (let x = 30; x < map.width - 30; x += 7) {
      const ok = [-25, 0, 25].every((dx) => [-25, 0, 25].every((dy) => map.at(x + dx, y + dy) === biome));
      if (ok) return { x, y };
    }
  }
  throw new Error(`no interior point for biome ${biome}`);
}

describe("biome map", () => {
  it("covers every biome and is seed-determined", () => {
    const cfg = makeConfig({ biomes: true });
    const a = new BiomeMap(800, 600, cfg), b = new BiomeMap(800, 600, cfg);
    expect(Array.from(a.cells)).toEqual(Array.from(b.cells));
    const cover = a.coverage();
    expect(cover.every((c) => c > 0)).toBe(true);
    expect(cover.reduce((s, c) => s + c, 0)).toBeCloseTo(1);
  });

  it("adds 4 one-hot biome inputs when biomeSense is on", () => {
    expect(preySensorCount(makeConfig({ biomeSense: true }))).toBe(8);
    expect(preySensorLabels(makeConfig({ biomeSense: true, senseSpeed: true }))).toHaveLength(9);
  });
});

describe("biome effects", () => {
  const go: Controller = { kind: "scripted", act: (_s, o) => { o.turn = 0; o.thrust = 1; } };
  const cfg = makeConfig({ biomes: true, creatureCount: 1, foodCount: 0, biomeRegions: 4 });

  function costIn(biome: number, extra = {}): number {
    const c = { ...cfg, ...extra };
    const w = createWorld(c, () => go, { enforceNeuralPrey: false });
    const p = interior(w.biomeMap!, biome);
    Object.assign(w.creatures[0], p);
    step(w);
    expect(w.creatures[0].biome).toBe(biome);
    return w.creatures[0].energySpent;
  }

  it("tundra adds heat-loss upkeep proportional to size; swamp makes moving dearer", () => {
    const grass = costIn(2);
    expect(costIn(TUNDRA) - grass).toBeCloseTo(cfg.coldCost * 1, 6);
    const move = cfg.moveCost * cfg.maxSpeed ** 2;
    expect(costIn(SWAMP) - grass).toBeCloseTo(move * (cfg.mudFactor - 1), 6);
  });

  it("forest fog shortens how far a creature can sense food", () => {
    const c = { ...cfg, foodCount: 1, respawnRate: 0 };
    const w = createWorld(c, () => go, { enforceNeuralPrey: false });
    const p = interior(w.biomeMap!, FOREST);
    Object.assign(w.creatures[0], { ...p, heading: 0 });
    // Food at 150px: inside the 200px body range, outside the fogged 100px range.
    w.foodGrid.remove(0);
    Object.assign(w.food[0], { x: p.x, y: p.y + 150 });
    w.foodGrid.insert(0, w.food[0].x, w.food[0].y);
    step(w);
    expect(w.nearestFood[0]).toBe(-1);
    expect(BIOMES[FOREST].fog).toBe(true);
  });

  it("barriers stop crossings; children are born on the parent's side", () => {
    const nat = new NaturalEvolution(makeConfig({ ...NATURAL_PRESET, biomes: true, biomeRegions: 4, biomeCrossing: 0, creatureCount: 60, labTestEvery: 0, seasonLength: 0 }));
    const home = new Map(nat.world.creatures.map((c) => [c.id, nat.world.biomeMap!.at(c.x, c.y)]));
    let crossings = 0;
    for (let t = 0; t < 2000; t++) {
      nat.step();
      for (const c of nat.world.creatures) {
        const b = nat.world.biomeMap!.at(c.x, c.y);
        const h = home.get(c.id);
        if (h === undefined) home.set(c.id, b); // newborn: remember birth biome
        else if (h !== b) crossings++;
      }
    }
    expect(crossings).toBe(0);
  });
});
