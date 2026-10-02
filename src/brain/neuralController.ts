import type { Controller } from "../sim/controllers";
import type { ControllerFactory } from "../sim/world";
import type { Action, Creature } from "../sim/types";
import type { SimConfig } from "../sim/config";
import { bodyFromGenes } from "../sim/body";
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

/** Bind a genome to a creature: record its id and grow its evolved body (if any). */
export function attachGenome(creature: Creature, g: Genome, config: SimConfig): void {
  creature.genomeId = g.id;
  if (g.genes.body) creature.body = bodyFromGenes(g.genes.body, config);
}

/** Controller factory that gives creature i the brain and body encoded by genomes[i]. */
export function neuralFactory(genomes: readonly Genome[]): ControllerFactory {
  return (creature, index, _rng, config) => {
    const g = genomes[index];
    if (!g) throw new Error(`No genome for creature ${index}`);
    attachGenome(creature, g, config);
    return new NeuralController(g);
  };
}
