/**
 * Real font metrics, parsed straight out of the sfnt tables.
 *
 * The handwriting lane must wrap text to a box *before* the renderer sees it,
 * which means we need genuine advance widths — not a guess. Rather than pull in
 * a font library, this reads the four tables that matter (`head`, `hhea`,
 * `hmtx`, `cmap`, plus `name`/`OS/2` when present) from the vendored OFL `.ttf`.
 * That works for both TrueType and CFF/OTF outlines because metrics live in the
 * same tables either way, and it costs zero dependencies.
 *
 * If no font file is available (the vendored fonts have not been fetched yet),
 * we degrade to a calibrated per-character width table and say so once — the
 * pipeline must never fail for a missing font.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '@inkcast/core';
import type { InkStyleName } from './style.js';

const log = logger('visuals:font');

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
  /** Width of a string at `fontSize`, including optional tracking (em). */
  measure(text: string, fontSize: number, tracking?: number): number;
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
    measure: (text, fontSize, tracking = 0) => measureWith(advance, text, fontSize, tracking),
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
      measure: (text, fontSize, tracking = 0) => measureWith(advance, text, fontSize, tracking),
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
 */
export function defaultFontDirs(): string[] {
  const bases = [
    process.env.INKCAST_FONT_DIR,
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../assets/fonts'), // src/ → repo root
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../assets/fonts'), // dist/src/ → repo root
    path.resolve(process.cwd(), 'assets/fonts'),
  ].filter((p): p is string => !!p);
  return bases.flatMap((base) => [base, path.join(base, 'hand')]);
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
  const known = [
    'shantell',
    'caveat',
    'gaegu',
    'patrick',
    'kalam',
    'indie',
    'architects',
    'handlee',
    'gloria',
  ];
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

/** Load the handwriting metrics for a style, degrading to the builtin table. */
export function loadFontMetrics(opts: {
  style: InkStyleName;
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
