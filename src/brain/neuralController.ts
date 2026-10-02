import type { Controller } from "../sim/controllers";
import type { ControllerFactory } from "../sim/world";
import type { Action } from "../sim/types";
import type { Genome } from "./genome";
import { Brain } from "./mlp";

/**
 * The only way prey act. Sensors go in, the genome's weights decide, turn and
 * thrust come out. There is no behavior code here, just the network.
 */
export class NeuralController implements Controller {
  readonly kind = "neural";
  readonly brain: Brain;

  constructor(readonly genome: Genome) {
    this.brain = new Brain(genome.shape, genome.genes.brain);
  }

  act(sensors: Float32Array, out: Action): void {
    const o = this.brain.forward(sensors);
    out.turn = o[0];
    out.thrust = (o[1] + 1) / 2;
  }
}

/** Controller factory that gives creature i the brain encoded by genomes[i]. */
export function neuralFactory(genomes: readonly Genome[]): ControllerFactory {
  return (creature, index) => {
    const g = genomes[index];
    if (!g) throw new Error(`No genome for creature ${index}`);
    creature.genomeId = g.id;
    return new NeuralController(g);
  };
}
