/**
 * Uniform grid over a toroidal world, holding item indices plus their positions.
 * Used for nearest-food queries and eat collisions so cost doesn't scale with
 * total food count. Hot path: no callbacks, no allocation per query.
 */
export class TorusGrid {
  readonly cols: number;
  readonly rows: number;
  readonly cellW: number;
  readonly cellH: number;
  private cells: number[][];
  /** Which cell each item index currently sits in (-1 = not in grid). */
  private cellOf: number[] = [];
  private px = new Float64Array(64);
  private py = new Float64Array(64);
  /** Per-query visit stamps so wrapped rings never scan a cell twice. */
  private stamp: Uint32Array;
  private query = 0;

  /** Squared distance of the item returned by the last nearest() call. */
  foundDistSq = Infinity;

  constructor(readonly width: number, readonly height: number, cellSize: number) {
    this.cols = Math.max(1, Math.floor(width / cellSize));
    this.rows = Math.max(1, Math.floor(height / cellSize));
    this.cellW = width / this.cols;
    this.cellH = height / this.rows;
    this.cells = Array.from({ length: this.cols * this.rows }, () => []);
    this.stamp = new Uint32Array(this.cells.length);
  }

  private cellIndex(x: number, y: number): number {
    const c = Math.min(this.cols - 1, Math.floor(x / this.cellW));
    const r = Math.min(this.rows - 1, Math.floor(y / this.cellH));
    return r * this.cols + c;
  }

  insert(item: number, x: number, y: number): void {
    if (item >= this.px.length) {
      const n = Math.max(item + 1, this.px.length * 2);
      const nx = new Float64Array(n), ny = new Float64Array(n);
      nx.set(this.px);
      ny.set(this.py);
      this.px = nx;
      this.py = ny;
    }
    this.px[item] = x;
    this.py[item] = y;
    const ci = this.cellIndex(x, y);
    this.cells[ci].push(item);
    this.cellOf[item] = ci;
  }

  remove(item: number): void {
    const ci = this.cellOf[item];
    if (ci === undefined || ci < 0) return;
    const cell = this.cells[ci];
    const k = cell.indexOf(item);
    if (k >= 0) {
      cell[k] = cell[cell.length - 1];
      cell.pop();
    }
    this.cellOf[item] = -1;
  }

  /**
   * Index of the nearest item within maxDist of (x, y), or -1. Its squared
   * distance is left in `foundDistSq`.
   *
   * Searches outward ring by ring (Chebyshev rings of cells) and stops once no
   * unvisited cell can hold anything closer than the best so far. The result is
   * identical to a brute-force scan, including the lowest-index tie-break.
   */
  nearest(x: number, y: number, maxDist: number): number {
    const { cols, rows, cells, px, py, stamp, width: W, height: H } = this;
    if (++this.query === 0xffffffff) {
      stamp.fill(0);
      this.query = 1;
    }
    const q = this.query;
    const halfW = W / 2, halfH = H / 2;

    const c0 = Math.min(cols - 1, Math.floor(x / this.cellW));
    const r0 = Math.min(rows - 1, Math.floor(y / this.cellH));
    const cellMin = Math.min(this.cellW, this.cellH);
    const maxRing = Math.min(Math.ceil(maxDist / cellMin) + 1, Math.max(cols, rows));
    let best = -1;
    let bestD = maxDist * maxDist;

    for (let ring = 0; ring <= maxRing; ring++) {
      // Every cell first reached in this ring is at least (ring - 1) cells away.
      const reach = ring > 0 ? (ring - 1) * cellMin : 0;
      if (reach * reach > bestD) break;
      for (let dr = -ring; dr <= ring; dr++) {
        const step = dr === -ring || dr === ring ? 1 : 2 * ring || 1;
        let r = (r0 + dr) % rows;
        if (r < 0) r += rows;
        for (let dc = -ring; dc <= ring; dc += step) {
          let c = (c0 + dc) % cols;
          if (c < 0) c += cols;
          const ci = r * cols + c;
          if (stamp[ci] === q) continue;
          stamp[ci] = q;
          const cell = cells[ci];
          for (let k = 0; k < cell.length; k++) {
            const i = cell[k];
            let dx = px[i] - x;
            if (dx > halfW) dx -= W; else if (dx < -halfW) dx += W;
            let dy = py[i] - y;
            if (dy > halfH) dy -= H; else if (dy < -halfH) dy += H;
            const d = dx * dx + dy * dy;
            // Tie-break on index so results don't depend on visit order.
            if (d < bestD || (d === bestD && (best < 0 || i < best))) {
              best = i;
              bestD = d;
            }
          }
        }
      }
    }
    this.foundDistSq = best >= 0 ? bestD : Infinity;
    return best;
  }
}
