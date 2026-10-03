import { DEFAULT_CONFIG, REALISM_PRESET, type SimConfig } from "../sim/config";
import type { GenerationStats } from "../analysis/metrics";
import { historyToCSV } from "../analysis/history";
import type { FromWorker, SceneKind, ToWorker } from "../worker/protocol";
import { Renderer } from "./renderer";
import { BrainView } from "./brainView";
import { LineChart } from "./chart";
import { SettingsForm } from "./settings";
import { renderInspector } from "./inspector";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// Validated categorical slots (dark surface): 1 = blue, 2 = orange.
const SERIES_1 = "#3987e5";
const SERIES_2 = "#d95926";

// ---------- state ----------

/** The app starts with the most realistic setup; the lab setup is a few switches away in Settings. */
const APP_DEFAULTS: SimConfig = { ...DEFAULT_CONFIG, ...REALISM_PRESET };
let config: SimConfig = { ...APP_DEFAULTS };
let history: GenerationStats[] = [];
let generation = 0;
let scene: SceneKind = "evolve";
let fast = false;
let fastGoal: number | null = null;
let running = true;
let stepOnce = 0;
let pending = false;
let lastFrame: Extract<FromWorker, { t: "frame" }> | null = null;
let chartsDirty = true;

// ---------- worker ----------

const worker = new Worker(new URL("../worker/sim.worker.ts", import.meta.url), { type: "module" });
const send = (msg: ToWorker) => worker.postMessage(msg);

// ---------- elements ----------

const stage = $<HTMLDivElement>("stage");
const statusEl = $<HTMLSpanElement>("status");
const playBtn = $<HTMLButtonElement>("play");
const fastBtn = $<HTMLButtonElement>("fast");
const speedSel = $<HTMLSelectElement>("speed");
const inspectorEl = $<HTMLDivElement>("inspector");
const brainView = new BrainView($<HTMLCanvasElement>("brain"));
const toastEl = $<HTMLDivElement>("toast");
const sceneBtns = [...document.querySelectorAll<HTMLButtonElement>("[data-scene]")];

const fmt1 = (v: number) => v.toFixed(1);
const charts = [
  new LineChart($("c-fitness"), {
    title: "Fitness",
    subtitle: "food eaten per creature",
    series: [
      { key: "mean", label: "Average", color: SERIES_1 },
      { key: "best", label: "Best", color: SERIES_2 },
    ],
    format: (v) => (Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1)),
  }),
  new LineChart($("c-align"), {
    title: "Alignment",
    subtitle: "0 = ignores food, 1 = heads straight at it",
    series: [{ key: "alignment", label: "Alignment", color: SERIES_1 }],
    format: (v) => v.toFixed(2),
    yRange: [0, 1],
  }),
  new LineChart($("c-surv"), {
    title: "Survivors",
    subtitle: "alive at the end of the episode",
    series: [{ key: "survivors", label: "Survivors", color: SERIES_1 }],
    format: (v) => v.toFixed(0),
  }),
  new LineChart($("c-div"), {
    title: "Brain diversity",
    subtitle: "mean distance between brains; falling to 0 = clones",
    series: [{ key: "diversity", label: "Diversity", color: SERIES_1 }],
    format: fmt1,
  }),
  // Body traits: y-axes span each trait's full allowed range so drift toward a limit is visible.
  new LineChart($("c-speed"), {
    title: "Max speed",
    subtitle: "px/tick",
    series: [{ key: "maxSpeedMean", sdKey: "maxSpeedSd", label: "Max speed", color: SERIES_1 }],
    format: (v) => v.toFixed(1),
    yRange: [0.5, 4],
  }),
  new LineChart($("c-sensor"), {
    title: "Sensor range",
    subtitle: "px",
    series: [{ key: "sensorRangeMean", sdKey: "sensorRangeSd", label: "Sensor range", color: SERIES_1 }],
    format: (v) => v.toFixed(0),
    yRange: [50, 400],
  }),
  new LineChart($("c-size"), {
    title: "Size",
    subtitle: "× default",
    series: [{ key: "sizeMean", sdKey: "sizeSd", label: "Size", color: SERIES_1 }],
    format: (v) => v.toFixed(2),
    yRange: [0.5, 2],
  }),
  new LineChart($("c-turn"), {
    title: "Turn rate",
    subtitle: "degrees/tick",
    series: [{ key: "turnRateMean", sdKey: "turnRateSd", label: "Turn rate", color: SERIES_1 }],
    format: (v) => v.toFixed(0),
    scale: 180 / Math.PI,
    yRange: [(0.05 * 180) / Math.PI, (0.4 * 180) / Math.PI],
  }),
];

const settings = new SettingsForm($<HTMLFormElement>("settings"), (cfg) => {
  config = cfg;
  send({ t: "reset", config: cfg });
  toast("Restarted with new settings.");
}, APP_DEFAULTS);
settings.load(config);

// ---------- stage views ----------

interface ViewEls {
  root: HTMLDivElement;
  label: HTMLSpanElement;
  meta: HTMLSpanElement;
  overlay: HTMLDivElement;
  renderer: Renderer;
}
let views: ViewEls[] = [];

function ensureViews(n: number): void {
  if (views.length === n) return;
  stage.replaceChildren();
  stage.classList.toggle("two", n === 2);
  views = Array.from({ length: n }, (_, k) => {
    const root = document.createElement("div");
    root.className = "view";
    const head = document.createElement("div");
    head.className = "view-head";
    const label = document.createElement("span");
    const meta = document.createElement("span");
    meta.className = "meta";
    head.append(label, meta);
    const wrap = document.createElement("div");
    wrap.className = "view-canvas-wrap";
    const canvas = document.createElement("canvas");
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.hidden = true;
    wrap.append(canvas, overlay);
    root.append(head, wrap);
    stage.append(root);
    const renderer = new Renderer(canvas);
    canvas.addEventListener("click", (ev) => {
      const snap = lastFrame?.views[k];
      if (!snap) return;
      send({ t: "select", view: k, index: renderer.pick(snap, ev) });
    });
    return { root, label, meta, overlay, renderer };
  });
}

// ---------- rendering ----------

function drawFrame(f: Extract<FromWorker, { t: "frame" }>): void {
  ensureViews(f.views.length);
  f.views.forEach((snap, k) => {
    const v = views[k];
    const sel = f.selected && f.selected.view === k ? f.selected : null;
    v.renderer.draw(snap, sel ? sel.index : null, sel ? sel.sense : null, sel?.body.sensorRange);
    v.label.textContent = f.scene === "evolve" ? `Generation ${f.generation}` : snap.label;
    v.meta.textContent = `tick ${snap.tick}/${snap.episodeTicks} · alive ${snap.alive}/${snap.count} · avg food ${snap.meanFood.toFixed(1)}`;
    v.overlay.hidden = !(fast && k === 0);
    if (fast && k === 0) {
      v.overlay.replaceChildren();
      const line = document.createElement("div");
      line.textContent = `Fast-forwarding… generation ${generation}`;
      const sub = document.createElement("small");
      sub.textContent = fastGoal !== null ? `${Math.max(0, fastGoal - generation)} to go` : "press Stop to watch again";
      v.overlay.append(line, sub);
    }
  });
  renderInspector(inspectorEl, f.selected);
  if (f.selected?.brain) brainView.draw(f.selected.brain);
  else brainView.clear();
}

function updateBodySection(): void {
  $("body-section").hidden = !config.evolveBodies;
  charts[0].setSubtitle(
    config.energyWeight > 0 ? "food eaten minus energy burned, in food units" : "food eaten per creature",
  );
}

function updateTiles(): void {
  const last = history[history.length - 1];
  $("t-gen").textContent = String(generation);
  $("t-mean").textContent = last ? last.mean.toFixed(1) : "–";
  $("t-best").textContent = last ? last.best.toFixed(0) : "–";
  $("t-ever").textContent = last ? last.bestEver.toFixed(0) : "–";
  $("t-align").textContent = last ? last.alignment.toFixed(2) : "–";
  $("t-surv").textContent = last ? `${last.survivors}/${config.creatureCount}` : "–";
}

function updateStatus(): void {
  let text: string;
  if (fast) text = `Fast-forwarding · generation ${generation}`;
  else if (scene === "best") text = running ? "Watching the best organism" : "Paused";
  else if (scene === "compare") text = running ? `Generation 0 vs generation ${generation}` : "Paused";
  else text = running ? `Evolving · generation ${generation}` : "Paused";
  statusEl.textContent = text;
  statusEl.classList.toggle("busy", fast);
  fastBtn.textContent = fast ? "Stop" : "Fast-forward";
  fastBtn.classList.toggle("on", fast);
  playBtn.textContent = running ? "Pause" : "Play";
  for (const b of sceneBtns) b.classList.toggle("active", b.dataset.scene === scene);
}

let toastTimer = 0;
function toast(message: string, error = false): void {
  toastEl.textContent = message;
  toastEl.classList.toggle("error", error);
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toastEl.hidden = true), error ? 6000 : 3500);
}

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- worker messages ----------

worker.onmessage = (ev: MessageEvent<FromWorker>) => {
  const m = ev.data;
  switch (m.t) {
    case "frame":
      pending = false;
      lastFrame = m;
      generation = m.generation;
      drawFrame(m);
      break;
    case "gen":
      history.push(m.stats);
      generation = m.stats.generation + 1;
      chartsDirty = true;
      updateTiles();
      updateStatus();
      break;
    case "history":
      history = [...m.history];
      config = m.config;
      generation = m.generation;
      settings.load(config);
      updateBodySection();
      chartsDirty = true;
      updateTiles();
      updateStatus();
      break;
    case "fast":
      fast = m.on;
      generation = m.generation;
      if (!fast) fastGoal = null;
      updateStatus();
      break;
    case "scene":
      scene = m.scene;
      updateStatus();
      break;
    case "export":
      download(`evomind-seed${m.run.config.seed}-gen${m.run.generation}.json`, JSON.stringify(m.run), "application/json");
      break;
    case "info":
      toast(m.message);
      break;
    case "error":
      pending = false;
      toast(m.message, true);
      break;
  }
};
worker.onerror = (e) => toast(`Simulation error: ${e.message}`, true);

// ---------- main loop ----------

function loop(): void {
  if (!pending) {
    pending = true;
    const ticks = fast ? 0 : running ? Number(speedSel.value) : stepOnce;
    stepOnce = 0;
    send({ t: "frame", ticks });
  }
  if (chartsDirty) {
    for (const c of charts) c.setData(history);
    chartsDirty = false;
  }
  for (const c of charts) c.render();
  requestAnimationFrame(loop);
}

// ---------- controls ----------

function togglePlay(): void {
  running = !running;
  updateStatus();
}
playBtn.addEventListener("click", togglePlay);
$("step").addEventListener("click", () => {
  running = false;
  stepOnce = 1;
  updateStatus();
});
for (const b of sceneBtns) {
  b.addEventListener("click", () => send({ t: "scene", scene: b.dataset.scene as SceneKind }));
}
fastBtn.addEventListener("click", () => {
  fastGoal = null;
  send({ t: "fast", on: !fast });
});
for (const [id, n] of [["skip10", 10], ["skip100", 100]] as const) {
  $(id).addEventListener("click", () => {
    fastGoal = generation + n;
    send({ t: "fast", on: true, generations: n });
  });
}
$("save").addEventListener("click", () => send({ t: "export" }));
$("csv").addEventListener("click", () => {
  if (!history.length) return toast("No generations finished yet.");
  download(`evomind-seed${config.seed}-history.csv`, historyToCSV(history), "text/csv");
});
const fileInput = $<HTMLInputElement>("file");
$("load").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (!file) return;
  try {
    send({ t: "import", data: JSON.parse(await file.text()) });
  } catch {
    toast("That file isn't valid JSON.", true);
  }
});
document.addEventListener("keydown", (e) => {
  const tag = (e.target as HTMLElement).tagName;
  if (e.code === "Space" && tag !== "INPUT" && tag !== "SELECT" && tag !== "BUTTON") {
    e.preventDefault();
    togglePlay();
  }
});

send({ t: "reset", config });
updateBodySection();
updateTiles();
updateStatus();
requestAnimationFrame(loop);
