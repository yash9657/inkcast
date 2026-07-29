/**
 * `<dir>/assets/visuals.json` — the machine-readable half of this stage.
 *
 * The Storyboard IR deliberately has nowhere to put per-element *geometry*
 * (`Asset.svg` is for entities, and the schema is frozen), but the renderer needs
 * measured stroke lengths, draw order, per-line text masks and diagram boxes. So
 * the storyboard keeps carrying only what it always carried — resolved asset
 * paths — and the derived geometry lands in this sidecar, next to the SVGs it
 * describes.
 *
 * Read it with `loadVisualManifest(dir)`; every path inside is
 * project-relative, so a project directory stays portable.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Asset, Element, TextElement } from '@inkcast/core';
import type { DiagramLayout } from './diagram.js';
import type { EquationLayout } from './equation.js';
import type { MotionLayout } from './motion.js';
import type { PlotLayout } from './plot.js';
import type { InkStyleName, Palette } from './style.js';
import type { Box } from './svg.js';
import type { TextLayout } from './text.js';
import type { InkStroke } from './writer.js';

export const MANIFEST_PATH = 'assets/visuals.json';
/** Bumped to 2 when plots, paths and motion joined the record. */
export const MANIFEST_VERSION = 2;

export type VisualSpace = 'canvas' | 'local';
export type ViewBox = [number, number, number, number];
export type RevealStyle = TextElement['enter']['style'];

export type AssetVisual = {
  id: string;
  kind: Asset['kind'];
  /** How this asset was actually resolved, whatever `kind` claimed. */
  lane: 'icon' | 'illustration' | 'diagram' | 'letter' | 'inline';
  /** Project-relative path to the SVG. */
  svg: string;
  space: VisualSpace;
  viewBox: ViewBox;
  strokes: InkStroke[];
  totalLength: number;
  seed: number;
  prompt?: string;
  icon?: { slug: string; how: string };
  /** Project-relative cached raster, when this came through the illustration lane. */
  raster?: string;
};

export type ElementVisual = {
  id: string;
  sceneId: string;
  sceneIndex: number;
  type: Element['type'];
  /** Project-relative path to the element's canvas-space SVG. */
  svg: string;
  space: VisualSpace;
  /** The element's declared box. */
  box: Box;
  /** What the SVG's viewBox covers — content ∪ box, so marks can overhang. */
  viewBox: ViewBox;
  strokes: InkStroke[];
  totalLength: number;
  /** From `enter.style`: how the renderer should bring this in. */
  reveal: RevealStyle;
  enterAt: number;
  enterDuration: number;
  persist: boolean;
  z?: number;
  /** Handwriting blocks, with per-line masks and per-word progress windows. */
  texts?: TextLayout[];
  diagram?: DiagramLayout;
  /**
   * Plot geometry: the frame, the data mapping, one revealable record per axis /
   * curve / overlay with its own `at` fraction and draw-index range, and
   * arc-length-even canvas traces of every curve so something can ride them.
   */
  plot?: PlotLayout;
  /**
   * Typeset mathematics: where it landed, at what em size, and how many marks it came
   * to. The glyph geometry itself is in `strokes`, in reveal order.
   *
   * This is the one layout the renderer *must* read from the sidecar rather than
   * recompute: typesetting is an async import of a large module, and `compilePlan` is
   * synchronous. `tex` travels with it so a renderer that finds no geometry can still
   * put the source on the board instead of nothing.
   */
  equation?: EquationLayout;
  /** The smooth un-roughened path a `path` element describes, for motion to follow. */
  path?: { d: string; length: number; closed: boolean; filled: boolean; from: 'points' | 'd' };
  /** Resolved movement: arc-length-even positions plus centre-relative offsets. */
  motion?: MotionLayout;
  asset?: { id: string; svg: string; flipX: boolean };
  emphasis?: { targetId: string; effect: string; targetBox: Box; resolved: boolean };
};

export type VisualManifest = {
  version: typeof MANIFEST_VERSION;
  generator: string;
  style: {
    name: InkStyleName;
    palette: Palette;
    fingerprint: string;
    paper: string;
    ink: string;
    accent: string;
    secondary: string;
    muted: string;
    highlight: string;
    strokeWidth: number;
    linecap: string;
    linejoin: string;
  };
  font: {
    family: string;
    /** Project-relative copy of the font, so the renderer can @font-face it. */
    file?: string;
    source: 'file' | 'builtin';
    ascent: number;
    descent: number;
    lineGap: number;
  };
  canvas: Box;
  assets: Record<string, AssetVisual>;
  elements: Record<string, ElementVisual>;
};

export function manifestFile(dir: string): string {
  return path.resolve(dir, MANIFEST_PATH);
}

export async function loadVisualManifest(dir: string): Promise<VisualManifest | undefined> {
  try {
    const raw = await readFile(manifestFile(dir), 'utf8');
    const parsed = JSON.parse(raw) as VisualManifest;
    if (parsed.version !== MANIFEST_VERSION) return undefined;
    if (!parsed.assets || !parsed.elements) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export async function saveVisualManifest(dir: string, manifest: VisualManifest): Promise<string> {
  const file = manifestFile(dir);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`);
  return file;
}

export function toViewBox(b: Box): ViewBox {
  return [b.x, b.y, b.w, b.h];
}
