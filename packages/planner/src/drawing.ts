/**
 * The drawing lane: a composed picture, in marks the author placed.
 *
 * ## What this replaces, and why enumeration had to go
 *
 * Every other lane here answers a *named* request. `buildFreeform` knows six shapes,
 * `plots.ts` knows twelve curves, `matchIcons` knows a symbol set. Each is a list, each
 * list was written from one lesson, and no list is ever finished: a battery cross-section
 * came out as a parabola because `cross-section` was a term in the bowl regex, and a ship
 * heading for the rocks came out as a hillside because nothing matched at all. Adding
 * entries does not fix that — it is the wrong axis. A topic space cannot be enumerated.
 *
 * A *mark* space can. Nine marks — box, ellipse, line, freehand stroke, arrow, written
 * label, hatching, scattered dots, typeset mathematics — compose into any whiteboard
 * drawing anyone has ever made, and the author (see `./draw-anthropic.ts`) does the
 * composing. Nothing in this file knows what a chloroplast is, and that is the point.
 *
 * ## Why the output is ordinary elements
 *
 * A mark becomes a `PathElement`, `ShapeElement`, `ArrowElement`, `TextElement` or
 * `EquationElement` — the same elements the compiler has always emitted. So a drawing is
 * not a new rendering path: the visuals stage roughens it (and typesets it), the voice
 * stage cues it, the renderer reveals it stroke by stroke, the camera frames it, `persist`
 * keeps it on the board. All of that is inherited rather than rebuilt, and every element
 * carries the part's own name — so `b3_v0_left-stack` can be cued to the words "the left
 * stack", highlighted later, or moved, which is exactly what a generated raster can never
 * offer.
 *
 * The `math` mark is the clearest case of that inheritance paying for itself. It compiles
 * to the same `EquationElement` a worked example's update line has used since the equation
 * lane was built, so the TeX is typeset by MathJax into exact glyph outlines, recorded in
 * `assets/visuals.json`, and revealed by the page runtime one glyph at a time in the order
 * the typesetter laid them out. Not one line of renderer or typesetter code was needed to
 * put a derivative inside a drawing; what was missing was a way for the *author* to ask.
 *
 * ## The two things this file decides
 *
 * 1. **Fit.** The drawing is authored on a normalised canvas and placed into whatever box
 *    the beat has. It is fitted by its *content* bounds, uniformly, so a picture that used
 *    half the canvas still fills the cell — sparse boards were a real defect — and never
 *    stretched, because a stretched drawing of anything looks wrong in a way a viewer
 *    cannot name but can always see.
 * 2. **Repair.** An author places 20 marks in one pass and will sometimes put a label on
 *    top of ink. That is mechanical, so it is fixed mechanically: `repairLabels` slides a
 *    colliding label to the nearest free space before anything is drawn.
 */
import type { ArrowElement, Element, Mark, ShapeElement } from '@inkcast/core';
import { DRAW_H, DRAW_W, logger } from '@inkcast/core';
import { round } from './curves.js';
import { cueMarks } from './draw-cues.js';
import {
  ADRIFT,
  LABEL_SIZE,
  OFF_CANVAS_SLACK,
  TYPICAL_FIT,
  type Ink,
  type Underlay,
  clipToBox,
  contentBounds,
  inkDistance,
  inkHitsBox,
  inkOf,
  labelCap,
  labelFootprint,
  underlayInk,
  markBounds,
  overlapArea,
  roleFor,
  union,
  waypoints,
} from './draw-geom.js';
import type { Box, Point } from './elements.js';
import { makeArrow, makeEquation, makeShape, makeText, mathSymbols, texBox } from './elements.js';
import { makePath } from './figures.js';

const log = logger('planner:drawing');

/** Never place more than this many marks: past it a viewer stops reading a picture. */
export const MAX_MARKS = 40;

type Fit = { s: number; ox: number; oy: number };

export { markBounds } from './draw-geom.js';

/* ------------------------------------------------------------------ geometry */

/**
 * Uniform scale and offset that puts the drawing's own content in the middle of `box`.
 *
 * Content bounds rather than the nominal canvas: an author who drew in the top half
 * would otherwise get a picture half the size it could be, in a cell that then reads as
 * empty. Clamped to 1.6× so a two-mark drawing is not blown up into a poster.
 */
export function fitDrawing(marks: Mark[], box: Box): Fit {
  const content = contentBounds(marks) ?? { x: 0, y: 0, w: DRAW_W, h: DRAW_H };
  const s = Math.min(1.6, Math.min(box.w / content.w, box.h / content.h));
  return {
    s,
    ox: box.x + (box.w - content.w * s) / 2 - content.x * s,
    oy: box.y + (box.h - content.h * s) / 2 - content.y * s,
  };
}

/**
 * The whole authoring canvas onto `box`, uniformly — the fit for an annotated drawing.
 *
 * **Content fit is catastrophic for a drawing composed on top of a picture.** It rescales
 * by where the marks happen to be, and the marks' coordinates are worth something only
 * because they line up with an image that was placed by an entirely different rule. Twenty
 * marks in the middle of the board would be blown up to fill the cell while the heart
 * underneath them stayed where it was, and no amount of briefing the author would save it.
 *
 * So when there is an underlay, the marks and the image go through *this one transform* —
 * the image is placed at this transform's picture of the box it was measured into, and
 * nothing else scales anything. `underlaysheet.mts` sidesteps the same trap by compositing
 * in flat SVG rather than through `openDrawPreview`, and says so in a comment.
 *
 * Uncapped, unlike `fitDrawing`: the 1.6x clamp is there to stop a two-mark drawing being
 * blown up into a poster, and the canvas is never two marks.
 */
export function fitCanvas(box: Box): Fit {
  const s = Math.min(box.w / DRAW_W, box.h / DRAW_H);
  return {
    s,
    ox: box.x + (box.w - DRAW_W * s) / 2,
    oy: box.y + (box.h - DRAW_H * s) / 2,
  };
}

/** A box in authoring-canvas units, as the board will draw it under `fit`. */
export function boxAt(fit: Fit, b: Box): Box {
  return {
    x: round(fit.ox + b.x * fit.s, 2),
    y: round(fit.oy + b.y * fit.s, 2),
    w: round(b.w * fit.s, 2),
    h: round(b.h * fit.s, 2),
  };
}

const at = (fit: Fit, x: number, y: number): Point => ({
  x: round(fit.ox + x * fit.s, 2),
  y: round(fit.oy + y * fit.s, 2),
});

/* --------------------------------------------------------------------- maths */

/**
 * Seconds per symbol, for how long an equation takes to write itself.
 *
 * The board's other marks enter in `enter.duration`'s default 0.8s, and that number was
 * chosen for things that are one or two strokes. An equation is one element made of a
 * dozen tiny filled outlines, and the page runtime divides the element's window between
 * them by ink (`layoutAll` in `page/runtime.js`), so 0.8s spread over eleven glyphs is 73ms
 * each — under two frames at 30fps, which is not a hand writing but a row of symbols
 * flickering on. Nine hundredths of a second a symbol puts each glyph on screen for about
 * three frames of being drawn, which is what the handwriting lane already spends per word.
 */
const MATH_GLYPH_SECONDS = 0.09;

/**
 * How long this equation spends being written, in seconds.
 *
 * Bounded at both ends: a two-symbol equation still gets long enough to read as drawn
 * rather than blinked, and a long one is not allowed to spend the whole beat on itself —
 * `itemsFor` in the renderer clamps a duration to the room left in the scene anyway, and an
 * element that fills its beat leaves the marks after it nowhere to go.
 */
function mathDuration(tex: string): number {
  return Math.min(2.6, Math.max(0.9, 0.3 + mathSymbols(tex) * MATH_GLYPH_SECONDS));
}

/**
 * A `math` mark with the box it will be typeset into, filled in if the author left it out.
 *
 * `math` is a box-shaped kind — `x`,`y` is its top-left corner, exactly as for `rect` and
 * `hatch` — so `markBounds` needs no knowledge of it and the fit, the repair and the audit
 * all measure an equation without a special case. An author that omits the box gets one
 * derived from `size` and the length of the TeX rather than having the mark dropped, which
 * is the difference between "the equation is where I asked for it, sized as the board saw
 * fit" and a blank space where the maths was supposed to be.
 *
 * **Idempotent, and that is load-bearing.** `prepareMarks` promises to be, because the
 * audit, the preview shown to the correcting model and the builder all run it over marks
 * that may already have been through it. So this only ever *fills* `w`/`h` and never moves
 * `x`/`y`: a normalisation that recentred the box would walk the equation half its own
 * width across the canvas every time something asked what the drawing looks like.
 */
function withMathBox(m: Mark): Mark {
  if (m.kind !== 'math' || (m.w !== undefined && m.h !== undefined)) return m;
  const size = m.size ?? LABEL_SIZE;
  const t = texBox(m.tex ?? '', size);
  return { ...m, w: m.w ?? t.w, h: m.h ?? t.h };
}

/**
 * An equation as ink a name may not be written across.
 *
 * The same judgement `underlayInk` makes, for the same reason and against the same
 * counter-example. Our hatching is deliberately *writable-on* — the version of the audit
 * that treated it as an obstacle moved `N` and `S` out of a bar magnet and into the field
 * lines, which is worse — but that argument is about a light wash behind a word. Typeset
 * mathematics is not a wash: a fraction has a rule straight through the middle of its box
 * and the glyphs are filled outlines at the density of print, so a part name written on top
 * of one is unreadable, and worse, it is unreadable in the one place on the board where a
 * learner cannot guess what was meant.
 *
 * It lives here rather than in `markInk` because `markInk` answers `undefined` for a kind
 * it does not know, which makes an unhandled kind invisible to the repair rather than
 * visibly wrong. The repair below is the caller that must not be blind to an equation, so
 * this is next to it; `draw-audit.ts` builds its own ink list from `inkOf` and therefore
 * still cannot see one.
 */
export function mathInk(m: Mark): Ink | undefined {
  if (m.kind !== 'math') return undefined;
  const b = markBounds(withMathBox(m));
  return b ? { id: m.id, kind: 'math', segs: [], solid: b } : undefined;
}

/** The ink of every `math` mark in a drawing, which `inkOf` does not report. */
function mathInkOf(marks: Mark[]): Ink[] {
  return marks.map(mathInk).filter((i): i is Ink => i !== undefined);
}

/* -------------------------------------------------------------------- repair */

/**
 * What lying across one crossed stroke costs, in units of displacement × 2.
 *
 * 150 buys 300 units of movement, and that number is geometry rather than taste. Escaping
 * a *long* leader is not a nudge: an arrow crossing a label at a slope of 0.5 leaves the
 * label's box only when the box clears the line along its whole width, so a 307-unit-wide
 * name on such an arrow has to travel about 130 units, and a wider name or a steeper
 * leader further. At the previous price of 50 — 100 units of movement — every one of those
 * escapes was arithmetically unaffordable, so the search was pruned after two rings and
 * the label stayed exactly where it was. That is the defect the header describes as
 * "labels crowding arrows for three sessions": it survived the rewrite that was supposed
 * to fix it, because the rewrite fixed the *obstacle detection* and left the price alone.
 *
 * Swept over the 192 drawings in `~/.inkcast/cache/drawings` with
 * `npx tsx packages/planner/src/markcheck.mts cache`, against `defectScore` (raw 4499
 * throughout — the sweep changes only what the repair keeps):
 *
 * | crossed / adrift  | kept | label-on-ink | adrift | off-canvas | on-label |
 * | ----------------- | ---- | ------------ | ------ | ---------- | -------- |
 * | 50 / 50, as shipped | 1328 | 294        | 25     | 56         | 3        |
 * | 50 / 50, with seats | 1429 | 320        | 31     | 59         | 0        |
 * | 100 / 100         | 1052 | 227          | 28     | 58         | 0        |
 * | 150 / 150         |  923 | 192          | 29     | 63         | 0        |
 * | **150 / 400**     |  966 | 208          | 8      | 63         | 0        |
 * | 150 / 600         |  970 | 210          | 4      | 63         | 0        |
 * | 300 / 50          |  761 | 134          | 88     | 66         | 1        |
 *
 * Two rows earn their place. The second says the seat reservation above *costs* 101 points
 * at the old price — it blocks escapes that used to be available — so it only pays for
 * itself once the escape is priced properly, which is why the two changes are one change.
 * The last says why the lowest total is not the answer: raising this price alone drives
 * `label-on-ink` down hardest and pays for it in the defect that is the repair's own doing,
 * a name marooned 88 times over where it names nothing. That is what the weights were tuned
 * out of once already (see the header), returning the moment the escape got cheap and the
 * penalty for escaping too far did not keep up.
 *
 * 200/400 scores better still (878). Stopping at 150 is the restraint the header argues
 * for: 300 units of travel is what the geometry above asks for, the rest is a checker being
 * satisfied, and this pass is not the whole fix — the model revises after it.
 */
const CROSSED_INK = 150;

/**
 * What ending up too far from any ink to be naming anything costs.
 *
 * Held above `CROSSED_INK` deliberately, at a ratio of 8:3. A label that has crossed the
 * board to escape an arrow and is now sitting on blank paper has not been repaired, it has
 * been lost, and the whole point of the scored search (header, "the old failure in a new
 * costume") is that it must never be able to buy its way out of one defect into a worse
 * one. Pricing it here rather than in `ADRIFT` — which is a *distance* in `draw-geom.ts`,
 * shared with the audit — keeps the threshold and the penalty separate: what counts as
 * adrift is a judgement about the drawing, what it costs is a judgement about this search.
 *
 * The sweep above is the evidence: at 400 the marooned-label count falls to 8 from the 25
 * that ship today, so the change that moves 86 names off the ink they were lying across
 * also leaves a third as many names stranded as before it. Going further (600) buys 4 more
 * at the cost of 2 names left on ink, which is trading a weight-1 defect for a weight-4 one.
 */
const ADRIFT_COST = 400;

/** The eight ways out of a crowded spot, nearest first. */
const RINGS = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
] as const;

/**
 * Move labels off each other, and off the ink they are lying across.
 *
 * The failure an author reliably makes in one pass, because it is placing twenty marks by
 * coordinate with nothing to look at: the words land on the picture and on each other. On
 * a breadth test across twelve STEM subjects it was the *only* defect visible in every
 * single panel, which makes it worth more care than a nudge.
 *
 * Two rules, and the difference between them is the whole trick:
 *
 * - **A label never overlaps another label.** Always, no exceptions: two names on top of
 *   each other are unreadable and are never what anyone meant.
 * - **A label avoids the ink it would lie across, and not the space a shape encloses.**
 *   A name in the middle of a heart outline is ordinary whiteboard practice; a name lying
 *   along an arrow is not. Telling those apart needs to know where the pen went rather
 *   than what box the mark occupies, which is what `draw-geom.ts` answers — a rect is
 *   four edges, an arrow is its line, and only hatching and scattered dots fill an area.
 *   The previous version could only compare boxes, so it approximated the distinction
 *   with an area cap: ink under a fifth of the drawing is an obstacle, anything larger is
 *   a container. That got the containers right and every long arrow, gap line and leader
 *   wrong, which is why the frames still showed labels crowding arrows after it ran.
 *
 * ## Why it scores candidates instead of taking the first free one
 *
 * Because the previous version could fail, and its failure was silent: eight rings times
 * eight directions of "is this spot completely free", and if none was, it left the label
 * exactly where the author put it and returned as if it had done something. On a crowded
 * drawing that is the common case, not the edge case.
 *
 * So every candidate is scored and the best one wins. A drawing with nowhere clean to put
 * a name gets the *least bad* position rather than the authored one, ties go to staying
 * put, and a label already clear of everything scores zero and cannot be beaten.
 *
 * ## What the weights are for, and the mistake they were tuned out of
 *
 * The first scored version weighted displacement at almost nothing, and across the 41
 * cached drawings it duly removed every label collision — by throwing labels up to 180
 * units off the canvas, where they named nothing and shrank the fitted picture to make
 * room for them. `markcheck.mts` measured that as it happened: 713 raw down to 48, and
 * all 48 were labels the repair itself had marooned. That is the old failure in a new
 * costume, so **moving a name is expensive here**: 300 units of displacement costs the same
 * as lying across one mark (`CROSSED_INK`), a candidate outside the canvas is not
 * considered at all, and a name that would end up too far from any ink to be naming it is
 * charged more than the collision it escaped (`ADRIFT_COST`). Those two prices were swept
 * together over the cached corpus and the table is under `CROSSED_INK`; the short version
 * is that raising the first without the second reproduces the 2026-era marooning exactly.
 *
 * The point of that tuning is that this pass is *not* the whole fix. It nudges; the model
 * revises (`draw-anthropic.ts`), and `draw-audit.ts` decides which drawings need it. A
 * mechanical pass that mangles a drawing to satisfy a checker has made the picture worse
 * and the number better.
 *
 * ## Why it needs the fit
 *
 * Because for one whole session it was scoring the wrong boxes. It measured labels with
 * `labelBox` — one unwrapped line at the author's cap height — and `buildMark` below draws
 * them at a type role chosen from `size * fit.s`, wrapped at `labelCap`. On `cardiac8`'s
 * spark beat that disagreement was 2.09× the reserved width, so the repair
 * moved a label 58 units, declared 20 units of clearance, and the frame at 51.5s shows the
 * two names typed through each other. `labelFootprint` is the geometry the builder draws
 * in; `scale` is the fit it will be drawn at, and callers who do not know the cell yet get
 * `TYPICAL_FIT` — the middle of the range beats are really laid out at, not unit scale,
 * which is the roomy end of it (see `TYPICAL_FIT`).
 */
export function repairLabels(marks: Mark[], underlay?: Underlay, scale = TYPICAL_FIT): Mark[] {
  // A *traced* picture counts as ink, and as the one kind that cannot be written on.
  // Without it a name landing in the middle of the organ scores as free space and is left
  // exactly where it was — `inkOf` knows about marks and nothing else. A figure is in this
  // list as an enclosure only: it is an unmeasured box and there is no seat outside it to
  // move a name to. See `underlayInk`, which is where the two lanes part.
  // A typeset equation is the other kind of ink `inkOf` cannot report — `markInk` has no
  // case for `math`, so an equation would be free space to write across. See `mathInk`.
  const ink: Ink[] = [
    ...(underlay ? [underlayInk(underlay)] : []),
    ...mathInkOf(marks),
    ...inkOf(marks.filter((m) => m.kind !== 'label')),
  ];
  // Where every label is, at the moment this one is being placed: the boxes the labels
  // already dealt with ended up in, and the authored boxes of the ones not reached yet.
  //
  // The second half is the correction. This used to hold only the labels behind it, so a
  // name was free to move into a seat a *later* name was about to be placed in, and that
  // later name — arriving to find its own home taken — moved as well. Measured over the
  // 192 cached drawings: 3 of the label-on-label defects the repair leaves behind are its
  // own doing at today's price, and raising the price of crossed ink multiplies them,
  // because the artefact scales with how much movement is affordable. With the seats
  // reserved that count is **0** at every weight in the sweep under `CROSSED_INK`. Looking
  // forward as well as back costs one array and removes the artefact rather than trading
  // against it — and it is the reason the two changes had to land together.
  //
  // A label's own box is not among the obstacles it is scored against, which is what makes
  // "stay put" cost nothing for a label that is already clear.
  const seats = marks.map((m) => (m.kind === 'label' ? labelFootprint(m, scale) : undefined));
  const taken: Box[] = [];
  let ahead = seats.filter((b): b is Box => b !== undefined);
  /**
   * How far outside the canvas this box hangs, past what the audit tolerates. 0 is clean.
   *
   * A label may sit slightly outside — the drawing is fitted by its content, so a name
   * just over the edge only makes the picture slightly smaller — but this pass used to
   * decide "slightly" for itself, at 4% of each axis, which is 40 units of the width
   * against `OFF_CANVAS_SLACK`'s 8. Every seat in the gap between the two numbers is a
   * seat where the repair puts a name and the audit then bills a correction call to take
   * it out again: measured over the 238 cached drawings, 76 were off-canvas after the
   * repair and **35 of them were on-canvas as authored**.
   *
   * The rule is not "obey `OFF_CANVAS_SLACK`", because the two passes measure a label in
   * two different boxes on purpose — `labelFootprint` here, `markBounds` in the audit's
   * `contentBounds` — so a shared threshold would still not make them agree. It is **do
   * not leave a name further out than you found it**, which holds whatever the boxes are,
   * and never strands a label whose authored seat was already over the edge.
   */
  const overhang = (b: Box): number =>
    Math.max(
      0,
      -OFF_CANVAS_SLACK - b.x,
      -OFF_CANVAS_SLACK - b.y,
      b.x + b.w - (DRAW_W + OFF_CANVAS_SLACK),
      b.y + b.h - (DRAW_H + OFF_CANVAS_SLACK),
    );

  /**
   * The regions a name can be *in the middle of* and still be naming something.
   *
   * The distance rule below cannot see these, and that blind spot is what stopped the
   * price of drifting from being raised. A name in the middle of a 900x500 outline is 250
   * units from the nearest stroke, which is over `ADRIFT` — so "the heart" written inside
   * the heart scored as a label naming nothing, and a repair that took drifting seriously
   * dragged it out to sit on an edge. That is ordinary whiteboard practice being repaired
   * into a defect, and `repairLabels`' first rule is that the space a shape encloses is not
   * an obstacle: it is the one place the name most obviously belongs.
   *
   * Closedness is read off the geometry rather than the kind, which is what makes this
   * exact. `chain` closes the loop for a `rect`, an `ellipse` and a `stroke` the author
   * marked closed, and leaves a line, an arrow and an open stroke as a path — so a loop of
   * segments is *precisely* the set of marks that enclose anything. Taking the kinds
   * instead would have missed the closed freehand stroke every traced organ is drawn with,
   * and taking bounding boxes would have made the long diagonal arrow "enclose" the whole
   * drawing, which is the area-cap mistake the header of this function is about.
   *
   * Shading counts too, on the same argument the `Ink.fill` comment makes about hatching:
   * `N` inside a hatched magnet pole is right, so it is not adrift either.
   */
  const enclosures: Box[] = ink.flatMap((k) => {
    if (k.fill) return [k.fill];
    if (k.solid) return [k.solid];
    const first = k.segs[0]?.[0];
    const last = k.segs[k.segs.length - 1]?.[1];
    if (k.segs.length < 3 || !first || !last) return [];
    if (first.x !== last.x || first.y !== last.y) return [];
    const xs = k.segs.map((s) => s[0].x);
    const ys = k.segs.map((s) => s[0].y);
    return [
      {
        x: Math.min(...xs),
        y: Math.min(...ys),
        w: Math.max(...xs) - Math.min(...xs),
        h: Math.max(...ys) - Math.min(...ys),
      },
    ];
  });
  const inside = (p: Point): boolean =>
    enclosures.some((e) => p.x >= e.x && p.x <= e.x + e.w && p.y >= e.y && p.y <= e.y + e.h);

  /** Lower is better. A collision justifies a move; nothing else does. */
  const cost = (b: Box, from: Box): number => {
    const onLabels = [...taken, ...ahead].reduce((n, o) => n + (overlapArea(b, o) > 0 ? 1 : 0), 0);
    const hit = ink.filter((k) => inkHitsBox(k, b, 6));
    const onInk = hit.filter((k) => !k.solid).length;
    // A traced picture is priced eight times a crossed stroke, and the difference is
    // the difference between the two obstacles. Crossing one arrow is untidy and a name
    // written across a traced organ is illegible, full stop — but escaping a picture that
    // occupies a third of the board costs 200-odd units of displacement, and at the ink
    // rate the arithmetic says a collision is the cheaper of the two. It is not. This is
    // the only obstacle worth crossing the board to avoid, so it is the only one priced
    // to. Escaping is always possible, and that is a fact about the *traced* lane only:
    // the picture is placed inside `UNDERLAY_AREA` precisely so there is clear board on
    // either side for the names to reach. A figure is placed in `FIGURE_AREA` instead,
    // leaving 80 units a side — narrower than one word — so there is nowhere to escape to
    // and this price would buy a search that can only fail. It is not charged for one:
    // `underlayInk` hands a figure over as `fill`, which never reaches `hit`.
    const onSolid = hit.filter((k) => k.solid).length;
    const centre = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    const nearest = ink.reduce((d, k) => Math.min(d, inkDistance(k, centre)), Infinity);
    const adrift = ink.length && nearest > ADRIFT && !inside(centre) ? 1 : 0;
    const moved = Math.hypot(b.x - from.x, b.y - from.y);
    return (
      onLabels * 1000 + onSolid * 400 + onInk * CROSSED_INK + adrift * ADRIFT_COST + moved * 0.5
    );
  };

  return marks.map((m, i) => {
    if (m.kind !== 'label') return m;
    const home = seats[i] as Box;
    // Out of the "not reached yet" list before it is scored, so the only box this label is
    // never charged for colliding with is its own.
    ahead = ahead.filter((b) => b !== home);
    let best = home;
    let bestCost = cost(home, home);
    // The seat the author chose is always admissible, however far out it is — this pass
    // moves names off each other and off ink, and a name it refused to place anywhere
    // would be a name left on top of another one. `overhang` bounds where it may go
    // *instead*, and this is the bound.
    const homeOverhang = overhang(home);
    if (bestCost > 0) {
      const step = Math.max(20, home.h * 0.8);
      // How far out to search, from the weights rather than from a count. Every candidate
      // at ring `r` has already been charged `r * step * 0.5` for the displacement alone,
      // so once that floor exceeds the best score so far no further ring can win and the
      // search is finished — which lets it reach right across the board when the thing
      // being escaped is worth crossing the board to escape, and stop after two rings when
      // it is not.
      //
      // The fixed eight rings this replaces made the reach a function of the label's cap
      // height, which is nothing to do with how far it has to go. `underlay.test.ts`'s
      // one-line "AV node" over a 348-unit picture had a reach of 230 units and needed
      // 254: it stayed on the organ, and the comment above promising that escaping is
      // always possible was false for exactly the labels that most needed it.
      const maxRing = Math.ceil((DRAW_W + home.w) / step);
      let searched = 0;
      let admissible = 0;
      for (let ring = 1; ring <= maxRing && bestCost > ring * step * 0.5; ring++) {
        searched += 1;
        for (const [dx, dy] of RINGS) {
          const moved = { ...home, x: home.x + dx * step * ring, y: home.y + dy * step * ring };
          if (overhang(moved) > homeOverhang) continue;
          admissible += 1;
          const c = cost(moved, home);
          if (c < bestCost) {
            best = moved;
            bestCost = c;
          }
        }
      }
      // Said out loud, because the search can have nothing to search and used to return
      // silently as if it had worked — the same silent failure the scoring above was
      // introduced to end. `inside` is checked in authoring units while a footprint grows
      // as 1/scale, so a narrow cell can put every candidate out of bounds: on
      // `cardiac8`'s spark beat fitted at s=0.3 the four names measure 1145, 970, 630 and
      // 1200 units wide on a 1000-wide canvas, no candidate is admissible, and every label
      // stays exactly where the author put it. That is not a regression — it is still at
      // least as good as what shipped at every cell width measured — but a repair that did
      // nothing has to be distinguishable from a repair that found the drawing clean.
      //
      // `searched` is what makes the sentence true rather than merely frequent. The other
      // way out of the loop is the pruning above: a single crossed stroke scores
      // `CROSSED_INK`, and a three-line name has a footprint 165 units tall, so ring 3 is
      // already charged 198 and the search stops after two. That is the scoring deciding no
      // further move is worth making — the label is placeable, it is just not worth placing
      // further out — and blaming the canvas for it would put a false cause in the log.
      if (searched && !admissible)
        log.debug(
          `label "${m.text ?? m.id}" had nowhere to go: nothing inside the ${DRAW_W}x${DRAW_H} canvas fits its ${round(home.w, 0)}x${round(home.h, 0)} footprint at this fit`,
        );
    }
    taken.push(best);
    if (best === home) return m;
    log.debug(`label "${m.text ?? m.id}" moved clear of what it landed on`);
    return { ...m, x: best.x + best.w / 2, y: best.y + best.h / 2 };
  });
}

/**
 * A label that is captioning the whole picture rather than naming a part of it.
 *
 * Every beat already has its idea written above its cell by the compiler, so a drawing
 * that titles itself puts two captions on one panel — and the title is big, so it is the
 * one that lands across the drawing. Seen on four of twelve breadth-test subjects
 * ("Matrix Multiplication" over the grids, "Binary Search" over the numbers). The brief
 * says not to; this is the half that does not rely on being obeyed.
 *
 * Large, near the top, and more than one word: a big `N` or `+` label inside a diagram is
 * none of those things and survives.
 */
function isTitle(m: Mark, canvas: Box | undefined): boolean {
  if (m.kind !== 'label') return false;
  const size = m.size ?? 30;
  const words = (m.text ?? '').trim().split(/\s+/).length;
  const top = canvas ? canvas.y + canvas.h * 0.14 : DRAW_H * 0.14;
  return size >= 40 && words >= 2 && (m.y ?? 0) <= top;
}

/** Marks worth drawing: real geometry, no self-titling, no duplicates, capped. */
export function cleanMarks(marks: Mark[]): Mark[] {
  const canvas = contentBounds(marks.map(withMathBox));
  const seen = new Set<string>();
  const out: Mark[] = [];
  for (const raw of marks) {
    // An equation gets the box it will be typeset into before anything measures it, so
    // every consumer downstream of here — the fit, the repair, the audit, the builder —
    // sees one box and not four opinions about how wide a fraction is.
    const m = withMathBox(raw);
    if (markBounds(m) === undefined) continue;
    if (m.kind === 'label' && !(m.text ?? '').trim()) continue;
    if (m.kind === 'math' && !(m.tex ?? '').trim()) {
      // Said out loud, and it is the only drop in this function that is. An author asking
      // for notation and getting empty space is precisely the silent degradation this lane
      // keeps paying for: a `label` with no text is a mark that was never going to say
      // anything, but a `math` with no `tex` is a beat whose whole point was the equation.
      log.warn(`math mark "${m.id}" carries no tex — dropping it; the board draws nothing`);
      continue;
    }
    if (isTitle(m, canvas)) {
      log.debug(`dropped the drawing's own title: "${m.text}"`);
      continue;
    }
    const id = m.id && !seen.has(m.id) ? m.id : `${m.id || m.kind}-${out.length}`;
    seen.add(id);
    out.push({ ...m, id });
    if (out.length >= MAX_MARKS) break;
  }
  return out;
}

/**
 * The marks that will actually be drawn, from the marks the author placed.
 *
 * One function because three callers have to agree on it: the builder below, the audit
 * that decides whether a drawing needs a model's attention, and the preview a model is
 * shown. An audit of raw marks would report collisions this pass is about to fix for
 * free, and a preview of raw marks would show the model a drawing nobody will ever see.
 *
 * Idempotent, which is what makes it safe to run over a revision that has already been
 * through it: cleaning keeps what it kept, and a label already clear of everything is
 * scored zero and left alone.
 */
export function prepareMarks(marks: Mark[], underlay?: Underlay, scale = TYPICAL_FIT): Mark[] {
  return repairLabels(cleanMarks(marks), underlay, scale);
}

/* ------------------------------------------------------------------ building */

function arcs(cx: number, cy: number, r: number): string {
  return `M${round(cx - r, 2)},${round(cy, 2)}a${r},${r} 0 1,0 ${r * 2},0a${r},${r} 0 1,0 ${-r * 2},0`;
}

/**
 * One mark, as the elements that draw it.
 *
 * `hatch` and `dots` become a single element carrying many subpaths rather than one
 * element per line or per dot: forty elements for one shaded region would each claim a
 * cue, a reveal and a row in every downstream table, and they are one gesture of the
 * hand, not forty.
 */
/**
 * The `rect`/`ellipse` marks that are **bodies** rather than frames, by id.
 *
 * `makeShape` defaults `fill: false` and `buildMark` never passed anything else, so every
 * shape this lane has ever produced is an empty outline and `hachurePolygon` — which
 * `render/src/sketch.ts` documents as "used for `fill: true` shapes" — has been dead code
 * for it. That is half of why our ink is spindly where the reference product's is fat:
 * their solids are shaded regions and ours are rings (`docs/PLAN-GOLPO-CLOSE.md` §4.2).
 *
 * The test is deliberately the conservative one — **nothing else is drawn inside it**,
 * measured by whether another mark's centre falls in its box:
 *
 *  - a container gets its label's centre and is left an outline, which is right: a box
 *    around words is a frame, and shading it would put ink under handwriting and trip the
 *    no-writing-inside-hatching rule the brief is measured on;
 *  - a circle the author has already shaded with `hatch` gets that hatch's centre and is
 *    left alone, so the two fills cannot fight;
 *  - an arrow *pointing at* a body keeps its centre outside and does not suppress it.
 *
 * Suppressing wrongly costs nothing — it is the behaviour of every drawing built before
 * this — so the predicate errs that way on purpose.
 *
 * This changes no QC arithmetic: `boardcheck`'s overlap sweep already counts `shape` as
 * solid whether or not it is filled, so what moves here is pixels and nothing else.
 */
function solidBodies(marks: readonly Mark[]): Set<string> {
  const bodies = new Set<string>();
  const boxes = marks.map((m) => markBounds(m));
  marks.forEach((m, i) => {
    if (m.kind !== 'rect' && m.kind !== 'ellipse') return;
    const b = boxes[i];
    if (!b) return;
    const inside = boxes.some((o, k) => {
      if (k === i || !o) return false;
      const cx = o.x + o.w / 2;
      const cy = o.y + o.h / 2;
      return cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h;
    });
    if (!inside) bodies.add(m.id);
  });
  return bodies;
}

function buildMark(m: Mark, id: string, fit: Fit, solid = false): Element[] {
  const P = (x: number, y: number): Point => at(fit, x, y);
  const pts = waypoints(m).map((p) => P(p.x, p.y));

  switch (m.kind) {
    case 'rect':
    case 'ellipse': {
      const b = markBounds(m);
      if (!b) return [];
      const tl = P(b.x, b.y);
      const el: ShapeElement = makeShape(id, m.kind, round(b.w * fit.s, 2), round(b.h * fit.s, 2), {
        fill: solid,
      });
      el.at = { x: tl.x, y: tl.y, w: el.at.w, h: el.at.h };
      return [el];
    }
    case 'line':
    case 'stroke': {
      if (pts.length < 2) return [];
      // Smooth strokes go in as waypoints, which the visuals stage splines. Anything
      // meant to be angular — a polygon, a zigzag, a wire with corners — goes in as
      // explicit path data, because that lane is verbatim and a spline would round off
      // the corners that made it a zigzag.
      if (m.smooth && m.kind === 'stroke') {
        return [makePath(id, pts, { closed: m.closed, weight: 1 })];
      }
      const d = `M${pts.map((p) => `${p.x},${p.y}`).join('L')}${m.closed ? 'Z' : ''}`;
      const el = makePath(id, pts, { closed: m.closed });
      delete el.points;
      el.d = d;
      return [el];
    }
    case 'arrow': {
      if (pts.length < 2) return [];
      const from = pts[0] as Point;
      const to = pts[pts.length - 1] as Point;
      // Three or more waypoints means the author bent it deliberately; the IR carries a
      // curve amount rather than a path, so the middle point's distance off the chord is
      // measured and handed over as that amount.
      let curve = 0;
      if (pts.length > 2) {
        const mid = pts[Math.floor(pts.length / 2)] as Point;
        const chord = Math.hypot(to.x - from.x, to.y - from.y) || 1;
        const cross =
          ((to.x - from.x) * (mid.y - from.y) - (to.y - from.y) * (mid.x - from.x)) / chord;
        curve = Math.max(-1, Math.min(1, (cross / chord) * 2));
      }
      const el: ArrowElement = makeArrow(id, { from, to, curve });
      return [el];
    }
    case 'label': {
      const text = (m.text ?? '').trim();
      if (!text) return [];
      // Role and cap live in `draw-geom.ts` and are read back by `labelFootprint`,
      // because the repair a few lines up has to reserve the box these lines produce.
      // When they were spelled out here instead, the repair reserved a different box and
      // `cardiac8` shipped two names typed through each other. (The `LABEL_SLACK`
      // widening that used to sit between them compensated for `measureText` being a
      // chars-times-a-constant estimate; the estimate is now the real advance table, so
      // the slack is gone from both sides — plan item 2.1.)
      const role = roleFor((m.size ?? 30) * fit.s);
      const el = makeText(id, text, role, { align: 'center', maxWidth: labelCap(fit.s) });
      const c = P(m.x ?? 0, m.y ?? 0);
      el.at = {
        x: round(c.x - el.at.w / 2, 2),
        y: round(c.y - el.at.h / 2, 2),
        w: el.at.w,
        h: el.at.h,
      };
      return [el];
    }
    case 'math': {
      const tex = (m.tex ?? '').trim();
      const b = markBounds(withMathBox(m));
      if (!tex || !b) return [];
      // The box is everything this branch decides. `resolveEquation` in the visuals stage
      // typesets the TeX and fits the result inside `at` preserving its aspect, centred —
      // so the size of the glyphs is a consequence of the box the author reserved and the
      // shape of the notation, and nothing here has to know how wide a `\partial` is. The
      // estimated box `makeEquation` computes from the source (`texBox`) is discarded
      // here because a `math` mark's author reserved a real box of their own.
      //
      // `display: true` always. Inline style tucks a sum's limits beside the sigma to fit
      // in running text, and there is no running text on a whiteboard — the maths is the
      // thing being looked at, so it is set the way it would be on a blackboard.
      const el = makeEquation(id, tex, roleFor((m.size ?? LABEL_SIZE) * fit.s), {
        align: 'center',
        display: true,
        enter: { duration: mathDuration(tex) },
      });
      el.at = boxAt(fit, b);
      return [el];
    }
    case 'hatch': {
      const b = markBounds(m);
      if (!b) return [];
      const ang = (((m.angle ?? 45) % 180) * Math.PI) / 180;
      const dx = Math.cos(ang);
      const dy = Math.sin(ang);
      // Spacing in *canvas* units so shading reads the same whatever size the drawing
      // was fitted to — hatching that scales with the box turns into a solid block in a
      // small cell and into stripes in a large one.
      const gap = 22 / Math.max(0.001, fit.s);
      const reach = Math.hypot(b.w, b.h);
      const segs: string[] = [];
      for (let t = -reach; t <= reach; t += gap) {
        const cx = b.x + b.w / 2 - dy * t;
        const cy = b.y + b.h / 2 + dx * t;
        const seg = clipToBox(
          { x: cx - dx * reach, y: cy - dy * reach },
          { x: cx + dx * reach, y: cy + dy * reach },
          b,
        );
        if (!seg) continue;
        const a = P(seg[0].x, seg[0].y);
        const c = P(seg[1].x, seg[1].y);
        segs.push(`M${a.x},${a.y}L${c.x},${c.y}`);
      }
      if (!segs.length) return [];
      const el = makePath(id, [P(b.x, b.y), P(b.x + b.w, b.y + b.h)], { weight: 0.7 });
      delete el.points;
      el.d = segs.join('');
      el.at = {
        x: Math.min(P(b.x, b.y).x, P(b.x + b.w, b.y + b.h).x),
        y: Math.min(P(b.x, b.y).y, P(b.x + b.w, b.y + b.h).y),
        w: round(b.w * fit.s, 2),
        h: round(b.h * fit.s, 2),
      };
      return [el];
    }
    case 'dots': {
      const b = markBounds(m);
      if (!b) return [];
      const n = Math.max(1, Math.min(30, Math.round(m.count ?? 6)));
      // Deterministic scatter: the same drawing has to produce the same dots on every
      // render, or a cached storyboard and a fresh one disagree about the picture.
      let seed = 0;
      for (const ch of m.id) seed = (seed * 31 + ch.charCodeAt(0)) & 0x7fffffff;
      const rnd = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      // Small and heavily stroked rather than large and filled. A filled circle goes
      // through roughjs's hachure, and at dot scale a hachure is one line across the
      // middle — so the first version of this drew rings, not dots. A circle of four
      // units under a triple-weight pen is solid at every size the board is watched at.
      const r = Math.max(2, 4.5 * fit.s);
      const ds: string[] = [];
      for (let i = 0; i < n; i++) {
        const p = P(b.x + rnd() * b.w, b.y + rnd() * b.h);
        ds.push(arcs(p.x, p.y, r));
      }
      const el = makePath(id, [P(b.x, b.y), P(b.x + b.w, b.y + b.h)], { fill: true, weight: 3 });
      delete el.points;
      el.d = ds.join('');
      el.closed = true;
      el.at = {
        x: P(b.x, b.y).x,
        y: P(b.x, b.y).y,
        w: round(b.w * fit.s, 2),
        h: round(b.h * fit.s, 2),
      };
      return [el];
    }
    default:
      return [];
  }
}

/**
 * A composed drawing, fitted into `box` and ready for the board.
 *
 * Elements come back in the order the author placed them, which is the order a person
 * would draw them — containers, then parts, then connectors, then labels — and each one
 * is given a fraction of the beat so the picture builds instead of appearing. The last
 * mark lands at 0.72 rather than at the end, because the words that name a picture have
 * to be spoken while it is still being drawn.
 *
 * Given the beat's `narration`, each mark also claims the words that name it (see
 * `./draw-cues.ts`), so the picture advances with the sentence instead of arriving on one
 * phrase of it. The fractions above stay as the fallback for a cue that cannot be found,
 * which is what the voice stage needs when a drawing names nothing the narrator says.
 */
export function buildDrawing(
  marks: Mark[],
  ctx: { id: string; box: Box; narration?: string; underlay?: boolean },
): Element[] {
  const cleaned = cleanMarks(marks);
  if (!cleaned.length) return [];
  // Which fit, and it is the difference between a drawing and an annotation. See
  // `fitCanvas`: content bounds are right for a picture that is only its own marks and
  // wrong for one whose marks are aimed at something else on the board.
  //
  // It is computed twice on purpose. The repair needs a fit to measure a label's real
  // footprint against, and the fit needs the repaired marks to know the content bounds —
  // so the repair is given the fit of the *cleaned* marks, which is the only end of that
  // circle that exists before anything moves. Refitting afterwards is what keeps the
  // guarantee that everything drawn lands inside `box`.
  //
  // The residual was measured rather than argued about. Rebuilding all 61 cached drawing
  // beats into one cell: 27 pairs of drawn names overlapped on 16 beats before this, the
  // worst by 4759 square canvas units; after, one pair on one beat, by 0.84 units of line
  // height — a hairline, and it is exactly this gap between the two fits. Running the
  // repair a second time at the settled fit closes it to 15 square units and opens a
  // second hairline somewhere else, which is not worth a second pass over every drawing.
  const first = ctx.underlay ? fitCanvas(ctx.box) : fitDrawing(cleaned, ctx.box);
  const clean = repairLabels(cleaned, undefined, first.s);
  const fit = ctx.underlay ? first : fitDrawing(clean, ctx.box);
  const cues = ctx.narration ? cueMarks(clean, ctx.narration) : [];
  // Decided over the whole drawing, because "is anything inside this" is not a question
  // one mark can answer about itself. See `solidBodies`.
  //
  // Never on a figure beat. `FIGURE_BRIEF`'s NEVER SHADE rule is a measured defect fix
  // for marks drawn *over* a raster picture, and a filled shape is shading by another
  // name: the first cast with this wiring on put a solid disc across the ball in "A ball
  // and a lamp". The underlay is the whole signal — if there is a picture behind these
  // marks, the marks annotate it and do not colour it in.
  const bodies = ctx.underlay ? new Set<string>() : solidBodies(clean);
  const out: Element[] = [];
  clean.forEach((m, i) => {
    const slug = m.id.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || `m${i}`;
    const cue = cues[i];
    for (const el of buildMark(m, `${ctx.id}_${slug}`, fit, bodies.has(m.id))) {
      el.enter = {
        ...el.enter,
        at: round(0.06 + (i / Math.max(1, clean.length)) * 0.66, 3),
        ...(cue ? { cue } : {}),
      };
      // `ink` is what an element without a tone already draws in, so it is not recorded:
      // every element carrying a redundant field is a storyboard that differs from the
      // one before it in nothing but noise.
      if (m.tone && m.tone !== 'ink') el.tone = m.tone;
      out.push(el);
    }
  });
  return out;
}
