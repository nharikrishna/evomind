import {
  CREATURE_STRIDE, C_AGE, C_ALIVE, C_ENERGY, C_HEADING, C_ID, C_MAXSPEED, C_RELATIVE, C_SENSOR, C_SIZE, C_X, C_Y, type WorldSnap,
} from "../worker/protocol";
import { sampleGrid } from "../sim/food";

// Creatures use hues 0-190 (red -> cyan) for energy, so food takes pink, outside that range.
const FOOD_COLOR = "#f472b6";
const SELECT_COLOR = "#ffffff";
const RELATIVE_COLOR = "#3987e5";
const SENSE_COLOR = "rgba(57, 135, 229, 0.8)";
/** Newborns get an expanding, fading ring for this many ticks. */
const BIRTH_FLASH_TICKS = 40;

/** How creatures are coloured: by energy (red→cyan), or by a trait on a one-hue ramp. */
export type ColorMode = "energy" | "age" | "size" | "speed" | "sensor";

/** Snapshot offset holding each colourable trait. */
const TRAIT_OFFSET: Record<Exclude<ColorMode, "energy">, number> = {
  age: C_AGE,
  size: C_SIZE,
  speed: C_MAXSPEED,
  sensor: C_SENSOR,
};

/** Range used for the current trait colouring (for the legend), or null in energy mode. */
export interface ColorRange {
  min: number;
  max: number;
}

/** One-hue (amber) ramp, dim → bright, so "more" always reads as "brighter". Amber stays clear of pink food. */
export function traitColor(t: number): string {
  return `hsl(38, ${(55 + 35 * t).toFixed(0)}%, ${(30 + 50 * t).toFixed(0)}%)`;
}

function torusDelta(a: number, b: number, size: number): number {
  let d = b - a;
  if (d > size / 2) d -= size;
  else if (d < -size / 2) d += size;
  return d;
}

/** Draws one WorldSnap onto a canvas, scaled to the canvas' CSS width. */
export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private scale = 1;
  private cssW = 0;
  private worldW = 0;
  private worldH = 0;
  /** Cached fertility tint (rebuilt only when the grid changes). */
  private ground: { key: string; canvas: HTMLCanvasElement } | null = null;

  constructor(readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas not supported");
    this.ctx = ctx;
  }

  /** Fit to the parent's width (and the viewport height) keeping the world's aspect. */
  private fit(snap: WorldSnap): void {
    // Measure the view column, not the fit-content wrapper (which is as wide as the canvas).
    const column = this.canvas.closest(".view") ?? this.canvas.parentElement!;
    const maxH = Math.max(180, window.innerHeight * 0.72);
    const cssW = Math.floor(Math.min(column.clientWidth, (maxH * snap.width) / snap.height));
    if (cssW === this.cssW && snap.width === this.worldW && snap.height === this.worldH) return;
    this.cssW = cssW;
    this.worldW = snap.width;
    this.worldH = snap.height;
    const cssH = Math.floor((cssW * snap.height) / snap.width);
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.canvas.width = Math.floor(cssW * dpr);
    this.canvas.height = Math.floor(cssH * dpr);
    this.scale = (cssW * dpr) / snap.width;
  }

  private groundImage(f: NonNullable<WorldSnap["fertility"]>): HTMLCanvasElement {
    const key = `${f.cols}x${f.rows}:${f.values.join(",")}`;
    if (this.ground?.key === key) return this.ground.canvas;
    const W = 96, H = 72;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext("2d")!;
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = sampleGrid(f.values, f.cols, f.rows, (x + 0.5) / W, (y + 0.5) / H);
        const o = (y * W + x) * 4;
        img.data[o] = 40;
        img.data[o + 1] = 120;
        img.data[o + 2] = 60;
        img.data[o + 3] = Math.round(v * v * 70); // squared: barren ground stays dark
      }
    }
    g.putImageData(img, 0, 0);
    this.ground = { key, canvas };
    return canvas;
  }

  /** Mouse event -> world coordinates. */
  toWorld(ev: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((ev.clientX - rect.left) / rect.width) * this.worldW,
      y: ((ev.clientY - rect.top) / rect.height) * this.worldH,
    };
  }

  draw(
    snap: WorldSnap,
    selectedId: number | null,
    sense: { x: number; y: number } | null,
    sensorRange: number = snap.sensorRange,
    colorMode: ColorMode = "energy",
    /** 0..1 strength of the fertile-ground tint (fades in lean seasons). */
    groundStrength = 1,
  ): ColorRange | null {
    this.fit(snap);
    const { ctx, scale } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const px = 1 / scale * (window.devicePixelRatio || 1);

    // Fertile ground: a faint green tint, smooth because it's upscaled from a small image.
    if (snap.fertility) {
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = Math.max(0.15, Math.min(1, groundStrength));
      ctx.drawImage(this.groundImage(snap.fertility), 0, 0, snap.width, snap.height);
      ctx.globalAlpha = 1;
    }

    // Food
    ctx.fillStyle = FOOD_COLOR;
    const f = snap.food;
    for (let k = 0; k < f.length; k += 2) {
      ctx.beginPath();
      ctx.arc(f[k], f[k + 1], 3, 0, Math.PI * 2);
      ctx.fill();
    }

    const cr = snap.creatures;

    // Trait colouring: scale to the living population's own min..max for contrast.
    let range: ColorRange | null = null;
    if (colorMode !== "energy") {
      const off = TRAIT_OFFSET[colorMode];
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < snap.count; i++) {
        const o = i * CREATURE_STRIDE;
        if (!cr[o + C_ALIVE]) continue;
        min = Math.min(min, cr[o + off]);
        max = Math.max(max, cr[o + off]);
      }
      if (min <= max) range = { min, max };
    }

    let selected: number | null = null;
    if (selectedId !== null) {
      for (let i = 0; i < snap.count; i++) if (cr[i * CREATURE_STRIDE + C_ID] === selectedId) selected = i;
    }

    // Sensor range + line to sensed food for the selected creature
    if (selected !== null && cr[selected * CREATURE_STRIDE + C_ALIVE]) {
      const o = selected * CREATURE_STRIDE;
      const x = cr[o + C_X], y = cr[o + C_Y];
      ctx.beginPath();
      ctx.arc(x, y, sensorRange, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(57, 135, 229, 0.18)";
      ctx.lineWidth = px;
      ctx.stroke();
      if (sense) {
        ctx.strokeStyle = SENSE_COLOR;
        ctx.lineWidth = 1.5 * px;
        ctx.setLineDash([4 * px, 4 * px]);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + torusDelta(x, sense.x, snap.width), y + torusDelta(y, sense.y, snap.height));
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Creatures: oriented triangles, hue = energy (red = starving, cyan = full)
    for (let i = 0; i < snap.count; i++) {
      const o = i * CREATURE_STRIDE;
      if (!cr[o + C_ALIVE]) continue;
      const x = cr[o + C_X], y = cr[o + C_Y], e = cr[o + C_ENERGY], s = cr[o + C_SIZE] || 1;
      if (range && colorMode !== "energy") {
        const v = cr[o + TRAIT_OFFSET[colorMode]];
        ctx.fillStyle = traitColor(range.max > range.min ? (v - range.min) / (range.max - range.min) : 0.5);
      } else {
        ctx.fillStyle = `hsl(${Math.round(e * 190)}, 80%, ${45 + e * 15}%)`;
      }
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(cr[o + C_HEADING]);
      ctx.scale(s, s);
      ctx.beginPath();
      ctx.moveTo(7, 0);
      ctx.lineTo(-5, 4);
      ctx.lineTo(-5, -4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Birth flash, only in the living world (lab episodes start everyone at age 0).
      const age = cr[o + C_AGE];
      if (snap.endless && age < BIRTH_FLASH_TICKS) {
        const p = age / BIRTH_FLASH_TICKS;
        ctx.strokeStyle = `rgba(255, 255, 255, ${(0.8 * (1 - p)).toFixed(3)})`;
        ctx.lineWidth = 1.5 * px;
        ctx.beginPath();
        ctx.arc(x, y, (6 + 14 * p) * Math.max(1, s), 0, Math.PI * 2);
        ctx.stroke();
      }

      if (i === selected || cr[o + C_RELATIVE]) {
        ctx.strokeStyle = i === selected ? SELECT_COLOR : RELATIVE_COLOR;
        ctx.lineWidth = (i === selected ? 2 : 1.25) * px;
        ctx.beginPath();
        ctx.arc(x, y, (i === selected ? 11 : 9) * Math.max(1, s), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    return range;
  }

  /** Id of the living creature nearest to a click (within 15 world px), or null. */
  pick(snap: WorldSnap, ev: MouseEvent): number | null {
    const p = this.toWorld(ev);
    const cr = snap.creatures;
    let best: number | null = null;
    let bestD = 15 * 15;
    for (let i = 0; i < snap.count; i++) {
      const o = i * CREATURE_STRIDE;
      if (!cr[o + C_ALIVE]) continue;
      const dx = torusDelta(p.x, cr[o + C_X], snap.width);
      const dy = torusDelta(p.y, cr[o + C_Y], snap.height);
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = cr[o + C_ID];
      }
    }
    return best;
  }
}
