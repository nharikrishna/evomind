import {
  BODIES_PRESET, DEFAULT_CONFIG, NATURAL_PRESET, REALISM_PRESET, type SimConfig,
} from "../sim/config";
import type { GenerationStats } from "../analysis/metrics";
import type { LabScore, NaturalStats } from "../evo/natural";
import { historyToCSV } from "../analysis/history";
import type { FromWorker, SceneKind, ToWorker } from "../worker/protocol";
import { Renderer, type ColorMode } from "./renderer";
import { BrainView } from "./brainView";
import { LineChart, X_GENERATION, X_TICK, type Row } from "./chart";
import { SettingsForm, type Preset } from "./settings";
import { renderInspector } from "./inspector";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// Validated categorical slots (dark surface): 1 = blue, 2 = orange.
const SERIES_1 = "#3987e5";
const SERIES_2 = "#d95926";

const PRESETS: Preset[] = [
  { name: "Natural (default)", config: { ...DEFAULT_CONFIG, ...NATURAL_PRESET } },
  { name: "Lab: bodies + realism", config: { ...DEFAULT_CONFIG, ...REALISM_PRESET } },
  { name: "Lab: bodies only", config: { ...DEFAULT_CONFIG, ...BODIES_PRESET } },
  { name: "Lab: classic (Phase 3)", config: { ...DEFAULT_CONFIG } },
];

// ---------- state ----------

let config: SimConfig = { ...PRESETS[0].config };
let history: GenerationStats[] = [];
let natRows: Row[] = [];
let labRows: Row[] = [];
let labBaseline: number | null = null;
let progress = 0; // lab: generation; natural: tick
let scene: SceneKind = "evolve";
let fast = false;
let fastGoal: number | null = null;
let running = true;
let stepOnce = 0;
let pending = false;
let lastFrame: Extract<FromWorker, { t: "frame" }> | null = null;
let chartsDirty = true;
let colorMode: ColorMode = "energy";
const natural = () => config.mode === "natural";

// ---------- worker ----------

const worker = new Worker(new URL("../worker/sim.worker.ts", import.meta.url), { type: "module" });
const send = (msg: ToWorker) => worker.postMessage(msg);

// ---------- elements ----------

const stage = $<HTMLDivElement>("stage");
const statusEl = $<HTMLSpanElement>("status");
const playBtn = $<HTMLButtonElement>("play");
const fastBtn = $<HTMLButtonElement>("fast");
const skip10 = $<HTMLButtonElement>("skip10");
const skip100 = $<HTMLButtonElement>("skip100");
const speedSel = $<HTMLSelectElement>("speed");
const colorSel = $<HTMLSelectElement>("color");
const inspectorEl = $<HTMLDivElement>("inspector");
const brainView = new BrainView($<HTMLCanvasElement>("brain"));
const toastEl = $<HTMLDivElement>("toast");
const sceneBtns = [...document.querySelectorAll<HTMLButtonElement>("[data-scene]")];

const fmt1 = (v: number) => v.toFixed(1);
const fmtTicks = X_TICK.format;
const deg = 180 / Math.PI;

// Lab-mode charts (x = generation)
const fitnessChart = new LineChart($("c-fitness"), {
  title: "Fitness",
  subtitle: "food eaten per creature",
  series: [
    { key: "mean", label: "Average", color: SERIES_1 },
    { key: "best", label: "Best", color: SERIES_2 },
  ],
  format: (v) => (Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1)),
});
const labCharts = [
  fitnessChart,
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
];

// Natural-mode charts (x = tick)
const labScoreChart = new LineChart($("c-lab"), {
  title: "Lab test score",
  subtitle: "food per creature in a standard test world",
  series: [
    { key: "meanFood", label: "Living population", color: SERIES_1 },
    { key: "baseline", label: "Random brains", color: SERIES_2 },
  ],
  format: fmt1,
});
const natCharts = [
  new LineChart($("c-pop"), {
    title: "Population",
    subtitle: "creatures alive",
    series: [{ key: "population", label: "Population", color: SERIES_1 }],
    format: (v) => v.toFixed(0),
  }),
  new LineChart($("c-births"), {
    title: "Births and deaths",
    subtitle: "per 1,000 ticks",
    series: [
      { key: "birthsK", label: "Births", color: SERIES_1 },
      { key: "deathsK", label: "Deaths", color: SERIES_2 },
    ],
    format: (v) => v.toFixed(0),
  }),
  new LineChart($("c-gen"), {
    title: "Generations of descent",
    subtitle: "how many parent-child steps from the founders",
    series: [
      { key: "meanGeneration", label: "Average", color: SERIES_1 },
      { key: "maxGeneration", label: "Deepest", color: SERIES_2 },
    ],
    format: (v) => v.toFixed(0),
  }),
  new LineChart($("c-nalign"), {
    title: "Alignment",
    subtitle: "0 = ignores food, 1 = heads straight at it",
    series: [{ key: "alignment", label: "Alignment", color: SERIES_1 }],
    format: (v) => v.toFixed(2),
    yRange: [0, 1],
  }),
  new LineChart($("c-ndiv"), {
    title: "Brain diversity",
    subtitle: "mean distance between brains; falling to 0 = clones",
    series: [{ key: "diversity", label: "Diversity", color: SERIES_1 }],
    format: fmt1,
  }),
];
const lifeCharts = [
  new LineChart($("c-thresh"), {
    title: "Breeding threshold",
    subtitle: "% of energy store needed before breeding",
    series: [{ key: "reproThresholdMean", sdKey: "reproThresholdSd", label: "Threshold", color: SERIES_1 }],
    format: (v) => v.toFixed(0),
    scale: 100,
    yRange: [30, 95],
  }),
  new LineChart($("c-share"), {
    title: "Offspring share",
    subtitle: "% of the parent's energy given to each child",
    series: [{ key: "offspringShareMean", sdKey: "offspringShareSd", label: "Share", color: SERIES_1 }],
    format: (v) => v.toFixed(0),
    scale: 100,
    yRange: [10, 70],
  }),
];
// Body traits (shared; y-axes span each trait's full allowed range)
const bodyCharts = [
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
    scale: deg,
    yRange: [0.05 * deg, 0.4 * deg],
  }),
];
const allCharts = [...labCharts, labScoreChart, ...natCharts, ...lifeCharts, ...bodyCharts];
for (const c of [labScoreChart, ...natCharts, ...lifeCharts]) c.setXAxis(X_TICK);

const settings = new SettingsForm(
  $<HTMLFormElement>("settings"),
  (cfg) => {
    config = cfg;
    send({ t: "reset", config: cfg });
    toast("Restarted with new settings.");
  },
  PRESETS,
);
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
      send({ t: "select", view: k, id: renderer.pick(snap, ev) });
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
    v.renderer.draw(snap, sel ? sel.id : null, sel ? sel.sense : null, sel?.body.sensorRange, colorMode);
    if (f.scene === "evolve") {
      v.label.textContent = f.mode === "natural" ? `Living world · tick ${f.tick.toLocaleString()}` : `Generation ${f.generation}`;
    } else {
      v.label.textContent = snap.label;
    }
    v.meta.textContent = snap.endless
      ? `population ${snap.count} · food on map ${snap.food.length / 2}`
      : `tick ${snap.tick}/${snap.episodeTicks} · alive ${snap.alive}/${snap.count} · avg food ${snap.meanFood.toFixed(1)}`;
    v.overlay.hidden = !(fast && k === 0);
    if (fast && k === 0) {
      v.overlay.replaceChildren();
      const line = document.createElement("div");
      line.textContent = natural() ? `Fast-forwarding… tick ${fmtTicks(progress)}` : `Fast-forwarding… generation ${progress}`;
      const sub = document.createElement("small");
      const left = fastGoal !== null ? Math.max(0, fastGoal - progress) : null;
      sub.textContent = left !== null ? `${natural() ? fmtTicks(left) + " ticks" : left} to go` : "press Stop to watch again";
      v.overlay.append(line, sub);
    }
  });
  renderInspector(inspectorEl, f.selected);
  if (f.selected?.brain) brainView.draw(f.selected.brain);
  else brainView.clear();
}

/** Show the chart sections and labels that fit the current mode. */
function applyMode(): void {
  const nat = natural();
  $("lab-charts").hidden = nat;
  $("nat-charts").hidden = !nat;
  $("life-section").hidden = !nat;
  $("body-section").hidden = !config.evolveBodies;
  for (const c of bodyCharts) c.setXAxis(nat ? X_TICK : X_GENERATION);
  for (const c of [...natCharts, ...lifeCharts, labScoreChart]) c.setEmptyText("Waiting for the first sample…");
  labScoreChart.setEmptyText(`The first lab test runs at tick ${config.labTestEvery.toLocaleString()}…`);
  fitnessChart.setSubtitle(config.energyWeight > 0 ? "food eaten minus energy burned, in food units" : "food eaten per creature");
  skip10.textContent = nat ? "+10k ticks" : "+10 gens";
  skip100.textContent = nat ? "+100k ticks" : "+100 gens";
  const labels = nat
    ? ["Ticks", "Population", "Births / 1k ticks", "Deaths / 1k ticks", "Generations", "Lab test score"]
    : ["Generation", "Average fitness", "Best fitness", "Best ever", "Alignment", "Survivors"];
  labels.forEach((l, k) => ($(`l${k}`).textContent = l));
  chartsDirty = true;
}

function updateTiles(): void {
  const t = (k: number, v: string) => ($(`t${k}`).textContent = v);
  if (natural()) {
    const s = natRows[natRows.length - 1];
    const lab = labRows[labRows.length - 1];
    t(0, fmtTicks(progress));
    t(1, s ? String(s.population) : "–");
    t(2, s ? s.birthsK.toFixed(0) : "–");
    t(3, s ? s.deathsK.toFixed(0) : "–");
    t(4, s ? s.meanGeneration.toFixed(0) : "–");
    t(5, lab ? `${lab.meanFood.toFixed(1)}` : "–");
    return;
  }
  const last = history[history.length - 1];
  t(0, String(progress));
  t(1, last ? last.mean.toFixed(1) : "–");
  t(2, last ? last.best.toFixed(0) : "–");
  t(3, last ? last.bestEver.toFixed(0) : "–");
  t(4, last ? last.alignment.toFixed(2) : "–");
  t(5, last ? `${last.survivors}/${config.creatureCount}` : "–");
}

function updateStatus(): void {
  const nat = natural();
  const where = nat ? `tick ${fmtTicks(progress)}` : `generation ${progress}`;
  let text: string;
  if (fast) text = `Fast-forwarding · ${where}`;
  else if (!running) text = "Paused";
  else if (scene === "best") text = nat ? "Watching the most prolific creature" : "Watching the best organism";
  else if (scene === "compare") text = `Random brains vs ${nat ? "the living population" : `generation ${progress}`}`;
  else text = nat ? `Living world · ${where}` : `Evolving · ${where}`;
  statusEl.textContent = text;
  statusEl.classList.toggle("busy", fast);
  fastBtn.textContent = fast ? "Stop" : "Fast-forward";
  fastBtn.classList.toggle("on", fast);
  playBtn.textContent = running ? "Pause" : "Play";
  for (const b of sceneBtns) b.classList.toggle("active", b.dataset.scene === scene);
  sceneBtns[2].textContent = nat ? "Random vs now" : "Gen 0 vs now";
  sceneBtns[1].textContent = nat ? "Watch champion" : "Watch best";
}

/** Natural samples, with births/deaths converted to per-1,000-tick rates. */
function toNatRows(stats: NaturalStats[]): Row[] {
  const k = 1000 / config.sampleEvery;
  return stats.map((s) => ({ ...(s as unknown as Row), birthsK: s.births * k, deathsK: s.deaths * k }));
}

function toLabRows(scores: LabScore[]): Row[] {
  return scores.map((s) => ({ ...(s as unknown as Row), baseline: labBaseline ?? 0 }));
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
      progress = m.generation;
      drawFrame(m);
      if (natural()) updateTiles();
      break;
    case "gen":
      history.push(m.stats);
      progress = m.stats.generation + 1;
      chartsDirty = true;
      updateTiles();
      updateStatus();
      break;
    case "history":
      history = [...m.history];
      config = m.config;
      progress = m.generation;
      settings.load(config);
      applyMode();
      updateTiles();
      updateStatus();
      break;
    case "nhistory":
      config = m.config;
      labBaseline = m.labBaseline;
      natRows = toNatRows(m.stats);
      labRows = toLabRows(m.labScores);
      progress = m.tick;
      settings.load(config);
      applyMode();
      updateTiles();
      updateStatus();
      break;
    case "nstats":
      if (m.labBaseline !== null && labBaseline === null) {
        labBaseline = m.labBaseline;
        labRows = labRows.map((r) => ({ ...r, baseline: m.labBaseline! }));
      }
      natRows.push(...toNatRows(m.stats));
      labRows.push(...toLabRows(m.labScores));
      chartsDirty = true;
      updateTiles();
      updateStatus();
      break;
    case "fast":
      fast = m.on;
      progress = m.generation;
      if (!fast) fastGoal = null;
      updateStatus();
      break;
    case "scene":
      scene = m.scene;
      updateStatus();
      break;
    case "export": {
      const r = m.run;
      const name = r.format === "evomind-natural"
        ? `evomind-natural-seed${r.config.seed}-t${r.tick}.json`
        : `evomind-seed${r.config.seed}-gen${r.generation}.json`;
      download(name, JSON.stringify(r), "application/json");
      break;
    }
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
    const hist = history as unknown as Row[];
    for (const c of labCharts) c.setData(hist);
    for (const c of [...natCharts, ...lifeCharts]) c.setData(natRows);
    labScoreChart.setData(labRows);
    for (const c of bodyCharts) c.setData(natural() ? natRows : hist);
    chartsDirty = false;
  }
  for (const c of allCharts) c.render();
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
for (const [btn, labN, natN] of [[skip10, 10, 10_000], [skip100, 100, 100_000]] as const) {
  btn.addEventListener("click", () => {
    const n = natural() ? natN : labN;
    fastGoal = progress + n;
    send({ t: "fast", on: true, amount: n });
  });
}
colorSel.addEventListener("change", () => (colorMode = colorSel.value as ColorMode));
$("save").addEventListener("click", () => send({ t: "export" }));
$("csv").addEventListener("click", () => {
  if (natural()) {
    if (!natRows.length) return toast("No samples recorded yet.");
    const cols = Object.keys(natRows[0]);
    const csv = [cols.join(","), ...natRows.map((r) => cols.map((c) => +r[c].toFixed(4)).join(","))].join("\n") + "\n";
    return download(`evomind-natural-seed${config.seed}-history.csv`, csv, "text/csv");
  }
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
applyMode();
updateTiles();
updateStatus();
requestAnimationFrame(loop);
