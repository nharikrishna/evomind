import type { Rng } from "../sim/rng";

/** Uniform crossover: each weight comes from parent a or b with equal chance. */
export function uniformCrossover(a: Float32Array, b: Float32Array, rng: Rng): Float32Array {
  if (a.length !== b.length) throw new Error("Crossover parents differ in size");
  const child = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) child[i] = rng.next() < 0.5 ? a[i] : b[i];
  return child;
}
