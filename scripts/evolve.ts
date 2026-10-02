/**
 * Headless evolution runner.
 *
 *   npm run evolve -- --gens 200 --seeds 1,2,3 --out runs
 *
 * For each seed: evolves a population, prints progress, then runs the Phase 3
 * proof (random baseline vs evolved vs blindfolded) on unseen worlds and writes
 * history.csv, best.json and proof.json to <out>/seed-<n>/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeConfig } from "../src/sim/config";
import { Evolution } from "../src/evo/generation";
import { proofReport, type ProofReport } from "../src/analysis/baselines";
import { genomeToJSON, historyToCSV } from "../src/analysis/history";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const gens = Number(arg("gens", "200"));
const seeds = arg("seeds", arg("seed", "1")).split(",").map(Number);
const outDir = arg("out", "runs");
const every = Number(arg("every", "10"));
const evalEpisodes = Number(arg("eval", "5"));

const f = (x: number, d = 2) => x.toFixed(d).padStart(6);

interface Verdict { seed: number; report: ProofReport; pass: boolean }
const verdicts: Verdict[] = [];

for (const seed of seeds) {
  const config = makeConfig({ seed });
  const evo = new Evolution(config);
  const t0 = performance.now();
  console.log(`\n=== seed ${seed}: ${gens} generations ===`);
  console.log("   gen    best    mean  median   align  toward   alive");

  for (let g = 0; g < gens; g++) {
    const s = evo.runGeneration();
    if (g % every === 0 || g === gens - 1) {
      console.log(
        `${String(s.generation).padStart(6)}  ${f(s.best, 1)}  ${f(s.mean)}  ${f(s.median, 1)}  ${f(s.alignment)}  ${f(s.towardFood)}  ${String(s.survivors).padStart(6)}`,
      );
    }
  }
  const secs = (performance.now() - t0) / 1000;
  console.log(`(${secs.toFixed(1)}s, ${(secs / gens * 1000).toFixed(0)} ms/gen)`);

  const report = proofReport(config, evo.population, evalEpisodes);
  const base = report.randomBaseline.meanFitness;
  const ratio = report.evolved.meanFitness / base;
  const blindRatio = report.directionBlind.meanFitness / base;
  const pass = ratio >= 3 && blindRatio < 1.5 && report.evolved.alignment > 0.3;

  console.log(`\n  proof on ${evalEpisodes} unseen worlds (mean food per creature):`);
  const line = (name: string, r: { meanFitness: number; alignment: number }) =>
    console.log(`    ${name.padEnd(22)} ${f(r.meanFitness)}  (${f(r.meanFitness / base, 1)}x baseline)   alignment ${f(r.alignment)}`);
  line("random brains", report.randomBaseline);
  line("evolved", report.evolved);
  line("evolved, dir-blind", report.directionBlind);
  line("evolved, fully blind", report.fullyBlind);
  console.log(`  verdict: ${pass ? "PASS" : "FAIL"} (need >=3x baseline, dir-blind <1.5x, alignment >0.3)`);
  verdicts.push({ seed, report, pass });

  const dir = join(outDir, `seed-${seed}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "history.csv"), historyToCSV(evo.history));
  writeFileSync(join(dir, "proof.json"), JSON.stringify(report, null, 2));
  writeFileSync(
    join(dir, "best.json"),
    JSON.stringify({ config, bestEver: evo.bestEver, genome: evo.bestEverGenome && genomeToJSON(evo.bestEverGenome) }, null, 2),
  );
}

if (verdicts.length > 1) {
  const passed = verdicts.filter((v) => v.pass).length;
  console.log(`\n=== ${passed}/${verdicts.length} seeds passed ===`);
}
