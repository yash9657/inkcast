/**
 * Rectangles, points, and the arithmetic that turns drawn geometry into bounds.
 *
 * This lives in `@inkcast/core` rather than in the renderer because the *camera* needs
 * it (see `./camera.ts`) and the camera has to be derivable by any stage — the visuals
 * stage has to know how big a canvas unit will land on screen before it can resolve
 * geometry the renderer can consume. Anything below is pure arithmetic over the IR:
 * no ink, no style, no drawing decisions.
 *
 * Deliberately *not* everything the renderer's `geom.ts` holds. Polyline traversal,
 * dashing, resampling and easing are render-time concerns that no other stage has any
 * business with, and they stay there. What moved is what the camera reads.
 */

/** A point, as a pair rather than an object: this is hot arithmetic, not IR. */
export type Pt = [number, number];

/** An axis-aligned rectangle in canvas units. Structurally the IR's `Box`. */
export type Rect = { x: number; y: number; w: number; h: number };

export function boundsOfPoints(pts: readonly Pt[]): Rect | null {
  if (pts.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function unionRects(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b ? { ...b } : null;
  if (!b) return { ...a };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

export function unionAll(rects: readonly (Rect | null)[]): Rect | null {
  let out: Rect | null = null;
  for (const r of rects) out = unionRects(out, r);
  return out;
}

export function inflateRect(r: Rect, padX: number, padY = padX): Rect {
  return { x: r.x - padX, y: r.y - padY, w: r.w + padX * 2, h: r.h + padY * 2 };
}

/**
 * Area covered by a set of possibly overlapping rectangles.
 *
 * Used to measure how much of the frame actually carries content: summing areas
 * would double-count a label sitting on a plot and report a full board where
 * there is one. Coordinate compression is exact and, at the handful of elements a
 * scene holds, cheaper than any cleverer sweep.
 */
export function unionArea(rects: readonly Rect[]): number {
  const live = rects.filter((r) => r.w > 0 && r.h > 0);
  if (live.length === 0) return 0;
  const xs = [...new Set(live.flatMap((r) => [r.x, r.x + r.w]))].sort((a, b) => a - b);
  const ys = [...new Set(live.flatMap((r) => [r.y, r.y + r.h]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    const x0 = xs[i] as number;
    const x1 = xs[i + 1] as number;
    for (let j = 0; j + 1 < ys.length; j++) {
      const y0 = ys[j] as number;
      const y1 = ys[j + 1] as number;
      const covered = live.some(
        (r) => r.x <= x0 && r.x + r.w >= x1 && r.y <= y0 && r.y + r.h >= y1,
      );
      if (covered) area += (x1 - x0) * (y1 - y0);
    }
  }
  return area;
}

/** A closed circle as cubic béziers — a dot, a marked point, a trail bead. */
export function circlePath(cx: number, cy: number, r: number): string {
  const k = r * 0.5523;
  const n = (v: number): string => {
    const q = Math.round(v * 100) / 100;
    return Object.is(q, -0) ? '0' : String(q);
  };
  return (
    `M${n(cx - r)} ${n(cy)}` +
    `C${n(cx - r)} ${n(cy - k)} ${n(cx - k)} ${n(cy - r)} ${n(cx)} ${n(cy - r)}` +
    `C${n(cx + k)} ${n(cy - r)} ${n(cx + r)} ${n(cy - k)} ${n(cx + r)} ${n(cy)}` +
    `C${n(cx + r)} ${n(cy + k)} ${n(cx + k)} ${n(cy + r)} ${n(cx)} ${n(cy + r)}` +
    `C${n(cx - k)} ${n(cy + r)} ${n(cx - r)} ${n(cy + k)} ${n(cx - r)} ${n(cy)}Z`
  );
}

function cubicAt(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
  ];
}

function arcPoints(
  from: Pt,
  rx: number,
  ry: number,
  rot: number,
  large: number,
  sweep: number,
  to: Pt,
  steps: number,
): Pt[] {
  // Endpoint -> centre parameterisation, straight out of the SVG spec.
  let rX = Math.abs(rx);
  let rY = Math.abs(ry);
  if (rX === 0 || rY === 0) return [to];
  const phi = (rot * Math.PI) / 180;
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);
  const dx2 = (from[0] - to[0]) / 2;
  const dy2 = (from[1] - to[1]) / 2;
  const x1 = cosP * dx2 + sinP * dy2;
  const y1 = -sinP * dx2 + cosP * dy2;
  const lambda = (x1 * x1) / (rX * rX) + (y1 * y1) / (rY * rY);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rX *= s;
    rY *= s;
  }
  const sign = large === sweep ? -1 : 1;
  const num = rX * rX * rY * rY - rX * rX * y1 * y1 - rY * rY * x1 * x1;
  const den = rX * rX * y1 * y1 + rY * rY * x1 * x1;
  const co = sign * Math.sqrt(Math.max(0, num / (den || 1e-12)));
  const cx1 = (co * rX * y1) / rY;
  const cy1 = (-co * rY * x1) / rX;
  const cx = cosP * cx1 - sinP * cy1 + (from[0] + to[0]) / 2;
  const cy = sinP * cx1 + cosP * cy1 + (from[1] + to[1]) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number): number => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1e-12;
    const a = Math.acos(Math.max(-1, Math.min(1, dot / len)));
    return ux * vy - uy * vx < 0 ? -a : a;
  };
  const theta = angle(1, 0, (x1 - cx1) / rX, (y1 - cy1) / rY);
  let delta = angle((x1 - cx1) / rX, (y1 - cy1) / rY, (-x1 - cx1) / rX, (-y1 - cy1) / rY);
  if (sweep === 0 && delta > 0) delta -= Math.PI * 2;
  if (sweep === 1 && delta < 0) delta += Math.PI * 2;
  const out: Pt[] = [];
  const n = Math.max(2, steps);
  for (let i = 1; i <= n; i++) {
    const a = theta + (delta * i) / n;
    out.push([
      cx + rX * Math.cos(a) * cosP - rY * Math.sin(a) * sinP,
      cy + rX * Math.cos(a) * sinP + rY * Math.sin(a) * cosP,
    ]);
  }
  return out;
}

const PATH_TOKEN = /[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;

/**
 * Flatten SVG path data into polylines, one per subpath.
 *
 * `PathElement.d` is an accepted alternative to `points`, and the renderer has to
 * know where that ink lands: the camera frames the union of what has been drawn,
 * and a path whose extent it cannot measure would be framed out of shot. Curves
 * are sampled rather than approximated so the bounds are tight.
 */
export function flattenPathData(d: string, curveSamples = 14): Pt[][] {
  const tokens = String(d).match(PATH_TOKEN);
  if (!tokens) return [];
  const subs: Pt[][] = [];
  let cur: Pt[] = [];
  let pos: Pt = [0, 0];
  let startPt: Pt = [0, 0];
  let cmd = '';
  let lastCubic: Pt | null = null;
  let lastQuad: Pt | null = null;
  let i = 0;
  const num = (): number => {
    const v = Number(tokens[i++]);
    return Number.isFinite(v) ? v : 0;
  };
  /**
   * Are the next `n` tokens numbers?
   *
   * Path data is not always path data: `d` may be empty, or truncated, or plain
   * prose from a hand-edited storyboard — and single letters inside a word ("a" and
   * "h" in "not a path") are valid commands, so a walker that trusts its input
   * silently produces a run of points at the origin, which then drags the camera's
   * framing to the top-left corner of the canvas.
   */
  const need = (n: number): boolean => {
    for (let k = 0; k < n; k++) {
      const tok = tokens[i + k];
      if (tok === undefined || !/^[-+.\d]/.test(tok)) return false;
    }
    return true;
  };
  const push = (p: Pt): void => {
    cur.push(p);
    pos = p;
  };
  const open = (p: Pt): void => {
    if (cur.length > 1) subs.push(cur);
    cur = [p];
    pos = p;
    startPt = p;
  };
  /** Stop walking and return whatever was fully parsed. */
  const finish = (): Pt[][] => {
    if (cur.length > 1) subs.push(cur);
    return subs;
  };

  while (i < tokens.length) {
    const tok = tokens[i] as string;
    if (/[MmLlHhVvCcSsQqTtAaZz]/.test(tok)) {
      cmd = tok;
      i++;
      if (cmd === 'Z' || cmd === 'z') {
        if (cur.length) {
          cur.push([startPt[0], startPt[1]]);
          pos = startPt;
        }
        continue;
      }
    }
    if (!cmd) break;
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? pos[0] : 0;
    const oy = rel ? pos[1] : 0;
    switch (cmd.toUpperCase()) {
      case 'M': {
        if (!need(2)) return finish();
        const p: Pt = [num() + ox, num() + oy];
        open(p);
        cmd = rel ? 'l' : 'L';
        lastCubic = null;
        lastQuad = null;
        break;
      }
      case 'L': {
        if (!need(2)) return finish();
        push([num() + ox, num() + oy]);
        lastCubic = null;
        lastQuad = null;
        break;
      }
      case 'H': {
        if (!need(1)) return finish();
        push([num() + ox, pos[1]]);
        lastCubic = null;
        lastQuad = null;
        break;
      }
      case 'V': {
        if (!need(1)) return finish();
        push([pos[0], num() + oy]);
        lastCubic = null;
        lastQuad = null;
        break;
      }
      case 'C':
      case 'S': {
        if (!need(cmd.toUpperCase() === 'C' ? 6 : 4)) return finish();
        const p0: Pt = [pos[0], pos[1]];
        let c1: Pt;
        if (cmd.toUpperCase() === 'C') {
          c1 = [num() + ox, num() + oy];
        } else {
          c1 = lastCubic ? [2 * p0[0] - lastCubic[0], 2 * p0[1] - lastCubic[1]] : p0;
        }
        const c2: Pt = [num() + ox, num() + oy];
        const p3: Pt = [num() + ox, num() + oy];
        for (let s = 1; s <= curveSamples; s++) cur.push(cubicAt(p0, c1, c2, p3, s / curveSamples));
        pos = p3;
        lastCubic = c2;
        lastQuad = null;
        break;
      }
      case 'Q':
      case 'T': {
        if (!need(cmd.toUpperCase() === 'Q' ? 4 : 2)) return finish();
        const p0: Pt = [pos[0], pos[1]];
        const q: Pt =
          cmd.toUpperCase() === 'Q'
            ? [num() + ox, num() + oy]
            : lastQuad
              ? [2 * p0[0] - lastQuad[0], 2 * p0[1] - lastQuad[1]]
              : p0;
        const p2: Pt = [num() + ox, num() + oy];
        // A quadratic is a cubic with both controls two-thirds of the way in.
        const c1: Pt = [p0[0] + (2 / 3) * (q[0] - p0[0]), p0[1] + (2 / 3) * (q[1] - p0[1])];
        const c2: Pt = [p2[0] + (2 / 3) * (q[0] - p2[0]), p2[1] + (2 / 3) * (q[1] - p2[1])];
        for (let s = 1; s <= curveSamples; s++) cur.push(cubicAt(p0, c1, c2, p2, s / curveSamples));
        pos = p2;
        lastQuad = q;
        lastCubic = null;
        break;
      }
      case 'A': {
        if (!need(7)) return finish();
        const rx = num();
        const ry = num();
        const rot = num();
        const large = num();
        const sweep = num();
        const to: Pt = [num() + ox, num() + oy];
        for (const p of arcPoints([pos[0], pos[1]], rx, ry, rot, large, sweep, to, curveSamples)) {
          cur.push(p);
        }
        pos = to;
        lastCubic = null;
        lastQuad = null;
        break;
      }
      default:
        i++;
        break;
    }
  }
  if (cur.length > 1) subs.push(cur);
  return subs;
}
