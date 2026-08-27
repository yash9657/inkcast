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
import type { Mark, TextElement } from '@inkcast/core';
import { DRAW_W, frameSize, safeInsets, unionArea } from '@inkcast/core';
import type { Box, Point } from './elements.js';
import { FONT, handMeasure, measureText } from './elements.js';

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

/**
 * A label's nominal extent: one unwrapped line at the author's own cap height.
 *
 * This is what the drawing *is* in authoring coordinates, and it is what `markBounds`
 * and therefore the fit are computed from. It is **not** the space the words end up
 * occupying on the board — see `labelFootprint`, which is what anything deciding
 * "will these two names collide" has to measure instead.
 *
 * Measured with the board's own hand (`handMeasure`), not chars × a constant — the
 * same one advance table every other reservation in the repo reads (plan item 2.1).
 */
export function labelBox(m: Mark): Box {
  const size = m.size ?? LABEL_SIZE;
  const text = m.text ?? '';
  const w = Math.max(size, handMeasure(text, size));
  return { x: (m.x ?? 0) - w / 2, y: (m.y ?? 0) - size * 0.7, w, h: size * 1.4 };
}

/**
 * The widest one line of a label may be before the board wraps it, at a given fit.
 *
 * A label that is a whole sentence — which the brief asks against and gets anyway —
 * becomes one enormous line across the picture unless it is capped. Capped, it wraps into
 * two or three tidy lines that `repairLabels` can place.
 */
export function labelCap(scale: number): number {
  return Math.max(280, DRAW_W * scale * 0.42);
}

/**
 * The fit a drawing beat is really laid out at, for anything measuring before a cell exists.
 *
 * A label's footprint depends on the fit, and not weakly: the board will not write below
 * `caption` size, so a name in a narrow cell comes out *relatively larger* than the author
 * sized it, and two names that clear each other at one fit are typed through each other at
 * another (`labelFootprint`). Everything in the drawing stage — the repair, the audit, the
 * gate that decides whether a drawing is worth a model call — runs before `planBoard` has
 * chosen any cell, so none of it can be handed the real number.
 *
 * A default of 1 was not a neutral stand-in for that, and the difference was measured
 * rather than argued. Over the 63 drawing beats in `projects/`, taking each beat's fit
 * from its own storyboard (a drawn element's box divided by its mark's), the fit runs
 * 0.517 to 1.262 with a median of 0.659. So 1 is the roomy end of the range, and auditing
 * there reads every drawing as less crowded than it will be: against each beat's own fit,
 * a scale of 1 calls 10 of the 41 genuinely-dirty beats clean, where 0.66 calls 5 clean and
 * 6 clean beats dirty. Missing is the failure that shipped — see `labelFootprint` — and a
 * spurious report costs one model call that `draw-critic.ts` discards unless it scores
 * better, so the trade is not symmetric.
 *
 * It is the middle of a distribution, not a fact about any one beat. A caller that knows
 * the cell passes the real fit and never reaches this: `buildDrawing` is the only one that
 * can, and does.
 */
export const TYPICAL_FIT = 0.66;

/** Role whose type size is closest to the mark's own, so labels keep their hierarchy. */
export function roleFor(px: number): TextElement['role'] {
  const roles: TextElement['role'][] = ['caption', 'label', 'body', 'heading', 'title'];
  let best = roles[0] as TextElement['role'];
  for (const r of roles) if (Math.abs(FONT[r] - px) < Math.abs(FONT[best] - px)) best = r;
  return best;
}

/**
 * The box the board will really write a label's words into, back in authoring units.
 *
 * `labelBox` is not that box and never was, and the gap between them is what put
 * "spark starts here" through "atria (spark spreads sideways)" in `cardiac8` at 51.5s.
 * `repairLabels` moved the second label 58 units right, scored the pair 20 units clear in
 * `labelBox` space, and the frame shows them overlapping by 103×29 canvas units — because
 * `labelBox` reserves one unwrapped line at the author's cap height, while the builder
 * snaps the label to the nearest type role *at the beat's fit* and wraps it at
 * `labelCap`. On that beat the two disagreed by 2.09× in width for one label and 2.48×
 * in height for the other; the 20 units of clearance the repair bought were an order of
 * magnitude inside its own measurement error.
 *
 * So this reproduces the builder's label branch exactly and divides back by the fit, so
 * the repair's ring search and canvas bounds keep speaking authoring units. Anything that
 * asks "do these words collide" measures here; `drawing.ts` builds from the same numbers,
 * and `packages/planner/test/drawing.test.ts` pins that they agree.
 *
 * (`LABEL_SLACK = 1.5` used to widen both sides. It compensated for `measureText` being
 * a chars-times-a-constant estimate that the renderer would out-wrap; with the one real
 * advance table on both sides (plan item 2.1) the estimate gap is gone, and keeping the
 * slack would over-reserve every label's width by half — which the drawing lane paid for
 * in labels shoved out of the picture they name. What residual disagreement remains is
 * the role-size-to-realized-size conversion, which no constant fixes and the realized-
 * layout report (plan item 2.7) measures for real.)
 *
 * A caller with no cell in hand gets `TYPICAL_FIT` rather than unit scale, because unit
 * scale is not the middle of the range a drawing is fitted into — it is the top of it.
 */
export function labelFootprint(m: Mark, scale = TYPICAL_FIT): Box {
  const text = (m.text ?? '').trim();
  if (!text) return labelBox(m);
  const s = scale > 0 ? scale : 1;
  const t = measureText(text, roleFor((m.size ?? LABEL_SIZE) * s), labelCap(s));
  const w = t.w / s;
  const h = t.h / s;
  return { x: (m.x ?? 0) - w / 2, y: (m.y ?? 0) - h / 2, w, h };
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

/* ------------------------------------------------------------- how full a card is */

/**
 * The frame a card is composed for, and the share of it the platforms leave alone.
 *
 * Derived rather than quoted: `safeInsets` is the one place that decides how much of a
 * frame is title-safe, and a second copy of 76.5% here would be a number to keep in step
 * with it by hand. 16:9 because that is the board `DRAW_W`x`DRAW_H` is shaped for — the
 * drawing canvas is 1000x560, which is 16:9 to within a percent — and because it is the
 * format every gate in `docs/KEYED-GATES.md` is written against. A film cast 9:16 fits the
 * same drawing into a tall card and `cardFill` below is then indicative rather than exact.
 */
const CARD_FRAME = frameSize('16:9');
const CARD_INSETS = safeInsets('16:9', CARD_FRAME);
const SAFE_SHARE =
  ((CARD_FRAME.w - CARD_INSETS.left - CARD_INSETS.right) *
    (CARD_FRAME.h - CARD_INSETS.top - CARD_INSETS.bottom)) /
  (CARD_FRAME.w * CARD_FRAME.h);

export type CardFill = {
  /** The bounds the marks span, in authoring units. */
  span: Box;
  /** Union of the marks' own boxes over the box they span: how solid the drawing is. */
  cover: number;
  /** How much of the frame a span of this *shape* can hold. 1 is the board's own shape. */
  shape: number;
  /** The share of the frame this card is predicted to carry: `SAFE_SHARE * shape * cover`. */
  fill: number;
};

/**
 * How much of the film's frame this drawing will cover, measured before anything is drawn.
 *
 * ## Why this can be known from the marks alone
 *
 * `contentFill` in `core/src/camera.ts` is the number gate 1 reads, and under `wipe` — one
 * card a beat — it reduces to three factors and nothing else. The camera is fitted to the
 * ink (`fitDrawing` is a *content* fit, and `resolveFraming` frames the union of what is on
 * the board), so **the size a drawing is authored at cannot change its fill**: scale the
 * whole thing up and the camera simply pulls back by the same ratio. What survives the fit
 * is the drawing's *shape* against the frame's and how solidly its marks fill the box they
 * span. Multiply those by the safe area, which the platforms take whatever anyone draws:
 *
 *     fill = safe area (76.5%) x shape match x cover
 *
 * That is why this lives here rather than in the renderer, and why the drawing lane can be
 * held to the board's own number without rendering a frame.
 *
 * ## What it was checked against
 *
 * The eight beats of `projects/f3ac9c760194`, predicted here from the marks against what
 * `fillcheck.mts` measured on the compiled storyboard (2026-08-26):
 *
 *     beat   predicted   board
 *     b1       12.8%     14.6%
 *     b2       12.4%     19.0%
 *     b3       14.2%     13.6%
 *     b4        9.8%     14.6%
 *     b8       17.1%     15.6%
 *
 * Pessimistic by about two points, and for a reason worth knowing: the board writes the
 * beat's own name above the card, so the target the camera really holds is the drawing
 * *plus a caption*, which adds ink and — on a very wide drawing like b2 — pulls the shot
 * back towards the frame's own proportions. This function measures the drawing it is given
 * and claims nothing about the caption above it.
 *
 * The one thing that does not survive the fit is a name. The board writes labels in its own
 * hand and will not write below `caption` size, so a drawing authored small reaches the board
 * with relatively *larger* words on it — which is why `labelFootprint` exists and why this
 * takes the same `scale` every other measurement in the lane does. On a card that is mostly
 * words the number moves with the fit; on a card that is mostly ink it does not move at all.
 *
 * `cover` is a union of **bounding boxes**, exactly as `contentFill` is, so it inherits that
 * metric's one weakness: a long diagonal `line` covers its whole box here and a few units of
 * ink on the board. That is a reason to look at frames, and a reason never to treat this
 * number as a target to be maximised — see `markcheck.mts`, which prints it beside the
 * defect score for that reason.
 */
export function cardFill(marks: Mark[], scale = TYPICAL_FIT): CardFill | undefined {
  const span = contentBounds(marks);
  if (!span || !(span.w > 0) || !(span.h > 0)) return undefined;
  const boxes = marks
    .map((m) => (m.kind === 'label' ? labelFootprint(m, scale) : markBounds(m)))
    .filter((b): b is Box => b !== undefined);
  const cover = Math.min(1, unionArea(boxes) / (span.w * span.h));
  const aspect = span.w / span.h;
  const frame = CARD_FRAME.w / CARD_FRAME.h;
  const shape = Math.min(aspect, frame) / Math.max(aspect, frame);
  return { span, cover, shape, fill: SAFE_SHARE * shape * cover };
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
  kind: Mark['kind'] | 'underlay';
  /** The pen's path. An obstacle: words across it are words on the picture. */
  segs: [Point, Point][];
  /** A shaded area (`hatch`, `dots`). Not an obstacle — see above. */
  fill?: Box;
  /** A filled region that IS an obstacle. Only the hybrid lane's underlay — see below. */
  solid?: Box;
};

/**
 * The generated picture a drawing is annotating, as ink a label must keep off.
 *
 * The one region on the board that is dense the whole way through. Our own shading is
 * deliberately writable-on and that decision is load-bearing — the version of the audit
 * that treated hatching as an obstacle moved `N` and `S` out of a bar magnet and into the
 * field lines, which is worse — but the argument does not carry over. A traced anatomical
 * drawing is not a light wash behind a name; it is interior detail at the density of the
 * thing itself, and a name written on it is unreadable however good the paper halo is.
 *
 * So the whole box is an obstacle, and the labels go where the brief already tells the
 * author to put them: the clear board on either side, with a leader reaching in.
 */
export function underlayInk(box: Box): Ink {
  return { id: 'underlay', kind: 'underlay', segs: [], solid: box };
}

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
  if (
    ink.solid &&
    overlapArea(ink.solid, {
      x: box.x - pad,
      y: box.y - pad,
      w: box.w + pad * 2,
      h: box.h + pad * 2,
    }) > 0
  )
    return true;
  return ink.segs.some(([a, b]) => segHitsBox(a, b, box, pad));
}

/** Closest approach from a point to this mark, shaded regions included. */
export function inkDistance(ink: Ink, p: Point): number {
  const area = ink.fill ?? ink.solid;
  let best = area
    ? Math.hypot(
        Math.max(area.x - p.x, 0, p.x - (area.x + area.w)),
        Math.max(area.y - p.y, 0, p.y - (area.y + area.h)),
      )
    : Infinity;
  for (const [a, b] of ink.segs) best = Math.min(best, pointSegDist(p, a, b));
  return best;
}
