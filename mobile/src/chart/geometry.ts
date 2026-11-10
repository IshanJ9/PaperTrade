export type ChartPoint = { t: number; p: string };

export interface LinePath {
  d: string;
  xs: number[];
  ys: number[];
  min: number;
  max: number;
}

const round = (n: number) => Number(n.toFixed(2));

/**
 * Pixel geometry for a line chart. Prices arrive as strings; Number() is used here only to position
 * pixels (display), never to store or send money.
 */
export function buildLinePath(points: ChartPoint[], width: number, height: number, pad = 0): LinePath {
  if (points.length < 2) return { d: '', xs: [], ys: [], min: 0, max: 0 };
  const values = points.map((pt) => Number(pt.p));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const t0 = points[0].t;
  const span = points[points.length - 1].t - t0;
  const innerW = width - 2 * pad;
  const innerH = height - 2 * pad;

  const xs = points.map((pt, i) => round(pad + (span > 0 ? ((pt.t - t0) / span) * innerW : (i / (points.length - 1)) * innerW)));
  const ys = values.map((v) => round(max === min ? height / 2 : pad + ((max - v) / (max - min)) * innerH));
  const d = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x},${ys[i]}`).join(' ');
  return { d, xs, ys, min, max };
}

/** Index of the x coordinate closest to x (-1 for an empty list). Out-of-range x clamps to the ends. */
export function nearestIndex(xs: number[], x: number): number {
  if (xs.length === 0) return -1;
  let best = 0;
  for (let i = 1; i < xs.length; i++) {
    if (Math.abs(xs[i] - x) < Math.abs(xs[best] - x)) best = i;
  }
  return best;
}

/** Display-only percentage change between two price strings; null when the first is not a positive number. */
export function percentChange(first: string, last: string): number | null {
  const f = Number(first);
  const l = Number(last);
  if (!Number.isFinite(f) || !Number.isFinite(l) || f <= 0) return null;
  return ((l - f) / f) * 100;
}
