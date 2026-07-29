/**
 * The equation lane — real typeset mathematics, as exact glyph outlines.
 *
 * What this replaces is the reason it exists. Arithmetic used to reach the board as a
 * `text` element: `w ← 3 − 0.1 × 4 = 2.6` set in a handwriting font, which makes the
 * minus sign whatever that font's hyphen happens to be, cannot write a fraction at
 * all, and renders a superscript as a small character sitting on the baseline. That is
 * not a rough-edged charm, it is the notation being wrong, and notation is the one
 * thing on a maths board a learner cannot reinterpret charitably.
 *
 * Four things here are load-bearing.
 *
 * 1. **The typesetter is MathJax, not KaTeX** — a deliberate departure from the plan,
 *    which named KaTeX. KaTeX has no SVG output: it emits `<span>`s positioned by CSS,
 *    so extracting geometry from it means either running a CSS engine or
 *    reimplementing KaTeX's layout rules against its internal DOM tree. MathJax's SVG
 *    output is pure Node, needs no browser and no font files, and hands back glyph
 *    outlines already placed. The plan's *goal* is real glyphs as exact vector; the
 *    engine was a means, and this is the one that reaches the goal without a second
 *    implementation of TeX layout to drift.
 *
 * 2. **The output surface is provably tiny, and asserted to stay that way.** With
 *    `fontCache: 'none'` MathJax emits only `<g>`, `<path>` and `<rect>` inside one
 *    `<svg>`, and only `translate`/`scale` transforms. So this walks the tree
 *    composing matrices rather than parsing SVG, and an unrecognised transform is a
 *    hard warning that drops the mark — never a silently misplaced glyph, because a
 *    misplaced glyph is a *different equation* and the whole point of the lane is that
 *    the notation is trustworthy.
 *
 * 3. **Glyphs are filled outlines, so the reveal is per glyph, not per stroke.** The
 *    marks are emitted in left-to-right order and the page's runtime gives every part
 *    of an item a slice of the timeline proportional to its ink, in order — so
 *    ordering the marks *is* the animation, and the equation writes itself across the
 *    board with no new renderer capability. Each glyph carries a thin stroke as well
 *    as its fill so that slice has an outline to dash-reveal.
 *
 * 4. **`ink: 'crisp'`, for the reason in `PIPELINE.md`:** a wobbled integral sign is a
 *    different integral sign. The paths go through the same `roughenPathData` funnel
 *    as everything else, which at crisp returns them verbatim — so there is one place
 *    that decides how ink is laid down, and this lane is not an exception to it.
 *
 * The engine is imported lazily and its absence is survivable: `resolveEquation`
 * returns `undefined` and the caller falls back to drawing the TeX source as text.
 * MathJax is a large module and a storyboard with no equations must not pay to load
 * it, which is the same trade the visuals stage already makes for font parsing.
 */
import { logger } from '@inkcast/core';
import type { DrawContext, InkPath } from './geometry.js';
import { roughenPathData } from './geometry.js';
import type { InkStyle } from './style.js';
import type { Box, Matrix } from './svg.js';
import { identity, multiply, n, scaleM, transformPath, translateM } from './svg.js';
import type { InkItem } from './writer.js';
import { pathItems } from './writer.js';

const log = logger('visuals:equation');

/** MathJax's internal unit: 1 em is 1000 of them. */
const UNITS_PER_EM = 1000;

export type EquationSpec = {
  /** TeX source, no delimiters. */
  tex: string;
  /** Display style (centred, full-size operators) rather than inline. */
  display: boolean;
  /** The box to fit the typeset result into. */
  box: Box;
  align: 'left' | 'center' | 'right';
};

export type EquationLayout = {
  /** The element's declared box. */
  box: Box;
  /** Where the maths actually landed — narrower than `box` unless it fits exactly. */
  bounds: Box;
  /** Em size the equation was set at, in canvas units. Drives the stroke weight. */
  emSize: number;
  /** Marks in reveal order, one per glyph or rule. */
  marks: number;
  /** The TeX source, recorded so a consumer can show it when geometry is missing. */
  tex: string;
};

export type ResolvedEquation = { items: InkItem[]; layout: EquationLayout };

export type ResolveEquationOptions = {
  style: InkStyle;
  /** Overrides the ink colour; defaults to the style's primary. */
  colour?: string;
  /**
   * Padding inside `box`, in canvas units. Defaults to 2% of the smaller side —
   * enough that a tall glyph does not touch a neighbouring element's box.
   */
  inset?: number;
};

/* ------------------------------------------------------------------- engine */

/**
 * The bits of MathJax this module touches, as structural types.
 *
 * Declared here rather than imported for the same reason `vendor.d.ts` declares
 * roughjs by hand: three methods and a factory is the whole dependency surface, and
 * naming it ourselves keeps a major version of MathJax from reshaping this file. The
 * runtime import is dynamic, so these types are the only compile-time coupling.
 */
type LiteNode = object;
type LiteAdaptor = {
  kind(node: LiteNode): string;
  getAttribute(node: LiteNode, name: string): string | null;
  childNodes(node: LiteNode): LiteNode[];
};
type Engine = {
  adaptor: LiteAdaptor;
  convert(tex: string, display: boolean): LiteNode;
};

/**
 * Loaded once per process, and *not* retried on failure.
 *
 * One MathJax document is reused across conversions: constructing it compiles the TeX
 * package configuration, which is the expensive part, and reuse is the documented
 * pattern. Verified deterministic — converting A, then B, then A again yields
 * byte-identical output for A — which matters because the storyboard is cached on a
 * fingerprint and an equation that drifted between runs would invalidate it forever.
 */
let engineOnce: Promise<Engine | undefined> | undefined;

async function loadEngine(): Promise<Engine | undefined> {
  const { mathjax } = await import('@mathjax/src/js/mathjax.js');
  const { TeX } = await import('@mathjax/src/js/input/tex.js');
  const { SVG } = await import('@mathjax/src/js/output/svg.js');
  const { liteAdaptor } = await import('@mathjax/src/js/adaptors/liteAdaptor.js');
  const { RegisterHTMLHandler } = await import('@mathjax/src/js/handlers/html.js');

  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  // `base` only: it already covers fractions, roots, sub/superscripts, Greek,
  // integrals, sums, `\text`, `\hat`, `\vec` and the standard operators and arrows —
  // everything a lesson equation has ever needed. MathJax 4 requires each further
  // package to be imported to self-register, so adding one is a deliberate act.
  const doc = mathjax.document('', {
    InputJax: new TeX({}),
    // 'none' inlines each glyph as a `<path>` at its own position. The alternative,
    // 'local', emits `<use>` references into a `<defs>` block, which would mean
    // resolving ids by hand for no gain.
    OutputJax: new SVG({ fontCache: 'none' }),
  });
  return {
    adaptor: adaptor as unknown as LiteAdaptor,
    convert: (tex, display) => doc.convert(tex, { display }) as LiteNode,
  };
}

/** Whether the typesetter is available, without committing to a conversion. */
export async function equationEngineReady(): Promise<boolean> {
  return (await engine()) !== undefined;
}

function engine(): Promise<Engine | undefined> {
  engineOnce ??= loadEngine().catch((err: unknown) => {
    log.warn(
      `the equation typesetter could not be loaded (${String(err)}) — ` +
        'equations will be drawn as their TeX source',
    );
    return undefined;
  });
  return engineOnce;
}

/* --------------------------------------------------------------- extraction */

/** `translate(x,y)`, `scale(s)`, `scale(x,y)`, and any of them composed. */
function parseTransform(attr: string | null, where: string): Matrix | undefined {
  if (!attr) return identity;
  let m = identity;
  const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let seen = 0;
  for (const match of attr.matchAll(re)) {
    seen++;
    const op = match[1] as string;
    const args = (match[2] as string)
      .split(/[\s,]+/)
      .filter((s) => s.length > 0)
      .map(Number);
    if (args.some((v) => !Number.isFinite(v))) return undefined;
    if (op === 'translate') {
      const [tx = 0, ty = 0] = args;
      m = multiply(m, translateM(tx, ty));
    } else if (op === 'scale') {
      const [sx, sy] = args;
      if (sx === undefined) return undefined;
      m = multiply(m, scaleM(sx, sy ?? sx));
    } else {
      // Deliberately fatal for this mark. See note 2 in the module header: a
      // transform we do not understand means a glyph in the wrong place, and a
      // wrong equation is worse than a missing one.
      log.warn(`unhandled SVG transform "${op}" in ${where} — dropping that mark`);
      return undefined;
    }
  }
  return seen === 0 ? identity : m;
}

/** A `<rect>` as closed path data — fraction bars, radical rules, `\overline`. */
function rectPath(node: LiteNode, a: LiteAdaptor): string | undefined {
  const num = (name: string): number => Number(a.getAttribute(node, name) ?? 0);
  const x = num('x');
  const y = num('y');
  const w = num('width');
  const h = num('height');
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return undefined;
  return `M${n(x)} ${n(y)} H${n(x + w)} V${n(y + h)} H${n(x)} Z`;
}

function parseViewBox(attr: string | null): Box | undefined {
  if (!attr) return undefined;
  const v = attr
    .split(/[\s,]+/)
    .filter((s) => s.length > 0)
    .map(Number);
  if (v.length !== 4 || v.some((x) => !Number.isFinite(x))) return undefined;
  const [x, y, w, h] = v as [number, number, number, number];
  if (w <= 0 || h <= 0) return undefined;
  return { x, y, w, h };
}

/** Depth-first to the first `<svg>` — MathJax wraps it in an `<mjx-container>`. */
function findSvg(node: LiteNode, a: LiteAdaptor): LiteNode | undefined {
  if (a.kind(node) === 'svg') return node;
  for (const child of a.childNodes(node) ?? []) {
    const found = findSvg(child, a);
    if (found) return found;
  }
  return undefined;
}

type Mark = { d: string; x: number; y: number };

/**
 * Collect every drawable mark, already in canvas coordinates.
 *
 * `into` accumulates rather than returning, because the walk is recursive and the
 * matrix has to travel down with it. `x`/`y` are the mark's own translated origin,
 * kept for ordering — measuring a real bbox per glyph would cost a path parse each
 * and the origin is monotone in the same direction.
 */
function collect(node: LiteNode, a: LiteAdaptor, m: Matrix, into: Mark[]): void {
  const kind = a.kind(node);
  // Text and comment nodes carry no attributes at all, and asking the adaptor for one
  // throws rather than returning null. They turn up in MathJax's error output — a
  // `<title>` explaining the bad TeX — so this is reachable from any typo.
  if (kind.startsWith('#')) return;
  const local = parseTransform(a.getAttribute(node, 'transform'), kind);
  if (!local) return;
  const here = multiply(m, local);

  if (kind === 'path' || kind === 'rect') {
    const raw = kind === 'path' ? a.getAttribute(node, 'd') : rectPath(node, a);
    if (!raw) return;
    const d = transformPath(raw, here);
    if (d) into.push({ d, x: here.e, y: here.f });
    return;
  }
  for (const child of a.childNodes(node) ?? []) collect(child, a, here, into);
}

/* ------------------------------------------------------------------ resolve */

/**
 * Typeset `spec.tex` and resolve it into ordered, revealable glyph geometry.
 *
 * Returns `undefined` when the engine is unavailable or the source produces no
 * marks; the caller is expected to fall back to text rather than to draw nothing.
 */
export async function resolveEquation(
  spec: EquationSpec,
  ctx: DrawContext,
  opts: ResolveEquationOptions,
): Promise<ResolvedEquation | undefined> {
  const tex = spec.tex.trim();
  if (!tex) return undefined;
  const mj = await engine();
  if (!mj) return undefined;

  let root: LiteNode;
  try {
    root = mj.convert(tex, spec.display);
  } catch (err) {
    // A TeX error is the author's problem, not a reason to lose the video.
    log.warn(`could not typeset "${tex}": ${String(err)}`);
    return undefined;
  }
  const svg = findSvg(root, mj.adaptor);
  const viewBox = svg ? parseViewBox(mj.adaptor.getAttribute(svg, 'viewBox')) : undefined;
  if (!svg || !viewBox) {
    log.warn(`typeset "${tex}" but found no usable <svg viewBox> — falling back to text`);
    return undefined;
  }

  // Fit the viewBox into the box, preserving aspect: an equation stretched to fill a
  // wide cell is a different, wrong equation. Vertically always centred; horizontally
  // per `align`, which `fitMatrix` cannot express, so the scale and offsets are taken
  // by hand here rather than fitted and then nudged.
  const inset = opts.inset ?? Math.min(spec.box.w, spec.box.h) * 0.02;
  const availW = Math.max(1e-6, spec.box.w - inset * 2);
  const availH = Math.max(1e-6, spec.box.h - inset * 2);
  const scale = Math.min(availW / viewBox.w, availH / viewBox.h);
  const drawnW = viewBox.w * scale;
  const drawnH = viewBox.h * scale;
  const slack = availW - drawnW;
  const offX = spec.align === 'left' ? 0 : spec.align === 'right' ? slack : slack / 2;
  const originX = spec.box.x + inset + offX;
  const originY = spec.box.y + inset + (availH - drawnH) / 2;
  const fit = multiply(
    translateM(originX - viewBox.x * scale, originY - viewBox.y * scale),
    scaleM(scale),
  );

  const marks: Mark[] = [];
  collect(svg, mj.adaptor, fit, marks);
  if (marks.length === 0) {
    log.warn(`"${tex}" typeset to no drawable marks — falling back to text`);
    return undefined;
  }

  // Left to right, which is the reveal order. Rounded before comparing so that
  // sub-unit float noise cannot reorder two glyphs a reader sees as adjacent, and so
  // stacked marks — a numerator over its denominator — stay grouped at their shared x
  // and come out top-first.
  marks.sort((p, q) => Math.round(p.x) - Math.round(q.x) || Math.round(p.y) - Math.round(q.y));

  const emSize = UNITS_PER_EM * scale;
  const colour = opts.colour ?? opts.style.ink;
  // A glyph is a filled outline. The thin stroke is what the page has to dash-reveal
  // (see note 3) and it also reads as ink laid down rather than type placed; 3% of the
  // em is a marker's touch at this size without closing up a counter.
  const strokeWidth = Math.max(0.4, emSize * 0.03);
  const paths: InkPath[] = [];
  marks.forEach((mark, i) => {
    const drawn = roughenPathData({ ...ctx, ink: 'crisp' }, mark.d, i, {
      stroke: colour,
      strokeWidth,
    });
    for (const p of drawn) {
      paths.push({
        ...p,
        fill: colour,
        // TeX outlines wind their counters against the outer contour, which is what
        // nonzero is for: the hole in an "o" stays a hole.
        fillRule: 'nonzero',
        group: `equation:${i}`,
      });
    }
  });
  if (paths.length === 0) return undefined;

  return {
    items: pathItems(paths),
    layout: {
      box: spec.box,
      bounds: { x: originX, y: originY, w: drawnW, h: drawnH },
      emSize: n(emSize),
      marks: marks.length,
      tex,
    },
  };
}
