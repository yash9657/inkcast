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
import { logger } from '@inkcast/core';
import type {
  ArrowElement,
  AssetElement,
  DiagramElement,
  Element,
  EmphasisElement,
  EquationElement,
  ShapeElement,
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
 * Canvas units per role. Held to `TYPE_SCALE` by `TYPE_RATIO`, not equal to it.
 *
 * ## Why these are not `TYPE_SCALE`, having twice been made equal to it
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
export const FONT: Record<Role, number> = {
  title: 76,
  heading: 50,
  body: 34,
  label: 27,
  caption: 22,
};

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

const LINE_HEIGHT = 1.34;
/**
 * Mean glyph advance as a fraction of the font size, for Latin prose.
 *
 * Measured, not guessed, and it survives the measurement: over the 189 real strings in
 * the six boards above, typeset by the board's own hand at the size it draws them, the
 * per-string mean advance runs p10 0.459, **p50 0.504**, p90 0.596, p99 0.660. So 0.52
 * is an honest mean and this is not where the clipping came from.
 *
 * That matters for `LABEL_SLACK` in `./draw-geom.ts`, which widens a label's measured box
 * by half again on the stated grounds that "the estimate is always the narrow one". It is
 * not always the narrow one — it is the narrow one for a little over half of strings, and
 * the widest string in the corpus is 0.660/0.520 = **1.27x** the estimate, not 1.5x. With
 * the size gap above closed, 1.5 over-reserves every label's width by at least 18% and
 * the median label's by 55%, which the drawing lane pays for in labels shoved out of the
 * picture they name. The re-derived value is 1.27; it cannot be applied here, because
 * `labelFootprint` and the builder in `./drawing.ts` have to reserve the identical box
 * (see the header of `labelFootprint` for what happened the last time they disagreed).
 */
const ADVANCE = 0.52;

export function charWidth(role: Role): number {
  return FONT[role] * ADVANCE;
}

/** Greedy word wrap at a pixel width. Returns the laid-out lines. */
export function wrapText(text: string, role: Role, maxWidth: number): string[] {
  const cw = charWidth(role);
  const maxChars = Math.max(8, Math.floor(maxWidth / cw));
  const out: string[] = [];
  let line = '';
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (!line) {
      line = w;
      continue;
    }
    if (line.length + 1 + w.length <= maxChars) line = `${line} ${w}`;
    else {
      out.push(line);
      line = w;
    }
  }
  if (line) out.push(line);
  return out.length ? out : [''];
}

/** Tight box for a piece of text, wrapped to at most `maxWidth`. */
export function measureText(text: string, role: Role, maxWidth: number): { w: number; h: number } {
  const lines = wrapText(text, role, maxWidth);
  const cw = charWidth(role);
  const widest = lines.reduce((m, l) => Math.max(m, l.length), 0);
  return {
    w: Math.min(maxWidth, Math.max(80, Math.round(widest * cw))),
    h: Math.round(lines.length * FONT[role] * LINE_HEIGHT),
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

/**
 * A typeset equation, sized like a line of text at `role`.
 *
 * The box is *measured* like everything else here, but from the TeX source rather than
 * from the rendered result, which the planner cannot see. Stripping the control
 * sequences first is what makes that estimate honest: `\times` is one glyph, not six,
 * and counting it as six reserves a box twice too wide and pushes the drawing below it
 * off the cell. The visuals stage fits the real typeset geometry into whatever box this
 * reserves, preserving aspect, so an over-generous estimate costs whitespace and an
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
  const m = measureText(texAsGlyphs(tex), role, maxWidth);
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
 * TeX source reduced to roughly the glyphs it will set, for measurement only.
 *
 * Every control sequence becomes one character, braces and alignment marks vanish, and
 * `\frac` collapses to its longer side — a two-line fraction is about as wide as its
 * widest part, not as wide as both concatenated.
 */
function texAsGlyphs(tex: string): string {
  const frac = tex.replace(
    /\\(?:frac|dfrac|tfrac)\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g,
    (_all, a: string, b: string) => (a.length >= b.length ? a : b),
  );
  return frac
    .replace(/\\[a-zA-Z]+/g, 'x')
    .replace(/[{}&\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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
  const longest = nodes.reduce((m, x) => Math.max(m, x.label.length), 4);
  const nodeW = Math.min(420, Math.max(180, longest * 13 + 48));
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
