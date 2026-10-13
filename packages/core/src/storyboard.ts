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
import { cueTokens, narrationTokens } from './speech.js';
import { DEFAULT_STYLE, isStyleId, styleIds } from './stylepack.js';

/** Canvas units. The camera is what maps these to output pixels. */
// `.finite()` everywhere and positive extents (plan 2.3): a NaN coordinate or a
// zero-width box is never a design, it is an upstream arithmetic bug — and unchecked
// it survives all the way to a frame that renders wrong with no error naming it.
export const Point = z.object({ x: z.number().finite(), y: z.number().finite() });

export const Box = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().finite().positive(),
  h: z.number().finite().positive(),
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
  /**
   * Which lane draws it.
   *
   * `figure` is the odd one and the important one: a colour teaching picture, kept as a
   * raster and revealed under a swept mask, because tracing it to ink would erase the hues
   * that carry the teaching. Everything else is vectorised and redrawn in the board's own
   * hand. See `docs/PLAN-FIGURE-LANE.md`.
   */
  kind: z.enum(['illustration', 'icon', 'diagram', 'image', 'figure']),
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
  /**
   * How the resolved artwork meets its element's box. Absent means the usual: fit the
   * ink inside the box with a little breathing room, centred.
   *
   * `exact` means the box *is* where this ink goes, to the unit. It exists for the
   * hybrid drawing lane, where a generated picture of a real object carries composed
   * marks naming its parts: the planner sized the box from a trace of this very image,
   * so every leader arrow on the board is aimed at coordinates that only mean anything
   * if the picture lands precisely there. Four percent of breathing room is enough to
   * take an arrow off the structure it names.
   *
   * Optional and never defaulted — a default writes the field onto every asset of every
   * storyboard on disk.
   */
  fit: z.enum(['contain', 'exact']).optional(),
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
  /**
   * Which word of the spoken narration `cue` starts on — PIPELINE.md step 8's
   * `entersAtWord`, shipped as plan item 4.1.
   *
   * An index into `narrationTokens(scene.narration)`: the scene's narration
   * normalised as it will be spoken, then tokenised (`core/src/speech.ts`, the one
   * tokeniser both ends of this contract count with). Written by the compiler,
   * which has the narration in front of it, and read by the voice stage, which has
   * the measured phrases.
   *
   * The docs argued for this shape years before it existed and the argument holds:
   * "a phrase has to be found again by the aligner and can fail to match or match
   * twice; an index cannot". The search it replaces was tolerant by necessity —
   * exact, then a 50% prefix, then an in-order fuzzy window at `MIN_CUE_SCORE`
   * 0.6 — and a tolerant search on a phrase that occurs twice will silently anchor
   * a reveal to the wrong occurrence, with "matched loosely" as the only trace.
   *
   * `cue` stays beside it, and not as decoration: it is what makes a stale index
   * *detectable*. The voice stage checks that the word at this index is still the
   * word the cue starts with, so narration edited without recompiling is named
   * rather than silently mis-anchored. Absent means an older storyboard, which the
   * phrase search still resolves for one release.
   */
  cueWord: z.number().int().min(0).optional(),
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

/**
 * Which ink draws an element, named by what it is *for*.
 *
 * The board's rule has always been one ink for structure and one accent to mark things
 * up, and the reason is worth keeping in view: a hue per scene, or per element, is how a
 * whiteboard turns into a rainbow that carries no information at all. This does not
 * relax that rule — it is four names, closed, and every one of them has to earn its use
 * by telling two things apart that the learner would otherwise confuse.
 *
 * The case it exists for is the one a single ink genuinely cannot draw. In a beat where
 * an electron loops one way round a circuit while a lithium ion crosses the other way,
 * both paths are lines, both cross the same gap, and in one colour they are a tangle —
 * the picture is *there* and it does not teach, because the whole idea is that these two
 * things go different ways. That is not decoration; it is the distinction the beat is
 * about, and there is no arrangement of one ink that makes it.
 *
 * - `ink` — the default, and what almost everything is. Structure: containers, parts,
 *   outlines, the drawing itself.
 * - `accent` — the one thing this beat is about. What moves, what changes, what the
 *   narration is pointing at.
 * - `contrast` — the thing that must not be confused with the accent, and only that.
 *   The second path, the opposing charge, the "before" against the "after".
 * - `muted` — context that has already been explained and is now scaffolding, so the
 *   eye goes past it to what is new.
 *
 * The renderer maps these onto the board's palette; nothing upstream names a colour.
 */
export const Tone = z.enum(['ink', 'accent', 'contrast', 'muted']);
export type Tone = z.infer<typeof Tone>;

const ElementBase = {
  id: z.string(),
  at: Box,
  enter: Enter.default({}),
  /**
   * Which ink draws this. Absent is the structural ink.
   *
   * Optional rather than defaulted, and that is load-bearing: a default would write
   * `"tone":"ink"` onto every element of every storyboard on disk, which changes the
   * compiled bytes of two lessons that are pinned to compile identically and every
   * hash any tool takes of them — a schema change masquerading as a content change.
   * Absent means absent, and the renderer reads it as the ink it always used.
   */
  tone: Tone.optional(),
  /**
   * Whether the element survives past its own scene.
   *
   * `true` keeps it on the persistent canvas so later scenes can annotate it —
   * this is how you get a 3blue1brown-style build-up rather than a board that
   * wipes every eight seconds.
   */
  persist: z.boolean().default(true),
  /**
   * Id of the last scene this element is still on the board for.
   *
   * Only meaningful with `persist: false`, and only on a wiping board: it is how one
   * card outlives its own scene without living forever. A cell can be drawn across
   * several beats — the hillside the anchor walks down, the plot the bridge beat
   * grows out of it — and `morph.fromId` reshapes ink drawn two scenes earlier. A
   * blanket `persist: false` fades that ink at its own scene's end and the morph
   * bends a shape whose alpha is already zero, silently. So the beats sharing a cell
   * name the last of them here and go out together.
   *
   * Optional and never defaulted, for the reason `tone` above is: a default would
   * write a key onto every element of every storyboard on disk.
   */
  persistUntil: z.string().optional(),
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

/**
 * A source listing, set in monospace and syntax-highlighted (plan item 6.2).
 *
 * Same defect, same remedy, one lane over from `equation`. Code used to reach the board
 * as a `text` element: a listing lettered in a handwriting face, wrapped at proportional
 * advances. That loses the two things a listing *is*. Indentation carries the block
 * structure of the program, and proportional widths destroy it — a `for` body and the
 * line after it stop being distinguishable. And nothing marks which words are the
 * language and which are the author's, so a reader has to parse a picture of code with
 * none of the help every editor they have ever used gives them.
 *
 * The `code` is the source of truth. The visuals stage tokenises it, sets it on a
 * character grid in the vendored monospace face and emits every glyph as an exact
 * outline, so the ink mode is `crisp` — for the reason the equation lane gives, twice
 * over: a wobbled `l` is a `1`.
 */
export const CodeElement = z.object({
  ...ElementBase,
  type: z.literal('code'),
  /**
   * The listing itself, newline-separated, exactly as it should appear.
   *
   * Not wrapped and never re-indented: what the author wrote is what is set, because
   * re-flowing code changes what it means. A line too long for the box shrinks the whole
   * block rather than breaking, so the geometry stays a faithful quotation — see
   * `resolveCode`.
   */
  code: z.string(),
  /**
   * The language, as a Shiki grammar id (`python`, `typescript`, `sql`, …).
   *
   * `text` is the honest answer when the language is unknown, and it is the default: an
   * unhighlighted listing in the right face with the right indentation is already most
   * of the value, while highlighting a snippet as the wrong language marks the wrong
   * words and is worse than not marking any. A grammar this build does not carry falls
   * back to `text` with a warning rather than failing the render.
   */
  lang: z.string().default('text'),
  /** Where the block sits in `at` when the fitted grid is narrower than the box. */
  align: z.enum(['left', 'center', 'right']).default('left'),
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
  CodeElement,
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

/**
 * What the board does between beats.
 *
 * `accumulate` is the whiteboard this repo was built as: nothing is wiped, beats
 * share regions, and the camera pulls back over the finished board at the recap.
 * `wipe` is one idea, one card — every beat draws into the same frame-shaped cell
 * and its ink goes out when the narration stops, so the subject owns the frame
 * instead of being one tile of eleven. Measured on `projects/cardiac8f`: mean ink
 * 5.7% of pixels against the benchmark's 14.4%, with the renderer itself warning
 * "mean content fill 25% of frame — the board is mostly whitespace".
 *
 * A mode rather than a new default, because the two shipped lessons are pinned to
 * compile byte-identically and they are the only proof a presentation change did
 * not silently rewrite every existing video.
 */
export const BoardMode = z.enum(['accumulate', 'wipe']);
export type BoardMode = z.infer<typeof BoardMode>;

export const StoryboardMeta = z.object({
  language: z.string().default('en'),
  aspect: z.enum(['16:9', '9:16', '1:1']).default('16:9'),
  palette: z.enum(['mono', 'color']).default('color'),
  fps: z.number().int().positive().default(30),
  /**
   * Ink personality — the id of a style pack (plan item 7.3).
   *
   * A string checked against `styles/` rather than a four-name union, because a style is
   * a JSON file now and a fifth one must not need a schema edit. The check is still a
   * *rejection*: an unknown id fails to parse here, at the seam, rather than reaching a
   * stage that would fall back to the marker and draw the film in the wrong hand.
   */
  style: z
    .string()
    .refine(isStyleId, (v) => ({
      message: `unknown ink style "${v}" — this tree has ${styleIds().join(', ')} (a style is a JSON file in styles/)`,
    }))
    .default(DEFAULT_STYLE),
  voice: z.string().default('af_heart'),
  /** Trailing silence after the last scene, so endings do not feel clipped. */
  outroSec: z.number().min(0).default(1.2),
  /**
   * What the board does between beats. Absent *is* `accumulate`, everywhere.
   *
   * Optional and never `.default('accumulate')`, and this one is not a style
   * preference: `cast.ts` runs the compiler's output back through
   * `parseStoryboard`, so a zod default would write `"board":"accumulate"` into
   * every project's `storyboard.json` on disk, move `renderFingerprint` — which
   * hashes the whole storyboard — and invalidate every cached render. `sbhash`
   * hashes `compileLesson()` *before* that reparse, so it would report the pinned
   * lessons byte-identical while every project moved.
   */
  board: BoardMode.optional(),
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
export type CodeElement = z.infer<typeof CodeElement>;
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

/* --------------------------------------------------------------- the critique */

/**
 * Structural critique of a storyboard — `critiqueLesson`'s missing sibling
 * (audit S3-c, plan item 3.2).
 *
 * The lesson graph has been checked since the lesson stage existed: a
 * `derivedFrom` naming no beat, a character who is not in the cast, an emphasis
 * phrase the narration does not contain. The *board* graph had no equivalent, and
 * it carries just as many references — `morph.fromId`, `emphasis.targetId`,
 * `assetId`, `persistUntil`, a plot overlay's `curveId`, a diagram edge's node
 * ids, and every `enter.cue` that has to be findable in the words it is cued to.
 * Each of those, when it dangles, is silent: the renderer skips a morph whose
 * source it cannot find, draws an emphasis around nothing, resolves an asset
 * element to no artwork, and falls back from a cue to a guessed fraction. The
 * board still renders, and what it renders is missing the move the beat was about.
 *
 * Everything here is a *dangling reference or a duplicate id* — facts, not taste.
 * There is no "too many elements" or "this camera is too wide" in this function:
 * those are judgements, they live in the gate stage as advisories, and mixing them
 * in is how a structural check becomes unenforceable. Two rules keep it that way:
 *
 *  - **Nothing may forward-reference.** A morph grows out of ink already on the
 *    board and an emphasis marks up something already drawn, so both have to name
 *    an element from this scene or an earlier one. This is the same rule
 *    `critiqueLesson` applies to `derivedFrom`, for the same reason.
 *  - **On a wiping board, "on the board" is a window, not for ever.** A reference
 *    to ink whose `persistUntil` has passed is exactly as dangling as one to an
 *    element that was never drawn — it names a shape whose alpha is already zero.
 *    That is the failure `persistUntil`'s own documentation warns about, and this
 *    is where it is caught.
 *
 * Returns human-readable problems; empty means it passes.
 */
export function critiqueStoryboard(sb: Storyboard): string[] {
  const problems: string[] = [];
  const sceneIndex = new Map<string, number>();
  sb.scenes.forEach((s, i) => {
    if (sceneIndex.has(s.id)) {
      problems.push(`two scenes share the id "${s.id}" — every reference to it is ambiguous`);
      return;
    }
    sceneIndex.set(s.id, i);
  });

  const assetIds = new Set(sb.assets.map((a) => a.id));
  const wipes = sb.meta.board === 'wipe';

  /** Where each element was drawn, and the last scene index it is still ink. */
  type Life = { scene: number; until: number };
  const life = new Map<string, Life>();
  sb.scenes.forEach((scene, i) => {
    for (const el of scene.elements) {
      if (life.has(el.id)) {
        problems.push(
          `two elements share the id "${el.id}" (scene ${scene.id} and scene ` +
            `${sb.scenes[life.get(el.id)!.scene]?.id ?? '?'}) — the board keys geometry by ` +
            'id, so one of them silently replaces the other',
        );
        continue;
      }
      // Persistence, read the way `heldBounds` and the renderer read it: an
      // accumulating board never wipes, so `persist` means for ever; a wiping board
      // honours `persistUntil` and otherwise ends the ink with its own scene.
      const until = el.persist
        ? sb.scenes.length - 1
        : wipes && el.persistUntil !== undefined
          ? (sceneIndex.get(el.persistUntil) ?? i)
          : i;
      life.set(el.id, { scene: i, until });
    }
  });

  /** A reference to ink: does it exist, was it drawn yet, is it still there. */
  const inkAt = (id: string, at: number, what: string, where: string): void => {
    const found = life.get(id);
    if (!found) {
      problems.push(`${where} ${what} "${id}", which is not an element on this board`);
      return;
    }
    if (found.scene > at) {
      problems.push(
        `${where} ${what} "${id}", which is not drawn until scene ` +
          `${sb.scenes[found.scene]?.id ?? found.scene} — nothing may forward-reference`,
      );
      return;
    }
    if (found.until < at) {
      problems.push(
        `${where} ${what} "${id}", whose ink left the board after scene ` +
          `${sb.scenes[found.until]?.id ?? found.until} — the reference is to a shape that is ` +
          'no longer there',
      );
    }
  };

  sb.scenes.forEach((scene, i) => {
    const where = `scene ${scene.id}`;
    for (const el of scene.elements) {
      const at = `${where}: "${el.id}"`;
      if (el.enter.cue !== undefined) {
        const cue = el.enter.cue.trim().toLowerCase();
        if (cue && !scene.narration.toLowerCase().includes(cue)) {
          problems.push(
            `${at} is cued to "${el.enter.cue}", which is not in its scene's narration — ` +
              'the cue cannot be placed on a word and the reveal falls back to a guess',
          );
        }
      }
      // A cue index that no longer names its own cue's first word. Caught here
      // because here is the cheapest place it can be: the alternative is finding
      // out from the voice stage, a minute of synthesis later, on a run that has
      // already spent money. The usual cause is narration edited without
      // recompiling — `set-narration` re-derives for exactly this reason.
      if (el.enter.cueWord !== undefined) {
        const words = narrationTokens(scene.narration);
        const first = cueTokens(el.enter.cue ?? '')[0];
        const found = words[el.enter.cueWord];
        if (found === undefined) {
          problems.push(
            `${at} is cued at word ${el.enter.cueWord}, but its narration has only ` +
              `${words.length} spoken word${words.length === 1 ? '' : 's'} — the index and the ` +
              'narration were written by different versions of this scene',
          );
        } else if (first !== undefined && found !== first) {
          problems.push(
            `${at} is cued at word ${el.enter.cueWord}, which is "${found}", but its cue ` +
              `"${el.enter.cue}" starts on "${first}" — the narration changed after it was compiled`,
          );
        }
      }
      if (el.persistUntil !== undefined) {
        if (!sceneIndex.has(el.persistUntil)) {
          problems.push(`${at} persists until scene "${el.persistUntil}", which does not exist`);
        } else if ((sceneIndex.get(el.persistUntil) as number) < i) {
          problems.push(
            `${at} persists until scene "${el.persistUntil}", which comes before the scene that ` +
              'draws it — the ink is asked to leave before it arrives',
          );
        } else if (el.persist) {
          problems.push(
            `${at} is persistent and also names persistUntil "${el.persistUntil}" — one of the ` +
              'two is a mistake, and the renderer believes `persist`',
          );
        }
      }
      if (el.morph) {
        inkAt(el.morph.fromId, i, 'morphs out of', at);
        for (const retired of el.morph.retires) inkAt(retired, i, 'retires', at);
      }
      switch (el.type) {
        case 'emphasis':
          inkAt(el.targetId, i, 'emphasises', at);
          break;
        case 'asset':
          if (!assetIds.has(el.assetId)) {
            problems.push(
              `${at} draws asset "${el.assetId}", which this storyboard does not declare — ` +
                'the visuals stage has nothing to resolve and the element draws nothing',
            );
          }
          break;
        case 'diagram': {
          const nodes = new Set(el.nodes.map((n) => n.id));
          for (const edge of el.edges) {
            for (const end of [edge.from, edge.to]) {
              if (!nodes.has(end)) {
                problems.push(
                  `${at} has an edge to node "${end}", which the diagram has no node for`,
                );
              }
            }
          }
          break;
        }
        case 'plot': {
          const curves = new Set(el.curves.map((c) => c.id));
          for (const overlay of el.overlays) {
            if (overlay.kind === 'annotate') continue;
            if (!curves.has(overlay.curveId)) {
              problems.push(
                `${at} has a ${overlay.kind} overlay on curve "${overlay.curveId}", which this ` +
                  'plot does not draw',
              );
            }
            if (overlay.kind === 'shade' && overlay.toCurveId && !curves.has(overlay.toCurveId)) {
              problems.push(
                `${at} shades to curve "${overlay.toCurveId}", which this plot does not draw`,
              );
            }
          }
          break;
        }
        default:
          break;
      }
    }
  });

  return problems;
}
