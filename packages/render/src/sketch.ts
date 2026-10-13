/**
 * Deterministic hand-drawn geometry.
 *
 * Every stroke is produced from a seeded PRNG, so the same element id always
 * yields byte-identical path data — in this process, in the next one, and in all
 * four capture workers at once. That is a hard requirement: the workers each
 * compile nothing (they share one plan), but a re-render must match the poster
 * frame and the studio preview exactly.
 *
 * Output is always an array of `d` strings, one per pen stroke, in the order a
 * hand would lay them down. The renderer reveals them with stroke-dashoffset, so
 * "one stroke" and "one path" must be the same thing.
 */
import { normalAt, resampleEven } from './geom.js';
import type { Rect } from './types.js';

export type Pt = [number, number];

export type SketchStyle = {
  roughness: number;
  bowing: number;
  passes: number;
  /** Canvas-unit scale: 1 for a 1920×1080 board, 2 for a 3840×2160 one. */
  scale: number;
};

/* --------------------------------------------------------------------- rng */

/** mulberry32 — small, fast, and identical across Node versions and platforms. */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }

  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [a, b). */
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  /** Uniform in [-a, a). */
  sym(a: number): number {
    return (this.next() * 2 - 1) * a;
  }
}

/** FNV-1a over the concatenated parts — stable, cheap, well distributed. */
export function seedOf(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= 0x2f;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/* ------------------------------------------------------------------ format */

/** 2dp is well below a pixel at every zoom we ship, and keeps `d` strings short. */
function n(v: number): string {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
}

function moveTo(p: Pt): string {
  return `M${n(p[0])} ${n(p[1])}`;
}

function curveTo(c1: Pt, c2: Pt, p: Pt): string {
  return `C${n(c1[0])} ${n(c1[1])} ${n(c2[0])} ${n(c2[1])} ${n(p[0])} ${n(p[1])}`;
}

/* ------------------------------------------------------------------ strokes */

/**
 * One sketched line: endpoints nudged, and a perpendicular bow through two
 * control points so a "straight" line is never actually straight.
 */
function onePass(rng: Rng, st: SketchStyle, a: Pt, b: Pt, bowSign: number): string {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1e-6;
  const ux = dx / len;
  const uy = dy / len;
  // Perpendicular.
  const px = -uy;
  const py = ux;

  // Longer lines wobble proportionally less — a hand steadies over distance.
  const gain =
    len > 500 * st.scale ? 0.45 : len > 200 * st.scale ? 1.15 - len / (900 * st.scale) : 1;
  const amp = st.roughness * st.scale * 2.1 * gain;
  // Bowing is deliberately restrained: enough that nothing is machine-straight,
  // little enough that a rectangle does not look pinched in the middle.
  const bow = st.bowing * st.scale * Math.min(8, len / (46 * st.scale)) * gain * bowSign;

  const s: Pt = [a[0] + rng.sym(amp * 0.85), a[1] + rng.sym(amp * 0.85)];
  const e: Pt = [b[0] + rng.sym(amp * 0.85), b[1] + rng.sym(amp * 0.85)];
  const b1 = bow * rng.range(0.7, 1.25);
  const b2 = bow * rng.range(0.55, 1.05);
  const c1: Pt = [
    a[0] + ux * len * 0.32 + px * b1 + rng.sym(amp),
    a[1] + uy * len * 0.32 + py * b1 + rng.sym(amp),
  ];
  const c2: Pt = [
    a[0] + ux * len * 0.68 + px * b2 + rng.sym(amp),
    a[1] + uy * len * 0.68 + py * b2 + rng.sym(amp),
  ];
  return `${moveTo(s)} ${curveTo(c1, c2, e)}`;
}

export function sketchLine(rng: Rng, st: SketchStyle, a: Pt, b: Pt, passes = st.passes): string[] {
  const out: string[] = [];
  for (let i = 0; i < Math.max(1, passes); i++) {
    out.push(onePass(rng, st, a, b, i % 2 === 0 ? 1 : -0.7));
  }
  return out;
}

/** Extend a segment past both ends, the way a hand overshoots a corner. */
function overshoot(rng: Rng, st: SketchStyle, a: Pt, b: Pt, amount: number): [Pt, Pt] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1e-6;
  const ux = dx / len;
  const uy = dy / len;
  const o1 = rng.range(0, amount) * st.scale;
  const o2 = rng.range(0, amount) * st.scale;
  return [
    [a[0] - ux * o1, a[1] - uy * o1],
    [b[0] + ux * o2, b[1] + uy * o2],
  ];
}

/* ------------------------------------------------------------------- curves */

/** Catmull-Rom through the points, emitted as cubic béziers. */
export function curveThrough(pts: Pt[], closed: boolean): string {
  if (pts.length < 2) return '';
  const at = (i: number): Pt => {
    const len = pts.length;
    const j = closed ? ((i % len) + len) % len : Math.max(0, Math.min(len - 1, i));
    return pts[j] as Pt;
  };
  let d = moveTo(at(0));
  const last = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` ${curveTo(c1, c2, p2)}`;
  }
  return d;
}

/** A jittered smooth curve through waypoints — used for arrows and edges. */
export function sketchCurve(rng: Rng, st: SketchStyle, pts: Pt[], passes = st.passes): string[] {
  const amp = st.roughness * st.scale * 1.9;
  const out: string[] = [];
  for (let p = 0; p < Math.max(1, passes); p++) {
    const jittered = pts.map((q, i) => {
      const k = i === 0 || i === pts.length - 1 ? 0.6 : 1;
      return [q[0] + rng.sym(amp * k), q[1] + rng.sym(amp * k)] as Pt;
    });
    out.push(curveThrough(jittered, false));
  }
  return out;
}

function lineThrough(pts: Pt[]): string {
  if (pts.length === 0) return '';
  let d = moveTo(pts[0] as Pt);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i] as Pt;
    d += ` L${n(p[0])} ${n(p[1])}`;
  }
  return d;
}

export type AlongOptions = {
  /** Wobble amplitude, as a multiple of the ink style's roughness. */
  amp?: number;
  /** Distance between wobble samples, in canvas units. */
  spacing?: number;
  /** Straight segments instead of a spline — for staircases and hard corners. */
  smooth?: boolean;
  closed?: boolean;
};

/**
 * One hand-drawn stroke that follows a dense polyline, in its own direction.
 *
 * This is the primitive behind `plot` curves and `path` elements, and it is
 * deliberately not `sketchCurve`. Two differences matter:
 *
 * - **One stroke, not `passes` strokes.** The runtime reveals strokes in order, so
 *   a two-pass curve would sweep left-to-right and then sweep again. A plotted
 *   function has to be revealed exactly once, along the direction it was sampled
 *   in, which is what makes "watch the curve grow" legible.
 * - **Even wobble frequency.** Jittering raw samples of a function wobbles fast
 *   where samples bunch up (a steep flank) and slowly where they spread out, which
 *   reads as noise. Resampling by arc length first, then offsetting along the
 *   normal with a smoothed random walk, reads as a hand.
 */
export function sketchAlong(rng: Rng, st: SketchStyle, pts: Pt[], opts: AlongOptions = {}): string {
  if (pts.length < 2) return '';
  const spacing = opts.spacing ?? 30 * st.scale;
  const base = resampleEven(pts, spacing);
  if (base.length < 2) return lineThrough(base as Pt[]);
  const amp = st.roughness * st.scale * 1.7 * (opts.amp ?? 1);
  const last = base.length - 1;
  let walk = rng.sym(0.4);
  const out: Pt[] = base.map((p, i) => {
    // AR(1) noise: correlated between neighbours, so the line drifts instead of
    // buzzing. Tapered towards the ends, which is where a hand aims deliberately.
    walk = walk * 0.6 + rng.sym(1) * 0.5;
    const taper = last > 0 ? 0.35 + 0.65 * Math.sin((Math.PI * i) / last) : 1;
    const [nx, ny] = normalAt(base, i);
    const k = walk * amp * taper;
    return [p[0] + nx * k, p[1] + ny * k] as Pt;
  });
  if (opts.closed && out.length > 2) {
    const head = out[0] as Pt;
    out[out.length - 1] = [head[0], head[1]];
  }
  return opts.smooth === false
    ? lineThrough(out)
    : curveThrough(out, Boolean(opts.closed) && out.length > 3);
}

/* ------------------------------------------------------------------- shapes */

export function sketchRect(rng: Rng, st: SketchStyle, r: Rect, passes = st.passes): string[] {
  const tl: Pt = [r.x, r.y];
  const tr: Pt = [r.x + r.w, r.y];
  const br: Pt = [r.x + r.w, r.y + r.h];
  const bl: Pt = [r.x, r.y + r.h];
  const edges: [Pt, Pt][] = [
    [tl, tr],
    [tr, br],
    [br, bl],
    [bl, tl],
  ];
  const out: string[] = [];
  for (const [a, b] of edges) {
    const [a2, b2] = overshoot(rng, st, a, b, 3.5 * st.roughness);
    out.push(...sketchLine(rng, st, a2, b2, passes));
  }
  return out;
}

/**
 * A sketched ellipse: points sampled around the rim with radial jitter, closed
 * with a deliberate overshoot so the ends cross like a real drawn loop.
 */
export function sketchEllipse(
  rng: Rng,
  st: SketchStyle,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  passes = st.passes,
): string[] {
  const steps = Math.max(
    10,
    Math.min(26, Math.round((Math.abs(rx) + Math.abs(ry)) / (14 * st.scale))),
  );
  const amp = st.roughness * st.scale * 2.4;
  const out: string[] = [];
  for (let p = 0; p < Math.max(1, passes); p++) {
    const start =
      rng.range(-0.45, 0.45) + (p === 0 ? -Math.PI / 2 : -Math.PI / 2 + rng.range(0.2, 0.7));
    const sweep = Math.PI * 2 + rng.range(0.12, 0.42);
    const pts: Pt[] = [];
    for (let i = 0; i <= steps; i++) {
      const a = start + (sweep * i) / steps;
      const jr = 1 + rng.sym(amp / Math.max(12, Math.min(rx, ry)));
      pts.push([
        cx + Math.cos(a) * rx * jr + rng.sym(amp * 0.35),
        cy + Math.sin(a) * ry * jr + rng.sym(amp * 0.35),
      ]);
    }
    out.push(curveThrough(pts, false));
  }
  return out;
}

/**
 * A curly brace filling the box: the flat side runs along the box's long axis and
 * the tip points at the middle of the opposite side, so a `bracket` element
 * brackets exactly the region its `at` box covers.
 */
export function sketchBracket(rng: Rng, st: SketchStyle, r: Rect): string[] {
  const pts: Pt[] = [];
  if (r.h >= r.w) {
    // Vertical brace: spine on the left, tip pointing right.
    const midY = r.y + r.h / 2;
    pts.push(
      [r.x, r.y],
      [r.x + r.w * 0.42, r.y + r.h * 0.03],
      [r.x + r.w * 0.5, r.y + r.h * 0.22],
      [r.x + r.w * 0.55, midY - r.h * 0.06],
      [r.x + r.w, midY],
      [r.x + r.w * 0.55, midY + r.h * 0.06],
      [r.x + r.w * 0.5, r.y + r.h * 0.78],
      [r.x + r.w * 0.42, r.y + r.h * 0.97],
      [r.x, r.y + r.h],
    );
  } else {
    // Horizontal brace: spine along the top, tip pointing down.
    const midX = r.x + r.w / 2;
    pts.push(
      [r.x, r.y],
      [r.x + r.w * 0.03, r.y + r.h * 0.42],
      [r.x + r.w * 0.22, r.y + r.h * 0.5],
      [midX - r.w * 0.06, r.y + r.h * 0.55],
      [midX, r.y + r.h],
      [midX + r.w * 0.06, r.y + r.h * 0.55],
      [r.x + r.w * 0.78, r.y + r.h * 0.5],
      [r.x + r.w * 0.97, r.y + r.h * 0.42],
      [r.x + r.w, r.y],
    );
  }
  return sketchCurve(rng, st, pts, 1);
}

/** Two head strokes for an arrow whose tip points along `dir` (radians). */
export function sketchArrowHead(
  rng: Rng,
  st: SketchStyle,
  tip: Pt,
  dir: number,
  size: number,
): string[] {
  const spread = 0.42;
  const out: string[] = [];
  for (const sign of [1, -1]) {
    const a = dir + Math.PI + sign * spread + rng.sym(0.07);
    const len = size * rng.range(0.86, 1.1);
    const end: Pt = [tip[0] + Math.cos(a) * len, tip[1] + Math.sin(a) * len];
    out.push(...sketchLine(rng, st, tip, end, 1));
  }
  return out;
}

/* ------------------------------------------------------------- title rules */

/**
 * The extent of one line of written text, in canvas units.
 *
 * The underline has to know where the letters actually ended, and the truest answer
 * only exists inside the browser, after the handwriting font has loaded
 * (`page/runtime.js` measures every line with `getComputedTextLength`; compile-time
 * measurement is the same advance table parsed in `@inkcast/core`'s `fontmetrics.ts` —
 * one table since plan item 2.1, where there used to be two disagreeing chars-times-a-
 * constant estimators). So this primitive refuses to guess. The caller states the run
 * it believes in and owns the error; keep an estimate generous rather than tight,
 * because an underline a little long reads as a confident flick and one a little short
 * reads as a mistake.
 */
export type WrittenRun = {
  /** Left end of the written line. */
  x0: number;
  /** Right end of the written line. */
  x1: number;
  /** The baseline the letters sit on. */
  baseline: number;
  /** Type size of the line, which sets every offset below in proportion. */
  size: number;
};

/**
 * How a title's accent rule sits under its words. Every number is a fraction of the
 * type size, so the same gesture holds from a 26-unit caption to a 96-unit title.
 */
export type UnderlineSpec = {
  /** How far below the baseline the stroke passes, at the left end. */
  drop: number;
  /** How much the right end lifts above the left — the confident flick upward. */
  rise: number;
  /** How far the stroke runs past the last letter. */
  overshoot: number;
  /** How far it starts before the first letter, as a fraction of `overshoot`. */
  approach: number;
  /**
   * The second rule, when the title takes a double underline (parity item 5).
   *
   * A hand that wants a heading to *be* a heading underlines it twice: one confident
   * pass, then a shorter one under it, faster and closer in. It is the cheapest mark
   * in the vocabulary that says "this is the name of the thing" rather than "this is
   * a line", and it is the one Golpo's boards use on every card title.
   *
   * The second stroke is deliberately not a copy of the first. It is drawn *back*
   * along the words — right to left, as a hand returning — starts and ends inside the
   * first one, and takes its own seed, so the two are visibly two gestures rather
   * than one shape stamped twice. Absent means one rule, which is what a caption or a
   * label gets.
   */
  double?: {
    /** Vertical separation from the first rule, as a fraction of the type size. */
    gap: number;
    /** How much shorter it is at each end, as a fraction of the run's width. */
    inset: number;
  };
};

/**
 * Chosen by capturing the rule under a 96-unit Shantell title at 1920×1080 and
 * looking at it, not by measuring Golpo — STATUS calls letter-by-letter titles their
 * single biggest at-a-glance cue but records no numbers for the rule itself, and there
 * is no metric in this repo that sees typography (`inkstat` counts dark saturated
 * pixels and would score a rule at any of these values identically). So: an eye
 * judgement, stated as one, on one string. `drop` at 0.3 clears the descenders of
 * `p`, `g` and `y` in this face — 0.2 struck through the `p` in "pacemaker" — and the
 * lift plus the overshoot are what separate the mark from a table border.
 */
export const TITLE_UNDERLINE: UnderlineSpec = {
  drop: 0.3,
  rise: 0.14,
  overshoot: 0.22,
  approach: 0.45,
  /*
   * The second rule, at 0.13 of the type size below the first — about 12 units under
   * a 96-unit title, which is the distance at which two strokes read as a deliberate
   * double rather than as one thick smudge or as two unrelated lines. `inset` 0.06
   * keeps it inside the first at both ends, which is what a returning hand does: the
   * flick overshoots on the way out and stops short on the way back.
   */
  double: { gap: 0.13, inset: 0.06 },
};

/**
 * One hand-drawn rule under a written line.
 *
 * Exactly one stroke, always, and never `st.passes` of them. The runtime reveals the
 * strokes of an item in order, so a two-pass rule would sweep left-to-right and then
 * sweep back — which is what a hand does when it is scribbling something out, not what
 * it does when it is underlining a heading. It is also why the returned stroke runs
 * left to right unconditionally: it is drawn immediately after the letters it belongs
 * to, and the reveal has to continue the direction the writing was going in.
 *
 * The rule is *not* a text decoration, deliberately (`docs/PLAN-GOLPO-PARITY.md`
 * Phase 5 item 2). A `text-decoration: underline` is machine-straight, sits at a
 * baseline offset the font chose, and — the part that actually matters — cannot be
 * dash-revealed, so it would switch on at the instant the last letter landed instead
 * of being drawn. As a stroke it costs its own path length in the item's write budget
 * (the runtime prices a written line at `width * WRITE_COST` and a stroke at its
 * length), which is what keeps the accounting honest without inventing any new timing.
 */
export function sketchUnderline(
  rng: Rng,
  st: SketchStyle,
  run: WrittenRun,
  spec: UnderlineSpec = TITLE_UNDERLINE,
): string[] {
  const size = Math.abs(run.size) || 1;
  const over = size * spec.overshoot;
  const a: Pt = [run.x0 - over * spec.approach, run.baseline + size * spec.drop];
  const b: Pt = [run.x1 + over, run.baseline + size * (spec.drop - spec.rise)];
  const first = sketchLine(rng, st, a, b, 1);
  if (!spec.double) return first;

  // The hand comes back. Right to left, inside the first at both ends, one stroke —
  // and it follows the first in the returned order, so the reveal draws them in the
  // order they were made. See the note on `UnderlineSpec.double`.
  const inset = (b[0] - a[0]) * spec.double.inset;
  const gap = size * spec.double.gap;
  const back = sketchLine(rng, st, [b[0] - inset, b[1] + gap], [a[0] + inset, a[1] + gap], 1);
  return [...first, ...back];
}

/* ---------------------------------------------------------------- brand mark */

/**
 * The inkcast mark, as geometry rather than as an SVG file.
 *
 * `docs/PLAN-LAUNCH.md` C4 specifies one mark for the favicon, the OG image, the site
 * nav and the video's brand plate. The web copies of it are `<svg>` markup; this board
 * cannot use those, because a mark pasted onto the last second of a film as flat markup
 * would be the one thing in the whole video that was not drawn. So the plate keeps the
 * mark's *proportions* and re-derives its ink through the same sketch primitives as
 * everything else: the tile is four hand-drawn edges, the cast stroke is one confident
 * pass, and both dash-reveal.
 *
 * Authored on a 24-unit design box because C4's binding constraint is legibility at
 * 16 px (favicon) and 512 px (OG); a mark whose weights are chosen at 512 and scaled
 * down loses its border. Every field below is therefore a ratio of the tile side, and
 * `sketchBrandMark` never reads an absolute unit. That is what makes swapping in the
 * finished logo geometry a one-place edit: replace the numbers in this const, and the
 * plate, its stroke weights and its nib all follow.
 */
export type BrandMarkSpec = {
  /** Tile inset inside the plate box, as a fraction of the box's short side. */
  inset: number;
  /** Tile border weight — C4's "2 px border" on the 24-unit design box. */
  borderWeight: number;
  /** Cast-stroke weight. Heavier than the border: it is a marker, not a rule. */
  castWeight: number;
  /** Where the cast stroke starts, in tile fractions with y running down. */
  from: readonly [number, number];
  /**
   * The nib's tip — up and to the right of `from`, which is the whole gesture. The
   * *shaft* stops a `nibLength` short of this along `nibAim`; nothing in the spec
   * names that point, because moving the tip should move the triangle and let the
   * stroke follow rather than requiring two coordinates to be kept in step.
   */
  to: readonly [number, number];
  /** How far the stroke arcs off its own chord, towards the upper left. */
  bow: number;
  /**
   * Which way the nib points — and therefore which way its base runs, since the base
   * is perpendicular to this.
   *
   * Not the stroke's own direction, which is the mistake worth recording. Building the
   * nib on the shaft's tangent rotates the triangle to the shaft's ~54°, and a triangle
   * tilted 54° with a stroke running into the middle of its base is an *arrowhead* — two
   * captured plates read that way before this field existed. A play button has a
   * vertical base and points due right, so that is what this defaults to, and the rising
   * shaft simply terminates against it.
   */
  nibAim: readonly [number, number];
  /** Length of the solid nib along `nibAim`. */
  nibLength: number;
  /**
   * Half-width of the nib across the stroke.
   *
   * This is the one number in the spec with a hard floor rather than a preference:
   * it must clearly exceed `castWeight`, or the nib's base corners sit barely wider
   * than the shaft that runs into them and the mark reads as an *arrowhead*. The
   * first plate frame captured used `3.6 / 24` against a `2.6 / 24` shaft — a
   * half-width only 1.4× the stroke width — and it read as an arrow, barbs and all.
   * `4.4 / 24` is 1.7× the shaft, which with `nibAim` upright is enough for the
   * triangle to be a play button with a marker stroke running into it — the whole
   * conceit of the mark — and it is as wide as the 24-box has room for without the
   * base corners touching the tile's border.
   */
  nibHalfWidth: number;
  /**
   * Where along the nib's base the shaft lands: 0 the centre, 1 the trailing corner.
   *
   * The third attempt at the same defect, and the first one judged against a rendered
   * frame rather than against reasoning about one. `nibAim` and `nibHalfWidth` above
   * each record a plate that read as an arrowhead and a change made to stop it; the
   * plate captured at t=176.2 s of the cardiac film — the first time this geometry was
   * ever on screen, because nothing called `sketchBrandMark` until the plate was wired
   * into `compile.ts` — still read as an arrow. The measurement says why, and it is not
   * the half-width: at a 92 px plate the base is 76 canvas units tall and the shaft
   * 22.6 units wide, so a shaft landing on the base's *centre* leaves 27 units of
   * triangle standing out on either side of it. Two symmetric spurs off the end of a
   * rising stroke are barbs, and the eye reads barbs as an arrow no matter how wide
   * they are — widening them further only draws a bigger arrow.
   *
   * Landing on the trailing corner instead removes the upper spur entirely: the
   * triangle sits wholly above and ahead of the stroke, which is then a marker sweeping
   * *into* a play button rather than a shaft wearing one. That is the mark C4 describes,
   * and it is why this is a spec field and not a hard-coded corner — the finished logo
   * may want the centre back, and it should get it by editing one number.
   */
  shaftLanding: number;
  /** Cast violet, `oklch(0.51 0.23 277)`, the one colour the plate spends. */
  stroke: string;
};

/**
 * Cast violet is a hex literal here, and not the OKLCH form the design system is
 * authored in, for the same reason every colour in `palette.ts` is: a RenderPlan's
 * colours end up compared, substituted and pattern-matched as strings (`penArt` swaps
 * the marker barrel by matching `'#2f6fed'`), and one colour written in a second
 * notation is a colour those comparisons silently miss.
 *
 * `#4F46E5` is the sRGB resolution of `oklch(0.51 0.23 277)`, the authoritative token
 * in `apps/web/app/globals.css`. That file's own comment records the trap: PLAN-LAUNCH
 * C1 writes the target as `#5B45E0`, which is a different colour (`oklch(0.513 0.223
 * 282)`). Follow the OKLCH value, which is what this hex is — not the plan's hex.
 */
export const BRAND_MARK: BrandMarkSpec = {
  inset: 0.06,
  borderWeight: 2 / 24,
  castWeight: 2.6 / 24,
  from: [4 / 24, 19.5 / 24],
  to: [21 / 24, 7 / 24],
  bow: 0.03,
  nibAim: [1, 0],
  nibLength: 8 / 24,
  nibHalfWidth: 4.4 / 24,
  shaftLanding: 1,
  stroke: '#4F46E5',
};

/**
 * The plate's ink, split by the treatment each part needs.
 *
 * Returned as named parts rather than one flat `string[]` — the exception to this
 * module's rule — because the three parts do not share a colour, a weight or a fill.
 * Flattening them would force the caller to re-derive which stroke was which by index,
 * and an index-based contract between two files is exactly how the visuals stage ended
 * up writing roughjs SVGs that nothing reads.
 */
export type BrandMark = {
  /** Four edges, ink, one pass each. Never filled — C4 is explicit about that. */
  tile: string[];
  /** One marker stroke, corner to corner, rising right. Draw it in `stroke`. */
  cast: string[];
  /** The solid triangular nib at the stroke's end. Closed: give it a fill. */
  nib: string;
  /** Tile border width in canvas units, already scaled to this plate. */
  borderWidth: number;
  /** Cast stroke width in canvas units. */
  castWidth: number;
  /** The square the mark actually occupies, for the caller's layout arithmetic. */
  box: Rect;
};

/**
 * Lay the mark out inside `box`.
 *
 * The mark is square by construction, so a non-square plate box gets the largest
 * centred square that fits: a corner watermark is placed against two edges of the
 * frame by whoever computes `box`, and silently stretching the tile to fill a wide
 * box would turn the play-button nib into a lopsided wedge.
 */
export function sketchBrandMark(
  rng: Rng,
  st: SketchStyle,
  box: Rect,
  spec: BrandMarkSpec = BRAND_MARK,
): BrandMark {
  const side = Math.max(0, Math.min(box.w, box.h)) * (1 - spec.inset * 2);
  const ox = box.x + (box.w - side) / 2;
  const oy = box.y + (box.h - side) / 2;
  const tileBox: Rect = { x: ox, y: oy, w: side, h: side };
  const at = (u: readonly [number, number]): Pt => [ox + u[0] * side, oy + u[1] * side];

  // One pass per edge, not `st.passes`. A plate is small — at 16 px equivalent the
  // second pass of a two-pass edge lands within a stroke width of the first, and the
  // border reads as a blurred double line instead of a border.
  const tile = sketchRect(rng, st, tileBox, 1);

  const from = at(spec.from);
  const tip = at(spec.to);

  const nibLen = side * spec.nibLength;
  const halfW = side * spec.nibHalfWidth;
  // The nib sits on its own axis, not the shaft's — see `nibAim`. The shaft stops on
  // its base rather than at the tip: running the stroke on to the tip and painting a
  // solid triangle over it would leave a stroke-width of ink outside the triangle's
  // edges at low resolution, which is precisely the size the mark has to survive.
  const aimLen = Math.hypot(spec.nibAim[0], spec.nibAim[1]) || 1e-6;
  const ax = spec.nibAim[0] / aimLen;
  const ay = spec.nibAim[1] / aimLen;
  const baseMid: Pt = [tip[0] - ax * nibLen, tip[1] - ay * nibLen];
  // Across the base, on the trailing side — the same perpendicular the base corners
  // are built from below, so `shaftLanding: 1` lands the shaft exactly on `base1`.
  const across: Pt = [-ay * halfW, ax * halfW];
  const landing = Math.max(-1, Math.min(1, spec.shaftLanding));
  const shaftEnd: Pt = [baseMid[0] + across[0] * landing, baseMid[1] + across[1] * landing];

  const dx = shaftEnd[0] - from[0];
  const dy = shaftEnd[1] - from[1];
  const len = Math.hypot(dx, dy) || 1e-6;
  const ux = dx / len;
  const uy = dy / len;
  // Perpendicular, then negated, so the arc bulges towards the upper left — the way a
  // right hand's wrist carries a stroke that is being pulled up and to the right.
  const px = uy;
  const py = -ux;
  const bowAmt = side * spec.bow;
  const mid: Pt = [
    (from[0] + shaftEnd[0]) / 2 + px * bowAmt,
    (from[1] + shaftEnd[1]) / 2 + py * bowAmt,
  ];
  const cast = sketchCurve(rng, st, [from, mid, shaftEnd], 1);

  // The nib is jittered far less than the rest of the plate. Everything else here is
  // allowed to look drawn; the nib is a play button, and a play button with rounded,
  // wandering corners stops being a play button.
  const jit = st.roughness * st.scale * 0.5;
  const corner = (p: Pt): Pt => [p[0] + rng.sym(jit), p[1] + rng.sym(jit)];
  const base1 = corner([baseMid[0] + across[0], baseMid[1] + across[1]]);
  const base2 = corner([baseMid[0] - across[0], baseMid[1] - across[1]]);
  const apex = corner(tip);
  const nib = `${lineThrough([base1, apex, base2])} Z`;

  return {
    tile,
    cast,
    nib,
    borderWidth: side * spec.borderWeight,
    castWidth: side * spec.castWeight,
    box: tileBox,
  };
}

/* ------------------------------------------------------------------ hachure */

function rot(p: Pt, c: number, s: number): Pt {
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
}

/**
 * Parallel fill strokes clipped to a convex polygon, via a scanline in the
 * rotated frame. Used for `fill: true` shapes — a sketchy hatch, never a
 * flat block of colour.
 */
export function hachurePolygon(
  rng: Rng,
  st: SketchStyle,
  poly: Pt[],
  gap: number,
  angleDeg = -41,
): string[] {
  if (poly.length < 3 || gap <= 0) return [];
  const a = (angleDeg * Math.PI) / 180;
  const c = Math.cos(-a);
  const s = Math.sin(-a);
  const local = poly.map((p) => rot(p, c, s));
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of local) {
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  const back = Math.cos(a);
  const backS = Math.sin(a);
  const out: string[] = [];
  for (let y = minY + gap * 0.6; y < maxY; y += gap) {
    const xs: number[] = [];
    for (let i = 0; i < local.length; i++) {
      const p1 = local[i] as Pt;
      const p2 = local[(i + 1) % local.length] as Pt;
      if (p1[1] === p2[1]) continue;
      const lo = Math.min(p1[1], p2[1]);
      const hi = Math.max(p1[1], p2[1]);
      if (y < lo || y >= hi) continue;
      xs.push(p1[0] + ((y - p1[1]) * (p2[0] - p1[0])) / (p2[1] - p1[1]));
    }
    xs.sort((u, v) => u - v);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const x1 = xs[i] as number;
      const x2 = xs[i + 1] as number;
      if (x2 - x1 < gap * 0.35) continue;
      const p1 = rot([x1 + rng.sym(gap * 0.18), y], back, backS);
      const p2 = rot([x2 + rng.sym(gap * 0.18), y], back, backS);
      out.push(...sketchLine(rng, st, p1, p2, 1));
    }
  }
  return out;
}

/** Hachure inside an ellipse: scanline in unit-circle space, mapped back. */
export function hachureEllipse(
  rng: Rng,
  st: SketchStyle,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  gap: number,
  angleDeg = -41,
): string[] {
  if (rx <= 0 || ry <= 0 || gap <= 0) return [];
  const a = (angleDeg * Math.PI) / 180;
  // Hachure direction in ellipse space -> circle space (affine maps keep parallels).
  let dx = Math.cos(a) / rx;
  let dy = Math.sin(a) / ry;
  const dl = Math.hypot(dx, dy) || 1e-6;
  dx /= dl;
  dy /= dl;
  const px = -dy;
  const py = dx;
  const step = gap / Math.max(rx, ry);
  const out: string[] = [];
  for (let s = -1 + step * 0.7; s < 1; s += step) {
    const half = Math.sqrt(Math.max(0, 1 - s * s));
    if (half < step * 0.4) continue;
    const p1: Pt = [cx + (px * s - dx * half) * rx, cy + (py * s - dy * half) * ry];
    const p2: Pt = [cx + (px * s + dx * half) * rx, cy + (py * s + dy * half) * ry];
    out.push(...sketchLine(rng, st, p1, p2, 1));
  }
  return out;
}

/** Corner points of a rect, for `hachurePolygon`. */
export function rectPoly(r: Rect): Pt[] {
  return [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x + r.w, r.y + r.h],
    [r.x, r.y + r.h],
  ];
}
