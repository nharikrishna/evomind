import type { SimConfig } from "./config";
import type { Rng } from "./rng";

/**
 * Evolvable body traits. Each gene is an unbounded real number squashed into the
 * trait's allowed range with a sigmoid, so mutation can never push a trait out of
 * bounds and small nudges near the edges have diminishing effect.
 */
export interface TraitSpec {
  key: TraitKey;
  label: string;
  min: number;
  max: number;
  unit: string;
}

export type TraitKey = "maxSpeed" | "sensorRange" | "size" | "turnRate" | "insulation" | "diet";

export const TRAITS: readonly TraitSpec[] = [
  { key: "maxSpeed", label: "Max speed", min: 0.5, max: 4, unit: "px/tick" },
  { key: "sensorRange", label: "Sensor range", min: 50, max: 400, unit: "px" },
  { key: "size", label: "Size", min: 0.5, max: 2, unit: "×" },
  { key: "turnRate", label: "Turn rate", min: 0.05, max: 0.4, unit: "rad/tick" },
  // Fur / fat. Only matters (and only costs) when temperature is on.
  { key: "insulation", label: "Insulation", min: 0, max: 1, unit: "" },
  // Digestion: 0 = grazer (grass), 1 = fruit-eater. Only matters when fruit exists.
  { key: "diet", label: "Diet", min: 0, max: 1, unit: "" },
];

/** A creature's physical makeup plus the per-tick consequences derived from it. */
export interface Body {
  maxSpeed: number;
  sensorRange: number;
  size: number;
  turnRate: number;
  /** Fur / fat, 0..1: keeps heat in (good in cold, bad in heat). */
  insulation: number;
  /** Digestion, 0 = grazer .. 1 = fruit-eater. */
  diet: number;
  /** Fraction of grass / fruit energy this gut extracts. */
  grassEff: number;
  fruitEff: number;
  /** Energy burned per tick just for having this body. */
  basal: number;
  eatRadius: number;
  /** Actual radians per tick at full turn (bigger bodies turn slower). */
  effTurn: number;
  /** Multiplier on movement cost (bigger bodies cost more to move). */
  moveFactor: number;
  /** Energy storage capacity. */
  maxEnergy: number;
  /** Max change in speed per tick (Infinity = instant). */
  accel: number;
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (p: number) => Math.log(p / (1 - p));

/** The body every creature had before Phase 4.5 (used when bodies don't evolve). */
export function defaultBody(cfg: SimConfig): Body {
  return {
    maxSpeed: cfg.maxSpeed,
    sensorRange: cfg.sensorRange,
    size: 1,
    turnRate: cfg.maxTurnRate,
    insulation: DEFAULT_INSULATION,
    ...digestion(DEFAULT_DIET),
    basal: cfg.basalCost,
    eatRadius: cfg.eatRadius,
    effTurn: cfg.maxTurnRate,
    moveFactor: 1,
    maxEnergy: cfg.maxEnergy,
    accel: cfg.acceleration > 0 ? cfg.acceleration : Infinity,
  };
}

/**
 * Starting insulation: a thin coat. Not 0, because a sigmoid gene sitting at the
 * very bottom of its range would barely respond to mutation.
 */
export const DEFAULT_INSULATION = 0.1;

/** Starting diet: mostly a grazer (grass was the only food before fruit). */
export const DEFAULT_DIET = 0.2;

/**
 * Digestion trade-off: a gut tuned to grass extracts little from fruit and vice
 * versa; a generalist gets moderate value from both.
 */
export function digestion(diet: number): { diet: number; grassEff: number; fruitEff: number } {
  return { diet, grassEff: 1 - 0.7 * diet, fruitEff: 0.3 + 0.7 * diet };
}

/** Trait value the default body has, for each trait. */
export function defaultTraitValue(key: TraitKey, cfg: SimConfig): number {
  switch (key) {
    case "size": return 1;
    case "maxSpeed": return cfg.maxSpeed;
    case "sensorRange": return cfg.sensorRange;
    case "turnRate": return cfg.maxTurnRate;
    case "insulation": return DEFAULT_INSULATION;
    case "diet": return DEFAULT_DIET;
  }
}

export function traitFromGene(spec: { min: number; max: number }, gene: number): number {
  return spec.min + (spec.max - spec.min) * sigmoid(gene);
}

/** Gene value that decodes to exactly `value` (inverse of traitFromGene). */
export function geneForTrait(spec: { min: number; max: number }, value: number): number {
  const p = (value - spec.min) / (spec.max - spec.min);
  return logit(Math.min(1 - 1e-6, Math.max(1e-6, p)));
}

/**
 * Decode body genes and price them. At the default trait values the costs add up
 * to the old fixed basalCost, so a "default" evolved body is no better or worse
 * off than a pre-4.5 creature.
 */
export function bodyFromGenes(genes: Float32Array, cfg: SimConfig): Body {
  const [maxSpeed, sensorRange, size, turnRate] = TRAITS.map((t, i) => traitFromGene(t, genes[i]));
  // Older genomes (saved before insulation existed) have 4 body genes.
  const insulation = genes.length > 4 ? traitFromGene(TRAITS[4], genes[4]) : DEFAULT_INSULATION;
  const diet = genes.length > 5 ? traitFromGene(TRAITS[5], genes[5]) : DEFAULT_DIET;
  const mass = size * size;
  // Kleiber's law: metabolic rate grows with mass^0.75, so big bodies are cheaper per unit mass.
  const metabolic = cfg.sizeScaling ? mass ** 0.75 : mass;
  const basal =
    cfg.costSize * metabolic +
    cfg.costSensor * (sensorRange / cfg.sensorRange) +
    // Top speed needs muscle, which costs energy to maintain whether used or not.
    // Power to overcome drag grows with speed cubed, and muscle mass with power.
    cfg.costSpeed * (maxSpeed / cfg.maxSpeed) ** 3 +
    cfg.costTurn * (turnRate / cfg.maxTurnRate) +
    // Growing and carrying fur/fat costs energy, but only matters with temperature.
    (cfg.temperature ? cfg.costInsulation * insulation : 0);
  return {
    maxSpeed,
    sensorRange,
    size,
    turnRate,
    insulation,
    ...digestion(diet),
    basal,
    eatRadius: cfg.eatRadius * size,
    effTurn: turnRate / size,
    moveFactor: cfg.sizeScaling ? mass ** 0.75 : size,
    maxEnergy: cfg.sizeScaling ? cfg.maxEnergy * mass : cfg.maxEnergy,
    accel: cfg.acceleration > 0 ? cfg.acceleration / mass : Infinity,
  };
}

/** Generation-0 body genes: the default body plus random variation. */
export function randomBodyGenes(cfg: SimConfig, rng: Rng): Float32Array {
  return Float32Array.from(TRAITS, (t) => geneForTrait(t, defaultTraitValue(t.key, cfg)) + rng.gaussian() * cfg.bodyInitSigma);
}
