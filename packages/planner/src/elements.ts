/**
 * Element builders and text metrics.
 *
 * The Storyboard IR's zod schema has defaults for most element fields; these
 * builders fill them in explicitly so the planner always produces fully-formed
 * elements (and so `Storyboard.parse` is a validation step, not a repair step).
 *
 * `at` boxes are *measured*: the planner knows how big a piece of text is at the
 * board's type scale, which is what makes collision-free layout possible. The
 * renderer owns the exact typeface, so it should fit text to the box rather than
 * assume a font size.
 *
 * "The board's type scale" and not "its own" — that distinction is defect 0, and `FONT`
 * below is the planner's half of it: the sizes here are held to a stated ratio against
 * `TYPE_SCALE` in `@inkcast/core`, which the renderer draws at, and
 * `test/type-scale.test.ts` fails if either side moves without the other. What it is *not*
 * is equal to it — the two are in different units, and the measurement that says so is in
 * `FONT`'s own comment.
 */
import {
  DEFAULT_STYLE,
  TYPE_SCALE,
  codeBox,
  handFontFor,
  handMetricsFor,
  logger,
} from '@inkcast/core';
import type {
  ArrowElement,
  AssetElement,
  CodeElement,
  DiagramElement,
  Element,
  EmphasisElement,
  EquationElement,
  FontMetrics,
  ShapeElement,
  StoryboardMeta,
  TextElement,
} from '@inkcast/core';
import { words } from './text.js';

const log = logger('planner:elements');

/**
 * `@inkcast/core` exports `Box` as a zod schema but not as a type, and an
 * element's `at` is exactly that shape — so derive it rather than restating it.
 */
export type Box = Element['at'];

/**
 * A canvas-space point. `@inkcast/core` exports `Point` as a zod schema rather
 * than a type, so derive it from the IR field that already has this shape — that
 * way it can never drift from the schema.
 */
export type Point = ArrowElement['from'];

type Z = { x: number; y: number };
type Role = TextElement['role'];

/**
 * The two type tables. `FONT` (canvas units per role, below) is held to `TYPE_SCALE`
 * by `TYPE_RATIO`, not equal to it.
 *
 * ## Why `FONT` is not `TYPE_SCALE`, having twice been made equal to it
 *
 * `docs/HANDOFF.md` calls the two "two catalogues of one number" and the obvious fix is to
 * delete one. It has now been tried from both ends and neither is the fix, because **they
 * are not one number**: `TYPE_SCALE` is output pixels on a 1080-tall frame and this is
 * canvas units, and `boardMetrics` converts between them with a factor the camera decides.
 *
 * - Making the *renderer* draw at these numbers was attempted and reverted in `45d4ff9`.
 *   It left three render tests red and shrank type by ~21% in every film, against the only
 *   calibration in the repo (`compile.test.ts:147`, reasoning in pixel space: "a 96 px
 *   title therefore lands as ~72.7 canvas units — which is what fits the 150-unit box the
 *   author drew").
 * - Making the *planner* reserve at those numbers — `FONT = { ...TYPE_SCALE }` — was
 *   attempted in the launch build and is reverted here. Measured with
 *   `packages/pipeline/src/sbhash.mts` and a full storyboard diff: it moves **all four**
 *   pinned hashes, and on `gradient-descent` at `standard` alone it rewrites **330
 *   geometric values** — every reserved box shifted, and some *narrower* than before,
 *   because a larger size rewraps a string onto more lines. Not one character of text
 *   changed. So it is 330 unverified box moves on two shipped films, and the pinned-hash
 *   test is explicit that a re-pin has to be paid for by looking at the frames.
 *
 * The reason not to pay it is that the frames say the premise is wrong. `docs/STATUS.md`
 * 2026-08-09 measured the shipped boards: standard 16:9 draws body at 17.4 and 33.5 canvas
 * units into a 34-unit box — *smaller* than reserved, not clipped by it. The `AV nod` and
 * `empty stac` clipping is real and it is in a **drawing's** labels, which are measured by
 * `labelFootprint` in `./draw-geom.ts` and never touch this table. Enlarging every
 * reservation in the compiler would not have moved those two strings by a pixel.
 *
 * ## What did close, and what a viewer is still owed
 *
 * The third catalogue is gone for real: `ROLE_SCALE` in `visuals/src/style.ts` is now
 * derived from `TYPE_SCALE`, which is legitimate because it is a *fraction of canvas
 * height* under the stated assumption that the whole canvas is on screen — and when the
 * whole canvas is on screen the canvas is the frame, so the two are the same unit. That
 * one really was a restatement, and it really had drifted (a title at 0.082 of 1080 is
 * 88.6 against the renderer's 96).
 *
 * What is left is two tables in two units, which is a relationship rather than a
 * duplication — so it is enforced as one. `TYPE_RATIO` states it and
 * `test/type-scale.test.ts` executes it: change either side alone and a test names the
 * other. That is the part of defect 0 that can be closed without pixels. The rest is the
 * fixed point `docs/PLAN-LAUNCH.md` A7 describes — measure, frame, re-measure with the
 * framing in hand — which moves all four hashes by design and is, in `STATUS.md`'s words,
 * "a decision for a person, not something to slip into a phase".
 */
/**
 * Canvas units per output pixel, per role — the relationship `FONT` and `TYPE_SCALE` are
 * held to, so that neither can drift without a test saying which one moved.
 *
 * Per role and not one constant, because the two tables were never a uniform scaling of
 * each other: the ratio runs 0.79 at `title` to 0.85 at `label`, i.e. the board's smaller
 * roles are relatively larger than the renderer's. That is the historical shape of the
 * two catalogues and it is recorded rather than smoothed, because smoothing it is a change
 * to what the compiler reserves and every such change moves the pinned hashes.
 *
 * The band in `test/type-scale.test.ts` is deliberately loose (±0.04). This is a guard
 * against a silent divergence — a role added to one table and not the other, a size
 * doubled on one side — and not a claim that these five numbers are optimal. They are not:
 * `boardMetrics`'s real conversion factor was measured at 0.511 to 1.667 across the six
 * boards in the repository, so no fixed ratio is right for every shot, which is exactly
 * why the honest fix is a second pass with the framing in hand.
 */
export const TYPE_RATIO: Record<Role, number> = {
  title: 76 / 96,
  heading: 50 / 62,
  body: 34 / 42,
  label: 27 / 32,
  caption: 22 / 26,
};

/**
 * One catalogue imports the other (plan item 2.1): `FONT` is now *computed* as
 * `TYPE_SCALE × TYPE_RATIO` — exactly the numbers it always was (76, 50, 34, 27, 22,
 * because `TYPE_RATIO`'s numerators are these values by construction), but a change to
 * `TYPE_SCALE` now reaches the compiler's reservations through the stated ratio instead
 * of silently diverging from them. The ratio table, not equality, is deliberate — see
 * the comment above `TYPE_RATIO`, and the two reverts (`45d4ff9`) that taught it.
 */
export const FONT: Record<Role, number> = {
  title: TYPE_SCALE.title * TYPE_RATIO.title,
  heading: TYPE_SCALE.heading * TYPE_RATIO.heading,
  body: TYPE_SCALE.body * TYPE_RATIO.body,
  label: TYPE_SCALE.label * TYPE_RATIO.label,
  caption: TYPE_SCALE.caption * TYPE_RATIO.caption,
};

/* ------------------------------------------------------------- text metrics */

/**
 * The planner measures with the board's own hand (audit A-4, plan item 2.1).
 *
 * `ADVANCE = 0.52` — a chars-times-a-constant estimate of the handwriting face's
 * advances — lived here from the first commit to 2026-08-23. It was an honest mean
 * (measured p50 0.504 over the 189 corpus strings), and a mean is exactly the problem:
 * the widest corpus string ran 1.27× it, which is the gap `LABEL_SLACK` in
 * `./draw-geom.ts` existed to paper over, and papering it over is how "empty stac" and
 * "AV nod" shipped. There is now one advance table in the repo — the real cmap/hmtx
 * parse in `@inkcast/core`'s `fontmetrics.ts` — and this module wraps with it, using
 * the same greedy word wrap, the same tracking, and the same line-height formula as
 * `visuals/src/text.ts` `layoutText`, so the box the planner reserves and the lines
 * the board letters can only disagree by the shrink-to-fit the renderer applies.
 */
let handStyle: StoryboardMeta['style'] = DEFAULT_STYLE;

/**
 * Point the planner's measurements at the ink style the board will letter with.
 *
 * Called at the head of every storyboard-producing entry (`compileLesson`,
 * `heuristicPlan`) — module state rather than a threaded parameter because the
 * builders below are called from dozens of sites that have no business knowing about
 * fonts. Callers with no style in hand (unit tests, the drawing critic's preview)
 * measure with the default marker face; the four vendored faces cluster within ~8%,
 * and everything downstream of those callers is re-measured by the real compile.
 */
export function setPlannerHand(style: StoryboardMeta['style']): void {
  handStyle = style;
}

function hand(): FontMetrics {
  return handMetricsFor(handStyle);
}

/** Width of one line at `size` canvas units, measured with the board's own hand. */
export function handMeasure(text: string, size: number): number {
  return hand().measure(text, size, handFontFor(handStyle).tracking);
}

/**
 * Line height at `size` — the renderer's own formula (`layoutText` in
 * `visuals/src/text.ts`), so a reserved block and a lettered block are the same height.
 */
export function handLineHeight(size: number): number {
  const f = hand();
  return Math.max(size * 1.12, (f.ascent + f.descent + f.lineGap) * size * 1.02);
}

/**
 * Greedy word wrap at a canvas-unit width. Returns the laid-out lines.
 *
 * The algorithm is `wrapParagraph`'s from `visuals/src/text.ts`, deliberately: word
 * wrap with whole-candidate measurement (tracking is a per-gap cost, so summing word
 * widths under-reports the line), and a per-character break for a single word wider
 * than the box.
 */
export function wrapText(text: string, role: Role, maxWidth: number): string[] {
  const size = FONT[role];
  const fits = (s: string): boolean => handMeasure(s, size) <= maxWidth;
  const out: string[] = [];
  let cur = '';
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const candidate = cur === '' ? w : `${cur} ${w}`;
    if (fits(candidate)) {
      cur = candidate;
      continue;
    }
    if (cur !== '') {
      out.push(cur);
      cur = '';
    }
    if (fits(w)) {
      cur = w;
      continue;
    }
    let chunk = '';
    for (const ch of w) {
      if (chunk !== '' && !fits(chunk + ch)) {
        out.push(chunk);
        chunk = ch;
      } else {
        chunk += ch;
      }
    }
    cur = chunk;
  }
  if (cur !== '') out.push(cur);
  return out.length ? out : [''];
}

/** Tight box for a piece of text, wrapped to at most `maxWidth`. */
export function measureText(text: string, role: Role, maxWidth: number): { w: number; h: number } {
  const lines = wrapText(text, role, maxWidth);
  const size = FONT[role];
  const widest = lines.reduce((m, l) => Math.max(m, handMeasure(l, size)), 0);
  return {
    w: Math.min(maxWidth, Math.max(80, Math.round(widest))),
    h: Math.round(lines.length * handLineHeight(size)),
  };
}

const box = (w: number, h: number, at?: Z): Box => ({ x: at?.x ?? 0, y: at?.y ?? 0, w, h });

export type EnterInit = { at?: number; duration?: number; style?: Element['enter']['style'] };

function enter(init: EnterInit | undefined, fallback: Element['enter']['style']) {
  return {
    at: init?.at ?? 0,
    duration: init?.duration ?? 0.8,
    style: init?.style ?? fallback,
  };
}

/* ------------------------------------------------------------ math sniffing */

/** Codepoints that read as mathematics wherever they appear in would-be handwriting. */
function mathCodePoint(cp: number): boolean {
  return (
    (cp >= 0x2200 && cp <= 0x22ff) || // mathematical operators (∀ … ⋿, incl. √ ∞ ≠ ≤ ≥ ⋅)
    (cp >= 0x27e8 && cp <= 0x27ef) || // mathematical brackets (bra-ket ⟨⟩)
    (cp >= 0x2070 && cp <= 0x209f) || // Unicode super/subscripts (ⁿ, ₂, …)
    (cp >= 0x1d400 && cp <= 0x1d7ff) || // mathematical alphanumeric symbols
    cp === 0x00b9 || // ¹ (the Latin-1 superscripts predate the block above)
    cp === 0x00b2 || // ²
    cp === 0x00b3 || // ³
    cp === 0x00b1 || // ±
    cp === 0x00d7 || // ×
    cp === 0x00f7 || // ÷
    cp === 0x221a // √ (also in the operators range; kept for clarity)
  );
}

function greekCodePoint(cp: number): boolean {
  return cp >= 0x0370 && cp <= 0x03ff;
}

/**
 * Does this string carry mathematics that the handwriting lane would mangle?
 *
 * The other half of the audit's D1 (S5-b): the equation lane is sound, but nothing
 * stopped an author steering `α|0⟩ + β|1⟩` into a plain text element, where it is
 * wrapped at estimated widths and lettered by a font with no glyphs for it. Two
 * signals, either sufficient:
 *
 *  - **TeX fragments** — a control sequence or `$…$` — are never prose.
 *  - **Two or more Unicode math codepoints.** Operators, bra-ket brackets,
 *    super/subscripts and math alphanumerics always count; a Greek letter counts
 *    only when it sits against a digit, a bar, or another math/Greek character,
 *    because a lone `π` inside a sentence is arguably prose while `α|0⟩` is not.
 *
 * The threshold is two so that a single decorative arrow or × in prose does not
 * reroute a caption.
 */
export function sniffMath(text: string): boolean {
  // A TeX control sequence: lowercase word after a backslash that does not itself
  // follow an identifier, colon or another backslash — which is what separates
  // `\frac` and `the angle \theta` from `C:\Users\demo`, a Windows path.
  if (/(^|[^A-Za-z0-9:.\\])\\[a-z]{2,}/.test(text)) return true;
  if (/\$[^$\s][^$]*\$/.test(text)) return true; // $x^2$
  const chars = [...text];
  let signals = 0;
  for (const [i, ch] of chars.entries()) {
    const cp = ch.codePointAt(0)!;
    if (mathCodePoint(cp)) {
      signals++;
      continue;
    }
    if (greekCodePoint(cp)) {
      const prev = chars[i - 1] ?? '';
      const next = chars[i + 1] ?? '';
      const mathy = (s: string): boolean =>
        s !== '' &&
        (/[0-9|=^_]/.test(s) ||
          mathCodePoint(s.codePointAt(0)!) ||
          greekCodePoint(s.codePointAt(0)!));
      if (mathy(prev) || mathy(next)) signals++;
    }
  }
  return signals >= 2;
}

/**
 * A text element — or, when the string is mathematics, the equation it should
 * have been (audit S5-b, the routing half of D1).
 *
 * The promotion happens here rather than at a call site because every string
 * that can carry author text funnels through this builder: captions, notes,
 * terms, the vertical preset's big point. A promoted string keeps the caller's
 * box discipline (same maxWidth, same alignment) and goes down the equation
 * lane, where it is typeset into real glyph outlines instead of being lettered
 * by a handwriting font that has no glyphs for it. If the promoted string then
 * fails to typeset, that failure is loud (`texError`, and the strict gate in
 * visuals) — which is strictly better than silently shipping tofu.
 */
export function makeText(
  id: string,
  text: string,
  role: Role,
  o: { maxWidth?: number; align?: TextElement['align']; persist?: boolean; enter?: EnterInit } = {},
): TextElement | EquationElement {
  if (sniffMath(text)) {
    log.warn(
      `"${text}" was routed to a text element but reads as mathematics — ` +
        'promoting it to the equation lane so it is typeset rather than handwritten',
    );
    return makeEquation(id, text, role, {
      ...(o.maxWidth !== undefined ? { maxWidth: o.maxWidth } : {}),
      ...(o.align !== undefined ? { align: o.align } : {}),
      ...(o.persist !== undefined ? { persist: o.persist } : {}),
      ...(o.enter !== undefined ? { enter: o.enter } : {}),
    });
  }
  const maxWidth = o.maxWidth ?? 900;
  const m = measureText(text, role, maxWidth);
  return {
    id,
    type: 'text',
    text,
    role,
    align: o.align ?? 'left',
    at: box(m.w, m.h),
    enter: enter(o.enter, 'write'),
    persist: o.persist ?? true,
  };
}

/* ------------------------------------------------------- TeX box estimation */

/**
 * Roughly how many symbols a TeX string will set — for measurement only, never meaning.
 *
 * One character per control sequence, and braces, alignment marks, sub/superscript
 * operators and spacing dropped: those are structure, not ink. Deliberately crude, and
 * it can afford to be — it feeds a *reservation* (the typesetter fits the real geometry
 * into the box preserving aspect, so an over-estimate is whitespace) and a reveal
 * duration (an over-estimate is a slower, more legible reveal). Checked against
 * MathJax's own count on five lesson equations: exact on two, one short on `E = mc^2`,
 * four long on a chemical equation full of `\mathrm` (which sets no ink of its own).
 *
 * This is the repo's ONE TeX size estimator (plan item 2.1): `makeEquation` below and
 * `withMathBox` in `./drawing.ts` both reserve through `texBox`. They used to hold one
 * each — this one fed handwriting advances, that one fed MathJax ems — and an equation
 * is typeset, not handwritten, so the handwriting one was simply wrong.
 */
export function mathSymbols(tex: string): number {
  const flat = tex.replace(/\\[a-zA-Z]+/g, 'x').replace(/[{}&\\^_$\s,]/g, '');
  return Math.max(1, flat.length);
}

/**
 * Width of one typeset symbol, as a fraction of the type size it is set at.
 *
 * Measured, not guessed. MathJax reports its own layout in units of 1000 to the em, and
 * over five real lesson equations the drawn width comes out at 0.57–0.77 em per drawn
 * mark (`E = mc^2` is 3.85 em wide for 5 marks; `2H₂ + O₂ → 2H₂O` is 8.14 em for 11;
 * `\frac{dv}{dt} = -\frac{g}{L}\theta` is 5.15 em for 11). 0.75 is the wide end of
 * that, because the number is only ever used to reserve a box and reserving slightly
 * too much costs whitespace while reserving too little costs size.
 *
 * Notably wider than handwriting's measured ~0.52 em for prose, which is the arithmetic
 * reason a `label` carrying an equation was never going to be measured correctly: TeX
 * puts real space around a relation and a binary operator, and prose does not.
 */
export const MATH_ADVANCE = 0.75;

/**
 * Height of a line of maths, as a multiple of its type size.
 *
 * A flat expression measures 0.85–0.95 em tall and one containing a fraction 2.07–2.10
 * em (measured, same five equations). Each case reserves the wide end of its own band —
 * a box too tall for its contents letterboxes and costs whitespace, while a box too
 * short shrinks the glyphs — but the tall band is reserved only for TeX that actually
 * stacks, because a flat `E = mc^2` in a 2.2 em box pushes everything below it down a
 * full line for air it will never use.
 */
export const MATH_HEIGHT = 2.2;
const MATH_FLAT_HEIGHT = 1.0;

/** TeX whose typeset form stacks vertically — the 2.07–2.10 em band above. */
function texStacks(tex: string): boolean {
  return /\\(?:[dt]?frac|binom|over(?!line)|sum|prod|int|substack|stackrel|sqrt)|\\begin\{/.test(
    tex,
  );
}

/**
 * The box a TeX string is reserved before typesetting exists to measure it.
 *
 * An estimate by necessity — MathJax runs in the visuals stage, stages later — but the
 * only one: everything that reserves room for an equation calls this.
 */
export function texBox(tex: string, size: number): { w: number; h: number } {
  return {
    w: Math.max(size, Math.round(mathSymbols(tex) * size * MATH_ADVANCE)),
    h: Math.round(size * (texStacks(tex) ? MATH_HEIGHT : MATH_FLAT_HEIGHT)),
  };
}

/**
 * A typeset equation, sized like a line of maths at `role`.
 *
 * The box is *measured* like everything else here, but estimated from the TeX source
 * (`texBox`) rather than from the rendered result, which the planner cannot see. The
 * visuals stage fits the real typeset geometry into whatever box this reserves,
 * preserving aspect, so an over-generous estimate costs whitespace and an
 * under-generous one costs size — never a collision.
 */
export function makeEquation(
  id: string,
  tex: string,
  role: Role,
  o: {
    maxWidth?: number;
    align?: EquationElement['align'];
    display?: boolean;
    persist?: boolean;
    enter?: EnterInit;
  } = {},
): EquationElement {
  const maxWidth = o.maxWidth ?? 900;
  const t = texBox(tex, FONT[role]);
  const m = { w: Math.min(maxWidth, Math.max(80, t.w)), h: t.h };
  return {
    id,
    type: 'equation',
    tex,
    display: o.display ?? true,
    align: o.align ?? 'center',
    at: box(m.w, m.h),
    // `draw` rather than `write`: the glyphs are revealed as ink along their own
    // outlines, not through the handwriting lane's per-word masks.
    enter: enter(o.enter, 'draw'),
    persist: o.persist ?? true,
  };
}

/**
 * A set listing, sized from its own character grid.
 *
 * The measurement is the whole of this builder, and it is measured on the same grid the
 * visuals stage will set on — `codeBox` in `@inkcast/core` is the one function that counts
 * a listing's columns, imported by both stages for the reason `A-4` gives about advance
 * tables. `FONT.label` rather than `FONT.body` because a listing is a quotation and reads
 * as one: code set as large as the prose around it competes with the prose, and the board
 * has a caption and a picture in the same cell.
 *
 * `maxWidth` is a ceiling on the box, so a 60-column line makes the whole block smaller
 * rather than overrunning. The visuals stage may shrink it further to fit whatever cell
 * the layout solver hands it, and refuses below the board's caption size — which is where
 * "this listing is too big for this beat" becomes a named problem instead of a grey
 * rectangle.
 *
 * **Never routed through `makeText`.** `sniffMath` promotes anything that looks
 * mathematical to the equation lane, and its TeX test fires on a backslash followed by
 * letters and on `$…$` — which is a Windows path, a shell variable, a PHP variable and a
 * regex in almost any real snippet. Code reaching the board as text is the defect this
 * lane exists to end; code reaching it as *TeX* would be a new one.
 */
export function makeCode(
  id: string,
  code: string,
  lang: string,
  o: {
    maxWidth?: number;
    align?: CodeElement['align'];
    persist?: boolean;
    enter?: EnterInit;
  } = {},
): CodeElement {
  const fitted = codeBox(code, FONT.label, o.maxWidth ?? 900);
  return {
    id,
    type: 'code',
    code,
    lang,
    align: o.align ?? 'left',
    at: box(fitted.w, fitted.h),
    // `draw` rather than `write`: the glyphs are revealed as ink along their own outlines,
    // in document order, not through the handwriting lane's per-word masks.
    enter: enter(o.enter, 'draw'),
    persist: o.persist ?? true,
  };
}

export function makeShape(
  id: string,
  shape: ShapeElement['shape'],
  w: number,
  h: number,
  o: { fill?: boolean; persist?: boolean; enter?: EnterInit } = {},
): ShapeElement {
  return {
    id,
    type: 'shape',
    shape,
    fill: o.fill ?? false,
    at: box(w, h),
    enter: enter(o.enter, 'draw'),
    persist: o.persist ?? true,
  };
}

export function makeAsset(
  id: string,
  assetId: string,
  size = 200,
  o: { flipX?: boolean; persist?: boolean; enter?: EnterInit } = {},
): AssetElement {
  return {
    id,
    type: 'asset',
    assetId,
    flipX: o.flipX ?? false,
    at: box(size, size),
    enter: enter(o.enter, 'draw'),
    persist: o.persist ?? true,
  };
}

export function makeDiagram(
  id: string,
  layout: DiagramElement['layout'],
  nodes: { id: string; label: string }[],
  edges: { from: string; to: string; label?: string }[] = [],
  o: { w?: number; h?: number; persist?: boolean; enter?: EnterInit } = {},
): DiagramElement {
  const size = diagramSize(layout, nodes);
  return {
    id,
    type: 'diagram',
    layout,
    nodes,
    edges,
    at: box(o.w ?? size.w, o.h ?? size.h),
    enter: enter(o.enter, 'draw'),
    persist: o.persist ?? true,
  };
}

export function makeArrow(
  id: string,
  o: {
    from?: Z;
    to?: Z;
    curve?: number;
    label?: string;
    persist?: boolean;
    enter?: EnterInit;
  } = {},
): ArrowElement {
  const from = o.from ?? { x: 0, y: 0 };
  const to = o.to ?? { x: 100, y: 0 };
  const el: ArrowElement = {
    id,
    type: 'arrow',
    from,
    to,
    curve: o.curve ?? 0.2,
    at: {
      x: Math.min(from.x, to.x),
      y: Math.min(from.y, to.y),
      w: Math.max(24, Math.abs(to.x - from.x)),
      h: Math.max(24, Math.abs(to.y - from.y)),
    },
    enter: enter(o.enter, 'draw'),
    persist: o.persist ?? true,
  };
  if (o.label !== undefined) el.label = o.label;
  return el;
}

export function makeEmphasis(
  id: string,
  targetId: string,
  effect: EmphasisElement['effect'],
  o: { persist?: boolean; enter?: EnterInit } = {},
): EmphasisElement {
  return {
    id,
    type: 'emphasis',
    targetId,
    effect,
    at: box(120, 120),
    enter: enter(o.enter, 'draw'),
    // Annotations are transient by nature: the circle comes off the board, the
    // thing it circled stays.
    persist: o.persist ?? false,
  };
}

/** Intrinsic size for a diagram, generous enough for the visuals stage. */
export function diagramSize(
  layout: DiagramElement['layout'],
  nodes: { id: string; label: string }[],
): { w: number; h: number } {
  const n = Math.max(1, nodes.length);
  // The widest node label at the board's label size, measured with the real advance
  // table (chars × 13 until plan item 2.1), plus air for the node's own border.
  const longest = nodes.reduce((m, x) => Math.max(m, handMeasure(x.label, FONT.label)), 0);
  const nodeW = Math.min(420, Math.max(180, Math.round(longest) + 48));
  const nodeH = 92;
  switch (layout) {
    case 'stack':
      return { w: nodeW + 40, h: n * (nodeH + 26) };
    case 'flow':
    case 'sequence': {
      const perRow = Math.max(1, Math.min(n, Math.floor(1400 / (nodeW + 90))));
      const rows = Math.ceil(n / perRow);
      return { w: Math.min(n, perRow) * (nodeW + 90) - 90, h: rows * (nodeH + 70) - 70 };
    }
    case 'tree': {
      const leaves = Math.max(2, n - 1);
      return { w: Math.min(1500, leaves * (nodeW * 0.8)), h: 3 * (nodeH + 80) };
    }
    case 'grid': {
      const cols = Math.ceil(Math.sqrt(n));
      return { w: cols * (nodeW + 40) - 40, h: Math.ceil(n / cols) * (nodeH + 40) - 40 };
    }
    case 'graph':
    default:
      return { w: Math.min(1400, 320 + n * 120), h: Math.min(760, 260 + n * 40) };
  }
}

/** Re-measure an element after layout assigns it a width. */
export function refit(el: Element, width: number): void {
  if (el.type === 'text') {
    const m = measureText(el.text, el.role, width);
    el.at.w = m.w;
    el.at.h = m.h;
    return;
  }
  if (el.type === 'diagram') {
    const s = diagramSize(el.layout, el.nodes);
    if (s.w <= width) {
      el.at.w = s.w;
      el.at.h = s.h;
      return;
    }
    // Squeezed horizontally, a diagram gets taller: its rows wrap.
    const k = Math.max(0.3, width / s.w);
    el.at.w = width;
    el.at.h = Math.round(s.h / Math.sqrt(k));
    return;
  }
  if (el.at.w > width) {
    const k = width / el.at.w;
    el.at.w = width;
    el.at.h = Math.max(40, Math.round(el.at.h * k));
  }
}

/** Number of words an element puts on the board — used for pacing sanity. */
export function elementWords(el: Element): number {
  if (el.type === 'text') return words(el.text).length;
  if (el.type === 'diagram') return el.nodes.reduce((n, x) => n + words(x.label).length, 0);
  if (el.type === 'arrow') return el.label ? words(el.label).length : 0;
  return 0;
}
