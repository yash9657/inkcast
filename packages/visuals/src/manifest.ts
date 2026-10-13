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
import type { CodeLayout } from './code.js';
import type { DiagramLayout } from './diagram.js';
import type { EquationLayout } from './equation.js';
import type { MotionLayout } from './motion.js';
import type { PlotLayout } from './plot.js';
import type { InkStyleName, Palette } from './style.js';
import type { Box } from './svg.js';
import type { TextLayout } from './text.js';
import type { InkStroke } from './writer.js';

export const MANIFEST_PATH = 'assets/visuals.json';
/**
 * Bumped to 2 when plots, paths and motion joined the record; to 3 when the three
 * copied timing fields left it (plan item 5.5, audit A-1).
 *
 * The bump is what makes the removal safe rather than merely tidy. `loadVisualManifest`
 * refuses a version it does not know, so every sidecar on disk that still carries
 * `enterAt`/`enterDuration`/`persist` is re-resolved rather than half-read — and nothing
 * downstream has to tolerate both shapes.
 *
 * Bumped to 4 when the code lane landed (plan 6.2). The same reasoning applies in the
 * other direction: a `code` element resolved by an older stage has no `code` layout here,
 * and a renderer that read the sidecar anyway would find strokes with no ink runs to
 * colour them by. Refusing the old version re-resolves it instead.
 */
export const MANIFEST_VERSION = 4;

export type VisualSpace = 'canvas' | 'local';
export type ViewBox = [number, number, number, number];
export type RevealStyle = TextElement['enter']['style'];

export type AssetVisual = {
  id: string;
  kind: Asset['kind'];
  /** How this asset was actually resolved, whatever `kind` claimed. */
  lane: 'library' | 'icon' | 'illustration' | 'figure' | 'diagram' | 'letter' | 'inline';
  /** Project-relative path to the SVG. */
  svg: string;
  space: VisualSpace;
  viewBox: ViewBox;
  strokes: InkStroke[];
  totalLength: number;
  seed: number;
  prompt?: string;
  /**
   * The curated asset drawn, when the library lane won.
   *
   * `version` is the number resolved, not the number asked for — a reference that
   * pinned nothing records what it actually got, which is what lets a re-resolve be
   * a deliberate act rather than a side effect of the library moving on. `how` says
   * whether a path was pinned or a registered noun matched.
   */
  library?: {
    path: string;
    version: number;
    ink: string;
    how: 'path' | 'alias';
    /**
     * For a character rig: which pose was drawn and how it was got.
     *
     * `name` and `requested` differ exactly when a generated pose fell back to a composed
     * one, which is the case worth being able to see from the outside — the character is
     * still the right character, in the wrong posture, and nothing else in the record
     * would say so.
     */
    pose?: { name: string; how: 'composed' | 'cache' | 'generated'; requested: string };
  };
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
  /**
   * From `enter.style`: how the renderer should bring this in.
   *
   * The only timing-adjacent field left here, and it stays for the reason
   * `elementFingerprint` keeps it too: `draw` and `write` resolve to *different
   * geometry* (per-line masks and per-word windows against one stroke order), so it
   * describes what was drawn rather than when.
   *
   * `enterAt`, `enterDuration` and `persist` used to sit beside it and are gone (plan
   * 5.5, audit A-1). They were copies of `Enter.at` / `Enter.duration` / `persist` taken
   * at resolve time, and `visualsFingerprint` deliberately excludes timing — so a
   * re-voiced project kept a sidecar whose numbers no longer matched the storyboard's,
   * and nothing in the repository read any of the three. Duplicated state that nothing
   * reads is the "accepted and unread field" defect this codebase names in `Mark.tone`'s
   * own docs; the storyboard is the authority on when ink arrives and how long it lives,
   * and now it is the only one.
   */
  reveal: RevealStyle;
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
  /**
   * A set listing: the character grid it landed on, the grammar it was tokenised with,
   * and one ink run per (tone, line) as index ranges into `strokes`.
   *
   * Read from the sidecar for both of the reasons equations are. The tokeniser is an
   * async import of a large module and `compilePlan` is synchronous; and the renderer has
   * no letterforms of its own, because the outlines were read out of an sfnt in Node.
   * `code` travels with it so a renderer that finds no geometry can name what is missing.
   */
  code?: CodeLayout;
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
