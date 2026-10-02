/**
 * Headless evolution runner.
 *
 *   npm run evolve -- --gens 200 --seeds 1,2,3 --out runs
 *   npm run evolve -- --bodies                      (evolvable bodies + energy-surplus fitness)
 *   npm run evolve -- --bodies --set costSpeed=0.05,mutationRate=0.15
 *
 * For each seed: evolves a population, prints progress, then runs the Phase 3
 * proof (random baseline vs evolved vs blindfolded) on unseen worlds and writes
 * history.csv, best.json and proof.json to <out>/seed-<n>/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BODIES_PRESET, makeConfig, type SimConfig } from "../src/sim/config";
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
const bodies = process.argv.includes("--bodies");

/** --set key=value,key=value overrides any numeric/boolean config field. */
function overrides(): Partial<SimConfig> {
  const out: Record<string, number | boolean> = {};
  const raw = arg("set", "");
  for (const pair of raw ? raw.split(",") : []) {
    const [k, v] = pair.split("=");
    out[k] = v === "true" ? true : v === "false" ? false : Number(v);
  }
  return out as Partial<SimConfig>;
}

const f = (x: number, d = 2) => x.toFixed(d).padStart(6);

interface Verdict { seed: number; report: ProofReport; pass: boolean }
const verdicts: Verdict[] = [];

for (const seed of seeds) {
  const config = makeConfig({ seed, ...(bodies ? BODIES_PRESET : {}), ...overrides() });
  const evo = new Evolution(config);
  const t0 = performance.now();
  console.log(`\n=== seed ${seed}: ${gens} generations ===`);
  console.log("   gen    best    mean  median   align  toward   alive" + (bodies ? "   speed  sensor    size    turn" : ""));

  for (let g = 0; g < gens; g++) {
    const s = evo.runGeneration();
    if (g % every === 0 || g === gens - 1) {
      console.log(
        `${String(s.generation).padStart(6)}  ${f(s.best, 1)}  ${f(s.mean)}  ${f(s.median, 1)}  ${f(s.alignment)}  ${f(s.towardFood)}  ${String(s.survivors).padStart(6)}` +
          (bodies ? `  ${f(s.maxSpeedMean)}  ${f(s.sensorRangeMean, 0)}  ${f(s.sizeMean)}  ${f(s.turnRateMean, 3)}` : ""),
      );
    }
  }
  const secs = (performance.now() - t0) / 1000;
  console.log(`(${secs.toFixed(1)}s, ${(secs / gens * 1000).toFixed(0)} ms/gen)`);

  const report = proofReport(config, evo.population, evalEpisodes);
  // Compare food eaten, not fitness: fitness can include energy terms and go negative.
  const base = report.randomBaseline.meanFood;
  const ratio = report.evolved.meanFood / base;
  const blindRatio = report.directionBlind.meanFood / base;
  const pass = ratio >= 3 && blindRatio < 1.5 && report.evolved.alignment > 0.3;

  console.log(`\n  proof on ${evalEpisodes} unseen worlds (mean food per creature):`);
  const line = (name: string, r: { meanFood: number; alignment: number }) =>
    console.log(`    ${name.padEnd(22)} ${f(r.meanFood)}  (${f(r.meanFood / base, 1)}x baseline)   alignment ${f(r.alignment)}`);
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
