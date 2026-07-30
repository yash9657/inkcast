/**
 * The curated asset library — the first resolution stop after inline SVG.
 *
 * ## Why this exists
 *
 * Every other lane re-derives its drawing from scratch on every project: the
 * illustration lane pays a provider, the icon lane matches a lucide glyph, the
 * letter lane writes a name in a box. None of them get better over time, so the
 * tenth video is drawn by the same machinery as the first with none of the
 * benefit — root cause 3 in `PIPELINE.md`. The library is the opposite: drawings we
 * chose, reviewed like code, committed, and reused by path.
 *
 * The distinction from lucide is worth keeping sharp. lucide is a ~2000-icon
 * *fallback provider* and stays exactly where it is, last but one. **The library is
 * the things we chose; lucide is the things we settle for.**
 *
 * ## Versions are files
 *
 * A version lives in its filename — `figures/standing.v1.svg` — and the manifest
 * records only which one is newest. That inversion is deliberate: `AssetRef.version`
 * exists so improving an asset cannot change a finished video, and a version that is
 * not on disk cannot be pinned. So `v2` landing next to `v1` leaves every storyboard
 * that resolved `v1` rendering byte-identical geometry, and the manifest bump is what
 * offers `v2` to storyboards that have not pinned anything yet.
 *
 * The manifest is therefore a *register* — ink mode, licence, provenance, and the
 * nouns that should resolve here — and never the source of the geometry.
 *
 * ## Authoring rules for a library SVG
 *
 * - **Document order is draw order.** The writer reveals items in the order it
 *   receives them, so author a figure the way a person draws one: silhouette first,
 *   details after. This is most of the reason a curated asset reads better than a
 *   traced one.
 * - **Do not hardcode ink.** A child with no `fill` is stroked in the board's ink
 *   colour, which is what makes one asset work in every palette. `fill="currentColor"`
 *   fills with the same ink. A literal colour is honoured verbatim, because an author
 *   who wrote `#e5484d` meant red.
 * - **`stroke="none"` is honoured**, and costs the reveal: a fill-only child has no
 *   line to dash along, so it fades in where its neighbours draw. Stroke anything
 *   that should look drawn.
 * - **Flat lists only.** `svgChildren` reads primitives, not groups or transforms; a
 *   `transform` attribute is warned about rather than silently misplacing geometry.
 * - `data-weight="hairline|light|normal|bold"` picks the stroke weight, and
 *   `data-group` names a child for choreography. Both optional.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger, type Asset, type AssetRef } from '@inkcast/core';
import type { DrawContext, InkMode, InkPath, StrokeWeight } from './geometry.js';
import { roughenPathData } from './geometry.js';
import type { Box } from './svg.js';
import {
  fitMatrix,
  pathToString,
  parsePath,
  pointsBBox,
  samplePath,
  svgChildren,
  svgViewBox,
  transformSegs,
  unionBox,
} from './svg.js';

const log = logger('visuals:library');

export const LIBRARY_MANIFEST = 'library.json';

/** One curated asset, as the manifest registers it. */
export type LibraryEntry = {
  /** The newest version on disk. An unpinned reference resolves to this. */
  version: number;
  /** How this asset wants to be drawn. `AssetRef.ink` overrides it. */
  ink: InkMode;
  /** What it is, for the `Asset.kind` a matched entity should claim. */
  kind?: Asset['kind'];
  /** Human title, for logs and for the studio's picker. */
  title?: string;
  license: string;
  provenance: string;
  /**
   * Nouns that should land here when nothing pinned a path.
   *
   * This is what closes the no-key character gap: a planner that mints an
   * `illustration` asset called `hiker` gets the curated walking figure instead of
   * a lucide glyph or a lettered card. Keep these lists *narrow* — an alias that
   * over-reaches hijacks an entity that had a better lane, and a wrong drawing is
   * worse than a generic one.
   */
  match?: string[];
};

export type Library = {
  /** Absolute path of the library root. */
  dir: string;
  /** Manifest format version, not an asset version. */
  version: number;
  assets: Record<string, LibraryEntry>;
};

/**
 * Where the library is, resolved relative to this package.
 *
 * Mirrors `defaultFontDirs()` — same repo-level `assets/` root, same two package
 * layouts (`src/` when run from source, `dist/src/` when built), same cwd fallback,
 * same env override for a checkout that keeps its assets elsewhere.
 */
export function defaultLibraryDirs(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return [
    process.env.INKCAST_LIBRARY_DIR,
    path.resolve(here, '../../../assets/library'), // src/ → repo root
    path.resolve(here, '../../../../assets/library'), // dist/src/ → repo root
    path.resolve(process.cwd(), 'assets/library'),
  ].filter((p): p is string => !!p);
}

const cache = new Map<string, Library | undefined>();

/** Drop the memoised manifests. Tests only. */
export function resetLibraryCache(): void {
  cache.clear();
}

/**
 * Load the manifest from the first directory that has one.
 *
 * A missing or malformed library is `undefined`, never a throw: the library is the
 * best lane, not a required one, and a checkout without `assets/library` must still
 * render through the icon and letter lanes exactly as it did before.
 */
export function loadLibrary(dir?: string): Library | undefined {
  const dirs = dir ? [dir] : defaultLibraryDirs();
  const memoKey = dirs.join('|');
  if (cache.has(memoKey)) return cache.get(memoKey);

  let found: Library | undefined;
  for (const candidate of dirs) {
    const file = path.join(candidate, LIBRARY_MANIFEST);
    if (!existsSync(file)) continue;
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<Library>;
      const assets = parsed.assets;
      if (!assets || typeof assets !== 'object') {
        log.warn(`${file} has no "assets" map — ignoring the library`);
        break;
      }
      const clean: Record<string, LibraryEntry> = {};
      for (const [key, entry] of Object.entries(assets)) {
        if (!entry || typeof entry.version !== 'number' || entry.version < 1) {
          log.warn(`library entry "${key}" has no usable version — skipping it`);
          continue;
        }
        clean[key] = { ...entry, ink: entry.ink === 'crisp' ? 'crisp' : 'sketch' };
      }
      found = { dir: candidate, version: parsed.version ?? 1, assets: clean };
      log.debug(`library loaded from ${candidate}`, `${Object.keys(clean).length} assets`);
      break;
    } catch (err) {
      log.warn(`could not read ${file} — ignoring the library`, err);
      break;
    }
  }
  cache.set(memoKey, found);
  return found;
}

export function libraryAvailable(dir?: string): boolean {
  const lib = loadLibrary(dir);
  return !!lib && Object.keys(lib.assets).length > 0;
}

/** Absolute path of one version of one asset. */
export function libraryFile(lib: Library, assetPath: string, version: number): string {
  return path.join(lib.dir, `${assetPath}.v${version}.svg`);
}

/* ---------------------------------------------------------------- matching */

export type LibraryMatch = {
  path: string;
  entry: LibraryEntry;
  /** `path` — the id *is* a library path; `alias` — a registered noun matched. */
  how: 'path' | 'alias';
};

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

/**
 * The library entry an unreferenced entity should resolve to, if any.
 *
 * The id is tried before the prompt, for the same reason `matchAsset` does it: an id
 * is a slug someone chose, a prompt is a sentence that happens to contain nouns. A
 * prompt only matches on a whole registered alias token, never on similarity —
 * fuzzy matching belongs in the *fallback* provider, where being approximately
 * right is the deal, and not in the lane whose whole claim is that the drawing was
 * chosen deliberately.
 */
export function matchLibrary(
  args: { id: string; prompt?: string },
  dir?: string,
): LibraryMatch | undefined {
  const lib = loadLibrary(dir);
  if (!lib) return undefined;

  const direct = lib.assets[args.id];
  if (direct) return { path: args.id, entry: direct, how: 'path' };

  const aliases = new Map<string, { path: string; entry: LibraryEntry }>();
  for (const [assetPath, entry] of Object.entries(lib.assets)) {
    for (const alias of entry.match ?? []) {
      const key = alias.toLowerCase();
      if (!aliases.has(key)) aliases.set(key, { path: assetPath, entry });
    }
  }

  for (const source of [args.id, args.prompt ?? '']) {
    for (const token of tokens(source)) {
      const hit = aliases.get(token);
      if (hit) return { path: hit.path, entry: hit.entry, how: 'alias' };
    }
  }
  return undefined;
}

/**
 * What one asset's library resolution depends on, as a cache-key fragment.
 *
 * Two things make this necessary rather than decorative. A reference that pinned no
 * version resolves to whatever is newest, so a library gaining `v2` has to
 * invalidate it — otherwise the improvement is invisible until someone deletes the
 * project. And an entity that resolved through an *alias* is bound to a match table
 * that lives outside the storyboard entirely, so a retuned alias list has to
 * invalidate it too.
 *
 * `''` when the library has nothing to say about this asset, which keeps the key of
 * every non-library asset byte-identical to what it was before this lane existed.
 */
export function libraryFingerprint(
  asset: { id: string; prompt?: string; ref?: AssetRef },
  dir?: string,
): string {
  const lib = loadLibrary(dir);
  if (!lib) return '';
  const hit = asset.ref
    ? { path: asset.ref.path, entry: lib.assets[asset.ref.path] }
    : matchLibrary({ id: asset.id, ...(asset.prompt ? { prompt: asset.prompt } : {}) }, dir);
  if (!hit?.entry) return '';
  const version = asset.ref?.version ?? hit.entry.version;
  return `${hit.path}@${version}/${asset.ref?.ink ?? hit.entry.ink}${
    asset.ref?.variant ? `/${asset.ref.variant}` : ''
  }`;
}

/* ----------------------------------------------------------------- drawing */

export type LibraryResult = {
  /** The library path drawn. */
  path: string;
  /** The version actually drawn — what a caller should pin. */
  version: number;
  /** Absolute file the geometry came from. */
  file: string;
  ink: InkMode;
  paths: InkPath[];
};

const WEIGHTS: ReadonlySet<string> = new Set(['hairline', 'light', 'normal', 'bold']);

/**
 * Draw a library asset into `box`.
 *
 * Geometry is scaled into the box *before* it is inked, as the icon lane does: the
 * alternative multiplies the wobble by the scale factor and reads as a mistake
 * rather than as a hand.
 *
 * Every failure returns `undefined` so the caller falls through to the next lane. A
 * pinned version that is missing is a *warning*, not an error — the reference is
 * still honest about what it wanted, and refusing to draw anything would turn a
 * library bookkeeping slip into a hole in the video.
 */
export function libraryPaths(args: {
  ref: AssetRef;
  box: Box;
  ctx: DrawContext;
  dir?: string;
  inset?: number;
}): LibraryResult | undefined {
  const lib = loadLibrary(args.dir);
  if (!lib) return undefined;

  const entry = lib.assets[args.ref.path];
  if (!entry) {
    log.warn(`no library asset at "${args.ref.path}" — falling through to the other lanes`);
    return undefined;
  }

  const version = args.ref.version ?? entry.version;
  const file = libraryFile(lib, args.ref.path, version);
  if (!existsSync(file)) {
    log.warn(
      `library asset "${args.ref.path}" has no v${version} on disk (newest is v${entry.version}) — ` +
        'falling through to the other lanes',
    );
    return undefined;
  }

  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    log.warn(`could not read ${file}`, err);
    return undefined;
  }

  const children = svgChildren(text);
  if (children.length === 0) {
    log.warn(`library asset "${args.ref.path}" v${version} has no drawable children`);
    return undefined;
  }
  if (children.some((c) => c.attrs.transform)) {
    log.warn(
      `library asset "${args.ref.path}" v${version} carries a transform, which this lane does ` +
        'not apply — flatten it into the path data',
    );
  }

  // The declared viewBox is preferred over measured content, so sibling assets stay
  // consistently sized relative to each other: a figure whose arm is down must not
  // be drawn larger than the same figure pointing just because it covers less.
  const source =
    svgViewBox(text) ?? unionBox(children.map((c) => pointsBBox(samplePath(parsePath(c.d)))));
  if (!(source.w > 0 && source.h > 0)) return undefined;

  const ink = args.ref.ink ?? entry.ink;
  const inset = args.inset ?? Math.min(args.box.w, args.box.h) * 0.04;
  const m = fitMatrix(source, args.box, inset);
  const group = `library:${args.ref.path}`;

  const paths: InkPath[] = [];
  children.forEach((child, i) => {
    const d = pathToString(transformSegs(parsePath(child.d), m));
    if (!d) return;

    const declaredFill = child.attrs.fill;
    const fill =
      !declaredFill || declaredFill === 'none'
        ? undefined
        : declaredFill === 'currentColor'
          ? (args.ctx.colour ?? args.ctx.style.ink)
          : declaredFill;
    const declaredStroke = child.attrs.stroke;
    const stroke =
      declaredStroke === 'none'
        ? 'none'
        : declaredStroke && declaredStroke !== 'currentColor'
          ? declaredStroke
          : undefined;
    const weight = child.attrs['data-weight'];

    const ctx: DrawContext = {
      ...args.ctx,
      ink,
      group: child.attrs['data-group'] ?? group,
      ...(weight && WEIGHTS.has(weight) ? { weight: weight as StrokeWeight } : {}),
    };

    // The two modes take a fill by different routes, and using the wrong one is a
    // silent visual bug rather than an error. Crisp output *is* the authored contour,
    // so a fill can be set on it afterwards — the equation lane does exactly this.
    // Sketch output is not: roughjs returns the wobbly *stroke* it drew, and painting
    // a fill onto that fills the outline of a pen line, which came out as a ringed
    // head with nothing inside it. Roughjs has to be asked for the fill up front so
    // it can hachure the region itself, which is also the on-brand look.
    const over: Parameters<typeof roughenPathData>[3] = {
      ...(stroke ? { stroke } : {}),
      ...(fill && ink === 'sketch' ? { fill, fillStyle: args.ctx.style.fillStyle } : {}),
    };
    for (const p of roughenPathData(ctx, d, 40 + i, over)) {
      paths.push({
        ...p,
        ...(fill && ink === 'crisp'
          ? {
              fill,
              // Counters are wound against the outer contour, as in a glyph: the gap
              // between a figure's arm and its body stays a gap.
              fillRule: (child.attrs['fill-rule'] === 'evenodd' ? 'evenodd' : 'nonzero') as
                'nonzero' | 'evenodd',
            }
          : {}),
      });
    }
  });

  if (paths.length === 0) return undefined;
  return { path: args.ref.path, version, file, ink, paths };
}
