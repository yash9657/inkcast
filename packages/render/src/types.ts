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
import type { StageOptions } from '@inkcast/core';

export type Rect = { x: number; y: number; w: number; h: number };

export type StyleName = 'marker' | 'pencil' | 'chalk' | 'ink';
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
  /** Absolute end of the owning scene — when a non-persistent item fades out. */
  sceneEnd: number;
  /** Transform origin for `pop` / `grow`. */
  center: [number, number];
  prims: PlanPrim[];
  /** Emphasis effects that act on another item rather than drawing anything. */
  pulseTarget?: string;
  dimOthers?: string;
};

export type PlanScene = {
  id: string;
  start: number;
  dur: number;
  camera: { x: number; y: number; zoom: number; transition: number };
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
   * pixel-quoted constant — the type scale, stroke widths, the grid step — by
   * this to get canvas units.
   */
  scale: number;
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
};

export type RenderResult = {
  videoPath: string;
  thumbnailPath: string;
  durationSec: number;
  frames: number;
  /** True when a cached render was reused. */
  cached: boolean;
};
