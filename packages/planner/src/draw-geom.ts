/**
 * What ink a mark actually lays down — the geometry the drawing lane has to agree about.
 *
 * ## Why a bounding box is the wrong obstacle
 *
 * Everything that has to decide "is this label sitting on the picture?" needs to know
 * where the *ink* is, and a mark's bounding box is a poor answer to that. An arrow from
 * one corner of the drawing to the other has a box covering the whole canvas and lays
 * down a line a few units wide; a heart outline's box contains the heart's empty middle,
 * which is exactly where its labels belong. The first repair pass worked in boxes and
 * papered over both cases with an area cap — ink smaller than a fifth of the drawing is
 * an obstacle, anything bigger is not — which got the containers right by accident and
 * the long arrows wrong for the same reason.
 *
 * So a mark resolves to `Ink`: the **segments** its pen travels, plus a **fill** region
 * for the two marks that really do cover an area (`hatch`, `dots`). A rectangle is four
 * edges, not a filled block; an ellipse is its perimeter; a stroke is its polyline. Then
 * "label on ink" is a segment-versus-box question with a real answer, a container's
 * interior is free without anyone having to special-case containers, and the area cap is
 * gone.
 *
 * Shared by `drawing.ts` (which repairs and builds) and `draw-audit.ts` (which measures),
 * because a repair and a measurement that disagree about where the ink is would take
 * turns undoing each other.
 */
import type { Mark } from '@inkcast/core';
import { DRAW_W } from '@inkcast/core';
import type { Box, Point } from './elements.js';

/**
 * How far a label may sit from every mark before it is naming nothing.
 *
 * A seventh of the canvas width. Generous, because a label with a leader arrow to its part
 * is *meant* to be out at the edge — and the arrow is ink, so a properly-led label is
 * measured against its own leader and stays well inside this.
 *
 * Shared, because the repair pass has to avoid creating the thing the audit reports.
 */
export const ADRIFT = DRAW_W / 7;

/* ---------------------------------------------------------------- primitives */

/**
 * The `[x, y]` pairs of a mark, as points, dropping anything malformed.
 *
 * The schema says "an array of arrays of numbers" because a zod tuple compiles to a
 * tool schema the API rejects, so pair-ness is checked here — once, at the only place
 * the waypoints are read.
 */
export function waypoints(m: Mark): Point[] {
  return (m.points ?? [])
    .filter((p) => Array.isArray(p) && p.length >= 2)
    .map((p) => ({ x: p[0] as number, y: p[1] as number }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

/** Default cap height for a label the author left unsized. */
export const LABEL_SIZE = 30;
/** Mean glyph advance as a fraction of cap height, matching `elements.ts`. */
export const ADVANCE = 0.52;

/**
 * The space a label's words will take, in drawing units.
 *
 * A label is placed by its centre and its extent is the text itself, estimated at the
 * same advance ratio the board writes at — so a collision check against this box is a
 * check against the space the words will really occupy.
 */
export function labelBox(m: Mark): Box {
  const size = m.size ?? LABEL_SIZE;
  const text = m.text ?? '';
  const w = Math.max(size, text.length * size * ADVANCE);
  return { x: (m.x ?? 0) - w / 2, y: (m.y ?? 0) - size * 0.7, w, h: size * 1.4 };
}

/** The corners a mark occupies on the drawing canvas, before fitting. */
export function markBounds(m: Mark): Box | undefined {
  const pts = waypoints(m);
  if (pts.length >= 2) {
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(1, Math.max(...xs) - Math.min(...xs)),
      h: Math.max(1, Math.max(...ys) - Math.min(...ys)),
    };
  }
  if (m.kind === 'label') return labelBox(m);
  if (m.w !== undefined && m.h !== undefined && m.x !== undefined && m.y !== undefined) {
    return { x: m.x, y: m.y, w: Math.max(1, m.w), h: Math.max(1, m.h) };
  }
  return undefined;
}

export function union(boxes: Box[]): Box | undefined {
  if (!boxes.length) return undefined;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const r = Math.max(...boxes.map((b) => b.x + b.w));
  const b2 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, w: Math.max(1, r - x), h: Math.max(1, b2 - y) };
}

/** The bounds of everything drawable in a drawing. */
export function contentBounds(marks: Mark[]): Box | undefined {
  return union(marks.map(markBounds).filter((b): b is Box => b !== undefined));
}

/** How much of `a` and `b` share, in square units. 0 when they are clear of each other. */
export function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Liang–Barsky, enough of it to trim a segment to a box. */
export function clipToBox(a: Point, b: Point, box: Box): [Point, Point] | undefined {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const tests: [number, number][] = [
    [-dx, a.x - box.x],
    [dx, box.x + box.w - a.x],
    [-dy, a.y - box.y],
    [dy, box.y + box.h - a.y],
  ];
  for (const [p, q] of tests) {
    if (p === 0) {
      if (q < 0) return undefined;
      continue;
    }
    const r = q / p;
    if (p < 0 && r > t1) return undefined;
    if (p > 0 && r < t0) return undefined;
    if (p < 0 && r > t0) t0 = r;
    if (p > 0 && r < t1) t1 = r;
  }
  return [
    { x: a.x + t0 * dx, y: a.y + t0 * dy },
    { x: a.x + t1 * dx, y: a.y + t1 * dy },
  ];
}

const grow = (b: Box, pad: number): Box => ({
  x: b.x - pad,
  y: b.y - pad,
  w: b.w + pad * 2,
  h: b.h + pad * 2,
});

/** Whether a pen stroke from `a` to `b` passes through `box` (inflated by `pad`). */
function segHitsBox(a: Point, b: Point, box: Box, pad = 0): boolean {
  return clipToBox(a, b, grow(box, pad)) !== undefined;
}

/** Distance from a point to a segment, for "does this label name anything?" */
function pointSegDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/* ---------------------------------------------------------------------- ink */

/**
 * Where one mark's pen goes: the strokes it travels, and any region it shades.
 *
 * The two are treated differently, and the difference was measured rather than assumed.
 * A **stroke** is a line you must not write across. A **shaded region** — `hatch`, `dots` —
 * is something you write *on*: a hatched magnet with `N` and `S` inside its poles is how
 * anybody would draw one, and the first version of this counted those two letters as
 * defects. The correction pass duly moved them out of the magnet and into the field lines
 * below it, where they named nothing, and the audit called that an improvement because the
 * two collisions were gone. The picture was worse in every way that matters.
 *
 * So a shaded region is not an obstacle. It still counts for *distance*: a name written on
 * a hatched block is naming the block, which is what keeps `label-adrift` from firing on a
 * label that is doing its job. Something to write on, and something to be near.
 */
export type Ink = {
  id: string;
  kind: Mark['kind'];
  /** The pen's path. An obstacle: words across it are words on the picture. */
  segs: [Point, Point][];
  /** A shaded area (`hatch`, `dots`). Not an obstacle — see above. */
  fill?: Box;
};

/** How finely an ellipse's perimeter is walked. Enough that a label cannot slip through. */
const ELLIPSE_STEPS = 32;

function chain(pts: Point[], closed: boolean): [Point, Point][] {
  const segs: [Point, Point][] = [];
  for (let i = 1; i < pts.length; i++) segs.push([pts[i - 1] as Point, pts[i] as Point]);
  if (closed && pts.length > 2) segs.push([pts[pts.length - 1] as Point, pts[0] as Point]);
  return segs;
}

/**
 * The ink a mark lays down, or `undefined` for a mark that lays down none.
 *
 * A `label` returns `undefined` on purpose: words are what we are placing, never an
 * obstacle to place them against — that is the caller's other list.
 *
 * A smooth stroke is walked as its polyline rather than its spline. The spline bows off
 * the polyline by a fraction of the gap between waypoints, which is smaller than the pad
 * every caller applies, and paying for exact Catmull–Rom here would buy nothing a label
 * could notice.
 */
export function markInk(m: Mark): Ink | undefined {
  if (m.kind === 'label') return undefined;
  const base = { id: m.id, kind: m.kind };
  const pts = waypoints(m);
  switch (m.kind) {
    case 'line':
    case 'stroke':
    case 'arrow':
      return pts.length >= 2
        ? { ...base, segs: chain(pts, m.closed && m.kind === 'stroke') }
        : undefined;
    case 'rect': {
      const b = markBounds(m);
      if (!b) return undefined;
      const c: Point[] = [
        { x: b.x, y: b.y },
        { x: b.x + b.w, y: b.y },
        { x: b.x + b.w, y: b.y + b.h },
        { x: b.x, y: b.y + b.h },
      ];
      return { ...base, segs: chain(c, true) };
    }
    case 'ellipse': {
      const b = markBounds(m);
      if (!b) return undefined;
      const rx = b.w / 2;
      const ry = b.h / 2;
      const cx = b.x + rx;
      const cy = b.y + ry;
      const ring = Array.from({ length: ELLIPSE_STEPS }, (_, i) => {
        const t = (i / ELLIPSE_STEPS) * Math.PI * 2;
        return { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) };
      });
      return { ...base, segs: chain(ring, true) };
    }
    case 'hatch':
    case 'dots': {
      const b = markBounds(m);
      // Shading, not an obstacle. `N` written inside a hatched magnet pole is right, and
      // the version of this that reported it as a collision got the letter moved out of
      // the magnet. See the note on `Ink`.
      return b ? { ...base, segs: [], fill: b } : undefined;
    }
    default:
      return undefined;
  }
}

/** Every mark's ink, in drawing order. */
export function inkOf(marks: Mark[]): Ink[] {
  return marks.map(markInk).filter((i): i is Ink => i !== undefined);
}

/**
 * Whether `box` lands on this mark's pen strokes, allowing `pad` units of clearance.
 *
 * Strokes only. A shaded region is something a name may be written on, and treating it as
 * an obstacle moves names off the parts they belong to — see `Ink`.
 */
export function inkHitsBox(ink: Ink, box: Box, pad = 0): boolean {
  return ink.segs.some(([a, b]) => segHitsBox(a, b, box, pad));
}

/** Closest approach from a point to this mark, shaded regions included. */
export function inkDistance(ink: Ink, p: Point): number {
  let best = ink.fill
    ? Math.hypot(
        Math.max(ink.fill.x - p.x, 0, p.x - (ink.fill.x + ink.fill.w)),
        Math.max(ink.fill.y - p.y, 0, p.y - (ink.fill.y + ink.fill.h)),
      )
    : Infinity;
  for (const [a, b] of ink.segs) best = Math.min(best, pointSegDist(p, a, b));
  return best;
}
