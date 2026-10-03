/**
 * Run independent experiment jobs (e.g. one per seed × variant) across CPU cores.
 *
 * The calling script re-launches itself once per job with `--job <i>`; each child
 * runs `run(i)` and prints its JSON result; the parent collects them in order and
 * calls `done(results)`. Usage inside an experiment script:
 *
 *   await parallel(jobs.length, (i) => runJob(jobs[i]), (results) => summarize(results));
 */
import { spawn } from "node:child_process";
import { cpus } from "node:os";

const MARK = "@@EVOMIND_RESULT@@";

export async function parallel<R>(
  count: number,
  run: (i: number) => R,
  done: (results: R[]) => void,
  maxWorkers = Math.max(1, cpus().length - 2),
): Promise<void> {
  const flag = process.argv.indexOf("--job");
  if (flag >= 0) {
    const i = Number(process.argv[flag + 1]);
    process.stdout.write(`\n${MARK}${JSON.stringify(run(i))}\n`);
    return;
  }

  const results: R[] = new Array(count);
  const t0 = performance.now();
  let next = 0, finished = 0;
  const workers = Math.min(maxWorkers, count);
  console.error(`running ${count} jobs on ${workers} cores…`);

  await new Promise<void>((resolve, reject) => {
    const launch = () => {
      if (next >= count) return;
      const i = next++;
      // Same node binary and loader flags (tsx) as this process; same script and args.
      const child = spawn(process.execPath, [...process.execArgv, process.argv[1], ...process.argv.slice(2), "--job", String(i)], {
        stdio: ["ignore", "pipe", "inherit"],
      });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.on("close", (code) => {
        const line = out.split("\n").find((l) => l.startsWith(MARK));
        if (code !== 0 || !line) return reject(new Error(`job ${i} failed (exit ${code})\n${out}`));
        results[i] = JSON.parse(line.slice(MARK.length));
        finished++;
        console.error(`  job ${i + 1}/${count} done (${((performance.now() - t0) / 1000).toFixed(0)}s)`);
        if (finished === count) resolve();
        else launch();
      });
    };
    for (let w = 0; w < workers; w++) launch();
  });
  done(results);
}
