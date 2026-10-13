/**
 * Ink personality, as this stage draws it.
 *
 * `meta.style` is the single knob that decides whether the board looks like a
 * fat whiteboard marker, a soft pencil, chalk on slate, or a fine liner. It has
 * to change more than the colour: stroke width, roughness, bowing, opacity,
 * multi-stroke behaviour and the handwriting face all move together, otherwise
 * every style looks like the same drawing tinted differently.
 *
 * Since plan item 7.3 the values are not written here. A style is a JSON file in
 * `styles/` (`core/src/stylepack.ts`), and this module is the *adapter*: it turns one
 * pack into the shape rough.js and this lane's own code want. That is what makes a fifth
 * personality a fifth file — the item's done-bar — and it is why the only judgement left
 * in here is naming, not numbers.
 *
 * Numbers are in **canvas units** (the IR's coordinate space, 1920×1080 by
 * default), not output pixels — the camera scales them at render time.
 */
import {
  TYPE_REFERENCE_HEIGHT,
  TYPE_SCALE,
  paletteFor,
  styleKey,
  stylePackFor,
  stylePalette,
} from '@inkcast/core';
import type { LoadedStylePack, StoryboardMeta } from '@inkcast/core';

export type InkStyleName = StoryboardMeta['style'];
export type Palette = StoryboardMeta['palette'];

export type InkStyle = {
  name: InkStyleName;
  palette: Palette;

  /* --- roughjs personality --- */
  roughness: number;
  bowing: number;
  /** Base stroke width for primary geometry, in canvas units. */
  strokeWidth: number;
  /** Multi-stroke (two overlapping passes) reads as a real hand; off = liner. */
  disableMultiStroke: boolean;
  curveFitting: number;
  maxRandomnessOffset: number;
  fillStyle: 'hachure' | 'solid' | 'zigzag' | 'cross-hatch' | 'dots' | 'zigzag-line';
  fillWeight: number;
  hachureAngle: number;
  hachureGap: number;

  /* --- presentation --- */
  strokeOpacity: number;
  linecap: 'round' | 'butt' | 'square';
  linejoin: 'round' | 'miter' | 'bevel';

  /* --- colour ---
   * Read from `@inkcast/core` — the board's table, or the pack's own `palette` block on
   * a colour film that declares one (7.3) — never stated here:
   * this stage's own colour set had drifted to a red accent and an off-by-a-shade
   * black that the film never painted (plan item 2.2). The field names keep this
   * lane's vocabulary; the values are the board's. */
  paper: string;
  ink: string;
  accent: string;
  /** The board palette's `contrast` — the second marker. */
  secondary: string;
  /** The board palette's `inkSoft`. */
  muted: string;
  highlight: string;

  /* --- handwriting --- */
  /** Preferred font family name for on-canvas text. */
  fontFamily: string;
  /** Filename stems to look for in `assets/fonts`, best first. */
  fontFiles: string[];
  /** Extra letter tracking, in em. Marker needs air, liner does not. */
  tracking: number;
  /** Text is filled, not stroked; opacity carries the "pressure". */
  textOpacity: number;
};

type InkPersonality = Omit<
  InkStyle,
  'palette' | 'paper' | 'ink' | 'accent' | 'secondary' | 'muted' | 'highlight'
>;

/**
 * This stage's view of a style pack (plan item 7.3).
 *
 * There was a table of four personalities here until then, and the numbers below are
 * exactly the numbers it held — they live in `styles/*.json` now, so a fifth personality
 * is a fifth file and this file never learns its name. What is left is the *mapping*: the
 * pack's vocabulary (`rough.multiStroke`, `pen.width`) into the one rough.js speaks
 * (`disableMultiStroke`, `strokeWidth`), which is the only reason this function exists
 * rather than the pack being passed around raw.
 *
 * The face still comes with the personality, from the pack's `hand` block, and it is
 * still the same object `handMetricsFor` measures with in `@inkcast/core` — the planner
 * reserving a box and this table lettering into it cannot disagree about which face that
 * is. Colours are not here at all: see `inkStyleFor`.
 */
function personalityOf(pack: LoadedStylePack): InkPersonality {
  return {
    name: pack.id,
    roughness: pack.rough.roughness,
    bowing: pack.rough.bowing,
    strokeWidth: pack.pen.width,
    disableMultiStroke: !pack.rough.multiStroke,
    curveFitting: pack.rough.curveFitting,
    maxRandomnessOffset: pack.rough.maxRandomnessOffset,
    fillStyle: pack.rough.fill.style,
    fillWeight: pack.rough.fill.weight,
    hachureAngle: pack.rough.fill.hachureAngle,
    hachureGap: pack.rough.fill.hachureGap,
    strokeOpacity: pack.rough.strokeOpacity,
    linecap: pack.rough.lineCap,
    linejoin: pack.rough.lineJoin,
    fontFamily: pack.hand.fontFamily,
    fontFiles: pack.hand.fontFiles,
    tracking: pack.hand.tracking,
    textOpacity: pack.hand.textOpacity,
  };
}

/**
 * Build the working ink style for a storyboard's meta block.
 *
 * Personality (stroke, roughness, face) comes from the style pack; colour comes from the
 * one palette table in `@inkcast/core` — or, since 7.3, from the pack's own `palette`
 * block when it declares one and the film is in colour. Either way it is one answer that
 * this stage and the renderer both read, so they can never again disagree about what
 * black, what accent, or what paper the board uses; `packages/pipeline/test/styles.test.ts`
 * holds the two to it. Mono needs no special-casing here: `paletteFor('mono')` is the
 * same mono the film is painted with, and a pack may not override it (see `PackPalette`).
 */
export function inkStyleFor(meta: Pick<StoryboardMeta, 'style' | 'palette'>): InkStyle {
  const pack = stylePackFor(meta.style);
  const pal = stylePalette(meta.style, meta.palette) ?? paletteFor(meta.palette);
  return {
    ...personalityOf(pack),
    palette: meta.palette,
    paper: pal.paper,
    ink: pal.ink,
    accent: pal.accent,
    secondary: pal.contrast,
    muted: pal.inkSoft,
    highlight: pal.highlight,
  };
}

export type InkRole = 'primary' | 'accent' | 'secondary' | 'muted' | 'highlight';

export function inkColour(style: InkStyle, role: InkRole = 'primary'): string {
  switch (role) {
    case 'accent':
      return style.accent;
    case 'secondary':
      return style.secondary;
    case 'muted':
      return style.muted;
    case 'highlight':
      return style.highlight;
    default:
      return style.ink;
  }
}

/**
 * Type scale for the IR's text roles, as a fraction of canvas height — derived from
 * `TYPE_SCALE` in `@inkcast/core` rather than restated here.
 *
 * This was the third of three catalogues of one number (`docs/HANDOFF.md`, defect 0), and
 * being a *fraction* is exactly what let it drift unnoticed: 0.082 of a 1080-tall frame
 * is 88.6, where the renderer draws a title at 96, so the visuals stage lettered every
 * title 8% smaller than the renderer does and nothing compared the two. Deriving it makes
 * that class of drift impossible, and it is not merely deduplication — it is what this
 * function's own contract already says. Sizing type as a fraction of canvas height
 * assumes the whole canvas is on screen (`PlotTypeSizes` in `./plot.ts` says so in as
 * many words), and when the whole canvas is on screen the canvas *is* the frame, so a
 * fraction of canvas height and a size in output pixels are the same statement. The
 * fraction is therefore `TYPE_SCALE[role] / TYPE_REFERENCE_HEIGHT`, and nothing else can
 * be right.
 *
 * It stays the *fallback*. Every caller that knows the camera passes the real sizes in
 * from `boardMetrics` — `resolvePlot`'s `typeSizes`, `resolveOne`'s `board` — because a
 * renderer framing a region of the board shows a fraction of it and the whole-canvas
 * assumption is then false by a factor of up to five. This is what a caller with no
 * camera in hand gets.
 */
function roleFraction(role: TextRole): number {
  return TYPE_SCALE[role] / TYPE_REFERENCE_HEIGHT;
}

export type TextRole = keyof typeof TYPE_SCALE;

export function roleFontSize(role: TextRole, canvasHeight: number): number {
  return Math.max(8, roleFraction(role in TYPE_SCALE ? role : 'body') * canvasHeight);
}

/** Stroke width for a given semantic weight, in canvas units. */
export function strokeWidthFor(
  style: InkStyle,
  weight: 'hairline' | 'light' | 'normal' | 'bold' = 'normal',
): number {
  const w = style.strokeWidth;
  switch (weight) {
    case 'hairline':
      return w * 0.5;
    case 'light':
      return w * 0.72;
    case 'bold':
      return w * 1.35;
    default:
      return w;
  }
}

/**
 * Everything that can change the pixels, folded into one string. Part of every
 * cache key so that switching `meta.style` or the palette invalidates assets,
 * and nothing else does.
 */
export function styleFingerprint(style: InkStyle): string {
  return [
    // The pack's *identity*, not just its name (plan 7.3). A name was a sufficient
    // identity only while the numbers behind it were compiled in; now that a user can
    // edit `styles/marker.json`, a film keyed on the bare name would serve yesterday's
    // ink from the cache after the pack changed under it.
    styleKey(style.name),
    style.palette,
    style.roughness,
    style.bowing,
    style.strokeWidth,
    style.disableMultiStroke,
    style.strokeOpacity,
    style.ink,
    style.accent,
    style.secondary,
    style.muted,
    style.highlight,
    style.fontFamily,
    style.tracking,
  ].join('|');
}
