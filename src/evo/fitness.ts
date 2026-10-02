import type { SimConfig } from "../sim/config";
import type { Creature } from "../sim/types";

/** Prey fitness. Phase 3 default is pure food eaten (survivalBonus = 0). */
export function preyFitness(c: Creature, cfg: SimConfig): number {
  return c.foodEaten + cfg.survivalBonus * c.age;
}
