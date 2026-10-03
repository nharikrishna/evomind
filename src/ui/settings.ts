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
  ["World", [
    { key: "seed", label: "Seed", step: 1, min: 0, int: true },
    { key: "creatureCount", label: "Population", step: 10, min: 2, max: 1000, int: true },
    { key: "foodCount", label: "Food items", step: 5, min: 0, max: 2000, int: true },
    { key: "foodEnergy", label: "Energy per food", step: 5, min: 1 },
    { key: "respawnRate", label: "Food regrowth / tick", step: 0.005, min: 0, max: 1 },
    { key: "foodModel", label: "Food model", choices: [["plants", "Plants (patches)"], ["random", "Random scatter"]] },
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
          input.type = "number";
          input.step = String(f.step ?? 1);
          if (f.min !== undefined) input.min = String(f.min);
          if (f.max !== undefined) input.max = String(f.max);
        }
        form.append(label, input);
        this.inputs.set(f.key, input);
      }
    }
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
      if (!form.reportValidity()) return;
      this.onApply(this.read());
    });
  }

  private base: SimConfig = DEFAULT_CONFIG;

  /** Show a config's values in the form (e.g. after loading a run). */
  load(cfg: SimConfig): void {
    this.base = cfg;
    for (const [key, input] of this.inputs) {
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
