import { DEFAULT_CONFIG, type SimConfig } from "../sim/config";
import { deriveSeed, Rng } from "../sim/rng";
import { wrapCoord } from "../sim/math";
import { addCreature, createWorld, newCreature, removeDead, step, type World } from "../sim/world";
import { decodeRepro } from "../sim/lifeHistory";
import { GenomeIds, meanPairwiseDistance, type Genome } from "../brain/genome";
import { attachGenome, NeuralController, neuralFactory } from "../brain/neuralController";
import { randomPopulation } from "../brain/population";
import { traitStats, type TraitStats } from "../analysis/metrics";
import { EvaluationJob } from "../analysis/baselines";
import { genomeFromJSON, genomeToJSON } from "../analysis/history";
import { mutate } from "./mutation";
import { clarkEvans } from "../sim/food";
import { seasonFactor, seasonInfo } from "../sim/seasons";
import { BIOMES, NO_BARRIER, RIVER } from "../sim/biomes";
import type { LineageEntry } from "./generation";
import { genomeVector, geneticDistance, SpeciesTracker } from "./species";

/**
 * Natural (open-ended) evolution. There is no fitness function and there are no
 * generations: creatures that keep enough energy reproduce, children inherit a
 * mutated genome and part of the parent's energy, and everyone eventually dies
 * of starvation or old age. Whatever leaves descendants spreads.
 */

/** One row of the regions table (latest sample only, not history). */
export interface RegionSummary {
  region: number;
  biome: number;
  population: number;
  /** Species present, and the most common one with its share of the region. */
  species: number;
  dominantSpecies: number | null;
  dominantShare: number;
  size: number;
  speed: number;
  sensor: number;
  insulation: number;
  diet: number;
  /** Biome base temperature (-1 very cold .. +1 very hot). */
  temp: number;
  /** Mean RMS genetic distance from this region's average genome to the other regions'. */
  distance: number;
  x: number;
  y: number;
}

/** One row of the species list (latest sample only). */
export interface SpeciesSummary {
  id: number;
  parent: number | null;
  born: number;
  extinct: number | null;
  size: number;
  peak: number;
  /** Region holding most of its members (null if extinct / no biomes). */
  mainRegion: number | null;
}

/** One stats sample, recorded every `sampleEvery` ticks. */
export interface NaturalStats extends TraitStats {
  tick: number;
  population: number;
  /** Births and deaths since the previous sample. */
  births: number;
  deaths: number;
  meanAge: number;
  /** Mean age at death of creatures that died since the previous sample (0 if none). */
  meanLifespan: number;
  /** Mean energy as a fraction of each creature's store. */
  meanEnergy: number;
  /** Mean / max generations of descent from the founders. */
  meanGeneration: number;
  maxGeneration: number;
  /** Founder lineages that still have living members. */
  families: number;
  diversity: number;
  alignment: number;
  reproThresholdMean: number; reproThresholdSd: number;
  offspringShareMean: number; offspringShareSd: number;
  foodOnMap: number;
  /** Clark–Evans index of standing food: ≈1 random scatter, <1 patchy. */
  foodClustering: number;
  /** Current regrowth multiplier from the season (1 = no seasons). */
  seasonFactor: number;
  /** 1 during the lean half of the year (shaded on charts), else 0. */
  lean: number;
  /** Environment-shift food multiplier in effect. */
  foodBoost: number;
  /**
   * Genetic separation between regions (Fst-like): (between - within) / between
   * mean genome distance. 0 = one mixed gene pool; higher = regions drifting apart.
   */
  geneticSeparation: number;
  /** Storm-carried founder groups so far. */
  founderEvents: number;
  /** Species (genetic clusters) alive now. */
  speciesAlive: number;
  /** New species founded so far by divergence (not counting the starting founders). */
  speciations: number;
  /** Per biome (index = BIOMES order): creatures there now and their mean traits (0 if empty). */
  biomePop: number[];
  biomeSize: number[];
  biomeSpeed: number[];
  biomeSensor: number[];
  biomeInsulation: number[];
  biomeDiet: number[];
  /** Share of the living population's lifetime food energy that came from fruit. */
  fruitShare: number;
  extinctions: number;
}

/** Standardized lab test of the living population (comparable over time). */
export interface LabScore {
  tick: number;
  /** Mean food eaten per creature in fixed test worlds with 100 creatures. */
  meanFood: number;
  alignment: number;
}

/** Saved natural run: the living gene pool plus history (the world itself is re-grown on load). */
export interface NaturalRunFile {
  format: "evomind-natural";
  version: 1;
  config: SimConfig;
  tick: number;
  stats: NaturalStats[];
  labScores: LabScore[];
  labBaseline: number | null;
  genomes: object[];
  champion: { genome: object; children: number } | null;
  extinctions: number;
}

/** Size of the standardized lab test population. */
const LAB_TEST_SIZE = 100;
/** How many recent parents to remember for re-seeding after an extinction. */
const BANK_SIZE = 60;
/** Diversity is O(n²); estimate it from at most this many genomes. */
const DIVERSITY_SAMPLE = 60;
/**
 * Lab tests run in slices: this many test-world ticks per simulation tick, so a
 * test never freezes the world (2 episodes × 2000 ticks finish in ~400 ticks).
 */
const LAB_TICKS_PER_TICK = 10;
/** How often to forget lineage records of branches with no living descendants. */
const PRUNE_EVERY = 5000;

interface LabJob {
  job: EvaluationJob;
  /** The baseline (random brains) or a score of the living pool sampled at `tick`. */
  kind: "baseline" | "score";
  tick: number;
}

/** Pick n items spread evenly across a list (deterministic). */
function spread<T>(items: readonly T[], n: number): T[] {
  return Array.from({ length: Math.min(n, items.length) }, (_, k) => items[Math.floor((k * items.length) / Math.min(n, items.length))]);
}

function meanSd(v: number[]): [number, number] {
  if (!v.length) return [0, 0];
  const m = v.reduce((s, x) => s + x, 0) / v.length;
  return [m, Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length)];
}

export class NaturalEvolution {
  ids = new GenomeIds();
  world: World;
  readonly lineage = new Map<number, LineageEntry>();
  readonly stats: NaturalStats[] = [];
  readonly labScores: LabScore[] = [];
  labBaseline: number | null = null;
  /** Most prolific genome so far (by children produced). */
  champion: { genome: Genome; children: number } | null = null;
  extinctions = 0;
  private rng: Rng;
  private bank: Genome[] = [];
  private childCount = new Map<number, number>();
  private labJobs: LabJob[] = [];
  private windowBirths = 0;
  private windowDeaths = 0;
  private windowDeathAge = 0;
  founderEvents = 0;
  /** Events the UI hasn't shown yet (e.g. storm founders). */
  readonly pendingEvents: string[] = [];
  readonly species: SpeciesTracker;
  /** Latest regions table and species list (refreshed every sample). */
  regions: RegionSummary[] = [];
  speciesList: SpeciesSummary[] = [];
  private speciesRng: Rng;

  constructor(readonly config: SimConfig, seedGenomes?: Genome[]) {
    this.rng = new Rng(deriveSeed(config.seed, 0x9a7));
    const pop = seedGenomes ?? randomPopulation(config, this.ids);
    for (const g of pop) this.lineage.set(g.id, { parentId: null, generation: g.generation, founder: g.id });
    this.world = createWorld({ ...config, creatureCount: pop.length }, neuralFactory(pop));
    // Species bookkeeping has its own random stream, so it never changes the simulation.
    this.speciesRng = new Rng(deriveSeed(config.seed, 0x5bec));
    this.species = new SpeciesTracker(config.speciesThreshold);
    for (const g of pop) this.species.assignFounder(g, 0);
  }

  get tick(): number {
    return this.world.tick;
  }

  genomeAt(i: number): Genome {
    return (this.world.controllers[i] as NeuralController).genome;
  }

  /** Living genomes, in creature order. */
  livingGenomes(): Genome[] {
    return this.world.controllers.map((c) => (c as NeuralController).genome);
  }

  ancestry(id: number, max = 50): number[] {
    const out: number[] = [];
    let cur = this.lineage.get(id)?.parentId ?? null;
    while (cur !== null && out.length < max) {
      out.push(cur);
      cur = this.lineage.get(cur)?.parentId ?? null;
    }
    return out;
  }

  ancestorAt(id: number, depth: number): number {
    let cur = id;
    for (let d = 0; d < depth; d++) {
      const p = this.lineage.get(cur)?.parentId ?? null;
      if (p === null) break;
      cur = p;
    }
    return cur;
  }

  founderOf(id: number): number {
    return this.lineage.get(id)?.founder ?? id;
  }

  /** Advance one tick: physics, deaths, births, bookkeeping. */
  step(): void {
    const cfg = this.config;
    step(this.world);
    for (const d of removeDead(this.world)) {
      this.windowDeaths++;
      this.windowDeathAge += d.age;
    }

    const n = this.world.creatures.length;
    for (let i = 0; i < n; i++) {
      if (this.world.creatures.length >= cfg.maxPopulation) break;
      const c = this.world.creatures[i];
      if (c.age < cfg.maturityAge) continue;
      const g = this.genomeAt(i);
      if (!g.genes.repro) continue;
      const { reproThreshold, offspringShare } = decodeRepro(g.genes.repro);
      if (c.energy < reproThreshold * c.body.maxEnergy) continue;
      // Crowding: breeding is half as likely with `crowdTolerance` neighbours, a third with twice that.
      if (cfg.crowding && c.crowding > 0 && this.rng.next() > 1 / (1 + c.crowding / cfg.crowdTolerance)) continue;
      this.giveBirth(i, g, offspringShare);
    }

    if (this.world.creatures.length === 0) this.reseed();
    if (cfg.barriers && this.world.biomeMap && this.rng.next() < cfg.founderRate) this.stormFounders();

    const t = this.world.tick;
    if (t % cfg.sampleEvery === 0) this.recordStats();
    if (cfg.labTestEvery > 0 && t % cfg.labTestEvery === 0) this.startLabTest();
    this.advanceLabTests(LAB_TICKS_PER_TICK);
    if (t % PRUNE_EVERY === 0) {
      this.pruneLineage();
      this.species.prune(50_000, t);
    }
  }

  /**
   * Forget lineage records (and child counts) of branches with no living
   * descendants, keeping full ancestry for the living, the champion and the
   * re-seed bank. Without this, records grow forever (~450 per 1k ticks).
   * Like real history: extinct branches leave no trace in living genomes.
   */
  pruneLineage(): void {
    const keep = new Set<number>();
    const roots = [...this.livingGenomes(), ...this.bank, ...(this.champion ? [this.champion.genome] : [])];
    for (const g of roots) {
      let cur: number | null = g.id;
      while (cur !== null && !keep.has(cur)) {
        keep.add(cur);
        cur = this.lineage.get(cur)?.parentId ?? null;
      }
    }
    for (const id of this.lineage.keys()) if (!keep.has(id)) this.lineage.delete(id);
    for (const id of this.childCount.keys()) if (!keep.has(id)) this.childCount.delete(id);
  }

  private mutatedCopy(parent: Genome): Genome {
    const cfg = this.config;
    const brain = new Float32Array(parent.genes.brain);
    mutate(brain, { rate: cfg.mutationRate, sigma: cfg.mutationSigma, resetRate: cfg.resetRate }, this.rng);
    const genes: Genome["genes"] = { brain };
    const bodyParams = { rate: cfg.bodyMutationRate, sigma: cfg.bodyMutationSigma, resetRate: 0 };
    if (parent.genes.body) mutate((genes.body = new Float32Array(parent.genes.body)), bodyParams, this.rng);
    if (parent.genes.repro) mutate((genes.repro = new Float32Array(parent.genes.repro)), bodyParams, this.rng);
    return { id: this.ids.take(), parentId: parent.id, generation: parent.generation + 1, shape: parent.shape, genes };
  }

  private giveBirth(parentIndex: number, pg: Genome, share: number): void {
    const cfg = this.config;
    const parent = this.world.creatures[parentIndex];
    const give = parent.energy * share;
    parent.energy -= give;
    parent.children++;

    const cg = this.mutatedCopy(pg);
    this.lineage.set(cg.id, { parentId: pg.id, generation: cg.generation, founder: this.founderOf(pg.id) });
    const pos = this.birthPosition(parent.x, parent.y);
    const child = newCreature(this.world, pos.x, pos.y, this.rng.range(-Math.PI, Math.PI));
    attachGenome(child, cg, cfg);
    this.species.assignChild(cg, pg.id, this.world.tick);
    child.energy = give * cfg.birthEfficiency;
    addCreature(this.world, child, new NeuralController(cg));

    this.windowBirths++;
    const kids = (this.childCount.get(pg.id) ?? 0) + 1;
    this.childCount.set(pg.id, kids);
    if (!this.champion || kids > this.champion.children) this.champion = { genome: pg, children: kids };
    if (this.bank.length >= BANK_SIZE) this.bank.shift();
    this.bank.push(pg);
  }

  /**
   * Children appear right next to the parent, and on the parent's side of any
   * barrier (otherwise births would leak across rivers and walls).
   */
  private birthPosition(px: number, py: number): { x: number; y: number } {
    const cfg = this.config;
    const map = this.world.biomeMap;
    const walls = map && !cfg.barriers && cfg.biomeCrossing < 1;
    const geo = map && cfg.barriers;
    for (let t = 0; t < 4; t++) {
      const x = wrapCoord(px + this.rng.gaussian() * 6, cfg.width);
      const y = wrapCoord(py + this.rng.gaussian() * 6, cfg.height);
      if (walls && map!.at(x, y) !== map!.at(px, py)) continue;
      if (geo && (map!.regionAt(x, y) !== map!.regionAt(px, py) || map!.barrierAt(x, y) === RIVER)) continue;
      return { x, y };
    }
    return { x: px, y: py };
  }

  /**
   * A storm carries a small group of neighbours to a random other region, like
   * animals rafting to an island. The main way genes cross barriers in bulk.
   */
  private stormFounders(): void {
    const cfg = this.config;
    const map = this.world.biomeMap!;
    const cs = this.world.creatures;
    if (cs.length < cfg.founderGroup * 2) return;
    const seed = cs[this.rng.int(cs.length)];
    const from = map.regionAt(seed.x, seed.y);
    const others = map.regions.map((_, k) => k).filter((k) => k !== from);
    const to = others[this.rng.int(others.length)];
    const target = map.randomPointIn(to, this.rng);
    if (!target) return;
    const group = cs
      .filter((c) => map.regionAt(c.x, c.y) === from)
      .map((c) => ({ c, d: (c.x - seed.x) ** 2 + (c.y - seed.y) ** 2 }))
      .sort((a, b) => a.d - b.d)
      .slice(0, cfg.founderGroup);
    for (const { c } of group) {
      for (let t = 0; t < 6; t++) {
        const x = wrapCoord(target.x + this.rng.gaussian() * 15, cfg.width);
        const y = wrapCoord(target.y + this.rng.gaussian() * 15, cfg.height);
        if (map.regionAt(x, y) === to && map.barrierAt(x, y) === NO_BARRIER) {
          c.x = x;
          c.y = y;
          break;
        }
      }
    }
    this.founderEvents++;
    const name = (k: number) => BIOMES[map.regions[k].biome].name.toLowerCase();
    this.pendingEvents.push(`A storm carried ${group.length} creatures from a ${name(from)} region to a ${name(to)} region.`);
  }

  /** Species of a living genome (undefined if unknown). */
  speciesOf(genomeId: number): number | undefined {
    return this.species.speciesOf(genomeId);
  }

  private regionSummaries(genomes: Genome[]): RegionSummary[] {
    const map = this.world.biomeMap;
    if (!map) return [];
    const k = map.regions.length;
    const members: number[][] = Array.from({ length: k }, () => []);
    this.world.creatures.forEach((c, i) => members[map.regionAt(c.x, c.y)].push(i));
    // Average genome per region, for between-region distances.
    const centroid = members.map((idx) => {
      if (!idx.length) return null;
      const vs = idx.map((i) => genomeVector(genomes[i]));
      const out = new Float32Array(vs[0].length);
      for (const v of vs) for (let j = 0; j < out.length; j++) out[j] += v[j] / vs.length;
      return out;
    });
    return map.regions.map((r, region) => {
      const idx = members[region];
      const cs = idx.map((i) => this.world.creatures[i]);
      const counts = new Map<number, number>();
      for (const i of idx) {
        const sp = this.species.speciesOf(genomes[i].id);
        if (sp !== undefined) counts.set(sp, (counts.get(sp) ?? 0) + 1);
      }
      let dominant: number | null = null, top = 0;
      for (const [sp, n] of counts) if (n > top) { top = n; dominant = sp; }
      const mean = (f: (c: (typeof cs)[0]) => number) => (cs.length ? cs.reduce((s, c) => s + f(c), 0) / cs.length : 0);
      const others = centroid.filter((v, j) => v && j !== region) as Float32Array[];
      const me = centroid[region];
      return {
        region, biome: r.biome, population: cs.length,
        species: counts.size, dominantSpecies: dominant, dominantShare: cs.length ? top / cs.length : 0,
        size: mean((c) => c.body.size), speed: mean((c) => c.body.maxSpeed), sensor: mean((c) => c.body.sensorRange),
        insulation: mean((c) => c.body.insulation), diet: mean((c) => c.body.diet), temp: BIOMES[r.biome].temp,
        distance: me && others.length ? others.reduce((s, v) => s + geneticDistance(me, v), 0) / others.length : 0,
        x: r.x, y: r.y,
      };
    });
  }

  private speciesSummaries(genomes: Genome[]): SpeciesSummary[] {
    const map = this.world.biomeMap;
    const regionCount = new Map<number, Map<number, number>>();
    if (map) {
      this.world.creatures.forEach((c, i) => {
        const sp = this.species.speciesOf(genomes[i].id);
        if (sp === undefined) return;
        if (!regionCount.has(sp)) regionCount.set(sp, new Map());
        const m = regionCount.get(sp)!;
        const r = map.regionAt(c.x, c.y);
        m.set(r, (m.get(r) ?? 0) + 1);
      });
    }
    return [...this.species.species.values()].map((s) => {
      let mainRegion: number | null = null, top = 0;
      for (const [r, n] of regionCount.get(s.id) ?? []) if (n > top) { top = n; mainRegion = r; }
      return { id: s.id, parent: s.parent, born: s.born, extinct: s.extinct, size: s.size, peak: s.peak, mainRegion };
    });
  }

  /** Fst-like separation of the gene pools of different regions (sampled). */
  private geneticSeparation(): number {
    const map = this.world.biomeMap;
    if (!map) return 0;
    const byRegion = new Map<number, Genome[]>();
    this.world.creatures.forEach((c, i) => {
      const r = map.regionAt(c.x, c.y);
      if (!byRegion.has(r)) byRegion.set(r, []);
      byRegion.get(r)!.push(this.genomeAt(i));
    });
    const groups = [...byRegion.values()].filter((g) => g.length >= 3).map((g) => spread(g, 20));
    if (groups.length < 2) return 0;
    const vec = (g: Genome) => [...g.genes.brain, ...(g.genes.body ?? []), ...(g.genes.repro ?? [])];
    const vecs = groups.map((g) => g.map(vec));
    const dist = (a: number[], b: number[]) => Math.sqrt(a.reduce((s, x, k) => s + (x - b[k]) ** 2, 0));
    let within = 0, nw = 0, between = 0, nb = 0;
    for (let i = 0; i < vecs.length; i++) {
      for (let a = 0; a < vecs[i].length; a++) {
        for (let b = a + 1; b < vecs[i].length; b++) { within += dist(vecs[i][a], vecs[i][b]); nw++; }
        for (let j = i + 1; j < vecs.length; j++) {
          for (const v of vecs[j]) { between += dist(vecs[i][a], v); nb++; }
        }
      }
    }
    if (!nw || !nb) return 0;
    const wm = within / nw, bm = between / nb;
    return bm > 0 ? Math.max(0, (bm - wm) / bm) : 0;
  }

  /** Everyone died: restart the population from recent successful parents (or randoms). */
  private reseed(): void {
    const cfg = this.config;
    this.extinctions++;
    const randoms = this.bank.length ? null : randomPopulation({ ...cfg, seed: deriveSeed(cfg.seed, 0xdead, this.extinctions) }, this.ids);
    for (let k = 0; k < cfg.creatureCount; k++) {
      const g = randoms ? randoms[k] : this.mutatedCopy(this.bank[k % this.bank.length]);
      if (randoms) this.lineage.set(g.id, { parentId: null, generation: g.generation, founder: g.id });
      else this.lineage.set(g.id, { parentId: g.parentId, generation: g.generation, founder: this.founderOf(g.parentId!) });
      const c = newCreature(this.world, this.rng.range(0, cfg.width), this.rng.range(0, cfg.height), this.rng.range(-Math.PI, Math.PI));
      attachGenome(c, g, cfg);
      if (randoms) this.species.assignFounder(g, this.world.tick);
      else this.species.assignChild(g, g.parentId!, this.world.tick);
      addCreature(this.world, c, new NeuralController(g));
    }
  }

  private recordStats(): void {
    const cfg = this.config;
    const cs = this.world.creatures;
    const genomes = this.livingGenomes();
    this.species.census(genomes, this.world.tick, this.speciesRng);
    this.regions = this.regionSummaries(genomes);
    this.speciesList = this.speciesSummaries(genomes);
    let age = 0, energy = 0, gen = 0, maxGen = 0, aSum = 0, aTicks = 0;
    const families = new Set<number>();
    const thr: number[] = [], share: number[] = [];
    cs.forEach((c, i) => {
      const g = genomes[i];
      age += c.age;
      energy += c.energy / c.body.maxEnergy;
      gen += g.generation;
      maxGen = Math.max(maxGen, g.generation);
      aSum += c.alignmentSum;
      aTicks += c.alignmentTicks;
      families.add(this.founderOf(g.id));
      if (g.genes.repro) {
        const lh = decodeRepro(g.genes.repro);
        thr.push(lh.reproThreshold);
        share.push(lh.offspringShare);
      }
    });
    const n = cs.length || 1;
    const [reproThresholdMean, reproThresholdSd] = meanSd(thr);
    const [offspringShareMean, offspringShareSd] = meanSd(share);
    this.stats.push({
      tick: this.world.tick,
      population: cs.length,
      births: this.windowBirths,
      deaths: this.windowDeaths,
      meanAge: age / n,
      meanLifespan: this.windowDeaths ? this.windowDeathAge / this.windowDeaths : 0,
      meanEnergy: energy / n,
      meanGeneration: gen / n,
      maxGeneration: maxGen,
      families: families.size,
      diversity: meanPairwiseDistance(spread(genomes, DIVERSITY_SAMPLE)),
      alignment: aTicks ? aSum / aTicks : 0,
      ...traitStats(genomes, cfg),
      reproThresholdMean, reproThresholdSd, offspringShareMean, offspringShareSd,
      // Vegetation: standing biomass in "meals" (foodEnergy units); items: standing food count.
      foodOnMap: this.world.vegetation
        ? this.world.vegetation.total() / cfg.foodEnergy
        : this.world.food.reduce((s, f) => s + (f.active ? 1 : 0), 0),
      foodClustering: (() => {
        const act = this.world.food.filter((f) => f.active);
        return clarkEvans(act.map((f) => f.x), act.map((f) => f.y), cfg.width, cfg.height);
      })(),
      seasonFactor: seasonFactor(cfg, this.world.tick),
      lean: seasonInfo(cfg, this.world.tick)?.lean ? 1 : 0,
      foodBoost: this.world.foodBoost,
      ...this.biomeStats(),
      geneticSeparation: this.geneticSeparation(),
      founderEvents: this.founderEvents,
      speciesAlive: this.species.livingSpecies().length,
      speciations: this.species.speciations,
      extinctions: this.extinctions,
    });
    this.windowBirths = 0;
    this.windowDeaths = 0;
    this.windowDeathAge = 0;
  }

  private biomeStats(): Pick<NaturalStats, "biomePop" | "biomeSize" | "biomeSpeed" | "biomeSensor" | "biomeInsulation" | "biomeDiet" | "fruitShare"> {
    const k = BIOMES.length;
    const pop = new Array<number>(k).fill(0), size = new Array<number>(k).fill(0);
    const speed = new Array<number>(k).fill(0), sensor = new Array<number>(k).fill(0);
    const insul = new Array<number>(k).fill(0), diet = new Array<number>(k).fill(0);
    let fruit = 0, food = 0;
    for (const c of this.world.creatures) {
      fruit += c.fruitEaten;
      food += c.foodEaten;
      if (c.biome < 0) continue;
      pop[c.biome]++;
      size[c.biome] += c.body.size;
      speed[c.biome] += c.body.maxSpeed;
      sensor[c.biome] += c.body.sensorRange;
      insul[c.biome] += c.body.insulation;
      diet[c.biome] += c.body.diet;
    }
    const mean = (a: number[]) => a.map((v, b) => (pop[b] ? v / pop[b] : 0));
    return {
      biomePop: pop, biomeSize: mean(size), biomeSpeed: mean(speed),
      biomeSensor: mean(sensor), biomeInsulation: mean(insul), biomeDiet: mean(diet),
      fruitShare: food ? fruit / food : 0,
    };
  }

  /**
   * The lab-test configuration: the same body and sensing rules, but the standard
   * lab food supply and episode length, so scores stay comparable across runs
   * whose own food settings differ.
   */
  private labConfig(): SimConfig {
    const { foodCount, foodEnergy, respawnRate, episodeTicks, foodModel, width, height } = DEFAULT_CONFIG;
    return {
      ...this.config, mode: "lab", creatureCount: LAB_TEST_SIZE,
      foodCount, foodEnergy, respawnRate, episodeTicks, foodModel, width, height,
      agingScale: 0, seasonLength: 0, biomes: false, barriers: false,
    };
  }

  /**
   * Queue a lab test of the current gene pool (plus the random-brain baseline the
   * first time). It then runs in slices alongside the simulation.
   */
  startLabTest(): void {
    const genomes = this.livingGenomes();
    if (!genomes.length || this.labJobs.some((j) => j.kind === "score")) return;
    const cfg = this.labConfig();
    if (this.labBaseline === null && !this.labJobs.length) {
      const randoms = randomPopulation({ ...cfg, seed: deriveSeed(cfg.seed, 0xba5e) });
      this.labJobs.push({ job: new EvaluationJob(cfg, randoms, 2), kind: "baseline", tick: this.world.tick });
    }
    const sample = Array.from({ length: LAB_TEST_SIZE }, (_, k) => genomes[Math.floor((k * genomes.length) / LAB_TEST_SIZE)]);
    this.labJobs.push({ job: new EvaluationJob(cfg, sample, 2), kind: "score", tick: this.world.tick });
  }

  private advanceLabTests(ticks: number): void {
    const head = this.labJobs[0];
    if (!head || !head.job.advance(ticks)) return;
    this.labJobs.shift();
    const r = head.job.result!;
    if (head.kind === "baseline") this.labBaseline = r.meanFood;
    else this.labScores.push({ tick: head.tick, meanFood: r.meanFood, alignment: r.alignment });
  }

  /** Is a lab test currently running in the background? */
  get labTestRunning(): boolean {
    return this.labJobs.length > 0;
  }

  /** Run a lab test to completion right now (headless tools and tests). */
  labTest(): LabScore | null {
    this.startLabTest();
    while (this.labJobs.length) this.advanceLabTests(1_000_000);
    return this.labScores[this.labScores.length - 1] ?? null;
  }

  toJSON(): NaturalRunFile {
    return {
      format: "evomind-natural",
      version: 1,
      config: this.config,
      tick: this.world.tick,
      stats: this.stats,
      labScores: this.labScores,
      labBaseline: this.labBaseline,
      genomes: this.livingGenomes().map(genomeToJSON),
      champion: this.champion && { genome: genomeToJSON(this.champion.genome), children: this.champion.children },
      extinctions: this.extinctions,
    };
  }

  /**
   * Restore a saved natural run. The gene pool, history and champion come back;
   * the world is re-grown around them (positions and food are new), so this is a
   * continuation of the lineage, not a bit-identical resume.
   */
  static fromJSON(run: NaturalRunFile): NaturalEvolution {
    if (run.format !== "evomind-natural") throw new Error("Not an EvoMind natural run file");
    const genomes = run.genomes.map(genomeFromJSON);
    const nat = new NaturalEvolution(run.config, genomes);
    nat.ids = new GenomeIds(Math.max(0, ...genomes.map((g) => g.id)) + 1);
    nat.world.tick = run.tick;
    nat.stats.push(...run.stats);
    nat.labScores.push(...run.labScores);
    nat.labBaseline = run.labBaseline;
    nat.extinctions = run.extinctions;
    if (run.champion) nat.champion = { genome: genomeFromJSON(run.champion.genome), children: run.champion.children };
    return nat;
  }
}
