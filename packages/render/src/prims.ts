/**
 * Constructors for the three primitive kinds the page understands.
 *
 * Shared by `compile.ts` and `plot.ts` so that a plot's ink is built out of
 * exactly the same pieces as everything else — one code path for reveal, for the
 * pen sprite, and for text measurement.
 */
import { circlePath } from './geom.js';
import type { GeomPrim, PlanPrim, Rect, TextPrim } from './types.js';

export function geom(
  d: string,
  stroke: string,
  strokeWidth: number,
  extra?: Partial<GeomPrim>,
): GeomPrim {
  return { kind: 'geom', d, stroke, strokeWidth, fill: 'none', ...extra };
}

export function geoms(
  ds: string[],
  stroke: string,
  strokeWidth: number,
  opacity?: number,
): GeomPrim[] {
  return ds
    .filter((d) => d.length > 0)
    .map((d) =>
      opacity === undefined
        ? geom(d, stroke, strokeWidth)
        : geom(d, stroke, strokeWidth, { opacity }),
    );
}

export function textPrim(
  text: string,
  box: Rect,
  size: number,
  color: string,
  align: TextPrim['align'],
  vAlign: TextPrim['vAlign'] = 'middle',
  shrink = true,
): TextPrim {
  return { kind: 'text', text, box, size, align, vAlign, color, shrink };
}

/** A solid marked point: the dot on a curve, a bead on a motion trail. */
export function dotPrim(cx: number, cy: number, r: number, color: string, sw: number): GeomPrim {
  return geom(circlePath(cx, cy, r), color, sw, { fill: color });
}

/**
 * Keep a text box inside the element it belongs to.
 *
 * Plot labels are authored in data space — an axis name, a tick value, a note on a
 * curve — with no idea how wide the words will turn out. Without this, the last
 * tick label on an axis hangs off the side of the board.
 */
export function clampBox(box: Rect, bounds: Rect): Rect {
  const x = Math.max(bounds.x, Math.min(box.x, Math.max(bounds.x, bounds.x + bounds.w - box.w)));
  const y = Math.max(bounds.y, Math.min(box.y, Math.max(bounds.y, bounds.y + bounds.h - box.h)));
  return { x, y, w: box.w, h: box.h };
}

/**
 * A label placed around a point, kept inside `bounds`.
 *
 * Plot annotations are authored in data space with no idea how wide the words
 * will be, so the renderer is the only place that can stop "learning rate" from
 * hanging off the edge of the board.
 */
export type LabelPlace = 'above' | 'below' | 'right' | 'left' | 'above-left' | 'above-right';

export function labelAt(
  text: string,
  anchor: [number, number],
  size: number,
  color: string,
  bounds: Rect,
  place: LabelPlace = 'above',
): PlanPrim {
  const w = Math.max(size * 3, text.length * size * 0.58);
  const h = size * 1.55;
  let x = anchor[0] - w / 2;
  let y = anchor[1] - h / 2;
  if (place === 'above') y = anchor[1] - h * 1.05;
  if (place === 'below') y = anchor[1] + h * 0.15;
  if (place === 'right') x = anchor[0] + size * 0.5;
  if (place === 'left') x = anchor[0] - w - size * 0.5;
  // Diagonal placements exist because the interesting points on a plot are on a
  // *slope*: directly above a point on a steep curve is where the curve already
  // is, so the label reads struck through. Stepping sideways as well as up clears
  // the ink it is naming.
  if (place === 'above-left') {
    x = anchor[0] - w - size * 0.4;
    y = anchor[1] - h * 1.1;
  }
  if (place === 'above-right') {
    x = anchor[0] + size * 0.4;
    y = anchor[1] - h * 1.1;
  }
  const boxed = clampBox({ x, y, w, h }, bounds);
  const align: TextPrim['align'] =
    place === 'left' || place === 'above-left'
      ? 'right'
      : place === 'right' || place === 'above-right'
        ? 'left'
        : 'center';
  return textPrim(text, boxed, size, color, align, 'middle', false);
}
