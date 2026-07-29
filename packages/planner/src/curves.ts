/**
 * Curve arithmetic — the reason a `plot` can teach rather than decorate.
 *
 * The storyboard IR describes a curve either as explicit samples or as a *named*
 * function with a parameter list, so the planner never has to emit a hundred
 * coordinates and the renderer never has to evaluate a string (no `eval`, no
 * injection surface, byte-identical output every run). That only works if both
 * ends agree on what the parameters mean, so the table below is the contract.
 *
 * ## Parameter conventions (shared with `@inkcast/visuals`)
 *
 * | name         | params                       | y(x)                                  |
 * | ------------ | ---------------------------- | ------------------------------------- |
 * | `parabola`   | `[a, h, k]`                  | `a(x − h)² + k`                       |
 * | `line`       | `[m, b]`                     | `m·x + b`                             |
 * | `sigmoid`    | `[k, x0, L]`                 | `L / (1 + e^(−k(x − x0)))`            |
 * | `gaussian`   | `[mu, sigma, A]`             | `A·e^(−(x − mu)² / 2σ²)`              |
 * | `sine`       | `[A, omega, phase, offset]`  | `A·sin(ω x + φ) + offset`             |
 * | `exp`        | `[A, k]`                     | `A·e^(k x)`                           |
 * | `log`        | `[A, b]`                     | `A·ln(x) + b`  (undefined for x ≤ 0)  |
 * | `doubleWell` | `[a, b, tilt, k]`            | `a x⁴ − b x² + tilt·x + k`            |
 * | `step`       | `[x0, lo, hi]`               | `x < x0 ? lo : hi`                    |
 *
 * Every parameter is optional and falls back to the default in `DEFAULTS`, so a
 * bare `{ name: 'parabola' }` is a unit bowl centred on the origin.
 *
 * `doubleWell`'s `tilt` is what makes it teach: with `tilt ≠ 0` the two wells
 * have *different* depths, which is the whole point of the local-minimum lesson —
 * descent settles in whichever one it started above, not the deeper one.
 */
import type { Curve, PlotElement } from '@inkcast/core';
import type { Point } from './elements.js';

type FnName = NonNullable<Curve['fn']>['name'];

const DEFAULTS: Record<FnName, number[]> = {
  parabola: [1, 0, 0],
  line: [1, 0],
  sigmoid: [1, 0, 1],
  gaussian: [0, 1, 1],
  sine: [1, 1, 0, 0],
  exp: [1, 1],
  log: [1, 0],
  doubleWell: [1, 2, 0, 2],
  step: [0, 0, 1],
};

/** Parameters with defaults filled in, so callers can index without guards. */
export function curveParams(name: FnName, params: number[] = []): number[] {
  const base = DEFAULTS[name];
  return base.map((d, i) => (Number.isFinite(params[i]) ? (params[i] as number) : d));
}

/** Evaluate a named function. `undefined` where it is not defined (e.g. log of 0). */
export function evalFn(name: FnName, params: number[], x: number): number | undefined {
  const p = curveParams(name, params);
  switch (name) {
    case 'parabola':
      return p[0]! * (x - p[1]!) ** 2 + p[2]!;
    case 'line':
      return p[0]! * x + p[1]!;
    case 'sigmoid':
      return p[2]! / (1 + Math.exp(-p[0]! * (x - p[1]!)));
    case 'gaussian':
      return p[2]! * Math.exp(-((x - p[0]!) ** 2) / (2 * Math.max(1e-9, p[1]!) ** 2));
    case 'sine':
      return p[0]! * Math.sin(p[1]! * x + p[2]!) + p[3]!;
    case 'exp':
      return p[0]! * Math.exp(p[1]! * x);
    case 'log':
      return x > 0 ? p[0]! * Math.log(x) + p[1]! : undefined;
    case 'doubleWell':
      return p[0]! * x ** 4 - p[1]! * x ** 2 + p[2]! * x + p[3]!;
    case 'step':
      return x < p[0]! ? p[1]! : p[2]!;
    default:
      return undefined;
  }
}

/** Linear interpolation through explicit samples, clamped at both ends. */
function interpolate(points: Point[], x: number): number | undefined {
  if (!points.length) return undefined;
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  if (x <= first.x) return first.y;
  if (x >= last.x) return last.y;
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]!;
    const b = sorted[i]!;
    if (x <= b.x) {
      const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x);
      return a.y + t * (b.y - a.y);
    }
  }
  return last.y;
}

/** y at x for either kind of curve. Samples win over `fn`, as the IR specifies. */
export function curveY(curve: Curve, x: number): number | undefined {
  if (curve.points?.length) return interpolate(curve.points, x);
  if (curve.fn) return evalFn(curve.fn.name, curve.fn.params, x);
  return undefined;
}

/** Evenly spaced samples across a domain, skipping undefined stretches. */
export function sampleCurve(curve: Curve, xDomain: [number, number], n = 96): Point[] {
  const [x0, x1] = xDomain;
  const out: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const y = curveY(curve, x);
    if (y !== undefined && Number.isFinite(y)) out.push({ x, y });
  }
  return out;
}

/**
 * Slope by symmetric difference. Analytic derivatives would be marginally more
 * accurate and considerably more code; at h = span/2000 the error is invisible
 * at whiteboard scale, and this works for sampled curves too.
 */
export function slopeAt(curve: Curve, x: number, h = 1e-3): number {
  const a = curveY(curve, x - h);
  const b = curveY(curve, x + h);
  if (a === undefined || b === undefined) {
    // One-sided fallback at a domain edge.
    const c = curveY(curve, x);
    const d = curveY(curve, x + 2 * h);
    if (c === undefined || d === undefined) return 0;
    return (d - c) / (2 * h);
  }
  return (b - a) / (2 * h);
}

/**
 * Run actual gradient descent on the curve and return the parameter value at
 * every step, including the start.
 *
 * The steps drawn on the board are therefore the algorithm the video is about,
 * not a hand-drawn impression of it: if the learning rate is too large the drawn
 * steps really do diverge, and the shortening steps near the bottom are the real
 * consequence of a flattening slope.
 */
export function descend(
  curve: Curve,
  start: number,
  learningRate: number,
  steps: number,
  clamp?: [number, number],
): number[] {
  const xs = [start];
  let x = start;
  for (let i = 0; i < steps; i++) {
    const g = slopeAt(curve, x);
    if (!Number.isFinite(g)) break;
    x = x - learningRate * g;
    if (clamp) {
      // A diverging run must stay drawable: park it on the edge of the frame
      // rather than flying off to infinity and breaking the y-domain fit.
      x = Math.min(clamp[1], Math.max(clamp[0], x));
    }
    if (!Number.isFinite(x)) break;
    xs.push(round(x, 4));
    if (Math.abs(xs[xs.length - 1]! - xs[xs.length - 2]!) < 1e-4) break;
  }
  return xs;
}

/** A y-domain that fits every curve with a little headroom, at readable bounds. */
export function fitYDomain(
  curves: Curve[],
  xDomain: [number, number],
  opts: { floorAtZero?: boolean } = {},
): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of curves) {
    for (const p of sampleCurve(c, xDomain, 64)) {
      lo = Math.min(lo, p.y);
      hi = Math.max(hi, p.y);
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (hi - lo < 1e-6) hi = lo + 1;
  const pad = (hi - lo) * 0.12;
  const bottom = opts.floorAtZero && lo >= 0 ? 0 : lo - pad;
  return [nice(bottom, 'down'), nice(hi + pad, 'up')];
}

/** Round to a friendly boundary so hand-drawn axes do not end mid-decimal. */
function nice(v: number, dir: 'up' | 'down'): number {
  if (v === 0) return 0;
  const mag = 10 ** Math.floor(Math.log10(Math.abs(v)));
  const step = mag / 2;
  const k = v / step;
  return round((dir === 'up' ? Math.ceil(k) : Math.floor(k)) * step, 4);
}

/* ------------------------------------------------------- data ⇄ canvas space */

/**
 * Map a data-space point into canvas units inside a plot's box.
 *
 * Overlays inside a `PlotElement` are expressed in data space and mapped by the
 * renderer, but anything drawn *next to* the plot — an arrow pointing downhill,
 * a ball that moves along the curve — is a sibling element in canvas units, so
 * the planner has to do the same mapping itself. Both use the plot's `at` box
 * verbatim, which keeps them registered to the axes.
 */
export function dataToCanvas(plot: PlotElement, p: Point): Point {
  const [xa, xb] = plot.xDomain;
  const [ya, yb] = plot.yDomain;
  const fx = xb === xa ? 0.5 : (p.x - xa) / (xb - xa);
  const fy = yb === ya ? 0.5 : (p.y - ya) / (yb - ya);
  return {
    x: round(plot.at.x + fx * plot.at.w, 2),
    // Canvas y grows downward; data y grows upward.
    y: round(plot.at.y + (1 - fy) * plot.at.h, 2),
  };
}

/** Canvas-space waypoints tracing a curve between two x values. */
export function curvePath(
  plot: PlotElement,
  curve: Curve,
  from: number,
  to: number,
  n = 24,
): Point[] {
  const out: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const x = from + ((to - from) * i) / n;
    const y = curveY(curve, x);
    if (y === undefined || !Number.isFinite(y)) continue;
    out.push(dataToCanvas(plot, { x, y }));
  }
  return out;
}

/** Canvas-space waypoints hopping from step to step along a curve. */
export function stepPath(plot: PlotElement, curve: Curve, xs: number[]): Point[] {
  const out: Point[] = [];
  for (const x of xs) {
    const y = curveY(curve, x);
    if (y === undefined || !Number.isFinite(y)) continue;
    out.push(dataToCanvas(plot, { x, y }));
  }
  return out;
}

export function round(v: number, dp = 3): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}
