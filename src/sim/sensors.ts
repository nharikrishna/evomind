import type { SimConfig } from "./config";
import type { Creature } from "./types";
import { torusDelta, wrapAngle } from "./math";
import { BIOMES } from "./biomes";

/**
 * Prey sensor layout. Everything is normalized to roughly [-1, 1].
 * Bearing is encoded as sin/cos so there's no discontinuity at +-PI.
 */
export const PREY_SENSORS = ["foodSin", "foodCos", "foodNear", "energy", "speed"] as const;

/**
 * Inputs a prey brain gets: the first four always; own speed with `senseSpeed`;
 * one-hot biome inputs with `biomeSense` (present even where the world has no
 * biome map, which then reads as grassland, so brains stay compatible).
 */
export function preySensorCount(cfg: SimConfig): number {
  return 4 + (cfg.senseSpeed ? 1 : 0) + (cfg.biomeSense ? BIOMES.length : 0)
    + (cfg.senseFoodAmount ? 4 : 0) + (cfg.senseCrowd ? 3 : 0);
}

/** Optional extra perceptions (each only used when its sense is switched on). */
export interface ExtraSenses {
  /** Energy in the nearest plant, as a fraction of a full plant (0 if none). */
  nearAmount: number;
  /** Richest plant in range (null if none). */
  rich: { x: number; y: number; amount: number } | null;
  /** Neighbours: count and mean offset towards them. */
  crowd: { n: number; dx: number; dy: number };
  /** Vegetation model: food where I stand (0..1); replaces "food near". */
  here?: number;
}

/** Human-readable input names, in order (for the brain view). */
export function preySensorLabels(cfg: SimConfig): string[] {
  const out = ["food L/R", "food ahead", "food near", "energy"];
  if (cfg.senseSpeed) out.push("own speed");
  if (cfg.biomeSense) out.push(...BIOMES.map((b) => `in ${b.name.toLowerCase()}`));
  if (cfg.senseFoodAmount) out.push("food amount", "richest L/R", "richest ahead", "richest amount");
  if (cfg.senseCrowd) out.push("crowding", "crowd L/R", "crowd ahead");
  return out;
}

/**
 * Fill `out` with the creature's view of the world. `foodIndex` is the nearest
 * food within sensor range (-1 if none); its coordinates come from foodX/foodY.
 */
export function sensePrey(
  c: Creature,
  foodIndex: number,
  foodX: number,
  foodY: number,
  distSq: number,
  cfg: SimConfig,
  out: Float32Array,
  /** Effective sensing range (body range, possibly shortened by fog). */
  range: number = c.body.sensorRange,
  /** Biome the creature is in (for the one-hot biome inputs). */
  biome = 0,
  extra: ExtraSenses | null = null,
): void {
  if (foodIndex >= 0) {
    const dx = torusDelta(c.x, foodX, cfg.width);
    const dy = torusDelta(c.y, foodY, cfg.height);
    const rel = wrapAngle(Math.atan2(dy, dx) - c.heading);
    out[0] = Math.sin(rel);
    out[1] = Math.cos(rel);
    out[2] = 1 - Math.sqrt(distSq) / range;
  } else {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
  }
  if (extra?.here !== undefined) out[2] = extra.here;
  out[3] = c.energy / c.body.maxEnergy;
  let k = 4;
  // Proprioception: how fast am I going, relative to my top speed?
  if (cfg.senseSpeed) out[k++] = c.speed / c.body.maxSpeed;
  if (cfg.biomeSense) for (let b = 0; b < BIOMES.length; b++) out[k++] = b === biome ? 1 : 0;
  if (cfg.senseFoodAmount) {
    out[k++] = extra ? extra.nearAmount : 0;
    if (extra?.rich) {
      const rel = wrapAngle(Math.atan2(torusDelta(c.y, extra.rich.y, cfg.height), torusDelta(c.x, extra.rich.x, cfg.width)) - c.heading);
      out[k++] = Math.sin(rel);
      out[k++] = Math.cos(rel);
      out[k++] = extra.rich.amount;
    } else {
      out[k++] = 0; out[k++] = 0; out[k++] = 0;
    }
  }
  if (cfg.senseCrowd) {
    const cr = extra?.crowd;
    out[k++] = cr ? Math.min(1, cr.n / (2 * cfg.crowdTolerance)) : 0;
    if (cr && cr.n > 0 && (cr.dx !== 0 || cr.dy !== 0)) {
      const rel = wrapAngle(Math.atan2(cr.dy, cr.dx) - c.heading);
      out[k++] = Math.sin(rel);
      out[k++] = Math.cos(rel);
    } else {
      out[k++] = 0; out[k++] = 0;
    }
  }
}
