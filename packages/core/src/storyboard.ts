/**
 * The Storyboard IR — the single contract every stage of Inkcast agrees on.
 *
 * Pipeline:  ingest -> plan -> voice -> visuals -> render
 *
 * Each stage only ever *enriches* the storyboard; none of them reshape it.
 * That is what makes the pipeline resumable, cacheable, and editable: a
 * natural-language edit is just an LLM patching this JSON, and a re-render is
 * a pure function of it.
 *
 * Coordinates live on ONE persistent canvas (see `canvas`), not per-scene
 * slides. Scenes move a camera around that canvas instead of wiping it. This is
 * the core quality differentiator — learners keep their spatial context.
 */
import { z } from 'zod';

/** Canvas units. The camera is what maps these to output pixels. */
export const Point = z.object({ x: z.number(), y: z.number() });

export const Box = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

/* ------------------------------------------------------------------ assets */

/**
 * A pointer into the curated asset library (`assets/library/`).
 *
 * The library is how quality compounds: a drawing we chose is reviewed like code
 * and reused across videos, rather than re-synthesised per project and different
 * every time. This type is what a storyboard carries instead of a bare slug.
 */
export const AssetRef = z.object({
  /** Library path, e.g. `figures/standing` or `symbols/physics/force-vector`. */
  path: z.string(),
  /**
   * Which version of that asset to draw.
   *
   * Optional on the way *in* and pinned on the way *out*: a reference with no
   * version resolves to the newest one the library has, and the visuals stage
   * writes back the number it actually used. So authoring stays easy while a
   * finished storyboard is exact — improving `figures/standing` to v2 leaves every
   * storyboard that already resolved v1 rendering v1, which is the whole point.
   * Versions are files, not manifest entries (`<path>.v<N>.svg`), because a version
   * that is not on disk cannot be pinned.
   */
  version: z.number().int().positive().optional(),
  /** Pose for a character, state for a symbol. Step 5 (`CharacterRig`) reads it. */
  variant: z.string().optional(),
  /**
   * Which ink mode draws it, overriding the library's own declaration.
   *
   * Normally absent: the asset knows its nature better than the caller does — a
   * force vector is `crisp` because an arrow read for direction should not wobble,
   * a figure is `sketch` because that is the whole look — so the manifest states it
   * once and every reference inherits it. This field exists for the case where a
   * board wants the same symbol drawn the other way.
   */
  ink: z.enum(['crisp', 'sketch']).optional(),
});

/**
 * An entity drawn once and reused everywhere it appears.
 *
 * This is deliberately a top-level library rather than an inline property of
 * elements: generating "the rover" a second time is what makes competing tools
 * render a different rover in every scene. Resolve once, reuse by id.
 */
export const Asset = z.object({
  id: z.string().describe('stable slug, e.g. "rover" or "http-request"'),
  kind: z.enum(['illustration', 'icon', 'diagram', 'image']),
  /** Prompt used to synthesise the asset when it has no `svg` yet. */
  prompt: z.string().optional(),
  /**
   * The curated drawing this entity *is*, when there is one.
   *
   * Takes precedence over `prompt`: a reference names a thing we already drew, so
   * there is nothing to synthesise and nothing to match. The visuals stage also
   * fills this in when it recognises an unreferenced entity as a library asset, so
   * a second run resolves by path instead of guessing its way back to the same
   * drawing.
   */
  ref: AssetRef.optional(),
  /** Resolved hand-drawn vector content, filled in by the visuals stage. */
  svg: z.string().optional(),
  /** Locked so regeneration stays visually identical. */
  seed: z.number().int().optional(),
  /** Provenance, for cache invalidation and attribution. */
  source: z.enum(['generated', 'builtin', 'user-upload', 'diagram', 'library']).optional(),
});

/* ---------------------------------------------------------------- elements */

/** How an element arrives on the board. */
export const Enter = z.object({
  /**
   * When to start, as a fraction of the owning scene's measured narration
   * duration. 0 = scene start, 1 = scene end. Fractions rather than seconds so
   * re-voicing (different language, different TTS, cloned voice) reflows the
   * animation automatically instead of desyncing.
   *
   * Prefer `cue` where possible — a fraction is a guess, a cue is an intent.
   */
  at: z.number().min(0).max(1).default(0),
  /**
   * A verbatim phrase from this scene's narration. The voice stage resolves it
   * to a real timestamp and overwrites `at`, so the element lands exactly on the
   * words that introduce it.
   *
   * This exists because beat-level sync is not enough for teaching: audio can be
   * perfectly aligned while a diagram still arrives seconds before the sentence
   * that names it, which a learner experiences as drift. If the phrase cannot be
   * found, the voice stage warns and falls back to `at`.
   */
  cue: z.string().optional(),
  /** Seconds spent animating in. The renderer clamps this to fit the scene. */
  duration: z.number().positive().default(0.8),
  style: z.enum(['draw', 'write', 'fade', 'pop', 'grow']).default('draw'),
});

/**
 * Movement of an already-drawn element along a path.
 *
 * Most of what makes an explanation legible is motion — a ball descending a loss
 * curve teaches more than any caption about it. Timings are fractions of the
 * owning scene, same convention as `Enter`.
 */
export const Motion = z.object({
  /** Waypoints in canvas units. The element's centre follows them. */
  path: z.array(Point).min(2),
  from: z.number().min(0).max(1).default(0),
  to: z.number().min(0).max(1).default(1),
  easing: z.enum(['linear', 'ease', 'ease-in', 'ease-out', 'bounce']).default('ease'),
  /** Leave a dotted trail behind, for showing the route taken. */
  trail: z.boolean().default(false),
});

/**
 * An element that begins as another one already on the board, and becomes itself.
 *
 * This exists for the single most important move in an explanation: the moment an
 * abstraction *arrives out of* the concrete thing the learner already accepted.
 * The hillside you were standing on becomes the loss curve; the axes are drawn
 * around it. Without this the two are separate drawings in separate places, and
 * the claim that they are the same thing is carried entirely by narration — which
 * is exactly the point at which a learner stops following.
 *
 * `fromId` must already be on the board (drawn by this scene or an earlier one and
 * `persist`ed). The renderer interpolates the source's geometry into this
 * element's, holding the hand-drawn wobble steady so it reads as one shape being
 * reshaped rather than a crossfade between two pictures. Both must therefore *have*
 * interpolable geometry: a `path` can morph into a `path` or into a `plot` (whose
 * first curve is the target), and anything else is ignored with a warning.
 */
export const Morph = z.object({
  /** Id of the element this one grows out of. */
  fromId: z.string(),
  from: z.number().min(0).max(1).default(0),
  to: z.number().min(0).max(1).default(0.45),
  easing: z.enum(['linear', 'ease', 'ease-in', 'ease-out']).default('ease'),
  /**
   * Fade the source out as this takes over. Almost always right — leaving it up
   * means the old shape sits under the new one — but a morph that splits one thing
   * into two wants the original kept.
   */
  retire: z.boolean().default(true),
  /**
   * Other elements whose ink this replaces, faded out alongside `fromId`.
   *
   * A drawing is rarely one stroke. The hillside comes with fog across it and a
   * figure standing on it, and those belong to the hill rather than to the graph it
   * becomes: left up, the fog lies across the finished axes and the walker stands in
   * mid-air where the slope used to be. Naming them explicitly rather than inferring
   * them from id prefixes keeps the renderer free of the planner's naming habits.
   */
  retires: z.array(z.string()).default([]),
});

const ElementBase = {
  id: z.string(),
  at: Box,
  enter: Enter.default({}),
  /**
   * Whether the element survives past its own scene.
   *
   * `true` keeps it on the persistent canvas so later scenes can annotate it —
   * this is how you get a 3blue1brown-style build-up rather than a board that
   * wipes every eight seconds.
   */
  persist: z.boolean().default(true),
  /** Optional explicit z-order; defaults to declaration order. */
  z: z.number().int().optional(),
  /** Optional movement along a path, after the element has entered. */
  motion: Motion.optional(),
  /**
   * Optional: enter by being reshaped out of another element rather than by being
   * drawn from nothing. Only meaningful for elements with interpolable geometry.
   */
  morph: Morph.optional(),
};

export const TextElement = z.object({
  ...ElementBase,
  type: z.literal('text'),
  text: z.string(),
  /** Visual weight, not a raw font size — the renderer owns the type scale. */
  role: z.enum(['title', 'heading', 'body', 'label', 'caption']).default('body'),
  align: z.enum(['left', 'center', 'right']).default('left'),
});

/**
 * Real typeset mathematics, as glyph outlines rather than as a line of text.
 *
 * Arithmetic set as text is the defect this replaces. A `text` element carrying
 * `w ← 3 − 0.1 × 4 = 2.6` is a string in a handwriting font: the minus sign is
 * whatever the font's hyphen looks like, a fraction cannot be written at all, and
 * a superscript is a smaller character sitting on the baseline. None of that is a
 * typo the learner forgives — it is the notation being wrong.
 *
 * The `tex` is the source of truth and is typeset by the visuals stage, so the
 * geometry is exact vector and the ink mode is `crisp` (see `PIPELINE.md` — a
 * wobbled integral sign is a different integral sign).
 */
export const EquationElement = z.object({
  ...ElementBase,
  type: z.literal('equation'),
  /**
   * TeX source, without surrounding delimiters: `\frac{a}{b}`, not `$\frac{a}{b}$`.
   *
   * Not validated here. A TeX error is a typesetting outcome rather than a schema
   * violation, and refusing to parse the storyboard over one would lose the whole
   * video for a bad exponent — the visuals stage warns and falls back to drawing
   * the source as text instead.
   */
  tex: z.string(),
  /**
   * `true` sets it as a display equation (centred, full-size operators, limits
   * above and below a sum); `false` sets it inline, sized to sit in running text.
   */
  display: z.boolean().default(true),
  /** Where the equation sits in `at` when it does not fill the box. */
  align: z.enum(['left', 'center', 'right']).default('center'),
});

export const AssetElement = z.object({
  ...ElementBase,
  type: z.literal('asset'),
  assetId: z.string(),
  flipX: z.boolean().default(false),
});

export const ShapeElement = z.object({
  ...ElementBase,
  type: z.literal('shape'),
  shape: z.enum(['rect', 'ellipse', 'line', 'bracket', 'underline', 'circle-highlight']),
  /** Filled shapes read as blocks; hand-drawn work is mostly unfilled. */
  fill: z.boolean().default(false),
});

export const ArrowElement = z.object({
  ...ElementBase,
  type: z.literal('arrow'),
  from: Point,
  to: Point,
  curve: z.number().min(-1).max(1).default(0.2).describe('0 = straight'),
  label: z.string().optional(),
});

/** A laid-out diagram (graph/flow/tree) resolved by the visuals stage. */
export const DiagramElement = z.object({
  ...ElementBase,
  type: z.literal('diagram'),
  layout: z.enum(['flow', 'tree', 'graph', 'sequence', 'stack', 'grid']).default('flow'),
  nodes: z.array(z.object({ id: z.string(), label: z.string() })),
  edges: z
    .array(z.object({ from: z.string(), to: z.string(), label: z.string().optional() }))
    .default([]),
});

/**
 * Emphasis on something already drawn — the "mark up what's on the board"
 * move. Targets another element by id, so it composes with `persist`.
 */
export const EmphasisElement = z.object({
  ...ElementBase,
  type: z.literal('emphasis'),
  targetId: z.string(),
  effect: z.enum(['circle', 'underline', 'arrow-to', 'pulse', 'dim-others']).default('circle'),
});

/* ------------------------------------------------------------------- plots */

/**
 * A curve, defined either as explicit samples or as a named function.
 *
 * Named functions exist so the planner can ask for "a bowl" without emitting a
 * hundred coordinates, and so we never need an expression evaluator (no eval,
 * no injection surface, fully deterministic).
 */
export const Curve = z.object({
  id: z.string(),
  label: z.string().optional(),
  /** Explicit samples in data space. Takes precedence over `fn`. */
  points: z.array(Point).optional(),
  fn: z
    .object({
      name: z.enum([
        'parabola',
        'line',
        'sigmoid',
        'gaussian',
        'sine',
        'exp',
        'log',
        'doubleWell',
        'step',
      ]),
      /** a, b, c … meaning depends on the function; documented in visuals. */
      params: z.array(z.number()).default([]),
    })
    .optional(),
  /** Drawn dashed rather than solid — useful for "what it would have been". */
  dashed: z.boolean().default(false),
  /** Accent colour index; the renderer maps it to the ink palette. */
  accent: z.number().int().min(0).max(5).default(0),
});

/** Things drawn on top of a plot to direct attention. */
export const PlotOverlay = z.discriminatedUnion('kind', [
  /** A marked point on a curve, optionally labelled. */
  z.object({
    kind: z.literal('point'),
    curveId: z.string(),
    x: z.number(),
    label: z.string().optional(),
    at: z.number().min(0).max(1).default(0),
  }),
  /**
   * The tangent at a point — how you show slope, and therefore the entire
   * intuition behind a gradient.
   */
  z.object({
    kind: z.literal('tangent'),
    curveId: z.string(),
    x: z.number(),
    /** Half-length of the drawn tangent, in data-space x units. */
    span: z.number().positive().default(1),
    label: z.string().optional(),
    at: z.number().min(0).max(1).default(0),
  }),
  /** A dropline from a curve point to an axis, for reading off a value. */
  z.object({
    kind: z.literal('dropline'),
    curveId: z.string(),
    x: z.number(),
    to: z.enum(['x', 'y', 'both']).default('x'),
    at: z.number().min(0).max(1).default(0),
  }),
  /** Shade under or between curves. */
  z.object({
    kind: z.literal('shade'),
    curveId: z.string(),
    toCurveId: z.string().optional(),
    fromX: z.number(),
    toX: z.number(),
    at: z.number().min(0).max(1).default(0),
  }),
  /** A free label placed in data space, optionally with a leader line. */
  z.object({
    kind: z.literal('annotate'),
    x: z.number(),
    y: z.number(),
    text: z.string(),
    leaderTo: Point.optional(),
    at: z.number().min(0).max(1).default(0),
  }),
  /** A stepping sequence along a curve — the descent itself. */
  z.object({
    kind: z.literal('steps'),
    curveId: z.string(),
    xs: z.array(z.number()).min(2),
    label: z.string().optional(),
    at: z.number().min(0).max(1).default(0),
  }),
]);

/**
 * A cartesian plot with hand-drawn axes.
 *
 * This is the single most important element for teaching. A loss landscape, a
 * learning-rate comparison, overfitting, compound interest and supply/demand are
 * each one PlotElement. Without it the IR can only caption ideas, not show them.
 */
export const PlotElement = z.object({
  ...ElementBase,
  type: z.literal('plot'),
  /** Data-space domain and range. The renderer maps these into `at`. */
  xDomain: z.tuple([z.number(), z.number()]),
  yDomain: z.tuple([z.number(), z.number()]),
  xLabel: z.string().optional(),
  yLabel: z.string().optional(),
  axes: z.enum(['both', 'x', 'y', 'none']).default('both'),
  grid: z.boolean().default(false),
  /** Show numeric ticks. Off by default — usually noise in an explainer. */
  ticks: z.boolean().default(false),
  curves: z.array(Curve).default([]),
  overlays: z.array(PlotOverlay).default([]),
});

/* -------------------------------------------------------------------- paths */

/**
 * A freeform hand-drawn stroke — the escape hatch for any shape the vocabulary
 * lacks: a hillside, a bowl, a container, a squiggle, a gesture.
 */
export const PathElement = z.object({
  ...ElementBase,
  type: z.literal('path'),
  /** Waypoints in canvas units, smoothed and roughened by the visuals stage. */
  points: z.array(Point).min(2).optional(),
  /** Raw SVG path data, as an alternative to `points`. */
  d: z.string().optional(),
  closed: z.boolean().default(false),
  fill: z.boolean().default(false),
  /** Stroke weight multiplier relative to the ink style's default. */
  weight: z.number().positive().default(1),
});

export const Element = z.discriminatedUnion('type', [
  TextElement,
  EquationElement,
  AssetElement,
  ShapeElement,
  ArrowElement,
  DiagramElement,
  EmphasisElement,
  PlotElement,
  PathElement,
]);

/* ------------------------------------------------------------------ scenes */

export const Camera = z.object({
  /** Centre of the viewport, in canvas units. */
  x: z.number(),
  y: z.number(),
  /** 1 = whole canvas fits the frame; >1 zooms in. */
  zoom: z.number().positive().default(1),
  /** Seconds to ease from the previous scene's camera. 0 = hard cut. */
  transition: z.number().min(0).default(0.9),
});

export const Scene = z.object({
  id: z.string(),
  /** Spoken text for this beat. One idea per scene — keep it short. */
  narration: z.string(),
  camera: Camera,
  elements: z.array(Element).default([]),

  /**
   * Region this scene draws into. Consecutive scenes sharing a region build up
   * one board that the camera frames as a growing union, instead of each scene
   * getting its own patch of canvas — which is what made the MVP read as a
   * slideshow.
   */
  region: z.string().optional(),
  /** The pedagogical job this beat does. Set by the lesson stage. */
  role: z.enum(['hook', 'anchor', 'step', 'worked', 'misconception', 'recap']).optional(),
  /**
   * Seconds of deliberate silence after the narration, holding the visual on
   * screen. A learner needs a breath before the next idea, and a longer pause
   * after a question so they can attempt an answer. Without this every gap is
   * unintended dead air.
   *
   * Derived from `cadence` rather than copied from the lesson — see `Cadence` in
   * `lesson.ts`. The two are set together so they cannot disagree.
   */
  hold: z.number().min(0).default(0),
  /**
   * How this beat is delivered, carried through from the lesson.
   *
   * The voice stage reads it for this scene's speech rate, and `hold` above was
   * derived from it. That is the point: one decision reaches both, so a beat
   * delivered as a quick aside cannot also be followed by a long silence.
   *
   * Optional so a storyboard written before this existed still parses; absent means
   * the voice stage uses its global target rate, which is what every scene got
   * before.
   */
  cadence: z.enum(['slow_deliberate', 'building_energy', 'punchy']).optional(),
  /**
   * Phrases of `narration` that carry this beat's weight, verbatim and already
   * checked to occur in it.
   *
   * Spoken with more room and drawn with more weight. Validated upstream
   * (`resolveEmphasis`), so anything here is known to be findable — a consumer may
   * fail to place it, but not because the phrase was never in the text.
   */
  emphasis: z.array(z.string()).default([]),

  /* ---- filled in by the voice stage; do not author by hand ---- */
  /** Measured duration of this scene's synthesised narration, in seconds. */
  durationSec: z.number().positive().optional(),
  /** Path to this scene's audio clip, relative to the project directory. */
  audioPath: z.string().optional(),
  /** Beat-level word timings, when the voice provider supplies them. */
  words: z.array(z.object({ word: z.string(), start: z.number(), end: z.number() })).optional(),
});

/* -------------------------------------------------------------- storyboard */

export const StoryboardMeta = z.object({
  language: z.string().default('en'),
  aspect: z.enum(['16:9', '9:16', '1:1']).default('16:9'),
  palette: z.enum(['mono', 'color']).default('color'),
  fps: z.number().int().positive().default(30),
  /** Ink personality. `marker` is the default whiteboard look. */
  style: z.enum(['marker', 'pencil', 'chalk', 'ink']).default('marker'),
  voice: z.string().default('af_heart'),
  /** Trailing silence after the last scene, so endings do not feel clipped. */
  outroSec: z.number().min(0).default(1.2),
});

export const Storyboard = z.object({
  version: z.literal(1),
  title: z.string(),
  meta: StoryboardMeta.default({}),
  /**
   * The persistent canvas all coordinates are expressed in. Wider than one
   * frame on purpose — the camera tours it.
   */
  canvas: Box.default({ x: 0, y: 0, w: 1920, h: 1080 }),
  assets: z.array(Asset).default([]),
  scenes: z.array(Scene).min(1),
});

export type Storyboard = z.infer<typeof Storyboard>;
export type Scene = z.infer<typeof Scene>;
export type Element = z.infer<typeof Element>;
export type Asset = z.infer<typeof Asset>;
export type AssetRef = z.infer<typeof AssetRef>;
export type Camera = z.infer<typeof Camera>;
export type StoryboardMeta = z.infer<typeof StoryboardMeta>;
export type TextElement = z.infer<typeof TextElement>;
export type EquationElement = z.infer<typeof EquationElement>;
export type AssetElement = z.infer<typeof AssetElement>;
export type ShapeElement = z.infer<typeof ShapeElement>;
export type ArrowElement = z.infer<typeof ArrowElement>;
export type DiagramElement = z.infer<typeof DiagramElement>;
export type EmphasisElement = z.infer<typeof EmphasisElement>;
export type PlotElement = z.infer<typeof PlotElement>;
export type PathElement = z.infer<typeof PathElement>;
export type Curve = z.infer<typeof Curve>;
export type PlotOverlay = z.infer<typeof PlotOverlay>;
export type Motion = z.infer<typeof Motion>;
export type Morph = z.infer<typeof Morph>;

/* ------------------------------------------------------------- derivations */

/** Wall-clock length of a scene: its narration plus its deliberate silence. */
export function sceneLength(s: Scene): number {
  return (s.durationSec ?? 0) + s.hold;
}

/** Total runtime, once the voice stage has measured every scene. */
export function totalDuration(sb: Storyboard): number {
  const scenes = sb.scenes.reduce((acc, s) => acc + sceneLength(s), 0);
  return scenes + sb.meta.outroSec;
}

/** Absolute start time of each scene, in seconds. */
export function sceneOffsets(sb: Storyboard): number[] {
  const offsets: number[] = [];
  let t = 0;
  for (const s of sb.scenes) {
    offsets.push(t);
    t += sceneLength(s);
  }
  return offsets;
}

/** Output pixel dimensions for an aspect ratio, at 1080p-class quality. */
export function frameSize(aspect: StoryboardMeta['aspect']): { w: number; h: number } {
  switch (aspect) {
    case '9:16':
      return { w: 1080, h: 1920 };
    case '1:1':
      return { w: 1080, h: 1080 };
    default:
      return { w: 1920, h: 1080 };
  }
}

export function parseStoryboard(input: unknown): Storyboard {
  return Storyboard.parse(input);
}
