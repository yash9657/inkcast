/**
 * The freeform path lane, plus the polyline geometry the plot lane builds on.
 *
 * `PathElement` is the IR's escape hatch: a hillside, a bowl, a container, a
 * brace, a gesture — anything the shape vocabulary cannot say. Two inputs are
 * accepted, waypoints or raw SVG `d`, and both end up as one smooth path that is
 * then roughened, so a stroke-by-stroke reveal draws it the way a hand would.
 *
 * Waypoints are smoothed through a **Catmull-Rom spline**, never emitted as a
 * polyline. A polyline through eight points reads as a folded ribbon: the
 * corners are exactly the artefact roughjs cannot hide, because its wobble is
 * perpendicular to each segment and a vertex is where two perpendiculars fight.
 * A spline interpolates the waypoints (unlike a plain Bézier fit, it passes
 * *through* them) and hands roughjs long smooth segments to wobble along.
 *
 * The clipping and simplification helpers live here rather than in `svg.ts`
 * because they are polyline operations on *drawing* geometry, and both this lane
 * and the plot lane need them:
 *
 * - `simplifyPolyline` is what makes a densely sampled curve look hand-drawn.
 *   Roughjs perturbs every segment, so 300 one-unit segments produce 300 tiny
 *   wobbles — visually noise, not a hand. Simplify first and the wobble lands at
 *   human scale.
 * - `clipSegmentToBox` / `clipPolylineToBox` keep tangents, droplines and curves
 *   inside the frame they belong to instead of bleeding across the canvas.
 */
import type { DrawContext, InkPath } from './geometry.js';
import { inkPaths } from './geometry.js';
import { strokeWidthFor } from './style.js';
import type { Box, Pt } from './svg.js';
import { clamp, n, pathLength } from './svg.js';

/* ------------------------------------------------------------------ smoothing */

/**
 * Knot exponent. **0.5 is centripetal Catmull-Rom and the reason this is not
 * the textbook uniform version.**
 *
 * Uniform Catmull-Rom (α = 0) sets the tangent at a waypoint to half the chord
 * between its neighbours, regardless of how far away they are. Give it waypoints
 * 20 units apart and then 380 apart — which is exactly what an author hand-placing
 * a hillside does — and the tangent at the near point is enormous relative to its
 * own segment, so the curve loops backwards past the point it just left. That
 * cusp is a visible, obviously-broken artefact.
 *
 * Centripetal parameterisation scales each knot by √(chord length), which Yuksel
 * et al. proved removes cusps and self-intersections entirely, and it costs one
 * square root per waypoint.
 */
export const CATMULL_ROM_ALPHA = 0.5;

function samePoint(a: Pt, b: Pt, eps = 1e-6): boolean {
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;
}

/** Drop consecutive duplicates, which would otherwise flatten a spline segment. */
export function dedupePoints(pts: Pt[], eps = 1e-6): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const last = out[out.length - 1];
    if (last && samePoint(last, p, eps)) continue;
    out.push(p);
  }
  return out;
}

/** One cubic Bézier of a smoothed path. */
export type CubicSeg = { p0: Pt; c1: Pt; c2: Pt; p1: Pt };

function knot(a: Pt, b: Pt, alpha: number): number {
  return Math.hypot(b.x - a.x, b.y - a.y) ** alpha;
}

/**
 * The cubic Béziers of a centripetal Catmull-Rom spline through `points`.
 *
 * This is the single source of truth for smoothing in this package: the path lane
 * serialises these, the plot lane *evaluates* them to answer "what is y at x" and
 * "what is the slope there", and the motion lane flattens them. Sharing the
 * construction is what guarantees a tangent is the tangent of the curve that was
 * actually drawn.
 *
 * The control points come from the standard non-uniform closed form, which
 * reduces to `p1 + (p2 − p0)/6` when the knots are equal:
 *
 *     c1 = (d1²·p2 − d2²·p0 + (2d1² + 3d1d2 + d2²)·p1) / (3d1(d1 + d2))
 *     c2 = (d3²·p1 − d2²·p3 + (2d3² + 3d3d2 + d2²)·p2) / (3d3(d3 + d2))
 *
 * Open ends reflect a virtual neighbour (`p₋₁ = 2p₀ − p₁`); under centripetal
 * weighting that reflection has the same knot length as the first real segment,
 * so it sets a sane end tangent instead of the blow-up it causes when uniform.
 */
export function catmullRomBeziers(
  points: Pt[],
  opts: { closed?: boolean; alpha?: number } = {},
): CubicSeg[] {
  const pts = dedupePoints(points);
  if (pts.length < 2) return [];
  const closed = opts.closed === true && pts.length >= 3;
  const alpha = opts.alpha ?? CATMULL_ROM_ALPHA;

  const at = (i: number): Pt => {
    if (closed) return pts[((i % pts.length) + pts.length) % pts.length] as Pt;
    if (i < 0) {
      const a = pts[0] as Pt;
      const b = pts[1] as Pt;
      return { x: 2 * a.x - b.x, y: 2 * a.y - b.y };
    }
    if (i > pts.length - 1) {
      const a = pts[pts.length - 1] as Pt;
      const b = pts[pts.length - 2] as Pt;
      return { x: 2 * a.x - b.x, y: 2 * a.y - b.y };
    }
    return pts[i] as Pt;
  };

  const out: CubicSeg[] = [];
  const last = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const d1 = knot(p0, p1, alpha);
    const d2 = knot(p1, p2, alpha);
    const d3 = knot(p2, p3, alpha);

    const c1 =
      d1 <= 1e-12
        ? { ...p1 }
        : {
            x:
              (d1 * d1 * p2.x - d2 * d2 * p0.x + (2 * d1 * d1 + 3 * d1 * d2 + d2 * d2) * p1.x) /
              (3 * d1 * (d1 + d2)),
            y:
              (d1 * d1 * p2.y - d2 * d2 * p0.y + (2 * d1 * d1 + 3 * d1 * d2 + d2 * d2) * p1.y) /
              (3 * d1 * (d1 + d2)),
          };
    const c2 =
      d3 <= 1e-12
        ? { ...p2 }
        : {
            x:
              (d3 * d3 * p1.x - d2 * d2 * p3.x + (2 * d3 * d3 + 3 * d3 * d2 + d2 * d2) * p2.x) /
              (3 * d3 * (d3 + d2)),
            y:
              (d3 * d3 * p1.y - d2 * d2 * p3.y + (2 * d3 * d3 + 3 * d3 * d2 + d2 * d2) * p2.y) /
              (3 * d3 * (d3 + d2)),
          };
    out.push({ p0: p1, c1, c2, p1: p2 });
  }
  return out;
}

/** Point on a cubic Bézier at parameter `t`. */
export function cubicAt(s: CubicSeg, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * s.p0.x + b * s.c1.x + c * s.c2.x + d * s.p1.x,
    y: a * s.p0.y + b * s.c1.y + c * s.c2.y + d * s.p1.y,
  };
}

/** First derivative of a cubic Bézier at parameter `t`, in path units per `t`. */
export function cubicDerivativeAt(s: CubicSeg, t: number): Pt {
  const u = 1 - t;
  return {
    x:
      3 * u * u * (s.c1.x - s.p0.x) + 6 * u * t * (s.c2.x - s.c1.x) + 3 * t * t * (s.p1.x - s.c2.x),
    y:
      3 * u * u * (s.c1.y - s.p0.y) + 6 * u * t * (s.c2.y - s.c1.y) + 3 * t * t * (s.p1.y - s.c2.y),
  };
}

/**
 * Cubic-Bézier path data interpolating `points` as a centripetal Catmull-Rom
 * spline. Closed paths wrap and append `Z`.
 */
export function catmullRomPath(
  points: Pt[],
  opts: { closed?: boolean; alpha?: number; precision?: number } = {},
): string {
  const pts = dedupePoints(points);
  if (pts.length === 0) return '';
  const first = pts[0] as Pt;
  const precision = opts.precision ?? 2;
  if (pts.length === 1) return `M${n(first.x, precision)} ${n(first.y, precision)}`;
  const closed = opts.closed === true && pts.length >= 3;
  const segs = catmullRomBeziers(pts, {
    closed,
    ...(opts.alpha !== undefined ? { alpha: opts.alpha } : {}),
  });

  const out: string[] = [`M${n(first.x, precision)} ${n(first.y, precision)}`];
  for (const s of segs) {
    out.push(
      `C${n(s.c1.x, precision)} ${n(s.c1.y, precision)} ${n(s.c2.x, precision)} ${n(
        s.c2.y,
        precision,
      )} ${n(s.p1.x, precision)} ${n(s.p1.y, precision)}`,
    );
  }
  if (closed) out.push('Z');
  return out.join(' ');
}

/**
 * Flatten cubics to a polyline fine enough that chord length is arc length.
 *
 * `samplePath` in `svg.ts` caps at 48 steps per cubic, which is right for a
 * bounding box and wrong for motion: an 800-unit segment then gets 17-unit
 * chords, and resampling those to constant *chord* length is not constant
 * *speed*. Here the step count is driven by a target chord length instead.
 */
export function flattenCubics(segs: CubicSeg[], maxChord = 1.5): Pt[] {
  const out: Pt[] = [];
  segs.forEach((s, i) => {
    const rough =
      Math.hypot(s.c1.x - s.p0.x, s.c1.y - s.p0.y) +
      Math.hypot(s.c2.x - s.c1.x, s.c2.y - s.c1.y) +
      Math.hypot(s.p1.x - s.c2.x, s.p1.y - s.c2.y);
    const steps = Math.round(clamp(Math.ceil(rough / Math.max(0.05, maxChord)), 8, 600));
    if (i === 0) out.push({ ...s.p0 });
    for (let k = 1; k <= steps; k++) out.push(cubicAt(s, k / steps));
  });
  return out;
}

/* -------------------------------------------------------------- simplification */

function perpDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Ramer–Douglas–Peucker: drop points that lie within `epsilon` of the chord
 * they sit on. Iterative (an explicit stack) because a dense sampling of a
 * near-straight curve recurses thousands deep.
 */
export function simplifyPolyline(points: Pt[], epsilon: number): Pt[] {
  const pts = dedupePoints(points);
  if (pts.length <= 2 || epsilon <= 0) return pts;
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = true;
  keep[pts.length - 1] = true;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length > 0) {
    const [lo, hi] = stack.pop() as [number, number];
    if (hi - lo < 2) continue;
    const a = pts[lo] as Pt;
    const b = pts[hi] as Pt;
    let worst = -1;
    let worstAt = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = perpDistance(pts[i] as Pt, a, b);
      if (d > worst) {
        worst = d;
        worstAt = i;
      }
    }
    if (worst > epsilon && worstAt > 0) {
      keep[worstAt] = true;
      stack.push([lo, worstAt], [worstAt, hi]);
    }
  }
  return pts.filter((_, i) => keep[i] === true);
}

/* --------------------------------------------------------- corners and dashes */

/**
 * Split a polyline wherever it genuinely turns a corner.
 *
 * A spline is the right answer for a curve and the wrong answer for a corner. A
 * step function's riser, sampled as a vertical segment between two horizontal
 * ones, gets smoothed into a loop that swings out past the jump — visible,
 * obviously wrong, and it was exactly what the first render of a `step` curve
 * produced. Splitting first means each piece is smoothed on its own and the
 * corner stays a corner, which is also how a person draws it: one stroke across,
 * one stroke up.
 *
 * `maxTurn` is in radians; the default of ~57° keeps ordinary curvature intact.
 */
export function splitAtCorners(points: Pt[], maxTurn = 1): Pt[][] {
  const pts = dedupePoints(points);
  if (pts.length < 3) return pts.length >= 2 ? [pts] : [];
  const out: Pt[][] = [];
  let cur: Pt[] = [pts[0] as Pt];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1] as Pt;
    const b = pts[i] as Pt;
    const c = pts[i + 1] as Pt;
    cur.push(b);
    const a1 = Math.atan2(b.y - a.y, b.x - a.x);
    const a2 = Math.atan2(c.y - b.y, c.x - b.x);
    let turn = Math.abs(a2 - a1);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    if (turn >= maxTurn) {
      out.push(cur);
      cur = [b];
    }
  }
  cur.push(pts[pts.length - 1] as Pt);
  if (cur.length >= 2) out.push(cur);
  return out;
}

/**
 * Cut a polyline into dash segments of length `on` separated by gaps of `off`.
 *
 * Dashes have to be real geometry rather than a `stroke-dasharray`, for two
 * reasons. Roughjs drops `strokeLineDash` on the floor in `toPaths()` — verified,
 * it returns one continuous `d` — so the option silently did nothing. And the
 * renderer already owns `stroke-dasharray` to reveal strokes, so a dashed
 * *appearance* would fight the dashed *reveal*. As separate strokes each dash
 * draws in turn, which is what a hand does anyway.
 */
export function dashPolyline(points: Pt[], on: number, off: number): Pt[][] {
  const pts = dedupePoints(points);
  if (pts.length < 2 || on <= 0 || off <= 0) return pts.length >= 2 ? [pts] : [];
  const out: Pt[][] = [];
  let cur: Pt[] = [pts[0] as Pt];
  let drawing = true;
  let budget = on;

  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1] as Pt;
    const b = pts[i] as Pt;
    let left = Math.hypot(b.x - a.x, b.y - a.y);
    while (left > budget) {
      const t = budget / left;
      const cut = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (drawing) {
        cur.push(cut);
        if (cur.length >= 2) out.push(cur);
        cur = [];
      } else {
        cur = [cut];
      }
      drawing = !drawing;
      a = cut;
      left -= budget;
      budget = drawing ? on : off;
    }
    budget -= left;
    if (drawing) cur.push(b);
  }
  if (drawing && cur.length >= 2) out.push(cur);
  return out;
}

/* ------------------------------------------------------------------- clipping */

/**
 * Liang–Barsky segment/rectangle clip. Returns the visible portion of `a`→`b`,
 * or `undefined` when the segment misses the box entirely.
 *
 * A tangent at a steep point runs a long way; without this it would leave the
 * plot frame and scribble over whatever else is on the board.
 */
export function clipSegmentToBox(a: Pt, b: Pt, box: Box): [Pt, Pt] | undefined {
  const x0 = Math.min(box.x, box.x + box.w);
  const x1 = Math.max(box.x, box.x + box.w);
  const y0 = Math.min(box.y, box.y + box.h);
  const y1 = Math.max(box.y, box.y + box.h);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;

  const edge = (p: number, q: number): boolean => {
    // p·t ≤ q for each of the four half-planes.
    if (p === 0) return q >= 0; // parallel: inside or wholly out
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };

  if (!edge(-dx, a.x - x0)) return undefined;
  if (!edge(dx, x1 - a.x)) return undefined;
  if (!edge(-dy, a.y - y0)) return undefined;
  if (!edge(dy, y1 - a.y)) return undefined;
  return [
    { x: a.x + t0 * dx, y: a.y + t0 * dy },
    { x: a.x + t1 * dx, y: a.y + t1 * dy },
  ];
}

/** Clip a polyline to `box`, splitting it wherever it leaves and re-enters. */
export function clipPolylineToBox(points: Pt[], box: Box): Pt[][] {
  const pts = dedupePoints(points);
  if (pts.length === 0) return [];
  if (pts.length === 1) return inBox(pts[0] as Pt, box) ? [[pts[0] as Pt]] : [];
  const runs: Pt[][] = [];
  let cur: Pt[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i] as Pt;
    const b = pts[i + 1] as Pt;
    const seg = clipSegmentToBox(a, b, box);
    if (!seg) {
      if (cur.length > 1) runs.push(cur);
      cur = [];
      continue;
    }
    const [ca, cb] = seg;
    const tail = cur[cur.length - 1];
    if (!tail || !samePoint(tail, ca, 1e-6)) {
      if (cur.length > 1) runs.push(cur);
      cur = [ca];
    }
    cur.push(cb);
  }
  if (cur.length > 1) runs.push(cur);
  return runs;
}

function inBox(p: Pt, box: Box, tol = 1e-9): boolean {
  return (
    p.x >= Math.min(box.x, box.x + box.w) - tol &&
    p.x <= Math.max(box.x, box.x + box.w) + tol &&
    p.y >= Math.min(box.y, box.y + box.h) - tol &&
    p.y <= Math.max(box.y, box.y + box.h) + tol
  );
}

/**
 * Split a polyline at the points where it crosses out of `[lo, hi]` in y,
 * interpolating the crossing exactly.
 *
 * The plot lane clips curves in **data space** with this, before mapping to the
 * canvas: a parabola whose arms leave the plotted range must stop precisely at
 * the range edge, not at whatever sample happened to fall outside it.
 */
export function clipPolylineToRange(points: Pt[], lo: number, hi: number): Pt[][] {
  const yLo = Math.min(lo, hi);
  const yHi = Math.max(lo, hi);
  const runs: Pt[][] = [];
  let cur: Pt[] = [];
  const within = (p: Pt): boolean => p.y >= yLo - 1e-12 && p.y <= yHi + 1e-12;
  const cross = (a: Pt, b: Pt, y: number): Pt => {
    const dy = b.y - a.y;
    const t = dy === 0 ? 0 : (y - a.y) / dy;
    return { x: a.x + (b.x - a.x) * clamp(t, 0, 1), y };
  };
  const flush = (): void => {
    if (cur.length > 1) runs.push(cur);
    cur = [];
  };

  // A sample landing exactly on the boundary is both "inside" and "the
  // crossing", so pushing both would duplicate the point and leave a zero-length
  // segment for the renderer to divide by.
  const pushUnique = (p: Pt): void => {
    const last = cur[cur.length - 1];
    if (last && samePoint(last, p, 1e-9)) return;
    cur.push(p);
  };

  const pts = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as Pt;
    const prev = i > 0 ? (pts[i - 1] as Pt) : undefined;
    if (within(p)) {
      if (prev && !within(prev)) {
        cur = [cross(prev, p, prev.y > yHi ? yHi : yLo)];
      }
      pushUnique(p);
      continue;
    }
    if (prev && within(prev)) {
      pushUnique(cross(prev, p, p.y > yHi ? yHi : yLo));
      flush();
    } else if (prev && ((prev.y < yLo && p.y > yHi) || (prev.y > yHi && p.y < yLo))) {
      // Straight through the band without a sample inside it (a step riser).
      const first = cross(prev, p, prev.y < yLo ? yLo : yHi);
      const second = cross(prev, p, prev.y < yLo ? yHi : yLo);
      flush();
      runs.push([first, second]);
    } else {
      flush();
    }
  }
  flush();
  return runs;
}

/* ------------------------------------------------------------------ the lane */

/** What a `PathElement` carries, narrowed to the fields this lane reads. */
export type PathSpec = {
  points?: Pt[];
  d?: string;
  closed?: boolean;
  fill?: boolean;
  /** Stroke weight multiplier relative to the ink style's default. */
  weight?: number;
};

export type ResolvedPath = {
  /** The smooth, un-roughened path — what a motion rides along. */
  d: string;
  length: number;
  closed: boolean;
  filled: boolean;
  /** Source of the geometry, for the manifest and for debugging. */
  from: 'points' | 'd';
  paths: InkPath[];
};

function ensureClosed(d: string): string {
  return /z\s*$/i.test(d.trim()) ? d : `${d} Z`;
}

/**
 * Resolve a `PathElement` into hand-drawn strokes.
 *
 * `points` wins over `d` (the IR documents `d` as the alternative), is smoothed
 * through the spline, and is roughened as **one** path so the reveal is a single
 * continuous gesture rather than a queue of segments.
 *
 * `weight` multiplies the ink style's own stroke width, exactly as the IR says —
 * it is not snapped to the semantic ladder, because an author who wrote 1.8
 * meant 1.8.
 */
export function resolvePath(spec: PathSpec, ctx: DrawContext): ResolvedPath | undefined {
  const closed = spec.closed === true;
  const raw = spec.weight;
  const weight = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : 1;
  let d = '';
  let from: 'points' | 'd' = 'points';

  if (spec.points && spec.points.length >= 2) {
    d = catmullRomPath(spec.points, { closed });
  } else if (spec.d && spec.d.trim()) {
    from = 'd';
    d = closed ? ensureClosed(spec.d.trim()) : spec.d.trim();
  }
  if (!d) return undefined;

  const fill = spec.fill === true;
  const stroke = ctx.colour ?? ctx.style.ink;
  const paths = inkPaths({ ...ctx, group: ctx.group ?? 'path' }, 41, (o) => ctx.gen.path(d, o), {
    strokeWidth: strokeWidthFor(ctx.style, ctx.weight ?? 'normal') * weight,
    ...(fill ? { fill: stroke, fillStyle: ctx.style.fillStyle } : {}),
    // A freeform stroke is the author's own gesture: keep their vertices.
    preserveVertices: true,
  });
  return { d, length: pathLength(d), closed, filled: fill, from, paths };
}
