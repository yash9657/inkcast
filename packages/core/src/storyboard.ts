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
  /** Resolved hand-drawn vector content, filled in by the visuals stage. */
  svg: z.string().optional(),
  /** Locked so regeneration stays visually identical. */
  seed: z.number().int().optional(),
  /** Provenance, for cache invalidation and attribution. */
  source: z.enum(['generated', 'builtin', 'user-upload', 'diagram']).optional(),
});

/* ---------------------------------------------------------------- elements */

/** How an element arrives on the board. */
export const Enter = z.object({
  /**
   * When to start, as a fraction of the owning scene's measured narration
   * duration. 0 = scene start, 1 = scene end. Fractions rather than seconds so
   * re-voicing (different language, different TTS, cloned voice) reflows the
   * animation automatically instead of desyncing.
   */
  at: z.number().min(0).max(1).default(0),
  /** Seconds spent animating in. The renderer clamps this to fit the scene. */
  duration: z.number().positive().default(0.8),
  style: z.enum(['draw', 'write', 'fade', 'pop', 'grow']).default('draw'),
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
};

export const TextElement = z.object({
  ...ElementBase,
  type: z.literal('text'),
  text: z.string(),
  /** Visual weight, not a raw font size — the renderer owns the type scale. */
  role: z.enum(['title', 'heading', 'body', 'label', 'caption']).default('body'),
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

export const Element = z.discriminatedUnion('type', [
  TextElement,
  AssetElement,
  ShapeElement,
  ArrowElement,
  DiagramElement,
  EmphasisElement,
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

  /* ---- filled in by the voice stage; do not author by hand ---- */
  /** Measured duration of this scene's synthesised narration, in seconds. */
  durationSec: z.number().positive().optional(),
  /** Path to this scene's audio clip, relative to the project directory. */
  audioPath: z.string().optional(),
  /** Beat-level word timings, when the voice provider supplies them. */
  words: z
    .array(z.object({ word: z.string(), start: z.number(), end: z.number() }))
    .optional(),
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
export type Camera = z.infer<typeof Camera>;
export type StoryboardMeta = z.infer<typeof StoryboardMeta>;
export type TextElement = z.infer<typeof TextElement>;
export type AssetElement = z.infer<typeof AssetElement>;
export type ShapeElement = z.infer<typeof ShapeElement>;
export type ArrowElement = z.infer<typeof ArrowElement>;
export type DiagramElement = z.infer<typeof DiagramElement>;
export type EmphasisElement = z.infer<typeof EmphasisElement>;

/* ------------------------------------------------------------- derivations */

/** Total runtime, once the voice stage has measured every scene. */
export function totalDuration(sb: Storyboard): number {
  const scenes = sb.scenes.reduce((acc, s) => acc + (s.durationSec ?? 0), 0);
  return scenes + sb.meta.outroSec;
}

/** Absolute start time of each scene, in seconds. */
export function sceneOffsets(sb: Storyboard): number[] {
  const offsets: number[] = [];
  let t = 0;
  for (const s of sb.scenes) {
    offsets.push(t);
    t += s.durationSec ?? 0;
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
