/**
 * The hybrid drawing lane: a generated picture of a real object, with composed marks
 * naming its parts drawn on top of it.
 *
 * ## Why the lane exists
 *
 * Measured on one beat, the same `describe` text word for word, both lanes: composed
 * marks produced the cardiac conduction system — AV node, bundle of His, both branches,
 * the apex — all five labelled, each with a leader arrow, and drew the whole thing on a
 * valentine ❤️. The image generator produced an anatomically real heart, great vessels
 * and all, containing none of the conduction system, and could not have named a part of
 * it if it had: the prompt that makes an image traceable has to say "no text". Each lane
 * supplies exactly what the other lacks.
 *
 * ## Everything here exists so two sides cannot disagree about one number
 *
 * The marks are placed by a model looking at a picture, in canvas coordinates. If the
 * picture then lands anywhere other than where it was when the model looked, every leader
 * arrow points at empty board — and it looks exactly like the model being bad at aiming,
 * which is the one failure that would be diagnosed wrong. So the asset id, the prompt, the
 * seed and the box are all derived here, once, and both the compiler and the pipeline's
 * seam read them from this file. Same argument as `draw-geom.ts`: the quality came from
 * the repair and the audit being unable to hold different opinions about what ink is.
 */
import { DRAW_H, DRAW_W } from '@inkcast/core';
import type { Box } from './elements.js';

/**
 * The region of the drawing canvas the generated subject may occupy.
 *
 * Centred, and deliberately narrower than the canvas: the 190-odd units of clear board
 * left on each side are where the part names go. That is not a style choice — a name
 * written across an anatomical drawing is unreadable however good the drawing is, so the
 * brief tells the author to put labels in the clear space and run a leader to the
 * structure, and this is the clear space existing for it to use.
 *
 * The height is the whole canvas because most objects worth generating are taller than
 * they are wide once traced (a heart traces to 496x798 of a 1024 square) and a picture
 * that does not use the board's height is the sparseness defect arriving by another door.
 */
export const UNDERLAY_AREA = { w: 620, h: DRAW_H } as const;

/**
 * Where a traced image's ink goes on the drawing canvas, from the shape of that ink.
 *
 * Aspect-preserving and centred in `UNDERLAY_AREA`. Aspect-preserving matters more than
 * usual here: a stretched heart is still recognisably a heart, but every mark aimed at it
 * was aimed at the unstretched one.
 *
 * `ink` is the bounding box of the image's own ink in the image's own pixels — see
 * `tracedInkBox` in `@inkcast/visuals`, which measures it from the same trace the board
 * will draw from. Passing the image's *frame* here instead would place a subject that has
 * a wide white margin around it (they all do) at a fraction of the size it should be.
 */
export function underlayInkBox(ink: { w: number; h: number }): Box {
  const s = Math.min(
    UNDERLAY_AREA.w / Math.max(1e-6, ink.w),
    UNDERLAY_AREA.h / Math.max(1e-6, ink.h),
  );
  const w = ink.w * s;
  const h = ink.h * s;
  return { x: (DRAW_W - w) / 2, y: (DRAW_H - h) / 2, w, h };
}

/** A recorded `[x, y, w, h]` back as a box, or `undefined` if it is not four numbers. */
export function readInkBox(box: number[] | undefined): Box | undefined {
  if (!box || box.length !== 4) return undefined;
  const [x, y, w, h] = box as [number, number, number, number];
  if (![x, y, w, h].every((v) => Number.isFinite(v)) || w <= 0 || h <= 0) return undefined;
  return { x, y, w, h };
}

/**
 * The asset one underlay prompt resolves to, everywhere it is resolved.
 *
 * The pipeline's seam generates the image under this id and prompt so it lands in the
 * project and machine caches; the compiler mints an asset with the same id and prompt so
 * the visuals stage finds it there rather than calling the provider again. A text-to-image
 * model is not a function — asked twice it returns two different hearts — so an id that
 * differed by one character between the two sides would annotate a picture nobody can see
 * any more.
 *
 * The prompt goes through verbatim. `illustrationPrompt` in the visuals stage already adds
 * the line-art shaping every raster needs, and adding a second suffix here (the way
 * `buildAsset` does for an ordinary illustration) would only be one more string for the
 * two sides to disagree about.
 *
 * The seed is not here: the compiler's asset registry derives it from the id, and the seam
 * asks for it with `assetSeed` rather than recomputing the same hash beside it. It has to
 * match, and not only for tidiness — on a machine with no cached raster, a regeneration
 * under a different seed returns a different heart, and `lesson.json` stops being the
 * complete description of the video that its own schema promises.
 */
export function underlayAsset(prompt: string): { id: string; prompt: string } {
  const clean = prompt.trim();
  const slug =
    clean
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .slice(0, 4)
      .join('-') || 'underlay';
  return { id: `underlay-${slug}`, prompt: clean };
}
