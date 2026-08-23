/**
 * The renderer's style seam: how a pen behaves, what it looks like, and re-exports
 * of the board's colours and type scale.
 *
 * The colour table itself moved to `@inkcast/core` (plan item 2.2) — it was one of
 * two, and the other (visuals') had drifted to a different accent and a different
 * black. One table now serves every package that paints; the renderer re-exports it
 * so this module is still the one place the renderer asks about type and colour.
 */
import type { PenArt, StyleName } from './types.js';

export { paletteFor, toneInk } from '@inkcast/core';
export type { Palette } from '@inkcast/core';

/**
 * How a pen behaves, minus how heavy it is: the stroke *width* multiplier now lives
 * with the rest of the board's scale in `@inkcast/core`, because `boardMetrics` has
 * to produce the same pen weight the renderer draws with. What is left here is what
 * only the sketch engine cares about.
 */
export type InkStyle = {
  /** Random-offset amplitude. Higher = shakier hand. */
  roughness: number;
  /** How much a "straight" line bows. */
  bowing: number;
  /** Strokes per edge. 2 is the classic sketched double stroke. */
  passes: number;
  cap: 'round' | 'butt' | 'square';
  /** Per-stroke opacity — chalk and pencil do not lay down solid ink. */
  opacity: number;
};

const INK: Record<StyleName, InkStyle> = {
  marker: { roughness: 1.1, bowing: 1.0, passes: 2, cap: 'round', opacity: 1 },
  pencil: { roughness: 1.7, bowing: 1.5, passes: 2, cap: 'round', opacity: 0.86 },
  chalk: { roughness: 1.9, bowing: 1.2, passes: 2, cap: 'round', opacity: 0.8 },
  ink: { roughness: 0.75, bowing: 0.8, passes: 1, cap: 'round', opacity: 1 },
};

export function inkStyle(style: StyleName): InkStyle {
  return INK[style];
}

/**
 * The type scale moved to `@inkcast/core` with the camera: it is one of the two
 * numbers the plot lane measures everything else against, so the visuals stage has to
 * be able to read it. Re-exported so this module is still the one place the renderer
 * asks about type and colour.
 */
export { TYPE_SCALE } from '@inkcast/core';
export type { TextRole } from '@inkcast/core';

/* --------------------------------------------------------------------- pen */

/**
 * Pen sprites, drawn tip-at-origin with the body running up the −y axis. The
 * runtime rotates by `baseAngle` (so the barrel trails down-right, as a
 * right-handed hand holds it) plus a fraction of the stroke tangent.
 */
const PENS: Record<StyleName, PenArt> = {
  marker: {
    unit: 132,
    baseAngle: 151,
    follow: 0.45,
    parts: [
      // chisel nib
      { d: 'M -7 0 L 7 -3 L 9 -22 L -9 -22 Z', fill: '#2b3440', stroke: 'none', strokeWidth: 0 },
      // ferrule
      {
        d: 'M -13 -22 L 13 -22 L 13 -32 L -13 -32 Z',
        fill: '#e8e6e1',
        stroke: 'none',
        strokeWidth: 0,
      },
      // barrel
      {
        d: 'M -15 -32 L 15 -32 L 15 -110 Q 15 -120 5 -120 L -5 -120 Q -15 -120 -15 -110 Z',
        fill: '#2f6fed',
        stroke: 'none',
        strokeWidth: 0,
      },
      // barrel highlight
      {
        d: 'M -9 -38 L -5 -38 L -5 -110 L -9 -110 Z',
        fill: 'rgba(255,255,255,0.28)',
        stroke: 'none',
        strokeWidth: 0,
      },
      // end cap
      {
        d: 'M -12 -120 L 12 -120 L 12 -130 Q 12 -132 9 -132 L -9 -132 Q -12 -132 -12 -130 Z',
        fill: '#1b232e',
        stroke: 'none',
        strokeWidth: 0,
      },
    ],
  },
  pencil: {
    unit: 138,
    baseAngle: 149,
    follow: 0.5,
    parts: [
      { d: 'M -3 0 L 3 0 L 5 -12 L -5 -12 Z', fill: '#2b3440', stroke: 'none', strokeWidth: 0 },
      {
        d: 'M -5 -12 L 5 -12 L 12 -34 L -12 -34 Z',
        fill: '#f0dfbf',
        stroke: 'none',
        strokeWidth: 0,
      },
      {
        d: 'M -12 -34 L 12 -34 L 12 -116 L -12 -116 Z',
        fill: '#e0a92b',
        stroke: 'none',
        strokeWidth: 0,
      },
      {
        d: 'M -4 -34 L 0 -34 L 0 -116 L -4 -116 Z',
        fill: 'rgba(255,255,255,0.3)',
        stroke: 'none',
        strokeWidth: 0,
      },
      {
        d: 'M -12 -116 L 12 -116 L 12 -124 L -12 -124 Z',
        fill: '#9aa3ad',
        stroke: 'none',
        strokeWidth: 0,
      },
      {
        d: 'M -11 -124 L 11 -124 L 11 -136 Q 11 -138 8 -138 L -8 -138 Q -11 -138 -11 -136 Z',
        fill: '#d4455f',
        stroke: 'none',
        strokeWidth: 0,
      },
    ],
  },
  chalk: {
    unit: 84,
    baseAngle: 154,
    follow: 0.35,
    parts: [
      {
        d: 'M -10 0 L 10 -2 L 11 -78 Q 11 -82 7 -82 L -7 -82 Q -11 -82 -11 -78 Z',
        fill: '#f7f5f0',
        stroke: '#c9c6bf',
        strokeWidth: 2,
      },
      {
        d: 'M -5 -8 L -1 -8 L -1 -76 L -5 -76 Z',
        fill: 'rgba(255,255,255,0.75)',
        stroke: 'none',
        strokeWidth: 0,
      },
    ],
  },
  ink: {
    unit: 130,
    baseAngle: 148,
    follow: 0.55,
    parts: [
      { d: 'M 0 0 L 6 -20 L -6 -20 Z', fill: '#2b3440', stroke: 'none', strokeWidth: 0 },
      { d: 'M 0 -4 L 0 -18', fill: 'none', stroke: '#fcfbf9', strokeWidth: 1.6 },
      {
        d: 'M -8 -20 L 8 -20 L 10 -40 L -10 -40 Z',
        fill: '#c9a227',
        stroke: 'none',
        strokeWidth: 0,
      },
      {
        d: 'M -11 -40 L 11 -40 L 11 -112 Q 11 -122 0 -124 Q -11 -122 -11 -112 Z',
        fill: '#1b232e',
        stroke: 'none',
        strokeWidth: 0,
      },
      {
        d: 'M -5 -46 L -2 -46 L -2 -112 L -5 -112 Z',
        fill: 'rgba(255,255,255,0.22)',
        stroke: 'none',
        strokeWidth: 0,
      },
      {
        d: 'M -9 -124 L 9 -124 L 7 -130 L -7 -130 Z',
        fill: '#c9a227',
        stroke: 'none',
        strokeWidth: 0,
      },
    ],
  },
};

export function penArt(style: StyleName, accent: string): PenArt {
  const art = PENS[style];
  if (style !== 'marker') return art;
  // The marker barrel picks up the board's accent so the pen belongs to the film.
  return {
    ...art,
    parts: art.parts.map((p) => (p.fill === '#2f6fed' ? { ...p, fill: accent } : p)),
  };
}
