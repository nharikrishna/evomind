export const TAU = Math.PI * 2;

/** Wrap an angle into (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = (((a + Math.PI) % TAU) + TAU) % TAU - Math.PI;
  return a === -Math.PI ? Math.PI : a;
}

/** Wrap a coordinate into [0, size). */
export function wrapCoord(v: number, size: number): number {
  const w = ((v % size) + size) % size;
  return w === size ? 0 : w;
}

/** Shortest signed delta from a to b on a ring of the given size. */
export function torusDelta(a: number, b: number, size: number): number {
  let d = b - a;
  if (d > size / 2) d -= size;
  else if (d < -size / 2) d += size;
  return d;
}

export function torusDistSq(
  ax: number, ay: number, bx: number, by: number, w: number, h: number,
): number {
  const dx = torusDelta(ax, bx, w);
  const dy = torusDelta(ay, by, h);
  return dx * dx + dy * dy;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
