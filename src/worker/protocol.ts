import type { SimConfig, SimMode } from "../sim/config";
import type { GenerationStats } from "../analysis/metrics";
import type { RunFile } from "../evo/generation";
import type { LabScore, NaturalRunFile, NaturalStats } from "../evo/natural";
import type { BrainShape } from "../brain/genome";

/**
 * What the main view is showing:
 * - evolve:  the live population (evolving generationally, or living naturally)
 * - best:    the best-ever / most prolific (or a loaded) genome alone in a fresh world
 * - compare: random brains vs the current population on the same world
 */
export type SceneKind = "evolve" | "best" | "compare";

/** Per-creature floats in WorldSnap.creatures. */
export const CREATURE_STRIDE = 10;
export const C_X = 0, C_Y = 1, C_HEADING = 2, C_ENERGY = 3, C_ALIVE = 4, C_RELATIVE = 5, C_SIZE = 6,
  /** Stable creature id (populations change, so selection is by id, not index). */
  C_ID = 7,
  /** Clan: the ancestor a few generations back, used for family colouring. */
  C_FAMILY = 8,
  /** Age in ticks (newborns get a brief birth flash). */
  C_AGE = 9;

export interface WorldSnap {
  label: string;
  width: number;
  height: number;
  tick: number;
  episodeTicks: number;
  /** Natural worlds have no episode end. */
  endless: boolean;
  sensorRange: number;
  count: number;
  alive: number;
  meanFood: number;
  /** count * CREATURE_STRIDE, see the C_* offsets. */
  creatures: Float32Array;
  /** Active food as x, y pairs. */
  food: Float32Array;
}

export interface SelectedSnap {
  view: number;
  id: number;
  alive: boolean;
  energy: number;
  speed: number;
  foodEaten: number;
  age: number;
  children: number;
  distanceTraveled: number;
  energySpent: number;
  alignment: number | null;
  genome: { id: number; generation: number; parentId: number | null } | null;
  /** Nearest-first ancestors, capped; `more` = how many older ones were cut. */
  ancestry: { id: number; generation: number }[];
  ancestryMore: number;
  relatives: number;
  body: { maxSpeed: number; sensorRange: number; size: number; turnRate: number; basal: number; maxEnergy: number; evolved: boolean };
  lifeHistory: { reproThreshold: number; offspringShare: number } | null;
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
  /** amount = generations (lab) or ticks (natural) to fast-forward; omitted = until stopped. */
  | { t: "fast"; on: boolean; amount?: number }
  | { t: "scene"; scene: SceneKind }
  | { t: "select"; view: number; id: number | null }
  | { t: "export" }
  | { t: "import"; data: unknown };

export type FromWorker =
  | {
      t: "frame";
      mode: SimMode;
      scene: SceneKind;
      /** Lab: current generation. Natural: current tick. */
      generation: number;
      tick: number;
      views: WorldSnap[];
      selected: SelectedSnap | null;
    }
  // Lab mode
  | { t: "gen"; stats: GenerationStats }
  | { t: "history"; history: GenerationStats[]; config: SimConfig; generation: number }
  // Natural mode
  | { t: "nstats"; stats: NaturalStats[]; labScores: LabScore[]; labBaseline: number | null }
  | { t: "nhistory"; stats: NaturalStats[]; labScores: LabScore[]; labBaseline: number | null; config: SimConfig; tick: number }
  // Both
  | { t: "fast"; on: boolean; generation: number }
  | { t: "scene"; scene: SceneKind }
  | { t: "export"; run: RunFile | NaturalRunFile }
  | { t: "info"; message: string }
  | { t: "error"; message: string };
