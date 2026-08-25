/**
 * The renderer's style seam: how a pen behaves, what it looks like, and re-exports
 * of the board's colours and type scale.
 *
 * The colour table itself moved to `@inkcast/core` (plan item 2.2) — it was one of
 * two, and the other (visuals') had drifted to a different accent and a different
 * black. One table now serves every package that paints; the renderer re-exports it
 * so this module is still the one place the renderer asks about type and colour.
 */
import { stylePackFor } from '@inkcast/core';
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

/**
 * A table of four until plan item 7.3; the pack's `sketch` block now.
 *
 * The numbers are unchanged and they are still *not* the visuals stage's roughness and
 * bowing, which are a different engine's parameters on a different scale (marker sketches
 * at 1.1 where rough.js resolves at 1.15). A pack states both, side by side, and
 * `core/src/stylepack.ts`'s header says why they are not one number.
 */
export function inkStyle(style: StyleName): InkStyle {
  const sketch = stylePackFor(style).sketch;
  return {
    roughness: sketch.roughness,
    bowing: sketch.bowing,
    passes: sketch.passes,
    cap: sketch.cap,
    opacity: sketch.opacity,
  };
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
 * Pen sprites are pack data too (plan item 7.3).
 *
 * The four sprites that used to live here — 132 units of chisel-nib marker, a pencil with
 * a pink eraser, a stick of chalk, a gold-ferruled liner — are pure path data, so they
 * moved into `styles/*.json` whole rather than staying behind as a library a pack picks
 * from by id. `docs/STYLES.md` §3 models the pen as a `PenId` naming a vendored sprite;
 * making it inline data instead is what closes the item's done-bar honestly, because a
 * fifth style with a borrowed pen is not really a fifth style, and "adding a fifth style
 * touches zero TypeScript" would otherwise have an asterisk on it.
 *
 * `follow`, `baseAngle` and `unit` mean exactly what `PenArt` in `./types.ts` says.
 */

/**
 * The sprite a style draws with, with the board's accent resolved into it.
 *
 * The marker's barrel picks up the film's accent so the pen belongs to the film. That
 * used to be `p.fill === '#2f6fed'` — the renderer recognising one sprite by the colour of
 * its barrel, which no pack author could have known to imitate. A pack writes the literal
 * token `accent` where it wants the film's colour, and any part of any sprite may use it.
 */
export function penArt(style: StyleName, accent: string): PenArt {
  const art = stylePackFor(style).pen.art;
  return {
    unit: art.unit,
    baseAngle: art.baseAngle,
    follow: art.follow,
    parts: art.parts.map((p) => ({
      d: p.d,
      fill: p.fill === ACCENT_TOKEN ? accent : p.fill,
      stroke: p.stroke === ACCENT_TOKEN ? accent : p.stroke,
      strokeWidth: p.strokeWidth,
    })),
  };
}

/** The one colour name a pack may use that is not a colour. See `PenPartSpec`. */
const ACCENT_TOKEN = 'accent';
