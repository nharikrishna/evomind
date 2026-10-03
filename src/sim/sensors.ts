import type { SimConfig } from "./config";
import type { Creature } from "./types";
import { torusDelta, wrapAngle } from "./math";

/**
 * Prey sensor layout. Everything is normalized to roughly [-1, 1].
 * Bearing is encoded as sin/cos so there's no discontinuity at +-PI.
 */
export const PREY_SENSORS = ["foodSin", "foodCos", "foodNear", "energy", "speed"] as const;

/** Inputs a prey brain gets: the first four always; own speed only with `senseSpeed`. */
export function preySensorCount(cfg: SimConfig): number {
  return cfg.senseSpeed ? 5 : 4;
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
): void {
  if (foodIndex >= 0) {
    const dx = torusDelta(c.x, foodX, cfg.width);
    const dy = torusDelta(c.y, foodY, cfg.height);
    const rel = wrapAngle(Math.atan2(dy, dx) - c.heading);
    out[0] = Math.sin(rel);
    out[1] = Math.cos(rel);
    out[2] = 1 - Math.sqrt(distSq) / c.body.sensorRange;
  } else {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
  }
  out[3] = c.energy / c.body.maxEnergy;
  // Proprioception: how fast am I going, relative to my top speed?
  if (out.length > 4) out[4] = c.speed / c.body.maxSpeed;
}
