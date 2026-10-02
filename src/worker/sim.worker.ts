/// <reference lib="webworker" />
/**
 * Owns the simulation so the page never blocks. The UI pulls frames (one per
 * animation frame) in watch mode; in fast-forward the worker evolves flat out
 * and only reports per-generation stats.
 */
import type { SimConfig } from "../sim/config";
import { deriveSeed } from "../sim/rng";
import { aliveCount, createWorld, isEpisodeOver, step, type World } from "../sim/world";
import type { Genome } from "../brain/genome";
import { NeuralController, neuralFactory } from "../brain/neuralController";
import { Evolution, runToEnd, type RunFile } from "../evo/generation";
import { genomeFromJSON } from "../analysis/history";
import {
  CREATURE_STRIDE, C_ALIVE, C_ENERGY, C_HEADING, C_RELATIVE, C_X, C_Y,
  type FromWorker, type SceneKind, type SelectedSnap, type ToWorker, type WorldSnap,
} from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

/** Generations of descent that define "relatives" (shared great-grandparent). */
const RELATIVE_DEPTH = 3;
const ANCESTRY_SHOWN = 8;

interface View {
  label: string;
  world: World;
}

let evo: Evolution;
let evoWorld: World;
let scene: SceneKind = "evolve";
let views: View[] = [];
let sceneEpisode = 0;
let selected: { view: number; index: number } | null = null;
let fast = false;
let fastTarget: number | null = null;
/** A genome loaded from a file for replay (overrides best-ever in the "best" scene). */
let replay: { genome: Genome; config: SimConfig; label: string } | null = null;

const post = (msg: FromWorker, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

function reset(config: SimConfig, from?: Evolution): void {
  stopFast();
  evo = from ?? new Evolution(config);
  evoWorld = evo.createEpisodeWorld(0);
  selected = null;
  setScene("evolve");
  post({ t: "history", history: evo.history, config: evo.config, generation: evo.generation });
}

function finishGeneration(): void {
  const worlds = [evoWorld];
  for (let e = 1; e < evo.config.episodesPerGeneration; e++) worlds.push(runToEnd(evo.createEpisodeWorld(e)));
  const stats = evo.completeGeneration(worlds);
  evoWorld = evo.createEpisodeWorld(0);
  if (scene === "evolve") {
    views = [{ label: "", world: evoWorld }];
    selected = null;
  }
  post({ t: "gen", stats });
}

// ---------- scenes ----------

function bestSource(): { genome: Genome; config: SimConfig; label: string } | null {
  if (replay) return replay;
  if (!evo.bestEverGenome) return null;
  const g = evo.bestEverGenome;
  return { genome: g, config: evo.config, label: `Best ever: genome #${g.id} (fitness ${evo.bestEver.toFixed(0)})` };
}

function buildSceneViews(): void {
  const seed = deriveSeed(evo.config.seed, 0x5ce7e, sceneEpisode);
  if (scene === "evolve") {
    views = [{ label: "", world: evoWorld }];
  } else if (scene === "best") {
    const src = bestSource();
    if (!src) {
      scene = "evolve";
      views = [{ label: "", world: evoWorld }];
      post({ t: "info", message: "No best organism yet. Let generation 0 finish first." });
      post({ t: "scene", scene });
      return;
    }
    const world = createWorld({ ...src.config, seed, creatureCount: 1 }, neuralFactory([src.genome]));
    views = [{ label: src.label, world }];
    selected = { view: 0, index: 0 };
  } else {
    const gen0 = evo.initialPopulation();
    const cfg = { ...evo.config, seed, creatureCount: evo.population.length };
    views = [
      { label: "Generation 0 (random brains)", world: createWorld(cfg, neuralFactory(gen0)) },
      { label: `Generation ${evo.generation} (evolved)`, world: createWorld(cfg, neuralFactory(evo.population)) },
    ];
  }
}

function setScene(next: SceneKind): void {
  if (next !== "evolve") stopFast();
  scene = next;
  selected = null;
  sceneEpisode = 0;
  buildSceneViews();
  post({ t: "scene", scene });
}

function advance(ticks: number): void {
  for (let t = 0; t < ticks; t++) {
    if (scene === "evolve") {
      if (isEpisodeOver(evoWorld)) finishGeneration();
      step(evoWorld);
    } else {
      if (views.every((v) => isEpisodeOver(v.world))) {
        sceneEpisode++;
        const keep = scene === "best" ? selected : null;
        buildSceneViews();
        selected = keep;
      }
      for (const v of views) if (!isEpisodeOver(v.world)) step(v.world);
    }
  }
}

// ---------- fast-forward ----------

function fastLoop(): void {
  if (!fast) return;
  const until = performance.now() + 40;
  do {
    runToEnd(evoWorld);
    finishGeneration();
    if (fastTarget !== null && evo.generation >= fastTarget) {
      stopFast();
      return;
    }
  } while (performance.now() < until);
  setTimeout(fastLoop, 0);
}

function startFast(generations?: number): void {
  if (scene !== "evolve") setScene("evolve");
  fastTarget = generations ? evo.generation + generations : null;
  if (!fast) {
    fast = true;
    post({ t: "fast", on: true, generation: evo.generation });
    setTimeout(fastLoop, 0);
  }
}

function stopFast(): void {
  if (!fast) return;
  fast = false;
  fastTarget = null;
  post({ t: "fast", on: false, generation: evo?.generation ?? 0 });
}

// ---------- snapshots ----------

function snapWorld(v: View, relativeOf: number | null): WorldSnap {
  const w = v.world;
  const n = w.creatures.length;
  const creatures = new Float32Array(n * CREATURE_STRIDE);
  let eaten = 0;
  for (let i = 0; i < n; i++) {
    const c = w.creatures[i];
    const o = i * CREATURE_STRIDE;
    creatures[o + C_X] = c.x;
    creatures[o + C_Y] = c.y;
    creatures[o + C_HEADING] = c.heading;
    creatures[o + C_ENERGY] = c.energy / w.config.maxEnergy;
    creatures[o + C_ALIVE] = c.alive ? 1 : 0;
    creatures[o + C_RELATIVE] =
      relativeOf !== null && c.genomeId !== null && evo.ancestorAt(c.genomeId, RELATIVE_DEPTH) === relativeOf ? 1 : 0;
    eaten += c.foodEaten;
  }
  const active = w.food.filter((f) => f.active);
  const food = new Float32Array(active.length * 2);
  active.forEach((f, k) => {
    food[2 * k] = f.x;
    food[2 * k + 1] = f.y;
  });
  return {
    label: v.label,
    width: w.config.width,
    height: w.config.height,
    tick: w.tick,
    episodeTicks: w.config.episodeTicks,
    sensorRange: w.config.sensorRange,
    count: n,
    alive: aliveCount(w),
    meanFood: n ? eaten / n : 0,
    creatures,
    food,
  };
}

function snapSelected(): { snap: SelectedSnap | null; relativeOf: number | null } {
  if (!selected) return { snap: null, relativeOf: null };
  const v = views[selected.view];
  const c = v?.world.creatures[selected.index];
  if (!c) return { snap: null, relativeOf: null };
  const ctrl = v.world.controllers[selected.index];
  const g = ctrl instanceof NeuralController ? ctrl.genome : null;

  let ancestry: { id: number; generation: number }[] = [];
  let ancestryMore = 0;
  let relativeOf: number | null = null;
  if (g && evo.lineage.has(g.id)) {
    const chain = evo.ancestry(g.id, 100000);
    ancestry = chain.slice(0, ANCESTRY_SHOWN).map((id) => ({ id, generation: evo.lineage.get(id)!.generation }));
    ancestryMore = Math.max(0, chain.length - ANCESTRY_SHOWN);
    // Relatives only make sense among the evolving population.
    if (scene === "evolve") relativeOf = evo.ancestorAt(g.id, RELATIVE_DEPTH);
  }

  const fi = v.world.nearestFood[selected.index];
  const brain = ctrl instanceof NeuralController ? ctrl.brain : null;
  return {
    relativeOf,
    snap: {
      view: selected.view,
      index: selected.index,
      alive: c.alive,
      energy: c.energy,
      speed: c.speed,
      foodEaten: c.foodEaten,
      age: c.age,
      distanceTraveled: c.distanceTraveled,
      energySpent: c.energySpent,
      alignment: c.alignmentTicks > 0 ? c.alignmentSum / c.alignmentTicks : null,
      genome: g && { id: g.id, generation: g.generation, parentId: g.parentId },
      ancestry,
      ancestryMore,
      relatives: 0,
      brain: brain && {
        shape: brain.shape,
        weights: new Float32Array(brain.weights),
        inputs: new Float32Array(brain.lastInputs),
        hidden: new Float32Array(brain.hiddenAct),
        outputs: new Float32Array(brain.outputAct),
      },
      sense: c.alive && fi >= 0 && v.world.food[fi].active ? { x: v.world.food[fi].x, y: v.world.food[fi].y } : null,
    },
  };
}

function sendFrame(): void {
  const { snap, relativeOf } = snapSelected();
  const worldSnaps = views.map((v, k) => snapWorld(v, selected && k === selected.view ? relativeOf : null));
  if (snap && relativeOf !== null) {
    const ws = worldSnaps[snap.view];
    let n = 0;
    for (let i = 0; i < ws.count; i++) if (i !== snap.index && ws.creatures[i * CREATURE_STRIDE + C_RELATIVE]) n++;
    snap.relatives = n;
  }
  const src = scene === "best" ? bestSource() : null;
  post(
    { t: "frame", scene, generation: evo.generation, views: worldSnaps, selected: snap, bestLabel: src?.label ?? null },
    worldSnaps.flatMap((s) => [s.creatures.buffer, s.food.buffer]),
  );
}

// ---------- import ----------

function importData(data: any): void {
  if (data?.format === "evomind-run") {
    replay = null;
    reset(data.config, Evolution.fromJSON(data as RunFile));
    post({ t: "info", message: `Loaded run at generation ${data.generation}.` });
  } else if (data?.genome?.genes?.brain && data?.config) {
    // best.json from the headless runner
    const genome = genomeFromJSON(data.genome);
    replay = { genome, config: data.config, label: `Loaded genome #${genome.id} (seed ${data.config.seed})` };
    setScene("best");
    post({ t: "info", message: `Loaded genome #${genome.id}. Showing it in "Watch best".` });
  } else {
    throw new Error("Unrecognized file. Expected an EvoMind run export or a best.json.");
  }
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  try {
    switch (msg.t) {
      case "reset":
        replay = null;
        reset(msg.config);
        break;
      case "frame":
        if (!fast) advance(msg.ticks);
        sendFrame();
        break;
      case "fast":
        if (msg.on) startFast(msg.generations);
        else stopFast();
        break;
      case "scene":
        if (msg.scene === "evolve") replay = null;
        setScene(msg.scene);
        break;
      case "select":
        selected = msg.index === null ? null : { view: msg.view, index: msg.index };
        break;
      case "export":
        post({ t: "export", run: evo.toJSON() });
        break;
      case "import":
        importData(msg.data);
        break;
    }
  } catch (err) {
    post({ t: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
