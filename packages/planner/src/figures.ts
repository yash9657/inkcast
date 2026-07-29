/**
 * Freeform drawings built from `path` elements.
 *
 * `plot` covers everything with axes; this module covers everything that needs
 * to look *drawn* — a hillside, a walker on it, fog, a ball, a bowl, a bracket
 * of rain. It exists because the MVP's vocabulary (text, icons, rectangles)
 * could not open a video with "you are on a foggy hillside", and an anchor the
 * learner cannot see is not an anchor.
 *
 * Everything here is pure geometry in absolute canvas units: local, free,
 * deterministic, and available with no API key. The visuals stage roughens the
 * strokes so they read as marker on a whiteboard rather than as vector art.
 */
import type { PathElement } from '@inkcast/core';
import type { Box, Point } from './elements.js';
import { round } from './curves.js';

export type PathInit = {
  closed?: boolean;
  fill?: boolean;
  weight?: number;
  persist?: boolean;
};

export function boundsOf(points: Point[], pad = 0): Box {
  if (!points.length) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return {
    x: round(x0 - pad, 2),
    y: round(y0 - pad, 2),
    w: round(Math.max(2, x1 - x0 + pad * 2), 2),
    h: round(Math.max(2, y1 - y0 + pad * 2), 2),
  };
}

/** A `path` element whose box is exactly the ink it contains. */
export function makePath(id: string, points: Point[], o: PathInit = {}): PathElement {
  const pts = points.map((p) => ({ x: round(p.x, 2), y: round(p.y, 2) }));
  return {
    id,
    type: 'path',
    points: pts,
    closed: o.closed ?? false,
    fill: o.fill ?? false,
    weight: o.weight ?? 1,
    at: boundsOf(pts, o.weight === undefined ? 3 : Math.max(3, o.weight * 3)),
    enter: { at: 0, duration: 0.9, style: 'draw' },
    persist: o.persist ?? true,
  };
}

export function circlePoints(cx: number, cy: number, r: number, n = 16): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    out.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
  }
  return out;
}

/* ------------------------------------------------------------------ hillside */

/**
 * The profile of a hill that falls into a valley, as a fraction of the box.
 *
 * A single parabola would read as a bowl, which is the *abstraction* we have not
 * earned yet at the hook. This is a hillside: high and steep on the left, easing
 * into a floor, with a small rise on the far right so the low point reads as a
 * valley you could be standing above rather than the end of the world.
 */
export function hillProfile(t: number): number {
  const bottom = 0.78;
  const k = t <= bottom ? (t / bottom) ** 1.6 : ((t - bottom) / (1 - bottom)) ** 2 * 0.22;
  return t <= bottom ? 1 - k : k;
}

/** A drawn hillside across `box`, left high, valley at ~78% across. */
export function hillPath(id: string, box: Box, n = 44): PathElement {
  const points: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    points.push({ x: box.x + t * box.w, y: box.y + (1 - hillProfile(t)) * box.h });
  }
  return makePath(id, points, { weight: 1.35 });
}

/** Where a walker standing at `t` across the hill has their feet. */
export function hillPoint(box: Box, t: number): Point {
  const clamped = Math.min(1, Math.max(0, t));
  return {
    x: round(box.x + clamped * box.w, 2),
    y: round(box.y + (1 - hillProfile(clamped)) * box.h, 2),
  };
}

/**
 * A stick walker whose feet sit on `feet`, facing downhill.
 *
 * Several strokes rather than one: a head, a spine, two legs mid-stride and one
 * arm. The renderer draws them in order, so the figure assembles the way a
 * person would draw it.
 */
export function walkerPaths(
  idPrefix: string,
  feet: Point,
  height: number,
  facing: 1 | -1 = 1,
): PathElement[] {
  const h = Math.max(48, height);
  const headR = h * 0.16;
  const hip = { x: feet.x, y: feet.y - h * 0.46 };
  const neck = { x: feet.x + facing * h * 0.04, y: feet.y - h * 0.7 };
  const head = { x: neck.x + facing * h * 0.03, y: neck.y - headR * 1.05 };
  return [
    makePath(`${idPrefix}_head`, circlePoints(head.x, head.y, headR, 14), {
      closed: true,
      weight: 1.1,
    }),
    makePath(`${idPrefix}_spine`, [neck, hip], { weight: 1.2 }),
    makePath(
      `${idPrefix}_legs`,
      [
        { x: hip.x - facing * h * 0.16, y: feet.y + 2 },
        hip,
        { x: hip.x + facing * h * 0.2, y: feet.y - h * 0.04 },
      ],
      { weight: 1.2 },
    ),
    makePath(
      `${idPrefix}_arm`,
      [
        { x: neck.x - facing * h * 0.14, y: neck.y + h * 0.16 },
        { x: neck.x + facing * h * 0.02, y: neck.y + h * 0.04 },
        { x: neck.x + facing * h * 0.19, y: neck.y + h * 0.13 },
      ],
      { weight: 1.1 },
    ),
  ];
}

/** Horizontal wisps of fog across a box — drawn thin, so they read as air. */
export function fogPaths(idPrefix: string, box: Box, rows = 3): PathElement[] {
  const out: PathElement[] = [];
  for (let r = 0; r < rows; r++) {
    const y = box.y + box.h * (0.18 + r * 0.17);
    const amp = box.h * 0.022;
    const inset = box.w * (r % 2 === 0 ? 0.04 : 0.14);
    const points: Point[] = [];
    const steps = 22;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      points.push({
        x: box.x + inset + t * (box.w - inset * 2),
        y: y + Math.sin(t * Math.PI * 3 + r) * amp,
      });
    }
    out.push(makePath(`${idPrefix}_${r}`, points, { weight: 0.55 }));
  }
  return out;
}

/** The moving thing: a small filled ball, ready to be given a `motion`. */
export function ballPath(id: string, centre: Point, r = 16): PathElement {
  return makePath(id, circlePoints(centre.x, centre.y, r, 18), {
    closed: true,
    fill: true,
    weight: 1.1,
  });
}

/** A U-shaped bowl — the shape a loss surface has, before it has axes. */
export function bowlPath(id: string, box: Box, n = 36): PathElement {
  const points: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const t = -1 + (2 * i) / n;
    points.push({
      x: box.x + ((t + 1) / 2) * box.w,
      y: box.y + (1 - t * t) * box.h * 0.96,
    });
  }
  return makePath(id, points, { weight: 1.3 });
}

/** A closed container, for "everything inside this is one thing". */
export function blobPath(id: string, box: Box, seed = 1): PathElement {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const points: Point[] = [];
  const n = 26;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const wobble = 1 + 0.07 * Math.sin(t * 3 + seed) + 0.04 * Math.cos(t * 5 - seed);
    points.push({
      x: cx + Math.cos(t) * (box.w / 2) * wobble,
      y: cy + Math.sin(t) * (box.h / 2) * wobble,
    });
  }
  return makePath(id, points, { closed: true, weight: 1.15 });
}

/** A downhill/uphill chevron used as a hand-drawn direction cue. */
export function chevronPath(id: string, from: Point, to: Point): PathElement {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / len;
  const uy = dy / len;
  const wing = Math.min(26, len * 0.32);
  return makePath(
    id,
    [
      { x: to.x - ux * wing - uy * wing * 0.6, y: to.y - uy * wing + ux * wing * 0.6 },
      to,
      { x: to.x - ux * wing + uy * wing * 0.6, y: to.y - uy * wing - ux * wing * 0.6 },
    ],
    { weight: 1.2 },
  );
}
