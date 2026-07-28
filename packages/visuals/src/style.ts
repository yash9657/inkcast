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
 * OFL handwriting face per ink style. Filenames are matched loosely (the
 * variable fonts ship as e.g. `Caveat[wght].ttf`).
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
    fontFamily: 'Shantell Sans',
    fontFiles: ['shantellsans', 'shantell-sans', 'shantell'],
    tracking: 0.012,
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
    fontFamily: 'Caveat',
    fontFiles: ['caveat'],
    tracking: 0.006,
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
    fontFamily: 'Gaegu',
    fontFiles: ['gaegu'],
    tracking: 0.02,
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
    fontFamily: 'Patrick Hand',
    fontFiles: ['patrickhand', 'patrick-hand', 'patrick'],
    tracking: 0.004,
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
 * Type scale for the IR's text roles, as a fraction of canvas height.
 *
 * The renderer owns pixels; we own canvas units. A title at 0.082 of a
 * 1080-unit canvas is ~88 units, which reads as a confident hand-lettered
 * headline at 1080p.
 */
const ROLE_SCALE = {
  title: 0.082,
  heading: 0.058,
  body: 0.04,
  label: 0.03,
  caption: 0.024,
} as const;

export type TextRole = keyof typeof ROLE_SCALE;

export function roleFontSize(role: TextRole, canvasHeight: number): number {
  return Math.max(8, (ROLE_SCALE[role] ?? ROLE_SCALE.body) * canvasHeight);
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
