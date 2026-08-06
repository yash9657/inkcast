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
 * A *mark* space can. Eight marks — box, ellipse, line, freehand stroke, arrow, written
 * label, hatching, scattered dots — compose into any whiteboard drawing anyone has ever
 * made, and the author (see `./draw-anthropic.ts`) does the composing. Nothing in this
 * file knows what a chloroplast is, and that is the point.
 *
 * ## Why the output is ordinary elements
 *
 * A mark becomes a `PathElement`, `ShapeElement`, `ArrowElement` or `TextElement` — the
 * same elements the compiler has always emitted. So a drawing is not a new rendering
 * path: the visuals stage roughens it, the voice stage cues it, the renderer reveals it
 * stroke by stroke, the camera frames it, `persist` keeps it on the board. All of that is
 * inherited rather than rebuilt, and every element carries the part's own name — so
 * `b3_v0_left-stack` can be cued to the words "the left stack", highlighted later, or
 * moved, which is exactly what a generated raster can never offer.
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
import type { ArrowElement, Element, Mark, ShapeElement, TextElement } from '@inkcast/core';
import { DRAW_H, DRAW_W, logger } from '@inkcast/core';
import { round } from './curves.js';
import { cueMarks } from './draw-cues.js';
import {
  ADRIFT,
  type Ink,
  clipToBox,
  contentBounds,
  inkDistance,
  inkHitsBox,
  inkOf,
  labelBox,
  underlayInk,
  markBounds,
  overlapArea,
  union,
  waypoints,
} from './draw-geom.js';
import type { Box, Point } from './elements.js';
import { FONT, makeArrow, makeShape, makeText, measureText } from './elements.js';
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

/* -------------------------------------------------------------------- repair */

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
 * costume, so **moving a name is expensive here**: about 100 units of displacement costs
 * the same as lying across one mark, a candidate outside the canvas is not considered at
 * all, and a name that would end up too far from any ink to be naming it is charged as if
 * it were a collision.
 *
 * The point of that tuning is that this pass is *not* the whole fix. It nudges; the model
 * revises (`draw-anthropic.ts`), and `draw-audit.ts` decides which drawings need it. A
 * mechanical pass that mangles a drawing to satisfy a checker has made the picture worse
 * and the number better.
 */
export function repairLabels(marks: Mark[], underlay?: Box): Mark[] {
  // The generated picture counts as ink, and as the one kind that cannot be written on.
  // Without it a name landing in the middle of the organ scores as free space and is left
  // exactly where it was — `inkOf` knows about marks and nothing else. See `underlayInk`.
  const ink: Ink[] = [
    ...(underlay ? [underlayInk(underlay)] : []),
    ...inkOf(marks.filter((m) => m.kind !== 'label')),
  ];
  const placed: Box[] = [];
  // A label may sit slightly outside the canvas — the drawing is fitted by its content,
  // so a name just over the edge only makes the picture slightly smaller — but not far
  // outside, which is a caption drifting away from its own drawing.
  const margin = 0.04;

  /** Lower is better. A collision justifies a move; nothing else does. */
  const cost = (b: Box, from: Box): number => {
    const onLabels = placed.reduce((n, o) => n + (overlapArea(b, o) > 0 ? 1 : 0), 0);
    const hit = ink.filter((k) => inkHitsBox(k, b, 6));
    const onInk = hit.filter((k) => !k.solid).length;
    // A generated picture is priced eight times a crossed stroke, and the difference is
    // the difference between the two obstacles. Crossing one arrow is untidy and a name
    // written across a traced organ is illegible, full stop — but escaping a picture that
    // occupies a third of the board costs 200-odd units of displacement, and at the ink
    // rate the arithmetic says a collision is the cheaper of the two. It is not. This is
    // the only obstacle worth crossing the board to avoid, so it is the only one priced
    // to. Escaping is always possible: the picture is placed inside `UNDERLAY_AREA`
    // precisely so there is clear board on either side for the names to reach.
    const onSolid = hit.filter((k) => k.solid).length;
    const centre = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    const nearest = ink.reduce((d, k) => Math.min(d, inkDistance(k, centre)), Infinity);
    const adrift = ink.length && nearest > ADRIFT ? 1 : 0;
    const moved = Math.hypot(b.x - from.x, b.y - from.y);
    return onLabels * 1000 + onSolid * 400 + onInk * 50 + adrift * 50 + moved * 0.5;
  };

  return marks.map((m) => {
    if (m.kind !== 'label') return m;
    const home = labelBox(m);
    let best = home;
    let bestCost = cost(home, home);
    if (bestCost > 0) {
      const step = Math.max(20, home.h * 0.8);
      for (let ring = 1; ring <= 8 && bestCost > 0; ring++) {
        for (const [dx, dy] of RINGS) {
          const moved = { ...home, x: home.x + dx * step * ring, y: home.y + dy * step * ring };
          const inside =
            moved.x >= -DRAW_W * margin &&
            moved.y >= -DRAW_H * margin &&
            moved.x + moved.w <= DRAW_W * (1 + margin) &&
            moved.y + moved.h <= DRAW_H * (1 + margin);
          if (!inside) continue;
          const c = cost(moved, home);
          if (c < bestCost) {
            best = moved;
            bestCost = c;
          }
        }
      }
    }
    placed.push(best);
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
  const canvas = contentBounds(marks);
  const seen = new Set<string>();
  const out: Mark[] = [];
  for (const m of marks) {
    if (markBounds(m) === undefined) continue;
    if (m.kind === 'label' && !(m.text ?? '').trim()) continue;
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
export function prepareMarks(marks: Mark[], underlay?: Box): Mark[] {
  return repairLabels(cleanMarks(marks), underlay);
}

/* ------------------------------------------------------------------ building */

/** Role whose type size is closest to the mark's own, so labels keep their hierarchy. */
function roleFor(px: number): TextElement['role'] {
  const roles: TextElement['role'][] = ['caption', 'label', 'body', 'heading', 'title'];
  let best = roles[0] as TextElement['role'];
  for (const r of roles) if (Math.abs(FONT[r] - px) < Math.abs(FONT[best] - px)) best = r;
  return best;
}

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
function buildMark(m: Mark, id: string, fit: Fit): Element[] {
  const P = (x: number, y: number): Point => at(fit, x, y);
  const pts = waypoints(m).map((p) => P(p.x, p.y));

  switch (m.kind) {
    case 'rect':
    case 'ellipse': {
      const b = markBounds(m);
      if (!b) return [];
      const tl = P(b.x, b.y);
      const el: ShapeElement = makeShape(id, m.kind, round(b.w * fit.s, 2), round(b.h * fit.s, 2));
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
      const role = roleFor((m.size ?? 30) * fit.s);
      // Two failures meet here, and both are about the box being narrower than the words.
      //
      // The planner measures text at an assumed mean advance; the renderer wraps again
      // against the *real* handwriting metrics, which are wider. A box sized to the
      // estimate is therefore a box a word does not quite fit, and the renderer breaks
      // the word itself — `Cartilage` came out as "Cartil / age", `block` as "blo / ck".
      // A third of slack absorbs the difference.
      //
      // And a label that is a whole sentence — which the brief asks against and gets
      // anyway — becomes one enormous line that lands across the picture. Capping the
      // width at a share of the drawing wraps it into two or three tidy lines instead,
      // which `repairLabels` can then place.
      // A label that is a whole sentence — which the brief asks against and gets anyway —
      // becomes one enormous line across the picture unless it is capped. Capped, it wraps
      // into two or three tidy lines that `repairLabels` can place.
      const cap = Math.max(280, DRAW_W * fit.s * 0.42);
      const el = makeText(id, text, role, { align: 'center', maxWidth: cap });
      // Then widened, because `measureText` can only ever return its own estimate and the
      // renderer wraps again against the *real* handwriting metrics, which are wider. A
      // box sized to the estimate is a box the words do not quite fit, and the renderer
      // breaks the word itself: `Cartilage` came out as "Cartil / age", `block` as
      // "blo / ck", on nearly every label of a twelve-subject breadth test. Half again is
      // measured slack, not a guess — it is the widest the same string came out at when
      // typeset by the board rather than estimated by the planner.
      el.at = { ...el.at, w: round(el.at.w * 1.5, 2) };
      const c = P(m.x ?? 0, m.y ?? 0);
      el.at = {
        x: round(c.x - el.at.w / 2, 2),
        y: round(c.y - el.at.h / 2, 2),
        w: el.at.w,
        h: el.at.h,
      };
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
  const clean = prepareMarks(marks);
  if (!clean.length) return [];
  // Which fit, and it is the difference between a drawing and an annotation. See
  // `fitCanvas`: content bounds are right for a picture that is only its own marks and
  // wrong for one whose marks are aimed at something else on the board.
  const fit = ctx.underlay ? fitCanvas(ctx.box) : fitDrawing(clean, ctx.box);
  const cues = ctx.narration ? cueMarks(clean, ctx.narration) : [];
  const out: Element[] = [];
  clean.forEach((m, i) => {
    const slug = m.id.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || `m${i}`;
    const cue = cues[i];
    for (const el of buildMark(m, `${ctx.id}_${slug}`, fit)) {
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
