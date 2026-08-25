/**
 * How long a piece of ink takes a hand to draw.
 *
 * ## The 0.8 seconds this replaces
 *
 * `Enter.duration` defaults to 0.8 s and — until this file existed — that default
 * was the *authoritative* number for almost every mark on the board. A two-stroke
 * arrowhead, a box, a title, and a whole labelled diagram were all given the same
 * 0.8 s, which produced two defects at once and they are the same defect seen from
 * two sides:
 *
 *  - **The big things flash.** A drawing is not drawn, it appears. The page runtime
 *    divides an item's window between its parts by ink (`layoutAll`), so 0.8 s over
 *    a picture's forty strokes is twenty milliseconds each — under a frame at 30 fps.
 *  - **The small things collide.** Everything takes the same time, so reveals cued
 *    0.3 s apart overlap for 0.5 s each. Scene s2 of `projects/deb81002b073` starts
 *    six marks within 0.9 s of each other and three or four are half-drawn at once
 *    while a single pen sprite hops between them. That is the "half-done drawings
 *    everywhere" the dissection named, and no amount of cue tuning fixes it while
 *    every mark costs the same.
 *
 * ## The model
 *
 * The page already knows how to divide a window by ink. `layoutAll` assigns every
 * part a `cost` — stroke length for a dash-revealed path, rendered text width times
 * `WRITE_COST` for a written line, a token for a fade, a real share for a figure —
 * and splits the item's time in proportion. That cost model is *reproduced here*
 * rather than invented: the two must agree, or a duration computed in Node buys
 * time the browser spends somewhere else. The constants below are the runtime's own
 * and are checked against it by `inktime.test.ts`.
 *
 * What is new is the second half: cost divided by a **speed**, so the number of
 * seconds follows the amount of ink instead of being fixed.
 *
 * ## Why the speed is in output pixels
 *
 * A hand does not draw canvas units, it draws *what the viewer sees*. The same
 * 150-unit box is a thumbnail on an accumulating mega-canvas at zoom 1.2 and half
 * the screen on a wiped card at zoom 4.4, and a model in canvas units per second
 * would draw them at the same rate — the wide shot crawling, the close-up flashing.
 * So cost is converted through the scene's own `pxPerUnit` (`basePxPerUnit` times
 * that scene's zoom) and the pack's speed is in output pixels per second, which is
 * a number a person can check by watching one.
 *
 * ## The clamps are not decoration
 *
 * `MIN_DRAW_SEC` keeps a two-stroke mark from being a blink; `MAX_DRAW_SEC` keeps a
 * dense figure from eating a beat that has other things to say. Between them the
 * duration is the honest one. `itemsFor` clamps again, to the room actually left in
 * the scene — this function does not know about scenes.
 */
import { basePxPerUnit } from './camera.js';
import type { FrameSize } from './camera.js';
import { handFontFor, handMetricsFor } from './fontmetrics.js';
import { flattenPathData } from './rect.js';
import { stylePackFor } from './stylepack.js';
import type { Rect } from './rect.js';

/**
 * The prims this measures, structurally.
 *
 * Deliberately a subset of the renderer's `PlanPrim` rather than an import of it:
 * `@inkcast/render` depends on core and not the other way round, and the voice
 * stage needs the same arithmetic without depending on the renderer at all (it
 * owns dwell, and dwell is "when did the last mark finish"). A `PlanPrim` is
 * assignable to this by structure, so the renderer passes its own array unchanged.
 */
export type InkPrim =
  | {
      kind: 'geom';
      d: string;
      /**
       * A path that fades in rather than being dash-revealed — a hachure fill.
       * It costs a token, not its length: nobody watches a fill being drawn.
       */
      noDash?: boolean;
    }
  | { kind: 'text'; text: string; box: Rect; size: number }
  | { kind: 'svg'; box: Rect };

/**
 * Cost per canvas unit of rendered text width. Mirrors `WRITE_COST` in
 * `render/src/page/runtime.js` — handwriting is slower per unit than a line is.
 */
const WRITE_COST = 1.55;

/** Flat cost of a part that fades. Mirrors `FADE_COST` in the runtime, before scale. */
const FADE_COST_BASE = 70;

/** Floor and ceiling on one element's entrance, in seconds. See the header. */
export const MIN_DRAW_SEC = 0.5;
export const MAX_DRAW_SEC = 3.5;

/**
 * How fast the hand moves, in output pixels of ink per second.
 *
 * The default rather than the only value: a pack may set `pen.inkSpeed`, and the
 * four shipped ones do — a broad chalk stick and a fine liner do not cover a board
 * at the same rate, and the difference is visible.
 *
 * 1800 is calibrated, not chosen. On the corpus's 4448-unit board at the panel zoom
 * a wiped card uses, it puts a small box or an arrowhead at the 0.5 s floor, a
 * labelled box at about a second, and a full figure against the 3.5 s ceiling —
 * which is the shape `docs/PLAN-WATCHABILITY.md` §1.1 asks for and roughly what the
 * Golpo references do.
 */
export const DEFAULT_INK_SPEED = 1800;

export type InkPace = {
  /** Ink style id, for the handwriting face text is measured with. */
  style: string;
  /** Canvas units per output pixel of the board itself. `Ctx.scale` in the renderer. */
  scale: number;
  /** Output pixels one canvas unit occupies in this scene — see the header. */
  pxPerUnit: number;
  /**
   * Overlapping strokes per edge (`sketch.passes`).
   *
   * Divided out, because two passes over one edge is the same *ink* drawn twice and
   * the runtime draws them together. Without this a 2-pass style would take twice as
   * long to draw the same picture as a 1-pass one, which is a property of the file
   * format rather than of the drawing.
   */
  passes: number;
  /** Output pixels per second. Defaults to the pack's `pen.inkSpeed`. */
  speed?: number;
};

/**
 * The scene-level half of an `InkPace`, computed once per board.
 *
 * `pxPerUnit` still varies per scene with the camera, so it is not folded in here.
 */
export function inkPaceFor(
  style: string,
  scale: number,
  canvas: Rect,
  frame: FrameSize,
): Omit<InkPace, 'pxPerUnit'> & { basePxPerUnit: number } {
  const pack = stylePackFor(style);
  return {
    style,
    scale,
    passes: Math.max(1, pack.sketch.passes),
    speed: pack.pen.inkSpeed,
    basePxPerUnit: basePxPerUnit(canvas, frame),
  };
}

/**
 * The ink in `prims`, in the same units the page runtime divides an item's window by.
 *
 * Canvas units, before the conversion to pixels — so this number is directly
 * comparable to the `cost` values `layoutAll` computes.
 */
export function inkCost(prims: readonly InkPrim[], pace: InkPace): number {
  const fade = FADE_COST_BASE * pace.scale;
  let total = 0;
  for (const prim of prims) {
    if (prim.kind === 'geom') {
      // A fill is not drawn, it appears behind the outline. The runtime charges it
      // a fraction of its length for exactly this reason; so does this.
      if (prim.noDash) {
        total += Math.max(20, pathLength(prim.d) * 0.35);
        continue;
      }
      const len = pathLength(prim.d);
      total += len > 0.5 ? len / pace.passes : fade;
      continue;
    }
    if (prim.kind === 'text') {
      total += Math.max(1, textWidth(prim, pace.style) * WRITE_COST);
      continue;
    }
    // A figure is the beat's picture and earns a real share of it, not a fade's
    // token. Same formula as `svgSweepPart` in the runtime.
    total += Math.max(fade * 3, (prim.box.w + prim.box.h) * 0.9);
  }
  return total;
}

/**
 * Seconds this ink takes to draw, clamped to the readable band.
 *
 * The one function both the renderer (which schedules the draw) and the voice stage
 * (which has to know when the last mark finishes, to decide how much silence a
 * scene owes the reader) compute a draw length with. Two implementations of this
 * would be two answers to "when is the board finished", and dwell is exactly the
 * distance between them.
 */
export function durationFor(prims: readonly InkPrim[], pace: InkPace): number {
  const speed = pace.speed && pace.speed > 0 ? pace.speed : DEFAULT_INK_SPEED;
  const px = inkCost(prims, pace) * Math.max(1e-6, pace.pxPerUnit);
  return clamp(px / speed, MIN_DRAW_SEC, MAX_DRAW_SEC);
}

/* ------------------------------------------ the same question, one stage earlier */

/**
 * The ink an element will turn into, estimated from the element alone.
 *
 * ## Why an estimate exists at all
 *
 * `inkCost` above is exact and needs prims, and prims are built by the renderer at
 * the very end of the pipeline. The voice stage runs *fourth*, before visuals — and
 * the voice stage is the one that owns how long a scene is, because it owns the
 * clip. So the stage that can lengthen a beat is the stage that cannot yet see what
 * the beat draws. That is not an oversight in the ordering (see the header of
 * `pipeline/src/progress.ts`: the renderer needs measured durations, so voice has to
 * come first); it is simply the shape of the problem, and this is the answer to it.
 *
 * ## What it is allowed to get wrong
 *
 * Not much, because both ends are clamped. Every duration lands in
 * `[MIN_DRAW_SEC, MAX_DRAW_SEC]`, so the estimate only has to put a mark in roughly
 * the right part of a three-second band. Where it is uncertain it errs *long* —
 * over-estimating buys the reader a little more silence than they needed, and
 * under-estimating means the renderer's exact schedule runs past the hold the voice
 * stage reserved, which is the failure this whole phase exists to remove.
 *
 * Measured from the authored box, the same choice `cue.ts`'s `dominantId` makes and
 * for the same reason: the box is what the planner reserved, and it is the only
 * geometry that exists at this point in the run.
 */
export function estimateInkCost(el: InkElement, pace: InkPace): number {
  const w = Math.max(0, el.at.w);
  const h = Math.max(0, el.at.h);
  const fade = FADE_COST_BASE * pace.scale;

  switch (el.type) {
    case 'text':
      return Math.max(1, estimateTextCost(el.text, w, h, pace.style));
    case 'equation':
      // Typeset glyph outlines, denser per unit of width than handwriting: an
      // equation is a row of small filled shapes rather than a run of strokes.
      return Math.max(1, w * WRITE_COST * 1.3);
    case 'code':
      return Math.max(1, w * h * 0.02 + w * WRITE_COST);
    case 'shape':
      // A rectangle's four edges, an ellipse's circumference — within the width of
      // the clamp band these are the same number, so the perimeter serves for both.
      return 2 * (w + h) + (el.fill ? Math.max(20, (w + h) * 0.35) : 0);
    case 'arrow':
      return Math.hypot(el.to.x - el.from.x, el.to.y - el.from.y) * 1.25;
    case 'path':
      return estimatePathCost(el, w, h);
    case 'diagram':
      // Boxes and the edges between them: more ink than its outline, less than a
      // solid figure. Scales with the node count because that is what fills the box.
      return (w + h) * (1 + Math.max(1, el.nodes.length) * 0.35);
    case 'asset':
      return Math.max(fade * 3, (w + h) * 0.9);
    case 'plot':
      // A plot builds in cue-pinned phases with their own arithmetic (`plotItems`),
      // and the schedule leaves it alone. Its cost is still real for the purpose of
      // knowing when the board is finished.
      return (w + h) * 1.2 + Math.max(1, el.curves.length) * (w * 0.6);
    case 'emphasis':
      // A ring or an underline around something already there. `pulse` and
      // `dim-others` draw nothing at all.
      return el.effect === 'pulse' || el.effect === 'dim-others' ? 0 : 2 * (w + h) * 0.6;
  }
}

/** Seconds this element's entrance will take, by the same clamp as `durationFor`. */
export function estimateDurationFor(el: InkElement, pace: InkPace): number {
  const speed = pace.speed && pace.speed > 0 ? pace.speed : DEFAULT_INK_SPEED;
  const px = estimateInkCost(el, pace) * Math.max(1e-6, pace.pxPerUnit);
  return clamp(px / speed, MIN_DRAW_SEC, MAX_DRAW_SEC);
}

/**
 * The part of a storyboard `Element` this needs, structurally.
 *
 * A structural subset rather than an import of the parsed union, for the same
 * reason `InkPrim` is: this file sits below `storyboard.ts` in the dependency order
 * and an `Element` is assignable to it unchanged.
 */
export type InkElement =
  | { type: 'text'; at: Rect; text: string }
  | { type: 'equation'; at: Rect }
  | { type: 'code'; at: Rect }
  | { type: 'shape'; at: Rect; fill: boolean }
  | { type: 'arrow'; at: Rect; from: { x: number; y: number }; to: { x: number; y: number } }
  | { type: 'path'; at: Rect; points?: { x: number; y: number }[]; d?: string; closed: boolean }
  | { type: 'diagram'; at: Rect; nodes: readonly unknown[] }
  | { type: 'asset'; at: Rect }
  | { type: 'plot'; at: Rect; curves: readonly unknown[] }
  | { type: 'emphasis'; at: Rect; effect: string };

/**
 * Handwriting, wrapped into the box the planner reserved.
 *
 * The text may be longer than one line, and the ink is the whole of it — so the
 * measured advance is used directly rather than being capped at the box width.
 */
function estimateTextCost(text: string, w: number, h: number, style: string): number {
  // The type scale is the renderer's, and the planner sized the box to the words, so
  // the box's own height is the best available reading of how big they are set.
  const size = h > 0 ? Math.min(h * 0.85, Math.max(18, h * 0.85)) : 40;
  const measured = handMetricsFor(style).measure(text, size, handFontFor(style).tracking);
  return (measured > 0 ? measured : text.length * size * 0.5) * WRITE_COST || w * WRITE_COST;
}

function estimatePathCost(
  el: { points?: { x: number; y: number }[]; d?: string; closed: boolean },
  w: number,
  h: number,
): number {
  if (el.points && el.points.length >= 2) {
    let total = 0;
    for (let i = 1; i < el.points.length; i++) {
      const a = el.points[i - 1]!;
      const b = el.points[i]!;
      total += Math.hypot(b.x - a.x, b.y - a.y);
    }
    if (el.closed && el.points.length > 2) {
      const first = el.points[0]!;
      const last = el.points[el.points.length - 1]!;
      total += Math.hypot(first.x - last.x, first.y - last.y);
    }
    return total;
  }
  if (el.d) return pathLength(el.d);
  // Neither: the box's diagonal is the only thing left that scales with the mark.
  return Math.hypot(w, h);
}

/* ------------------------------------------------------------ one pen, in turn */

/**
 * How far into the previous mark's tail the next one may start.
 *
 * Not zero, deliberately. A hand lifting off one stroke and setting down on the
 * next overlaps a little, and a schedule with hard gaps between every mark reads as
 * a slideshow rather than as somebody drawing. Fifteen per cent of the previous
 * mark's own length is small enough that nothing is ever *half* drawn while
 * something else is — the tail of a dash reveal is the last few per cent of its
 * ink — and large enough that a run of short marks still flows.
 */
export const PEN_OVERLAP = 0.15;

/**
 * How far the beat's dominant mark may be pushed past its cue before the marks in
 * front of it are compressed instead.
 *
 * The asymmetry is the point. Serialising a beat costs time, and that time has to
 * come from somewhere; taking it from the decorations is nearly free, and taking it
 * from the subject of the beat is the failure `cue.ts`'s `MAX_DOMINANT_AT` already
 * describes — the reasoning is spoken over a frame that does not yet contain the
 * thing being reasoned about.
 */
export const PEN_DOMINANT_SLACK = 0.5;

/** Shortest a mark may be compressed to before the schedule gives up and packs evenly. */
const PEN_MIN_DUR = 0.18;

/**
 * The least time `count` marks can occupy, drawn one at a time.
 *
 * Reading time is taken out of a beat's **slack**, never out of this. A beat with
 * more marks in it than seconds cannot buy stillness by drawing faster — below
 * `PEN_MIN_DUR` a mark is a flicker, and trading four flickers for a second of
 * silence swaps one unreadable board for another. Where the two fight, the beat is
 * carrying too much, and that is the element ceiling's problem (plan 1.5) and the
 * dwell gate's to report.
 */
export function minPenSpan(count: number): number {
  return count <= 0 ? 0 : PEN_MIN_DUR * (1 + (count - 1) * (1 - PEN_OVERLAP));
}

/**
 * The least time a finished board gets before it is wiped, whatever is on it.
 *
 * A board that is completed on the last frame of its beat was never shown; it was
 * only assembled. The dissection measured six of ten scenes giving the finished
 * board under 2.8 s and one — s7 — giving it **0.35 s**, with its last mark
 * *starting* at 97% of the beat. This is the floor under that.
 */
export const MIN_READ_SEC = 1.5;

/** Seconds a reader needs per word of newly written text, on top of the floor. */
const READ_SEC_PER_WORD = 0.35;

/**
 * Most of a beat that may be reserved for reading.
 *
 * Exported because the dwell gate (`sceneDwellViolations` in the renderer) has to
 * ask for exactly what this promises. A gate demanding more than the reserve can
 * ever be would fail every short beat for a defect nothing could fix.
 *
 * Without a ceiling a short beat carrying a long caption would reserve more time
 * than it has and leave the marks a sliver to be drawn in — trading one unreadable
 * board for another. Where the two fight, the beat is simply too short for what it
 * is carrying, and that is the element ceiling's problem (plan 1.5) rather than
 * something the tail can fix by taking more.
 */
export const MAX_READ_SHARE = 0.45;

/**
 * How long the finished board has to stay up, for `words` of text written last.
 *
 * Called by the renderer (which reserves this at the end of every beat) and by the
 * voice stage (which lengthens the beat so the reserve does not have to be taken out
 * of the drawing). One function, because a reserve one stage makes and the other
 * does not respect is worse than no reserve at all.
 */
export function readingTail(words: number, length: number): number {
  const wanted = Math.max(MIN_READ_SEC, Math.max(0, words) * READ_SEC_PER_WORD);
  return Math.min(wanted, Math.max(0, length) * MAX_READ_SHARE);
}

/**
 * Share of a scene's ink a mark must carry to be treated as its subject.
 *
 * Mirrors `DOMINANT_SHARE` in `voice/src/cue.ts` — same question, measured on real
 * ink here because the renderer has it, and on the authored box there because the
 * voice stage runs before visuals and does not.
 */
const PEN_DOMINANT_SHARE = 0.25;

/** One mark asking for a slot on the board. Times are seconds from the top of the scene. */
export type PenSlot = {
  id: string;
  /** Where the cue put it. The schedule may delay this; it never moves it earlier. */
  at: number;
  /** How long it wants to take — `durationFor`, or an author's explicit override. */
  dur: number;
  /** Its ink, for deciding which mark is the beat's subject. */
  ink: number;
};

export type PenSchedule = {
  /** The same marks, in the same order, with the times they actually get. */
  slots: { id: string; at: number; dur: number }[];
  /** When the last mark finishes, seconds from the top of the scene. */
  lastFinish: number;
  /**
   * When the last mark would have finished if nothing had been compressed.
   *
   * The number the voice stage lengthens a beat against: `lastFinish` is already
   * bounded by the beat, so a beat that is too short reports a comfortable-looking
   * `lastFinish` and a wrecked schedule. This is what the marks actually asked for,
   * and therefore what "how long does this beat need to be" means.
   */
  wanted: number;
  /** Marks that ended up starting after the narration stopped. See `serializePen`. */
  settled: string[];
  /** True when durations had to be shortened to fit the beat. */
  compressed: boolean;
};

export type PenOptions = {
  /** Seconds the scene owns: narration plus hold. Nothing may finish after this. */
  length: number;
  /** Measured narration length. A mark starting after this is a "settle" mark. */
  speech: number;
  /**
   * Seconds to keep clear at the end — reading time the schedule must not eat.
   *
   * The renderer passes 0: it cannot create time, only place marks inside the time
   * the scene already has. The voice stage passes the reader's floor, because it
   * *can* — it owns the clip, so it can lengthen the hold. See plan item 1.3.
   */
  tail?: number;
};

/**
 * One pen, one mark at a time.
 *
 * ## The defect
 *
 * Cues place every mark independently, so nothing stops six of them landing inside
 * one second — and with a flat 0.8 s entrance, six marks cued 0.15 s apart means
 * four are half-drawn simultaneously while a single pen sprite hops between them.
 * Scene s2 of `projects/deb81002b073` is exactly that, and it is the mechanism
 * behind "half-done drawings everywhere". No cue is wrong; the beat simply has one
 * hand and was scheduling as though it had six.
 *
 * ## The rule
 *
 * A mark starts no earlier than `PEN_OVERLAP` into the previous mark's tail. That
 * is the whole invariant, and `penOverlapViolations` in the renderer asserts it.
 *
 * Everything else here is about where the time comes from:
 *
 *  - **The subject keeps its cue.** The mark carrying the most ink is the beat's
 *    subject; if serialising would push it more than `PEN_DOMINANT_SLACK` past its
 *    cue, the marks *before* it are compressed until it fits. A learner can be
 *    shown a decoration a moment late; being shown the subject late is the beat
 *    playing over an empty frame.
 *  - **Overflow settles into the hold.** A beat whose marks do not fit inside its
 *    narration lets the tail of them run on into `Scene.hold` — the deliberate
 *    silence after the words. That is a real answer rather than a failure: the
 *    board finishes assembling while the viewer looks at it.
 *  - **Then compression, then an even pack.** If it still does not fit, every
 *    duration is scaled down together (never below `PEN_MIN_DUR`), and if even that
 *    is impossible the beat is packed evenly across its own length. The last case
 *    means the beat has too many marks in it, which is plan item 1.5's problem, not
 *    this function's — but it must still produce a legal schedule.
 *
 * Both searches below are binary searches over a monotone function: `place()`'s end
 * time never decreases as durations grow, so bisection converges and there is no
 * fixed-point iteration to fail to settle.
 */
export function serializePen(slots: readonly PenSlot[], opts: PenOptions): PenSchedule {
  const n = slots.length;
  if (n === 0) return { slots: [], lastFinish: 0, wanted: 0, settled: [], compressed: false };

  // Stable, and by cue: the order marks are *drawn* in is the order they were asked
  // for. A sort that reordered equal cues would make the schedule depend on array
  // order, which is the storyboard's declaration order and not a timing decision.
  const order = slots.map((s, i) => ({ s, i })).sort((a, b) => a.s.at - b.s.at || a.i - b.i);
  const wanted = order.map((o) => o.s.dur);
  // Reading time comes out of the beat's slack — see `minPenSpan`.
  const tail = Math.min(Math.max(0, opts.tail ?? 0), Math.max(0, opts.length - minPenSpan(n)));
  const budget = Math.max(PEN_MIN_DUR, opts.length - tail);

  /** Place marks in order, each starting no earlier than the previous one's tail. */
  const place = (durs: readonly number[]): { starts: number[]; end: number } => {
    const starts: number[] = [];
    let cursor = -Infinity;
    let end = 0;
    for (let i = 0; i < n; i++) {
      const start = Math.max(order[i]!.s.at, cursor);
      starts.push(start);
      const dur = durs[i]!;
      cursor = start + dur * (1 - PEN_OVERLAP);
      end = Math.max(end, start + dur);
    }
    return { starts, end };
  };

  /**
   * Place, then pull anything that overhangs the budget back inside it.
   *
   * The backward pass is what separates the beat's two ways of not fitting, and
   * they need different remedies. A mark *cued* at 91% of the narration cannot be
   * honoured and still leave the board time to be read, however short its entrance
   * is made — shortening durations there spends the beat's legibility on nothing.
   * A beat with genuinely more drawing in it than seconds is the other case, and
   * only that one is worth compressing for.
   *
   * So this pulls late marks earlier, keeping their order and their spacing, and
   * reports through `ok` whether the beat still ran off its own front — which is
   * the signal that compression is the right answer after all. It is also the
   * acceptance test's "no element starts after 88% of the scene", satisfied by
   * construction rather than checked afterwards.
   */
  const fit = (durs: readonly number[]): { starts: number[]; end: number; ok: boolean } => {
    const { starts } = place(durs);
    starts[n - 1] = Math.min(starts[n - 1]!, budget - durs[n - 1]!);
    for (let i = n - 2; i >= 0; i--) {
      starts[i] = Math.min(starts[i]!, starts[i + 1]! - durs[i]! * (1 - PEN_OVERLAP));
    }
    let end = 0;
    for (let i = 0; i < n; i++) end = Math.max(end, starts[i]! + durs[i]!);
    return { starts, end, ok: starts[0]! >= -1e-6 && end <= budget + 1e-6 };
  };

  const scaled = (f: number, upTo = n): number[] =>
    wanted.map((d, i) => (i < upTo ? Math.max(PEN_MIN_DUR, d * f) : d));

  /** Largest factor in [0,1] for which `ok(scaled(f, upTo))` still holds. */
  const largestFactor = (upTo: number, ok: (durs: readonly number[]) => boolean) => {
    if (ok(scaled(1, upTo))) return 1;
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2;
      if (ok(scaled(mid, upTo))) lo = mid;
      else hi = mid;
    }
    return lo;
  };

  let durs = scaled(1);
  // What the beat asks for, before any of the compressions below. Recorded now
  // because this is the only moment it is knowable, and the voice stage lengthens
  // beats against it — see `PenSchedule.wanted`.
  const asked = place(durs).end;

  // 1. The subject's guard. Only the marks *before* it are compressed — shortening
  //    the ones after would buy nothing, since they are not what is delaying it.
  const dominant = dominantIndex(order.map((o) => o.s));
  if (dominant > 0) {
    const cue = order[dominant]!.s.at;
    const late = (d: readonly number[]) => place(d).starts[dominant]! - cue <= PEN_DOMINANT_SLACK;
    if (!late(durs)) durs = scaled(largestFactor(dominant, late), dominant);
  }

  // 2. The beat's own length. Compressing everything together keeps the *relative*
  //    weight of the marks — a figure still takes longer than an arrowhead — which
  //    dropping a fixed amount from each would destroy. Note this searches over
  //    `fit`, not `place`: a beat whose only problem is a late cue passes at f = 1
  //    and is left at full length.
  const before = durs.slice();
  if (!fit(durs).ok) {
    const f = largestFactor(n, (d) => fit(d).ok);
    durs = durs.map((d, i) => Math.max(PEN_MIN_DUR, Math.min(d, before[i]! * f)));
  }

  let { starts, end, ok } = fit(durs);

  // 3. Not even the floor fits: the beat has more marks than it has seconds. Pack
  //    them evenly, which always fits and never overlaps, and let the element
  //    ceiling (plan 1.5) and the dwell gate (1.4) report the real problem — this
  //    function's contract is to produce a legal schedule, not to refuse a beat.
  if (!ok) {
    const step = budget / n;
    durs = wanted.map(() => step);
    starts = wanted.map((_, i) => i * step);
    end = budget;
  }

  const out: PenSchedule = {
    // Clamped at zero: the backward pass subtracts its way along the beat and can
    // land a hair under it in floating point, and a mark that starts at -5e-17 is a
    // mark whose absolute time is negative in every arithmetic downstream of here.
    slots: order.map((o, i) => ({ id: o.s.id, at: Math.max(0, starts[i]!), dur: durs[i]! })),
    lastFinish: end,
    wanted: asked,
    settled: order.filter((_, i) => starts[i]! > opts.speech + 1e-6).map((o) => o.s.id),
    compressed: durs.some((d, i) => d < wanted[i]! - 1e-6),
  };
  return out;
}

/** Index of the mark carrying the beat, or -1 when no single mark does. */
function dominantIndex(slots: readonly PenSlot[]): number {
  const total = slots.reduce((sum, s) => sum + Math.max(0, s.ink), 0);
  if (!(total > 0)) return -1;
  let best = -1;
  for (let i = 0; i < slots.length; i++) {
    if (best < 0 || slots[i]!.ink > slots[best]!.ink) best = i;
  }
  if (best < 0 || slots[best]!.ink / total < PEN_DOMINANT_SHARE) return -1;
  return best;
}

/* ------------------------------------------------------------------ measuring */

/**
 * Total length of a path's own strokes.
 *
 * `flattenPathData` samples curves at a fixed rate, which is enough: this feeds a
 * duration that is then clamped into a half-second band, and the error a coarser
 * curve sampling introduces is far below the width of that band.
 */
function pathLength(d: string): number {
  let total = 0;
  for (const sub of flattenPathData(d)) {
    for (let i = 1; i < sub.length; i++) {
      const a = sub[i - 1]!;
      const b = sub[i]!;
      total += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
  }
  return total;
}

/**
 * Width of the text a `TextPrim` will render, measured with the board's own hand.
 *
 * The page measures this exactly, with the loaded face, after wrapping. Node cannot
 * — but it has the same vendored metrics the planner reserved the box with, so the
 * estimate is the one the layout was built from. A block that wraps is measured as
 * the sum of its lines, because that is the ink, not the box.
 */
function textWidth(prim: { text: string; box: Rect; size: number }, style: string): number {
  const metrics = handMetricsFor(style);
  const tracking = handFontFor(style).tracking;
  const full = metrics.measure(prim.text, prim.size, tracking);
  // Wrapping does not change how much is written, only where. The box is a floor on
  // nothing and a ceiling on line length; the total advance is what the pen covers.
  return full > 0 ? full : prim.text.length * prim.size * 0.5;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
