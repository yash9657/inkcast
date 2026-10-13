/**
 * `plot` — a cartesian frame drawn by hand, and the single most important element
 * for teaching anything quantitative.
 *
 * **This module derives no geometry.** Every point, gutter, tick, curve sample and
 * label position comes from `@inkcast/visuals` via `./visuals.js`; what happens here
 * is timing and packaging — turning one plot's ink into the independently timed
 * phases the plan needs. It used to own a second implementation of all of it, which
 * meant every fix had to be made twice and the richer of the two solvers was the one
 * nothing ran (`docs/PIPELINE.md`, root cause 1).
 *
 * The build order is still the pedagogy, and it is now expressed as part *kinds*
 * rather than rebuilt here: **the frame first**, so the learner knows what the two
 * directions mean before anything moves; then each **curve revealed along its own
 * direction**, so they watch the shape happen instead of finding it already there;
 * then **overlays at their own `at` fractions**, so the dot, the tangent and the
 * descent land on the words that name them.
 *
 * Each returned phase becomes its own plan item with its own start time, which is
 * what lets a tangent swing in eight seconds after the curve it belongs to, and a
 * stepping sequence appear one hop at a time.
 */
import type { PlotElement } from '@inkcast/core';
import type { PlotPartKind, PlotPartRecord } from '@inkcast/visuals';
import type { Palette } from './palette.js';
import { geom, textPrim } from './prims.js';
import type { PlanPrim, Rect } from './types.js';
import type { PlotSource } from './visuals.js';

/**
 * What packaging a plot needs from the board.
 *
 * Deliberately smaller than it was: the roughening style and the scales used to be
 * threaded through here because this module *drew* the plot. It no longer does, so what
 * is left is the palette to re-ink with and the style's static opacity. The type scale
 * now goes the other way — into the resolver, before the geometry exists.
 */
export type PlotContext = {
  pal: Palette;
  /** Static opacity for styles that do not lay down solid ink. */
  alpha: number | undefined;
};

export type PlotPhase = {
  /** Suffix that makes this phase's plan item id unique. */
  key: string;
  prims: PlanPrim[];
  /**
   * Author-pinned start as a fraction of the scene's narration, or `null` to be
   * sequenced after whatever came before it.
   */
  at: number | null;
  /** Relative draw time, against the element's `enter.duration`. */
  weight: number;
  /** Transform origin for the phase. */
  center: [number, number];
  /**
   * Identity of this phase's ink, for phases that can already be on the board.
   *
   * A later beat annotating an earlier plot re-declares the same frame and curve —
   * that is how the IR says "add a tangent to the plot from two scenes ago", since
   * an overlay needs the curve's definition to know where the tangent goes. Without
   * an identity the axes and the curve would be drawn a second time on top of
   * themselves, in a slightly different hand. Overlays never carry one: they are the
   * new ink the later beat exists to add.
   */
  sig?: string;

  /**
   * Degrees this phase is rotated by at the start of its entry, easing to zero —
   * how a tangent sweeps into place instead of blinking on at its final angle.
   */
  sweep?: { cx: number; cy: number; deg: number };
};

/* --------------------------------------------------------------- part kinds */

/**
 * Which phase a part belongs to.
 *
 * The frame's six possible parts (grid, both axes, ticks, both axis labels) collapse
 * into one phase: they are one gesture — "here are the two directions" — and giving
 * each its own slot would spend six sequential reveals on scaffolding before the
 * first curve appeared.
 */
const FRAME_KINDS: ReadonlySet<PlotPartKind> = new Set<PlotPartKind>([
  'axis',
  'grid',
  'ticks',
  'axis-label',
]);

/**
 * Relative draw time per phase.
 *
 * A curve gets the longest slot because it is the thing being explained; overlays
 * are quick marks on top of it, and a single hop of a descent is quicker still.
 */
const WEIGHTS: Record<PlotPartKind, number> = {
  axis: 1,
  grid: 1,
  ticks: 1,
  'axis-label': 1,
  curve: 1.5,
  'curve-label': 1.5,
  point: 0.4,
  tangent: 0.8,
  dropline: 0.5,
  shade: 0.8,
  annotate: 0.7,
  steps: 0.45,
};

/** True for a sub-part that continues an earlier one rather than starting it. */
function continuation(key: string): boolean {
  const m = /s(\d+)$/.exec(key);
  return m !== null && Number(m[1]) > 0;
}

/** The phase a part belongs to, as the suffix that makes its plan item id. */
function phaseKeyFor(record: PlotPartRecord): string {
  if (FRAME_KINDS.has(record.kind)) return 'axes';
  if (record.kind === 'curve' || record.kind === 'curve-label') return `curve-${record.id}`;
  // `overlay:2` -> `ov2`, `overlay:2:0` -> `ov2s0`. The suffixed form is a sub-part:
  // one hop of a descent, which is timed and revealed on its own.
  const m = /^overlay:(\d+)(?::(\d+))?$/.exec(record.id);
  if (!m) return record.id.replace(/[^A-Za-z0-9_-]+/g, '-');
  return m[2] === undefined ? `ov${m[1]}` : `ov${m[1]}s${m[2]}`;
}

/* ------------------------------------------------------------------ colour */

/**
 * Ink for each part of a plot, from the *board's* palette.
 *
 * Geometry comes from the visuals stage; colour does not, and the distinction is
 * deliberate: the manifest's *roles* are mapped onto the palette the rest of the
 * film is drawn with, so a plot recorded under an older sidecar can never be the one
 * element on screen using a different set of pens. (Both packages now read one
 * colour table in `@inkcast/core` — plan item 2.2 killed the red-vs-blue accent
 * split that used to make this remap load-bearing — but the role mapping stays: it
 * is the contract that makes recorded geometry colour-stable across palette
 * changes.) Weight, opacity and every coordinate still come from the stage.
 *
 * One accent for the whole film is a hard rule (see `palette.ts`), so a curve's
 * `accent` index selects between the three inks the palette actually has rather than
 * inventing a hue per curve. That is enough to tell "what happens" from "what would
 * have happened", which is all a curve index is ever used for.
 */
function inkFor(
  kind: PlotPartKind,
  pal: Palette,
  accent: number,
): { stroke: string; text: string } {
  switch (kind) {
    case 'axis':
      return { stroke: pal.ink, text: pal.ink };
    case 'grid':
    case 'ticks':
    case 'axis-label':
    case 'dropline':
      return { stroke: pal.inkSoft, text: pal.inkSoft };
    case 'curve':
    case 'curve-label': {
      const ring = [pal.ink, pal.accent, pal.inkSoft];
      const ink = ring[accent % ring.length] as string;
      return { stroke: ink, text: ink };
    }
    case 'point':
      // The dot is the accent; its label is body ink, because the label is a name
      // rather than a mark.
      return { stroke: pal.accent, text: pal.ink };
    case 'annotate':
      return { stroke: pal.inkSoft, text: pal.ink };
    case 'tangent':
    case 'shade':
    case 'steps':
      return { stroke: pal.accent, text: pal.accent };
    default:
      return { stroke: pal.ink, text: pal.ink };
  }
}

/* ------------------------------------------------------------------ prims */

/**
 * A resolved stroke, in the board's ink.
 *
 * Geometry and weight are taken exactly as the visuals stage resolved them — it was
 * given this board's type scale, so its numbers are already in the renderer's units.
 * Only the colour is remapped.
 */
function strokePrim(
  stroke: PlotSource['strokes'][number],
  colour: string,
  soft: boolean,
  alpha: number | undefined,
): PlanPrim {
  const filled = stroke.fill !== 'none';
  // The part's own opacity — a hairline grid, a shaded region — times the style's, so
  // a chalk plot is as translucent as the chalk board around it.
  const opacity = stroke.opacity * (alpha ?? 1);
  return geom(stroke.d, colour, stroke.strokeWidth, {
    fill: filled ? colour : 'none',
    ...(opacity < 1 ? { opacity } : {}),
    // Two things must not dash-reveal. A shape with no stroke — a hachure fill, a
    // solid dot — has no length to reveal along. And scaffolding must not be *drawn*:
    // a gridline that draws itself stroke by stroke reads as content the learner is
    // meant to follow, when it is only there to be measured against.
    ...(stroke.stroke === 'none' || soft ? { noDash: true } : {}),
  });
}

/**
 * A solved label, in the renderer's units and the board's ink.
 *
 * The placement and the size are both visuals' — measured against real font metrics
 * and stepped clear of the ink and of every other label — so the box is taken as given
 * and shrink-to-fit is off. Re-measuring here would move the text out of the gutter
 * that was reserved for it.
 */
function textPrimFor(layout: PlotSource['texts'][number], colour: string): PlanPrim {
  return textPrim(
    layout.text,
    layout.bounds,
    layout.fontSize,
    colour,
    layout.align,
    'middle',
    false,
  );
}

/* ----------------------------------------------------------------- phases */

/**
 * The whole plot, as an ordered list of independently timed phases.
 *
 * Parts arrive in draw order already — the visuals resolver emits the frame, then
 * curves in declaration order, then overlays sorted by `at` — so this walks them once
 * and groups consecutive parts that share a phase.
 */
export function plotPhases(el: PlotElement, src: PlotSource, ctx: PlotContext): PlotPhase[] {
  const byKey = new Map<string, { record: PlotPartRecord; prims: PlanPrim[] }>();
  const order: string[] = [];

  for (const record of src.layout.parts) {
    const key = phaseKeyFor(record);
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = { record, prims: [] };
      byKey.set(key, bucket);
      order.push(key);
    }
    // Only a curve reads its accent index; every overlay is the one accent.
    const accent = el.curves.find((c) => c.id === record.id)?.accent ?? 0;
    const ink = inkFor(record.kind, ctx.pal, accent);
    const soft = record.kind === 'grid';
    for (const stroke of src.strokes) {
      if (stroke.order >= record.from && stroke.order <= record.to) {
        bucket.prims.push(strokePrim(stroke, ink.stroke, soft, ctx.alpha));
      }
    }
    for (const layout of src.texts) {
      if (layout.order >= record.from && layout.order <= record.to) {
        bucket.prims.push(textPrimFor(layout, ink.text));
      }
    }
  }

  const phases: PlotPhase[] = [];
  for (const key of order) {
    const bucket = byKey.get(key);
    if (!bucket || bucket.prims.length === 0) continue;
    const { record, prims } = bucket;
    const frame = FRAME_KINDS.has(record.kind);
    const curve = record.kind === 'curve' || record.kind === 'curve-label';
    phases.push({
      key,
      prims,
      // The frame and the curves are sequenced from the element's own entry; an
      // overlay is pinned to the fraction of the narration that introduces it. Only
      // the *first* sub-part of a multi-part overlay takes that pin — the later hops
      // of a descent follow their predecessor, which is what makes it a sequence
      // rather than four things landing on one word.
      at: frame || curve || continuation(key) ? null : record.at > 0 ? record.at : null,
      weight: WEIGHTS[record.kind] ?? 0.6,
      center: centreOf(prims, src, record),
      ...(frame || curve ? { sig: sigFor(el, record) } : {}),
      ...sweepFor(src, record),
    });
  }
  return phases;
}

/** Transform origin: the marked point where there is one, else the ink's own middle. */
function centreOf(
  prims: readonly PlanPrim[],
  src: PlotSource,
  record: PlotPartRecord,
): [number, number] {
  const mark = src.layout.marks.find((m) => m.id === record.id || m.id.startsWith(`${record.id}:`));
  if (mark) return [mark.point.x, mark.point.y];
  if (FRAME_KINDS.has(record.kind)) {
    const a = src.layout.area;
    return [a.x + a.w / 2, a.y + a.h / 2];
  }
  if (record.kind === 'curve' || record.kind === 'curve-label') {
    const trace = src.layout.curves.find((c) => c.id === record.id);
    const first = trace?.points[0];
    const last = trace?.points[trace.points.length - 1];
    if (first && last) return [(first.x + last.x) / 2, (first.y + last.y) / 2];
  }
  return boundsCentre(prims);
}

function boundsCentre(prims: readonly PlanPrim[]): [number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const prim of prims) {
    if (prim.kind !== 'text') continue;
    x0 = Math.min(x0, prim.box.x);
    y0 = Math.min(y0, prim.box.y);
    x1 = Math.max(x1, prim.box.x + prim.box.w);
    y1 = Math.max(y1, prim.box.y + prim.box.h);
  }
  if (!Number.isFinite(x0)) return [0, 0];
  return [(x0 + x1) / 2, (y0 + y1) / 2];
}

/**
 * Identity for ink that a later beat may re-declare.
 *
 * Built from the *element's own* definition rather than from the drawn geometry: two
 * beats that declare the same frame and curve must produce the same signature even
 * though they are separate elements with separate seeds.
 */
function sigFor(el: PlotElement, record: PlotPartRecord): string {
  if (FRAME_KINDS.has(record.kind)) {
    return JSON.stringify([
      'axes',
      el.at,
      el.xDomain,
      el.yDomain,
      el.axes,
      el.grid,
      el.ticks,
      el.xLabel ?? '',
      el.yLabel ?? '',
    ]);
  }
  const curve = el.curves.find((c) => c.id === record.id);
  return JSON.stringify(['curve', el.at, el.xDomain, el.yDomain, curve ?? record.id]);
}

/**
 * A tangent starts level and swings into the slope it is measuring — the motion is
 * the explanation, so it must not simply appear at its final angle.
 *
 * The angle comes from the mark's data-space slope converted through the frame's own
 * scales, which is the same number the drawn line has.
 */
function sweepFor(
  src: PlotSource,
  record: PlotPartRecord,
): { sweep?: { cx: number; cy: number; deg: number } } {
  if (record.kind !== 'tangent') return {};
  const mark = src.layout.marks.find((m) => m.id === record.id && m.kind === 'tangent');
  if (!mark || typeof mark.slope !== 'number') return {};
  const { area, xDomain, yDomain } = src.layout;
  const spanOf = (d: readonly [number, number]): number => {
    const v = d[1] - d[0];
    return Math.abs(v) < 1e-12 ? 1 : v;
  };
  const sx = area.w / spanOf(xDomain);
  const sy = area.h / spanOf(yDomain);
  const deg = (Math.atan2(mark.slope * sy, sx) * 180) / Math.PI;
  return { sweep: { cx: mark.point.x, cy: mark.point.y, deg: Math.max(-70, Math.min(70, deg)) } };
}

/* -------------------------------------------------------------- geometry read */

/**
 * The plotting area — the box inside the gutters that hold the ticks and names.
 *
 * The IR says a plot occupies its `at` box and nothing about gutters, so anything
 * authored *inside* a plot needs this to be rebased onto the ink. It is read from the
 * layout rather than recomputed: the gutters are visuals' decision.
 */
export function plotArea(src: PlotSource): Rect {
  return { ...src.layout.area };
}

/**
 * The canvas-space trace of a curve, for something to ride or morph into.
 *
 * Already resampled to even arc length by the visuals stage, which is what makes a
 * ball descend at one speed and a morph bend the short way instead of sliding.
 */
export function curveTrace(src: PlotSource, curveId?: string): [number, number][] | null {
  const trace = curveId
    ? (src.layout.curves.find((c) => c.id === curveId) ?? src.layout.curves[0])
    : src.layout.curves[0];
  if (!trace || trace.points.length < 2) return null;
  return trace.points.map((p) => [p.x, p.y] as [number, number]);
}
