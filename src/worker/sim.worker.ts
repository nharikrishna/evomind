/// <reference lib="webworker" />
/**
 * Owns the simulation so the page never blocks. The UI pulls frames (one per
 * animation frame); in fast-forward the worker runs flat out and only reports
 * stats. Hosts either engine:
 * - lab:     generational Evolution (we score, we pick parents)
 * - natural: NaturalEvolution (creatures reproduce on their own)
 */
import { DEFAULT_CONFIG, type SimConfig } from "../sim/config";
import { deriveSeed } from "../sim/rng";
import { aliveCount, createWorld, isEpisodeOver, step, type World } from "../sim/world";
import { decodeRepro } from "../sim/lifeHistory";
import type { Genome } from "../brain/genome";
import { NeuralController, neuralFactory } from "../brain/neuralController";
import { randomPopulation } from "../brain/population";
import { Evolution, runToEnd, type LineageEntry, type RunFile } from "../evo/generation";
import { NaturalEvolution, type NaturalRunFile } from "../evo/natural";
import { genomeFromJSON } from "../analysis/history";
import {
  CREATURE_STRIDE, C_AGE, C_ALIVE, C_ENERGY, C_HEADING, C_ID, C_MAXSPEED, C_RELATIVE, C_SENSOR, C_SIZE, C_X, C_Y,
  type FromWorker, type SceneKind, type SelectedSnap, type ToWorker, type WorldSnap,
} from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

/** Generations of descent that define "relatives" (shared great-grandparent). */
const RELATIVE_DEPTH = 3;
/** How far down the family tree to look for a successor when a followed creature dies. */
const FOLLOW_DEPTH = 12;
const ANCESTRY_SHOWN = 8;

interface View {
  label: string;
  world: World;
}

/** The lineage queries both engines provide. */
interface Lineage {
  lineage: Map<number, LineageEntry>;
  ancestry(id: number, max?: number): number[];
  ancestorAt(id: number, depth: number): number;
}

let evo: Evolution | null = null;
let nat: NaturalEvolution | null = null;
let evoWorld: World | null = null;
let scene: SceneKind = "evolve";
let views: View[] = [];
let sceneEpisode = 0;
let selected: { view: number; id: number; genomeId: number | null } | null = null;
let fast = false;
let fastTarget: number | null = null;
/** A genome loaded from a file for replay (overrides the best-ever in the "best" scene). */
let replay: { genome: Genome; config: SimConfig; label: string } | null = null;
let sentStats = 0;
let sentLab = 0;

const post = (msg: FromWorker, transfer: Transferable[] = []) => self.postMessage(msg, transfer);
const lineageSrc = (): Lineage => (nat ?? evo)!;
const config = (): SimConfig => (nat ?? evo)!.config;
/** Lab: generation. Natural: tick. */
const progress = (): number => (nat ? nat.tick : evo!.generation);

function liveWorld(): World {
  return nat ? nat.world : evoWorld!;
}

// ---------- setup ----------

function reset(cfg: SimConfig, from?: Evolution | NaturalEvolution): void {
  stopFast();
  evo = null;
  nat = null;
  evoWorld = null;
  selected = null;
  if (from instanceof NaturalEvolution || (!from && cfg.mode === "natural")) {
    nat = from instanceof NaturalEvolution ? from : new NaturalEvolution(cfg);
    post({ t: "nhistory", stats: nat.stats, labScores: nat.labScores, labBaseline: nat.labBaseline, config: nat.config, tick: nat.tick });
    sentStats = nat.stats.length;
    sentLab = nat.labScores.length;
  } else {
    evo = from instanceof Evolution ? from : new Evolution(cfg);
    evoWorld = evo.createEpisodeWorld(0);
    post({ t: "history", history: evo.history, config: evo.config, generation: evo.generation });
  }
  setScene("evolve");
}

// ---------- lab bookkeeping ----------

function finishGeneration(): void {
  const e = evo!;
  const worlds = [evoWorld!];
  for (let k = 1; k < e.config.episodesPerGeneration; k++) worlds.push(runToEnd(e.createEpisodeWorld(k)));
  const stats = e.completeGeneration(worlds);
  evoWorld = e.createEpisodeWorld(0);
  if (scene === "evolve") {
    views = [{ label: "", world: evoWorld }];
    selected = null;
  }
  post({ t: "gen", stats });
}

// ---------- natural bookkeeping ----------

/** Send any new natural stats samples / lab scores. */
function flushNatural(): void {
  if (!nat) return;
  if (nat.stats.length === sentStats && nat.labScores.length === sentLab) return;
  post({
    t: "nstats",
    stats: nat.stats.slice(sentStats),
    labScores: nat.labScores.slice(sentLab),
    labBaseline: nat.labBaseline,
  });
  sentStats = nat.stats.length;
  sentLab = nat.labScores.length;
}

// ---------- scenes ----------

/** A config turned into a plain (non-reproducing) test world with the standard lab food supply. */
function labLike(cfg: SimConfig): SimConfig {
  const { foodCount, foodEnergy, respawnRate, episodeTicks, foodModel } = DEFAULT_CONFIG;
  return { ...cfg, mode: "lab", agingScale: 0, seasonLength: 0, biomes: false, foodCount, foodEnergy, respawnRate, episodeTicks, foodModel };
}

function bestSource(): { genome: Genome; config: SimConfig; label: string } | null {
  if (replay) return replay;
  if (nat) {
    if (!nat.champion) return null;
    const g = nat.champion.genome;
    return { genome: g, config: labLike(nat.config), label: `Most prolific: genome #${g.id} (${nat.champion.children} children)` };
  }
  const e = evo!;
  if (!e.bestEverGenome) return null;
  const g = e.bestEverGenome;
  return { genome: g, config: e.config, label: `Best ever: genome #${g.id} (fitness ${e.bestEver.toFixed(1)})` };
}

function buildSceneViews(): void {
  const cfg = config();
  const seed = deriveSeed(cfg.seed, 0x5ce7e, sceneEpisode);
  if (scene === "evolve") {
    views = [{ label: "", world: liveWorld() }];
  } else if (scene === "best") {
    const src = bestSource();
    if (!src) {
      scene = "evolve";
      views = [{ label: "", world: liveWorld() }];
      post({ t: "info", message: nat ? "No births yet. Let the world run a little first." : "No best organism yet. Let generation 0 finish first." });
      post({ t: "scene", scene });
      return;
    }
    const world = createWorld({ ...src.config, seed, creatureCount: 1 }, neuralFactory([src.genome]));
    views = [{ label: src.label, world }];
    selected = { view: 0, id: world.creatures[0].id, genomeId: world.creatures[0].genomeId };
  } else {
    const test = nat ? labLike(cfg) : cfg;
    const current = nat ? nat.livingGenomes() : evo!.population;
    const n = nat ? 100 : current.length;
    const sample = Array.from({ length: n }, (_, k) => current[Math.floor((k * current.length) / n)]);
    const gen0 = randomPopulation({ ...test, creatureCount: n });
    const tcfg = { ...test, seed, creatureCount: n };
    views = [
      { label: "Random brains (generation 0)", world: createWorld(tcfg, neuralFactory(gen0)) },
      {
        label: nat ? `Living population (tick ${nat.tick.toLocaleString()})` : `Generation ${evo!.generation} (evolved)`,
        world: createWorld(tcfg, neuralFactory(sample)),
      },
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
      if (nat) nat.step();
      else {
        if (isEpisodeOver(evoWorld!)) finishGeneration();
        step(evoWorld!);
      }
    } else {
      if (views.every((v) => isEpisodeOver(v.world))) {
        sceneEpisode++;
        const keep = scene === "best" ? selected : null;
        buildSceneViews();
        if (scene === "best" && views[0]) {
          const c0 = views[0].world.creatures[0];
          selected = { view: 0, id: c0.id, genomeId: c0.genomeId };
        }
        else selected = keep;
      }
      for (const v of views) if (!isEpisodeOver(v.world)) step(v.world);
    }
  }
  flushNatural();
}

// ---------- fast-forward ----------

function fastLoop(): void {
  if (!fast) return;
  const until = performance.now() + 40;
  do {
    if (nat) {
      for (let k = 0; k < 200; k++) nat.step();
    } else {
      runToEnd(evoWorld!);
      finishGeneration();
    }
    if (fastTarget !== null && progress() >= fastTarget) {
      flushNatural();
      stopFast();
      return;
    }
  } while (performance.now() < until);
  flushNatural();
  setTimeout(fastLoop, 0);
}

function startFast(amount?: number): void {
  if (scene !== "evolve") setScene("evolve");
  fastTarget = amount ? progress() + amount : null;
  if (!fast) {
    fast = true;
    post({ t: "fast", on: true, generation: progress() });
    setTimeout(fastLoop, 0);
  }
}

function stopFast(): void {
  if (!fast) return;
  fast = false;
  fastTarget = null;
  post({ t: "fast", on: false, generation: evo || nat ? progress() : 0 });
}

// ---------- snapshots ----------

function genomeOf(world: World, i: number): Genome | null {
  const ctrl = world.controllers[i];
  return ctrl instanceof NeuralController ? ctrl.genome : null;
}

function snapWorld(v: View, relativeOf: number | null): WorldSnap {
  const w = v.world;
  const lin = lineageSrc();
  const n = w.creatures.length;
  const creatures = new Float32Array(n * CREATURE_STRIDE);
  let eaten = 0;
  for (let i = 0; i < n; i++) {
    const c = w.creatures[i];
    const o = i * CREATURE_STRIDE;
    const gid = c.genomeId;
    const known = gid !== null && lin.lineage.has(gid);
    creatures[o + C_X] = c.x;
    creatures[o + C_Y] = c.y;
    creatures[o + C_HEADING] = c.heading;
    creatures[o + C_ENERGY] = c.energy / c.body.maxEnergy;
    creatures[o + C_ALIVE] = c.alive ? 1 : 0;
    creatures[o + C_RELATIVE] = relativeOf !== null && known && lin.ancestorAt(gid!, RELATIVE_DEPTH) === relativeOf ? 1 : 0;
    creatures[o + C_SIZE] = c.body.size;
    creatures[o + C_ID] = c.id;
    creatures[o + C_MAXSPEED] = c.body.maxSpeed;
    creatures[o + C_AGE] = c.age;
    creatures[o + C_SENSOR] = c.body.sensorRange;
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
    endless: !!nat && w === nat.world,
    sensorRange: w.config.sensorRange,
    count: n,
    alive: aliveCount(w),
    meanFood: n ? eaten / n : 0,
    creatures,
    food,
    fertility: w.fertility ? { cols: w.fertility.cols, rows: w.fertility.rows, values: Array.from(w.fertility.values) } : null,
  };
}

function snapSelected(): { snap: SelectedSnap | null; relativeOf: number | null } {
  if (!selected) return { snap: null, relativeOf: null };
  const sel = selected;
  const v = views[sel.view];
  const index = v ? v.world.creatures.findIndex((c) => c.id === sel.id) : -1;
  if (index < 0) {
    // Natural mode removes the dead: follow the lineage to the closest living relative.
    selected = followLineage(sel);
    return selected ? snapSelected() : { snap: null, relativeOf: null };
  }
  const c = v.world.creatures[index];
  const ctrl = v.world.controllers[index];
  const g = genomeOf(v.world, index);
  const lin = lineageSrc();

  let ancestry: { id: number; generation: number }[] = [];
  let ancestryMore = 0;
  let relativeOf: number | null = null;
  if (g && lin.lineage.has(g.id)) {
    const chain = lin.ancestry(g.id, 100000);
    ancestry = chain.slice(0, ANCESTRY_SHOWN).map((id) => ({ id, generation: lin.lineage.get(id)?.generation ?? 0 }));
    ancestryMore = Math.max(0, chain.length - ANCESTRY_SHOWN);
    if (scene === "evolve") relativeOf = lin.ancestorAt(g.id, RELATIVE_DEPTH);
  }

  const fi = v.world.nearestFood[index];
  const brain = ctrl instanceof NeuralController ? ctrl.brain : null;
  return {
    relativeOf,
    snap: {
      view: sel.view,
      id: c.id,
      alive: c.alive,
      energy: c.energy,
      speed: c.speed,
      foodEaten: c.foodEaten,
      age: c.age,
      children: c.children,
      distanceTraveled: c.distanceTraveled,
      energySpent: c.energySpent,
      alignment: c.alignmentTicks > 0 ? c.alignmentSum / c.alignmentTicks : null,
      genome: g && { id: g.id, generation: g.generation, parentId: g.parentId },
      ancestry,
      ancestryMore,
      relatives: 0,
      body: {
        maxSpeed: c.body.maxSpeed,
        sensorRange: c.body.sensorRange,
        size: c.body.size,
        turnRate: c.body.turnRate,
        basal: c.body.basal,
        maxEnergy: c.body.maxEnergy,
        evolved: !!g?.genes.body,
      },
      lifeHistory: g?.genes.repro ? decodeRepro(g.genes.repro) : null,
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

/**
 * The followed creature died. Pick its closest living descendant (child first,
 * then grandchild, ...; oldest wins ties); failing that, the closest living
 * relative by shared ancestor. Tell the UI who we switched to.
 */
function followLineage(sel: { view: number; id: number; genomeId: number | null }): typeof selected {
  const lin = lineageSrc();
  const world = views[sel.view]?.world;
  const dead = sel.genomeId;
  let best: { i: number; depth: number; age: number; relation: string } | null = null;
  if (world && dead !== null && lin.lineage.has(dead)) {
    world.creatures.forEach((c, i) => {
      if (c.genomeId === null) return;
      // Descendant? Walk up from the living creature looking for the dead one.
      let cur: number | null = c.genomeId;
      for (let d = 1; d <= FOLLOW_DEPTH && cur !== null; d++) {
        cur = lin.lineage.get(cur)?.parentId ?? null;
        if (cur === dead) {
          const relation = d === 1 ? "child" : d === 2 ? "grandchild" : `descendant (${d} generations down)`;
          if (!best || d < best.depth || (d === best.depth && c.age > best.age)) best = { i, depth: d, age: c.age, relation };
          return;
        }
      }
    });
    if (!best) {
      // No descendants alive: closest relative = smallest k with a shared ancestor k steps up.
      for (let k = 1; k <= FOLLOW_DEPTH && !best; k++) {
        const anc = lin.ancestorAt(dead, k);
        world.creatures.forEach((c, i) => {
          if (c.genomeId === null || best) return;
          if (lin.ancestorAt(c.genomeId, k) === anc) best = { i, depth: 100 + k, age: c.age, relation: "relative" };
        });
      }
    }
  }
  const found = best as { i: number; relation: string } | null;
  const next = found && world ? world.creatures[found.i] : null;
  post({ t: "follow", from: sel.id, to: next ? next.id : null, relation: found ? found.relation : "" });
  return next ? { view: sel.view, id: next.id, genomeId: next.genomeId } : null;
}

function sendFrame(): void {
  const { snap, relativeOf } = snapSelected();
  const worldSnaps = views.map((v, k) => snapWorld(v, selected && k === selected.view ? relativeOf : null));
  if (snap && relativeOf !== null) {
    const ws = worldSnaps[snap.view];
    let n = 0;
    for (let i = 0; i < ws.count; i++) {
      const o = i * CREATURE_STRIDE;
      if (ws.creatures[o + C_ID] !== snap.id && ws.creatures[o + C_RELATIVE]) n++;
    }
    snap.relatives = n;
  }
  post(
    {
      t: "frame",
      mode: nat ? "natural" : "lab",
      scene,
      generation: progress(),
      tick: liveWorld().tick,
      views: worldSnaps,
      selected: snap,
    },
    worldSnaps.flatMap((s) => [s.creatures.buffer, s.food.buffer]),
  );
}

// ---------- import ----------

function importData(data: any): void {
  if (data?.format === "evomind-run") {
    replay = null;
    reset(data.config, Evolution.fromJSON(data as RunFile));
    post({ t: "info", message: `Loaded lab run at generation ${data.generation}.` });
  } else if (data?.format === "evomind-natural") {
    replay = null;
    reset(data.config, NaturalEvolution.fromJSON(data as NaturalRunFile));
    post({ t: "info", message: `Loaded natural run at tick ${Number(data.tick).toLocaleString()} (${data.genomes.length} genomes).` });
  } else if (data?.genome?.genes?.brain && data?.config) {
    // best.json from the headless runner
    const genome = genomeFromJSON(data.genome);
    replay = { genome, config: { ...data.config, mode: "lab" }, label: `Loaded genome #${genome.id} (seed ${data.config.seed})` };
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
        if (msg.on) startFast(msg.amount);
        else stopFast();
        break;
      case "scene":
        if (msg.scene === "evolve") replay = null;
        setScene(msg.scene);
        break;
      case "select": {
        const c = msg.id === null ? null : views[msg.view]?.world.creatures.find((x) => x.id === msg.id);
        selected = c ? { view: msg.view, id: c.id, genomeId: c.genomeId } : null;
        break;
      }
      case "env":
        if (nat) nat.world.foodBoost = msg.foodBoost;
        break;
      case "export":
        post({ t: "export", run: (nat ?? evo)!.toJSON() });
        break;
      case "import":
        importData(msg.data);
        break;
    }
  } catch (err) {
    post({ t: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
