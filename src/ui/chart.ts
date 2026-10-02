import type { GenerationStats } from "../analysis/metrics";

/**
 * Small line chart for per-generation stats, drawn on canvas.
 * Follows the dataviz mark specs: 2px lines, hairline solid grid, end dot with a
 * 2px surface ring, end-value label in text ink, crosshair + one tooltip listing
 * every series, legend only when there are 2+ series.
 */

export interface SeriesSpec {
  key: keyof GenerationStats;
  label: string;
  color: string;
  /** If set, a ~10% wash shows mean ± this standard deviation (population spread). */
  sdKey?: keyof GenerationStats;
}

export interface ChartOptions {
  title: string;
  subtitle?: string;
  series: SeriesSpec[];
  format: (v: number) => string;
  /** Force the y-axis to include this range, in display units (e.g. [0, 1] for alignment). */
  yRange?: [number, number];
  /** Multiply stored values before display, e.g. radians -> degrees, so axis ticks land on round numbers. */
  scale?: number;
}

const T = {
  surface: "#1a1a19",
  grid: "#2c2c2a",
  axis: "#383835",
  muted: "#898781",
  secondary: "#c3c2b7",
};

const PAD = { left: 40, right: 48, top: 8, bottom: 22 };
const HEIGHT = 150;

function niceStep(range: number, ticks: number): number {
  const raw = range / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

export class LineChart {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tip: HTMLDivElement;
  private empty: HTMLDivElement;
  private data: GenerationStats[] = [];
  private hover: number | null = null;
  private w = 0;
  private dirty = true;
  private subEl: HTMLDivElement | null = null;

  constructor(host: HTMLElement, private opts: ChartOptions) {
    host.classList.add("chart");
    const head = document.createElement("div");
    head.className = "chart-head";
    const title = document.createElement("div");
    title.className = "chart-title";
    title.textContent = opts.title;
    head.append(title);
    if (opts.subtitle !== undefined) {
      this.subEl = document.createElement("div");
      this.subEl.className = "chart-sub";
      this.subEl.textContent = opts.subtitle;
      head.append(this.subEl);
    }
    if (opts.series.length > 1) {
      const legend = document.createElement("div");
      legend.className = "chart-legend";
      for (const s of opts.series) {
        const item = document.createElement("span");
        const key = document.createElement("i");
        key.style.background = s.color;
        item.append(key, document.createTextNode(s.label));
        legend.append(item);
      }
      head.append(legend);
    }

    const body = document.createElement("div");
    body.className = "chart-body";
    this.canvas = document.createElement("canvas");
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", opts.title);
    this.tip = document.createElement("div");
    this.tip.className = "chart-tip";
    this.tip.hidden = true;
    this.empty = document.createElement("div");
    this.empty.className = "chart-empty";
    this.empty.textContent = "Waiting for the first generation to finish…";
    body.append(this.canvas, this.tip, this.empty);
    host.append(head, body);
    this.ctx = this.canvas.getContext("2d")!;

    this.canvas.addEventListener("pointermove", (e) => this.onMove(e));
    this.canvas.addEventListener("pointerleave", () => {
      this.hover = null;
      this.tip.hidden = true;
      this.dirty = true;
    });
  }

  /** A stat in display units. */
  private val(row: GenerationStats, key: keyof GenerationStats): number {
    return row[key] * (this.opts.scale ?? 1);
  }

  setSubtitle(text: string): void {
    if (this.subEl) this.subEl.textContent = text;
  }

  setData(data: GenerationStats[]): void {
    this.data = data;
    this.dirty = true;
  }

  /** Redraw if data, size or hover changed. Call from requestAnimationFrame. */
  render(): void {
    const w = this.canvas.parentElement!.clientWidth;
    if (w !== this.w) {
      this.w = w;
      const dpr = window.devicePixelRatio || 1;
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${HEIGHT}px`;
      this.canvas.width = Math.floor(w * dpr);
      this.canvas.height = Math.floor(HEIGHT * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.dirty = true;
    }
    if (!this.dirty) return;
    this.dirty = false;
    this.draw();
  }

  private scales() {
    const d = this.data;
    const x0 = d[0].generation, x1 = Math.max(d[d.length - 1].generation, x0 + 1);
    let lo = this.opts.yRange ? this.opts.yRange[0] : 0;
    let hi = this.opts.yRange ? this.opts.yRange[1] : 0;
    for (const row of d) for (const s of this.opts.series) {
      const sd = s.sdKey ? this.val(row, s.sdKey) : 0;
      if (this.val(row, s.key) - sd < lo) lo = this.val(row, s.key) - sd;
      if (this.val(row, s.key) + sd > hi) hi = this.val(row, s.key) + sd;
    }
    if (hi === lo) hi = lo + 1;
    const step = niceStep(hi - lo, 4);
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    const iw = this.w - PAD.left - PAD.right, ih = HEIGHT - PAD.top - PAD.bottom;
    return {
      x0, x1, lo, hi, step,
      sx: (g: number) => PAD.left + ((g - x0) / (x1 - x0)) * iw,
      sy: (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * ih,
    };
  }

  private draw(): void {
    const { ctx, w } = this;
    ctx.clearRect(0, 0, w, HEIGHT);
    this.empty.hidden = this.data.length > 0;
    if (!this.data.length) return;
    const { x0, x1, lo, hi, step, sx, sy } = this.scales();

    // Grid + y ticks
    ctx.font = "11px system-ui, -apple-system, 'Segoe UI', sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    ctx.lineWidth = 1;
    for (let v = lo; v <= hi + step / 2; v += step) {
      const y = Math.round(sy(v)) + 0.5;
      ctx.strokeStyle = Math.abs(v) < step / 1e6 ? T.axis : T.grid;
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(w - PAD.right, y);
      ctx.stroke();
      ctx.fillStyle = T.muted;
      ctx.fillText(this.opts.format(v), PAD.left - 6, y);
    }
    // x ticks
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const xs = Math.max(1, niceStep(x1 - x0, Math.max(2, Math.floor((w - PAD.left - PAD.right) / 70))));
    for (let g = Math.ceil(x0 / xs) * xs; g <= x1; g += xs) {
      ctx.fillStyle = T.muted;
      ctx.fillText(String(Math.round(g)), sx(g), HEIGHT - PAD.bottom + 6);
    }

    // Spread bands (mean ± sd), drawn under the lines
    for (const s of this.opts.series) {
      if (!s.sdKey) continue;
      const sdKey = s.sdKey;
      ctx.beginPath();
      this.data.forEach((row, i) => {
        const x = sx(row.generation), y = sy(this.val(row, s.key) + this.val(row, sdKey));
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      for (let i = this.data.length - 1; i >= 0; i--) {
        const row = this.data[i];
        ctx.lineTo(sx(row.generation), sy(this.val(row, s.key) - this.val(row, sdKey)));
      }
      ctx.closePath();
      ctx.globalAlpha = 0.14;
      ctx.fillStyle = s.color;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Lines
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const s of this.opts.series) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      this.data.forEach((row, i) => {
        const x = sx(row.generation), y = sy(this.val(row, s.key));
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // End dots + end labels (selective direct labels: endpoint only)
    const last = this.data[this.data.length - 1];
    const ends = this.opts.series.map((s) => ({ s, y: sy(this.val(last, s.key)) }));
    // Labels too close together would collide; let the legend + tooltip carry them then.
    const collide = ends.length > 1 && Math.abs(ends[0].y - ends[1].y) < 13;
    for (const { s, y } of ends) {
      this.dot(sx(last.generation), y, s.color);
      if (!collide || s === this.opts.series[0]) {
        ctx.fillStyle = T.secondary;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(this.opts.format(this.val(last, s.key)), sx(last.generation) + 8, y);
      }
    }

    // Crosshair
    if (this.hover !== null) {
      const row = this.data[this.hover];
      const x = Math.round(sx(row.generation)) + 0.5;
      ctx.strokeStyle = T.muted;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, PAD.top);
      ctx.lineTo(x, HEIGHT - PAD.bottom);
      ctx.stroke();
      for (const s of this.opts.series) this.dot(x, sy(this.val(row, s.key)), s.color);
    }
  }

  private dot(x: number, y: number, color: string): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = T.surface;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  private onMove(e: PointerEvent): void {
    if (!this.data.length) return;
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const { sx } = this.scales();
    // Snap to the nearest generation (binary search over increasing x).
    let lo = 0, hi = this.data.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (sx(this.data[mid].generation) < mx) lo = mid;
      else hi = mid;
    }
    const i = Math.abs(sx(this.data[lo].generation) - mx) <= Math.abs(sx(this.data[hi].generation) - mx) ? lo : hi;
    if (i !== this.hover) {
      this.hover = i;
      this.dirty = true;
      this.fillTip(this.data[i]);
    }
    this.tip.hidden = false;
    const tx = sx(this.data[i].generation);
    const tw = this.tip.offsetWidth;
    this.tip.style.left = `${tx + 12 + tw > this.w ? tx - 12 - tw : tx + 12}px`;
  }

  private fillTip(row: GenerationStats): void {
    this.tip.replaceChildren();
    const head = document.createElement("div");
    head.className = "tip-head";
    head.textContent = `Generation ${row.generation}`;
    this.tip.append(head);
    for (const s of this.opts.series) {
      const line = document.createElement("div");
      line.className = "tip-row";
      const key = document.createElement("i");
      key.style.background = s.color;
      const val = document.createElement("strong");
      val.textContent = this.opts.format(this.val(row, s.key)) + (s.sdKey ? ` ± ${this.opts.format(this.val(row, s.sdKey))}` : "");
      const lab = document.createElement("span");
      lab.textContent = s.label;
      line.append(key, val, lab);
      this.tip.append(line);
    }
  }
}
