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

// `labelAt` — a point-anchored label with a `chars × size × 0.58` width estimate —
// lived here until 2026-08-23. Plot annotations moved into the visuals stage, which
// measures with the real advance table, and nothing called it; it was the renderer's
// last chars-times-a-constant estimator, deleted under plan item 2.1.
