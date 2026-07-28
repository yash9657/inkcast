/**
 * Deterministic hand-drawn geometry.
 *
 * Every stroke is produced from a seeded PRNG, so the same element id always
 * yields byte-identical path data — in this process, in the next one, and in all
 * four capture workers at once. That is a hard requirement: the workers each
 * compile nothing (they share one plan), but a re-render must match the poster
 * frame and the studio preview exactly.
 *
 * Output is always an array of `d` strings, one per pen stroke, in the order a
 * hand would lay them down. The renderer reveals them with stroke-dashoffset, so
 * "one stroke" and "one path" must be the same thing.
 */
import type { Rect } from './types.js';

export type Pt = [number, number];

export type SketchStyle = {
  roughness: number;
  bowing: number;
  passes: number;
  /** Canvas-unit scale: 1 for a 1920×1080 board, 2 for a 3840×2160 one. */
  scale: number;
};

/* --------------------------------------------------------------------- rng */

/** mulberry32 — small, fast, and identical across Node versions and platforms. */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }

  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [a, b). */
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  /** Uniform in [-a, a). */
  sym(a: number): number {
    return (this.next() * 2 - 1) * a;
  }
}

/** FNV-1a over the concatenated parts — stable, cheap, well distributed. */
export function seedOf(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= 0x2f;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/* ------------------------------------------------------------------ format */

/** 2dp is well below a pixel at every zoom we ship, and keeps `d` strings short. */
function n(v: number): string {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
}

function moveTo(p: Pt): string {
  return `M${n(p[0])} ${n(p[1])}`;
}

function curveTo(c1: Pt, c2: Pt, p: Pt): string {
  return `C${n(c1[0])} ${n(c1[1])} ${n(c2[0])} ${n(c2[1])} ${n(p[0])} ${n(p[1])}`;
}

/* ------------------------------------------------------------------ strokes */

/**
 * One sketched line: endpoints nudged, and a perpendicular bow through two
 * control points so a "straight" line is never actually straight.
 */
function onePass(rng: Rng, st: SketchStyle, a: Pt, b: Pt, bowSign: number): string {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1e-6;
  const ux = dx / len;
  const uy = dy / len;
  // Perpendicular.
  const px = -uy;
  const py = ux;

  // Longer lines wobble proportionally less — a hand steadies over distance.
  const gain =
    len > 500 * st.scale ? 0.45 : len > 200 * st.scale ? 1.15 - len / (900 * st.scale) : 1;
  const amp = st.roughness * st.scale * 2.1 * gain;
  // Bowing is deliberately restrained: enough that nothing is machine-straight,
  // little enough that a rectangle does not look pinched in the middle.
  const bow = st.bowing * st.scale * Math.min(8, len / (46 * st.scale)) * gain * bowSign;

  const s: Pt = [a[0] + rng.sym(amp * 0.85), a[1] + rng.sym(amp * 0.85)];
  const e: Pt = [b[0] + rng.sym(amp * 0.85), b[1] + rng.sym(amp * 0.85)];
  const b1 = bow * rng.range(0.7, 1.25);
  const b2 = bow * rng.range(0.55, 1.05);
  const c1: Pt = [
    a[0] + ux * len * 0.32 + px * b1 + rng.sym(amp),
    a[1] + uy * len * 0.32 + py * b1 + rng.sym(amp),
  ];
  const c2: Pt = [
    a[0] + ux * len * 0.68 + px * b2 + rng.sym(amp),
    a[1] + uy * len * 0.68 + py * b2 + rng.sym(amp),
  ];
  return `${moveTo(s)} ${curveTo(c1, c2, e)}`;
}

export function sketchLine(rng: Rng, st: SketchStyle, a: Pt, b: Pt, passes = st.passes): string[] {
  const out: string[] = [];
  for (let i = 0; i < Math.max(1, passes); i++) {
    out.push(onePass(rng, st, a, b, i % 2 === 0 ? 1 : -0.7));
  }
  return out;
}

/** Extend a segment past both ends, the way a hand overshoots a corner. */
function overshoot(rng: Rng, st: SketchStyle, a: Pt, b: Pt, amount: number): [Pt, Pt] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1e-6;
  const ux = dx / len;
  const uy = dy / len;
  const o1 = rng.range(0, amount) * st.scale;
  const o2 = rng.range(0, amount) * st.scale;
  return [
    [a[0] - ux * o1, a[1] - uy * o1],
    [b[0] + ux * o2, b[1] + uy * o2],
  ];
}

/* ------------------------------------------------------------------- curves */

/** Catmull-Rom through the points, emitted as cubic béziers. */
export function curveThrough(pts: Pt[], closed: boolean): string {
  if (pts.length < 2) return '';
  const at = (i: number): Pt => {
    const len = pts.length;
    const j = closed ? ((i % len) + len) % len : Math.max(0, Math.min(len - 1, i));
    return pts[j] as Pt;
  };
  let d = moveTo(at(0));
  const last = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` ${curveTo(c1, c2, p2)}`;
  }
  return d;
}

/** A jittered smooth curve through waypoints — used for arrows and edges. */
export function sketchCurve(rng: Rng, st: SketchStyle, pts: Pt[], passes = st.passes): string[] {
  const amp = st.roughness * st.scale * 1.9;
  const out: string[] = [];
  for (let p = 0; p < Math.max(1, passes); p++) {
    const jittered = pts.map((q, i) => {
      const k = i === 0 || i === pts.length - 1 ? 0.6 : 1;
      return [q[0] + rng.sym(amp * k), q[1] + rng.sym(amp * k)] as Pt;
    });
    out.push(curveThrough(jittered, false));
  }
  return out;
}

/* ------------------------------------------------------------------- shapes */

export function sketchRect(rng: Rng, st: SketchStyle, r: Rect, passes = st.passes): string[] {
  const tl: Pt = [r.x, r.y];
  const tr: Pt = [r.x + r.w, r.y];
  const br: Pt = [r.x + r.w, r.y + r.h];
  const bl: Pt = [r.x, r.y + r.h];
  const edges: [Pt, Pt][] = [
    [tl, tr],
    [tr, br],
    [br, bl],
    [bl, tl],
  ];
  const out: string[] = [];
  for (const [a, b] of edges) {
    const [a2, b2] = overshoot(rng, st, a, b, 3.5 * st.roughness);
    out.push(...sketchLine(rng, st, a2, b2, passes));
  }
  return out;
}

/**
 * A sketched ellipse: points sampled around the rim with radial jitter, closed
 * with a deliberate overshoot so the ends cross like a real drawn loop.
 */
export function sketchEllipse(
  rng: Rng,
  st: SketchStyle,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  passes = st.passes,
): string[] {
  const steps = Math.max(
    10,
    Math.min(26, Math.round((Math.abs(rx) + Math.abs(ry)) / (14 * st.scale))),
  );
  const amp = st.roughness * st.scale * 2.4;
  const out: string[] = [];
  for (let p = 0; p < Math.max(1, passes); p++) {
    const start =
      rng.range(-0.45, 0.45) + (p === 0 ? -Math.PI / 2 : -Math.PI / 2 + rng.range(0.2, 0.7));
    const sweep = Math.PI * 2 + rng.range(0.12, 0.42);
    const pts: Pt[] = [];
    for (let i = 0; i <= steps; i++) {
      const a = start + (sweep * i) / steps;
      const jr = 1 + rng.sym(amp / Math.max(12, Math.min(rx, ry)));
      pts.push([
        cx + Math.cos(a) * rx * jr + rng.sym(amp * 0.35),
        cy + Math.sin(a) * ry * jr + rng.sym(amp * 0.35),
      ]);
    }
    out.push(curveThrough(pts, false));
  }
  return out;
}

/**
 * A curly brace filling the box: the flat side runs along the box's long axis and
 * the tip points at the middle of the opposite side, so a `bracket` element
 * brackets exactly the region its `at` box covers.
 */
export function sketchBracket(rng: Rng, st: SketchStyle, r: Rect): string[] {
  const pts: Pt[] = [];
  if (r.h >= r.w) {
    // Vertical brace: spine on the left, tip pointing right.
    const midY = r.y + r.h / 2;
    pts.push(
      [r.x, r.y],
      [r.x + r.w * 0.42, r.y + r.h * 0.03],
      [r.x + r.w * 0.5, r.y + r.h * 0.22],
      [r.x + r.w * 0.55, midY - r.h * 0.06],
      [r.x + r.w, midY],
      [r.x + r.w * 0.55, midY + r.h * 0.06],
      [r.x + r.w * 0.5, r.y + r.h * 0.78],
      [r.x + r.w * 0.42, r.y + r.h * 0.97],
      [r.x, r.y + r.h],
    );
  } else {
    // Horizontal brace: spine along the top, tip pointing down.
    const midX = r.x + r.w / 2;
    pts.push(
      [r.x, r.y],
      [r.x + r.w * 0.03, r.y + r.h * 0.42],
      [r.x + r.w * 0.22, r.y + r.h * 0.5],
      [midX - r.w * 0.06, r.y + r.h * 0.55],
      [midX, r.y + r.h],
      [midX + r.w * 0.06, r.y + r.h * 0.55],
      [r.x + r.w * 0.78, r.y + r.h * 0.5],
      [r.x + r.w * 0.97, r.y + r.h * 0.42],
      [r.x + r.w, r.y],
    );
  }
  return sketchCurve(rng, st, pts, 1);
}

/** Two head strokes for an arrow whose tip points along `dir` (radians). */
export function sketchArrowHead(
  rng: Rng,
  st: SketchStyle,
  tip: Pt,
  dir: number,
  size: number,
): string[] {
  const spread = 0.42;
  const out: string[] = [];
  for (const sign of [1, -1]) {
    const a = dir + Math.PI + sign * spread + rng.sym(0.07);
    const len = size * rng.range(0.86, 1.1);
    const end: Pt = [tip[0] + Math.cos(a) * len, tip[1] + Math.sin(a) * len];
    out.push(...sketchLine(rng, st, tip, end, 1));
  }
  return out;
}

/* ------------------------------------------------------------------ hachure */

function rot(p: Pt, c: number, s: number): Pt {
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
}

/**
 * Parallel fill strokes clipped to a convex polygon, via a scanline in the
 * rotated frame. Used for `fill: true` shapes — a sketchy hatch, never a
 * flat block of colour.
 */
export function hachurePolygon(
  rng: Rng,
  st: SketchStyle,
  poly: Pt[],
  gap: number,
  angleDeg = -41,
): string[] {
  if (poly.length < 3 || gap <= 0) return [];
  const a = (angleDeg * Math.PI) / 180;
  const c = Math.cos(-a);
  const s = Math.sin(-a);
  const local = poly.map((p) => rot(p, c, s));
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of local) {
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  const back = Math.cos(a);
  const backS = Math.sin(a);
  const out: string[] = [];
  for (let y = minY + gap * 0.6; y < maxY; y += gap) {
    const xs: number[] = [];
    for (let i = 0; i < local.length; i++) {
      const p1 = local[i] as Pt;
      const p2 = local[(i + 1) % local.length] as Pt;
      if (p1[1] === p2[1]) continue;
      const lo = Math.min(p1[1], p2[1]);
      const hi = Math.max(p1[1], p2[1]);
      if (y < lo || y >= hi) continue;
      xs.push(p1[0] + ((y - p1[1]) * (p2[0] - p1[0])) / (p2[1] - p1[1]));
    }
    xs.sort((u, v) => u - v);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const x1 = xs[i] as number;
      const x2 = xs[i + 1] as number;
      if (x2 - x1 < gap * 0.35) continue;
      const p1 = rot([x1 + rng.sym(gap * 0.18), y], back, backS);
      const p2 = rot([x2 + rng.sym(gap * 0.18), y], back, backS);
      out.push(...sketchLine(rng, st, p1, p2, 1));
    }
  }
  return out;
}

/** Hachure inside an ellipse: scanline in unit-circle space, mapped back. */
export function hachureEllipse(
  rng: Rng,
  st: SketchStyle,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  gap: number,
  angleDeg = -41,
): string[] {
  if (rx <= 0 || ry <= 0 || gap <= 0) return [];
  const a = (angleDeg * Math.PI) / 180;
  // Hachure direction in ellipse space -> circle space (affine maps keep parallels).
  let dx = Math.cos(a) / rx;
  let dy = Math.sin(a) / ry;
  const dl = Math.hypot(dx, dy) || 1e-6;
  dx /= dl;
  dy /= dl;
  const px = -dy;
  const py = dx;
  const step = gap / Math.max(rx, ry);
  const out: string[] = [];
  for (let s = -1 + step * 0.7; s < 1; s += step) {
    const half = Math.sqrt(Math.max(0, 1 - s * s));
    if (half < step * 0.4) continue;
    const p1: Pt = [cx + (px * s - dx * half) * rx, cy + (py * s - dy * half) * ry];
    const p2: Pt = [cx + (px * s + dx * half) * rx, cy + (py * s + dy * half) * ry];
    out.push(...sketchLine(rng, st, p1, p2, 1));
  }
  return out;
}

/** Corner points of a rect, for `hachurePolygon`. */
export function rectPoly(r: Rect): Pt[] {
  return [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x + r.w, r.y + r.h],
    [r.x, r.y + r.h],
  ];
}
