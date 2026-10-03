import { DEFAULT_CONFIG, type SimConfig } from "../sim/config";

interface Field {
  key: keyof SimConfig;
  label: string;
  step?: number;
  min?: number;
  max?: number;
  int?: boolean;
  bool?: boolean;
  /** A dropdown of [value, label] pairs (string-valued fields). */
  choices?: [string, string][];
}

export interface Preset {
  name: string;
  config: SimConfig;
}

const SECTIONS: [string, Field[]][] = [
  ["Mode", [
    { key: "mode", label: "Evolution mode", choices: [["natural", "Natural (reproduction)"], ["lab", "Lab (generations)"]] },
  ]],
  ["Natural reproduction", [
    { key: "agingScale", label: "Ageing (upkeep ×2 at age)", step: 500, min: 0, int: true },
    { key: "maturityAge", label: "Maturity age (ticks)", step: 25, min: 0, int: true },
    { key: "birthEfficiency", label: "Birth efficiency", step: 0.05, min: 0.05, max: 1 },
    { key: "maxPopulation", label: "Population cap", step: 50, min: 10, max: 2000, int: true },
  ]],
  ["Biomes & geography", [
    { key: "biomes", label: "Biomes", bool: true },
    { key: "biomeRegions", label: "Regions", step: 1, min: 4, max: 20, int: true },
    { key: "biomeSense", label: "Sense own biome", bool: true },
    { key: "barriers", label: "Rivers & mountains", bool: true },
    { key: "riverCrossing", label: "River crossing chance", step: 0.01, min: 0, max: 1 },
    { key: "mountainCost", label: "Mountain move cost ×", step: 1, min: 1 },
    { key: "founderRate", label: "Storm founders / tick", step: 0.00005, min: 0, max: 0.01 },
    { key: "temperature", label: "Temperature (heat budget)", bool: true },
    { key: "thermalCost", label: "Thermal cost", step: 0.01, min: 0 },
    { key: "costInsulation", label: "Insulation upkeep", step: 0.005, min: 0 },
    { key: "seasonTempSwing", label: "Seasonal temperature swing", step: 0.1, min: 0, max: 2 },
    { key: "thermalComfort", label: "Comfort zone (±)", step: 0.05, min: 0, max: 1 },
    { key: "crowding", label: "Crowding (density brake)", bool: true },
    { key: "crowdTolerance", label: "Crowd tolerance", step: 1, min: 1, int: true },
    { key: "crowdStress", label: "Crowd stress / neighbour", step: 0.001, min: 0 },
    { key: "plantBiomass", label: "Plant biomass (experimental)", bool: true },
    { key: "mudFactor", label: "Swamp mud ×", step: 0.1, min: 1 },
    { key: "fogFactor", label: "Forest sight ×", step: 0.05, min: 0.05, max: 1 },
  ]],
  ["World", [
    { key: "width", label: "World width", step: 100, min: 400, max: 4000, int: true },
    { key: "height", label: "World height", step: 100, min: 300, max: 3000, int: true },
    { key: "seed", label: "Seed", step: 1, min: 0, int: true },
    { key: "creatureCount", label: "Population", step: 10, min: 2, max: 1000, int: true },
    { key: "foodCount", label: "Food items", step: 5, min: 0, max: 2000, int: true },
    { key: "foodEnergy", label: "Energy per food", step: 5, min: 1 },
    { key: "respawnRate", label: "Food regrowth / tick", step: 0.005, min: 0, max: 1 },
    { key: "foodModel", label: "Food model", choices: [["vegetation", "Vegetation (ground cover)"], ["plants", "Plant items (patches)"], ["random", "Random scatter"]] },
    { key: "satiety", label: "Satiety (no eating when full)", bool: true },
    { key: "intakeScaling", label: "Intake scales with size", bool: true },
    { key: "vegGrowth", label: "Vegetation growth rate", step: 0.0005, min: 0 },
    { key: "vegCapacity", label: "Vegetation per cell", step: 5, min: 1 },
    { key: "fertilityScale", label: "Fertile patch size (px)", step: 20, min: 40 },
    { key: "fertilityContrast", label: "Fertility contrast", step: 0.25, min: 0 },
    { key: "seedSpread", label: "Seed spread (px)", step: 5, min: 1 },
    { key: "seedLocalProb", label: "Seeds near parent plant", step: 0.05, min: 0, max: 1 },
    { key: "seasonLength", label: "Year length (0 = no seasons)", step: 1000, min: 0, int: true },
    { key: "seasonAmplitude", label: "Season strength (0–1)", step: 0.1, min: 0, max: 1 },
    { key: "episodeTicks", label: "Ticks per generation", step: 250, min: 100, int: true },
  ]],
  ["Body", [
    { key: "evolveBodies", label: "Evolve bodies", bool: true },
    { key: "energyWeight", label: "Energy cost in fitness", step: 0.25, min: 0 },
    { key: "costSpeed", label: "Speed upkeep (× speed³)", step: 0.005, min: 0 },
    { key: "costSensor", label: "Sensor upkeep", step: 0.002, min: 0 },
    { key: "costSize", label: "Size upkeep (× size²)", step: 0.002, min: 0 },
    { key: "costTurn", label: "Turn upkeep", step: 0.001, min: 0 },
    { key: "moveCost", label: "Move cost (× speed²)", step: 0.005, min: 0 },
    { key: "maxSpeed", label: "Default max speed", step: 0.25, min: 0.1 },
    { key: "sensorRange", label: "Default sensor range", step: 10, min: 10 },
  ]],
  ["Realism", [
    { key: "sizeScaling", label: "Size scaling (Kleiber)", bool: true },
    { key: "acceleration", label: "Acceleration (0 = instant)", step: 0.05, min: 0 },
    { key: "sensorNoise", label: "Sensor noise (σ)", step: 0.01, min: 0, max: 1 },
    { key: "senseSpeed", label: "Sense own speed", bool: true },
    { key: "senseFoodAmount", label: "Sense food amount", bool: true },
    { key: "senseCrowd", label: "Sense crowding", bool: true },
  ]],
  ["Evolution", [
    { key: "eliteCount", label: "Elites kept", step: 1, min: 0, int: true },
    { key: "tournamentSize", label: "Tournament size", step: 1, min: 1, int: true },
    { key: "mutationRate", label: "Mutation rate", step: 0.01, min: 0, max: 1 },
    { key: "mutationSigma", label: "Mutation size (σ)", step: 0.05, min: 0 },
    { key: "crossoverRate", label: "Crossover rate", step: 0.05, min: 0, max: 1 },
    { key: "episodesPerGeneration", label: "Episodes / generation", step: 1, min: 1, max: 10, int: true },
  ]],
];

/** Builds the settings form; calls onApply with a full config when the user restarts. */
export class SettingsForm {
  private inputs = new Map<keyof SimConfig, HTMLInputElement | HTMLSelectElement>();

  constructor(
    form: HTMLFormElement,
    private onApply: (cfg: SimConfig) => void,
    private presets: Preset[] = [{ name: "Default", config: DEFAULT_CONFIG }],
  ) {
    // Preset picker: fills the form; nothing changes until "Apply & restart".
    const pl = document.createElement("label");
    pl.htmlFor = "set-preset";
    pl.textContent = "Load preset";
    const ps = document.createElement("select");
    ps.id = "set-preset";
    for (const [k, p] of presets.entries()) ps.append(new Option(p.name, String(k)));
    ps.addEventListener("change", () => this.load(presets[Number(ps.value)].config));
    form.append(pl, ps);

    for (const [title, fields] of SECTIONS) {
      const sec = document.createElement("div");
      sec.className = "section";
      sec.textContent = title;
      form.append(sec);
      for (const f of fields) {
        const id = `set-${f.key}`;
        const label = document.createElement("label");
        label.htmlFor = id;
        label.textContent = f.label;
        if (f.choices) {
          const sel = document.createElement("select");
          sel.id = id;
          for (const [v, l] of f.choices) sel.append(new Option(l, v));
          form.append(label, sel);
          this.inputs.set(f.key, sel);
          continue;
        }
        const input = document.createElement("input");
        input.id = id;
        if (f.bool) {
          input.type = "checkbox";
          input.className = "check";
        } else {
          // Only `step` (what the arrow keys add). No min/max attributes and no
          // browser validation: the browser's step check rejects perfectly good
          // values (e.g. 100 with min 2 / step 10, or 0.6 with step 0.1 due to
          // floating point). Ranges are checked in validate() instead.
          input.type = "number";
          input.step = String(f.step ?? 1);
          input.inputMode = "decimal";
          const range = f.min !== undefined && f.max !== undefined ? `${f.min} to ${f.max}`
            : f.min !== undefined ? `at least ${f.min}` : f.max !== undefined ? `at most ${f.max}` : "";
          if (range) input.title = `Allowed: ${range}`;
          input.addEventListener("input", () => input.classList.remove("invalid"));
        }
        form.append(label, input);
        this.inputs.set(f.key, input);
      }
    }
    form.noValidate = true;
    this.errorEl = document.createElement("p");
    this.errorEl.className = "form-error";
    this.errorEl.hidden = true;
    form.append(this.errorEl);

    const actions = document.createElement("div");
    actions.className = "actions";
    const apply = document.createElement("button");
    apply.type = "submit";
    apply.className = "primary";
    apply.textContent = "Apply & restart";
    const reset = document.createElement("button");
    reset.type = "button";
    reset.textContent = "Defaults";
    actions.append(apply, reset);
    form.append(actions);

    reset.addEventListener("click", () => {
      ps.value = "0";
      this.load(this.presets[0].config);
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!this.validate()) return;
      this.onApply(this.read());
    });
  }

  private errorEl: HTMLParagraphElement;

  /** Check every number field is a finite value within its range; show what's wrong. */
  private validate(): boolean {
    const problems: string[] = [];
    let first: HTMLInputElement | null = null;
    for (const [, fields] of SECTIONS) {
      for (const f of fields) {
        if (f.bool || f.choices) continue;
        const input = this.inputs.get(f.key) as HTMLInputElement;
        const v = Number(input.value);
        let msg: string | null = null;
        if (input.value.trim() === "" || !Number.isFinite(v)) msg = "needs a number";
        else if (f.min !== undefined && v < f.min) msg = `must be at least ${f.min}`;
        else if (f.max !== undefined && v > f.max) msg = `must be at most ${f.max}`;
        input.classList.toggle("invalid", msg !== null);
        if (msg) {
          problems.push(`${f.label} ${msg}`);
          first ??= input;
        }
      }
    }
    this.errorEl.hidden = problems.length === 0;
    this.errorEl.textContent = problems.length ? `Please fix: ${problems.join("; ")}.` : "";
    first?.focus();
    return problems.length === 0;
  }

  private base: SimConfig = DEFAULT_CONFIG;

  /** Show a config's values in the form (e.g. after loading a run). */
  load(cfg: SimConfig): void {
    this.base = cfg;
    this.errorEl.hidden = true;
    for (const [key, input] of this.inputs) {
      input.classList.remove("invalid");
      if (input instanceof HTMLInputElement && input.type === "checkbox") input.checked = Boolean(cfg[key]);
      else input.value = String(cfg[key]);
    }
  }

  private read(): SimConfig {
    const cfg = { ...this.base };
    for (const [, fields] of SECTIONS) {
      for (const f of fields) {
        const input = this.inputs.get(f.key)!;
        if (f.choices) {
          (cfg[f.key] as string) = input.value;
          continue;
        }
        if (f.bool) {
          (cfg[f.key] as boolean) = (input as HTMLInputElement).checked;
          continue;
        }
        const v = Number(input.value);
        (cfg[f.key] as number) = f.int ? Math.round(v) : v;
      }
    }
    cfg.eliteCount = Math.min(cfg.eliteCount, cfg.creatureCount);
    return cfg;
  }
}
