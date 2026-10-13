/// <reference path="./vendor.d.ts" />
/**
 * The geometry lane: roughjs driven with **no DOM**, converted straight to SVG
 * path `d` strings.
 *
 * The reference on line 1 is load-bearing. `vendor.d.ts` declares
 * `roughjs/bundled/rough.esm.js`, and an ambient declaration only applies to a
 * program that includes the file making it. This package's own
 * `include: ["src"]` picks it up, but `@inkcast/pipeline` imports these sources
 * into a program rooted at *its* `src`, where nothing pulls `vendor.d.ts` in —
 * so roughjs became an untyped `any` there, which `noImplicitAny` rejects. A
 * triple-slash reference travels with the import graph, so both programs agree.
 *
 * Three roughjs facts drive the design of this module (the first two verified in
 * `docs/research/tech-stack.md` §2):
 *
 * 1. `rough.generator()` needs no `document`, and `generator.toPaths()` already
 *    converts opsets to path data — we never walk `sets`/`ops` by hand.
 * 2. The generator **memoises its RNG onto the options object**. Calling a shape
 *    without options poisons `defaultOptions`, after which `seed` stops working
 *    and assets mutate between renders. Every call here therefore goes through
 *    `inkPaths()`, which always passes `{ seed, randomizer: undefined }`.
 * 3. **`seed: 0` means "no seed".** roughjs's `Random.next()` tests `if (this.seed)`
 *    and falls through to `Math.random()` when it is falsy, so zero is the one seed
 *    value that is *not* reproducible. `baseOptions` maps it to 1 for that reason;
 *    see the note there.
 *
 * The two ink modes (`DrawContext.ink`) are the other thing to read before
 * changing anything here — one flag, applied in one place, deciding whether a
 * mark is perturbed at all.
 */
import roughEsm from 'roughjs/bundled/rough.esm.js';
import type {
  Drawable,
  RoughGenerator,
  RoughOptions,
  RoughPoint,
} from 'roughjs/bundled/rough.esm.js';
import { hash } from '@inkcast/core';
import type { InkStyle } from './style.js';
import { strokeWidthFor } from './style.js';
import type { Box, Pt } from './svg.js';
import { boxCentre, clamp, parsePath, pathLength, pathToString } from './svg.js';

/**
 * `roughjs/bundled/rough.esm.js` lives in a package with no `"type": "module"`.
 * Node's module-syntax detection loads it as ESM and hands us the API object
 * directly; a TS loader that treats it as CJS nests the same object under
 * `.default`. Unwrap once here so no call site has to care.
 */
const rough = roughEsm.default ?? roughEsm;

/** One drawable stroke: exactly what the renderer dash-reveals. */
export type InkPath = {
  d: string;
  stroke: string;
  strokeWidth: number;
  fill: string;
  fillRule?: 'nonzero' | 'evenodd';
  opacity: number;
  /** Measured path length, so the renderer never has to guess a dasharray. */
  length: number;
  /** Logical grouping ("node:a", "arrowhead", …) for smarter choreography. */
  group?: string;
};

export type StrokeWeight = 'hairline' | 'light' | 'normal' | 'bold';

/**
 * Which ink draws a mark. A property of the *thing being drawn*, not of the build:
 * both modes coexist in one frame and both reveal the same way, so the difference
 * is the path and never the motion.
 *
 * - **`crisp`** — the geometry is used as computed. Plotted curves, equations,
 *   auto-laid-out edges: anything a learner reads a number or a symbol off, where
 *   the wobble is what makes a minus sign ambiguous and a data point a lie.
 * - **`sketch`** — roughjs perturbs it, which is the whole look. Hillsides,
 *   characters, arrows, containers, annotations: anything read as a feeling.
 *
 * `sketch` is the default, so a lane that has not thought about this keeps the
 * hand it already had.
 */
export type InkMode = 'crisp' | 'sketch';

/** Everything a lane needs to draw one mark. */
export type DrawContext = {
  style: InkStyle;
  gen: RoughGenerator;
  /** Base seed; every mark derives a stable variant from it. */
  seed: number;
  colour?: string;
  weight?: StrokeWeight;
  opacity?: number;
  group?: string;
  /** Perturbed, or exact? Defaults to `sketch`. */
  ink?: InkMode;
};

/** Create a generator carrying the style's personality as its defaults. */
export function createGenerator(style: InkStyle): RoughGenerator {
  return rough.generator({
    options: {
      roughness: style.roughness,
      bowing: style.bowing,
      stroke: style.ink,
      strokeWidth: style.strokeWidth,
      fillStyle: style.fillStyle,
      fillWeight: style.fillWeight,
      hachureAngle: style.hachureAngle,
      hachureGap: style.hachureGap,
      curveFitting: style.curveFitting,
      maxRandomnessOffset: style.maxRandomnessOffset,
      disableMultiStroke: style.disableMultiStroke,
    },
  });
}

/** Deterministic 31-bit seed from any string — stable across processes. */
export function seedFrom(...parts: unknown[]): number {
  return parseInt(hash(...parts).slice(0, 8), 16) % 0x7fffffff;
}

export function ctxFor(
  style: InkStyle,
  seed: number,
  over: Partial<DrawContext> = {},
): DrawContext {
  return { style, gen: createGenerator(style), seed, ...over };
}

/**
 * What `ink: 'crisp'` overrides, and why this list is pinned.
 *
 * **`roughness: 0` is the master switch.** Every displacement roughjs applies goes
 * through `_offset`, which multiplies by `roughness` — so zero alone removes the
 * bowing, the vertex jitter and the curve-fitting slop, and `gen.path(d)` then
 * returns `d` *verbatim* (segment for segment, with a `moveto` inserted per
 * segment). The other flags are already implied by it; they are here to state the
 * intent, so a future crisp-ish mode at nonzero roughness still keeps its vertices.
 *
 * **The seed is pinned**, which is not redundant. Crisp output has no randomness in
 * its *geometry*, but roughjs still draws from its RNG to pick the `divergePoint`
 * parameterising the degenerate cubic it emits for a straight segment. Left on the
 * mark's own seed, two identical crisp axes would differ in their control points
 * while lying on exactly the same line — reproducible, but not comparable. Pinning
 * makes a crisp `d` a pure function of the geometry asked for.
 *
 * That is also why the list must not be edited casually: each zeroed offset still
 * *consumes* an RNG draw, so adding or removing one moves the stream and reshuffles
 * those interior control points. The geometry is unaffected; the bytes are not.
 */
const CRISP: RoughOptions = {
  seed: 1,
  roughness: 0,
  bowing: 0,
  maxRandomnessOffset: 0,
  curveFitting: 1,
  preserveVertices: true,
  // A second pass reads as a real hand when it lands somewhere slightly different.
  // With nothing to displace it, it lands exactly on the first and is just double
  // ink over a line the learner is meant to read a value off.
  disableMultiStroke: true,
  disableMultiStrokeFill: true,
};

function baseOptions(ctx: DrawContext, bump: number, over: RoughOptions = {}): RoughOptions {
  const base: RoughOptions = {
    // Both halves of the reproducibility contract: an explicit seed, and
    // clearing the RNG roughjs would otherwise reuse from a previous call.
    // Zero is the one value that means *unseeded* (see fact 3 in the header), and
    // this expression can land on it, so it is nudged off.
    seed: (ctx.seed + bump * 7919) % 0x7fffffff || 1,
    randomizer: undefined,
    stroke: ctx.colour ?? ctx.style.ink,
    strokeWidth: strokeWidthFor(ctx.style, ctx.weight ?? 'normal'),
    ...over,
  };
  // Last, so that a call site asking for its own roughness — several ask for a
  // fraction of the style's — cannot quietly reintroduce a wobble into a crisp mark.
  return ctx.ink === 'crisp' ? { ...base, ...CRISP } : base;
}

/**
 * Run one roughjs shape and return measured SVG paths.
 *
 * `bump` varies the seed per mark so two rectangles in one element do not share
 * identical wobble, while staying a pure function of the element's seed.
 */
export function inkPaths(
  ctx: DrawContext,
  bump: number,
  fn: (o: RoughOptions) => Drawable,
  over: RoughOptions = {},
): InkPath[] {
  const drawable = fn(baseOptions(ctx, bump, over));
  const opacity = ctx.opacity ?? ctx.style.strokeOpacity;
  const out: InkPath[] = [];
  for (const p of ctx.gen.toPaths(drawable)) {
    if (!p.d) continue;
    // roughjs emits full float precision, which triples the size of every SVG
    // for sub-hundredth-of-a-unit detail nobody can see on a 1920-unit canvas.
    const d = pathToString(parsePath(p.d));
    if (!d) continue;
    out.push({
      d,
      stroke: p.stroke,
      strokeWidth: p.strokeWidth,
      fill: p.fill && p.fill !== 'none' ? p.fill : 'none',
      opacity,
      length: pathLength(d),
      group: ctx.group,
    });
  }
  return out;
}

/**
 * Ink existing path data (icons, vectorised rasters, glyph outlines, traces).
 *
 * ## Why crisp does not go through roughjs at all
 *
 * At `roughness: 0` roughjs reproduces every control point exactly — but it re-emits
 * the result **one subpath per segment**, inserting a `moveto` before each curve and
 * dropping the `Z` that closed the contour. For a stroked line that is invisible: each
 * `moveto` lands on the previous segment's endpoint, so the same pixels are drawn.
 *
 * For a *filled* path it is fatal. A glyph outline arrives as forty independent open
 * curves with no closed contour left to fill, and the letter renders as an outline with
 * a hollow middle — which is exactly how the equation lane first came out. So crisp
 * takes our own round-trip instead, which preserves subpaths and closes and only
 * normalises precision.
 *
 * This is what makes "the path is used verbatim" (`PIPELINE.md`) true rather than
 * nearly true, and it is the same funnel either way — one place still decides how ink
 * is laid down.
 */
export function roughenPathData(
  ctx: DrawContext,
  d: string,
  bump = 0,
  over: RoughOptions = {},
): InkPath[] {
  if (!d.trim()) return [];
  if (ctx.ink === 'crisp') {
    const exact = pathToString(parsePath(d));
    if (!exact) return [];
    const fill = over.fill;
    return [
      {
        d: exact,
        stroke: over.stroke ?? ctx.colour ?? ctx.style.ink,
        strokeWidth: over.strokeWidth ?? strokeWidthFor(ctx.style, ctx.weight ?? 'normal'),
        fill: fill && fill !== 'none' ? fill : 'none',
        opacity: ctx.opacity ?? ctx.style.strokeOpacity,
        length: pathLength(exact),
        ...(ctx.group ? { group: ctx.group } : {}),
      },
    ];
  }
  return inkPaths(ctx, bump, (o) => ctx.gen.path(d, o), over);
}

function fillOptions(ctx: DrawContext, fill: boolean): RoughOptions {
  return fill ? { fill: ctx.colour ?? ctx.style.ink, fillStyle: ctx.style.fillStyle } : {};
}

/* ------------------------------------------------------------------- shapes */

export type ShapeKind = 'rect' | 'ellipse' | 'line' | 'bracket' | 'underline' | 'circle-highlight';

/** A `ShapeElement`, resolved into hand-drawn strokes inside (or around) `box`. */
export function shapePaths(kind: ShapeKind, box: Box, ctx: DrawContext, fill = false): InkPath[] {
  const b = normaliseBox(box);
  switch (kind) {
    case 'rect':
      return inkPaths(
        ctx,
        1,
        (o) => ctx.gen.rectangle(b.x, b.y, b.w, b.h, o),
        fillOptions(ctx, fill),
      );
    case 'ellipse': {
      const c = boxCentre(b);
      return inkPaths(
        ctx,
        2,
        (o) => ctx.gen.ellipse(c.x, c.y, b.w, b.h, o),
        fillOptions(ctx, fill),
      );
    }
    case 'line':
      return linePaths(b, ctx);
    case 'bracket':
      return bracketPaths(b, ctx);
    case 'underline':
      return underlinePaths(b, ctx);
    case 'circle-highlight':
      return circleHighlightPaths(b, ctx);
    default:
      return inkPaths(ctx, 1, (o) => ctx.gen.rectangle(b.x, b.y, b.w, b.h, o));
  }
}

function normaliseBox(box: Box): Box {
  return {
    x: box.w < 0 ? box.x + box.w : box.x,
    y: box.h < 0 ? box.y + box.h : box.y,
    w: Math.max(1, Math.abs(box.w)),
    h: Math.max(1, Math.abs(box.h)),
  };
}

/** Horizontal, vertical or diagonal depending on how the box is shaped. */
function linePaths(b: Box, ctx: DrawContext): InkPath[] {
  const thin = ctx.style.strokeWidth * 2;
  if (b.h <= Math.max(thin, b.w * 0.12)) {
    const y = b.y + b.h / 2;
    return inkPaths(ctx, 3, (o) => ctx.gen.line(b.x, y, b.x + b.w, y, o));
  }
  if (b.w <= Math.max(thin, b.h * 0.12)) {
    const x = b.x + b.w / 2;
    return inkPaths(ctx, 3, (o) => ctx.gen.line(x, b.y, x, b.y + b.h, o));
  }
  return inkPaths(ctx, 3, (o) => ctx.gen.line(b.x, b.y, b.x + b.w, b.y + b.h, o));
}

/**
 * A hand-drawn curly brace grouping the box: vertical on the left for tall
 * boxes, horizontal underneath for wide ones. Two curves meeting at the tip, so
 * the tip stays sharp and each half reveals as one continuous stroke.
 */
function bracketPaths(b: Box, ctx: DrawContext): InkPath[] {
  const vertical = b.h >= b.w;
  if (vertical) {
    const d = clamp(Math.min(b.w, b.h * 0.2), ctx.style.strokeWidth * 3, 56);
    const x = b.x + d;
    const mid = b.y + b.h / 2;
    const upper: RoughPoint[] = [
      [x, b.y],
      [x - d * 0.55, b.y + b.h * 0.09],
      [x - d * 0.6, mid - b.h * 0.1],
      [b.x, mid],
    ];
    const lower: RoughPoint[] = [
      [b.x, mid],
      [x - d * 0.6, mid + b.h * 0.1],
      [x - d * 0.55, b.y + b.h * 0.91],
      [x, b.y + b.h],
    ];
    return [
      ...inkPaths(ctx, 4, (o) => ctx.gen.curve(upper, o)),
      ...inkPaths(ctx, 5, (o) => ctx.gen.curve(lower, o)),
    ];
  }
  const d = clamp(Math.min(b.h, b.w * 0.2), ctx.style.strokeWidth * 3, 56);
  const y = b.y + b.h - d;
  const mid = b.x + b.w / 2;
  const left: RoughPoint[] = [
    [b.x, y],
    [b.x + b.w * 0.09, y + d * 0.55],
    [mid - b.w * 0.1, y + d * 0.6],
    [mid, b.y + b.h],
  ];
  const right: RoughPoint[] = [
    [mid, b.y + b.h],
    [mid + b.w * 0.1, y + d * 0.6],
    [b.x + b.w * 0.91, y + d * 0.55],
    [b.x + b.w, y],
  ];
  return [
    ...inkPaths(ctx, 4, (o) => ctx.gen.curve(left, o)),
    ...inkPaths(ctx, 5, (o) => ctx.gen.curve(right, o)),
  ];
}

/** One confident stroke, plus a lighter second pass for the softer tools. */
function underlinePaths(b: Box, ctx: DrawContext): InkPath[] {
  const y = b.y + b.h;
  const lift = ctx.style.strokeWidth * 0.35;
  const paths = inkPaths(ctx, 6, (o) => ctx.gen.line(b.x, y, b.x + b.w, y - lift, o));
  if (ctx.style.disableMultiStroke) return paths;
  const second = inkPaths(
    ctx,
    7,
    (o) => ctx.gen.line(b.x + b.w * 0.03, y + lift * 1.6, b.x + b.w * 0.98, y + lift, o),
    { strokeWidth: strokeWidthFor(ctx.style, 'light') },
  ).map((p) => ({ ...p, opacity: p.opacity * 0.65 }));
  return [...paths, ...second];
}

/** The "circled it on the board" move — two overlapping loose ellipses. */
function circleHighlightPaths(b: Box, ctx: DrawContext): InkPath[] {
  const c = boxCentre(b);
  const pad = Math.max(ctx.style.strokeWidth * 3, Math.min(b.w, b.h) * 0.14);
  const w = b.w + pad * 2;
  const h = b.h + pad * 2;
  const first = inkPaths(ctx, 8, (o) => ctx.gen.ellipse(c.x, c.y, w, h, o), {
    roughness: ctx.style.roughness * 1.15,
  });
  const second = inkPaths(
    ctx,
    9,
    (o) => ctx.gen.ellipse(c.x + pad * 0.12, c.y - pad * 0.1, w * 1.04, h * 1.06, o),
    { roughness: ctx.style.roughness * 1.3, strokeWidth: strokeWidthFor(ctx.style, 'light') },
  ).map((p) => ({ ...p, opacity: p.opacity * 0.72 }));
  return [...first, ...second];
}

/* ------------------------------------------------------------------- arrows */

/**
 * A curved arrow with a real arrowhead.
 *
 * `curve` is the IR's −1…1 parameter: the shaft bows perpendicular to the
 * chord by `curve × 0.28 × length`, so 0 is straight and the sign picks the
 * side. The head is angled off the *tangent at the tip*, which is what stops
 * curved arrows from looking like they were stapled together.
 */
export function arrowPaths(from: Pt, to: Pt, curve: number, ctx: DrawContext): InkPath[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const bow = clamp(curve, -1, 1) * 0.28 * len;
  const mid: Pt = {
    x: (from.x + to.x) / 2 - (dy / len) * bow,
    y: (from.y + to.y) / 2 + (dx / len) * bow,
  };

  const shaft: RoughPoint[] = [
    [from.x, from.y],
    [mid.x, mid.y],
    [to.x, to.y],
  ];
  const paths = inkPaths(ctx, 10, (o) => ctx.gen.curve(shaft, o));

  // Tangent at the tip: for a 3-point Catmull-Rom the incoming direction is
  // dominated by the previous control point.
  const tx = to.x - mid.x;
  const ty = to.y - mid.y;
  const tl = Math.hypot(tx, ty) || 1;
  const angle = Math.atan2(ty / tl, tx / tl);
  const wing = clamp(len * 0.16, ctx.style.strokeWidth * 3.2, 42);
  const spread = 0.42; // ~24°
  const head: RoughPoint[] = [
    [to.x - wing * Math.cos(angle - spread), to.y - wing * Math.sin(angle - spread)],
    [to.x, to.y],
    [to.x - wing * Math.cos(angle + spread), to.y - wing * Math.sin(angle + spread)],
  ];
  const headPaths = inkPaths(ctx, 11, (o) => ctx.gen.linearPath(head, o), {
    roughness: ctx.style.roughness * 0.8,
  }).map((p) => ({ ...p, group: p.group ?? 'arrowhead' }));
  return [...paths, ...headPaths];
}

/** Point on the arrow's shaft at parameter `t`, for label placement. */
export function arrowMidpoint(from: Pt, to: Pt, curve: number, t = 0.5): Pt {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const bow = clamp(curve, -1, 1) * 0.28 * len;
  const ctrl: Pt = {
    x: (from.x + to.x) / 2 - (dy / len) * bow,
    y: (from.y + to.y) / 2 + (dx / len) * bow,
  };
  const u = 1 - t;
  return {
    x: u * u * from.x + 2 * u * t * ctrl.x + t * t * to.x,
    y: u * u * from.y + 2 * u * t * ctrl.y + t * t * to.y,
  };
}

/** A polyline shaft (diagram edges, which come pre-routed by the layout). */
export function polylineArrowPaths(points: Pt[], ctx: DrawContext): InkPath[] {
  if (points.length < 2) return [];
  const first = points[0] as Pt;
  const last = points[points.length - 1] as Pt;
  const prev = points[points.length - 2] as Pt;
  const pts: RoughPoint[] = points.map((p) => [p.x, p.y]);
  const shaft =
    points.length === 2
      ? inkPaths(ctx, 12, (o) => ctx.gen.line(first.x, first.y, last.x, last.y, o))
      : inkPaths(ctx, 12, (o) => ctx.gen.curve(pts, o));

  const angle = Math.atan2(last.y - prev.y, last.x - prev.x);
  const span = Math.hypot(last.x - first.x, last.y - first.y);
  const wing = clamp(span * 0.16, ctx.style.strokeWidth * 3, 34);
  const spread = 0.42;
  const head: RoughPoint[] = [
    [last.x - wing * Math.cos(angle - spread), last.y - wing * Math.sin(angle - spread)],
    [last.x, last.y],
    [last.x - wing * Math.cos(angle + spread), last.y - wing * Math.sin(angle + spread)],
  ];
  const headPaths = inkPaths(ctx, 13, (o) => ctx.gen.linearPath(head, o), {
    roughness: ctx.style.roughness * 0.8,
  });
  return [...shaft, ...headPaths];
}

/* ----------------------------------------------------------------- emphasis */

export type EmphasisKind = 'circle' | 'underline' | 'arrow-to' | 'pulse' | 'dim-others';

/**
 * Marks that annotate something already on the board. `target` is the box of
 * the element being emphasised; `origin` is where an `arrow-to` should start
 * from (the emphasis element's own box, when the author gave it one).
 */
export function emphasisPaths(
  effect: EmphasisKind,
  target: Box,
  ctx: DrawContext,
  opts: { origin?: Box; canvas?: Box } = {},
): InkPath[] {
  const t = normaliseBox(target);
  switch (effect) {
    case 'underline':
      return underlinePaths({ ...t, y: t.y, h: t.h + ctx.style.strokeWidth * 1.5 }, ctx);
    case 'pulse': {
      const c = boxCentre(t);
      const out: InkPath[] = [];
      const scales = [1.06, 1.2, 1.36];
      scales.forEach((s, i) => {
        const ring = inkPaths(ctx, 20 + i, (o) => ctx.gen.ellipse(c.x, c.y, t.w * s, t.h * s, o), {
          strokeWidth: strokeWidthFor(ctx.style, i === 0 ? 'normal' : 'light'),
        }).map((p) => ({ ...p, opacity: p.opacity * (1 - i * 0.22), group: `pulse:${i}` }));
        out.push(...ring);
      });
      return out;
    }
    case 'arrow-to': {
      const c = boxCentre(t);
      const originBox =
        opts.origin && opts.origin.w > 0 && opts.origin.h > 0
          ? normaliseBox(opts.origin)
          : undefined;
      const oc = originBox ? boxCentre(originBox) : undefined;
      const far = oc && Math.hypot(oc.x - c.x, oc.y - c.y) > Math.max(t.w, t.h) * 0.6;
      const start: Pt =
        far && oc ? oc : { x: t.x - Math.max(120, t.w * 0.5), y: t.y - Math.max(90, t.h * 0.6) };
      // Stop just outside the target so the head does not sit on the artwork.
      const dx = c.x - start.x;
      const dy = c.y - start.y;
      const dl = Math.hypot(dx, dy) || 1;
      const inset = Math.min(Math.max(t.w, t.h) * 0.5, dl * 0.4) + ctx.style.strokeWidth * 2;
      const end: Pt = { x: c.x - (dx / dl) * inset, y: c.y - (dy / dl) * inset };
      return arrowPaths(start, end, 0.22, ctx);
    }
    case 'dim-others': {
      // A scrim over the whole canvas with the target punched out (even-odd).
      const canvas = opts.canvas ?? { x: t.x - 960, y: t.y - 540, w: 1920, h: 1080 };
      const pad = Math.max(ctx.style.strokeWidth * 2, 12);
      const hole = { x: t.x - pad, y: t.y - pad, w: t.w + pad * 2, h: t.h + pad * 2 };
      const d =
        `M${canvas.x} ${canvas.y} H${canvas.x + canvas.w} V${canvas.y + canvas.h} H${canvas.x} Z ` +
        `M${hole.x} ${hole.y} H${hole.x + hole.w} V${hole.y + hole.h} H${hole.x} Z`;
      return [
        {
          d,
          stroke: 'none',
          strokeWidth: 0,
          fill: ctx.style.paper,
          fillRule: 'evenodd',
          opacity: 0.72,
          length: pathLength(d),
          group: 'scrim',
        },
      ];
    }
    default:
      return circleHighlightPaths(t, ctx);
  }
}
