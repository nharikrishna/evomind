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
  return 4 + (cfg.senseSpeed ? 1 : 0) + (cfg.biomeSense ? BIOMES.length : 0);
}

/** Human-readable input names, in order (for the brain view). */
export function preySensorLabels(cfg: SimConfig): string[] {
  const out = ["food L/R", "food ahead", "food near", "energy"];
  if (cfg.senseSpeed) out.push("own speed");
  if (cfg.biomeSense) out.push(...BIOMES.map((b) => `in ${b.name.toLowerCase()}`));
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
  out[3] = c.energy / c.body.maxEnergy;
  let k = 4;
  // Proprioception: how fast am I going, relative to my top speed?
  if (cfg.senseSpeed) out[k++] = c.speed / c.body.maxSpeed;
  if (cfg.biomeSense) for (let b = 0; b < BIOMES.length; b++) out[k++] = b === biome ? 1 : 0;
}
