/**
 * SVG plumbing: a real path-data parser, exact-enough length/bbox measurement,
 * affine transforms, and a minimal serialiser.
 *
 * Everything the renderer needs to reveal a stroke ("stroke-dasharray:L L;
 * stroke-dashoffset:L→0") depends on knowing L, so length estimation is a
 * first-class citizen here rather than something the renderer guesses at.
 *
 * Zero dependencies on purpose — this module is pure geometry and is the one
 * place in the package that must never fail because a package is missing.
 */

export type Pt = { x: number; y: number };
export type Box = { x: number; y: number; w: number; h: number };

/**
 * Normalised path segment. Every input command (H/V/S/T/Q/A/relative forms) is
 * reduced to absolute M/L/C/Z, which makes transforming, measuring and
 * re-serialising trivial and keeps roughjs happy (its own parser also
 * normalises to cubics).
 */
export type Seg =
  { c: 'M'; p: Pt } | { c: 'L'; p: Pt } | { c: 'C'; p1: Pt; p2: Pt; p: Pt } | { c: 'Z' };

/* ------------------------------------------------------------------ numbers */

/** Round to `p` decimals, killing `-0` and float dust in serialised output. */
export function n(v: number, p = 2): number {
  if (!Number.isFinite(v)) return 0;
  const f = 10 ** p;
  const r = Math.round(v * f) / f;
  return r === 0 ? 0 : r;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/* ---------------------------------------------------------------- tokeniser */

type Tok = { cmd: string } | { num: number; raw: string };

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function tokenizePath(d: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < d.length) {
    const ch = d[i] as string;
    if (ch === ' ' || ch === ',' || ch === '\n' || ch === '\r' || ch === '\t') {
      i++;
      continue;
    }
    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) {
      out.push({ cmd: ch });
      i++;
      continue;
    }
    let j = i;
    if (d[j] === '+' || d[j] === '-') j++;
    while (j < d.length && isDigit(d[j] as string)) j++;
    if (d[j] === '.') {
      j++;
      while (j < d.length && isDigit(d[j] as string)) j++;
    }
    if (d[j] === 'e' || d[j] === 'E') {
      let k = j + 1;
      if (d[k] === '+' || d[k] === '-') k++;
      if (k < d.length && isDigit(d[k] as string)) {
        j = k;
        while (j < d.length && isDigit(d[j] as string)) j++;
      }
    }
    if (j === i) {
      i++; // unparseable character — skip it rather than spin
      continue;
    }
    const raw = d.slice(i, j);
    const v = Number(raw);
    out.push({ num: Number.isFinite(v) ? v : 0, raw });
    i = j;
  }
  return out;
}

class Reader {
  private i = 0;
  private readonly toks: Tok[];
  constructor(toks: Tok[]) {
    this.toks = toks;
  }
  peek(): Tok | undefined {
    return this.toks[this.i];
  }
  /** True when the next token is a number (i.e. an implicit repeat follows). */
  hasNum(): boolean {
    const t = this.toks[this.i];
    return !!t && 'num' in t;
  }
  num(): number {
    const t = this.toks[this.i];
    if (t && 'num' in t) {
      this.i++;
      return t.num;
    }
    this.i++;
    return 0;
  }
  cmd(): string | undefined {
    const t = this.toks[this.i];
    if (t && 'cmd' in t) {
      this.i++;
      return t.cmd;
    }
    return undefined;
  }
  /**
   * Arc flags may be packed against the following number (`a5 5 0 0111 5`), so
   * a flag read can split the token it consumes.
   */
  flag(): boolean {
    const t = this.toks[this.i];
    if (!t || !('num' in t)) {
      this.i++;
      return false;
    }
    const raw = t.raw;
    // A flag is exactly one character, so `106` is flag 1 followed by `06`.
    if (raw.length > 1 && (raw[0] === '0' || raw[0] === '1') && raw[1] !== '.') {
      const head = raw[0] as string;
      const rest = raw.slice(1);
      this.toks[this.i] = { num: Number(rest), raw: rest };
      return head === '1';
    }
    this.i++;
    return t.num !== 0;
  }
}

/* -------------------------------------------------------- arc → cubic beziers */

/** Endpoint-parameterised arc to a list of cubic segments (SVG spec F.6.5). */
export function arcToCubics(
  x1: number,
  y1: number,
  rxIn: number,
  ryIn: number,
  phiDeg: number,
  largeArc: boolean,
  sweep: boolean,
  x2: number,
  y2: number,
): Array<{ p1: Pt; p2: Pt; p: Pt }> {
  if ((x1 === x2 && y1 === y2) || rxIn === 0 || ryIn === 0) {
    return [{ p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 }, p: { x: x2, y: y2 } }];
  }
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  const phi = (phiDeg * Math.PI) / 180;
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);

  const dx2 = (x1 - x2) / 2;
  const dy2 = (y1 - y2) / 2;
  const x1p = cosP * dx2 + sinP * dy2;
  const y1p = -sinP * dx2 + cosP * dy2;

  // Scale radii up if they cannot span the chord.
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }

  const sign = largeArc === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = sign * Math.sqrt(Math.max(0, num / (den || 1)));
  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;

  const cx = cosP * cxp - sinP * cyp + (x1 + x2) / 2;
  const cy = sinP * cxp + cosP * cyp + (y1 + y2) / 2;

  const angle = (ux: number, uy: number, vx: number, vy: number): number => {
    const dot = ux * vx + uy * vy;
    const len = Math.sqrt(ux * ux + uy * uy) * Math.sqrt(vx * vx + vy * vy);
    let a = Math.acos(clamp(len === 0 ? 1 : dot / len, -1, 1));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };

  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI;

  const count = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2)));
  const delta = dTheta / count;
  const t = ((4 / 3) * Math.tan(delta / 4)) as number;
  const out: Array<{ p1: Pt; p2: Pt; p: Pt }> = [];

  let th = theta1;
  let px = x1;
  let py = y1;
  for (let i = 0; i < count; i++) {
    const th2 = th + delta;
    const cos1 = Math.cos(th);
    const sin1 = Math.sin(th);
    const cos2 = Math.cos(th2);
    const sin2 = Math.sin(th2);

    const e1x = cosP * rx * cos1 - sinP * ry * sin1 + cx;
    const e1y = sinP * rx * cos1 + cosP * ry * sin1 + cy;
    const d1x = -cosP * rx * sin1 - sinP * ry * cos1;
    const d1y = -sinP * rx * sin1 + cosP * ry * cos1;

    const e2x = cosP * rx * cos2 - sinP * ry * sin2 + cx;
    const e2y = sinP * rx * cos2 + cosP * ry * sin2 + cy;
    const d2x = -cosP * rx * sin2 - sinP * ry * cos2;
    const d2y = -sinP * rx * sin2 + cosP * ry * cos2;

    out.push({
      p1: { x: (i === 0 ? px : e1x) + t * d1x, y: (i === 0 ? py : e1y) + t * d1y },
      p2: { x: e2x - t * d2x, y: e2y - t * d2y },
      p: { x: e2x, y: e2y },
    });
    th = th2;
    px = e2x;
    py = e2y;
  }
  return out;
}

/* ------------------------------------------------------------------- parsing */

/** Parse any SVG path `d` into absolute M/L/C/Z segments. */
export function parsePath(d: string): Seg[] {
  const r = new Reader(tokenizePath(d));
  const segs: Seg[] = [];
  let cur: Pt = { x: 0, y: 0 };
  let start: Pt = { x: 0, y: 0 };
  let prevCtrl: Pt | undefined;
  let prevQCtrl: Pt | undefined;
  let cmd = '';

  const quadToCubic = (c: Pt, end: Pt): void => {
    segs.push({
      c: 'C',
      p1: { x: cur.x + (2 / 3) * (c.x - cur.x), y: cur.y + (2 / 3) * (c.y - cur.y) },
      p2: { x: end.x + (2 / 3) * (c.x - end.x), y: end.y + (2 / 3) * (c.y - end.y) },
      p: { ...end },
    });
  };

  while (r.peek() !== undefined) {
    const next = r.peek() as Tok;
    if ('cmd' in next) {
      cmd = r.cmd() as string;
    } else if (cmd === '') {
      r.num();
      continue;
    } else if (cmd === 'M') {
      cmd = 'L';
    } else if (cmd === 'm') {
      cmd = 'l';
    }
    const rel = cmd >= 'a' && cmd <= 'z';
    const C = cmd.toUpperCase();
    const bx = rel ? cur.x : 0;
    const by = rel ? cur.y : 0;

    switch (C) {
      case 'M': {
        const p = { x: bx + r.num(), y: by + r.num() };
        segs.push({ c: 'M', p });
        cur = p;
        start = { ...p };
        prevCtrl = prevQCtrl = undefined;
        break;
      }
      case 'L': {
        const p = { x: bx + r.num(), y: by + r.num() };
        segs.push({ c: 'L', p });
        cur = p;
        prevCtrl = prevQCtrl = undefined;
        break;
      }
      case 'H': {
        const p = { x: bx + r.num(), y: cur.y };
        segs.push({ c: 'L', p });
        cur = p;
        prevCtrl = prevQCtrl = undefined;
        break;
      }
      case 'V': {
        const p = { x: cur.x, y: by + r.num() };
        segs.push({ c: 'L', p });
        cur = p;
        prevCtrl = prevQCtrl = undefined;
        break;
      }
      case 'C': {
        const p1 = { x: bx + r.num(), y: by + r.num() };
        const p2 = { x: bx + r.num(), y: by + r.num() };
        const p = { x: bx + r.num(), y: by + r.num() };
        segs.push({ c: 'C', p1, p2, p });
        cur = p;
        prevCtrl = p2;
        prevQCtrl = undefined;
        break;
      }
      case 'S': {
        const p1 = prevCtrl ? { x: 2 * cur.x - prevCtrl.x, y: 2 * cur.y - prevCtrl.y } : { ...cur };
        const p2 = { x: bx + r.num(), y: by + r.num() };
        const p = { x: bx + r.num(), y: by + r.num() };
        segs.push({ c: 'C', p1, p2, p });
        cur = p;
        prevCtrl = p2;
        prevQCtrl = undefined;
        break;
      }
      case 'Q': {
        const c1 = { x: bx + r.num(), y: by + r.num() };
        const p = { x: bx + r.num(), y: by + r.num() };
        quadToCubic(c1, p);
        cur = p;
        prevQCtrl = c1;
        prevCtrl = undefined;
        break;
      }
      case 'T': {
        const c1 = prevQCtrl
          ? { x: 2 * cur.x - prevQCtrl.x, y: 2 * cur.y - prevQCtrl.y }
          : { ...cur };
        const p = { x: bx + r.num(), y: by + r.num() };
        quadToCubic(c1, p);
        cur = p;
        prevQCtrl = c1;
        prevCtrl = undefined;
        break;
      }
      case 'A': {
        const rx = r.num();
        const ry = r.num();
        const rot = r.num();
        const large = r.flag();
        const sweep = r.flag();
        const p = { x: bx + r.num(), y: by + r.num() };
        for (const c of arcToCubics(cur.x, cur.y, rx, ry, rot, large, sweep, p.x, p.y)) {
          segs.push({ c: 'C', p1: c.p1, p2: c.p2, p: c.p });
        }
        cur = p;
        prevCtrl = prevQCtrl = undefined;
        break;
      }
      case 'Z': {
        segs.push({ c: 'Z' });
        cur = { ...start };
        prevCtrl = prevQCtrl = undefined;
        break;
      }
      default:
        // Unknown command: drop its numeric payload so we cannot loop forever.
        while (r.hasNum()) r.num();
        break;
    }
  }
  return segs;
}

export function pathToString(segs: Seg[], precision = 2): string {
  const out: string[] = [];
  for (const s of segs) {
    if (s.c === 'M') out.push(`M${n(s.p.x, precision)} ${n(s.p.y, precision)}`);
    else if (s.c === 'L') out.push(`L${n(s.p.x, precision)} ${n(s.p.y, precision)}`);
    else if (s.c === 'C')
      out.push(
        `C${n(s.p1.x, precision)} ${n(s.p1.y, precision)} ${n(s.p2.x, precision)} ${n(
          s.p2.y,
          precision,
        )} ${n(s.p.x, precision)} ${n(s.p.y, precision)}`,
      );
    else out.push('Z');
  }
  return out.join(' ');
}

/* ---------------------------------------------------------------- transforms */

/** 2D affine matrix, SVG order: [a c e; b d f; 0 0 1]. */
export type Matrix = { a: number; b: number; c: number; d: number; e: number; f: number };

export const identity: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function translateM(tx: number, ty: number): Matrix {
  return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty };
}

export function scaleM(sx: number, sy = sx): Matrix {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
}

/** `m1` applied after `m2` (i.e. the SVG `transform="m1 m2"` composition). */
export function multiply(m1: Matrix, m2: Matrix): Matrix {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

export function applyM(m: Matrix, p: Pt): Pt {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

/** Mirror horizontally about `cx` — used for `AssetElement.flipX`. */
export function flipXM(cx: number): Matrix {
  return { a: -1, b: 0, c: 0, d: 1, e: 2 * cx, f: 0 };
}

/**
 * Rotate by `deg` clockwise about `(cx, cy)` — the pivot form, because every caller
 * wants to turn a limb about a joint rather than about the origin.
 *
 * Clockwise, since y grows downward in SVG and a character rig reads better when a
 * positive angle swings a limb the way a positive angle looks on screen.
 */
export function rotateM(deg: number, cx = 0, cy = 0): Matrix {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return {
    a: cos,
    b: sin,
    c: -sin,
    d: cos,
    e: cx - cx * cos + cy * sin,
    f: cy - cx * sin - cy * cos,
  };
}

/** Uniform fit of `src` into `dst`, centred, with an optional inset. */
export function fitMatrix(src: Box, dst: Box, inset = 0): Matrix {
  const tw = Math.max(1e-6, dst.w - inset * 2);
  const th = Math.max(1e-6, dst.h - inset * 2);
  const s = Math.min(tw / Math.max(1e-6, src.w), th / Math.max(1e-6, src.h));
  const dx = dst.x + inset + (tw - src.w * s) / 2 - src.x * s;
  const dy = dst.y + inset + (th - src.h * s) / 2 - src.y * s;
  return { a: s, b: 0, c: 0, d: s, e: dx, f: dy };
}

export function transformSegs(segs: Seg[], m: Matrix): Seg[] {
  return segs.map((s) =>
    s.c === 'M'
      ? { c: 'M' as const, p: applyM(m, s.p) }
      : s.c === 'L'
        ? { c: 'L' as const, p: applyM(m, s.p) }
        : s.c === 'C'
          ? { c: 'C' as const, p1: applyM(m, s.p1), p2: applyM(m, s.p2), p: applyM(m, s.p) }
          : { c: 'Z' as const },
  );
}

export function transformPath(d: string, m: Matrix, precision = 2): string {
  return pathToString(transformSegs(parsePath(d), m), precision);
}

/* ------------------------------------------------------- measurement (length) */

function cubicPoint(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const dd = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + dd * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + dd * p3.y,
  };
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Samples a cubic densely enough that the chord sum is within ~0.2% of true. */
function cubicSteps(p0: Pt, p1: Pt, p2: Pt, p3: Pt): number {
  const poly = dist(p0, p1) + dist(p1, p2) + dist(p2, p3);
  return clamp(Math.ceil(poly / 3), 6, 48);
}

/**
 * Total drawn length of a path, in user units.
 *
 * `Z` closes back to the subpath start and that closing line is drawn, so it
 * counts. Matches `SVGGeometryElement.getTotalLength()` closely enough that a
 * dash-offset reveal is visually exact.
 */
export function segsLength(segs: Seg[]): number {
  let total = 0;
  let cur: Pt = { x: 0, y: 0 };
  let start: Pt = { x: 0, y: 0 };
  for (const s of segs) {
    if (s.c === 'M') {
      cur = s.p;
      start = s.p;
    } else if (s.c === 'L') {
      total += dist(cur, s.p);
      cur = s.p;
    } else if (s.c === 'C') {
      const steps = cubicSteps(cur, s.p1, s.p2, s.p);
      let prev = cur;
      for (let i = 1; i <= steps; i++) {
        const pt = cubicPoint(cur, s.p1, s.p2, s.p, i / steps);
        total += dist(prev, pt);
        prev = pt;
      }
      cur = s.p;
    } else {
      total += dist(cur, start);
      cur = { ...start };
    }
  }
  return total;
}

export function pathLength(d: string): number {
  return segsLength(parsePath(d));
}

/** Flatten to a polyline — used for bounding boxes and edge clipping. */
export function samplePath(segs: Seg[]): Pt[] {
  const pts: Pt[] = [];
  let cur: Pt = { x: 0, y: 0 };
  let start: Pt = { x: 0, y: 0 };
  for (const s of segs) {
    if (s.c === 'M') {
      cur = s.p;
      start = s.p;
      pts.push(s.p);
    } else if (s.c === 'L') {
      pts.push(s.p);
      cur = s.p;
    } else if (s.c === 'C') {
      const steps = cubicSteps(cur, s.p1, s.p2, s.p);
      for (let i = 1; i <= steps; i++) pts.push(cubicPoint(cur, s.p1, s.p2, s.p, i / steps));
      cur = s.p;
    } else {
      pts.push({ ...start });
      cur = { ...start };
    }
  }
  return pts;
}

export function pointsBBox(pts: Pt[]): Box {
  if (pts.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function segsBBox(segs: Seg[]): Box {
  return pointsBBox(samplePath(segs));
}

export function pathBBox(d: string): Box {
  return segsBBox(parsePath(d));
}

export function unionBox(boxes: Box[]): Box {
  const real = boxes.filter((b) => Number.isFinite(b.x) && Number.isFinite(b.y));
  if (real.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of real) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function padBox(b: Box, pad: number): Box {
  return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
}

export function boxCentre(b: Box): Pt {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

export function containsBox(outer: Box, inner: Box, tolerance = 0.5): boolean {
  return (
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.w <= outer.x + outer.w + tolerance &&
    inner.y + inner.h <= outer.y + outer.h + tolerance
  );
}

/**
 * Where the segment centre→`towards` leaves `box`. Used to stop diagram edges
 * at the node border instead of burying the arrowhead inside the box.
 */
export function clipToBox(box: Box, towards: Pt): Pt {
  const c = boxCentre(box);
  const dx = towards.x - c.x;
  const dy = towards.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const hx = box.w / 2;
  const hy = box.h / 2;
  const tx = dx === 0 ? Infinity : hx / Math.abs(dx);
  const ty = dy === 0 ? Infinity : hy / Math.abs(dy);
  const t = Math.min(tx, ty);
  return { x: c.x + dx * t, y: c.y + dy * t };
}

/* ------------------------------------------------------------------- reader */

/** One drawable child of an SVG, as path data plus the attributes it carried. */
export type SvgChild = {
  /** The element expressed as path data, whatever tag it was authored as. */
  d: string;
  /** Verbatim attributes, so a caller can honour `fill`, `transform`, `data-*`. */
  attrs: Record<string, string>;
};

const CHILD_RE = /<(path|circle|ellipse|rect|line|polyline|polygon)\b([^>]*)>/g;
const ATTR_RE = /([a-zA-Z][a-zA-Z0-9:-]*)\s*=\s*"([^"]*)"/g;

function attrsOf(chunk: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(chunk)) !== null) out[m[1] as string] = m[2] as string;
  return out;
}

function num(a: Record<string, string>, k: string, dflt = 0): number {
  const v = Number(a[k]);
  return Number.isFinite(v) ? v : dflt;
}

function pointsToPath(raw: string, close: boolean): string {
  const nums = (raw.match(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
  const parts: string[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    parts.push(`${i === 0 ? 'M' : 'L'}${nums[i]} ${nums[i + 1]}`);
  }
  if (parts.length === 0) return '';
  return close ? `${parts.join(' ')} Z` : parts.join(' ');
}

/**
 * Every drawable child of an SVG as path data, in document order.
 *
 * `<circle>`/`<rect>`/`<line>`/`<polyline>` are converted rather than skipped — a
 * good third of lucide uses them, and dropping them would silently lose pupils,
 * dots and frames.
 *
 * Deliberately a regex pass and not a parser. The inputs are lucide's generated
 * files and our own hand-authored library, both flat lists of primitives; the cost
 * of that assumption is that a `transform` is *reported* (in `attrs`) rather than
 * applied, so a caller that cares has to say so. `libraryPaths` warns about one.
 */
export function svgChildren(svgText: string): SvgChild[] {
  const out: SvgChild[] = [];
  CHILD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CHILD_RE.exec(svgText)) !== null) {
    const tag = m[1] as string;
    const a = attrsOf(m[2] as string);
    const push = (d: string): void => {
      if (d) out.push({ d, attrs: a });
    };
    switch (tag) {
      case 'path': {
        push(a.d ?? '');
        break;
      }
      case 'circle': {
        const cx = num(a, 'cx');
        const cy = num(a, 'cy');
        const r = num(a, 'r');
        if (r > 0)
          push(`M${cx - r} ${cy}A${r} ${r} 0 1 0 ${cx + r} ${cy}A${r} ${r} 0 1 0 ${cx - r} ${cy}Z`);
        break;
      }
      case 'ellipse': {
        const cx = num(a, 'cx');
        const cy = num(a, 'cy');
        const rx = num(a, 'rx');
        const ry = num(a, 'ry');
        if (rx > 0 && ry > 0)
          push(
            `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`,
          );
        break;
      }
      case 'rect': {
        const x = num(a, 'x');
        const y = num(a, 'y');
        const w = num(a, 'width');
        const h = num(a, 'height');
        const rx = Math.min(num(a, 'rx', num(a, 'ry')), Math.min(w, h) / 2);
        if (w <= 0 || h <= 0) break;
        if (rx > 0) {
          push(
            `M${x + rx} ${y}H${x + w - rx}A${rx} ${rx} 0 0 1 ${x + w} ${y + rx}` +
              `V${y + h - rx}A${rx} ${rx} 0 0 1 ${x + w - rx} ${y + h}` +
              `H${x + rx}A${rx} ${rx} 0 0 1 ${x} ${y + h - rx}` +
              `V${y + rx}A${rx} ${rx} 0 0 1 ${x + rx} ${y}Z`,
          );
        } else {
          push(`M${x} ${y}H${x + w}V${y + h}H${x}Z`);
        }
        break;
      }
      case 'line': {
        push(`M${num(a, 'x1')} ${num(a, 'y1')}L${num(a, 'x2')} ${num(a, 'y2')}`);
        break;
      }
      case 'polyline': {
        push(pointsToPath(a.points ?? '', false));
        break;
      }
      case 'polygon': {
        push(pointsToPath(a.points ?? '', true));
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/** The root `<svg>`'s viewBox, when it declares a usable one. */
export function svgViewBox(svgText: string): Box | undefined {
  const open = /<svg\b([^>]*)>/.exec(svgText);
  if (!open) return undefined;
  const a = attrsOf(open[1] as string);
  const vb = a.viewBox ?? a.viewbox;
  if (vb) {
    const p = (vb.match(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
    if (p.length === 4) {
      const [x, y, w, h] = p as [number, number, number, number];
      if (w > 0 && h > 0) return { x, y, w, h };
    }
  }
  const w = num(a, 'width');
  const h = num(a, 'height');
  return w > 0 && h > 0 ? { x: 0, y: 0, w, h } : undefined;
}

/* --------------------------------------------------------------- serialiser */

export type Attrs = Record<string, string | number | undefined | null | false>;
export type SvgNode = { tag: string; attrs?: Attrs; children?: SvgNode[]; text?: string };

export function el(tag: string, attrs?: Attrs, children?: SvgNode[]): SvgNode {
  return { tag, attrs, children };
}

export function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;');
}

function attrString(attrs: Attrs | undefined): string {
  if (!attrs) return '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    parts.push(` ${k}="${escapeAttr(typeof v === 'number' ? String(n(v, 3)) : v)}"`);
  }
  return parts.join('');
}

/** Minimal, stable serialisation: no XML declaration, no gratuitous whitespace. */
export function serialiseSvg(node: SvgNode, indent = 0): string {
  const pad = '  '.repeat(indent);
  const open = `${pad}<${node.tag}${attrString(node.attrs)}`;
  const kids = node.children?.filter(Boolean) ?? [];
  if (node.text !== undefined && kids.length === 0) {
    // <style> holds CSS, not character data — escaping it would break selectors
    // and url() values.
    const body = node.tag === 'style' ? node.text : escapeText(node.text);
    return `${open}>${body}</${node.tag}>`;
  }
  if (kids.length === 0) return `${open}/>`;
  const inner = kids.map((k) => serialiseSvg(k, indent + 1)).join('\n');
  return `${open}>\n${inner}\n${pad}</${node.tag}>`;
}

export const SVG_NS = 'http://www.w3.org/2000/svg';

/** Wrap children in a root `<svg>` whose viewBox is the content's own box. */
export function svgDocument(opts: {
  viewBox: Box;
  children: SvgNode[];
  attrs?: Attrs;
  defs?: SvgNode[];
  css?: string;
}): string {
  const { viewBox: vb } = opts;
  const defs: SvgNode[] = [];
  if (opts.css) defs.push({ tag: 'style', text: opts.css });
  if (opts.defs?.length) defs.push(...opts.defs);
  const children = defs.length ? [el('defs', undefined, defs), ...opts.children] : opts.children;
  const root = el(
    'svg',
    {
      xmlns: SVG_NS,
      width: n(vb.w),
      height: n(vb.h),
      viewBox: `${n(vb.x)} ${n(vb.y)} ${n(vb.w)} ${n(vb.h)}`,
      ...opts.attrs,
    },
    children,
  );
  return `${serialiseSvg(root)}\n`;
}
