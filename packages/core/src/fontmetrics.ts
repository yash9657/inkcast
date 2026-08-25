/**
 * Real font metrics, parsed straight out of the sfnt tables.
 *
 * This is the repo's ONE text-metrics stack (audit A-4). It lives in core because
 * every stage that reserves, wraps, or letters text has to measure with the same
 * advances: the planner reserving boxes, the visuals stage laying out handwriting,
 * and the renderer placing arrow and diagram labels. Two estimators of one width is
 * how `empty stac` shipped; a char-count times a constant is not a measurement.
 *
 * Rather than pull in a font library, this reads the four tables that matter
 * (`head`, `hhea`, `hmtx`, `cmap`, plus `name`/`OS/2` when present) from the
 * vendored OFL `.ttf`. That works for both TrueType and CFF/OTF outlines because
 * metrics live in the same tables either way, and it costs zero dependencies.
 *
 * If no font file is available (the vendored fonts have not been fetched yet),
 * we degrade to a calibrated per-character width table and say so once — the
 * pipeline must never fail for a missing font. Under the strict gate that
 * degradation blocks in `resolveVisuals`, because approximate widths are exactly
 * the defect this module exists to end.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from './log.js';
import { knownHandStems, stylePackFor } from './stylepack.js';

const log = logger('core:font');

export type FontMetrics = {
  familyName: string;
  source: 'file' | 'builtin';
  /** Absolute path of the font file, when one was found. */
  filePath?: string;
  unitsPerEm: number;
  /** All vertical metrics are in em units (i.e. already divided by upem). */
  ascent: number;
  /** Positive downwards. */
  descent: number;
  lineGap: number;
  capHeight?: number;
  xHeight?: number;
  /** Advance width of a code point, in em. */
  advance(codePoint: number): number;
  /**
   * Whether the face has a real glyph for this code point.
   *
   * For a parsed font this is the cmap, exactly — the same table `advance` consults
   * before silently substituting the space glyph's width for a miss. That substitution
   * is the audit's S4-b: a codepoint the font cannot draw is laid out as if it could,
   * and the board renders tofu or a browser-fallback face with no warning. `covers`
   * is what lets the glyph gate (`glyphgate.ts`) fail loudly *before* layout instead.
   *
   * The builtin table covers printable ASCII only, honestly: its widths were
   * calibrated on Latin prose and it has no cmap to consult for anything else.
   */
  covers(codePoint: number): boolean;
  /** Width of a string at `fontSize`, including optional tracking (em). */
  measure(text: string, fontSize: number, tracking?: number): number;
  /**
   * This code point's outline as SVG path data, in font units with **y up**.
   *
   * `''` for a glyph that draws nothing (the space); `undefined` when the face has no
   * glyph for the code point, when the outlines are CFF rather than `glyf`, or when
   * there is no font file at all. The caller scales and flips — see
   * `glyphContours` below for why the coordinate space stays the font's own.
   *
   * Only the code lane reads this. Handwriting is drawn by the browser from the
   * embedded face, which is the whole point of that lane: letters under a moving
   * mask read as a pen. Code is drawn as filled outlines for the reason `equation.ts`
   * gives — a glyph the browser substituted is a *different* glyph, and in a listing
   * that is a different program.
   */
  outline(codePoint: number): string | undefined;
};

/* --------------------------------------------------------------- sfnt reader */

type Tables = Map<string, { offset: number; length: number }>;

function tag(v: DataView, at: number): string {
  return String.fromCharCode(
    v.getUint8(at),
    v.getUint8(at + 1),
    v.getUint8(at + 2),
    v.getUint8(at + 3),
  );
}

function readTables(v: DataView): Tables {
  let base = 0;
  if (tag(v, 0) === 'ttcf') base = v.getUint32(12);
  const numTables = v.getUint16(base + 4);
  const tables: Tables = new Map();
  for (let i = 0; i < numTables; i++) {
    const rec = base + 12 + i * 16;
    if (rec + 16 > v.byteLength) break;
    tables.set(tag(v, rec), { offset: v.getUint32(rec + 8), length: v.getUint32(rec + 12) });
  }
  return tables;
}

/** cmap subtable → code point → glyph id. Formats 0, 4, 6 and 12. */
function readCmap(v: DataView, cmapOffset: number): Map<number, number> {
  const map = new Map<number, number>();
  const numSub = v.getUint16(cmapOffset + 2);
  let best = -1;
  let bestScore = -1;
  for (let i = 0; i < numSub; i++) {
    const rec = cmapOffset + 4 + i * 8;
    const platform = v.getUint16(rec);
    const encoding = v.getUint16(rec + 2);
    const offset = v.getUint32(rec + 4);
    // Prefer full-repertoire Unicode, then BMP Unicode, then anything.
    const score =
      platform === 3 && encoding === 10
        ? 5
        : platform === 0 && encoding >= 4
          ? 4
          : platform === 3 && encoding === 1
            ? 3
            : platform === 0
              ? 2
              : platform === 3 && encoding === 0
                ? 1
                : 0;
    if (score > bestScore) {
      bestScore = score;
      best = cmapOffset + offset;
    }
  }
  if (best < 0 || best + 4 > v.byteLength) return map;

  const format = v.getUint16(best);
  if (format === 0) {
    for (let c = 0; c < 256; c++) map.set(c, v.getUint8(best + 6 + c));
    return map;
  }
  if (format === 4) {
    const segCount = v.getUint16(best + 6) / 2;
    const endBase = best + 14;
    const startBase = endBase + segCount * 2 + 2;
    const deltaBase = startBase + segCount * 2;
    const rangeBase = deltaBase + segCount * 2;
    for (let s = 0; s < segCount; s++) {
      const end = v.getUint16(endBase + s * 2);
      const start = v.getUint16(startBase + s * 2);
      const delta = v.getInt16(deltaBase + s * 2);
      const rangeOffset = v.getUint16(rangeBase + s * 2);
      if (start > end) continue;
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let gid: number;
        if (rangeOffset === 0) gid = (c + delta) & 0xffff;
        else {
          const gi = rangeBase + s * 2 + rangeOffset + (c - start) * 2;
          if (gi + 2 > v.byteLength) continue;
          const raw = v.getUint16(gi);
          gid = raw === 0 ? 0 : (raw + delta) & 0xffff;
        }
        if (gid !== 0) map.set(c, gid);
      }
    }
    return map;
  }
  if (format === 6) {
    const first = v.getUint16(best + 6);
    const count = v.getUint16(best + 8);
    for (let i = 0; i < count; i++) map.set(first + i, v.getUint16(best + 10 + i * 2));
    return map;
  }
  if (format === 12) {
    const groups = v.getUint32(best + 12);
    const cap = Math.min(groups, 20000);
    for (let g = 0; g < cap; g++) {
      const rec = best + 16 + g * 12;
      if (rec + 12 > v.byteLength) break;
      const start = v.getUint32(rec);
      const end = v.getUint32(rec + 4);
      const startGid = v.getUint32(rec + 8);
      const span = Math.min(end - start, 0xffff);
      for (let i = 0; i <= span; i++) map.set(start + i, startGid + i);
    }
    return map;
  }
  return map;
}

function readName(v: DataView, offset: number): string {
  const count = v.getUint16(offset + 2);
  const stringOffset = offset + v.getUint16(offset + 4);
  let family = '';
  let fullName = '';
  for (let i = 0; i < count; i++) {
    const rec = offset + 6 + i * 12;
    if (rec + 12 > v.byteLength) break;
    const platform = v.getUint16(rec);
    const nameId = v.getUint16(rec + 6);
    const length = v.getUint16(rec + 8);
    const strOff = stringOffset + v.getUint16(rec + 10);
    if (nameId !== 1 && nameId !== 4 && nameId !== 16) continue;
    if (strOff + length > v.byteLength) continue;
    let s = '';
    if (platform === 3 || platform === 0) {
      for (let j = 0; j + 1 < length; j += 2) s += String.fromCharCode(v.getUint16(strOff + j));
    } else {
      for (let j = 0; j < length; j++) s += String.fromCharCode(v.getUint8(strOff + j));
    }
    s = s.replace(/\0/g, '').trim();
    if (!s) continue;
    if (nameId === 16 && !family) family = s;
    else if (nameId === 1 && !family) family = s;
    else if (nameId === 4 && !fullName) fullName = s;
  }
  return family || fullName;
}

/* ---------------------------------------------------------- glyph outlines */

/**
 * TrueType `glyf` outlines, for the one lane that needs exact letterforms.
 *
 * The code lane (plan 6.2) draws a listing as filled glyph outlines rather than as
 * text, for the reason `visuals/src/equation.ts` states about notation: a glyph the
 * browser substituted from a fallback stack is a *different* glyph, and in source code
 * a different glyph is a different program. `l` for `1`, `O` for `0`, a curly quote
 * where a straight one was typed — each of those is the D1 defect wearing a monospace
 * face.
 *
 * This reads `glyf`/`loca` and nothing else, which is the same wager the metrics above
 * make: four tables beat a font library. Two consequences, both deliberate:
 *
 *  - **`glyf` only.** A CFF/OTF face (`OTTO`) has its outlines in a charstring
 *    interpreter's bytecode, which is a second parser of a different shape. There is no
 *    such face in `assets/fonts`, `outline` returns `undefined` for one, and the lane
 *    treats that exactly like a missing font — loudly, and never by falling back to
 *    handwriting.
 *  - **The default instance.** A variable font's `glyf` holds its default named
 *    instance and the axes live in `gvar` as deltas. `JetBrainsMono[wght].ttf` defaults
 *    to Regular, which is the weight a listing wants, so the deltas are not read. Asking
 *    for Bold code would mean a `gvar` interpolator; nothing asks.
 */
type Contour = { x: number; y: number; on: boolean }[];

/** Two decimals, trailing zeros trimmed — font units are integers, composites are not. */
function fu(v: number): string {
  return (Math.round(v * 100) / 100).toString();
}

/**
 * One glyph's contours in font units, y up, composites resolved.
 *
 * Returns contours rather than path data so a composite's 2×2 transform composes on
 * points instead of on a string. `depth` is the recursion guard: a font whose composite
 * references itself is malformed, and the read must end rather than the process.
 */
function glyphContours(
  v: DataView,
  loca: (gid: number) => { start: number; end: number } | undefined,
  glyfOffset: number,
  gid: number,
  depth = 0,
): Contour[] | undefined {
  if (depth > 4) return undefined;
  const range = loca(gid);
  if (!range) return undefined;
  // start === end is a glyph with no outline: the space, and every other blank.
  if (range.end <= range.start) return [];
  let at = glyfOffset + range.start;
  if (at + 10 > v.byteLength) return undefined;
  const numContours = v.getInt16(at);
  at += 10; // past numberOfContours and the four bbox shorts

  if (numContours < 0) {
    /* ---- composite: components placed by offset, and sometimes scaled ---- */
    const out: Contour[] = [];
    for (;;) {
      if (at + 4 > v.byteLength) return undefined;
      const flags = v.getUint16(at);
      const componentGid = v.getUint16(at + 2);
      at += 4;
      const words = (flags & 0x0001) !== 0;
      const xy = (flags & 0x0002) !== 0;
      let dx = 0;
      let dy = 0;
      if (words) {
        dx = xy ? v.getInt16(at) : v.getUint16(at);
        dy = xy ? v.getInt16(at + 2) : v.getUint16(at + 2);
        at += 4;
      } else {
        dx = xy ? v.getInt8(at) : v.getUint8(at);
        dy = xy ? v.getInt8(at + 1) : v.getUint8(at + 1);
        at += 2;
      }
      let a = 1;
      let b = 0;
      let c = 0;
      let d = 1;
      const f2dot14 = (o: number): number => v.getInt16(o) / 16384;
      if ((flags & 0x0008) !== 0) {
        a = d = f2dot14(at);
        at += 2;
      } else if ((flags & 0x0040) !== 0) {
        a = f2dot14(at);
        d = f2dot14(at + 2);
        at += 4;
      } else if ((flags & 0x0080) !== 0) {
        a = f2dot14(at);
        b = f2dot14(at + 2);
        c = f2dot14(at + 4);
        d = f2dot14(at + 6);
        at += 8;
      }
      // ARGS_ARE_XY_VALUES is what every real font sets; point-matching placement is
      // not implemented, and a component using it is dropped rather than mis-placed.
      if (xy) {
        const inner = glyphContours(v, loca, glyfOffset, componentGid, depth + 1);
        if (inner === undefined) return undefined;
        for (const contour of inner) {
          out.push(
            contour.map((p) => ({
              x: a * p.x + c * p.y + dx,
              y: b * p.x + d * p.y + dy,
              on: p.on,
            })),
          );
        }
      }
      if ((flags & 0x0020) === 0) break; // MORE_COMPONENTS
    }
    return out;
  }

  /* ---- simple glyph ---- */
  const ends: number[] = [];
  for (let i = 0; i < numContours; i++) {
    if (at + 2 > v.byteLength) return undefined;
    ends.push(v.getUint16(at));
    at += 2;
  }
  const numPoints = numContours === 0 ? 0 : (ends[ends.length - 1] as number) + 1;
  if (numPoints === 0) return [];
  const instructionLength = v.getUint16(at);
  at += 2 + instructionLength;

  const flags: number[] = [];
  while (flags.length < numPoints) {
    if (at >= v.byteLength) return undefined;
    const f = v.getUint8(at++);
    flags.push(f);
    if ((f & 0x08) !== 0) {
      if (at >= v.byteLength) return undefined;
      let repeat = v.getUint8(at++);
      while (repeat-- > 0 && flags.length < numPoints) flags.push(f);
    }
  }

  const read = (shortBit: number, sameBit: number): number[] | undefined => {
    const vals: number[] = [];
    let acc = 0;
    for (const f of flags) {
      if ((f & shortBit) !== 0) {
        if (at >= v.byteLength) return undefined;
        const d = v.getUint8(at++);
        acc += (f & sameBit) !== 0 ? d : -d;
      } else if ((f & sameBit) === 0) {
        if (at + 2 > v.byteLength) return undefined;
        acc += v.getInt16(at);
        at += 2;
      }
      vals.push(acc);
    }
    return vals;
  };
  const xs = read(0x02, 0x10);
  const ys = read(0x04, 0x20);
  if (!xs || !ys) return undefined;

  const out: Contour[] = [];
  let from = 0;
  for (const end of ends) {
    const contour: Contour = [];
    for (let i = from; i <= end && i < numPoints; i++) {
      contour.push({
        x: xs[i] as number,
        y: ys[i] as number,
        on: ((flags[i] as number) & 0x01) !== 0,
      });
    }
    if (contour.length > 0) out.push(contour);
    from = end + 1;
  }
  return out;
}

/**
 * Contours → SVG path data, quadratic throughout.
 *
 * TrueType stores one control point per curve and lets two consecutive off-curve points
 * imply the on-curve point between them, so the walk has to synthesise those midpoints;
 * a contour that starts off-curve is rotated onto the implied midpoint of its ends. This
 * is the standard reading of the format, and getting it wrong shows up immediately as a
 * letter with a corner where it should have a bowl.
 */
function contoursToPath(contours: Contour[]): string {
  const parts: string[] = [];
  for (const contour of contours) {
    if (contour.length === 0) continue;
    const startIndex = contour.findIndex((p) => p.on);
    let start: { x: number; y: number };
    let order: Contour;
    if (startIndex >= 0) {
      start = contour[startIndex] as { x: number; y: number };
      order = [...contour.slice(startIndex + 1), ...contour.slice(0, startIndex + 1)];
    } else {
      const a = contour[0] as { x: number; y: number };
      const b = contour[contour.length - 1] as { x: number; y: number };
      start = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      order = [...contour, { ...start, on: true }];
    }
    parts.push(`M${fu(start.x)} ${fu(start.y)}`);
    for (let i = 0; i < order.length; i++) {
      const p = order[i] as Contour[number];
      if (p.on) {
        parts.push(`L${fu(p.x)} ${fu(p.y)}`);
        continue;
      }
      const next = order[i + 1];
      if (next === undefined) {
        // An off-curve point with nothing after it curves back to the start.
        parts.push(`Q${fu(p.x)} ${fu(p.y)} ${fu(start.x)} ${fu(start.y)}`);
        break;
      }
      if (next.on) {
        parts.push(`Q${fu(p.x)} ${fu(p.y)} ${fu(next.x)} ${fu(next.y)}`);
        i++;
      } else {
        parts.push(`Q${fu(p.x)} ${fu(p.y)} ${fu((p.x + next.x) / 2)} ${fu((p.y + next.y) / 2)}`);
      }
    }
    parts.push('Z');
  }
  return parts.join('');
}

/** `outline` for a parsed face, memoised per glyph id. `undefined` for a CFF face. */
function outlineReader(
  v: DataView,
  tables: Tables,
  cmap: Map<number, number>,
  head: { offset: number },
): (cp: number) => string | undefined {
  const glyf = tables.get('glyf');
  const locaT = tables.get('loca');
  const maxp = tables.get('maxp');
  if (!glyf || !locaT || !maxp) return () => undefined;
  const longLoca = v.getInt16(head.offset + 50) === 1;
  const numGlyphs = v.getUint16(maxp.offset + 4);
  const loca = (gid: number): { start: number; end: number } | undefined => {
    if (gid < 0 || gid >= numGlyphs) return undefined;
    const at = locaT.offset + (longLoca ? gid * 4 : gid * 2);
    const stride = longLoca ? 4 : 2;
    if (at + stride * 2 > v.byteLength) return undefined;
    return longLoca
      ? { start: v.getUint32(at), end: v.getUint32(at + 4) }
      : { start: v.getUint16(at) * 2, end: v.getUint16(at + 2) * 2 };
  };
  const cache = new Map<number, string | undefined>();
  return (cp) => {
    if (cache.has(cp)) return cache.get(cp);
    const gid = cmap.get(cp);
    const contours = gid === undefined ? undefined : glyphContours(v, loca, glyf.offset, gid);
    const d = contours === undefined ? undefined : contoursToPath(contours);
    cache.set(cp, d);
    return d;
  };
}

/* ------------------------------------------------------------ builtin widths */

/**
 * Per-character advances in em, calibrated against the four OFL handwriting
 * faces we ship (they cluster within ~8% of each other). Only used when no font
 * file is present.
 */
const BUILTIN_WIDTHS: Record<string, number> = {
  ' ': 0.26,
  '!': 0.26,
  '"': 0.34,
  '#': 0.55,
  $: 0.5,
  '%': 0.72,
  '&': 0.62,
  "'": 0.2,
  '(': 0.3,
  ')': 0.3,
  '*': 0.36,
  '+': 0.5,
  ',': 0.24,
  '-': 0.32,
  '.': 0.24,
  '/': 0.34,
  ':': 0.24,
  ';': 0.24,
  '<': 0.5,
  '=': 0.5,
  '>': 0.5,
  '?': 0.42,
  '@': 0.84,
  '[': 0.3,
  '\\': 0.34,
  ']': 0.3,
  '^': 0.42,
  _: 0.5,
  '`': 0.3,
  '{': 0.32,
  '|': 0.22,
  '}': 0.32,
  '~': 0.5,
};

const NARROW = new Set(['i', 'j', 'l', 't', 'f', 'r', 'I']);
const WIDE = new Set(['m', 'w', 'M', 'W']);

function builtinAdvance(cp: number): number {
  const ch = String.fromCodePoint(cp);
  const direct = BUILTIN_WIDTHS[ch];
  if (direct !== undefined) return direct;
  if (cp >= 0x30 && cp <= 0x39) return 0.5;
  if (WIDE.has(ch)) return cp < 0x5b ? 0.86 : 0.8;
  if (NARROW.has(ch)) return 0.28;
  if (cp >= 0x61 && cp <= 0x7a) return 0.47;
  if (cp >= 0x41 && cp <= 0x5a) return 0.62;
  return 0.55;
}

export function builtinMetrics(familyName = 'Inkcast Hand'): FontMetrics {
  const advance = (cp: number): number => builtinAdvance(cp);
  return {
    familyName,
    source: 'builtin',
    unitsPerEm: 1000,
    ascent: 0.86,
    descent: 0.24,
    lineGap: 0.06,
    capHeight: 0.68,
    xHeight: 0.48,
    advance,
    // Printable ASCII is what the width table was calibrated on; claiming more
    // would defeat the glyph gate exactly where it matters most.
    covers: (cp) => cp >= 0x20 && cp <= 0x7e,
    measure: (text, fontSize, tracking = 0) => measureWith(advance, text, fontSize, tracking),
    // No font file, so no letterforms. A width table can fake an advance; it cannot
    // fake an outline, and the code lane is expected to stop rather than invent one.
    outline: () => undefined,
  };
}

function measureWith(
  advance: (cp: number) => number,
  text: string,
  fontSize: number,
  tracking: number,
): number {
  let em = 0;
  let count = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    em += advance(cp);
    count++;
  }
  return (em + Math.max(0, count - 1) * tracking) * fontSize;
}

/* --------------------------------------------------------------- public load */

export function parseFontMetrics(buf: Buffer, filePath?: string): FontMetrics | undefined {
  try {
    const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const sig = tag(v, 0);
    const ok = sig === 'true' || sig === 'ttcf' || sig === 'OTTO' || v.getUint32(0) === 0x00010000;
    if (!ok) return undefined;
    const tables = readTables(v);
    const head = tables.get('head');
    const hhea = tables.get('hhea');
    const hmtx = tables.get('hmtx');
    const cmapT = tables.get('cmap');
    if (!head || !hhea || !hmtx || !cmapT) return undefined;

    const unitsPerEm = v.getUint16(head.offset + 18) || 1000;
    let ascent = v.getInt16(hhea.offset + 4);
    let descent = -v.getInt16(hhea.offset + 6);
    let lineGap = v.getInt16(hhea.offset + 8);
    const numHMetrics = v.getUint16(hhea.offset + 34);

    const os2 = tables.get('OS/2');
    let capHeight: number | undefined;
    let xHeight: number | undefined;
    if (os2 && os2.offset + 90 <= v.byteLength) {
      const version = v.getUint16(os2.offset);
      if (ascent <= 0) {
        ascent = v.getUint16(os2.offset + 74);
        descent = v.getUint16(os2.offset + 76);
        lineGap = v.getInt16(os2.offset + 72);
      }
      if (version >= 2) {
        const x = v.getInt16(os2.offset + 86);
        const c = v.getInt16(os2.offset + 88);
        if (x > 0) xHeight = x / unitsPerEm;
        if (c > 0) capHeight = c / unitsPerEm;
      }
    }

    const widths: number[] = [];
    for (let i = 0; i < numHMetrics; i++) {
      const at = hmtx.offset + i * 4;
      if (at + 2 > v.byteLength) break;
      widths.push(v.getUint16(at));
    }
    const lastWidth = widths.length > 0 ? (widths[widths.length - 1] as number) : unitsPerEm * 0.5;
    const cmap = readCmap(v, cmapT.offset);
    const nameT = tables.get('name');
    const familyName = nameT ? readName(v, nameT.offset) : '';

    const advance = (cp: number): number => {
      const gid = cmap.get(cp);
      if (gid === undefined) return (widths[cmap.get(0x20) ?? 0] ?? lastWidth) / unitsPerEm;
      const w = gid < widths.length ? (widths[gid] as number) : lastWidth;
      return w / unitsPerEm;
    };

    return {
      familyName:
        familyName || path.basename(filePath ?? 'Handwriting', path.extname(filePath ?? '')),
      source: 'file',
      filePath,
      unitsPerEm,
      ascent: ascent / unitsPerEm || 0.86,
      descent: Math.abs(descent) / unitsPerEm || 0.24,
      lineGap: Math.max(0, lineGap) / unitsPerEm,
      capHeight,
      xHeight,
      advance,
      covers: (cp) => cmap.has(cp),
      measure: (text, fontSize, tracking = 0) => measureWith(advance, text, fontSize, tracking),
      outline: outlineReader(v, tables, cmap, head),
    };
  } catch (err) {
    log.debug('font parse failed', err);
    return undefined;
  }
}

const FONT_EXT = new Set(['.ttf', '.otf', '.ttc']);

/**
 * Repo-level `assets/fonts`, resolved relative to this package.
 *
 * Each base is listed twice, flat and with `hand/`, because the vendored faces
 * are filed by role: `assets/fonts/hand/` for the handwriting that goes on the
 * board, `assets/fonts/ui/` for the studio's chrome. `findFontFile` reads a
 * directory without recursing, so the flat path alone finds nothing and every
 * measurement silently falls back to `builtinMetrics()` — text laid out to
 * approximate widths, which shows up as handwriting that overruns its box.
 *
 * **`assets/fonts/code/` is deliberately not in this list**, and the mono face has its
 * own `codeFontDirs()` instead. `findFontFile`'s last resort is "any font at all", so a
 * shared search path would mean a tree with its handwriting faces missing letters the
 * whole board in JetBrains Mono — `source: 'file'`, no warning, and none of the
 * degradations that are supposed to be loud. Two roles, two search paths, and neither
 * lookup can reach the other's file.
 */
export function defaultFontDirs(): string[] {
  const bases = fontBases();
  return bases.flatMap((base) => [base, path.join(base, 'hand')]);
}

function fontBases(): string[] {
  return [
    process.env.INKCAST_FONT_DIR,
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../assets/fonts'), // src/ → repo root
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../assets/fonts'), // dist/src/ → repo root
    path.resolve(process.cwd(), 'assets/fonts'),
  ].filter((p): p is string => !!p);
}

/** Where the code lane's monospace face lives, and nothing else. */
export function codeFontDirs(): string[] {
  return fontBases().map((base) => path.join(base, 'code'));
}

/**
 * Pick the font file for an ink style: the face `docs/research/design-stack.md`
 * assigns it, else any other handwriting face we recognise, else any font at
 * all. Variable fonts ship as `Caveat[wght].ttf`, so matching is on a lowercased
 * de-punctuated stem.
 */
export function findFontFile(
  preferred: string[],
  dirs: string[] = defaultFontDirs(),
): string | undefined {
  // Every face some pack asks for, then the other OFL handwriting faces this repo
  // recognises. Derived rather than listed (plan 7.3) so a fifth pack's face is a
  // fallback candidate for the other four by existing, which is what the four hardcoded
  // stems at the head of this list used to mean.
  const known = [...knownHandStems(), 'kalam', 'indie', 'architects', 'handlee', 'gloria'];
  const candidates: string[] = [];
  for (const dir of dirs) {
    if (!dir || !existsSync(dir)) continue;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e);
      if (!FONT_EXT.has(path.extname(e).toLowerCase())) continue;
      try {
        if (!statSync(full).isFile()) continue;
      } catch {
        continue;
      }
      candidates.push(full);
    }
  }
  if (candidates.length === 0) return undefined;
  const stem = (p: string): string =>
    path
      .basename(p)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  for (const want of preferred) {
    const w = want.toLowerCase().replace(/[^a-z0-9]/g, '');
    const hit = candidates.find((c) => stem(c).includes(w));
    if (hit) return hit;
  }
  for (const w of known) {
    const hit = candidates.find((c) => stem(c).includes(w));
    if (hit) return hit;
  }
  return candidates[0];
}

let warnedMissing = false;

/** Load the handwriting metrics for a face, degrading to the builtin table. */
export function loadFontMetrics(opts: {
  preferred: string[];
  fontFamily: string;
  fontPath?: string;
  dirs?: string[];
}): FontMetrics {
  const explicit = opts.fontPath ?? process.env.INKCAST_FONT;
  const file =
    explicit && existsSync(explicit)
      ? explicit
      : findFontFile(opts.preferred, opts.dirs ?? defaultFontDirs());
  if (file) {
    try {
      const parsed = parseFontMetrics(readFileSync(file), file);
      if (parsed) {
        log.debug(`handwriting face: ${parsed.familyName}`, path.basename(file));
        return parsed;
      }
      log.warn(`could not parse ${path.basename(file)} — using builtin metrics`);
    } catch (err) {
      log.warn(`could not read ${path.basename(file)} — using builtin metrics`, err);
    }
  } else if (!warnedMissing) {
    warnedMissing = true;
    log.info(
      `no handwriting font found in assets/fonts (wanted ${opts.fontFamily}) — using builtin metrics; ` +
        'fetch the OFL fonts to get true hand-lettered text',
    );
  }
  return builtinMetrics(opts.fontFamily);
}

/* ------------------------------------------------------- style → face table */

export type HandFont = {
  /** Preferred font family name for on-canvas text. */
  fontFamily: string;
  /** Filename stems to look for in `assets/fonts`, best first. */
  fontFiles: string[];
  /** Extra letter tracking, in em. Marker needs air, liner does not. */
  tracking: number;
};

/**
 * Which handwriting face an ink style letters with — the pack's `hand` block.
 *
 * This was a table of four, from `docs/research/design-stack.md` §3, and it lived beside
 * the metrics rather than in the visuals style table because the face (and its tracking)
 * is half of every measurement: the planner reserving a box and the visuals stage
 * wrapping into it must agree not just on the advance table but on which font's advances
 * and how much air between the letters. That reasoning is unchanged; what moved is where
 * the assignment is written. It is a field of the style pack now (plan 7.3), so a fifth
 * style brings its own face without editing this file, and the three other places that
 * used to name a face — the visuals style table, the renderer's embedded-font family and
 * its `KNOWN` fallback list — all read the same one.
 */
export function handFontFor(style: string): HandFont {
  const hand = stylePackFor(style).hand;
  return { fontFamily: hand.fontFamily, fontFiles: hand.fontFiles, tracking: hand.tracking };
}

const handCache = new Map<string, FontMetrics>();

/**
 * The handwriting metrics for an ink style, loaded once per process.
 *
 * Deterministic because the faces are vendored in `assets/fonts/hand` and part of
 * the repo: every machine measures the same bytes. The cache is per style name,
 * which is safe because nothing switches fonts underneath a running process —
 * `INKCAST_FONT`/`INKCAST_FONT_DIR` are read on first use, like every other env knob.
 */
export function handMetricsFor(style: string): FontMetrics {
  const cached = handCache.get(style);
  if (cached) return cached;
  const hand = handFontFor(style);
  const m = loadFontMetrics({ preferred: hand.fontFiles, fontFamily: hand.fontFamily });
  handCache.set(style, m);
  return m;
}

/* -------------------------------------------------------------- the mono face */

/**
 * The one face code is set in, for every ink style (plan 6.2).
 *
 * **One face, not four**, and that is the deliberate half of this. Every other kind of
 * text on the board changes with `meta.style`, because handwriting is the board's voice.
 * A listing is not in the board's voice: it is a quotation of a file, and the whole
 * reason the code lane exists is that a listing set in Shantell Sans is a *misquotation*
 * — proportional widths destroy the indentation that carries the program's structure,
 * and the face's `l`/`1` and `O`/`0` are the pairs a hand-lettered face is least careful
 * about. So a chalk film's code is the same monospace as a marker film's code, and the
 * style shows up where it should: in the ink colour and the pen weight around it.
 *
 * JetBrains Mono because it is already vendored for the studio's chrome and was chosen
 * there on exactly the property that matters here — `0`/`O` and `1`/`l` disambiguation
 * (`assets/fonts/README.md`, "Retired 2026-08-21"). The `.ttf` in `assets/fonts/code/`
 * is a second copy of that decision rather than a new one: `ui/` ships the latin-subset
 * `woff2` for a browser, and outlines have to be read out of an sfnt in Node.
 */
export const MONO_FONT = {
  fontFamily: 'JetBrains Mono',
  fontFiles: ['jetbrainsmono', 'jetbrains-mono', 'jetbrains'],
} as const;

let monoOnce: FontMetrics | undefined;

/**
 * The code lane's metrics and letterforms, loaded once per process.
 *
 * Unlike `handMetricsFor` this does **not** degrade to `builtinMetrics`: a width table
 * has no outlines, and the lane's answer to a missing face is to say so and let the gate
 * decide — never to letter a listing by hand. `INKCAST_CODE_FONT` overrides the file, for
 * the same reason `INKCAST_FONT` exists.
 */
export function monoMetrics(): FontMetrics | undefined {
  if (monoOnce) return monoOnce;
  const explicit = process.env.INKCAST_CODE_FONT;
  const file =
    explicit && existsSync(explicit)
      ? explicit
      : findFontFile([...MONO_FONT.fontFiles], codeFontDirs());
  if (!file) {
    log.warn(
      `no monospace font found in ${codeFontDirs().join(', ')} — the code lane cannot set a ` +
        'listing without one (expected assets/fonts/code/JetBrainsMono-Variable.ttf)',
    );
    return undefined;
  }
  const parsed = parseFontMetrics(readFileSync(file), file);
  if (!parsed) {
    log.warn(`${file} is not a font this reader understands — the code lane has no letterforms`);
    return undefined;
  }
  monoOnce = parsed;
  return parsed;
}
