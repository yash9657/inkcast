/**
 * Ink personality.
 *
 * `meta.style` is the single knob that decides whether the board looks like a
 * fat whiteboard marker, a soft pencil, chalk on slate, or a fine liner. It has
 * to change more than the colour: stroke width, roughness, bowing, opacity,
 * multi-stroke behaviour and the handwriting face all move together, otherwise
 * every style looks like the same drawing tinted differently.
 *
 * Numbers are in **canvas units** (the IR's coordinate space, 1920×1080 by
 * default), not output pixels — the camera scales them at render time.
 */
import { HAND_FONTS, TYPE_REFERENCE_HEIGHT, TYPE_SCALE } from '@inkcast/core';
import type { StoryboardMeta } from '@inkcast/core';

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

  /* --- colour --- */
  paper: string;
  ink: string;
  accent: string;
  secondary: string;
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

/**
 * Font mapping is from `docs/research/design-stack.md` §3, which assigns one
 * OFL handwriting face per ink style. The assignment itself (family, filename
 * stems, tracking) lives in `HAND_FONTS` in `@inkcast/core`, next to the metrics
 * stack that measures with it — spread in here rather than restated, so the
 * planner reserving a box and this table lettering into it can never disagree
 * about which face that is.
 */
const STYLES: Record<InkStyleName, Omit<InkStyle, 'palette'>> = {
  marker: {
    name: 'marker',
    roughness: 1.15,
    bowing: 1.1,
    strokeWidth: 4.4,
    disableMultiStroke: false,
    curveFitting: 0.96,
    maxRandomnessOffset: 2.2,
    fillStyle: 'hachure',
    fillWeight: 2.4,
    hachureAngle: -41,
    hachureGap: 9,
    strokeOpacity: 0.94,
    linecap: 'round',
    linejoin: 'round',
    paper: '#fdfdfb',
    ink: '#1c1f26',
    accent: '#d7263d',
    secondary: '#1b6ca8',
    muted: '#7b8494',
    highlight: '#f5c445',
    ...HAND_FONTS.marker,
    textOpacity: 0.96,
  },
  pencil: {
    roughness: 1.9,
    name: 'pencil',
    bowing: 1.7,
    strokeWidth: 2.5,
    disableMultiStroke: false,
    curveFitting: 0.9,
    maxRandomnessOffset: 2.8,
    fillStyle: 'hachure',
    fillWeight: 1.2,
    hachureAngle: -49,
    hachureGap: 6,
    strokeOpacity: 0.74,
    linecap: 'round',
    linejoin: 'round',
    paper: '#fbfaf6',
    ink: '#3d434f',
    accent: '#a8503f',
    secondary: '#4f6d7a',
    muted: '#98a0ac',
    highlight: '#cbb994',
    ...HAND_FONTS.pencil,
    textOpacity: 0.82,
  },
  chalk: {
    name: 'chalk',
    roughness: 2.3,
    bowing: 1.9,
    strokeWidth: 4.0,
    disableMultiStroke: false,
    curveFitting: 0.88,
    maxRandomnessOffset: 3.2,
    fillStyle: 'cross-hatch',
    fillWeight: 1.8,
    hachureAngle: -35,
    hachureGap: 12,
    strokeOpacity: 0.86,
    linecap: 'round',
    linejoin: 'round',
    paper: '#1f2a30',
    ink: '#f2f5f3',
    accent: '#ffd166',
    secondary: '#8ecae6',
    muted: '#a3b4bb',
    highlight: '#ef8354',
    ...HAND_FONTS.chalk,
    textOpacity: 0.9,
  },
  ink: {
    name: 'ink',
    roughness: 0.72,
    bowing: 0.55,
    strokeWidth: 2.9,
    disableMultiStroke: true,
    curveFitting: 0.98,
    maxRandomnessOffset: 1.2,
    fillStyle: 'zigzag',
    fillWeight: 1.6,
    hachureAngle: -45,
    hachureGap: 7,
    strokeOpacity: 1,
    linecap: 'round',
    linejoin: 'round',
    paper: '#fffef8',
    ink: '#111820',
    accent: '#bf1b26',
    secondary: '#00606f',
    muted: '#5f6b73',
    highlight: '#e8b419',
    ...HAND_FONTS.ink,
    textOpacity: 1,
  },
};

/** Build the working ink style for a storyboard's meta block. */
export function inkStyleFor(meta: Pick<StoryboardMeta, 'style' | 'palette'>): InkStyle {
  const base = STYLES[meta.style] ?? STYLES.marker;
  const style: InkStyle = { ...base, palette: meta.palette };
  if (meta.palette === 'mono') {
    // Mono is not "grey everything" — it keeps one ink and leans on the muted
    // tone for secondary marks so hierarchy survives.
    style.accent = base.ink;
    style.secondary = base.ink;
    style.highlight = base.muted;
  }
  return style;
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
    style.name,
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
