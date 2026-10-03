import type { SimConfig } from "./config";
import type { Rng } from "./rng";
import { geneForTrait, traitFromGene } from "./body";

/**
 * Life-history genes (natural mode): when to breed and how much to invest in
 * each child. Together they allow r/K strategies, from many cheap children
 * (breed early, small share) to few strong ones (breed when rich, big share).
 */
export type ReproKey = "reproThreshold" | "offspringShare";

export interface ReproSpec {
  key: ReproKey;
  label: string;
  min: number;
  max: number;
  unit: string;
  default: number;
}

export const REPRO_TRAITS: readonly ReproSpec[] = [
  { key: "reproThreshold", label: "Breeding threshold", min: 0.3, max: 0.95, unit: "of energy store", default: 0.7 },
  { key: "offspringShare", label: "Offspring share", min: 0.1, max: 0.7, unit: "of parent energy", default: 0.4 },
];

export interface LifeHistory {
  /** Breed once energy >= this fraction of the energy store. */
  reproThreshold: number;
  /** Fraction of current energy handed to each child. */
  offspringShare: number;
}

export function decodeRepro(genes: Float32Array): LifeHistory {
  return {
    reproThreshold: traitFromGene(REPRO_TRAITS[0], genes[0]),
    offspringShare: traitFromGene(REPRO_TRAITS[1], genes[1]),
  };
}

export function randomReproGenes(cfg: SimConfig, rng: Rng): Float32Array {
  return Float32Array.from(REPRO_TRAITS, (t) => geneForTrait(t, t.default) + rng.gaussian() * cfg.bodyInitSigma);
}
