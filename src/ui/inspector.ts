import type { SelectedSnap } from "../worker/protocol";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Renders the selected creature's stats, ancestry chain and relatives. */
export function renderInspector(host: HTMLElement, s: SelectedSnap | null): void {
  if (!s) {
    host.replaceChildren(el("p", "muted", "Click a creature in the world."));
    return;
  }
  const rows: [string, string][] = [
    ["Status", s.alive ? "alive" : "dead"],
    ["Energy", s.energy.toFixed(1)],
    ["Speed", s.speed.toFixed(2)],
    ["Food eaten", String(s.foodEaten)],
    ["Age", `${s.age} ticks`],
    ["Distance", s.distanceTraveled.toFixed(0)],
    ["Energy spent", s.energySpent.toFixed(1)],
    ["Alignment", s.alignment === null ? "–" : s.alignment.toFixed(2)],
    ["Genome", s.genome ? `#${s.genome.id}` : "–"],
    ["Born in", s.genome ? `generation ${s.genome.generation}` : "–"],
  ];
  const dl = el("dl", "kv");
  for (const [k, v] of rows) dl.append(el("dt", undefined, k), el("dd", undefined, v));
  const parts: HTMLElement[] = [dl];

  const b = s.body;
  const box = el("div", "body-box");
  box.append(el("div", "ancestry-title", b.evolved ? "Body (evolved)" : "Body (fixed default)"));
  const bdl = el("dl", "kv");
  const brows: [string, string][] = [
    ["Max speed", b.maxSpeed.toFixed(2)],
    ["Sensor range", `${b.sensorRange.toFixed(0)} px`],
    ["Size", `${b.size.toFixed(2)}×`],
    ["Turn rate", `${((b.turnRate * 180) / Math.PI).toFixed(1)}°/tick`],
    ["Upkeep", `${b.basal.toFixed(3)} /tick`],
  ];
  for (const [k, v] of brows) bdl.append(el("dt", undefined, k), el("dd", undefined, v));
  box.append(bdl);
  parts.push(box);

  if (s.genome) {
    const box = el("div", "ancestry");
    box.append(el("div", "ancestry-title", "Ancestry (newest → oldest)"));
    const chain = el("div", "chain");
    chain.append(el("span", "chip self", `#${s.genome.id}`));
    if (!s.ancestry.length) {
      chain.append(el("span", "arrow", "←"), el("span", "chip", "random, gen 0"));
    }
    for (const a of s.ancestry) {
      chain.append(el("span", "arrow", "←"));
      const chip = el("span", "chip", `#${a.id}`);
      chip.title = `born generation ${a.generation}`;
      chain.append(chip);
    }
    if (s.ancestryMore > 0) chain.append(el("span", "arrow", "←"), el("span", "chip", `+${s.ancestryMore} older`));
    box.append(chain);
    parts.push(box);
  }

  if (s.relatives > 0) {
    const r = el("div", "relatives");
    r.append(el("i"), document.createTextNode(`${s.relatives} ${s.relatives === 1 ? "relative" : "relatives"} in the world (same great-grandparent)`));
    parts.push(r);
  }
  host.replaceChildren(...parts);
}
