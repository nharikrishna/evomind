import type { GenerationStats } from "./metrics";
import type { Genome } from "../brain/genome";

const COLUMNS: (keyof GenerationStats)[] = [
  "generation", "best", "mean", "median", "bestEver",
  "alignment", "towardFood", "meanFood", "meanLifespan", "survivors", "meanSpeed", "diversity",
];

export function historyToCSV(history: readonly GenerationStats[]): string {
  const rows = history.map((s) =>
    COLUMNS.map((k) => (Number.isInteger(s[k]) ? s[k] : s[k].toFixed(4))).join(","),
  );
  return [COLUMNS.join(","), ...rows].join("\n") + "\n";
}

/** Plain-JSON form of a genome (Float32Array -> number[]). */
export function genomeToJSON(g: Genome): object {
  return { ...g, genes: { brain: Array.from(g.genes.brain) } };
}

export function genomeFromJSON(o: any): Genome {
  return { ...o, genes: { brain: Float32Array.from(o.genes.brain) } };
}
