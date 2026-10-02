import type { SimConfig } from "../sim/config";
import type { Creature } from "../sim/types";

/**
 * Prey fitness. Phase 3 default is pure food eaten. With energyWeight = 1 it is
 * the net energy surplus in food-equivalents: what you gathered minus what your
 * body and movement burned, which is what reproduction is made from in nature.
 */
export function preyFitness(c: Creature, cfg: SimConfig): number {
  return c.foodEaten + cfg.survivalBonus * c.age - (cfg.energyWeight * c.energySpent) / cfg.foodEnergy;
}
