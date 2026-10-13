/**
 * The handwriting font used *inside* the video.
 *
 * `docs/research/design-stack.md` assigns one OFL face per `meta.style`. Those
 * files are vendored into `assets/fonts/` by the setup step; this module finds
 * whichever of them is present and embeds it in the page as a base64 data URI, so
 * the render page has no external requests and works offline.
 *
 * If none is vendored we fall back to a system handwriting stack and log one
 * warning. The board still renders — it just looks less like our own hand.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gate, knownHandStems, logger, stylePackFor, stylePacks } from '@inkcast/core';
import type { GateMode } from '@inkcast/core';
import type { StyleName } from './types.js';

const log = logger('render:font');

const EXTS = new Set(['.ttf', '.otf', '.woff2', '.woff']);

/**
 * Which file to embed for a style, and which others will do — from the style pack (plan
 * item 7.3).
 *
 * This was a `FAMILY` table of four plus a `KNOWN` list of the same four, and it was
 * already drifting from the `HAND_FONTS` table in `@inkcast/core` that *measures* the
 * face: this file knew the pencil as `caveat`, core knew it as `Caveat` with the stems
 * `['caveat']`, and nothing compared the two. They are the same three lines of one JSON
 * file now, so the face the planner measured with is the face the page embeds by
 * construction rather than by two lists agreeing.
 */
function wantedStems(style: StyleName): string[] {
  return stylePackFor(style).hand.fontFiles.map(normalise);
}

/**
 * The system stack, when nothing is vendored at all — every pack's family first, so a
 * fifth style names its own face here too, then the platform handwriting faces that have
 * a chance of being installed.
 */
function fallbackStack(): string {
  const families = [...stylePacks().values()].map((p) => `'${p.hand.fontFamily}'`);
  return [
    ...new Set([
      ...families,
      "'Bradley Hand'",
      "'Chalkboard SE'",
      "'Comic Sans MS'",
      "'Segoe Print'",
      'cursive',
    ]),
  ].join(', ');
}

export type ResolvedFont = {
  /** Family name to use in the page. */
  family: string;
  /** `@font-face` block, or `''` when falling back to system fonts. */
  css: string;
  /** Absolute path of the embedded file, when there is one. */
  file: string | null;
};

const cache = new Map<string, string>();

function normalise(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function mimeFor(ext: string): string {
  switch (ext) {
    case '.woff2':
      return 'font/woff2';
    case '.woff':
      return 'font/woff';
    case '.otf':
      return 'font/otf';
    default:
      return 'font/ttf';
  }
}

function formatFor(ext: string): string {
  switch (ext) {
    case '.woff2':
      return 'woff2';
    case '.woff':
      return 'woff';
    case '.otf':
      return 'opentype';
    default:
      return 'truetype';
  }
}

function listFonts(dir: string): string[] {
  try {
    if (!statSync(dir).isDirectory()) return [];
    return readdirSync(dir)
      .filter((f) => EXTS.has(path.extname(f).toLowerCase()))
      .sort()
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

/** Walk up from `start` looking for `assets/fonts`. */
function findAssetsDir(start: string): string | null {
  let cur = path.resolve(start);
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(cur, 'assets', 'fonts');
    if (existsSync(candidate)) return candidate;
    const up = path.dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return null;
}

/**
 * `assets/fonts` is split by role — `hand/` holds the faces that go on the board,
 * `ui/` the studio's chrome — and `listFonts` does not recurse. So every candidate
 * directory is searched both flat and with `hand/` appended.
 *
 * Without the subdirectory the vendored faces are invisible and every video
 * renders in a system stack instead of our own hand: a quality failure that never
 * announces itself as a failure.
 */
function withHand(dir: string): string[] {
  return [dir, path.join(dir, 'hand')];
}

export function fontSearchPaths(dir: string): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const out: string[] = [];
  const env = process.env.INKCAST_FONT_DIR;
  if (env) out.push(...withHand(path.resolve(env)));
  out.push(...withHand(path.resolve(dir, 'fonts')));
  const fromPkg = findAssetsDir(here);
  if (fromPkg) out.push(...withHand(fromPkg));
  const fromCwd = findAssetsDir(process.cwd());
  if (fromCwd) out.push(...withHand(fromCwd));
  return [...new Set(out)];
}

function pick(style: StyleName, dir: string, explicit?: string): string | null {
  if (explicit) {
    const abs = path.resolve(explicit);
    if (existsSync(abs)) return abs;
    log.warn(`fontPath not found, ignoring: ${explicit}`);
  }
  const dirs = fontSearchPaths(dir);
  const all: string[] = [];
  for (const d of dirs) all.push(...listFonts(d));
  if (!all.length) return null;
  for (const wanted of wantedStems(style)) {
    const exact = all.find((f) => normalise(path.basename(f, path.extname(f))).startsWith(wanted));
    if (exact) return exact;
  }
  const known = all.find((f) => {
    const n = normalise(path.basename(f, path.extname(f)));
    return knownHandStems().some((k) => n.startsWith(k));
  });
  return known ?? all[0] ?? null;
}

export function resolveFont(
  style: StyleName,
  dir: string,
  explicit?: string,
  gates?: GateMode,
): ResolvedFont {
  const file = pick(style, dir, explicit);
  if (!file) {
    // Under the strict gate a missing face is an error: the system stack draws a
    // different hand on every machine and its metrics were never measured, so the
    // film that renders is not the film that was laid out (audit S4-g).
    gate(
      gates,
      `no handwriting font in ${fontSearchPaths(dir).join(', ') || '(no search paths)'} — ` +
        'the board would be lettered by an unmeasured system fallback face',
      () =>
        log.warn(
          `no handwriting font in ${fontSearchPaths(dir).join(', ') || '(no search paths)'} — using the system stack`,
        ),
    );
    return { family: fallbackStack(), css: '', file: null };
  }
  const ext = path.extname(file).toLowerCase();
  let b64 = cache.get(file);
  if (b64 === undefined) {
    b64 = readFileSync(file).toString('base64');
    cache.set(file, b64);
  }
  const css = [
    '@font-face {',
    "  font-family: 'InkcastHand';",
    `  src: url(data:${mimeFor(ext)};base64,${b64}) format('${formatFor(ext)}');`,
    '  font-weight: 100 900;',
    '  font-display: block;',
    '}',
  ].join('\n');
  log.debug(`embedded handwriting font ${path.basename(file)}`);
  return { family: `'InkcastHand', ${fallbackStack()}`, css, file };
}
