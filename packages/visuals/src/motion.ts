/**
 * Motion geometry — everything the renderer needs to move something along a path
 * *evenly*.
 *
 * The subtle failure this module exists to prevent: interpolating a path by its
 * parameter instead of its arc length. A Catmull-Rom segment between two close
 * waypoints and one between two distant waypoints both cover `t ∈ [0,1]`, so a
 * ball driven by `t` sprints across the long segment and crawls across the short
 * one. A learner reads that as the ball accelerating for no reason — the opposite
 * of the intuition a descending ball is supposed to carry. So we resample to
 * constant arc length once, up front, and every query after that is a lookup.
 *
 * `MotionPath` is deliberately a plain data record: the renderer serialises it
 * into the page and evaluates it per frame, so it must survive `JSON.stringify`.
 */
import type { Motion } from '@inkcast/core';
import { catmullRomBeziers, catmullRomPath, flattenCubics } from './path.js';
import type { Box, Pt, Seg } from './svg.js';
import { clamp, parsePath } from './svg.js';

/** Default number of arc-length samples. ~1 per 4 canvas units on a 1080 canvas. */
export const MOTION_SAMPLES = 256;

/**
 * A path resampled to constant arc length.
 *
 * `points[i]` sits at arc length `i/(points.length−1) × length`, so `t` is
 * genuine distance travelled and a constant `dt` is a constant speed.
 */
export type MotionPath = {
  /** Evenly spaced samples, first point at t=0 and last at t=1. */
  points: Pt[];
  /** Total arc length in canvas units. */
  length: number;
  closed: boolean;
  /** Path data for the smooth source curve — the trail, when one is wanted. */
  d: string;
};

/** Position and heading at a fraction of the way along a `MotionPath`. */
export type MotionSample = {
  point: Pt;
  /** Unit tangent, pointing forwards along the path. */
  tangent: Pt;
  /** Heading in radians, `atan2(tangent.y, tangent.x)`. */
  angle: number;
  /** Distance travelled, in canvas units. */
  distance: number;
};

function polylineLengths(pts: Pt[]): { total: number; cum: number[] } {
  const cum: number[] = [0];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Pt;
    const b = pts[i] as Pt;
    total += Math.hypot(b.x - a.x, b.y - a.y);
    cum.push(total);
  }
  return { total, cum };
}

/** Cumulative arc length of a polyline, in canvas units. */
export function polylineLength(pts: Pt[]): number {
  return polylineLengths(pts).total;
}

/**
 * Resample a polyline to `count` points spaced equally by arc length.
 *
 * Degenerate inputs (one distinct point, or zero total length) return that point
 * repeated, so callers never have to special-case an element that does not move.
 */
export function resamplePolyline(pts: Pt[], count = MOTION_SAMPLES): Pt[] {
  const clean = pts.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const target = Math.max(2, Math.floor(count));
  if (clean.length === 0) return [];
  const first = clean[0] as Pt;
  if (clean.length === 1) return new Array<Pt>(target).fill({ ...first });
  const { total, cum } = polylineLengths(clean);
  if (total <= 1e-9) return new Array<Pt>(target).fill({ ...first });

  const out: Pt[] = [];
  let seg = 1;
  for (let i = 0; i < target; i++) {
    const want = (i / (target - 1)) * total;
    while (seg < cum.length - 1 && (cum[seg] as number) < want) seg++;
    const l0 = cum[seg - 1] as number;
    const l1 = cum[seg] as number;
    const a = clean[seg - 1] as Pt;
    const b = clean[seg] as Pt;
    const span = l1 - l0;
    const t = span <= 1e-12 ? 0 : (want - l0) / span;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

/**
 * Build a constant-speed `MotionPath` from waypoints or from SVG path data.
 *
 * Waypoints are smoothed through the same Catmull-Rom spline the path lane uses,
 * so a ball follows exactly the curve that was drawn rather than a chord across
 * it. Raw `d` is flattened by the shared path sampler, which handles arcs and
 * every relative command form.
 */
export function motionPath(
  source: Pt[] | string,
  opts: { closed?: boolean; samples?: number; maxChord?: number } = {},
): MotionPath {
  const closed = opts.closed === true;
  const samples = opts.samples ?? MOTION_SAMPLES;
  const chord = opts.maxChord ?? 1.5;
  const d = typeof source === 'string' ? source : catmullRomPath(source, { closed, precision: 3 });
  const flat =
    typeof source === 'string'
      ? flattenCubics(pathToCubics(d), chord)
      : flattenCubics(catmullRomBeziers(source, { closed }), chord);
  const points = resamplePolyline(flat, samples);
  return { points, length: polylineLength(flat), closed, d };
}

/**
 * Raw path data as cubics, so arbitrary `d` gets the same dense flattening as a
 * smoothed waypoint list. `parsePath` has already reduced every command form —
 * arcs, quadratics, relative, shorthand — to absolute M/L/C, so this only has to
 * promote the straight segments.
 */
function pathToCubics(d: string): ReturnType<typeof catmullRomBeziers> {
  const out: ReturnType<typeof catmullRomBeziers> = [];
  let cur: Pt = { x: 0, y: 0 };
  let start: Pt = { x: 0, y: 0 };
  const straight = (a: Pt, b: Pt): void => {
    out.push({
      p0: { ...a },
      c1: { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 },
      c2: { x: a.x + (2 * (b.x - a.x)) / 3, y: a.y + (2 * (b.y - a.y)) / 3 },
      p1: { ...b },
    });
  };
  for (const s of parsePath(d) as Seg[]) {
    if (s.c === 'M') {
      cur = { ...s.p };
      start = { ...s.p };
    } else if (s.c === 'L') {
      straight(cur, s.p);
      cur = { ...s.p };
    } else if (s.c === 'C') {
      out.push({ p0: { ...cur }, c1: { ...s.p1 }, c2: { ...s.p2 }, p1: { ...s.p } });
      cur = { ...s.p };
    } else {
      straight(cur, start);
      cur = { ...start };
    }
  }
  return out;
}

/**
 * Position and heading at fraction `t` (0–1) of the arc length.
 *
 * The tangent is a central difference over the neighbouring resampled points,
 * which — because they are equally spaced — is a genuine unit heading rather
 * than something biased by segment length.
 */
export function motionAt(mp: MotionPath, t: number): MotionSample {
  const pts = mp.points;
  if (pts.length === 0) {
    return { point: { x: 0, y: 0 }, tangent: { x: 1, y: 0 }, angle: 0, distance: 0 };
  }
  const u = clamp(t, 0, 1);
  const last = pts.length - 1;
  if (last === 0) {
    const only = pts[0] as Pt;
    return { point: { ...only }, tangent: { x: 1, y: 0 }, angle: 0, distance: 0 };
  }
  const pos = u * last;
  const i = Math.min(last - 1, Math.floor(pos));
  const f = pos - i;
  const a = pts[i] as Pt;
  const b = pts[i + 1] as Pt;
  const point = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };

  const before = pts[Math.max(0, i - (f < 0.5 ? 1 : 0))] as Pt;
  const after = pts[Math.min(last, i + (f < 0.5 ? 1 : 2))] as Pt;
  let tx = after.x - before.x;
  let ty = after.y - before.y;
  let mag = Math.hypot(tx, ty);
  if (mag <= 1e-9) {
    tx = b.x - a.x;
    ty = b.y - a.y;
    mag = Math.hypot(tx, ty);
  }
  const tangent = mag <= 1e-9 ? { x: 1, y: 0 } : { x: tx / mag, y: ty / mag };
  return { point, tangent, angle: Math.atan2(tangent.y, tangent.x), distance: u * mp.length };
}

/** The fraction at a given distance along the path — the inverse of `motionAt`. */
export function fractionAtLength(mp: MotionPath, distance: number): number {
  if (mp.length <= 1e-9) return 0;
  return clamp(distance / mp.length, 0, 1);
}

/* -------------------------------------------------------------------- easing */

/**
 * Cubic-Bézier easing, solved rather than approximated.
 *
 * CSS timing functions are `cubic-bezier(x1,y1,x2,y2)` with the curve's *x* as
 * time, so `y(t)` needs `t` recovered from `x` first. Newton converges in a few
 * steps except near flat spots, where we fall back to bisection.
 */
function cubicBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  const bez = (a: number, b: number, t: number): number => {
    const u = 1 - t;
    return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t;
  };
  const dBez = (a: number, b: number, t: number): number => {
    const u = 1 - t;
    return 3 * u * u * a + 6 * u * t * (b - a) + 3 * t * t * (1 - b);
  };
  const target = clamp(x, 0, 1);
  let t = target;
  for (let i = 0; i < 8; i++) {
    const err = bez(x1, x2, t) - target;
    if (Math.abs(err) < 1e-7) return bez(y1, y2, t);
    const slope = dBez(x1, x2, t);
    if (Math.abs(slope) < 1e-7) break;
    t -= err / slope;
  }
  let lo = 0;
  let hi = 1;
  t = target;
  for (let i = 0; i < 32; i++) {
    t = (lo + hi) / 2;
    const v = bez(x1, x2, t);
    if (v < target) lo = t;
    else hi = t;
  }
  return bez(y1, y2, t);
}

export type Easing = Motion['easing'];

/**
 * Apply the IR's easing to a 0–1 progress value.
 *
 * `ease`/`ease-in`/`ease-out` use the CSS control points so a renderer that
 * prefers to hand the work to a CSS transition gets identical motion. `bounce`
 * is the standard three-lobe bounce-out — worth having because a ball that
 * settles into a valley wants it.
 */
export function ease(easing: Easing, t: number): number {
  const u = clamp(t, 0, 1);
  switch (easing) {
    case 'linear':
      return u;
    case 'ease-in':
      return cubicBezier(0.42, 0, 1, 1, u);
    case 'ease-out':
      return cubicBezier(0, 0, 0.58, 1, u);
    case 'bounce': {
      const n1 = 7.5625;
      const d1 = 2.75;
      if (u < 1 / d1) return n1 * u * u;
      if (u < 2 / d1) {
        const v = u - 1.5 / d1;
        return n1 * v * v + 0.75;
      }
      if (u < 2.5 / d1) {
        const v = u - 2.25 / d1;
        return n1 * v * v + 0.9375;
      }
      const v = u - 2.625 / d1;
      return n1 * v * v + 0.984375;
    }
    default:
      return cubicBezier(0.25, 0.1, 0.25, 1, u);
  }
}

/* ------------------------------------------------------------- the IR's Motion */

/**
 * A resolved `Motion`, ready for `visuals.json`.
 *
 * `offsets` is what makes this immediately usable: the IR's waypoints describe
 * where the element's **centre** goes, so the renderer needs a translation, not
 * an absolute position. We hand it the delta from the element's own centre at
 * every sample, already arc-length even.
 */
export type MotionLayout = {
  from: number;
  to: number;
  easing: Easing;
  trail: boolean;
  length: number;
  /** Smooth source path — draw this as the dotted trail. */
  d: string;
  /** Arc-length-even absolute positions for the element's centre. */
  points: Pt[];
  /** The same samples as translations from the element's declared centre. */
  offsets: Pt[];
};

/**
 * Resolve a `Motion` against the box of the element that moves.
 *
 * A path with fewer than two distinct waypoints is not movement; the caller gets
 * `undefined` and simply draws a static element.
 */
export function resolveMotion(
  motion: Motion,
  box: Box,
  opts: { samples?: number } = {},
): MotionLayout | undefined {
  const mp = motionPath(motion.path, { samples: opts.samples ?? 96 });
  if (mp.points.length < 2 || mp.length <= 1e-6) return undefined;
  const centre = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  return {
    from: motion.from,
    to: motion.to,
    easing: motion.easing,
    trail: motion.trail,
    length: mp.length,
    d: mp.d,
    points: mp.points,
    offsets: mp.points.map((p) => ({ x: p.x - centre.x, y: p.y - centre.y })),
  };
}
