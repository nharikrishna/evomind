import type { GenerationStats } from "./metrics";
import type { Genome } from "../brain/genome";

const COLUMNS: (keyof GenerationStats)[] = [
  "generation", "best", "mean", "median", "bestEver",
  "alignment", "towardFood", "meanFood", "meanLifespan", "survivors", "meanSpeed", "diversity",
  "maxSpeedMean", "maxSpeedSd", "sensorRangeMean", "sensorRangeSd",
  "sizeMean", "sizeSd", "turnRateMean", "turnRateSd",
];

export function historyToCSV(history: readonly GenerationStats[]): string {
  const rows = history.map((s) =>
    COLUMNS.map((k) => (Number.isInteger(s[k]) ? s[k] : s[k].toFixed(4))).join(","),
  );
  return [COLUMNS.join(","), ...rows].join("\n") + "\n";
}

/** Plain-JSON form of a genome (Float32Array -> number[]). */
export function genomeToJSON(g: Genome): object {
  const genes: Record<string, number[]> = { brain: Array.from(g.genes.brain) };
  if (g.genes.body) genes.body = Array.from(g.genes.body);
  return { ...g, genes };
}

export function genomeFromJSON(o: any): Genome {
  const genes: Genome["genes"] = { brain: Float32Array.from(o.genes.brain) };
  if (o.genes.body) genes.body = Float32Array.from(o.genes.body);
  return { ...o, genes };
}
