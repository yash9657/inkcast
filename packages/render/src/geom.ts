/**
 * Arc-length geometry — the maths that has to be exact for the new vocabulary.
 *
 * Three things in this file are load-bearing:
 *
 * 1. **Arc length.** `Motion` says an element's centre follows a list of
 *    waypoints. Interpolating the waypoint *index* makes the element sprint
 *    across long segments and crawl across short ones, which reads as a
 *    stuttering ball rather than a rolling one. Every position is therefore
 *    resolved by distance travelled, not by segment index.
 * 2. **Direction.** A curve must reveal along its own direction, so everything
 *    here preserves point order: resampling, dashing and flattening all walk the
 *    polyline from its start to its end and never reorder.
 * 3. **Purity.** No clock, no randomness (the roughening happens in `sketch.ts`
 *    from a seeded PRNG), so the same inputs always give the same numbers.
 */
import type { Rect } from './types.js';

/**
 * Rect and point arithmetic now lives in `@inkcast/core` — the camera needs it, and
 * the camera has to be reachable by the visuals stage (see `core/src/camera.ts`).
 * Re-exported here so the renderer's own modules keep one import site, and so nobody
 * is tempted to write a second `unionRects` next to the code that uses it.
 */
export {
  boundsOfPoints,
  flattenPathData,
  inflateRect,
  unionAll,
  unionArea,
  unionRects,
} from '@inkcast/core';
export type { Pt } from '@inkcast/core';

import type { Pt } from '@inkcast/core';

/* ------------------------------------------------------------------- bounds */

export function rectContains(outer: Rect, inner: Rect, slack = 1e-6): boolean {
  return (
    inner.x >= outer.x - slack &&
    inner.y >= outer.y - slack &&
    inner.x + inner.w <= outer.x + outer.w + slack &&
    inner.y + inner.h <= outer.y + outer.h + slack
  );
}

/**
 * The part of a segment inside a rectangle (Liang-Barsky), or `null` if none is.
 *
 * A tangent is defined by a slope and a span in data units, so nothing stops it
 * running off the plot — and a tangent that leaves the frame is worse than no
 * tangent, because the learner reads it as a second curve. Clipping keeps the line
 * on the board without changing the slope it is showing.
 */
export function clipSegment(a: Pt, b: Pt, r: Rect): [Pt, Pt] | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, a[0] - r.x],
    [dx, r.x + r.w - a[0]],
    [-dy, a[1] - r.y],
    [dy, r.y + r.h - a[1]],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return null;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return null;
      if (t < t1) t1 = t;
    }
  }
  return [
    [a[0] + dx * t0, a[1] + dy * t0],
    [a[0] + dx * t1, a[1] + dy * t1],
  ];
}

/* --------------------------------------------------------------- arc length */

/** Cumulative distance along a polyline. `out[i]` is the length up to `pts[i]`. */
export function cumulativeLengths(pts: readonly Pt[]): number[] {
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Pt;
    const b = pts[i] as Pt;
    cum.push((cum[i - 1] as number) + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return cum;
}

export function polylineLength(pts: readonly Pt[]): number {
  const cum = cumulativeLengths(pts);
  return cum.length ? (cum[cum.length - 1] as number) : 0;
}

/** The point `s` units along the polyline, by distance — never by index. */
export function pointAtLength(pts: readonly Pt[], cum: readonly number[], s: number): Pt {
  if (pts.length === 0) return [0, 0];
  const first = pts[0] as Pt;
  if (pts.length === 1) return [first[0], first[1]];
  const total = cum[cum.length - 1] as number;
  if (!(total > 0)) return [first[0], first[1]];
  const want = s <= 0 ? 0 : s >= total ? total : s;
  // Binary search for the segment containing `want`.
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((cum[mid] as number) <= want) lo = mid;
    else hi = mid;
  }
  const a = pts[lo] as Pt;
  const b = pts[hi] as Pt;
  const span = (cum[hi] as number) - (cum[lo] as number);
  const f = span > 0 ? (want - (cum[lo] as number)) / span : 0;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

/**
 * Resample a polyline at even arc-length spacing.
 *
 * This is what makes hand-roughening look like a hand: jitter applied to raw
 * samples of a function wobbles fast where the samples are dense (a steep flank)
 * and slowly where they are sparse, which reads as noise rather than as a person
 * drawing. Even spacing gives the wobble one consistent frequency.
 */
export function resampleEven(pts: readonly Pt[], spacing: number): Pt[] {
  if (pts.length < 2 || !(spacing > 0)) return pts.map((p) => [p[0], p[1]] as Pt);
  const cum = cumulativeLengths(pts);
  const total = cum[cum.length - 1] as number;
  if (!(total > 0)) return [pts[0] as Pt];
  const steps = Math.max(2, Math.round(total / spacing));
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) out.push(pointAtLength(pts, cum, (total * i) / steps));
  return out;
}

/** Unit normal of the polyline at sample `i`, pointing to the left of travel. */
export function normalAt(pts: readonly Pt[], i: number): Pt {
  const a = pts[Math.max(0, i - 1)] as Pt;
  const b = pts[Math.min(pts.length - 1, i + 1)] as Pt;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (!(len > 0)) return [0, -1];
  return [-dy / len, dx / len];
}

/**
 * Split a polyline into dashes of `dash` units separated by `gap` units.
 *
 * Droplines and motion trails are dashed on purpose, and an intentionally dashed
 * stroke cannot also be revealed with `stroke-dashoffset` — so a dashed line is
 * built as many short strokes, which the runtime then reveals in order.
 */
export function dashAlong(pts: readonly Pt[], dash: number, gap: number): Pt[][] {
  if (pts.length < 2 || !(dash > 0) || !(gap >= 0)) return [];
  const cum = cumulativeLengths(pts);
  const total = cum[cum.length - 1] as number;
  if (!(total > 0)) return [];
  const out: Pt[][] = [];
  const step = Math.max(dash / 4, 0.5);
  for (let s = 0; s < total - 1e-6; s += dash + gap) {
    const end = Math.min(total, s + dash);
    const seg: Pt[] = [pointAtLength(pts, cum, s)];
    for (let q = s + step; q < end - 1e-6; q += step) seg.push(pointAtLength(pts, cum, q));
    seg.push(pointAtLength(pts, cum, end));
    if (seg.length >= 2) out.push(seg);
  }
  return out;
}

/* -------------------------------------------------------------------- paths */

/** A closed circle as cubic béziers — a dot, a marked point, a trail bead. */
export function circlePath(cx: number, cy: number, r: number): string {
  const k = r * 0.5523;
  const n = (v: number): string => {
    const q = Math.round(v * 100) / 100;
    return Object.is(q, -0) ? '0' : String(q);
  };
  return (
    `M${n(cx - r)} ${n(cy)}` +
    `C${n(cx - r)} ${n(cy - k)} ${n(cx - k)} ${n(cy - r)} ${n(cx)} ${n(cy - r)}` +
    `C${n(cx + k)} ${n(cy - r)} ${n(cx + r)} ${n(cy - k)} ${n(cx + r)} ${n(cy)}` +
    `C${n(cx + r)} ${n(cy + k)} ${n(cx + k)} ${n(cy + r)} ${n(cx)} ${n(cy + r)}` +
    `C${n(cx - k)} ${n(cy + r)} ${n(cx - r)} ${n(cy + k)} ${n(cx - r)} ${n(cy)}Z`
  );
}

/* ------------------------------------------------------------------ easings */

export type EasingName = 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'bounce';

function easeOutBounce(p: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (p < 1 / d) return n * p * p;
  if (p < 2 / d) {
    const q = p - 1.5 / d;
    return n * q * q + 0.75;
  }
  if (p < 2.5 / d) {
    const q = p - 2.25 / d;
    return n * q * q + 0.9375;
  }
  const q = p - 2.625 / d;
  return n * q * q + 0.984375;
}

/** `Motion.easing` as a real function. Every one maps 0 -> 0 and 1 -> 1. */
export function easeFn(name: EasingName): (p: number) => number {
  switch (name) {
    case 'linear':
      return (p) => p;
    case 'ease-in':
      return (p) => p * p * p;
    case 'ease-out':
      return (p) => 1 - Math.pow(1 - p, 3);
    case 'bounce':
      return easeOutBounce;
    default:
      return (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
  }
}
