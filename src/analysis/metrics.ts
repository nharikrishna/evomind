import type { Creature } from "../sim/types";

/** Behavioral summary of one episode's population. */
export interface EpisodeMetrics {
  meanFood: number;
  /** Tick-weighted mean cos(bearing to food) while moving: ~0 random, ->1 food seeking. */
  alignment: number;
  /** Fraction of moving-with-food-in-sight ticks spent heading at the food. */
  towardFood: number;
  meanLifespan: number;
  survivors: number;
  meanSpeed: number;
}

export function episodeMetrics(creatures: readonly Creature[]): EpisodeMetrics {
  let food = 0, alignSum = 0, alignTicks = 0, toward = 0, life = 0, alive = 0, dist = 0;
  for (const c of creatures) {
    food += c.foodEaten;
    alignSum += c.alignmentSum;
    alignTicks += c.alignmentTicks;
    toward += c.ticksTowardFood;
    life += c.age;
    dist += c.distanceTraveled;
    if (c.alive) alive++;
  }
  const n = creatures.length || 1;
  return {
    meanFood: food / n,
    alignment: alignTicks ? alignSum / alignTicks : 0,
    towardFood: alignTicks ? toward / alignTicks : 0,
    meanLifespan: life / n,
    survivors: alive,
    meanSpeed: life ? dist / life : 0,
  };
}

/** Per-generation record: fitness stats plus behavior. */
export interface GenerationStats extends EpisodeMetrics {
  generation: number;
  best: number;
  mean: number;
  median: number;
  bestEver: number;
  /** Mean pairwise distance between brains; collapse toward 0 = everyone is a clone. */
  diversity: number;
}

/** Average a list of metric records field by field. */
export function averageMetrics(ms: readonly EpisodeMetrics[]): EpisodeMetrics {
  const keys = Object.keys(ms[0]) as (keyof EpisodeMetrics)[];
  const out = {} as EpisodeMetrics;
  for (const k of keys) out[k] = ms.reduce((s, m) => s + m[k], 0) / ms.length;
  return out;
}

export function fitnessSummary(fitness: readonly number[]): { best: number; mean: number; median: number } {
  const sorted = [...fitness].sort((a, b) => a - b);
  const n = sorted.length;
  return {
    best: sorted[n - 1],
    mean: sorted.reduce((s, f) => s + f, 0) / n,
    median: n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2,
  };
}
