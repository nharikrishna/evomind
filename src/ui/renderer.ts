import {
  CREATURE_STRIDE, C_AGE, C_ALIVE, C_ENERGY, C_HEADING, C_ID, C_INSULATION, C_MAXSPEED, C_RELATIVE, C_SENSOR, C_SIZE, C_SPECIES, C_X, C_Y,
  type Terrain, type WorldSnap,
} from "../worker/protocol";
import { sampleGrid } from "../sim/food";
import { BIOMES, MOUNTAIN, RIVER } from "../sim/biomes";

// Creatures use hues 0-190 (red -> cyan) for energy, so food takes pink, outside that range.
const FOOD_COLOR = "#f472b6";
const SELECT_COLOR = "#ffffff";
const RELATIVE_COLOR = "#3987e5";
const SENSE_COLOR = "rgba(57, 135, 229, 0.8)";
/** Newborns get an expanding, fading ring for this many ticks. */
const BIRTH_FLASH_TICKS = 40;
/** Creatures are never drawn smaller than this many screen pixels (zoomed-out map view). */
const MIN_CREATURE_PX = 5;
const MAX_ZOOM = 12;

/** How creatures are coloured: by energy (red→cyan), by species, or by a trait on a one-hue ramp. */
export type ColorMode = "energy" | "species" | "age" | "size" | "speed" | "sensor" | "insulation";

/**
 * Stable colour per species id (golden-angle hues). Skips 290-360 so a species
 * never looks like the pink food. Identity only; there can be many species.
 */
export function speciesColor(id: number): string {
  return id < 0 ? "#898781" : `hsl(${((id * 137.508) % 290).toFixed(0)}, 65%, 58%)`;
}

/** Snapshot offset holding each colourable trait. */
const TRAIT_OFFSET: Record<Exclude<ColorMode, "energy" | "species">, number> = {
  age: C_AGE,
  size: C_SIZE,
  speed: C_MAXSPEED,
  sensor: C_SENSOR,
  insulation: C_INSULATION,
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

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Terrain images by map id, shared by all renderers (each map is only sent once). */
const terrainCache = new Map<number, { terrain: Terrain; canvas: HTMLCanvasElement }>();

export interface DrawOptions {
  selectedId: number | null;
  sense: { x: number; y: number } | null;
  sensorRange?: number;
  colorMode?: ColorMode;
  /** 0..1 strength of the fertile-ground tint (fades in lean seasons). */
  groundStrength?: number;
}

/**
 * Draws one WorldSnap onto a canvas with a camera: scroll to zoom, drag to pan,
 * double-click to fit, optional follow of the selected creature, minimap when
 * zoomed in. Click (without dragging) picks a creature.
 */
export class Renderer {
  private ctx: CanvasRenderingContext2D;
  /** Device pixels per world unit at zoom 1 (whole world fits). */
  private baseScale = 1;
  private cssW = 0;
  private cssH = 0;
  private worldW = 0;
  private worldH = 0;
  private zoom = 1;
  /** World point at the centre of the view. */
  private cx = 0;
  private cy = 0;
  follow = false;
  private ground: { key: string; canvas: HTMLCanvasElement } | null = null;

  private lastSnap: WorldSnap | null = null;
  /** Reused canvas for the vegetation layer (one pixel per cell). */
  private vegCanvas: HTMLCanvasElement | null = null;
  private drag: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;

  /** Called with the picked creature id (or null) on a click that wasn't a drag. */
  onPick: ((id: number | null) => void) | null = null;
  /** Called when the user moves the camera by hand (so the UI can turn following off). */
  onManualMove: (() => void) | null = null;

  constructor(readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas not supported");
    this.ctx = ctx;
    canvas.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener("pointerdown", (e) => this.onDown(e));
    canvas.addEventListener("pointermove", (e) => this.onMove(e));
    canvas.addEventListener("pointerup", (e) => this.onUp(e));
    canvas.addEventListener("pointercancel", () => (this.drag = null));
    canvas.addEventListener("dblclick", () => this.resetView());
  }

  get zoomed(): boolean {
    return this.zoom > 1.01;
  }

  /** Centre the camera on a world point and zoom in (e.g. a region from the table). */
  focusOn(x: number, y: number, zoom = 2.2): void {
    this.follow = false;
    this.zoom = zoom;
    this.cx = x;
    this.cy = y;
  }

  resetView(): void {
    this.zoom = 1;
    this.cx = this.worldW / 2;
    this.cy = this.worldH / 2;
  }

  /** Fit the canvas to its column (or the screen in fullscreen), keeping the world's aspect. */
  private fit(snap: WorldSnap): void {
    const view = this.canvas.closest(".view") as HTMLElement | null;
    const full = !!view && document.fullscreenElement === view;
    const availW = full ? window.innerWidth - 32 : (view ?? this.canvas.parentElement!).clientWidth;
    const availH = full ? window.innerHeight - 70 : Math.max(180, window.innerHeight * 0.72);
    const cssW = Math.floor(Math.min(availW, (availH * snap.width) / snap.height));
    const cssH = Math.floor((cssW * snap.height) / snap.width);
    if (cssW === this.cssW && cssH === this.cssH && snap.width === this.worldW && snap.height === this.worldH) return;
    const worldChanged = snap.width !== this.worldW || snap.height !== this.worldH;
    this.cssW = cssW;
    this.cssH = cssH;
    this.worldW = snap.width;
    this.worldH = snap.height;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.canvas.width = Math.floor(cssW * dpr);
    this.canvas.height = Math.floor(cssH * dpr);
    this.baseScale = (cssW * dpr) / snap.width;
    if (worldChanged) this.resetView();
  }

  private get scale(): number {
    return this.baseScale * this.zoom;
  }

  /** Keep the view inside the world. */
  private clampView(): void {
    const halfW = this.canvas.width / (2 * this.scale);
    const halfH = this.canvas.height / (2 * this.scale);
    this.cx = Math.min(this.worldW - halfW, Math.max(halfW, this.cx));
    this.cy = Math.min(this.worldH - halfH, Math.max(halfH, this.cy));
  }

  /** Canvas (device px) → world. */
  private toWorldPx(px: number, py: number): { x: number; y: number } {
    return { x: this.cx + (px - this.canvas.width / 2) / this.scale, y: this.cy + (py - this.canvas.height / 2) / this.scale };
  }

  private eventPx(ev: MouseEvent): { px: number; py: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      px: ((ev.clientX - rect.left) / rect.width) * this.canvas.width,
      py: ((ev.clientY - rect.top) / rect.height) * this.canvas.height,
    };
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const { px, py } = this.eventPx(e);
    const before = this.toWorldPx(px, py);
    this.zoom = Math.min(MAX_ZOOM, Math.max(1, this.zoom * Math.exp(-e.deltaY * 0.0015)));
    // Keep the world point under the cursor fixed.
    this.cx = before.x - (px - this.canvas.width / 2) / this.scale;
    this.cy = before.y - (py - this.canvas.height / 2) / this.scale;
    if (this.follow) {
      this.follow = false;
      this.onManualMove?.();
    }
  }

  private onDown(e: PointerEvent): void {
    this.drag = { x: e.clientX, y: e.clientY, cx: this.cx, cy: this.cy, moved: false };
    this.canvas.setPointerCapture(e.pointerId);
  }

  private onMove(e: PointerEvent): void {
    if (!this.drag) return;
    const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
    if (!this.drag.moved && Math.hypot(dx, dy) < 4) return;
    this.drag.moved = true;
    const dpr = window.devicePixelRatio || 1;
    this.cx = this.drag.cx - (dx * dpr) / this.scale;
    this.cy = this.drag.cy - (dy * dpr) / this.scale;
    this.canvas.style.cursor = "grabbing";
    if (this.follow) {
      this.follow = false;
      this.onManualMove?.();
    }
  }

  private onUp(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    this.canvas.style.cursor = "";
    if (d && !d.moved && this.lastSnap) this.onPick?.(this.pickAt(this.lastSnap, e));
  }

  /** Id of the living creature nearest to a click, or null. */
  private pickAt(snap: WorldSnap, ev: MouseEvent): number | null {
    const { px, py } = this.eventPx(ev);
    const p = this.toWorldPx(px, py);
    // Generous hit radius: at least 12 screen px.
    const radius = Math.max(15, (12 * (window.devicePixelRatio || 1)) / this.scale);
    const cr = snap.creatures;
    let best: number | null = null;
    let bestD = radius * radius;
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

  /** Biome tints plus rivers and ridges, one pixel per map cell (cached per map). */
  private terrainImage(t: Terrain): HTMLCanvasElement {
    const cached = terrainCache.get(t.mapId);
    if (cached) return cached.canvas;
    const canvas = document.createElement("canvas");
    canvas.width = t.cols;
    canvas.height = t.rows;
    const g = canvas.getContext("2d")!;
    const img = g.createImageData(t.cols, t.rows);
    const tints = BIOMES.map((b) => hexToRgb(b.color));
    for (let i = 0; i < t.biomes.length; i++) {
      const o = i * 4;
      const bar = t.barriers[i];
      if (bar === RIVER) {
        img.data.set([57, 135, 229, 170], o);
      } else if (bar === MOUNTAIN) {
        img.data.set([137, 135, 129, 150], o);
      } else {
        const [r, gr, b] = tints[t.biomes[i]];
        img.data.set([r, gr, b, 26], o);
      }
    }
    g.putImageData(img, 0, 0);
    terrainCache.set(t.mapId, { terrain: t, canvas });
    return canvas;
  }

  private vegetationImage(v: NonNullable<WorldSnap["vegetation"]>): HTMLCanvasElement {
    if (!this.vegCanvas || this.vegCanvas.width !== v.cols || this.vegCanvas.height !== v.rows) {
      this.vegCanvas = document.createElement("canvas");
      this.vegCanvas.width = v.cols;
      this.vegCanvas.height = v.rows;
    }
    const g = this.vegCanvas.getContext("2d")!;
    const img = g.createImageData(v.cols, v.rows);
    for (let i = 0; i < v.values.length; i++) {
      const t = v.values[i] / 255;
      const o = i * 4;
      img.data[o] = 30 + 20 * t;
      img.data[o + 1] = 90 + 80 * t;
      img.data[o + 2] = 45;
      img.data[o + 3] = Math.round(150 * Math.sqrt(t)); // sqrt: sparse cover still visible
    }
    g.putImageData(img, 0, 0);
    return this.vegCanvas;
  }

  /** Remember terrain sent with a snapshot (it is only sent once per world). */
  rememberTerrain(t: Terrain | null): void {
    if (t && !terrainCache.has(t.mapId)) this.terrainImage(t);
  }

  draw(snap: WorldSnap, opts: DrawOptions): ColorRange | null {
    this.lastSnap = snap;
    this.fit(snap);
    const { selectedId, sense, colorMode = "energy", groundStrength = 1 } = opts;
    const sensorRange = opts.sensorRange ?? snap.sensorRange;
    const { ctx } = this;
    const cr = snap.creatures;
    const dpr = window.devicePixelRatio || 1;

    let selected: number | null = null;
    if (selectedId !== null) {
      for (let i = 0; i < snap.count; i++) if (cr[i * CREATURE_STRIDE + C_ID] === selectedId) selected = i;
    }
    // Follow: keep the selected creature centred.
    if (this.follow && selected !== null) {
      this.cx = cr[selected * CREATURE_STRIDE + C_X];
      this.cy = cr[selected * CREATURE_STRIDE + C_Y];
      if (!this.zoomed) this.zoom = 3;
    }
    this.clampView();

    const scale = this.scale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(scale, 0, 0, scale, this.canvas.width / 2 - this.cx * scale, this.canvas.height / 2 - this.cy * scale);
    const px = dpr / scale; // one screen pixel in world units

    // Terrain: biome tints, rivers, ridges (crisp cells)
    const terrain = snap.mapId !== null ? terrainCache.get(snap.mapId) : undefined;
    if (terrain) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(terrain.canvas, 0, 0, terrain.terrain.cols * terrain.terrain.cell, terrain.terrain.rows * terrain.terrain.cell);
    }
    // Vegetation: living ground cover, brighter green = more plant biomass.
    if (snap.vegetation) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.vegetationImage(snap.vegetation), 0, 0, snap.vegetation.cols * snap.vegetation.cell, snap.vegetation.rows * snap.vegetation.cell);
    }
    // Fertile ground: a faint green tint, smooth because it's upscaled from a small image.
    if (snap.fertility) {
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = Math.max(0.15, Math.min(1, groundStrength));
      ctx.drawImage(this.groundImage(snap.fertility), 0, 0, snap.width, snap.height);
      ctx.globalAlpha = 1;
    }

    // Food (never smaller than ~2 screen px)
    ctx.fillStyle = FOOD_COLOR;
    const f = snap.food;
    const foodR = Math.max(3, 2 * px);
    for (let k = 0; k < f.length; k += 2) {
      ctx.beginPath();
      ctx.arc(f[k], f[k + 1], foodR, 0, Math.PI * 2);
      ctx.fill();
    }

    // Trait colouring: scale to the living population's own min..max for contrast.
    let range: ColorRange | null = null;
    if (colorMode !== "energy" && colorMode !== "species") {
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

    // Creatures: oriented triangles (12 world units long at size 1, but at least MIN_CREATURE_PX on screen)
    const minScale = (MIN_CREATURE_PX * px) / 12;
    for (let i = 0; i < snap.count; i++) {
      const o = i * CREATURE_STRIDE;
      if (!cr[o + C_ALIVE]) continue;
      const x = cr[o + C_X], y = cr[o + C_Y], e = cr[o + C_ENERGY];
      const s = Math.max(cr[o + C_SIZE] || 1, minScale);
      if (colorMode === "species") {
        ctx.fillStyle = speciesColor(cr[o + C_SPECIES]);
      } else if (range && colorMode !== "energy") {
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
        ctx.arc(x, y, (6 + 14 * p) * s, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (i === selected || cr[o + C_RELATIVE]) {
        ctx.strokeStyle = i === selected ? SELECT_COLOR : RELATIVE_COLOR;
        ctx.lineWidth = (i === selected ? 2 : 1.25) * px;
        ctx.beginPath();
        ctx.arc(x, y, (i === selected ? 11 : 9) * s, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Region labels (biome names), in screen-constant size
    if (terrain) {
      ctx.font = `${11 * px}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
      for (const r of terrain.terrain.regions) ctx.fillText(BIOMES[r.biome].name, r.x, r.y);
    }

    if (this.zoomed) this.drawMinimap(snap, terrain?.canvas ?? null);
    return range;
  }

  /** Small overview in the corner with the current viewport outlined. */
  private drawMinimap(snap: WorldSnap, terrain: HTMLCanvasElement | null): void {
    const { ctx } = this;
    const dpr = window.devicePixelRatio || 1;
    const w = 150 * dpr, h = (w * snap.height) / snap.width;
    const x0 = this.canvas.width - w - 8 * dpr, y0 = 8 * dpr;
    const k = w / snap.width;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "rgba(13, 13, 13, 0.85)";
    ctx.fillRect(x0, y0, w, h);
    if (terrain) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(terrain, x0, y0, w, h);
    }
    ctx.fillStyle = "rgba(230, 230, 230, 0.8)";
    const cr = snap.creatures;
    for (let i = 0; i < snap.count; i++) {
      const o = i * CREATURE_STRIDE;
      if (!cr[o + C_ALIVE]) continue;
      ctx.fillRect(x0 + cr[o + C_X] * k - dpr / 2, y0 + cr[o + C_Y] * k - dpr / 2, dpr * 1.2, dpr * 1.2);
    }
    const vw = this.canvas.width / this.scale, vh = this.canvas.height / this.scale;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = dpr;
    ctx.strokeRect(x0 + (this.cx - vw / 2) * k, y0 + (this.cy - vh / 2) * k, vw * k, vh * k);
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.strokeRect(x0, y0, w, h);
  }
}
