import type { SimConfig } from "./config";

/**
 * Seasons: plant regrowth follows a sine wave over the year, from
 * 1 + amplitude (midsummer) down to 1 - amplitude (midwinter).
 * Creatures have no season sense; they only feel winter as hunger.
 */
export function seasonFactor(cfg: SimConfig, tick: number): number {
  if (cfg.seasonLength <= 0) return 1;
  return 1 + cfg.seasonAmplitude * Math.sin((2 * Math.PI * tick) / cfg.seasonLength);
}

export interface SeasonInfo {
  /** 0-based year number. */
  year: number;
  /** Position within the year, 0..1 (0 = spring, 0.25 = midsummer, 0.75 = midwinter). */
  phase: number;
  name: "Spring" | "Summer" | "Autumn" | "Winter";
  /** Growth below average (the shaded half of the year on charts). */
  lean: boolean;
}

export function seasonInfo(cfg: SimConfig, tick: number): SeasonInfo | null {
  if (cfg.seasonLength <= 0) return null;
  const y = tick / cfg.seasonLength;
  const phase = y - Math.floor(y);
  // Quarters centred on the growth peak (0.25) and trough (0.75).
  const name = phase < 0.125 || phase >= 0.875 ? "Spring" : phase < 0.375 ? "Summer" : phase < 0.625 ? "Autumn" : "Winter";
  return { year: Math.floor(y), phase, name, lean: phase >= 0.5 };
}
