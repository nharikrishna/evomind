import type { GenerationStats } from "./metrics";
import type { Genome } from "../brain/genome";

const COLUMNS: (keyof GenerationStats)[] = [
  "generation", "best", "mean", "median", "bestEver",
  "alignment", "towardFood", "meanFood", "meanLifespan", "survivors", "meanSpeed", "diversity",
  "maxSpeedMean", "maxSpeedSd", "sensorRangeMean", "sensorRangeSd",
  "sizeMean", "sizeSd", "turnRateMean", "turnRateSd", "insulationMean", "insulationSd",
];

export function historyToCSV(history: readonly GenerationStats[]): string {
  const rows = history.map((s) =>
    COLUMNS.map((k) => (Number.isInteger(s[k]) ? s[k] : s[k].toFixed(4))).join(","),
  );
  return [COLUMNS.join(","), ...rows].join("\n") + "\n";
}

/** Plain-JSON form of a genome (Float32Array -> number[]). */
export function genomeToJSON(g: Genome): object {
  const genes: Record<string, number[]> = {};
  for (const [k, v] of Object.entries(g.genes)) if (v) genes[k] = Array.from(v);
  return { ...g, genes };
}

export function genomeFromJSON(o: any): Genome {
  const genes: Record<string, Float32Array> = {};
  for (const [k, v] of Object.entries(o.genes as Record<string, number[]>)) genes[k] = Float32Array.from(v);
  return { ...o, genes: genes as Genome["genes"] };
}
