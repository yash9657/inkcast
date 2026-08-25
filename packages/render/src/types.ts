/**
 * The RenderPlan — the internal contract between the Node-side compiler and the
 * browser-side animation runtime.
 *
 * Everything that needs seeded randomness or filesystem access is resolved in
 * Node and baked into this plan, so the page itself is a pure function of time:
 * it builds a DOM once from the plan, then `seek(t)` sets the complete visual
 * state from `t` alone. No clocks, no randomness, no I/O inside the page.
 *
 * Times in the plan are **absolute seconds** — the fractional `enter.at` timings
 * from the Storyboard IR have already been multiplied out against each scene's
 * measured `durationSec`.
 */
import type { GateMode, StageOptions } from '@inkcast/core';

export type Rect = { x: number; y: number; w: number; h: number };

/**
 * The id of a style pack (plan item 7.3) — a string, not a union of four.
 *
 * A plan reaching this file has been through `parseStoryboard`, which rejects an id no
 * pack in `styles/` claims, so the narrowing this union used to provide has moved to the
 * seam where a wrong name can still be reported usefully. Widening it here is what lets a
 * fifth style be a fifth JSON file and no TypeScript at all.
 */
export type StyleName = string;
export type EnterStyle = 'draw' | 'write' | 'fade' | 'pop' | 'grow';

/** A stroked/filled path in canvas coordinates. Revealed with stroke-dashoffset. */
export type GeomPrim = {
  kind: 'geom';
  d: string;
  stroke: string;
  strokeWidth: number;
  /** `'none'` for the usual hand-drawn look; a colour makes it a filled block. */
  fill: string;
  /** Static opacity multiplier, on top of the animated one. */
  opacity?: number;
  /** Force fade-in instead of dash-reveal (used for hachure fills). */
  noDash?: boolean;
};

/**
 * A block of text. Wrapping and per-word metrics are measured **in the page**
 * (after the font loads) because only the browser knows the real advance widths;
 * that measurement is deterministic for a given font + text + width.
 */
export type TextPrim = {
  kind: 'text';
  text: string;
  box: Rect;
  size: number;
  align: 'left' | 'center' | 'right';
  vAlign: 'top' | 'middle';
  color: string;
  /** Allow shrinking the size to fit `box`. Off for diagram labels sized to fit. */
  shrink: boolean;
};

/** A resolved asset SVG, scaled into `box`. Parsed with DOMParser in the page. */
export type SvgPrim = {
  kind: 'svg';
  svg: string;
  box: Rect;
  flipX: boolean;
  /** Resolves `currentColor` inside the asset. */
  stroke: string;
};

export type PlanPrim = GeomPrim | TextPrim | SvgPrim;

/**
 * A baked `Motion`: one offset per output frame, plus how far along the path the
 * element has travelled.
 *
 * Positions are resolved by **arc length** in Node (see `compile.ts`) rather than
 * by waypoint index in the page. Interpolating the index makes an element sprint
 * across long segments and crawl across short ones — a ball descending a curve
 * stutters instead of rolling — and baking the table keeps the browser side a
 * lookup, so there is no second implementation of the maths to drift.
 */
export type MotionTrack = {
  /** Absolute seconds. */
  start: number;
  end: number;
  /** `[dx, dy, u]` per sample: offset from the element's centre, and progress 0–1. */
  samples: [number, number, number][];
};

/**
 * A baked `Morph`: the shape this item has, per output frame, while it is still
 * becoming itself.
 *
 * The interpolated geometry is roughened **here in Node**, with one seed held for
 * the whole morph, for the same reason every other stroke is: the wobble has to be
 * stable frame to frame or the shape boils. Re-roughening per frame in the page
 * would also mean a second implementation of `sketchAlong` to drift out of sync.
 *
 * Baking a `d` string per frame is a few tens of kilobytes for a one-second morph
 * and keeps the page a lookup, which is the same trade `MotionTrack` makes.
 */
export type MorphTrack = {
  /** Absolute seconds. */
  start: number;
  end: number;
  /** One path `d` per frame, from the source's shape to this item's own. */
  frames: string[];
  /** Stroke colour and width for the in-flight shape. */
  stroke: string;
  strokeWidth: number;
  /**
   * Items whose ink this one replaces, faded out across the morph. Matched exactly
   * or by the `id~phase` prefix a multi-phase element produces.
   */
  retire?: string[];
};

export type PlanItem = {
  id: string;
  /** Index of the owning scene. */
  scene: number;
  /** Sort key: explicit `z` first, then declaration order. */
  order: [number, number];
  /** Absolute seconds. */
  start: number;
  dur: number;
  style: EnterStyle;
  persist: boolean;
  /**
   * Absolute end of the owning scene, *including* `Scene.hold`.
   *
   * The fade anchor on an accumulating board, and it was chosen: a non-persistent
   * item stays up through the deliberate silence and only then goes. `fadeAt` below
   * overrides it, and says why that is the wrong anchor when the whole board wipes.
   */
  sceneEnd: number;
  /**
   * Absolute second at which this item's fade **completes**, when it is not
   * `sceneEnd`. Set only on a wiping board (`meta.board: 'wipe'`).
   *
   * The card is finished and static for the whole narration; the fade begins the
   * instant the narration stops and runs 0.2–0.55s, so the rest of `Scene.hold` is a
   * blank board the next card cuts into — the benchmark's blank frame at 41s. Fading
   * at `sceneEnd` instead spends the deliberate pause watching the card die, which
   * reads as a mistake rather than a beat.
   *
   * Undefined when the mode is `accumulate`, and also when the anchor scene's hold
   * is shorter than the fade would be: there is nowhere to put the fade that is not
   * over spoken words, so today's schedule stands. Anchored to the scene named by
   * `persistUntil` where a card outlives its own beat.
   */
  fadeAt?: number;
  /** Transform origin for `pop` / `grow`. */
  center: [number, number];
  prims: PlanPrim[];
  /** Emphasis effects that act on another item rather than drawing anything. */
  pulseTarget?: string;
  dimOthers?: string;
  /** Movement along a path, baked to even speed. */
  motion?: MotionTrack;
  /**
   * Reshaped out of another element instead of drawn from nothing. While this is
   * running the item shows the baked in-flight shape and its own prims are held
   * back — the morph *is* the entry, so there is no dash-reveal on top of it.
   */
  morph?: MorphTrack;
  /**
   * Progress along `motion` at which each prim becomes visible — a dotted trail
   * appearing bead by bead as the element passes it. The item itself does not move.
   */
  trailAt?: number[];
  /**
   * Degrees the item is rotated by at the start of its entry, easing to zero. A
   * tangent swings into the slope it measures instead of blinking on at its final
   * angle, which is the difference between showing a slope and asserting one.
   */
  sweep?: { cx: number; cy: number; deg: number };
  /** Keep the pen sprite off this item (trails are not being hand-drawn). */
  noPen?: boolean;
};

export type PlanScene = {
  id: string;
  start: number;
  /** Narration plus `hold`: how long this scene owns the screen. */
  dur: number;
  /** Measured narration length — what every `enter.at` fraction is relative to. */
  speech: number;
  /** Deliberate silence at the end of the scene, in seconds. */
  hold: number;
  camera: { x: number; y: number; zoom: number; transition: number };
  /** The board this scene draws onto, when it shares one. */
  region?: string;
  role?: 'hook' | 'anchor' | 'step' | 'worked' | 'misconception' | 'recap';
};

export type PenPart = { d: string; fill: string; stroke: string; strokeWidth: number };

/** Pen sprite geometry, defined tip-at-origin pointing "up" (−y), in pen units. */
export type PenArt = {
  parts: PenPart[];
  /** Height of the sprite in its own units, used to normalise its screen size. */
  unit: number;
  /** Degrees added to the tangent rotation so the sprite is "held" naturally. */
  baseAngle: number;
  /** How strongly the sprite follows the stroke tangent (0–1). */
  follow: number;
};

export type RenderPlan = {
  version: 1;
  fps: number;
  /** Total runtime in seconds, including `meta.outroSec`. */
  duration: number;
  frame: { w: number; h: number };
  /** Output shape. 9:16 is composed for a phone, not cropped from 16:9. */
  aspect: '16:9' | '9:16' | '1:1';
  canvas: Rect;
  paper: string;
  ink: string;
  /** Faint board grid colour, or `null` to omit it. */
  grid: string | null;
  gridStep: number;
  style: StyleName;
  fontFamily: string;
  /**
   * Canvas units per output pixel, at the camera's typical framing. Multiply a
   * pixel-quoted constant — stroke widths, the grid step — by this to get canvas
   * units.
   */
  scale: number;
  /** Same conversion for type, with the narrow-frame gain applied. */
  typeScale: number;
  /** Safe margins in output pixels the camera framing keeps clear. */
  safe: { top: number; right: number; bottom: number; left: number };
  /** Fraction of the frame carrying content, per scene. A slideshow shows here. */
  fill: number[];
  /**
   * Gate messages compiled through under `degrade` (board assertions, the fill
   * floor). Absent on a clean board. Part of the plan so an override is inspectable
   * from the artifact itself, and so the render cache key moves when the defects do.
   */
  problems?: string[];
  scenes: PlanScene[];
  items: PlanItem[];
  pen: PenArt;
};

export type RenderOptions = StageOptions & {
  /** Parallel capture workers. Each owns a browser context and an ffmpeg. */
  concurrency?: number;
  /** x264 constant rate factor. 18 is visually lossless for flat ink. */
  crf?: number;
  preset?: string;
  /** Frames on the ffmpeg pipe. PNG is lossless; JPEG is faster. */
  frameFormat?: 'png' | 'jpeg';
  jpegQuality?: number;
  /** Absolute time of the poster frame. Defaults to the end of scene 1. */
  posterAt?: number;
  /** Keep the per-worker segment mp4s in `<dir>/frames` for debugging. */
  keepSegments?: boolean;
  /** Narration track, project-relative or absolute. Default `audio/narration.wav`. */
  audioPath?: string;
  /** Explicit handwriting font file. Overrides the built-in lookup. */
  fontPath?: string;
  /** Draw the faint board grid. Default true. */
  grid?: boolean;
  /** Output file name inside `dir`. Default `out.mp4`. */
  outName?: string;
  /**
   * `strict` promotes this stage's quality warnings to errors: a missing
   * handwriting font and an equation falling back to TeX-as-handwriting stop
   * the render. Absent means `degrade` — today's behaviour; the pipeline
   * threads `strict` by default. See `@inkcast/core`'s `GateMode`.
   */
  gates?: GateMode;
};

export type RenderResult = {
  videoPath: string;
  thumbnailPath: string;
  durationSec: number;
  frames: number;
  /** True when a cached render was reused. */
  cached: boolean;
  /**
   * Gate messages this render carried through under `degrade` — the defects the
   * compiler detected and was told to render anyway. Empty or absent on a clean
   * board. The pipeline records these in `pipeline.json`, which is what makes
   * `--degrade` an override rather than an eraser.
   */
  problems?: string[];
};
