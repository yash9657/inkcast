/**
 * The plot lane — the single highest-leverage thing this package can draw.
 *
 * A loss landscape, a learning-rate comparison, overfitting, compound interest
 * and supply/demand are each *one* `PlotElement`. Before this existed the IR
 * could caption an idea but never show it, which is exactly why the MVP turned
 * every topic into text in rectangles.
 *
 * Four things here are load-bearing and worth reading before changing anything:
 *
 * 1. **Curves are sampled, clipped, simplified, smoothed, then inked — in that
 *    order.** Sampling densely is what makes a parabola look like a parabola;
 *    simplifying afterwards is what makes it look hand-drawn. Roughjs perturbs
 *    every segment it is handed, so feeding it 240 one-unit segments produces 240
 *    tiny wobbles, which reads as a fuzzy line rather than a marker. Simplify to a
 *    few dozen faithful points and the wobble lands at human scale.
 *
 *    A plot draws **`crisp`** (see 4), and that whole argument is an accommodation
 *    of a wobble it does not have — so crisp keeps every sample. The tolerance was
 *    never about output precision; it was the scale the perturbation would smear
 *    anyway, and paying up to a stroke-width of deviation from the real function
 *    buys nothing once nothing is smearing it.
 *
 * 2. **The tangent's slope is computed from the curve, never assumed.** It is
 *    the overlay that carries the whole intuition behind a gradient: slope up to
 *    the right means downhill is to the left, which is where the minus sign in
 *    the update rule comes from. A tangent drawn at the wrong angle does not
 *    merely look wrong, it teaches the wrong thing. Function curves use a
 *    fourth-order central difference; point curves use the analytic derivative
 *    of the very spline that was drawn.
 *
 * 3. **Every part carries its own draw range and `at` fraction.** The renderer
 *    reveals strokes in order, and overlays land on the words that introduce
 *    them, so `PlotLayout.parts` maps contiguous draw-sequence indices to the
 *    fraction of the scene at which they should appear.
 *
 * 4. **The plot is crisp, all of it** — `resolvePlot` sets the mode once and every
 *    context inside it inherits. A curve is the obvious case, but an axis, a tick
 *    and a marked point are all things a learner reads a coordinate against, and a
 *    wobbling axis under an exact curve is worse than either choice made
 *    consistently. The handwriting is untouched: labels come from the text lane,
 *    which is a real font either way, so a crisp plot still sits on a hand-drawn
 *    board rather than turning that board into a chart. See `DrawContext.ink`.
 */
import type { Curve, PlotElement, PlotOverlay } from '@inkcast/core';
import { logger } from '@inkcast/core';
import type { FontMetrics } from '@inkcast/core';
import type { DrawContext, InkPath, StrokeWeight } from './geometry.js';
import { arrowPaths, inkPaths, roughenPathData } from './geometry.js';
import type { CubicSeg } from './path.js';
import {
  catmullRomBeziers,
  catmullRomPath,
  clipPolylineToRange,
  clipSegmentToBox,
  cubicAt,
  cubicDerivativeAt,
  dashPolyline,
  simplifyPolyline,
  splitAtCorners,
} from './path.js';
import { resamplePolyline } from './motion.js';
import type { InkRole, InkStyle } from './style.js';
import { inkColour, roleFontSize, strokeWidthFor } from './style.js';
import type { Box, Pt } from './svg.js';
import { clamp, parsePath, samplePath } from './svg.js';
import { layoutText } from './text.js';
import type { InkItem } from './writer.js';
import { pathItems, textItem } from './writer.js';

const log = logger('visuals:plot');

/* ======================================================================== */
/*                            NAMED CURVE FUNCTIONS                          */
/* ======================================================================== */

/**
 * PARAMETER REFERENCE — `Curve.fn.params` is **positional**, and any trailing
 * entry may be omitted to take its default. The planner writes these numbers, so
 * this block is the contract; `describeCurveFunctions()` renders it as text for
 * an LLM prompt and `CURVE_FUNCTIONS` exposes it as data.
 *
 * | name       | params                | formula                                   |
 * | ---------- | --------------------- | ----------------------------------------- |
 * | parabola   | a=1, h=0, k=0         | a·(x−h)² + k                              |
 * | line       | m=1, c=0              | m·x + c                                   |
 * | sigmoid    | k=1, x0=0, L=1        | L / (1 + e^(−k·(x−x0)))                   |
 * | gaussian   | mu=0, sigma=1, A=1    | A·e^(−(x−mu)² / (2·sigma²))               |
 * | sine       | A=1, f=1, phase=0     | A·sin(2π·f·x + phase)                     |
 * | exp        | A=1, k=1, c=0         | A·e^(k·x) + c                             |
 * | log        | A=1, x0=0, base=e     | A·log_base(x − x0)   — undefined at x ≤ x0 |
 * | doubleWell | a=1, b=1, tilt=0.35, k=0.4 | a·((x/b)²−1)² + tilt·(x/b) + k       |
 * | step       | x0=0, lo=0, hi=1      | x < x0 ? lo : hi                          |
 *
 * Notes that matter when choosing numbers:
 *
 * - **parabola** is the default loss bowl. `a` sets how tight the bowl is, the
 *   vertex sits at `(h, k)`, and a negative `a` gives a dome instead.
 * - **sigmoid** `k` is steepness at the midpoint `x0`; `L` is the upper
 *   asymptote. Over a domain of roughly `x0 ± 6/k` you see the whole S.
 * - **log** is undefined at and below `x0`; the sampler simply stops there
 *   rather than drawing a spike, so a domain starting at `x0` is safe.
 * - **doubleWell** exists to show *local versus global* minima, so the default
 *   `tilt` is deliberately non-zero: the wells near `x = ±b` sit at **different
 *   heights**, with the left one lower. `tilt = 0` would make them equal and
 *   destroy the point of the function. The default `k` lifts both wells above
 *   zero so the curve reads as a loss. A domain of about `±2b` shows both wells
 *   and the ridge between them.
 * - **step** is genuinely discontinuous; the sampler draws the vertical riser at
 *   `x0` instead of a diagonal ramp.
 */
export type CurveFnName = NonNullable<Curve['fn']>['name'];

export type CurveFnDoc = {
  /** Positional parameter names, in order. */
  params: string[];
  /** Default value for each parameter. */
  defaults: number[];
  /** The formula, in the same notation as the table above. */
  formula: string;
  /** What it is for, in one line — this is what the planner reads. */
  summary: string;
};

export const CURVE_FUNCTIONS: Record<CurveFnName, CurveFnDoc> = {
  parabola: {
    params: ['a', 'h', 'k'],
    defaults: [1, 0, 0],
    formula: 'a*(x-h)^2 + k',
    summary: 'A bowl with its vertex at (h, k); a sets the tightness, negative a gives a dome.',
  },
  line: {
    params: ['m', 'c'],
    defaults: [1, 0],
    formula: 'm*x + c',
    summary: 'A straight line of slope m through intercept c.',
  },
  sigmoid: {
    params: ['k', 'x0', 'L'],
    defaults: [1, 0, 1],
    formula: 'L / (1 + exp(-k*(x - x0)))',
    summary: 'An S-curve saturating at L, steepness k, midpoint x0.',
  },
  gaussian: {
    params: ['mu', 'sigma', 'A'],
    defaults: [0, 1, 1],
    formula: 'A*exp(-(x - mu)^2 / (2*sigma^2))',
    summary: 'A bell centred on mu with spread sigma and peak height A.',
  },
  sine: {
    params: ['A', 'f', 'phase'],
    defaults: [1, 1, 0],
    formula: 'A*sin(2*pi*f*x + phase)',
    summary: 'A wave of amplitude A and frequency f cycles per x unit.',
  },
  exp: {
    params: ['A', 'k', 'c'],
    defaults: [1, 1, 0],
    formula: 'A*exp(k*x) + c',
    summary: 'Exponential growth (k > 0) or decay (k < 0), offset by c.',
  },
  log: {
    params: ['A', 'x0', 'base'],
    defaults: [1, 0, Math.E],
    formula: 'A*log_base(x - x0)',
    summary: 'A logarithm, undefined at and below x0; diminishing returns.',
  },
  doubleWell: {
    params: ['a', 'b', 'tilt', 'k'],
    defaults: [1, 1, 0.35, 0.4],
    formula: 'a*((x/b)^2 - 1)^2 + tilt*(x/b) + k',
    summary:
      'Two valleys near x = -b and x = +b at DIFFERENT heights (left is the global minimum, ' +
      'right is a local one) with a ridge between them. Use it to show local vs global minima.',
  },
  step: {
    params: ['x0', 'lo', 'hi'],
    defaults: [0, 0, 1],
    formula: 'x < x0 ? lo : hi',
    summary: 'A hard jump from lo to hi at x0, drawn with a vertical riser.',
  },
};

/** The parameter table as prose, for a planner prompt. */
export function describeCurveFunctions(): string {
  return (Object.keys(CURVE_FUNCTIONS) as CurveFnName[])
    .map((name) => {
      const doc = CURVE_FUNCTIONS[name];
      const args = doc.params.map((p, i) => `${p}=${doc.defaults[i] ?? 0}`).join(', ');
      return `${name}(${args}) = ${doc.formula} — ${doc.summary}`;
    })
    .join('\n');
}

function param(params: number[], index: number, dflt: number): number {
  const v = params[index];
  return typeof v === 'number' && Number.isFinite(v) ? v : dflt;
}

/** A named function plus the x values where it is discontinuous or undefined. */
type FnSpec = {
  f: (x: number) => number | undefined;
  /** x values needing a sample on each side (a step's riser). */
  breaks: number[];
};

function fnSpec(name: CurveFnName, params: number[]): FnSpec {
  const d = CURVE_FUNCTIONS[name].defaults;
  const p = (i: number): number => param(params, i, d[i] ?? 0);
  switch (name) {
    case 'line': {
      const m = p(0);
      const c = p(1);
      return { f: (x) => m * x + c, breaks: [] };
    }
    case 'sigmoid': {
      const k = p(0);
      const x0 = p(1);
      const L = p(2);
      return { f: (x) => L / (1 + Math.exp(-k * (x - x0))), breaks: [] };
    }
    case 'gaussian': {
      const mu = p(0);
      const sigma = p(1) === 0 ? 1 : p(1);
      const A = p(2);
      return {
        f: (x) => A * Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma)),
        breaks: [],
      };
    }
    case 'sine': {
      const A = p(0);
      const f = p(1);
      const phase = p(2);
      return { f: (x) => A * Math.sin(2 * Math.PI * f * x + phase), breaks: [] };
    }
    case 'exp': {
      const A = p(0);
      const k = p(1);
      const c = p(2);
      return { f: (x) => A * Math.exp(k * x) + c, breaks: [] };
    }
    case 'log': {
      const A = p(0);
      const x0 = p(1);
      const base = p(2);
      const denom = base > 0 && base !== 1 ? Math.log(base) : 1;
      return {
        f: (x) => (x - x0 <= 0 ? undefined : (A * Math.log(x - x0)) / denom),
        breaks: [],
      };
    }
    case 'doubleWell': {
      const a = p(0);
      const b = p(1) === 0 ? 1 : p(1);
      const tilt = p(2);
      const k = p(3);
      return {
        f: (x) => {
          const u = x / b;
          return a * (u * u - 1) ** 2 + tilt * u + k;
        },
        breaks: [],
      };
    }
    case 'step': {
      const x0 = p(0);
      const lo = p(1);
      const hi = p(2);
      return { f: (x) => (x < x0 ? lo : hi), breaks: [x0] };
    }
    default: {
      const a = p(0);
      const h = p(1);
      const k = p(2);
      return { f: (x) => a * (x - h) ** 2 + k, breaks: [] };
    }
  }
}

/**
 * Fourth-order central difference, degrading to a second-order one-sided
 * difference at the edge of where the function is defined.
 *
 * `f'(x) ≈ [f(x−2h) − 8f(x−h) + 8f(x+h) − f(x+2h)] / 12h` is exact for any
 * polynomial up to degree four and accurate to ~1e-12 for everything else here,
 * which is what lets the tangent overlay be checked against a real derivative.
 */
function numericSlope(
  f: (x: number) => number | undefined,
  x: number,
  h0: number,
): number | undefined {
  const start = Math.abs(h0) > 0 ? Math.abs(h0) : 1e-3;
  for (let h = start; h > start * 1e-6; h /= 4) {
    const a = f(x - 2 * h);
    const b = f(x - h);
    const c = f(x + h);
    const dd = f(x + 2 * h);
    if (a !== undefined && b !== undefined && c !== undefined && dd !== undefined) {
      return (a - 8 * b + 8 * c - dd) / (12 * h);
    }
    const mid = f(x);
    if (mid === undefined) continue;
    if (c !== undefined && dd !== undefined) return (-3 * mid + 4 * c - dd) / (2 * h);
    if (b !== undefined && a !== undefined) return (3 * mid - 4 * b + a) / (2 * h);
  }
  return undefined;
}

/* ======================================================================== */
/*                              CURVE EVALUATION                            */
/* ======================================================================== */

/** A curve reduced to something we can ask questions of, in data space. */
export type CurveEval = {
  id: string;
  /** y at x, or `undefined` where the curve is not defined. */
  at(x: number): number | undefined;
  /** dy/dx at x, or `undefined`. */
  slopeAt(x: number): number | undefined;
  /** Dense samples over [x0, x1], split into runs wherever the curve is undefined. */
  samples(x0: number, x1: number, count?: number): Pt[][];
};

/* ---- the shared spline, evaluated rather than only serialised ------------ */

/**
 * Evaluator for a curve given as explicit samples.
 *
 * The cubics come from `catmullRomBeziers` — the *same* construction the path
 * lane serialises and the motion lane flattens — so `slopeAt` returns the slope
 * of the curve that is genuinely on the board, not of some other interpolant that
 * happens to share the waypoints. That equivalence is the whole reason the
 * smoothing lives in one place.
 *
 * Points are sorted by x, so each cubic is monotone enough in x to invert by
 * bisection; 48 halvings is exact to well past float precision.
 */
function pointCurveEval(id: string, points: Pt[]): CurveEval {
  const sorted = points
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .slice()
    .sort((a, b) => a.x - b.x);
  const pts: Pt[] = [];
  for (const p of sorted) {
    const last = pts[pts.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-12) continue;
    pts.push(p);
  }
  const segs = pts.length >= 2 ? catmullRomBeziers(pts) : [];
  if (segs.length === 0) {
    return { id, at: () => undefined, slopeAt: () => undefined, samples: () => [] };
  }
  const first = pts[0] as Pt;
  const last = pts[pts.length - 1] as Pt;

  const solve = (x: number): { seg: CubicSeg; t: number } | undefined => {
    if (x < first.x - 1e-9 || x > last.x + 1e-9) return undefined;
    let seg = segs[segs.length - 1] as CubicSeg;
    for (const s of segs) {
      if (x <= s.p1.x + 1e-9) {
        seg = s;
        break;
      }
    }
    let lo = 0;
    let hi = 1;
    let t = 0.5;
    for (let i = 0; i < 48; i++) {
      t = (lo + hi) / 2;
      if (cubicAt(seg, t).x < x) lo = t;
      else hi = t;
    }
    return { seg, t };
  };

  const at = (x: number): number | undefined => {
    const hit = solve(x);
    return hit ? cubicAt(hit.seg, hit.t).y : undefined;
  };
  return {
    id,
    at,
    slopeAt: (x) => {
      const hit = solve(x);
      if (!hit) return undefined;
      const d = cubicDerivativeAt(hit.seg, hit.t);
      if (Math.abs(d.x) < 1e-12) return undefined;
      return d.y / d.x;
    },
    samples: (x0, x1, count = DEFAULT_SAMPLES) => sampleByX(at, x0, x1, count, []),
  };
}

function fnCurveEval(id: string, name: CurveFnName, params: number[]): CurveEval {
  const spec = fnSpec(name, params);
  return {
    id,
    at: (x) => {
      const v = spec.f(x);
      return v === undefined || !Number.isFinite(v) ? undefined : v;
    },
    slopeAt: (x) => {
      for (const b of spec.breaks) {
        // Honest answer at a genuine discontinuity: there is no slope there.
        if (Math.abs(x - b) < 1e-9) return undefined;
      }
      const s = numericSlope(
        (v) => {
          const y = spec.f(v);
          return y === undefined || !Number.isFinite(y) ? undefined : y;
        },
        x,
        1e-3,
      );
      return s === undefined || !Number.isFinite(s) ? undefined : s;
    },
    samples: (x0, x1, count = DEFAULT_SAMPLES) =>
      sampleByX(
        (x) => {
          const v = spec.f(x);
          return v === undefined || !Number.isFinite(v) ? undefined : v;
        },
        x0,
        x1,
        count,
        spec.breaks,
      ),
  };
}

/** Samples per curve. Dense enough that a parabola has no visible facets. */
export const DEFAULT_SAMPLES = 240;

function sampleByX(
  f: (x: number) => number | undefined,
  x0: number,
  x1: number,
  count: number,
  breaks: number[],
): Pt[][] {
  const steps = Math.max(8, Math.floor(count));
  const span = x1 - x0;
  const xs: number[] = [];
  for (let i = 0; i <= steps; i++) xs.push(x0 + (span * i) / steps);
  // A discontinuity needs a sample on each side so the riser is vertical, not a
  // diagonal ramp between whichever samples happened to straddle it.
  const eps = Math.abs(span) * 1e-9 || 1e-12;
  for (const b of breaks) {
    if ((b - x0) * (b - x1) <= 0) xs.push(b - eps, b + eps);
  }
  xs.sort((a, b) => (span >= 0 ? a - b : b - a));

  const runs: Pt[][] = [];
  let cur: Pt[] = [];
  for (const x of xs) {
    const y = f(x);
    if (y === undefined) {
      if (cur.length > 1) runs.push(cur);
      cur = [];
      continue;
    }
    cur.push({ x, y });
  }
  if (cur.length > 1) runs.push(cur);
  return runs;
}

/** Build an evaluator for one `Curve`. Explicit points take precedence over `fn`. */
export function curveEval(curve: Curve): CurveEval {
  if (curve.points && curve.points.length >= 2) return pointCurveEval(curve.id, curve.points);
  if (curve.fn) return fnCurveEval(curve.id, curve.fn.name, curve.fn.params);
  return pointCurveEval(curve.id, curve.points ?? []);
}

/* ======================================================================== */
/*                                 THE FRAME                                 */
/* ======================================================================== */

/** Data space ⇄ canvas space for one plot, plus the gutters kept clear of ink. */
export type PlotFrame = {
  /** The element's declared box. */
  box: Box;
  /** The plotted area, inside the gutters that hold labels and ticks. */
  area: Box;
  xDomain: [number, number];
  yDomain: [number, number];
  /** Canvas units per data unit (signed, so reversed domains work). */
  sx: number;
  sy: number;
  /** Where the two axis lines cross, in canvas units. */
  origin: Pt;
  /** The data values the axis lines sit at. */
  anchor: { x: number; y: number };
  toCanvas(p: Pt): Pt;
  toData(p: Pt): Pt;
};

function span(domain: [number, number]): number {
  const d = domain[1] - domain[0];
  return Math.abs(d) < 1e-12 ? 1 : d;
}

/**
 * Lay out the frame.
 *
 * Gutters are sized from the *type scale*, not guessed: a tick label is a
 * caption and an axis label is a label, so the space reserved is exactly the
 * space the handwriting lane will use. They are then scaled back if they would
 * eat more than half the box, because a small plot with correct labels beats a
 * correct plot with no room to draw in.
 */
export function plotFrame(
  el: Pick<PlotElement, 'at' | 'xDomain' | 'yDomain' | 'xLabel' | 'yLabel' | 'axes' | 'ticks'>,
  opts: { canvasHeight: number; typeSizes?: PlotTypeSizes },
): PlotFrame {
  const box = el.at;
  const cap = opts.typeSizes?.caption ?? roleFontSize('caption', opts.canvasHeight);
  const lab = opts.typeSizes?.label ?? roleFontSize('label', opts.canvasHeight);
  const base = Math.min(box.w, box.h) * 0.05;
  const showX = el.axes === 'both' || el.axes === 'x';
  const showY = el.axes === 'both' || el.axes === 'y';

  let left = base;
  let right = base;
  let top = base;
  let bottom = base;
  if (el.ticks && showY) left += cap * 2.1;
  if (el.ticks && showX) bottom += cap * 1.4;
  if (el.xLabel) bottom += lab * 1.5;
  if (el.yLabel) top += lab * 1.6;

  // Never let the labels squeeze the drawing below half the box.
  const shrink = (need: number, have: number): number => (need > have ? have / need : 1);
  const kx = shrink(left + right, box.w * 0.5);
  const ky = shrink(top + bottom, box.h * 0.5);
  left *= kx;
  right *= kx;
  top *= ky;
  bottom *= ky;

  const area: Box = {
    x: box.x + left,
    y: box.y + top,
    w: Math.max(1, box.w - left - right),
    h: Math.max(1, box.h - top - bottom),
  };

  const xDomain: [number, number] = [el.xDomain[0], el.xDomain[1]];
  const yDomain: [number, number] = [el.yDomain[0], el.yDomain[1]];
  const sx = area.w / span(xDomain);
  const sy = area.h / span(yDomain);
  const toCanvas = (p: Pt): Pt => ({
    x: area.x + (p.x - xDomain[0]) * sx,
    y: area.y + area.h - (p.y - yDomain[0]) * sy,
  });
  const toData = (p: Pt): Pt => ({
    x: xDomain[0] + (p.x - area.x) / (sx || 1),
    y: yDomain[0] + (area.y + area.h - p.y) / (sy || 1),
  });

  // Axes sit at the data zero when it is in range, and at the nearest edge
  // otherwise — which is what a person drawing this by hand would do.
  const anchor = {
    x: clamp(0, Math.min(xDomain[0], xDomain[1]), Math.max(xDomain[0], xDomain[1])),
    y: clamp(0, Math.min(yDomain[0], yDomain[1]), Math.max(yDomain[0], yDomain[1])),
  };
  return {
    box,
    area,
    xDomain,
    yDomain,
    sx,
    sy,
    origin: toCanvas({ x: anchor.x, y: anchor.y }),
    anchor,
    toCanvas,
    toData,
  };
}

/* ---------------------------------------------------------------- ticks --- */

/** A 1-2-5 step covering `span` in about `target` intervals. */
export function niceStep(range: number, target: number): number {
  const raw = Math.abs(range) / Math.max(1, target);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const mult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return mult * mag;
}

/** Tick values inside `domain`, on a nice step. */
export function tickValues(domain: [number, number], target = 5): number[] {
  const lo = Math.min(domain[0], domain[1]);
  const hi = Math.max(domain[0], domain[1]);
  const step = niceStep(hi - lo, target);
  const out: number[] = [];
  const start = Math.ceil(lo / step - 1e-9) * step;
  for (let v = start, i = 0; v <= hi + 1e-9 && i < 200; v += step, i++) {
    out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  }
  return out;
}

function formatTick(v: number, step: number): string {
  const decimals = clamp(Math.ceil(-Math.log10(step)), 0, 3);
  const s = v.toFixed(decimals);
  return decimals > 0 ? s.replace(/\.?0+$/, '') || '0' : s;
}

/* ======================================================================== */
/*                              PARTS AND OUTPUT                            */
/* ======================================================================== */

export type PlotPartKind =
  | 'axis'
  | 'grid'
  | 'ticks'
  | 'axis-label'
  | 'curve'
  | 'curve-label'
  | 'point'
  | 'tangent'
  | 'dropline'
  | 'shade'
  | 'annotate'
  | 'steps';

/** One revealable unit of a plot, with the draw geometry it owns. */
export type PlotPart = {
  kind: PlotPartKind;
  /** Curve id, `overlay:<index>` or a frame part name. */
  id: string;
  /** Fraction of the scene at which this part should appear. */
  at: number;
  /** `data-ink-group` on every stroke in this part. */
  group: string;
  items: InkItem[];
};

/** A part as recorded in `visuals.json`, resolved to draw-sequence indices. */
export type PlotPartRecord = {
  kind: PlotPartKind;
  id: string;
  at: number;
  group: string;
  /** First draw-sequence index this part owns. */
  from: number;
  /** Last draw-sequence index this part owns (inclusive). */
  to: number;
};

/** A curve as an arc-length-even canvas-space trace — ride a ball along it. */
export type PlotCurveTrace = {
  id: string;
  label?: string;
  accent: number;
  dashed: boolean;
  points: Pt[];
};

/** A position an overlay marked, so the renderer can move something to it. */
export type PlotMark = {
  id: string;
  kind: PlotPartKind;
  at: number;
  /** Canvas-space position. */
  point: Pt;
  /** Data-space position. */
  data: Pt;
  /** dy/dx in data space, for tangents. */
  slope?: number;
  label?: string;
};

export type PlotLayout = {
  box: Box;
  area: Box;
  xDomain: [number, number];
  yDomain: [number, number];
  origin: Pt;
  parts: PlotPartRecord[];
  curves: PlotCurveTrace[];
  marks: PlotMark[];
};

export type ResolvedPlot = {
  frame: PlotFrame;
  parts: PlotPart[];
  /** Flattened draw sequence, in reveal order. */
  items: InkItem[];
  layout: PlotLayout;
};

/* ---- palette ------------------------------------------------------------ */

/**
 * `Curve.accent` (0–5) → ink. Index 0 is the primary ink, so an unadorned plot
 * looks like one person drew it; the rest walk the style's palette. Weight moves
 * with colour because `highlight` is a yellow that vanishes at hairline.
 */
const ACCENTS: Array<{ role: InkRole; weight: StrokeWeight; opacity: number }> = [
  { role: 'primary', weight: 'normal', opacity: 1 },
  { role: 'accent', weight: 'normal', opacity: 1 },
  { role: 'secondary', weight: 'normal', opacity: 1 },
  { role: 'highlight', weight: 'bold', opacity: 1 },
  { role: 'muted', weight: 'light', opacity: 1 },
  { role: 'primary', weight: 'light', opacity: 0.7 },
];

export function curveInk(
  style: InkStyle,
  accent: number,
): { colour: string; weight: StrokeWeight; opacity: number } {
  const spec = ACCENTS[clamp(Math.round(accent), 0, ACCENTS.length - 1)] ?? ACCENTS[0];
  const chosen = spec as { role: InkRole; weight: StrokeWeight; opacity: number };
  return {
    colour: inkColour(style, chosen.role),
    weight: chosen.weight,
    opacity: style.strokeOpacity * chosen.opacity,
  };
}

/* ---- labels ------------------------------------------------------------- */

type LabelArgs = {
  text: string;
  at: Pt;
  anchorX?: 'left' | 'center' | 'right';
  anchorY?: 'top' | 'middle' | 'bottom';
  colour: string;
  fontSize: number;
  style: InkStyle;
  font: FontMetrics;
  /** Keep the label inside this box. */
  within: Box;
};

function overlapArea(a: Box, b: Box, pad: number): number {
  const w = Math.min(a.x + a.w + pad, b.x + b.w + pad) - Math.max(a.x - pad, b.x - pad);
  const h = Math.min(a.y + a.h + pad, b.y + b.h + pad) - Math.max(a.y - pad, b.y - pad);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Candidate offsets, in units of (label width + gap, label height), ordered from
 * least to most disruptive. A vertical nudge is preferred — it keeps the label
 * pointing at the same x — but purely vertical moves are not enough: a wide label
 * straddling the y axis has nowhere free above or below it, and every rung gets
 * clamped to the same spot by the element box. Sliding sideways is what actually
 * frees it.
 */
const LABEL_OFFSETS: Array<[number, number]> = [
  [0, 0],
  [0, -1.05],
  [0, 1.05],
  [-1, 0],
  [1, 0],
  [0, -2.1],
  [0, 2.1],
  [-1, -1.05],
  [1, -1.05],
  [-1, 1.05],
  [1, 1.05],
  [-1.7, 0],
  [1.7, 0],
  [0, -3.15],
  [0, 3.15],
];

/**
 * Places one-line labels, keeping them inside the element and off each other.
 *
 * "Placed clear of the ink" needs more than an offset. A tangent label, a curve
 * label and an axis arrow all want the top-right corner, and two of them
 * overlapping produced literal garbage in the first render of this module
 * ("slope +4loss"). So the placer remembers every box it has handed out and, on
 * a collision, walks a short ladder of vertical nudges before giving up — cheap,
 * deterministic, and enough because labels are single lines.
 *
 * Boxes are measured against the real font metrics, never estimated, so nothing
 * wraps and the reveal mask matches the glyphs.
 *
 * Reserved boxes are not the whole story: a *curve* is an obstacle whose bounding
 * box is the entire frame, so reserving it would leave nowhere legal. Stroke
 * geometry is therefore charged for at the resolution of its own samples through
 * `addInk`, weighted well below label-on-label — two runs of handwriting on top of
 * each other are illegible, whereas a word crossing one stroke is merely untidy,
 * and on a full plot some contact with ink is unavoidable.
 */
class LabelPlacer {
  private readonly taken: Box[] = [];
  private readonly ink: Pt[] = [];

  /** Reserve a box that is not a label (an axis arrow, say) so labels dodge it. */
  reserve(box: Box): void {
    this.taken.push(box);
  }

  /**
   * Charge for ink already on the board, so a later label dodges the curve it is
   * named after rather than lying across it.
   */
  addInk(paths: readonly InkPath[]): void {
    for (const p of paths) {
      if (p.stroke === 'none') continue;
      for (const pt of samplePath(parsePath(p.d))) this.ink.push(pt);
    }
  }

  /** A charge per stroke sample under `box`, scaled so it cannot outweigh a label. */
  private inkCost(box: Box): number {
    if (this.ink.length === 0) return 0;
    const perHit = Math.max(1, box.w * box.h) * 0.02;
    let cost = 0;
    for (const p of this.ink) {
      if (p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h) {
        cost += perHit;
      }
    }
    return cost;
  }

  place(args: LabelArgs): InkItem {
    const { text, at, style, font, fontSize } = args;
    const w = font.measure(text, fontSize, style.tracking) + fontSize * 0.25;
    const h = fontSize * 1.75;
    const ax = args.anchorX ?? 'left';
    const ay = args.anchorY ?? 'top';
    const baseX = ax === 'center' ? at.x - w / 2 : ax === 'right' ? at.x - w : at.x;
    const baseY = ay === 'middle' ? at.y - h / 2 : ay === 'bottom' ? at.y - h : at.y;
    const fit = (x: number, y: number): Box => ({
      x: clamp(x, args.within.x, Math.max(args.within.x, args.within.x + args.within.w - w)),
      y: clamp(y, args.within.y, Math.max(args.within.y, args.within.y + args.within.h - h)),
      w,
      h,
    });

    const pad = fontSize * 0.12;
    const gap = w + fontSize * 0.4;
    let box = fit(baseX, baseY);
    let bestCost = Infinity;
    const tried = new Set<string>();
    for (const [dx, dy] of LABEL_OFFSETS) {
      const candidate = fit(baseX + dx * gap, baseY + dy * h);
      // Clamping makes distinct offsets collapse onto the same box; scoring one of
      // them twice would otherwise mask the fact that nothing moved.
      const key = `${Math.round(candidate.x)}:${Math.round(candidate.y)}`;
      if (tried.has(key)) continue;
      tried.add(key);
      const cost =
        this.taken.reduce((sum, t) => sum + 40 * overlapArea(candidate, t, pad), 0) +
        this.inkCost(candidate);
      if (cost < bestCost) {
        bestCost = cost;
        box = candidate;
      }
      if (cost === 0) break;
    }
    this.taken.push(box);
    return textItem(
      layoutText(text, {
        box,
        style,
        font,
        role: 'caption',
        fontSize,
        align: 'left',
        valign: 'middle',
        colour: args.colour,
        minScale: 0.7,
      }),
    );
  }
}

/* ---- drawing helpers ---------------------------------------------------- */

function line(ctx: DrawContext, bump: number, a: Pt, b: Pt, over = {}): InkPath[] {
  return inkPaths(ctx, bump, (o) => ctx.gen.line(a.x, a.y, b.x, b.y, o), over);
}

/** A small open arrowhead at `tip`, pointing along `angle`. */
function head(ctx: DrawContext, bump: number, tip: Pt, angle: number, wing: number): InkPath[] {
  const spread = 0.44;
  return inkPaths(
    ctx,
    bump,
    (o) =>
      ctx.gen.linearPath(
        [
          [tip.x - wing * Math.cos(angle - spread), tip.y - wing * Math.sin(angle - spread)],
          [tip.x, tip.y],
          [tip.x - wing * Math.cos(angle + spread), tip.y - wing * Math.sin(angle + spread)],
        ],
        o,
      ),
    { roughness: ctx.style.roughness * 0.75 },
  );
}

function dot(ctx: DrawContext, bump: number, at: Pt, radius: number, colour: string): InkPath[] {
  return inkPaths(ctx, bump, (o) => ctx.gen.circle(at.x, at.y, radius * 2, o), {
    stroke: colour,
    fill: colour,
    fillStyle: 'solid',
    roughness: ctx.style.roughness * 0.6,
  });
}

/**
 * Roughen a canvas-space polyline as hand-drawn strokes.
 *
 * Simplify → split at corners → dash → spline → ink. See the module header
 * for why simplification comes before roughening, `splitAtCorners` for why a
 * corner must not be smoothed, and `dashPolyline` for why a dash is geometry
 * rather than a `stroke-dasharray`.
 */
function strokePolyline(
  ctx: DrawContext,
  bump: number,
  pts: Pt[],
  opts: { dashed?: boolean; strokeWidth?: number; roughness?: number } = {},
): InkPath[] {
  if (pts.length < 2) return [];
  const width = opts.strokeWidth ?? strokeWidthFor(ctx.style, ctx.weight ?? 'normal');
  // Crisp keeps every sample: the tolerance is the wobble's scale, not the
  // output's, so there is nothing to trade fidelity for. `simplifyPolyline`
  // reads a non-positive epsilon as "dedupe only", which is the one step of it
  // the spline still needs.
  const eps = ctx.ink === 'crisp' ? 0 : Math.max(1.1, ctx.style.strokeWidth * 0.35);
  const simple = simplifyPolyline(pts, eps);
  const pieces = splitAtCorners(simple.length >= 2 ? simple : pts);
  const runs = opts.dashed
    ? pieces.flatMap((piece) => dashPolyline(piece, width * 4, width * 3))
    : pieces;

  const out: InkPath[] = [];
  runs.forEach((run, i) => {
    const d = catmullRomPath(run, { precision: 2 });
    if (!d) return;
    out.push(
      ...roughenPathData(ctx, d, bump + i * 3, {
        strokeWidth: width,
        roughness: opts.roughness ?? ctx.style.roughness * 0.85,
        bowing: ctx.style.bowing * 0.8,
        preserveVertices: true,
      }),
    );
  });
  return out;
}

/** A dashed straight line, as real strokes. */
function dashedLine(ctx: DrawContext, bump: number, a: Pt, b: Pt, scale = 1): InkPath[] {
  const w = strokeWidthFor(ctx.style, ctx.weight ?? 'normal');
  const out: InkPath[] = [];
  dashPolyline([a, b], w * 2.6 * scale, w * 2.2 * scale).forEach((run, i) => {
    const p0 = run[0];
    const p1 = run[run.length - 1];
    if (!p0 || !p1) return;
    out.push(...line(ctx, bump + i * 2, p0, p1, { roughness: ctx.style.roughness * 0.5 }));
  });
  return out;
}

/**
 * Where a curve's own label goes: beside the ink at ~82% along the trace, pushed
 * out along whichever normal points away from the middle of the frame.
 */
function curveLabelAnchor(
  trace: Pt[],
  area: Box,
  offset: number,
): { at: Pt; anchorX: 'left' | 'right' } {
  const i = clamp(Math.round((trace.length - 1) * 0.82), 1, trace.length - 1);
  const here = trace[i] as Pt;
  const prev = trace[i - 1] as Pt;
  const dx = here.x - prev.x;
  const dy = here.y - prev.y;
  const len = Math.hypot(dx, dy) || 1;
  let nx = -dy / len;
  let ny = dx / len;
  const cx = area.x + area.w / 2;
  const cy = area.y + area.h / 2;
  // Flip the normal if it points back towards the centre of the frame.
  if (nx * (here.x - cx) + ny * (here.y - cy) < 0) {
    nx = -nx;
    ny = -ny;
  }
  return {
    at: { x: here.x + nx * offset, y: here.y + ny * offset },
    anchorX: nx < 0 ? 'right' : 'left',
  };
}

/* ======================================================================== */
/*                                 RESOLVE                                   */
/* ======================================================================== */

/**
 * The two type sizes a plot's layout is built from, in canvas units.
 *
 * Everything scales off these — not only the labels. The gutters are `caption * 2.1`
 * wide, a tick mark is `caption * 0.26` long, an axis arrowhead is `caption * 0.42`
 * and a marked point's radius is `caption * 0.2`. So the type size is not a finishing
 * touch applied to a finished drawing; it is the unit the drawing is measured in, and
 * a consumer that wants the geometry at a different type size must say so *here*
 * rather than rescale afterwards.
 *
 * Deriving them from `canvasHeight` — which is what happens when this is omitted —
 * assumes the whole canvas is on screen. A renderer that frames a *region* of the
 * board shows a fraction of it, so its type is quoted in output pixels through the
 * camera instead, and it passes the result in.
 */
export type PlotTypeSizes = { caption: number; label: number };

export type ResolvePlotOptions = {
  style: InkStyle;
  font: FontMetrics;
  canvasHeight: number;
  /** The element's own `enter.at`; the frame and the curves inherit it. */
  baseAt: number;
  /** Samples per curve before simplification. */
  samples?: number;
  /** Explicit type sizes. Defaults to the canvas-relative role sizes. */
  typeSizes?: PlotTypeSizes;
};

/**
 * Resolve a `PlotElement` into ordered, revealable hand-drawn geometry.
 *
 * Draw order is: frame (grid, axes, ticks, axis labels), then curves in
 * declaration order, then overlays **sorted by their `at`** — so the sequence a
 * stroke-by-stroke renderer walks is already the sequence the narration wants.
 */
export function resolvePlot(
  el: PlotElement,
  incoming: DrawContext,
  opts: ResolvePlotOptions,
): ResolvedPlot {
  // Header note 4: the whole plot is crisp, decided here rather than at the two
  // call sites so that neither can forget and no derived context has to opt in —
  // every `grouped()` below spreads this one. An explicit mode from the caller
  // still wins, which is the seam `AssetRef.ink` will arrive through.
  const ctx: DrawContext = { ...incoming, ink: incoming.ink ?? 'crisp' };
  const { style, font, canvasHeight, baseAt } = opts;
  const cap = opts.typeSizes?.caption ?? roleFontSize('caption', canvasHeight);
  const lab = opts.typeSizes?.label ?? roleFontSize('label', canvasHeight);
  const frame = plotFrame(el, { canvasHeight, typeSizes: { caption: cap, label: lab } });
  const { area } = frame;
  const showX = el.axes === 'both' || el.axes === 'x';
  const showY = el.axes === 'both' || el.axes === 'y';
  const over = Math.min(area.w, area.h) * 0.03;
  const parts: PlotPart[] = [];
  const marks: PlotMark[] = [];
  const placer = new LabelPlacer();

  const push = (kind: PlotPartKind, id: string, at: number, items: InkItem[]): void => {
    if (items.length === 0) return;
    parts.push({ kind, id, at, group: `plot:${kind}:${id}`, items });
  };
  const grouped = (
    kind: PlotPartKind,
    id: string,
    over2: Partial<DrawContext> = {},
  ): DrawContext => ({ ...ctx, group: `plot:${kind}:${id}`, ...over2 });

  const xTicks = tickValues(frame.xDomain, 5);
  const yTicks = tickValues(frame.yDomain, 5);
  const xStep = niceStep(Math.abs(span(frame.xDomain)), 5);
  const yStep = niceStep(Math.abs(span(frame.yDomain)), 5);

  /* ---- grid ------------------------------------------------------------- */
  if (el.grid) {
    const g = grouped('grid', 'grid', {
      colour: style.muted,
      weight: 'hairline',
      opacity: style.strokeOpacity * 0.4,
    });
    // Gridlines stay solid: they are already hairline at 40% opacity, and dashing
    // each of a dozen lines would multiply the stroke count by twenty for a
    // difference nobody can see behind the curve.
    const items: InkItem[] = [];
    xTicks.forEach((v, i) => {
      if (showY && Math.abs(v - frame.anchor.x) < xStep * 1e-6) return;
      const x = frame.toCanvas({ x: v, y: 0 }).x;
      items.push(...pathItems(line(g, 50 + i, { x, y: area.y }, { x, y: area.y + area.h })));
    });
    yTicks.forEach((v, i) => {
      if (showX && Math.abs(v - frame.anchor.y) < yStep * 1e-6) return;
      const y = frame.toCanvas({ x: frame.xDomain[0], y: v }).y;
      items.push(...pathItems(line(g, 70 + i, { x: area.x, y }, { x: area.x + area.w, y })));
    });
    push('grid', 'grid', baseAt, items);
  }

  /* ---- axes ------------------------------------------------------------- */
  if (showX) {
    const g = grouped('axis', 'x');
    const y = frame.origin.y;
    const from = { x: area.x - over, y };
    const to = { x: area.x + area.w + over, y };
    const items = pathItems([
      ...line(g, 1, from, to),
      ...head(g, 2, to, 0, Math.max(cap * 0.42, style.strokeWidth * 2.6)),
    ]);
    push('axis', 'x', baseAt, items);
  }
  if (showY) {
    const g = grouped('axis', 'y');
    const x = frame.origin.x;
    const from = { x, y: area.y + area.h + over };
    const to = { x, y: area.y - over };
    const items = pathItems([
      ...line(g, 3, from, to),
      ...head(g, 4, to, -Math.PI / 2, Math.max(cap * 0.42, style.strokeWidth * 2.6)),
    ]);
    push('axis', 'y', baseAt, items);
  }

  /* ---- ticks ------------------------------------------------------------ */
  if (el.ticks) {
    const g = grouped('ticks', 'ticks', { colour: style.muted, weight: 'light' });
    const items: InkItem[] = [];
    const mark = Math.max(cap * 0.26, style.strokeWidth * 1.6);
    if (showX) {
      xTicks.forEach((v, i) => {
        const p = frame.toCanvas({ x: v, y: frame.anchor.y });
        items.push(
          ...pathItems(line(g, 90 + i, { x: p.x, y: p.y - mark }, { x: p.x, y: p.y + mark })),
        );
        // Both axes' labels for the crossing value would land on the crossing
        // itself. A "0" printed across the corner where the axes meet is noise,
        // so neither axis prints it.
        if (showY && Math.abs(v - frame.anchor.x) < xStep * 1e-6) return;
        items.push(
          placer.place({
            text: formatTick(v, xStep),
            at: { x: p.x, y: p.y + mark * 1.4 },
            anchorX: 'center',
            colour: style.muted,
            fontSize: cap * 0.86,
            style,
            font,
            within: el.at,
          }),
        );
      });
    }
    if (showY) {
      yTicks.forEach((v, i) => {
        const p = frame.toCanvas({ x: frame.anchor.x, y: v });
        items.push(
          ...pathItems(line(g, 110 + i, { x: p.x - mark, y: p.y }, { x: p.x + mark, y: p.y })),
        );
        if (showX && Math.abs(v - frame.anchor.y) < yStep * 1e-6) return;
        items.push(
          placer.place({
            text: formatTick(v, yStep),
            at: { x: p.x - mark * 1.6, y: p.y },
            anchorX: 'right',
            anchorY: 'middle',
            colour: style.muted,
            fontSize: cap * 0.86,
            style,
            font,
            within: el.at,
          }),
        );
      });
    }
    push('ticks', 'ticks', baseAt, items);
  }

  /* ---- axis labels ------------------------------------------------------ */
  // Both are set horizontally: the handwriting lane writes real text with real
  // reveal masks, and a rotated run would have to give that up. A label above
  // the vertical axis is the whiteboard convention anyway.
  if (el.xLabel) {
    push('axis-label', 'x', baseAt, [
      placer.place({
        text: el.xLabel,
        at: { x: area.x + area.w / 2, y: el.at.y + el.at.h - lab * 1.5 },
        anchorX: 'center',
        colour: style.muted,
        fontSize: lab * 0.92,
        style,
        font,
        within: el.at,
      }),
    ]);
  }
  if (el.yLabel) {
    push('axis-label', 'y', baseAt, [
      placer.place({
        text: el.yLabel,
        at: { x: frame.origin.x - lab * 0.2, y: area.y - lab * 0.35 },
        anchorX: 'left',
        anchorY: 'bottom',
        colour: style.muted,
        fontSize: lab * 0.92,
        style,
        font,
        within: el.at,
      }),
    ]);
  }

  // Reserve a corridor along each axis line, but only *after* the frame's own
  // labels are placed: tick labels belong right next to the axis, whereas a curve
  // or overlay label lying across it is always a mistake.
  const corridor = cap * 0.8;
  if (showX) {
    placer.reserve({
      x: area.x - over,
      y: frame.origin.y - corridor / 2,
      w: area.w + over * 2,
      h: corridor,
    });
  }
  if (showY) {
    placer.reserve({
      x: frame.origin.x - corridor / 2,
      y: area.y - over,
      w: corridor,
      h: area.h + over * 2,
    });
  }

  /* ---- curves ----------------------------------------------------------- */
  const evals = new Map<string, CurveEval>();
  const traces: PlotCurveTrace[] = [];
  el.curves.forEach((curve, ci) => {
    const ev = curveEval(curve);
    evals.set(curve.id, ev);
    const ink = curveInk(style, curve.accent);
    const g = grouped('curve', curve.id, {
      colour: ink.colour,
      weight: ink.weight,
      opacity: ink.opacity,
    });
    const runs = ev.samples(frame.xDomain[0], frame.xDomain[1], opts.samples ?? DEFAULT_SAMPLES);
    const yLo = Math.min(frame.yDomain[0], frame.yDomain[1]);
    const yHi = Math.max(frame.yDomain[0], frame.yDomain[1]);
    const visible: Pt[][] = [];
    for (const run of runs) {
      for (const clipped of clipPolylineToRange(run, yLo, yHi)) {
        visible.push(clipped.map((p) => frame.toCanvas(p)));
      }
    }
    const items: InkItem[] = [];
    const drawn: InkPath[] = [];
    visible.forEach((pts, i) => {
      drawn.push(
        ...strokePolyline(g, 130 + ci * 4 + i, pts, {
          dashed: curve.dashed,
          strokeWidth: strokeWidthFor(style, ink.weight),
        }),
      );
    });
    items.push(...pathItems(drawn));
    push('curve', curve.id, baseAt, items);
    // The curve is now an obstacle: its own label, and every overlay label after
    // it, must dodge the ink rather than lie across it.
    placer.addInk(drawn);

    // The longest visible run is the trace: a ball must not teleport across a
    // gap where the curve left the frame.
    const longest = visible.reduce<Pt[]>((best, r) => (r.length > best.length ? r : best), []);
    if (longest.length >= 2) {
      traces.push({
        id: curve.id,
        ...(curve.label ? { label: curve.label } : {}),
        accent: curve.accent,
        dashed: curve.dashed,
        points: resamplePolyline(longest, 96),
      });
      // A curve named the same as the axis it is plotted against is the axis label
      // written twice. Four of the benchmark's plots printed "loss" beside the
      // y-axis *and* beside the trace, and a learner reading two identical captions
      // goes looking for the distinction between them.
      //
      // The same applies when the two names merely *differ*, so long as there is
      // only one curve: then both are names for the vertical axis, and two different
      // words for one quantity is worse than two identical ones — the benchmark
      // labelled the axis "height" and the trace "loss" and left the learner to
      // guess whether those were the same measurement. With several curves the
      // labels are doing real work, telling the traces apart, and the axis names the
      // quantity they share.
      const sole = el.curves.length === 1 && Boolean(el.yLabel);
      const redundant =
        curve.label !== undefined &&
        (sole || curve.label.trim().toLowerCase() === el.yLabel?.trim().toLowerCase());
      if (curve.label && !redundant) {
        // Label at ~82% along the curve rather than at its end: the end is where
        // the axis arrow, the tangent label and the frame edge all converge, and
        // it is also the least characteristic part of the shape. Offset along the
        // outward normal so the text sits beside the ink, not on it.
        const anchor = curveLabelAnchor(longest, area, cap * 1.15);
        push('curve-label', curve.id, baseAt, [
          placer.place({
            text: curve.label,
            at: anchor.at,
            anchorX: anchor.anchorX,
            anchorY: 'middle',
            colour: ink.colour,
            fontSize: cap,
            style,
            font,
            within: el.at,
          }),
        ]);
      }
    }
  });

  /* ---- overlays --------------------------------------------------------- */
  const ordered = el.overlays
    .map((o, index) => ({ o, index }))
    .sort((a, b) => a.o.at - b.o.at || a.index - b.index);

  for (const { o, index } of ordered) {
    const id = `overlay:${index}`;
    const groups = overlayItems({
      overlay: o,
      id,
      ctx,
      frame,
      evals,
      style,
      font,
      cap,
      el,
      marks,
      placer,
      bump: 200 + index * 8,
    });
    groups.forEach((items, gi) => {
      if (items.length === 0) return;
      // An overlay that resolved to several sub-parts has every one of them
      // suffixed, and they all carry the overlay's `at`: the renderer pins the first
      // to the cue and sequences the rest behind it, which is what makes a descent
      // land one hop at a time.
      push(o.kind, groups.length > 1 ? `${id}:${gi}` : id, o.at, items);
      placer.addInk(items.flatMap((it) => (it.kind === 'path' ? [it.path] : [])));
    });
  }

  /* ---- flatten ---------------------------------------------------------- */
  const items: InkItem[] = [];
  const records: PlotPartRecord[] = [];
  for (const part of parts) {
    const from = items.length;
    items.push(...part.items);
    records.push({
      kind: part.kind,
      id: part.id,
      at: part.at,
      group: part.group,
      from,
      to: items.length - 1,
    });
  }

  return {
    frame,
    parts,
    items,
    layout: {
      box: el.at,
      area,
      xDomain: frame.xDomain,
      yDomain: frame.yDomain,
      origin: frame.origin,
      parts: records,
      curves: traces,
      marks,
    },
  };
}

/* ---- overlays ----------------------------------------------------------- */

type OverlayArgs = {
  overlay: PlotOverlay;
  id: string;
  ctx: DrawContext;
  frame: PlotFrame;
  evals: Map<string, CurveEval>;
  style: InkStyle;
  font: FontMetrics;
  cap: number;
  el: PlotElement;
  marks: PlotMark[];
  placer: LabelPlacer;
  bump: number;
};

/**
 * The ink one overlay contributes, in **sub-parts**.
 *
 * Almost every overlay is a single unit and returns one group. A stepping sequence
 * is the exception and the reason this is a list: the descent is the beat, and it
 * has to arrive one hop at a time so the learner can count the moves, which means
 * each hop needs its own draw range and its own start time rather than the whole
 * staircase appearing as one reveal.
 */
function overlayItems(a: OverlayArgs): InkItem[][] {
  const { overlay, ctx, frame, style, font, cap, el, marks, placer, bump } = a;
  const grouped = (over: Partial<DrawContext> = {}): DrawContext => ({
    ...ctx,
    group: `plot:${overlay.kind}:${a.id}`,
    ...over,
  });
  const inside = (p: Pt): boolean =>
    p.x >= frame.area.x - 1 &&
    p.x <= frame.area.x + frame.area.w + 1 &&
    p.y >= frame.area.y - 1 &&
    p.y <= frame.area.y + frame.area.h + 1;

  const curveFor = (curveId: string): { ev: CurveEval; accent: number } | undefined => {
    const ev = a.evals.get(curveId);
    if (!ev) {
      log.warn(`plot overlay ${a.id} references unknown curve "${curveId}"`);
      return undefined;
    }
    const accent = el.curves.find((c) => c.id === curveId)?.accent ?? 0;
    return { ev, accent };
  };
  const radius = Math.max(style.strokeWidth * 1.45, cap * 0.2);
  /** Marked positions are ink too: a label must not sit on the dot it names. */
  const reserveDot = (p: Pt): void =>
    placer.reserve({ x: p.x - radius, y: p.y - radius, w: radius * 2, h: radius * 2 });

  switch (overlay.kind) {
    case 'point': {
      const found = curveFor(overlay.curveId);
      if (!found) return [];
      const y = found.ev.at(overlay.x);
      if (y === undefined) return [];
      const p = frame.toCanvas({ x: overlay.x, y });
      if (!inside(p)) return [];
      const ink = curveInk(style, found.accent);
      const g = grouped({ colour: style.accent });
      const items = pathItems(dot(g, bump, p, radius, style.accent));
      reserveDot(p);
      marks.push({
        id: a.id,
        kind: 'point',
        at: overlay.at,
        point: p,
        data: { x: overlay.x, y },
        ...(overlay.label ? { label: overlay.label } : {}),
      });
      if (overlay.label) {
        items.push(
          placer.place({
            text: overlay.label,
            at: { x: p.x + radius * 1.8, y: p.y - radius * 1.6 },
            anchorY: 'bottom',
            colour: ink.colour === style.ink ? style.accent : ink.colour,
            fontSize: cap,
            style,
            font,
            within: el.at,
          }),
        );
      }
      return [items];
    }

    case 'tangent': {
      const found = curveFor(overlay.curveId);
      if (!found) return [];
      const y = found.ev.at(overlay.x);
      const m = found.ev.slopeAt(overlay.x);
      if (y === undefined || m === undefined) {
        log.warn(`plot overlay ${a.id}: no slope at x=${overlay.x} on "${overlay.curveId}"`);
        return [];
      }
      // The line AT the point, with the curve's own local slope: y − y0 = m(x − x0).
      const half = Math.abs(overlay.span);
      const from = frame.toCanvas({ x: overlay.x - half, y: y - m * half });
      const to = frame.toCanvas({ x: overlay.x + half, y: y + m * half });
      const seg = clipSegmentToBox(from, to, frame.area);
      if (!seg) return [];
      const g = grouped({ colour: style.accent, weight: 'normal' });
      const items = pathItems([
        ...line(g, bump, seg[0], seg[1], { roughness: style.roughness * 0.7 }),
        ...dot(g, bump + 1, frame.toCanvas({ x: overlay.x, y }), radius, style.accent),
      ]);
      reserveDot(frame.toCanvas({ x: overlay.x, y }));
      marks.push({
        id: a.id,
        kind: 'tangent',
        at: overlay.at,
        point: frame.toCanvas({ x: overlay.x, y }),
        data: { x: overlay.x, y },
        slope: m,
        ...(overlay.label ? { label: overlay.label } : {}),
      });
      if (overlay.label) {
        // Label the upper end, so it never sits on the curve it touches.
        const upper = seg[0].y <= seg[1].y ? seg[0] : seg[1];
        const rightward = upper.x >= frame.area.x + frame.area.w * 0.6;
        items.push(
          placer.place({
            text: overlay.label,
            at: { x: upper.x + (rightward ? -cap * 0.3 : cap * 0.4), y: upper.y - cap * 0.35 },
            anchorX: rightward ? 'right' : 'left',
            anchorY: 'bottom',
            colour: style.accent,
            fontSize: cap,
            style,
            font,
            within: el.at,
          }),
        );
      }
      return [items];
    }

    case 'dropline': {
      const found = curveFor(overlay.curveId);
      if (!found) return [];
      const y = found.ev.at(overlay.x);
      if (y === undefined) return [];
      const p = frame.toCanvas({ x: overlay.x, y });
      if (!inside(p)) return [];
      const g = grouped({ colour: style.muted, weight: 'light' });
      const items: InkPath[] = [];
      if (overlay.to === 'x' || overlay.to === 'both') {
        items.push(...dashedLine(g, bump, p, { x: p.x, y: frame.origin.y }));
      }
      if (overlay.to === 'y' || overlay.to === 'both') {
        items.push(...dashedLine(g, bump + 40, p, { x: frame.origin.x, y: p.y }));
      }
      marks.push({
        id: a.id,
        kind: 'dropline',
        at: overlay.at,
        point: p,
        data: { x: overlay.x, y },
      });
      return [pathItems(items)];
    }

    case 'shade': {
      const found = curveFor(overlay.curveId);
      if (!found) return [];
      const lo = Math.min(overlay.fromX, overlay.toX);
      const hi = Math.max(overlay.fromX, overlay.toX);
      const steps = 64;
      const upper: Pt[] = [];
      for (let i = 0; i <= steps; i++) {
        const x = lo + ((hi - lo) * i) / steps;
        const y = found.ev.at(x);
        if (y !== undefined) upper.push({ x, y });
      }
      if (upper.length < 2) return [];
      const other = overlay.toCurveId ? a.evals.get(overlay.toCurveId) : undefined;
      const lower: Pt[] = [];
      for (let i = upper.length - 1; i >= 0; i--) {
        const u = upper[i] as Pt;
        const y = other ? other.at(u.x) : frame.anchor.y;
        lower.push({ x: u.x, y: y === undefined ? frame.anchor.y : y });
      }
      const yLo = Math.min(frame.yDomain[0], frame.yDomain[1]);
      const yHi = Math.max(frame.yDomain[0], frame.yDomain[1]);
      const ring = [...upper, ...lower].map((p) =>
        frame.toCanvas({ x: p.x, y: clamp(p.y, yLo, yHi) }),
      );
      const ink = curveInk(style, found.accent);
      const g = grouped({ colour: ink.colour, opacity: style.strokeOpacity * 0.5 });
      return [
        pathItems(
          inkPaths(
            g,
            bump,
            (o) =>
              g.gen.polygon(
                ring.map((p) => [p.x, p.y] as [number, number]),
                o,
              ),
            {
              fill: ink.colour,
              fillStyle: style.fillStyle,
              fillWeight: style.fillWeight * 0.8,
              hachureGap: style.hachureGap * 1.6,
              stroke: 'none',
              roughness: style.roughness * 0.9,
            },
          ),
        ),
      ];
    }

    case 'annotate': {
      const anchor = frame.toCanvas({ x: overlay.x, y: overlay.y });
      const g = grouped({ colour: style.muted, weight: 'light' });
      const items: InkItem[] = [];
      if (overlay.leaderTo) {
        const target = frame.toCanvas(overlay.leaderTo);
        const seg = clipSegmentToBox(anchor, target, el.at);
        if (seg) items.push(...pathItems(dashedLine(g, bump, seg[0], seg[1], 1.2)));
      }
      items.push(
        placer.place({
          text: overlay.text,
          at: anchor,
          anchorY: 'middle',
          colour: style.ink,
          fontSize: cap,
          style,
          font,
          within: el.at,
        }),
      );
      marks.push({
        id: a.id,
        kind: 'annotate',
        at: overlay.at,
        point: anchor,
        data: { x: overlay.x, y: overlay.y },
        label: overlay.text,
      });
      return [items];
    }

    case 'steps': {
      const found = curveFor(overlay.curveId);
      if (!found) return [];
      const stops: Pt[] = [];
      for (const x of overlay.xs) {
        const y = found.ev.at(x);
        if (y === undefined) continue;
        const p = frame.toCanvas({ x, y });
        if (!inside(p)) continue;
        stops.push(p);
        marks.push({
          id: `${a.id}:${stops.length - 1}`,
          kind: 'steps',
          at: overlay.at,
          point: p,
          data: { x, y },
        });
      }
      if (stops.length === 0) return [];
      for (const stop of stops) reserveDot(stop);
      // One part per hop, so the descent arrives a move at a time. Each hop is its
      // own ink group, matching the sub-part id the caller assigns it — the group is
      // how the renderer identifies a part's strokes, so the two must agree.
      // With more than one hop every sub-part is suffixed, including the first, so a
      // consumer can tell "hop 0 of a descent" from "the whole overlay" by the id
      // alone. A lone hop keeps the bare id.
      const multi = stops.length - 1 > 1;
      const hopId = (i: number): string => (multi ? `${a.id}:${i}` : a.id);
      const hopCtx = (i: number): DrawContext =>
        grouped({ colour: style.secondary, group: `plot:steps:${hopId(i)}` });
      const groups: InkItem[][] = [];
      // The starting marker leads the first hop rather than standing alone: a lone
      // dot appearing with nothing happening to it reads as a glitch.
      const first: InkItem[] = pathItems(
        dot(hopCtx(0), bump, stops[0] as Pt, radius, style.secondary),
      );
      for (let i = 0; i + 1 < stops.length; i++) {
        const g = hopCtx(i);
        const hop: InkItem[] = i === 0 ? first : [];
        const from = stops[i] as Pt;
        const to = stops[i + 1] as Pt;
        const gap = Math.hypot(to.x - from.x, to.y - from.y);
        if (gap > radius * 2.2) {
          // Stop the hop short of the next marker so the head is readable.
          const inset = Math.min(radius * 1.8, gap * 0.3);
          const end = {
            x: to.x - ((to.x - from.x) / gap) * inset,
            y: to.y - ((to.y - from.y) / gap) * inset,
          };
          hop.push(...pathItems(arrowPaths(from, end, 0.16, { ...g, weight: 'light' })));
        }
        hop.push(...pathItems(dot(g, bump + 2 + i, to, radius, style.secondary)));
        groups.push(hop);
      }
      // A single stop is a marked point, not a descent: keep its dot.
      if (groups.length === 0) groups.push(first);
      if (overlay.label) {
        // Positioned by the destination — that is where there is room, beyond the end
        // of the staircase — but drawn with the *first* hop, because the label names
        // the action and the action is starting. Waiting for the last hop would
        // caption a descent the learner has already watched.
        const last = stops[stops.length - 1] as Pt;
        (groups[0] as InkItem[]).push(
          placer.place({
            text: overlay.label,
            at: { x: last.x + radius * 1.8, y: last.y + radius * 1.8 },
            colour: style.secondary,
            fontSize: cap,
            style,
            font,
            within: el.at,
          }),
        );
      }
      return groups;
    }

    default:
      return [];
  }
}
