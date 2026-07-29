/**
 * `plot` — a cartesian frame drawn by hand, and the single most important element
 * for teaching anything quantitative.
 *
 * The build order is the pedagogy: **axes first**, so the learner knows what the
 * two directions mean before anything moves; then each **curve revealed along its
 * own direction** (left to right for a function of x), so they watch the shape
 * happen instead of finding it already there; then **overlays at their own `at`
 * fractions**, so the dot, the tangent and the descent land on the words that
 * name them.
 *
 * Everything below is geometry only. Each returned phase becomes its own plan
 * item with its own start time, which is what lets a tangent swing in eight
 * seconds after the curve it belongs to, and a stepping sequence appear one step
 * at a time.
 */
import type { Curve, PlotElement, PlotOverlay } from '@inkcast/core';
import { clipSegment, dashAlong, flattenPathData } from './geom.js';
import type { Pt } from './geom.js';
import { clampBox, dotPrim, geom, geoms, labelAt, textPrim } from './prims.js';
import type { Palette } from './palette.js';
import { TYPE_SCALE } from './palette.js';
import { Rng, hachurePolygon, seedOf, sketchAlong, sketchArrowHead, sketchLine } from './sketch.js';
import type { SketchStyle } from './sketch.js';
import type { PlanPrim, Rect } from './types.js';

export type PlotContext = {
  pal: Palette;
  st: SketchStyle;
  /** Base stroke width, in canvas units. */
  sw: number;
  /** Canvas units per output pixel, for geometry. */
  scale: number;
  /** Canvas units per output pixel, for type. */
  type: number;
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

/* ------------------------------------------------------------- named curves */

/**
 * The named functions `Curve.fn` can ask for.
 *
 * Named rather than expressions on purpose: no evaluator, no injection surface,
 * identical output in Node and in the browser, and a planner can ask for "a bowl"
 * without emitting a hundred coordinates.
 *
 * | name       | formula                                | params (defaults)          |
 * | ---------- | -------------------------------------- | -------------------------- |
 * | parabola   | a(x − b)² + c                          | a=1, b=0, c=0              |
 * | line       | ax + b                                 | a=1, b=0                   |
 * | sigmoid    | c / (1 + e^(−a(x − b)))                | a=1, b=0, c=1              |
 * | gaussian   | c·e^(−(x − b)² / 2a²)                  | a=1, b=0, c=1              |
 * | sine       | a·sin(bx + c)                          | a=1, b=1, c=0              |
 * | exp        | a·e^(bx)                               | a=1, b=1                   |
 * | log        | a·ln(bx), undefined for bx ≤ 0         | a=1, b=1                   |
 * | doubleWell | a(x² − b)² + dx + c                    | a=1, b=1, c=0, d=0         |
 * | step       | c + a·floor(x / b)                     | a=1, b=1, c=0              |
 */
export function evalCurveFn(
  name: NonNullable<Curve['fn']>['name'],
  params: readonly number[],
  x: number,
): number | null {
  const p = (i: number, dflt: number): number => {
    const v = params[i];
    return typeof v === 'number' && Number.isFinite(v) ? v : dflt;
  };
  switch (name) {
    case 'parabola': {
      const dx = x - p(1, 0);
      return p(0, 1) * dx * dx + p(2, 0);
    }
    case 'line':
      return p(0, 1) * x + p(1, 0);
    case 'sigmoid':
      return p(2, 1) / (1 + Math.exp(-p(0, 1) * (x - p(1, 0))));
    case 'gaussian': {
      const s = p(0, 1) || 1;
      const dx = x - p(1, 0);
      return p(2, 1) * Math.exp(-(dx * dx) / (2 * s * s));
    }
    case 'sine':
      return p(0, 1) * Math.sin(p(1, 1) * x + p(2, 0));
    case 'exp':
      return p(0, 1) * Math.exp(p(1, 1) * x);
    case 'log': {
      const v = p(1, 1) * x;
      return v > 0 ? p(0, 1) * Math.log(v) : null;
    }
    case 'doubleWell': {
      const q = x * x - p(1, 1);
      return p(0, 1) * q * q + p(3, 0) * x + p(2, 0);
    }
    case 'step': {
      const b = p(1, 1) || 1;
      return p(2, 0) + p(0, 1) * Math.floor(x / b);
    }
    default:
      return null;
  }
}

/** A curve as a function of x, whether it was authored as samples or as a name. */
export function curveAt(c: Curve, x: number): number | null {
  if (c.points && c.points.length > 0) {
    const pts = c.points;
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (!first || !last) return null;
    if (x <= first.x) return first.y;
    if (x >= last.x) return last.y;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (!a || !b) continue;
      if (x >= a.x && x <= b.x) {
        const span = b.x - a.x;
        return span === 0 ? a.y : a.y + ((x - a.x) * (b.y - a.y)) / span;
      }
    }
    return last.y;
  }
  if (c.fn) return evalCurveFn(c.fn.name, c.fn.params, x);
  return null;
}

/** Slope by central difference — the number a tangent is drawn from. */
export function curveSlope(c: Curve, x: number, h: number): number {
  const a = curveAt(c, x - h);
  const b = curveAt(c, x + h);
  if (a === null || b === null) {
    const here = curveAt(c, x);
    const other = curveAt(c, x + h);
    if (here === null || other === null) return 0;
    return (other - here) / h;
  }
  return (b - a) / (2 * h);
}

/** Data-space samples of a curve, in drawing order. */
function sampleCurve(
  c: Curve,
  xDomain: [number, number],
  steps: number,
): { pts: Pt[]; smooth: boolean } {
  if (c.points && c.points.length >= 2) {
    return { pts: c.points.map((p) => [p.x, p.y] as Pt), smooth: true };
  }
  if (!c.fn) return { pts: [], smooth: true };
  const [x0, x1] = xDomain;
  if (c.fn.name === 'step') {
    // A staircase is drawn as a staircase: corners, not a smoothed ramp.
    const b = c.fn.params[1] && c.fn.params[1] !== 0 ? c.fn.params[1] : 1;
    const pts: Pt[] = [];
    const from = Math.floor(Math.min(x0, x1) / b) * b;
    for (let x = from; x <= Math.max(x0, x1) + b; x += b) {
      const y = evalCurveFn('step', c.fn.params, x + b * 0.001);
      if (y === null) continue;
      const left = Math.max(Math.min(x0, x1), x);
      const right = Math.min(Math.max(x0, x1), x + b);
      if (right <= left) continue;
      pts.push([left, y], [right, y]);
    }
    return { pts, smooth: false };
  }
  const pts: Pt[] = [];
  const n = Math.max(8, steps);
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const y = evalCurveFn(c.fn.name, c.fn.params, x);
    if (y === null) continue;
    pts.push([x, y]);
  }
  return { pts, smooth: true };
}

/* ------------------------------------------------------------------ mapping */

export type PlotMap = {
  /** The plotting area, inside the element box and clear of the axis labels. */
  area: Rect;
  x(v: number): number;
  y(v: number): number;
  /** Data-space x of the y axis, and data-space y of the x axis. */
  originX: number;
  originY: number;
};

export function plotMap(el: PlotElement, ctx: PlotContext): PlotMap {
  const size = TYPE_SCALE.label * ctx.type;
  const wantsY = Boolean(el.yLabel) || el.ticks;
  const wantsX = Boolean(el.xLabel) || el.ticks;
  const left = wantsY ? size * 1.5 : size * 0.5;
  const bottom = wantsX ? size * 1.9 : size * 0.6;
  const top = el.yLabel ? size * 1.7 : size * 0.6;
  // The last tick label is centred on the end of the axis, so it needs half its own
  // width of room past it — as does the axis arrowhead.
  const right = el.ticks ? size * 1.6 : size * 0.9;
  const area: Rect = {
    x: el.at.x + left,
    y: el.at.y + top,
    w: Math.max(size, el.at.w - left - right),
    h: Math.max(size, el.at.h - top - bottom),
  };
  const [x0, x1] = el.xDomain;
  const [y0, y1] = el.yDomain;
  const sx = x1 === x0 ? 0 : area.w / (x1 - x0);
  const sy = y1 === y0 ? 0 : area.h / (y1 - y0);
  return {
    area,
    x: (v) => area.x + (v - x0) * sx,
    y: (v) => area.y + area.h - (v - y0) * sy,
    originX: x0 <= 0 && x1 >= 0 ? 0 : x0,
    originY: y0 <= 0 && y1 >= 0 ? 0 : y0,
  };
}

/** Split a canvas-space polyline where it leaves the plotting area vertically. */
function clipToBand(pts: readonly Pt[], yMin: number, yMax: number): Pt[][] {
  const out: Pt[][] = [];
  let run: Pt[] = [];
  const inside = (p: Pt): boolean => p[1] >= yMin - 1e-9 && p[1] <= yMax + 1e-9;
  const cross = (a: Pt, b: Pt, y: number): Pt => {
    const t = (y - a[1]) / (b[1] - a[1]);
    return [a[0] + (b[0] - a[0]) * t, y];
  };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Pt;
    const b = pts[i] as Pt;
    const ai = inside(a);
    const bi = inside(b);
    if (ai && bi) {
      if (run.length === 0) run.push(a);
      run.push(b);
      continue;
    }
    if (ai && !bi) {
      if (run.length === 0) run.push(a);
      run.push(cross(a, b, b[1] > yMax ? yMax : yMin));
      out.push(run);
      run = [];
      continue;
    }
    if (!ai && bi) {
      run = [cross(a, b, a[1] > yMax ? yMax : yMin), b];
      continue;
    }
    // Both ends outside: the segment may still pass through the band.
    if ((a[1] < yMin && b[1] > yMax) || (a[1] > yMax && b[1] < yMin)) {
      const p1 = cross(a, b, a[1] < yMin ? yMin : yMax);
      const p2 = cross(a, b, a[1] < yMin ? yMax : yMin);
      out.push([p1, p2]);
    }
  }
  if (run.length >= 2) out.push(run);
  return out.filter((r) => r.length >= 2);
}

/** Canvas-space polylines for a curve, clipped to the plot area. */
export function curvePolylines(
  c: Curve,
  el: PlotElement,
  m: PlotMap,
): { runs: Pt[][]; smooth: boolean } {
  const { pts, smooth } = sampleCurve(c, el.xDomain, 120);
  const mapped = pts.map((p) => [m.x(p[0]), m.y(p[1])] as Pt);
  const runs = clipToBand(mapped, m.area.y, m.area.y + m.area.h).map((run) =>
    run.filter((p) => p[0] >= m.area.x - 1 && p[0] <= m.area.x + m.area.w + 1),
  );
  return { runs: runs.filter((r) => r.length >= 2), smooth };
}

/**
 * Ink for a curve.
 *
 * One accent for the whole film is a hard rule (see `palette.ts`), so `accent`
 * selects between the three inks the palette actually has rather than inventing a
 * hue per curve. That is enough to tell "what happens" from "what would have
 * happened", which is all a curve index is ever used for.
 */
function curveInk(accent: number, pal: Palette): string {
  const ring = [pal.ink, pal.accent, pal.inkSoft];
  return ring[accent % ring.length] as string;
}

/* ------------------------------------------------------------------- phases */

function axisPhase(el: PlotElement, m: PlotMap, ctx: PlotContext, rng: Rng): PlotPhase {
  const { pal, st, sw } = ctx;
  const size = TYPE_SCALE.label * ctx.type;
  const prims: PlanPrim[] = [];
  const area = m.area;
  const axisY = Math.min(area.y + area.h, Math.max(area.y, m.y(m.originY)));
  const axisX = Math.min(area.x + area.w, Math.max(area.x, m.x(m.originX)));
  const [x0, x1] = el.xDomain;
  const [y0, y1] = el.yDomain;
  const ticks = 4;

  if (el.grid) {
    for (let i = 1; i <= ticks; i++) {
      const gx = area.x + (area.w * i) / (ticks + 1);
      const gy = area.y + (area.h * i) / (ticks + 1);
      prims.push(
        geom(
          `M${gx.toFixed(2)} ${area.y} L${gx.toFixed(2)} ${(area.y + area.h).toFixed(2)}`,
          pal.inkSoft,
          sw * 0.3,
          {
            opacity: 0.22,
            noDash: true,
          },
        ),
        geom(
          `M${area.x.toFixed(2)} ${gy.toFixed(2)} L${(area.x + area.w).toFixed(2)} ${gy.toFixed(2)}`,
          pal.inkSoft,
          sw * 0.3,
          {
            opacity: 0.22,
            noDash: true,
          },
        ),
      );
    }
  }

  const drawX = el.axes === 'both' || el.axes === 'x';
  const drawY = el.axes === 'both' || el.axes === 'y';
  const head = Math.max(9 * ctx.scale, sw * 2.4);
  if (drawY) {
    // Drawn upwards: a hand starts at the origin and pulls the axis up.
    prims.push(
      ...geoms(
        sketchLine(rng, st, [axisX, area.y + area.h], [axisX, area.y - head * 0.6], 1),
        pal.ink,
        sw * 0.8,
        ctx.alpha,
      ),
    );
    prims.push(
      ...geoms(
        sketchArrowHead(rng, st, [axisX, area.y - head * 0.6], -Math.PI / 2, head),
        pal.ink,
        sw * 0.8,
        ctx.alpha,
      ),
    );
  }
  if (drawX) {
    prims.push(
      ...geoms(
        sketchLine(rng, st, [area.x - head * 0.4, axisY], [area.x + area.w + head * 0.6, axisY], 1),
        pal.ink,
        sw * 0.8,
        ctx.alpha,
      ),
    );
    prims.push(
      ...geoms(
        sketchArrowHead(rng, st, [area.x + area.w + head * 0.6, axisY], 0, head),
        pal.ink,
        sw * 0.8,
        ctx.alpha,
      ),
    );
  }

  if (el.ticks) {
    const fmt = (v: number): string => {
      const r = Math.round(v * 100) / 100;
      return Object.is(r, -0) ? '0' : String(r);
    };
    for (let i = 0; i <= ticks; i++) {
      const vx = x0 + ((x1 - x0) * i) / ticks;
      const px = m.x(vx);
      prims.push(
        ...geoms(
          sketchLine(rng, st, [px, axisY - sw * 1.1], [px, axisY + sw * 1.1], 1),
          pal.inkSoft,
          sw * 0.5,
          ctx.alpha,
        ),
      );
      prims.push(
        textPrim(
          fmt(vx),
          clampBox(
            { x: px - size * 1.4, y: axisY + sw * 1.4, w: size * 2.8, h: size * 1.2 },
            el.at,
          ),
          size * 0.72,
          pal.inkSoft,
          'center',
          'top',
          false,
        ),
      );
      const vy = y0 + ((y1 - y0) * i) / ticks;
      const py = m.y(vy);
      prims.push(
        ...geoms(
          sketchLine(rng, st, [axisX - sw * 1.1, py], [axisX + sw * 1.1, py], 1),
          pal.inkSoft,
          sw * 0.5,
          ctx.alpha,
        ),
      );
      prims.push(
        textPrim(
          fmt(vy),
          clampBox(
            { x: axisX - size * 3.1, y: py - size * 0.6, w: size * 2.7, h: size * 1.2 },
            el.at,
          ),
          size * 0.72,
          pal.inkSoft,
          'right',
          'middle',
          false,
        ),
      );
    }
  }

  if (el.xLabel) {
    prims.push(
      textPrim(
        el.xLabel,
        clampBox(
          {
            x: area.x + area.w * 0.35,
            y: axisY + (el.ticks ? size * 2.0 : size * 0.7),
            w: area.w * 0.65,
            h: size * 1.4,
          },
          el.at,
        ),
        size,
        pal.inkSoft,
        'right',
        'middle',
        false,
      ),
    );
  }
  if (el.yLabel) {
    // Written above the axis rather than rotated along it: rotated handwriting is
    // hard to read at phone size, and every teacher writes the label at the top.
    prims.push(
      textPrim(
        el.yLabel,
        clampBox(
          {
            x: area.x - size * 0.6,
            y: el.at.y,
            w: Math.max(area.w * 0.6, size * 5),
            h: size * 1.4,
          },
          el.at,
        ),
        size,
        pal.inkSoft,
        'left',
        'middle',
        false,
      ),
    );
  }

  return {
    key: 'axes',
    prims,
    at: null,
    weight: 1,
    center: [area.x + area.w / 2, area.y + area.h / 2],
    sig: JSON.stringify([
      'axes',
      el.at,
      el.xDomain,
      el.yDomain,
      el.axes,
      el.grid,
      el.ticks,
      el.xLabel ?? '',
      el.yLabel ?? '',
    ]),
  };
}

function curvePhase(
  c: Curve,
  el: PlotElement,
  m: PlotMap,
  ctx: PlotContext,
  rng: Rng,
): PlotPhase | null {
  const { runs, smooth } = curvePolylines(c, el, m);
  if (runs.length === 0) return null;
  const ink = curveInk(c.accent, ctx.pal);
  const prims: PlanPrim[] = [];
  for (const run of runs) {
    if (c.dashed) {
      const dash = Math.max(ctx.sw * 2.4, 16 * ctx.scale);
      for (const seg of dashAlong(run, dash, dash * 0.85)) {
        prims.push(
          geom(
            sketchAlong(rng, ctx.st, seg, { amp: 0.5, spacing: dash }),
            ink,
            ctx.sw * 0.95,
            ctx.alpha === undefined ? undefined : { opacity: ctx.alpha },
          ),
        );
      }
    } else {
      const d = sketchAlong(rng, ctx.st, run, { amp: 0.8, smooth });
      if (d)
        prims.push(
          geom(d, ink, ctx.sw, ctx.alpha === undefined ? undefined : { opacity: ctx.alpha }),
        );
    }
  }
  // A curve named the same as the axis it is plotted against is the axis label
  // written twice. Four of the benchmark's plots printed "loss" beside the y-axis
  // *and* beside the trace, and a learner reading two identical captions goes
  // looking for the distinction between them.
  //
  // The same applies when the two names merely *differ*, so long as there is only
  // one curve: then both are names for the vertical axis, and two different words
  // for one quantity is worse than two identical ones — the benchmark labelled the
  // axis "height" and the trace "loss" and left the learner to guess whether those
  // were the same measurement. With several curves the labels are doing real work,
  // telling the traces apart, and the axis names the quantity they share.
  const sole = el.curves.length === 1 && Boolean(el.yLabel);
  const redundant =
    c.label !== undefined &&
    (sole || c.label.trim().toLowerCase() === el.yLabel?.trim().toLowerCase());
  if (c.label && !redundant) {
    const last = runs[runs.length - 1] as Pt[];
    const tip = last[last.length - 1] as Pt;
    prims.push(
      labelAt(c.label, [tip[0], tip[1]], TYPE_SCALE.label * ctx.type, ink, el.at, 'above-left'),
    );
  }
  const first = (runs[0] as Pt[])[0] as Pt;
  const last = runs[runs.length - 1] as Pt[];
  const tail = last[last.length - 1] as Pt;
  return {
    key: `curve-${c.id}`,
    prims,
    at: null,
    weight: 1.5,
    center: [(first[0] + tail[0]) / 2, (first[1] + tail[1]) / 2],
    sig: JSON.stringify(['curve', el.at, el.xDomain, el.yDomain, c]),
  };
}

function curveById(el: PlotElement, id: string): Curve | null {
  return el.curves.find((c) => c.id === id) ?? el.curves[0] ?? null;
}

/** Where a curve sits on the board at data-space x, clamped into the plot area. */
function pointOn(c: Curve, x: number, m: PlotMap): Pt | null {
  const y = curveAt(c, x);
  if (y === null) return null;
  const px = m.x(x);
  const py = m.y(y);
  if (px < m.area.x - 1 || px > m.area.x + m.area.w + 1) return null;
  return [px, Math.max(m.area.y, Math.min(m.area.y + m.area.h, py))];
}

function overlayPhases(
  ov: PlotOverlay,
  index: number,
  el: PlotElement,
  m: PlotMap,
  ctx: PlotContext,
  rng: Rng,
): PlotPhase[] {
  const { pal, st, sw } = ctx;
  const size = TYPE_SCALE.label * ctx.type;
  const at = ov.at > 0 ? ov.at : null;
  const key = `ov${index}`;
  const dotR = Math.max(sw * 1.05, 6 * ctx.scale);

  const [dx0, dx1] = el.xDomain;
  const step = Math.max(1e-6, Math.abs(dx1 - dx0) / 400);
  /**
   * Which side of a point on a curve is empty board.
   *
   * A label directly above a point on a steep curve is printed on the curve, because
   * that is exactly where the curve goes. The clear side is the one the curve is
   * climbing away from: above-right of a descending curve, above-left of a rising
   * one — which for a bowl puts every label inside the bowl, where there is room.
   */
  const clearSide = (c: Curve, x: number): 'above-left' | 'above-right' =>
    curveSlope(c, x, step) < 0 ? 'above-right' : 'above-left';

  if (ov.kind === 'annotate') {
    const anchor: Pt = [m.x(ov.x), m.y(ov.y)];
    const prims: PlanPrim[] = [];
    if (ov.leaderTo) {
      const to: Pt = [m.x(ov.leaderTo.x), m.y(ov.leaderTo.y)];
      const run = clipSegment(anchor, to, m.area);
      if (run)
        prims.push(
          ...geoms(sketchLine(rng, st, run[0], run[1], 1), pal.inkSoft, sw * 0.55, ctx.alpha),
        );
    }
    prims.push(labelAt(ov.text, anchor, size, pal.ink, el.at, 'above'));
    return [{ key, prims, at, weight: 0.7, center: anchor }];
  }

  const curve = curveById(el, ov.curveId);
  if (!curve) return [];

  if (ov.kind === 'point') {
    const p = pointOn(curve, ov.x, m);
    if (!p) return [];
    const prims: PlanPrim[] = [dotPrim(p[0], p[1], dotR, pal.accent, sw * 0.4)];
    if (ov.label) {
      prims.push(
        labelAt(ov.label, [p[0], p[1] - dotR], size, pal.ink, el.at, clearSide(curve, ov.x)),
      );
    }
    return [{ key, prims, at, weight: 0.4, center: p }];
  }

  if (ov.kind === 'tangent') {
    const p = pointOn(curve, ov.x, m);
    if (!p) return [];
    const slope = curveSlope(curve, ov.x, step);
    const yAt = curveAt(curve, ov.x) ?? 0;
    // A slope plus a span in data units says nothing about where the frame ends, so
    // the drawn line is clipped to the plot area. The angle is taken before the clip
    // and so is exactly the slope being measured.
    const far: Pt = [m.x(ov.x - ov.span), m.y(yAt - slope * ov.span)];
    const near: Pt = [m.x(ov.x + ov.span), m.y(yAt + slope * ov.span)];
    const run = clipSegment(far, near, m.area);
    if (!run) return [];
    const [left, right] = run;
    const prims: PlanPrim[] = [
      ...geoms(sketchLine(rng, st, left, right, 1), pal.accent, sw * 0.85, ctx.alpha),
      dotPrim(p[0], p[1], dotR, pal.accent, sw * 0.4),
    ];
    if (ov.label) {
      // Below the downhill end. A tangent to a convex curve lies underneath it
      // everywhere except where they touch, so that corner is always clear board.
      const low = left[1] > right[1] ? left : right;
      prims.push(labelAt(ov.label, [low[0], low[1]], size, pal.accent, el.at, 'below'));
    }
    // The tangent starts level and swings into the slope it is measuring — the
    // motion is the explanation, so it must not simply appear at its final angle.
    const deg = -(Math.atan2(near[1] - far[1], near[0] - far[0]) * 180) / Math.PI;
    return [
      {
        key,
        prims,
        at,
        weight: 0.8,
        center: p,
        sweep: { cx: p[0], cy: p[1], deg: Math.max(-70, Math.min(70, deg)) },
      },
    ];
  }

  if (ov.kind === 'dropline') {
    const p = pointOn(curve, ov.x, m);
    if (!p) return [];
    const axisY = Math.min(m.area.y + m.area.h, Math.max(m.area.y, m.y(m.originY)));
    const axisX = Math.min(m.area.x + m.area.w, Math.max(m.area.x, m.x(m.originX)));
    const dash = Math.max(12 * ctx.scale, sw * 2);
    const prims: PlanPrim[] = [];
    const runs: Pt[][] = [];
    if (ov.to === 'x' || ov.to === 'both') runs.push([p, [p[0], axisY]]);
    if (ov.to === 'y' || ov.to === 'both') runs.push([p, [axisX, p[1]]]);
    for (const run of runs) {
      for (const seg of dashAlong(run, dash, dash * 0.8)) {
        prims.push(
          ...geoms(
            [sketchAlong(rng, st, seg, { amp: 0.35, spacing: dash })],
            pal.inkSoft,
            sw * 0.5,
            ctx.alpha,
          ),
        );
      }
    }
    return [{ key, prims, at, weight: 0.5, center: p }];
  }

  if (ov.kind === 'shade') {
    const other = ov.toCurveId ? curveById(el, ov.toCurveId) : null;
    const lo = Math.min(ov.fromX, ov.toX);
    const hi = Math.max(ov.fromX, ov.toX);
    if (!(hi > lo)) return [];
    const steps = 26;
    const top: Pt[] = [];
    const bottom: Pt[] = [];
    const axisY = Math.min(m.area.y + m.area.h, Math.max(m.area.y, m.y(m.originY)));
    for (let i = 0; i <= steps; i++) {
      const x = lo + ((hi - lo) * i) / steps;
      const a = curveAt(curve, x);
      if (a === null) continue;
      top.push([m.x(x), Math.max(m.area.y, Math.min(m.area.y + m.area.h, m.y(a)))]);
      const b = other ? curveAt(other, x) : null;
      bottom.push([
        m.x(x),
        b === null ? axisY : Math.max(m.area.y, Math.min(m.area.y + m.area.h, m.y(b))),
      ]);
    }
    if (top.length < 2) return [];
    const poly = [...top, ...bottom.reverse()];
    const gap = Math.max(sw * 3.2, 18 * ctx.scale);
    const prims = hachurePolygon(rng, st, poly, gap).map((d) =>
      geom(d, pal.accent, sw * 0.45, { opacity: 0.3, noDash: true }),
    );
    const mid = top[Math.floor(top.length / 2)] as Pt;
    return [{ key, prims, at, weight: 0.8, center: mid }];
  }

  // steps — the descent itself, one move at a time so the learner can count them.
  const xs = ov.xs;
  const phases: PlotPhase[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = pointOn(curve, xs[i] as number, m);
    const b = pointOn(curve, xs[i + 1] as number, m);
    if (!a || !b) continue;
    const prims: PlanPrim[] = [dotPrim(a[0], a[1], dotR * 0.85, pal.accent, sw * 0.35)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const head = Math.max(9 * ctx.scale, Math.min(len * 0.3, 24 * ctx.scale));
    const shaft: Pt = [b[0] - (dx / len) * head * 0.5, b[1] - (dy / len) * head * 0.5];
    prims.push(...geoms(sketchLine(rng, st, a, shaft, 1), pal.accent, sw * 0.7, ctx.alpha));
    prims.push(
      ...geoms(
        sketchArrowHead(rng, st, [b[0], b[1]], Math.atan2(dy, dx), head),
        pal.accent,
        sw * 0.7,
        ctx.alpha,
      ),
    );
    if (i === xs.length - 2) prims.push(dotPrim(b[0], b[1], dotR, pal.accent, sw * 0.4));
    if (ov.label && i === 0) {
      prims.push(labelAt(ov.label, [a[0], a[1] - dotR * 2], size, pal.accent, el.at, 'above'));
    }
    phases.push({
      key: `${key}s${i}`,
      prims,
      at: i === 0 ? at : null,
      weight: 0.45,
      center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
    });
  }
  return phases;
}

/**
 * The whole plot, as an ordered list of independently timed phases.
 *
 * Order is fixed: axes, then curves in declaration order, then overlays in
 * declaration order. An overlay with `at > 0` is pinned to that fraction of the
 * narration; one left at the default is sequenced after whatever precedes it.
 */
export function plotPhases(el: PlotElement, ctx: PlotContext): PlotPhase[] {
  const m = plotMap(el, ctx);
  const rng = new Rng(seedOf(el.id, 'plot'));
  const phases: PlotPhase[] = [axisPhase(el, m, ctx, rng)];
  for (const c of el.curves) {
    const phase = curvePhase(c, el, m, ctx, rng);
    if (phase) phases.push(phase);
  }
  el.overlays.forEach((ov, i) => {
    phases.push(...overlayPhases(ov, i, el, m, ctx, rng));
  });
  const kept = phases.filter((p) => p.prims.length > 0);
  deconflictLabels(kept, el, m);
  return kept;
}

/* ------------------------------------------------------- label deconfliction */

/** A `TextPrim` narrowed to the one field this pass rewrites. */
type LabelPrim = { kind: 'text'; box: Rect };

/**
 * Move labels off each other and off the ink they name.
 *
 * Every label site in this file is chosen from local geometry — "above the dot",
 * "below the downhill end of the tangent", "inside the bowl" — and each choice is
 * right in isolation. Together they are not: a plot is built by independent
 * phases that never see one another, so a point label, an annotation and a curve
 * name all converge on whatever corner is empty *for them*. The benchmark render
 * printed "the bottom" through the y-axis, "how wrong we are here" across the
 * curve, "uphill is right, so step left" over "downhill", and "too small" /
 * "too large" through each other in the learning-rate comparison. Overlapping
 * handwriting is not a blemish; it is the point of the beat becoming unreadable.
 *
 * One deterministic pass over the finished phases in draw order, so earlier ink
 * wins and later labels dodge. Candidates are tried nearest-first and clamped
 * inside the element, so a nudge can never push a label out of frame; if nothing
 * clears, the least-bad candidate is taken rather than leaving a collision.
 *
 * (The `@inkcast/visuals` plot resolver has a richer version of this. It cannot
 * help here: nothing reads its output — see `docs/STATUS.md`.)
 */
function deconflictLabels(phases: readonly PlotPhase[], el: PlotElement, m: PlotMap): void {
  const labels: Array<{ prim: LabelPrim; box: Rect }> = [];
  const ink: Array<[number, number]> = [];

  for (const phase of phases) {
    for (const prim of phase.prims) {
      if (prim.kind === 'text') {
        labels.push({ prim: prim as LabelPrim, box: { ...prim.box } });
      } else if (prim.kind === 'geom') {
        // Ink is an obstacle at the resolution of its own segments: a curve's
        // bounding box is the whole plot, which would leave nowhere legal.
        for (const sub of flattenPathData(prim.d, 8)) for (const p of sub) ink.push(p);
      }
    }
  }
  if (labels.length < 1) return;

  const placed: Rect[] = [];
  const pad = Math.max(2, m.area.h * 0.012);

  for (const slot of labels) {
    const gap = slot.box.h * 0.55;
    const stepX = slot.box.w * 0.6 + gap;
    const stepY = slot.box.h + gap;
    // Nearest-first: stay put, then step off in the four directions, then the
    // diagonals, then a full label further. Vertical before horizontal, because a
    // label that keeps its x still points at the thing it names.
    const offsets: Array<[number, number]> = [
      [0, 0],
      [0, -stepY],
      [0, stepY],
      [-stepX, 0],
      [stepX, 0],
      [-stepX, -stepY],
      [stepX, -stepY],
      [-stepX, stepY],
      [stepX, stepY],
      [0, -2 * stepY],
      [0, 2 * stepY],
    ];
    let best: { box: Rect; cost: number } | undefined;
    for (const [dx, dy] of offsets) {
      const box = clampBox(
        { x: slot.box.x + dx, y: slot.box.y + dy, w: slot.box.w, h: slot.box.h },
        el.at,
      );
      const cost = collisionCost(box, placed, ink, pad);
      if (cost === 0) {
        best = { box, cost };
        break;
      }
      if (!best || cost < best.cost) best = { box, cost };
    }
    const box = best ? best.box : slot.box;
    slot.prim.box = box;
    placed.push(box);
  }
}

/**
 * How badly a candidate box collides: overlap area against labels already placed,
 * plus a charge per stroke sample underneath it.
 *
 * Label-on-label is weighted far above label-on-ink, because two runs of
 * handwriting on top of each other are illegible whereas a word crossing one
 * stroke is merely untidy — and on a full plot some contact with ink is often
 * unavoidable.
 */
function collisionCost(
  box: Rect,
  placed: readonly Rect[],
  ink: readonly [number, number][],
  pad: number,
): number {
  const grown = { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };
  let cost = 0;
  for (const other of placed) {
    const ox = Math.min(grown.x + grown.w, other.x + other.w) - Math.max(grown.x, other.x);
    const oy = Math.min(grown.y + grown.h, other.y + other.h) - Math.max(grown.y, other.y);
    if (ox > 0 && oy > 0) cost += 40 * ox * oy;
  }
  const perHit = Math.max(1, box.w * box.h) * 0.02;
  for (const [x, y] of ink) {
    if (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) cost += perHit;
  }
  return cost;
}
