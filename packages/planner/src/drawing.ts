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
import type { Box, Point } from './elements.js';
import { FONT, makeArrow, makeShape, makeText, measureText } from './elements.js';
import { makePath } from './figures.js';

const log = logger('planner:drawing');

/** Never place more than this many marks: past it a viewer stops reading a picture. */
export const MAX_MARKS = 40;

type Fit = { s: number; ox: number; oy: number };

/* ------------------------------------------------------------------ geometry */

/**
 * The `[x, y]` pairs of a mark, as points, dropping anything malformed.
 *
 * The schema says "an array of arrays of numbers" because a zod tuple compiles to a
 * tool schema the API rejects, so pair-ness is checked here — once, at the only place
 * the waypoints are read.
 */
function waypoints(m: Mark): Point[] {
  return (m.points ?? [])
    .filter((p) => Array.isArray(p) && p.length >= 2)
    .map((p) => ({ x: p[0] as number, y: p[1] as number }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
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
  if (m.kind === 'label') {
    // A label is placed by its centre, and its extent is the words themselves. Estimated
    // in drawing units at the same advance ratio the board uses, so the collision check
    // below is about the space the text will really take.
    const size = m.size ?? 30;
    const text = m.text ?? '';
    const w = Math.max(size, text.length * size * 0.52);
    return { x: (m.x ?? 0) - w / 2, y: (m.y ?? 0) - size * 0.7, w, h: size * 1.4 };
  }
  if (m.w !== undefined && m.h !== undefined && m.x !== undefined && m.y !== undefined) {
    return { x: m.x, y: m.y, w: Math.max(1, m.w), h: Math.max(1, m.h) };
  }
  return undefined;
}

function union(boxes: Box[]): Box | undefined {
  if (!boxes.length) return undefined;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const r = Math.max(...boxes.map((b) => b.x + b.w));
  const b2 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, w: Math.max(1, r - x), h: Math.max(1, b2 - y) };
}

function overlap(a: Box, b: Box, pad = 0): boolean {
  return (
    a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad
  );
}

/**
 * Uniform scale and offset that puts the drawing's own content in the middle of `box`.
 *
 * Content bounds rather than the nominal canvas: an author who drew in the top half
 * would otherwise get a picture half the size it could be, in a cell that then reads as
 * empty. Clamped to 1.6× so a two-mark drawing is not blown up into a poster.
 */
export function fitDrawing(marks: Mark[], box: Box): Fit {
  const content = union(marks.map(markBounds).filter((b): b is Box => b !== undefined)) ?? {
    x: 0,
    y: 0,
    w: DRAW_W,
    h: DRAW_H,
  };
  const s = Math.min(1.6, Math.min(box.w / content.w, box.h / content.h));
  return {
    s,
    ox: box.x + (box.w - content.w * s) / 2 - content.x * s,
    oy: box.y + (box.h - content.h * s) / 2 - content.y * s,
  };
}

const at = (fit: Fit, x: number, y: number): Point => ({
  x: round(fit.ox + x * fit.s, 2),
  y: round(fit.oy + y * fit.s, 2),
});

/* -------------------------------------------------------------------- repair */

/**
 * Move labels off each other, and off the small ink they are burying.
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
 * - **A label avoids only the ink it would bury.** Not every mark — the *containing*
 *   shapes. A heart outline, a ramp, a barrier: their bounding boxes cover most of the
 *   drawing, so treating them as obstacles makes every position "busy", the search fails,
 *   and the first version of this gave up and left the label exactly where it was. That is
 *   why the frames still showed collisions after it ran. Ink smaller than a fifth of the
 *   drawing is a part worth not covering; anything bigger is the thing being labelled,
 *   and a name sitting inside its own diagram is normal on a whiteboard.
 *
 * Candidate positions spiral out in eight directions rather than four, and a label may
 * leave the canvas bounds by a margin, because the drawing is fitted by content afterwards
 * — a label pushed just outside simply makes the fitted picture slightly smaller.
 */
export function repairLabels(marks: Mark[]): Mark[] {
  const all = marks.map(markBounds).filter((b): b is Box => b !== undefined);
  const area = (b: Box): number => b.w * b.h;
  const canvas = union(all);
  const budget = canvas ? area(canvas) * 0.2 : Infinity;
  const ink = marks
    .filter((m) => m.kind !== 'label')
    .map(markBounds)
    .filter((b): b is Box => b !== undefined && area(b) <= budget);

  const placed: Box[] = [];
  const free = (b: Box): boolean =>
    !placed.some((o) => overlap(b, o, 8)) && !ink.some((o) => overlap(b, o, 6));

  return marks.map((m) => {
    if (m.kind !== 'label') return m;
    const b = markBounds(m);
    if (!b) return m;
    if (free(b)) {
      placed.push(b);
      return m;
    }
    const step = Math.max(20, b.h * 0.8);
    for (let ring = 1; ring <= 8; ring++) {
      for (const [dx, dy] of [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ] as const) {
        const moved = { ...b, x: b.x + dx * step * ring, y: b.y + dy * step * ring };
        const inside =
          moved.x >= -DRAW_W * 0.3 &&
          moved.y >= -DRAW_H * 0.3 &&
          moved.x + moved.w <= DRAW_W * 1.3 &&
          moved.y + moved.h <= DRAW_H * 1.3;
        if (!inside || !free(moved)) continue;
        placed.push(moved);
        log.debug(`label "${m.text ?? m.id}" moved clear of what it landed on`);
        return { ...m, x: moved.x + moved.w / 2, y: moved.y + moved.h / 2 };
      }
    }
    placed.push(b);
    return m;
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
  const canvas = union(marks.map(markBounds).filter((b): b is Box => b !== undefined));
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

/** Liang–Barsky, enough of it to trim a hatch line to the region it fills. */
function clipToBox(a: Point, b: Point, box: Box): [Point, Point] | undefined {
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

/**
 * A composed drawing, fitted into `box` and ready for the board.
 *
 * Elements come back in the order the author placed them, which is the order a person
 * would draw them — containers, then parts, then connectors, then labels — and each one
 * is given a fraction of the beat so the picture builds instead of appearing. The last
 * mark lands at 0.72 rather than at the end, because the words that name a picture have
 * to be spoken while it is still being drawn.
 */
export function buildDrawing(marks: Mark[], ctx: { id: string; box: Box }): Element[] {
  const clean = repairLabels(cleanMarks(marks));
  if (!clean.length) return [];
  const fit = fitDrawing(clean, ctx.box);
  const out: Element[] = [];
  clean.forEach((m, i) => {
    const slug = m.id.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || `m${i}`;
    for (const el of buildMark(m, `${ctx.id}_${slug}`, fit)) {
      el.enter = {
        ...el.enter,
        at: round(0.06 + (i / Math.max(1, clean.length)) * 0.66, 3),
      };
      out.push(el);
    }
  });
  return out;
}
