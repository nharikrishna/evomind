import type { Body } from "./body";

export type SpeciesId = "prey" | "predator";

export interface Creature {
  id: number;
  speciesId: SpeciesId;
  x: number;
  y: number;
  /** Radians, 0 = +x axis. */
  heading: number;
  speed: number;
  energy: number;
  alive: boolean;
  foodEaten: number;
  /** Ticks lived. */
  age: number;
  /** Genome driving this creature (null for scripted creatures). */
  genomeId: number | null;
  /** Physical traits and their energy consequences. */
  body: Body;
  /** Offspring produced (natural mode). */
  children: number;
  /** Biome the creature was in last tick (-1 = world has no biomes). */
  biome: number;
  /** Region (map area between barriers) it was in last tick (-1 = no biomes). */
  region: number;
  /** Recorded-only: lifetime energy spent on staying warm or cool. */
  thermalSpent: number;
  /** Neighbours within crowdRadius last tick (crowding). */
  crowding: number;
  /** Recorded-only: lifetime fruit eaten (in meals). */
  fruitEaten: number;

  // Recorded-only: these never feed back into behavior; they exist for analysis.
  distanceTraveled: number;
  energySpent: number;
  /** Sum of cos(bearing to food) over ticks where food was sensed and creature was moving. */
  alignmentSum: number;
  alignmentTicks: number;
  /** Ticks spent heading within ~25 degrees of the sensed food while moving. */
  ticksTowardFood: number;
}

export interface Food {
  id: number;
  x: number;
  y: number;
  /** Energy it holds. With plant biomass this is the plant's current size (grazed down, regrows). */
  energy: number;
  active: boolean;
  /** Local growth multiplier (fertility × biome), set when it sprouts. 1 for random food. */
  growth: number;
  /** Fruit: the tree it grows on (-1 for other food). */
  tree: number;
  /** Fruit: ticks since it ripened (it rots after fruitLife). */
  age: number;
}

/** What a controller decides each tick. The world clamps both values. */
export interface Action {
  /** -1 (full left) .. 1 (full right). */
  turn: number;
  /** 0 (stop) .. 1 (max speed). */
  thrust: number;
}
