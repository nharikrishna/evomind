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

export type TraitKey = "maxSpeed" | "sensorRange" | "size" | "turnRate";

export const TRAITS: readonly TraitSpec[] = [
  { key: "maxSpeed", label: "Max speed", min: 0.5, max: 4, unit: "px/tick" },
  { key: "sensorRange", label: "Sensor range", min: 50, max: 400, unit: "px" },
  { key: "size", label: "Size", min: 0.5, max: 2, unit: "×" },
  { key: "turnRate", label: "Turn rate", min: 0.05, max: 0.4, unit: "rad/tick" },
];

/** A creature's physical makeup plus the per-tick consequences derived from it. */
export interface Body {
  maxSpeed: number;
  sensorRange: number;
  size: number;
  turnRate: number;
  /** Energy burned per tick just for having this body. */
  basal: number;
  eatRadius: number;
  /** Actual radians per tick at full turn (bigger bodies turn slower). */
  effTurn: number;
  /** Multiplier on movement cost (bigger bodies cost more to move). */
  moveFactor: number;
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
    basal: cfg.basalCost,
    eatRadius: cfg.eatRadius,
    effTurn: cfg.maxTurnRate,
    moveFactor: 1,
  };
}

/** Trait value the default body has, for each trait. */
function defaultTraitValue(key: TraitKey, cfg: SimConfig): number {
  return key === "size" ? 1 : key === "maxSpeed" ? cfg.maxSpeed : key === "sensorRange" ? cfg.sensorRange : cfg.maxTurnRate;
}

export function traitFromGene(spec: TraitSpec, gene: number): number {
  return spec.min + (spec.max - spec.min) * sigmoid(gene);
}

/** Gene value that decodes to exactly `value` (inverse of traitFromGene). */
export function geneForTrait(spec: TraitSpec, value: number): number {
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
  const basal =
    cfg.costSize * size * size +
    cfg.costSensor * (sensorRange / cfg.sensorRange) +
    // Top speed needs muscle, which costs energy to maintain whether used or not.
    // Power to overcome drag grows with speed cubed, and muscle mass with power.
    cfg.costSpeed * (maxSpeed / cfg.maxSpeed) ** 3 +
    cfg.costTurn * (turnRate / cfg.maxTurnRate);
  return {
    maxSpeed,
    sensorRange,
    size,
    turnRate,
    basal,
    eatRadius: cfg.eatRadius * size,
    effTurn: turnRate / size,
    moveFactor: size,
  };
}

/** Generation-0 body genes: the default body plus random variation. */
export function randomBodyGenes(cfg: SimConfig, rng: Rng): Float32Array {
  return Float32Array.from(TRAITS, (t) => geneForTrait(t, defaultTraitValue(t.key, cfg)) + rng.gaussian() * cfg.bodyInitSigma);
}
