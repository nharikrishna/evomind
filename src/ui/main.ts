import {
  BODIES_PRESET, DEFAULT_CONFIG, GEOGRAPHY_PRESET, NATURAL_PRESET, REALISM_PRESET, type SimConfig,
} from "../sim/config";
import type { GenerationStats } from "../analysis/metrics";
import type { LabScore, NaturalStats, RegionSummary, SpeciesSummary } from "../evo/natural";
import { historyToCSV } from "../analysis/history";
import type { FromWorker, SceneKind, ToWorker } from "../worker/protocol";
import { Renderer, speciesColor, traitColor, type ColorMode, type ColorRange } from "./renderer";
import { BrainView } from "./brainView";
import { LineChart, X_GENERATION, X_TICK, type Row } from "./chart";
import { SettingsForm, type Preset } from "./settings";
import { renderInspector } from "./inspector";
import { seasonFactor, seasonInfo } from "../sim/seasons";
import { BIOMES } from "../sim/biomes";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// Validated categorical slots (dark surface): 1 = blue, 2 = orange.
const SERIES_1 = "#3987e5";
const SERIES_2 = "#d95926";

const PRESETS: Preset[] = [
  { name: "Big world: geography, temperature (default)", config: { ...DEFAULT_CONFIG, ...GEOGRAPHY_PRESET } },
  { name: "Small world: natural", config: { ...DEFAULT_CONFIG, ...NATURAL_PRESET } },
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
let chartsDirty = true;
let colorMode: ColorMode = "energy";
let latestSpecies: SpeciesSummary[] = [];
let latestRegions: RegionSummary[] = [];
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
const foodSel = $<HTMLSelectElement>("food-boost");
const followNote = $<HTMLDivElement>("follow-note");
const appEl = $<HTMLDivElement>("app");
const sidebarBtn = $<HTMLButtonElement>("sidebar-toggle");
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
  new LineChart($("c-life"), {
    title: "Lifespan",
    subtitle: "average age at death, in ticks",
    series: [{ key: "meanLifespan", label: "Lifespan", color: SERIES_1 }],
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
  new LineChart($("c-species"), {
    title: "Species alive",
    subtitle: "genetic clusters; starts high (100 unrelated founders) then collapses",
    series: [{ key: "speciesAlive", label: "Species", color: SERIES_1 }],
    format: (v) => v.toFixed(0),
  }),
  new LineChart($("c-cluster"), {
    title: "Food clustering",
    subtitle: "1 = random scatter, lower = patchier",
    series: [{ key: "foodClustering", label: "Clustering", color: SERIES_1 }],
    format: (v) => v.toFixed(2),
    yRange: [0, 1.2],
  }),
  new LineChart($("c-foodmap"), {
    title: "Food on the map",
    subtitle: "standing plants (eaten ones regrow)",
    series: [{ key: "foodOnMap", label: "Food", color: SERIES_1 }],
    format: (v) => v.toFixed(0),
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
  new LineChart($("c-insul"), {
    title: "Insulation",
    subtitle: "fur / fat, 0–1 (matters with temperature)",
    series: [{ key: "insulationMean", sdKey: "insulationSd", label: "Insulation", color: SERIES_1 }],
    format: (v) => v.toFixed(2),
    yRange: [0, 1],
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
const biomeSeries = (prefix: string) => BIOMES.map((b, k) => ({ key: `${prefix}${k}`, label: b.name, color: b.color }));
const biomeCharts = [
  new LineChart($("c-bpop"), {
    title: "Population by biome",
    subtitle: "creatures in each biome",
    series: biomeSeries("pop_"),
    format: (v) => v.toFixed(0),
  }),
  new LineChart($("c-fst"), {
    title: "Genetic separation",
    subtitle: "between regions; 0 = one mixed gene pool",
    series: [{ key: "geneticSeparation", label: "Separation", color: SERIES_1 }],
    format: (v) => v.toFixed(2),
    yRange: [0, 0.3],
  }),
  new LineChart($("c-bsize"), {
    title: "Size by biome",
    subtitle: "mean body size of creatures there",
    series: biomeSeries("size_"),
    format: (v) => v.toFixed(2),
  }),
  new LineChart($("c-bspeed"), {
    title: "Max speed by biome",
    subtitle: "px/tick",
    series: biomeSeries("speed_"),
    format: (v) => v.toFixed(1),
  }),
  new LineChart($("c-binsul"), {
    title: "Insulation by biome",
    subtitle: "the clearest place to watch tundra vs desert split",
    series: biomeSeries("insul_"),
    format: (v) => v.toFixed(2),
  }),
  new LineChart($("c-bsensor"), {
    title: "Sensor range by biome",
    subtitle: "px",
    series: biomeSeries("sensor_"),
    format: (v) => v.toFixed(0),
  }),
];
const allCharts = [...labCharts, labScoreChart, ...natCharts, ...lifeCharts, ...bodyCharts, ...biomeCharts];
for (const c of [labScoreChart, ...natCharts, ...lifeCharts, ...biomeCharts]) c.setXAxis(X_TICK);

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
  legend: HTMLSpanElement;
  meta: HTMLSpanElement;
  overlay: HTMLDivElement;
  followBtn: HTMLButtonElement;
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
    const legend = document.createElement("span");
    legend.className = "legend";
    const tools = document.createElement("span");
    tools.className = "view-tools";
    const mkBtn = (text: string, title: string) => {
      const b = document.createElement("button");
      b.className = "mini";
      b.textContent = text;
      b.title = title;
      tools.append(b);
      return b;
    };
    const followBtn = mkBtn("Follow", "Keep the selected creature centred (zooms in)");
    const fitBtn = mkBtn("Fit", "Show the whole world (or double-click the map)");
    const fullBtn = mkBtn("Fullscreen", "Show this view fullscreen (Esc to leave)");
    head.append(label, legend, meta, tools);
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
    renderer.onPick = (id) => {
      followNote.hidden = true;
      send({ t: "select", view: k, id });
    };
    renderer.onManualMove = () => followBtn.classList.remove("toggled");
    followBtn.addEventListener("click", () => {
      renderer.follow = !renderer.follow;
      followBtn.classList.toggle("toggled", renderer.follow);
      if (!renderer.follow) renderer.resetView();
    });
    fitBtn.addEventListener("click", () => {
      renderer.follow = false;
      followBtn.classList.remove("toggled");
      renderer.resetView();
    });
    fullBtn.addEventListener("click", () => {
      if (document.fullscreenElement === root) void document.exitFullscreen();
      else void root.requestFullscreen?.();
    });
    return { root, label, legend, meta, overlay, followBtn, renderer };
  });
}

// ---------- rendering ----------

function drawFrame(f: Extract<FromWorker, { t: "frame" }>): void {
  ensureViews(f.views.length);
  f.views.forEach((snap, k) => {
    const v = views[k];
    const sel = f.selected && f.selected.view === k ? f.selected : null;
    // Fertile ground fades in lean seasons (live natural world only).
    let ground = 1;
    if (snap.endless && config.seasonLength > 0) {
      const a = config.seasonAmplitude || 1;
      ground = 0.3 + 0.7 * ((seasonFactor(config, f.tick) - (1 - a)) / (2 * a));
    }
    v.renderer.rememberTerrain(snap.terrain);
    v.followBtn.disabled = !sel;
    const range = v.renderer.draw(snap, {
      selectedId: sel ? sel.id : null,
      sense: sel ? sel.sense : null,
      sensorRange: sel?.body.sensorRange,
      colorMode,
      groundStrength: ground,
    });
    renderLegend(v.legend, range);
    if (f.scene === "evolve") {
      const season = f.mode === "natural" ? seasonInfo(config, f.tick) : null;
      v.label.textContent =
        f.mode === "natural"
          ? `Living world · tick ${f.tick.toLocaleString()}` + (season ? ` · ${season.name}, year ${season.year + 1}` : "")
          : `Generation ${f.generation}`;
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
  if (!f.selected) followNote.hidden = true;
  renderSeason(f);
  renderInspector(inspectorEl, f.selected);
  if (f.selected?.brain) brainView.draw(f.selected.brain);
  else brainView.clear();
}

const LEGEND_LABEL: Record<ColorMode, [string, (v: number) => string]> = {
  energy: ["Energy", (v) => v.toFixed(0)],
  species: ["Species", (v) => v.toFixed(0)],
  size: ["Size", (v) => `${v.toFixed(2)}×`],
  speed: ["Max speed", (v) => v.toFixed(1)],
  sensor: ["Sensor", (v) => `${v.toFixed(0)}px`],
  insulation: ["Insulation", (v) => v.toFixed(2)],
  age: ["Age", (v) => v.toFixed(0)],
};

/** Colour key for the world view: what dim/bright (or red/cyan) means right now. */
function renderLegend(el: HTMLSpanElement, range: ColorRange | null): void {
  el.replaceChildren();
  const bar = document.createElement("i");
  const [name, fmt] = LEGEND_LABEL[colorMode];
  if (colorMode === "energy") {
    bar.style.background = "linear-gradient(90deg, hsl(0,80%,45%), hsl(95,80%,52%), hsl(190,80%,60%))";
    el.append(document.createTextNode("starving"), bar, document.createTextNode("full"));
    return;
  }
  if (colorMode === "species") {
    const alive = latestSpecies.filter((s) => s.extinct === null).length;
    el.append(document.createTextNode(natural() ? `one colour per species · ${alive} alive` : "species: natural mode only"));
    return;
  }
  if (!range) return;
  bar.style.background = `linear-gradient(90deg, ${traitColor(0)}, ${traitColor(0.5)}, ${traitColor(1)})`;
  el.append(document.createTextNode(`${name} ${fmt(range.min)}`), bar, document.createTextNode(fmt(range.max)));
}

/** Header badge: current season and progress through the year (natural mode with seasons). */
function renderSeason(f: Extract<FromWorker, { t: "frame" }>): void {
  const badge = $("season");
  const info = f.mode === "natural" ? seasonInfo(config, f.tick) : null;
  badge.hidden = !info;
  if (!info) return;
  badge.dataset.season = info.name;
  $("season-text").textContent = `${info.name} · year ${info.year + 1}`;
  $("season-fill").style.width = `${(info.phase * 100).toFixed(1)}%`;
}

/** Species family tree: living species, their ancestors, and recently extinct branches. */
function renderSpecies(list: SpeciesSummary[]): void {
  const host = $("species-tree");
  host.replaceChildren();
  const alive = list.filter((s) => s.extinct === null);
  $("species-count").textContent = list.length ? `· ${alive.length} alive, ${list.length - alive.length} recently extinct` : "";
  if (!list.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "Species appear after the first stats sample.";
    host.append(p);
    return;
  }
  // Keep it readable: living species, their ancestors, and recent extinctions that got anywhere.
  const byId = new Map(list.map((s) => [s.id, s]));
  const keep = new Set<number>();
  for (const s of alive) {
    let cur: SpeciesSummary | undefined = s;
    while (cur && !keep.has(cur.id)) {
      keep.add(cur.id);
      cur = cur.parent !== null ? byId.get(cur.parent) : undefined;
    }
  }
  for (const s of list) if (s.extinct !== null && progress - s.extinct < 10_000 && s.peak >= 5) keep.add(s.id);
  const shown = list.filter((s) => keep.has(s.id));
  const byParent = new Map<number | null, SpeciesSummary[]>();
  const ids = new Set(shown.map((s) => s.id));
  for (const s of shown) {
    const parent = s.parent !== null && ids.has(s.parent) ? s.parent : null;
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent)!.push(s);
  }
  const regionName = (r: number | null) => (r === null ? "" : `${BIOMES[latestRegions[r]?.biome ?? 0]?.name ?? ""} #${r + 1}`);
  const row = (s: SpeciesSummary, depth: number) => {
    const el = document.createElement("div");
    el.className = "sp-row" + (s.extinct !== null ? " extinct" : "");
    el.style.paddingLeft = `${depth * 14}px`;
    const sw = document.createElement("i");
    sw.className = "sw";
    sw.style.background = s.extinct !== null ? "transparent" : speciesColor(s.id);
    sw.style.border = `1px solid ${speciesColor(s.id)}`;
    const name = document.createElement("span");
    name.textContent = `${depth ? "└ " : ""}S${s.id}`;
    const meta = document.createElement("span");
    meta.className = "sp-meta";
    meta.textContent = s.extinct !== null
      ? `extinct at ${fmtTicks(s.extinct)} · peak ${s.peak}`
      : `${s.size} alive · since ${fmtTicks(s.born)}${s.mainRegion !== null ? ` · ${regionName(s.mainRegion)}` : ""}`;
    el.append(sw, name, meta);
    host.append(el);
  };
  // Living species first within each level, then by size.
  const order = (a: SpeciesSummary, b: SpeciesSummary) =>
    Number(a.extinct !== null) - Number(b.extinct !== null) || b.size - a.size || b.peak - a.peak;
  const walk = (parent: number | null, depth: number) => {
    for (const s of (byParent.get(parent) ?? []).sort(order)) {
      row(s, depth);
      walk(s.id, depth + 1);
    }
  };
  walk(null, 0);
}

/** Regions table; clicking a row zooms the live world view there. */
function renderRegions(list: RegionSummary[]): void {
  const table = $("regions-table") as HTMLTableElement;
  table.replaceChildren();
  const head = table.createTHead().insertRow();
  for (const h of ["Region", "Temp.", "Pop.", "Species", "Main species", "Size", "Speed", "Sensor", "Insulation", "Gen. distance"]) {
    const th = document.createElement("th");
    th.textContent = h;
    head.append(th);
  }
  const body = table.createTBody();
  for (const r of list) {
    const tr = body.insertRow();
    const cell = (text: string, swatch?: string) => {
      const td = tr.insertCell();
      if (swatch) {
        const i = document.createElement("i");
        i.className = "sw";
        i.style.background = swatch;
        td.append(i);
      }
      td.append(document.createTextNode(text));
    };
    const empty = r.population === 0;
    cell(`${BIOMES[r.biome].name} #${r.region + 1}`, BIOMES[r.biome].color);
    cell(r.temp === 0 ? "0" : (r.temp > 0 ? "+" : "") + r.temp.toFixed(1));
    cell(String(r.population));
    cell(empty ? "–" : String(r.species));
    if (r.dominantSpecies !== null) cell(`S${r.dominantSpecies} · ${(r.dominantShare * 100).toFixed(0)}%`, speciesColor(r.dominantSpecies));
    else cell("–");
    cell(empty ? "–" : r.size.toFixed(2));
    cell(empty ? "–" : r.speed.toFixed(2));
    cell(empty ? "–" : r.sensor.toFixed(0));
    cell(empty ? "–" : r.insulation.toFixed(2));
    cell(empty ? "–" : r.distance.toFixed(3));
    tr.title = "Zoom the map to this region";
    tr.addEventListener("click", () => {
      const v = views[0];
      if (!v || scene !== "evolve") return;
      v.renderer.focusOn(r.x, r.y);
      v.followBtn.classList.remove("toggled");
    });
  }
}

/** Show the chart sections and labels that fit the current mode. */
function applyMode(): void {
  const nat = natural();
  $("lab-charts").hidden = nat;
  $("nat-charts").hidden = !nat;
  $("life-section").hidden = !nat;
  $("biome-section").hidden = !(nat && config.biomes);
  $("eco-row").hidden = !nat;
  $("regions-panel").hidden = !config.biomes;
  $("eco-row").classList.toggle("single", !config.biomes);
  latestSpecies = [];
  latestRegions = [];
  renderSpecies([]);
  renderRegions([]);
  $("body-section").hidden = !config.evolveBodies;
  for (const c of bodyCharts) c.setXAxis(nat ? X_TICK : X_GENERATION);
  // Shade the lean half of each year on natural-mode time charts.
  const shade = nat && config.seasonLength > 0 ? "lean" : null;
  for (const c of [...natCharts, ...lifeCharts, ...bodyCharts, ...biomeCharts]) c.setShade(shade);
  $("food-ctl").hidden = !nat;
  foodSel.value = "1";
  for (const c of [...natCharts, ...lifeCharts, labScoreChart]) c.setEmptyText("Waiting for the first sample…");
  labScoreChart.setEmptyText(`The first lab test runs at tick ${config.labTestEvery.toLocaleString()}…`);
  fitnessChart.setSubtitle(config.energyWeight > 0 ? "food eaten minus energy burned, in food units" : "food eaten per creature");
  skip10.textContent = nat ? "+10k ticks" : "+10 gens";
  skip100.textContent = nat ? "+100k ticks" : "+100 gens";
  const labels = nat
    ? ["Ticks", "Population", "Births / 1k ticks", "Avg lifespan", "Generations", "Lab test score"]
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
    // Lifespan from the last few samples that had deaths (single windows are noisy).
    const recent = natRows.slice(-8).filter((r) => r.deaths > 0);
    const life = recent.reduce((a, r) => a + r.meanLifespan * r.deaths, 0) / (recent.reduce((a, r) => a + r.deaths, 0) || 1);
    t(3, recent.length ? `${life.toFixed(0)} ticks` : "–");
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
  // "Watch best" only makes sense with a fitness score (lab mode).
  sceneBtns[1].hidden = nat;
}

/** Natural samples, with births/deaths converted to per-1,000-tick rates. */
function toNatRows(stats: NaturalStats[]): Row[] {
  const k = 1000 / config.sampleEvery;
  return stats.map((s) => {
    const row: Row = {};
    for (const [key, v] of Object.entries(s)) if (typeof v === "number") row[key] = v;
    row.birthsK = s.births * k;
    row.deathsK = s.deaths * k;
    // Per-biome arrays become flat keys for the charts (empty biome = gap-free 0 for pop, carry for traits).
    s.biomePop?.forEach((v, b) => {
      row[`pop_${b}`] = v;
      row[`size_${b}`] = v ? s.biomeSize[b] : NaN;
      row[`speed_${b}`] = v ? s.biomeSpeed[b] : NaN;
      row[`sensor_${b}`] = v ? s.biomeSensor[b] : NaN;
      row[`insul_${b}`] = v ? s.biomeInsulation[b] : NaN;
    });
    return row;
  });
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
      if (m.stats.length) {
        latestRegions = m.regions;
        latestSpecies = m.species;
        renderRegions(m.regions);
        renderSpecies(m.species);
      }
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
    case "follow":
      followNote.hidden = false;
      followNote.textContent = m.to !== null
        ? `Following the lineage: #${m.from} died, now watching its ${m.relation} #${m.to}.`
        : `#${m.from} died, and no close relatives are alive.`;
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
    for (const c of [...natCharts, ...lifeCharts, ...biomeCharts]) c.setData(natRows);
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
foodSel.addEventListener("change", () => {
  send({ t: "env", foodBoost: Number(foodSel.value) });
  toast(`Food supply set to ${foodSel.value}× from now on.`);
});
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

function setSidebar(open: boolean): void {
  appEl.classList.toggle("no-sidebar", !open);
  sidebarBtn.classList.toggle("toggled", open);
  sidebarBtn.setAttribute("aria-expanded", String(open));
  try {
    localStorage.setItem("evomind.sidebar", open ? "1" : "0");
  } catch {
    // storage unavailable: just don't remember
  }
}
let sidebarPref: string | null = null;
try {
  sidebarPref = localStorage.getItem("evomind.sidebar");
} catch {
  sidebarPref = null;
}
setSidebar(sidebarPref !== null ? sidebarPref === "1" : window.innerWidth >= 1280);
sidebarBtn.addEventListener("click", () => setSidebar(appEl.classList.contains("no-sidebar")));

send({ t: "reset", config });
applyMode();
updateTiles();
updateStatus();
requestAnimationFrame(loop);
