import type { SelectedSnap } from "../worker/protocol";

type BrainData = NonNullable<SelectedSnap["brain"]>;

const POS = [57, 135, 229];
const NEG = [230, 103, 103];
const INPUT_LABELS = ["food L/R", "food ahead", "food near", "energy"];
const OUTPUT_LABELS = ["turn", "thrust"];

function rgba(c: number[], a: number): string {
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a.toFixed(3)})`;
}

/**
 * Live network diagram. Edge colour = weight sign (blue +, red -), thickness and
 * opacity = |weight|. Node fill = current activation.
 */
export class BrainView {
  private ctx: CanvasRenderingContext2D;
  private cssW = 0;
  private readonly cssH = 210;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
  }

  private fit(): void {
    const w = this.canvas.parentElement!.clientWidth;
    if (w === this.cssW) return;
    this.cssW = w;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${this.cssH}px`;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(this.cssH * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  clear(): void {
    this.fit();
    this.ctx.clearRect(0, 0, this.cssW, this.cssH);
    this.ctx.fillStyle = "#898781";
    this.ctx.font = "12px system-ui, sans-serif";
    this.ctx.textBaseline = "top";
    this.ctx.textAlign = "left";
    this.ctx.fillText("Click a creature to see its brain", 0, 4);
  }

  draw(b: BrainData): void {
    this.fit();
    const { ctx, cssW: W, cssH: H } = this;
    const { inputs: ni, hidden: nh, outputs: no } = b.shape;
    const w = b.weights;
    const w1 = (h: number, i: number) => w[h * ni + i];
    const w2 = (o: number, h: number) => w[nh * ni + nh + o * nh + h];
    ctx.clearRect(0, 0, W, H);

    const xIn = 74, xHid = W / 2 + 8, xOut = W - 58;
    const ys = (n: number) => Array.from({ length: n }, (_, k) => ((k + 1) * H) / (n + 1));
    const yIn = ys(ni), yHid = ys(nh), yOut = ys(no);

    const edge = (x1: number, y1: number, x2: number, y2: number, v: number) => {
      const m = Math.min(1, Math.abs(v) / 1.2);
      ctx.strokeStyle = rgba(v >= 0 ? POS : NEG, 0.12 + 0.75 * m);
      ctx.lineWidth = 0.5 + 2.5 * m;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    };
    for (let h = 0; h < nh; h++) for (let i = 0; i < ni; i++) edge(xIn, yIn[i], xHid, yHid[h], w1(h, i));
    for (let o = 0; o < no; o++) for (let h = 0; h < nh; h++) edge(xHid, yHid[h], xOut, yOut[o], w2(o, h));

    const node = (x: number, y: number, a: number) => {
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fillStyle = "#1a1a19";
      ctx.fill();
      ctx.fillStyle = rgba(a >= 0 ? POS : NEG, Math.min(1, Math.abs(a)));
      ctx.fill();
      ctx.strokeStyle = "#898781";
      ctx.lineWidth = 1;
      ctx.stroke();
    };

    ctx.font = "11px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    for (let i = 0; i < ni; i++) {
      node(xIn, yIn[i], b.inputs[i]);
      ctx.textAlign = "right";
      ctx.fillStyle = "#ffffff";
      ctx.fillText(INPUT_LABELS[i] ?? `in ${i}`, xIn - 12, yIn[i] - 6);
      ctx.fillStyle = "#898781";
      ctx.fillText(b.inputs[i].toFixed(2), xIn - 12, yIn[i] + 7);
    }
    for (let h = 0; h < nh; h++) node(xHid, yHid[h], b.hidden[h]);
    for (let o = 0; o < no; o++) {
      const raw = b.outputs[o];
      node(xOut, yOut[o], raw);
      // Show the value the body receives (thrust is remapped to 0..1).
      const shown = o === 1 ? (raw + 1) / 2 : raw;
      ctx.textAlign = "left";
      ctx.fillStyle = "#ffffff";
      ctx.fillText(OUTPUT_LABELS[o] ?? `out ${o}`, xOut + 12, yOut[o] - 6);
      ctx.fillStyle = "#898781";
      ctx.fillText(shown.toFixed(2), xOut + 12, yOut[o] + 7);
    }
  }
}
