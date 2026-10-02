import { DEFAULT_CONFIG, type SimConfig } from "../sim/config";

interface Field {
  key: keyof SimConfig;
  label: string;
  step: number;
  min: number;
  max?: number;
  int?: boolean;
}

const SECTIONS: [string, Field[]][] = [
  ["World", [
    { key: "seed", label: "Seed", step: 1, min: 0, int: true },
    { key: "creatureCount", label: "Population", step: 10, min: 2, max: 1000, int: true },
    { key: "foodCount", label: "Food items", step: 5, min: 0, max: 2000, int: true },
    { key: "foodEnergy", label: "Energy per food", step: 5, min: 1 },
    { key: "respawnRate", label: "Food regrowth / tick", step: 0.005, min: 0, max: 1 },
    { key: "episodeTicks", label: "Ticks per generation", step: 250, min: 100, int: true },
  ]],
  ["Body", [
    { key: "maxSpeed", label: "Max speed", step: 0.25, min: 0.1 },
    { key: "moveCost", label: "Move cost (× speed²)", step: 0.005, min: 0 },
    { key: "basalCost", label: "Basal cost / tick", step: 0.01, min: 0 },
    { key: "sensorRange", label: "Sensor range", step: 10, min: 10 },
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
  private inputs = new Map<keyof SimConfig, HTMLInputElement>();

  constructor(form: HTMLFormElement, private onApply: (cfg: SimConfig) => void) {
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
        const input = document.createElement("input");
        input.type = "number";
        input.id = id;
        input.step = String(f.step);
        input.min = String(f.min);
        if (f.max !== undefined) input.max = String(f.max);
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
    const defaults = document.createElement("button");
    defaults.type = "button";
    defaults.textContent = "Defaults";
    actions.append(apply, defaults);
    form.append(actions);

    defaults.addEventListener("click", () => this.load(DEFAULT_CONFIG));
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
    for (const [key, input] of this.inputs) input.value = String(cfg[key]);
  }

  private read(): SimConfig {
    const cfg = { ...this.base };
    for (const [, fields] of SECTIONS) {
      for (const f of fields) {
        const v = Number(this.inputs.get(f.key)!.value);
        (cfg[f.key] as number) = f.int ? Math.round(v) : v;
      }
    }
    cfg.eliteCount = Math.min(cfg.eliteCount, cfg.creatureCount);
    return cfg;
  }
}
