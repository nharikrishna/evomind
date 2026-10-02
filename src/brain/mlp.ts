import { brainWeightCount, type BrainShape } from "./genome";

/**
 * Feed-forward network evaluated straight from a flat weight array.
 *
 * Weight layout:
 *   W1 [hidden x inputs] (row-major) | b1 [hidden] | W2 [outputs x hidden] | b2 [outputs]
 *
 * Activations of the last forward pass are kept for the brain inspector.
 */
export class Brain {
  readonly hiddenAct: Float32Array;
  readonly outputAct: Float32Array;
  readonly lastInputs: Float32Array;

  constructor(readonly shape: BrainShape, readonly weights: Float32Array) {
    if (weights.length !== brainWeightCount(shape)) {
      throw new Error(`Brain expects ${brainWeightCount(shape)} weights, got ${weights.length}`);
    }
    this.hiddenAct = new Float32Array(shape.hidden);
    this.outputAct = new Float32Array(shape.outputs);
    this.lastInputs = new Float32Array(shape.inputs);
  }

  /** Runs the network; outputs are tanh in [-1, 1]. */
  forward(inputs: ArrayLike<number>): Float32Array {
    const { inputs: ni, hidden: nh, outputs: no } = this.shape;
    const w = this.weights;
    this.lastInputs.set(inputs as ArrayLike<number>);

    const b1 = nh * ni;
    for (let h = 0; h < nh; h++) {
      let sum = w[b1 + h];
      const row = h * ni;
      for (let i = 0; i < ni; i++) sum += w[row + i] * inputs[i];
      this.hiddenAct[h] = Math.tanh(sum);
    }

    const w2 = b1 + nh;
    const b2 = w2 + no * nh;
    for (let o = 0; o < no; o++) {
      let sum = w[b2 + o];
      const row = w2 + o * nh;
      for (let h = 0; h < nh; h++) sum += w[row + h] * this.hiddenAct[h];
      this.outputAct[o] = Math.tanh(sum);
    }
    return this.outputAct;
  }

  /** Weight from input i to hidden h. */
  w1(h: number, i: number): number {
    return this.weights[h * this.shape.inputs + i];
  }

  /** Weight from hidden h to output o. */
  w2(o: number, h: number): number {
    const { inputs: ni, hidden: nh } = this.shape;
    return this.weights[nh * ni + nh + o * nh + h];
  }
}
