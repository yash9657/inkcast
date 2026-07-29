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

/** Structurally identical to `sketch.ts`'s `Pt`; declared here to avoid a cycle. */
export type Pt = [number, number];

/* ------------------------------------------------------------------- bounds */

export function boundsOfPoints(pts: readonly Pt[]): Rect | null {
  if (pts.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function unionRects(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b ? { ...b } : null;
  if (!b) return { ...a };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

export function unionAll(rects: readonly (Rect | null)[]): Rect | null {
  let out: Rect | null = null;
  for (const r of rects) out = unionRects(out, r);
  return out;
}

export function inflateRect(r: Rect, padX: number, padY = padX): Rect {
  return { x: r.x - padX, y: r.y - padY, w: r.w + padX * 2, h: r.h + padY * 2 };
}

export function rectContains(outer: Rect, inner: Rect, slack = 1e-6): boolean {
  return (
    inner.x >= outer.x - slack &&
    inner.y >= outer.y - slack &&
    inner.x + inner.w <= outer.x + outer.w + slack &&
    inner.y + inner.h <= outer.y + outer.h + slack
  );
}

/**
 * Area covered by a set of possibly overlapping rectangles.
 *
 * Used to measure how much of the frame actually carries content: summing areas
 * would double-count a label sitting on a plot and report a full board where
 * there is one. Coordinate compression is exact and, at the handful of elements a
 * scene holds, cheaper than any cleverer sweep.
 */
export function unionArea(rects: readonly Rect[]): number {
  const live = rects.filter((r) => r.w > 0 && r.h > 0);
  if (live.length === 0) return 0;
  const xs = [...new Set(live.flatMap((r) => [r.x, r.x + r.w]))].sort((a, b) => a - b);
  const ys = [...new Set(live.flatMap((r) => [r.y, r.y + r.h]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    const x0 = xs[i] as number;
    const x1 = xs[i + 1] as number;
    for (let j = 0; j + 1 < ys.length; j++) {
      const y0 = ys[j] as number;
      const y1 = ys[j + 1] as number;
      const covered = live.some(
        (r) => r.x <= x0 && r.x + r.w >= x1 && r.y <= y0 && r.y + r.h >= y1,
      );
      if (covered) area += (x1 - x0) * (y1 - y0);
    }
  }
  return area;
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

function cubicAt(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
  ];
}

function arcPoints(
  from: Pt,
  rx: number,
  ry: number,
  rot: number,
  large: number,
  sweep: number,
  to: Pt,
  steps: number,
): Pt[] {
  // Endpoint -> centre parameterisation, straight out of the SVG spec.
  let rX = Math.abs(rx);
  let rY = Math.abs(ry);
  if (rX === 0 || rY === 0) return [to];
  const phi = (rot * Math.PI) / 180;
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);
  const dx2 = (from[0] - to[0]) / 2;
  const dy2 = (from[1] - to[1]) / 2;
  const x1 = cosP * dx2 + sinP * dy2;
  const y1 = -sinP * dx2 + cosP * dy2;
  const lambda = (x1 * x1) / (rX * rX) + (y1 * y1) / (rY * rY);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rX *= s;
    rY *= s;
  }
  const sign = large === sweep ? -1 : 1;
  const num = rX * rX * rY * rY - rX * rX * y1 * y1 - rY * rY * x1 * x1;
  const den = rX * rX * y1 * y1 + rY * rY * x1 * x1;
  const co = sign * Math.sqrt(Math.max(0, num / (den || 1e-12)));
  const cx1 = (co * rX * y1) / rY;
  const cy1 = (-co * rY * x1) / rX;
  const cx = cosP * cx1 - sinP * cy1 + (from[0] + to[0]) / 2;
  const cy = sinP * cx1 + cosP * cy1 + (from[1] + to[1]) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number): number => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1e-12;
    const a = Math.acos(Math.max(-1, Math.min(1, dot / len)));
    return ux * vy - uy * vx < 0 ? -a : a;
  };
  const theta = angle(1, 0, (x1 - cx1) / rX, (y1 - cy1) / rY);
  let delta = angle((x1 - cx1) / rX, (y1 - cy1) / rY, (-x1 - cx1) / rX, (-y1 - cy1) / rY);
  if (sweep === 0 && delta > 0) delta -= Math.PI * 2;
  if (sweep === 1 && delta < 0) delta += Math.PI * 2;
  const out: Pt[] = [];
  const n = Math.max(2, steps);
  for (let i = 1; i <= n; i++) {
    const a = theta + (delta * i) / n;
    out.push([
      cx + rX * Math.cos(a) * cosP - rY * Math.sin(a) * sinP,
      cy + rX * Math.cos(a) * sinP + rY * Math.sin(a) * cosP,
    ]);
  }
  return out;
}

const PATH_TOKEN = /[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;

/**
 * Flatten SVG path data into polylines, one per subpath.
 *
 * `PathElement.d` is an accepted alternative to `points`, and the renderer has to
 * know where that ink lands: the camera frames the union of what has been drawn,
 * and a path whose extent it cannot measure would be framed out of shot. Curves
 * are sampled rather than approximated so the bounds are tight.
 */
export function flattenPathData(d: string, curveSamples = 14): Pt[][] {
  const tokens = String(d).match(PATH_TOKEN);
  if (!tokens) return [];
  const subs: Pt[][] = [];
  let cur: Pt[] = [];
  let pos: Pt = [0, 0];
  let startPt: Pt = [0, 0];
  let cmd = '';
  let lastCubic: Pt | null = null;
  let lastQuad: Pt | null = null;
  let i = 0;
  const num = (): number => {
    const v = Number(tokens[i++]);
    return Number.isFinite(v) ? v : 0;
  };
  /**
   * Are the next `n` tokens numbers?
   *
   * Path data is not always path data: `d` may be empty, or truncated, or plain
   * prose from a hand-edited storyboard — and single letters inside a word ("a" and
   * "h" in "not a path") are valid commands, so a walker that trusts its input
   * silently produces a run of points at the origin, which then drags the camera's
   * framing to the top-left corner of the canvas.
   */
  const need = (n: number): boolean => {
    for (let k = 0; k < n; k++) {
      const tok = tokens[i + k];
      if (tok === undefined || !/^[-+.\d]/.test(tok)) return false;
    }
    return true;
  };
  const push = (p: Pt): void => {
    cur.push(p);
    pos = p;
  };
  const open = (p: Pt): void => {
    if (cur.length > 1) subs.push(cur);
    cur = [p];
    pos = p;
    startPt = p;
  };
  /** Stop walking and return whatever was fully parsed. */
  const finish = (): Pt[][] => {
    if (cur.length > 1) subs.push(cur);
    return subs;
  };

  while (i < tokens.length) {
    const tok = tokens[i] as string;
    if (/[MmLlHhVvCcSsQqTtAaZz]/.test(tok)) {
      cmd = tok;
      i++;
      if (cmd === 'Z' || cmd === 'z') {
        if (cur.length) {
          cur.push([startPt[0], startPt[1]]);
          pos = startPt;
        }
        continue;
      }
    }
    if (!cmd) break;
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? pos[0] : 0;
    const oy = rel ? pos[1] : 0;
    switch (cmd.toUpperCase()) {
      case 'M': {
        if (!need(2)) return finish();
        const p: Pt = [num() + ox, num() + oy];
        open(p);
        cmd = rel ? 'l' : 'L';
        lastCubic = null;
        lastQuad = null;
        break;
      }
      case 'L': {
        if (!need(2)) return finish();
        push([num() + ox, num() + oy]);
        lastCubic = null;
        lastQuad = null;
        break;
      }
      case 'H': {
        if (!need(1)) return finish();
        push([num() + ox, pos[1]]);
        lastCubic = null;
        lastQuad = null;
        break;
      }
      case 'V': {
        if (!need(1)) return finish();
        push([pos[0], num() + oy]);
        lastCubic = null;
        lastQuad = null;
        break;
      }
      case 'C':
      case 'S': {
        if (!need(cmd.toUpperCase() === 'C' ? 6 : 4)) return finish();
        const p0: Pt = [pos[0], pos[1]];
        let c1: Pt;
        if (cmd.toUpperCase() === 'C') {
          c1 = [num() + ox, num() + oy];
        } else {
          c1 = lastCubic ? [2 * p0[0] - lastCubic[0], 2 * p0[1] - lastCubic[1]] : p0;
        }
        const c2: Pt = [num() + ox, num() + oy];
        const p3: Pt = [num() + ox, num() + oy];
        for (let s = 1; s <= curveSamples; s++) cur.push(cubicAt(p0, c1, c2, p3, s / curveSamples));
        pos = p3;
        lastCubic = c2;
        lastQuad = null;
        break;
      }
      case 'Q':
      case 'T': {
        if (!need(cmd.toUpperCase() === 'Q' ? 4 : 2)) return finish();
        const p0: Pt = [pos[0], pos[1]];
        const q: Pt =
          cmd.toUpperCase() === 'Q'
            ? [num() + ox, num() + oy]
            : lastQuad
              ? [2 * p0[0] - lastQuad[0], 2 * p0[1] - lastQuad[1]]
              : p0;
        const p2: Pt = [num() + ox, num() + oy];
        // A quadratic is a cubic with both controls two-thirds of the way in.
        const c1: Pt = [p0[0] + (2 / 3) * (q[0] - p0[0]), p0[1] + (2 / 3) * (q[1] - p0[1])];
        const c2: Pt = [p2[0] + (2 / 3) * (q[0] - p2[0]), p2[1] + (2 / 3) * (q[1] - p2[1])];
        for (let s = 1; s <= curveSamples; s++) cur.push(cubicAt(p0, c1, c2, p2, s / curveSamples));
        pos = p2;
        lastQuad = q;
        lastCubic = null;
        break;
      }
      case 'A': {
        if (!need(7)) return finish();
        const rx = num();
        const ry = num();
        const rot = num();
        const large = num();
        const sweep = num();
        const to: Pt = [num() + ox, num() + oy];
        for (const p of arcPoints([pos[0], pos[1]], rx, ry, rot, large, sweep, to, curveSamples)) {
          cur.push(p);
        }
        pos = to;
        lastCubic = null;
        lastQuad = null;
        break;
      }
      default:
        i++;
        break;
    }
  }
  if (cur.length > 1) subs.push(cur);
  return subs;
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
