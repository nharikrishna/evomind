import type { SimConfig } from "../sim/config";
import type { GenerationStats } from "../analysis/metrics";
import type { RunFile } from "../evo/generation";
import type { BrainShape } from "../brain/genome";

/**
 * What the main view is showing:
 * - evolve:  the live evolving population (or fast-forwarding it)
 * - best:    the best-ever (or a loaded) brain alone in a fresh world
 * - compare: generation 0 vs the current population on the same world
 */
export type SceneKind = "evolve" | "best" | "compare";

/** Per-creature floats in WorldSnap.creatures. */
export const CREATURE_STRIDE = 6;
export const C_X = 0, C_Y = 1, C_HEADING = 2, C_ENERGY = 3, C_ALIVE = 4, C_RELATIVE = 5;

export interface WorldSnap {
  label: string;
  width: number;
  height: number;
  tick: number;
  episodeTicks: number;
  sensorRange: number;
  count: number;
  alive: number;
  meanFood: number;
  /** count * CREATURE_STRIDE: x, y, heading, energy (0..1), alive (0/1), relative-of-selected (0/1). */
  creatures: Float32Array;
  /** Active food as x, y pairs. */
  food: Float32Array;
}

export interface SelectedSnap {
  view: number;
  index: number;
  alive: boolean;
  energy: number;
  speed: number;
  foodEaten: number;
  age: number;
  distanceTraveled: number;
  energySpent: number;
  alignment: number | null;
  genome: { id: number; generation: number; parentId: number | null } | null;
  /** Nearest-first ancestors, capped; `more` = how many older ones were cut. */
  ancestry: { id: number; generation: number }[];
  ancestryMore: number;
  relatives: number;
  brain: {
    shape: BrainShape;
    weights: Float32Array;
    inputs: Float32Array;
    hidden: Float32Array;
    outputs: Float32Array;
  } | null;
  /** Position of the food this creature currently senses. */
  sense: { x: number; y: number } | null;
}

export type ToWorker =
  | { t: "reset"; config: SimConfig }
  | { t: "frame"; ticks: number }
  | { t: "fast"; on: boolean; generations?: number }
  | { t: "scene"; scene: SceneKind }
  | { t: "select"; view: number; index: number | null }
  | { t: "export" }
  | { t: "import"; data: unknown };

export type FromWorker =
  | {
      t: "frame";
      scene: SceneKind;
      generation: number;
      views: WorldSnap[];
      selected: SelectedSnap | null;
      bestLabel: string | null;
    }
  | { t: "gen"; stats: GenerationStats }
  | { t: "history"; history: GenerationStats[]; config: SimConfig; generation: number }
  | { t: "fast"; on: boolean; generation: number }
  | { t: "scene"; scene: SceneKind }
  | { t: "export"; run: RunFile }
  | { t: "info"; message: string }
  | { t: "error"; message: string };
