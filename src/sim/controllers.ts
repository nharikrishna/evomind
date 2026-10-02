import type { Action } from "./types";

/**
 * Everything that moves does so through a Controller. The world never decides
 * how an organism behaves; it only applies physics to the Action returned here.
 *
 * - "neural":   genome-driven brain (src/brain/neuralController.ts). The ONLY kind allowed for prey.
 * - "scripted": hand-written behavior. Reserved for Phase 5 predators and for physics tests.
 */
export interface Controller {
  readonly kind: "neural" | "scripted";
  act(sensors: Float32Array, out: Action): void;
}
