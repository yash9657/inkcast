/**
 * `resolveVisuals(sb, dir, opts)` — the visuals stage.
 *
 * Enriches the storyboard in place-ish (it works on a clone) by
 *  1. resolving every entry in `storyboard.assets[]` **once** into
 *     `<dir>/assets/<id>.svg` and writing that relative path back to
 *     `asset.svg`, and
 *  2. resolving every element in every scene into a canvas-space SVG plus
 *     measured reveal geometry, recorded in `<dir>/assets/visuals.json`.
 *
 * Caching is content-addressed through `@inkcast/core`'s `isFresh`/`markFresh`:
 * an asset's key covers its id, prompt, seed, the ink style and the handwriting
 * font, so changing `meta.style` regenerates everything and changing scene 7
 * regenerates only scene 7.
 */
import { mkdir, copyFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  boardMetrics,
  gate,
  hash,
  isFresh,
  logger,
  markFresh,
  report,
  type Asset,
  type AssetRef,
  type BoardMetrics,
  type Element,
  type GateMode,
  type StageOptions,
  type Storyboard,
} from '@inkcast/core';
import { resolveDiagram } from './diagram.js';
import { resolveEquation } from './equation.js';
import type { FontMetrics } from '@inkcast/core';
import { loadFontMetrics } from '@inkcast/core';
import { formatGlyphViolation, glyphViolations } from './glyphgate.js';
import type { DrawContext, InkPath } from './geometry.js';
import {
  arrowMidpoint,
  arrowPaths,
  createGenerator,
  ctxFor,
  emphasisPaths,
  seedFrom,
  shapePaths,
} from './geometry.js';
import { iconPaths, iconsAvailable, matchAsset } from './icons.js';
import { detectImageProvider, figureRaster, illustrationPaths } from './image.js';
import { libraryFingerprint, libraryPaths, matchLibrary } from './library.js';
import type { AssetVisual, ElementVisual, VisualManifest } from './manifest.js';
import {
  MANIFEST_PATH,
  MANIFEST_VERSION,
  loadVisualManifest,
  saveVisualManifest,
  toViewBox,
} from './manifest.js';
import { resolveMotion } from './motion.js';
import { resolvePath } from './path.js';
import { resolvePlot } from './plot.js';
import type { InkStyle } from './style.js';
import { inkStyleFor, roleFontSize, styleFingerprint } from './style.js';
import type { Box } from './svg.js';
import { fitMatrix, flipXM, multiply, pathLength, transformPath } from './svg.js';
import { layoutText } from './text.js';
import type { InkItem, InkStroke } from './writer.js';
import { pathItems, sanitiseId, textItem, totalStrokeLength, writeElementSvg } from './writer.js';

const log = logger('visuals');

/** Nominal side length for a reusable asset entity, in canvas units. */
const NOMINAL_ASSET = 256;

export type ResolveVisualsOptions = StageOptions & {
  /** Explicit handwriting font file; otherwise `assets/fonts` is searched. */
  fontPath?: string;
  /** `off` disables the cloud text-to-image lane even when a key is present. */
  images?: 'auto' | 'off';
  /** Cap on how much a small diagram is scaled up to fill its box. */
  maxUpscale?: number;
  /**
   * `strict` promotes this stage's quality warnings to errors: a missing
   * handwriting font, a codepoint the font has no glyph for (the glyph gate),
   * and an equation that falls back to TeX-as-handwriting all stop the run
   * instead of degrading. Absent means `degrade` — today's behaviour, for every
   * direct caller; the pipeline threads `strict` by default.
   */
  gates?: GateMode;
};

export async function resolveVisuals(
  sb: Storyboard,
  dir: string,
  opts: ResolveVisualsOptions = {},
): Promise<Storyboard> {
  const out: Storyboard = structuredClone(sb);
  const assetsDir = path.resolve(dir, 'assets');
  await mkdir(assetsDir, { recursive: true });

  const style = inkStyleFor(out.meta);
  const styleFP = styleFingerprint(style);
  const font = loadFontMetrics({
    preferred: style.fontFiles,
    fontFamily: style.fontFamily,
    ...(opts.fontPath ? { fontPath: opts.fontPath } : {}),
  });
  // The glyph gate (audit S4-b, CRITICAL). Both checks run before any layout,
  // because the failure they stop is silent by construction downstream: a missing
  // face means every advance is a calibrated guess, and an uncovered codepoint is
  // laid out at the space glyph's width and painted from a browser fallback stack.
  if (font.source === 'builtin') {
    gate(
      opts.gates,
      `no handwriting font could be loaded (wanted ${style.fontFamily}) — text would be ` +
        'laid out with approximate builtin widths and drawn by a system fallback face. ' +
        'Fetch the vendored OFL fonts into assets/fonts',
      (m) => log.warn(m),
    );
  }
  const uncovered = glyphViolations(out, font);
  if (uncovered.length > 0) {
    for (const v of uncovered) log.warn(formatGlyphViolation(v));
    gate(
      opts.gates,
      `${uncovered.length} codepoint(s) in board text have no glyph in the handwriting font ` +
        `(${font.familyName}) — first: ${formatGlyphViolation(uncovered[0]!)}`,
      // Every violation was already warned line-by-line just above.
      () => {},
    );
  }
  const fontRel = await copyFontIntoProject(dir, font);
  // The SVGs live in `assets/`, so the @font-face href is relative to that.
  const fontHref = fontRel ? fontRel.replace(/^assets\//, '') : undefined;
  const fontFP = [font.familyName, font.source, font.unitsPerEm, font.ascent, font.descent].join(
    '|',
  );
  const canvasHeight = out.canvas.h;
  // The board's own scale, from the same `boardMetrics` the renderer calls. Framing is
  // a function of elements and regions only — never of measured durations — so it does
  // not matter that voice may or may not have run before this stage.
  const board = boardMetrics(out);

  const imagesEnabled =
    (opts.images ?? (process.env.INKCAST_IMAGES === 'off' ? 'off' : 'auto')) === 'auto';
  const provider = imagesEnabled ? detectImageProvider() : 'none';
  if (!imagesEnabled) log.debug('text-to-image lane disabled by options');
  if (provider === 'none' && !iconsAvailable()) {
    log.warn('lucide-static is missing — illustrations will be drawn as lettered cards');
  }

  const previous = opts.force ? undefined : await loadVisualManifest(dir);

  /* ---- make sure every referenced asset exists in the library ------------- */
  const known = new Set(out.assets.map((a) => a.id));
  for (const scene of out.scenes) {
    for (const el of scene.elements) {
      if (el.type !== 'asset' || known.has(el.assetId)) continue;
      // A planner slip should not lose the drawing: synthesise the entity.
      log.warn(`element ${el.id} references unknown asset "${el.assetId}" — synthesising an icon`);
      out.assets.push({
        id: el.assetId,
        kind: 'icon',
        prompt: humanise(el.assetId),
        source: 'builtin',
      });
      known.add(el.assetId);
    }
  }

  const totalSteps = out.assets.length + out.scenes.reduce((a, s) => a + s.elements.length, 0) + 1;
  let step = 0;
  const tick = (note: string): void => {
    step++;
    report(opts, { stage: 'visuals', pct: (step / totalSteps) * 100, note });
  };

  /* ---- pass 1: the asset library (resolve once, reuse everywhere) --------- */
  const assetVisuals: Record<string, AssetVisual> = {};
  const assetHashes = new Map<string, string>();

  // Where each asset is actually drawn, for the one kind that has to know: an `exact`
  // asset is authored in a viewBox of its element's own shape rather than in the nominal
  // square (see `assetViewBox`). First use wins, which is enough — the elements sharing an
  // exact asset differ in size and never in shape.
  const usedAt = new Map<string, Box>();
  for (const scene of out.scenes)
    for (const el of scene.elements)
      if (el.type === 'asset' && !usedAt.has(el.assetId)) usedAt.set(el.assetId, el.at);

  for (const asset of out.assets) {
    const rel = `assets/${sanitiseId(asset.id)}.svg`;
    const key = `visuals:asset:${asset.id}`;
    const inputHash = hash(
      // v3: the library lane resolves ahead of illustration and icon, so an asset
      // whose id or prompt now matches a curated drawing has different geometry for
      // identical storyboard inputs.
      // v4: an asset may ask to meet its element's box exactly, which changes both the
      // viewBox it is authored in and which lanes may answer for it.
      // v5: a `figure` is excluded from the library, icon and letter lanes, so an asset
      // that previously resolved to a matched stick figure now resolves to a generated
      // one. Same class of change as v3 and for the same reason: which lane may answer.
      'asset/v6',
      asset.id,
      asset.kind,
      asset.prompt ?? '',
      asset.fit ?? '',
      // v6: a figure is authored in its element's shape too, so its aspect chooses both the
      // viewBox and the pixels asked of the generator — and an asset resolved before that
      // was a square picture in a 3:2 box.
      asset.fit === 'exact' || asset.kind === 'figure' ? aspectOf(usedAt.get(asset.id)) : '',
      asset.seed ?? '',
      asset.svg && asset.svg.includes('<svg') ? asset.svg : '',
      // Covers a version the reference did not pin and an alias table that moved;
      // empty for every asset the library does not answer.
      libraryFingerprint(asset),
      styleFP,
      fontFP,
      provider,
    );
    assetHashes.set(asset.id, inputHash);

    const cached = previous?.assets[asset.id];
    if (cached && (await isFresh(dir, key, inputHash, [rel]))) {
      assetVisuals[asset.id] = cached;
      asset.svg = cached.svg;
      if (!asset.seed) asset.seed = cached.seed;
      // As on the resolve path below: the pin belongs to the asset, not only to the
      // sidecar, and a re-planned storyboard arrives here without one.
      if (cached.library && !asset.ref?.version) {
        asset.ref = {
          ...asset.ref,
          path: cached.library.path,
          version: cached.library.version,
        };
      }
      tick(`asset ${asset.id} (cached)`);
      continue;
    }

    const visual = await resolveAsset({
      asset,
      dir,
      rel,
      style,
      font,
      canvasHeight,
      provider,
      fontHref,
      ...((asset.fit === 'exact' || asset.kind === 'figure') && usedAt.has(asset.id)
        ? { at: usedAt.get(asset.id) as Box }
        : {}),
    });
    assetVisuals[asset.id] = visual;
    asset.svg = visual.svg;
    asset.seed = visual.seed;
    asset.source =
      visual.lane === 'library'
        ? 'library'
        : visual.lane === 'illustration'
          ? 'generated'
          : visual.lane === 'inline'
            ? (asset.source ?? 'user-upload')
            : 'builtin';
    // Pin what was drawn. A reference that arrived without a version leaves with
    // one, and an entity matched by alias leaves carrying the path outright — so the
    // next run resolves by path instead of finding its way back through a match
    // table that may since have been retuned.
    if (visual.library) {
      asset.ref = {
        ...asset.ref,
        path: visual.library.path,
        version: visual.library.version,
      };
    }
    await markFresh(dir, key, inputHash);
    tick(`asset ${asset.id} (${visual.lane}${visual.icon ? `:${visual.icon.slug}` : ''})`);
  }

  /* ---- pass 2: every element on the canvas ------------------------------- */
  const boxIndex = new Map<string, Box>();
  for (const scene of out.scenes) for (const el of scene.elements) boxIndex.set(el.id, el.at);

  const elementVisuals: Record<string, ElementVisual> = {};
  for (const [sceneIndex, scene] of out.scenes.entries()) {
    for (const el of scene.elements) {
      const rel = `assets/el-${sanitiseId(el.id)}.svg`;
      const key = `visuals:element:${scene.id}:${el.id}`;
      const targetBox = el.type === 'emphasis' ? boxIndex.get(el.targetId) : undefined;
      const inputHash = hash(
        // v2: plot, path and motion elements produce geometry v1 never emitted.
        'element/v2',
        JSON.stringify(el),
        el.type === 'asset' ? (assetHashes.get(el.assetId) ?? '') : '',
        targetBox ? JSON.stringify(targetBox) : '',
        JSON.stringify(out.canvas),
        styleFP,
        fontFP,
      );

      const cached = previous?.elements[el.id];
      if (cached && cached.sceneId === scene.id && (await isFresh(dir, key, inputHash, [rel]))) {
        elementVisuals[el.id] = cached;
        tick(`element ${el.id} (cached)`);
        continue;
      }

      const visual = await resolveElement({
        el,
        sceneId: scene.id,
        sceneIndex,
        dir,
        rel,
        style,
        font,
        canvas: out.canvas,
        canvasHeight,
        fontHref,
        assetVisuals,
        targetBox,
        board,
        ...(opts.maxUpscale !== undefined ? { maxUpscale: opts.maxUpscale } : {}),
        ...(opts.gates !== undefined ? { gates: opts.gates } : {}),
      });
      elementVisuals[el.id] = visual;
      await markFresh(dir, key, inputHash);
      tick(`element ${el.id} (${el.type})`);
    }
  }

  /* ---- the sidecar manifest --------------------------------------------- */
  const manifest: VisualManifest = {
    version: MANIFEST_VERSION,
    generator: '@inkcast/visuals',
    style: {
      name: style.name,
      palette: style.palette,
      fingerprint: styleFP,
      paper: style.paper,
      ink: style.ink,
      accent: style.accent,
      secondary: style.secondary,
      muted: style.muted,
      highlight: style.highlight,
      strokeWidth: style.strokeWidth,
      linecap: style.linecap,
      linejoin: style.linejoin,
    },
    font: {
      family: font.familyName,
      ...(fontRel ? { file: fontRel } : {}),
      source: font.source,
      ascent: font.ascent,
      descent: font.descent,
      lineGap: font.lineGap,
    },
    canvas: out.canvas,
    assets: assetVisuals,
    elements: elementVisuals,
  };
  await saveVisualManifest(dir, manifest);
  tick(MANIFEST_PATH);

  const strokes = Object.values(elementVisuals).reduce((a, e) => a + e.strokes.length, 0);
  log.info(
    `resolved ${Object.keys(assetVisuals).length} assets and ${Object.keys(elementVisuals).length} elements ` +
      `(${strokes} strokes, ${style.name} ink, ${font.familyName})`,
  );
  return out;
}

/* ------------------------------------------------------------------- assets */

let illustrationFallbackWarned = false;

/** The shape of a box, to three places, for a cache key. */
function aspectOf(box: Box | undefined): string {
  return box && box.h > 0 ? (box.w / box.h).toFixed(3) : '';
}

/**
 * The viewBox an asset's artwork is authored in.
 *
 * Square by default, because an asset is resolved **once** and then scaled into whatever
 * box each element that references it has — so there is no one element's shape to honour.
 *
 * An `exact` asset is the exception, and it has to be, because that indirection is enough
 * on its own to defeat the exactness. Fitting a tall subject inside a square leaves the
 * margin *inside the artwork*, and scaling that square into a tall element box carries the
 * margin along with it: measured on the first hybrid drawing, a heart that should have
 * filled a 578-unit box was drawn 385 wide, and every leader arrow reached past it into
 * blank board. So an exact asset is authored in a viewBox of its element's own shape, which
 * makes the scale that follows an identity whatever `preserveAspectRatio` does with it.
 *
 * Two beats annotating the same subject share one asset, and that is still sound: each
 * beat's box is the same measured ink box under a different uniform transform, so they
 * differ in size and never in shape.
 */
function assetViewBox(at?: Box): Box {
  if (!at || at.w <= 0 || at.h <= 0) return { x: 0, y: 0, w: NOMINAL_ASSET, h: NOMINAL_ASSET };
  const s = NOMINAL_ASSET / Math.max(at.w, at.h);
  return { x: 0, y: 0, w: at.w * s, h: at.h * s };
}

async function resolveAsset(args: {
  asset: Asset;
  dir: string;
  rel: string;
  style: InkStyle;
  font: FontMetrics;
  canvasHeight: number;
  provider: string;
  fontHref?: string;
  /** The box of an element using this asset. Only read for an `exact` fit. */
  at?: Box;
}): Promise<AssetVisual> {
  const { asset, dir, rel, style, font } = args;
  const seed = asset.seed ?? seedFrom('asset', asset.id);
  // A figure is authored in its element's shape for the same reason an `exact` asset is,
  // and it is not marked `exact` because that flag also decides which lanes may answer.
  // Leaving it on the nominal square is what made every figure draw at **66.7% of the box
  // reserved for it**: the square viewBox is fitted uniformly into a 3:2 element, so a
  // third of the area is blank paper. Asking the generator for the box's aspect (see
  // `rasterSize`) only helps if the box it is asked about is the one the film will draw.
  const box: Box =
    asset.fit === 'exact' || asset.kind === 'figure'
      ? assetViewBox(args.at)
      : { x: 0, y: 0, w: NOMINAL_ASSET, h: NOMINAL_ASSET };
  const ctx: DrawContext = { style, gen: createGenerator(style), seed };

  // A user-supplied inline SVG is authoritative — write it out untouched.
  if (asset.svg && asset.svg.trim().startsWith('<svg')) {
    await writeFile(
      path.resolve(dir, rel),
      asset.svg.endsWith('\n') ? asset.svg : `${asset.svg}\n`,
    );
    return {
      id: asset.id,
      kind: asset.kind,
      lane: 'inline',
      svg: rel,
      space: 'local',
      viewBox: toViewBox(box),
      strokes: [],
      totalLength: 0,
      seed,
      ...(asset.prompt ? { prompt: asset.prompt } : {}),
    };
  }

  const term = asset.prompt?.trim() || humanise(asset.id);
  let items: InkItem[] | undefined;
  let lane: AssetVisual['lane'] = 'letter';
  let library: AssetVisual['library'] | undefined;
  let icon: { slug: string; how: string } | undefined;
  let raster: string | undefined;

  // An underlay is the one asset that may not be substituted. Its box was measured from
  // a trace of one specific generated raster and a drawing's marks are aimed at what is
  // in that raster, so any other picture — a curated drawing, an icon, a lettered card —
  // is a different subject wearing the right coordinates, with leader arrows reaching
  // into it and naming whatever happens to be there.
  //
  // This is not hypothetical. The first end-to-end run of the hybrid lane asked for "a
  // human heart, anatomical, external front view, whole organ with great vessels",
  // matched the word *human* against the character library, and drew a stick figure with
  // "SA node", "Bundle of His" and "Left bundle branch" pointing at it.
  //
  // A figure is excluded for the same reason and by the same flag, even though its box is
  // not measured from a trace: the substitution is what has to be prevented, not the
  // fitting. Measured, and it is the exact failure above happening a second time — three
  // figures asking for "cutaway cross-section of a human heart" all matched *human* against
  // the character library and were drawn as stick figures, in a film that cost $0.71 and
  // contains no cutaway at all.
  const exact = asset.fit === 'exact' || asset.kind === 'figure';

  // 1. the library: drawings we chose, by path and version. First because it is the
  //    only lane whose output improves — everything below re-derives the same
  //    quality forever, so anything the library can answer, it should.
  //
  //    An entity with no `ref` still gets a look-up, on its id and then its prompt.
  //    That is what closes the no-key character gap: a planner minting `hiker` has
  //    no idea the library exists, and matching here means it does not need to.
  const curated = exact
    ? undefined
    : asset.ref
      ? { path: asset.ref.path, how: 'path' as const }
      : matchLibrary({ id: asset.id, ...(asset.prompt ? { prompt: asset.prompt } : {}) });
  if (curated) {
    const ref: AssetRef = asset.ref ?? { path: curated.path };
    const drawn = await libraryPaths({ ref, box, ctx });
    if (drawn) {
      items = pathItems(drawn.paths);
      lane = 'library';
      library = {
        path: drawn.path,
        version: drawn.version,
        ink: drawn.ink,
        how: curated.how,
        ...(drawn.pose ? { pose: drawn.pose } : {}),
      };
    }
  }

  // 1b. the figure lane: a colour teaching picture, kept as a raster and swept in.
  //
  //     It returns early rather than joining the `items` flow below, because everything
  //     below assumes ink — `writeElementSvg` would wrap traced strokes and report a
  //     stroke length for the pen to follow, and a figure has neither. What it writes is
  //     an `<image>`, and `data-ink-mode="raster-reveal"` is what tells the runtime to
  //     sweep a mask across it instead of fading it in.
  if (!items && asset.kind === 'figure') {
    if (args.provider === 'none') {
      log.warn(
        `the figure "${asset.id}" needs an image key — set FAL_KEY or REPLICATE_API_TOKEN. ` +
          'Drawing nothing rather than substituting a different picture.',
      );
    } else {
      const drawn = await figureRaster({ id: asset.id, prompt: term, dir, box, seed });
      if (drawn) {
        await writeFile(path.resolve(dir, rel), `${drawn.svg}\n`);
        return {
          id: asset.id,
          kind: asset.kind,
          lane: 'figure',
          svg: rel,
          space: 'local',
          viewBox: toViewBox({ x: 0, y: 0, w: box.w, h: box.h }),
          // No strokes on purpose: there is nothing to dash along, and claiming a length
          // would put the pen on a path that does not exist. The runtime sweeps a mask
          // across the raster instead — see `data-ink-mode` in `page/runtime.js`.
          strokes: [],
          totalLength: 0,
          seed,
          ...(asset.prompt ? { prompt: asset.prompt } : {}),
          raster: drawn.raster,
        };
      }
      log.warn(`the figure "${asset.id}" could not be generated — the beat draws without it`);
    }
  }

  // 2. the illustration lane: text-to-image → vectorise → roughen, generated at
  //    most once per asset id and cached on disk by id + prompt hash. A missing
  //    key is a downgrade to the icon lane, never an error.
  if (!items && (asset.kind === 'illustration' || asset.kind === 'image')) {
    if (args.provider === 'none') {
      if (!illustrationFallbackWarned) {
        illustrationFallbackWarned = true;
        log.info(
          'illustration assets are being drawn from the icon set — set REPLICATE_API_TOKEN ' +
            'or FAL_KEY for real illustrated subjects',
        );
      }
    } else {
      const drawn = await illustrationPaths({
        id: asset.id,
        prompt: term,
        dir,
        box,
        ctx,
        seed,
        // An underlay's box was sized to this very image's ink by the planner, from the
        // same trace, so it is already exactly right and padding it would slide the
        // subject out from under the marks aimed at it.
        ...(asset.fit ? { fit: asset.fit } : {}),
      });
      if (drawn) {
        items = pathItems(drawn.paths);
        lane = 'illustration';
        raster = drawn.raster;
      } else {
        log.warn(`illustration "${asset.id}" could not be generated — using the icon lane`);
      }
    }
  }

  // An underlay that could not be generated draws nothing at all, and that is the honest
  // outcome: the marks on top of it still teach, and the alternative is a lettered card
  // or a matched icon sitting in a box that was measured for something else, with named
  // arrows pointing into it. Only reachable with the raster caches cleared and no key —
  // the planner does not emit this element unless the picture was made and measured.
  if (!items && exact) {
    log.warn(
      `the underlay "${asset.id}" could not be generated, so the beat's marks are drawn on ` +
        'blank board — set FAL_KEY or REPLICATE_API_TOKEN, or re-run the lesson stage',
    );
    items = [];
  }

  // 3. the offline fallback provider: a roughened lucide icon, matched on the id
  //    first. The library is the things we chose; this is the things we settle for.
  if (!items?.length && !exact) {
    const match = matchAsset({ id: asset.id, ...(asset.prompt ? { prompt: asset.prompt } : {}) });
    const found = iconPaths(term, box, ctx, match ? { slug: match.slug } : {});
    if (found) {
      items = pathItems(found.paths);
      lane = 'icon';
      icon = { slug: found.slug, how: match ? match.how : found.how };
    }
  }

  // 4. last resort: a labelled card, still hand-drawn and still on-brand
  if (!items?.length && !exact) {
    items = letterCardItems(term, box, ctx, font, args.canvasHeight);
    lane = 'letter';
  }

  const written = writeElementSvg({
    id: asset.id,
    items: items ?? [],
    box,
    style,
    space: 'local',
    ...(args.fontHref ? { fontHref: args.fontHref, fontFamily: font.familyName } : {}),
    attrs: { 'data-ink-asset': asset.id, 'data-ink-lane': lane },
  });
  await writeFile(path.resolve(dir, rel), written.svg);

  return {
    id: asset.id,
    kind: asset.kind,
    lane,
    svg: rel,
    space: 'local',
    viewBox: toViewBox(written.viewBox),
    strokes: written.strokes,
    totalLength: totalStrokeLength(written.strokes),
    seed,
    ...(asset.prompt ? { prompt: asset.prompt } : {}),
    ...(library ? { library } : {}),
    ...(icon ? { icon } : {}),
    ...(raster ? { raster } : {}),
  };
}

/** A hand-drawn card with the entity's name written on it. */
function letterCardItems(
  term: string,
  box: Box,
  ctx: DrawContext,
  font: FontMetrics,
  canvasHeight: number,
): InkItem[] {
  const label = term.split(/\s+/).slice(0, 3).join(' ');
  const pad = Math.min(box.w, box.h) * 0.14;
  const inner: Box = { x: box.x + pad, y: box.y + pad, w: box.w - pad * 2, h: box.h - pad * 2 };
  return [
    ...pathItems(shapePaths('rect', box, ctx, false)),
    textItem(
      layoutText(label, {
        box: inner,
        style: ctx.style,
        font,
        role: 'heading',
        fontSize: Math.min(inner.h * 0.42, roleFontSize('heading', canvasHeight)),
        align: 'center',
        valign: 'middle',
        minScale: 0.45,
      }),
    ),
  ];
}

/* ----------------------------------------------------------------- elements */

async function resolveElement(args: {
  el: Element;
  sceneId: string;
  sceneIndex: number;
  dir: string;
  rel: string;
  style: InkStyle;
  font: FontMetrics;
  canvas: Box;
  canvasHeight: number;
  fontHref?: string;
  assetVisuals: Record<string, AssetVisual>;
  targetBox?: Box;
  maxUpscale?: number;
  /** How big everything on this board draws — see `boardMetrics` in `@inkcast/core`. */
  board: BoardMetrics;
  /** See `ResolveVisualsOptions.gates`. */
  gates?: GateMode;
}): Promise<ElementVisual> {
  const { el, style, font, canvasHeight, board } = args;
  const seed = seedFrom('element', el.id, args.sceneId);
  const gen = createGenerator(style);
  const base: DrawContext = { style, gen, seed };

  /**
   * The style this element is actually drawn with.
   *
   * A plot is drawn at the *board's* pen weight, because everything in a plot is
   * measured off it — a marked point's radius is `strokeWidth * 1.45`, an axis
   * arrowhead `strokeWidth * 2.6`. The style's own `strokeWidth` is chosen for a
   * standalone SVG that fills its viewBox, which is the right number for every other
   * element here and the wrong one for geometry the renderer has to consume.
   */
  const drawStyle: InkStyle =
    el.type === 'plot' ? { ...style, strokeWidth: board.strokeWidth } : style;

  let items: InkItem[] = [];
  let diagram: ElementVisual['diagram'];
  let equation: ElementVisual['equation'];
  let plot: ElementVisual['plot'];
  let pathLayout: ElementVisual['path'];
  let assetRef: ElementVisual['asset'];
  let emphasis: ElementVisual['emphasis'];

  switch (el.type) {
    case 'text': {
      const colour = el.role === 'caption' ? style.muted : style.ink;
      items = [
        textItem(
          layoutText(el.text, {
            box: el.at,
            style,
            font,
            role: el.role,
            align: el.align,
            canvasHeight,
            colour,
            valign: 'top',
          }),
        ),
      ];
      break;
    }
    case 'equation': {
      const resolved = await resolveEquation(
        { tex: el.tex, display: el.display, box: el.at, align: el.align },
        base,
        { style },
      );
      if (resolved) {
        equation = resolved.layout;
        items = resolved.items;
        break;
      }
      // The typesetter is unavailable or the source would not set. Under the strict
      // gate this stops the run: raw TeX in the handwriting font is the D1 defect,
      // and a render that ships it silently is exactly what the audit failed (S4-b).
      // Under degrade, draw the TeX as handwriting rather than losing the beat:
      // unset `\frac{a}{b}` on the board is poor, but a blank space where the worked
      // example should be is worse, and the warning naming the cause has already
      // been logged by the lane.
      gate(
        args.gates,
        `equation ${el.id} could not be typeset (tex: ${JSON.stringify(el.tex)}) — ` +
          'it would be drawn as raw TeX in the handwriting font',
        () => log.warn(`equation ${el.id} could not be typeset — drawing its source as text`),
      );
      items = [
        textItem(
          layoutText(el.tex, {
            box: el.at,
            style,
            font,
            role: 'body',
            align: el.align,
            canvasHeight,
            colour: style.ink,
            valign: 'middle',
          }),
        ),
      ];
      break;
    }
    case 'shape': {
      const annotation = el.shape === 'circle-highlight' || el.shape === 'underline';
      items = pathItems(
        shapePaths(
          el.shape,
          el.at,
          { ...base, colour: annotation ? style.accent : style.ink },
          el.fill,
        ),
      );
      break;
    }
    case 'arrow': {
      const ctx: DrawContext = { ...base, colour: style.secondary };
      const paths = arrowPaths(el.from, el.to, el.curve, ctx);
      items = pathItems(paths);
      if (el.label) {
        const mid = arrowMidpoint(el.from, el.to, el.curve);
        const fs = roleFontSize('caption', canvasHeight);
        const span = Math.hypot(el.to.x - el.from.x, el.to.y - el.from.y);
        const w = Math.max(fs * 6, span * 0.7);
        items.push(
          textItem(
            layoutText(el.label, {
              box: { x: mid.x - w / 2, y: mid.y - fs * 2.1, w, h: fs * 1.7 },
              style,
              font,
              role: 'caption',
              align: 'center',
              valign: 'bottom',
              colour: style.muted,
              canvasHeight,
            }),
          ),
        );
      }
      break;
    }
    case 'diagram': {
      const resolved = resolveDiagram(
        {
          box: el.at,
          kind: el.layout,
          nodes: el.nodes,
          edges: el.edges,
          style,
          font,
          canvasHeight,
          ...(args.maxUpscale !== undefined ? { maxUpscale: args.maxUpscale } : {}),
        },
        base,
      );
      diagram = resolved.layout;
      items = resolved.items;
      break;
    }
    case 'plot': {
      // Resolved at the size the renderer will actually draw it, not at a fraction of
      // the canvas. This is the half of root cause 1 that stayed open: the stage had
      // no camera, so it sized type against the whole board while the renderer framed
      // a region — a factor of five on the benchmark. In the plot lane the caption
      // size *is* the unit of measurement (gutters are `caption * 2.1`, a tick
      // `caption * 0.26`, a marked point's radius `caption * 0.2`), so geometry
      // resolved at the wrong caption size is not mis-labelled, it is unusable — which
      // is exactly why the renderer used to resolve every plot a second time.
      //
      // `board` comes from `boardMetrics` in `@inkcast/core`, the same call the
      // renderer makes, so the two agree by construction rather than by two formulas
      // being kept in step by hand.
      const resolved = resolvePlot(el, ctxFor(drawStyle, seed), {
        style: drawStyle,
        font,
        canvasHeight,
        typeSizes: { caption: board.type.caption, label: board.type.label },
        baseAt: el.enter.at,
      });
      plot = resolved.layout;
      items = resolved.items;
      break;
    }
    case 'path': {
      const resolved = resolvePath(
        {
          ...(el.points ? { points: el.points } : {}),
          ...(el.d ? { d: el.d } : {}),
          closed: el.closed,
          fill: el.fill,
          weight: el.weight,
        },
        base,
      );
      if (resolved) {
        items = pathItems(resolved.paths);
        pathLayout = {
          d: resolved.d,
          length: resolved.length,
          closed: resolved.closed,
          filled: resolved.filled,
          from: resolved.from,
        };
      } else {
        log.warn(`path ${el.id} has neither points nor path data — nothing to draw`);
      }
      break;
    }
    case 'emphasis': {
      const target = args.targetBox ?? el.at;
      items = pathItems(
        emphasisPaths(
          el.effect,
          target,
          { ...base, colour: style.accent },
          { origin: el.at, canvas: args.canvas },
        ),
      );
      emphasis = {
        targetId: el.targetId,
        effect: el.effect,
        targetBox: target,
        resolved: args.targetBox !== undefined,
      };
      if (!args.targetBox) {
        log.warn(`emphasis ${el.id} targets unknown element "${el.targetId}" — using its own box`);
      }
      break;
    }
    case 'asset': {
      const visual = args.assetVisuals[el.assetId];
      if (visual) {
        // Place the entity: fit its viewBox into the element box, mirror if
        // asked, and re-measure lengths in canvas units.
        const src: Box = {
          x: visual.viewBox[0],
          y: visual.viewBox[1],
          w: visual.viewBox[2],
          h: visual.viewBox[3],
        };
        let m = fitMatrix(src, el.at);
        if (el.flipX) m = multiply(flipXM(el.at.x + el.at.w / 2), m);
        items = pathItems(placeStrokes(visual.strokes, m));
        assetRef = { id: el.assetId, svg: visual.svg, flipX: el.flipX };
      }
      break;
    }
    default:
      break;
  }

  // Movement is resolved for *every* element type, since anything already drawn
  // can travel. The trail is not added to `items`: it must appear as the element
  // moves, not during the element's own draw-on, so the renderer strokes
  // `motion.d` itself over the movement window.
  const motion = el.motion ? resolveMotion(el.motion, el.at) : undefined;
  if (el.motion && !motion) {
    log.warn(`motion on ${el.id} has no length — the element will stay put`);
  }

  const written = writeElementSvg({
    id: el.id,
    items,
    box: el.at,
    style: drawStyle,
    space: 'canvas',
    ...(args.fontHref ? { fontHref: args.fontHref, fontFamily: font.familyName } : {}),
    attrs: {
      'data-ink-element': el.id,
      'data-ink-type': el.type,
      'data-ink-scene': args.sceneId,
      'data-ink-reveal': el.enter.style,
    },
  });
  await writeFile(path.resolve(args.dir, args.rel), written.svg);

  const visual: ElementVisual = {
    id: el.id,
    sceneId: args.sceneId,
    sceneIndex: args.sceneIndex,
    type: el.type,
    svg: args.rel,
    space: 'canvas',
    box: el.at,
    viewBox: toViewBox(written.viewBox),
    strokes: written.strokes,
    totalLength: totalStrokeLength(written.strokes),
    reveal: el.enter.style,
    enterAt: el.enter.at,
    enterDuration: el.enter.duration,
    persist: el.persist,
    ...(el.z !== undefined ? { z: el.z } : {}),
    ...(written.texts.length > 0 ? { texts: written.texts } : {}),
    ...(diagram ? { diagram } : {}),
    ...(plot ? { plot } : {}),
    ...(equation ? { equation } : {}),
    ...(pathLayout ? { path: pathLayout } : {}),
    ...(motion ? { motion } : {}),
    ...(assetRef ? { asset: assetRef } : {}),
    ...(emphasis ? { emphasis } : {}),
  };
  return visual;
}

/** Re-space an entity's strokes into canvas units, re-measuring as we go. */
function placeStrokes(strokes: InkStroke[], m: ReturnType<typeof fitMatrix>): InkPath[] {
  return strokes.map((s) => {
    const d = transformPath(s.d, m);
    return {
      d,
      stroke: s.stroke,
      strokeWidth: s.strokeWidth * Math.abs(m.a || 1),
      fill: s.fill,
      ...(s.fillRule ? { fillRule: s.fillRule } : {}),
      opacity: s.opacity,
      length: pathLength(d),
      ...(s.group ? { group: s.group } : {}),
    };
  });
}

/* -------------------------------------------------------------------- utils */

function humanise(slug: string): string {
  return slug.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Copy the handwriting font into the project so a rendered project is portable
 * and the SVGs can reference it with a relative `@font-face` src.
 */
async function copyFontIntoProject(dir: string, font: FontMetrics): Promise<string | undefined> {
  if (!font.filePath) return undefined;
  const rel = `assets/fonts/${path.basename(font.filePath)}`;
  const dest = path.resolve(dir, rel);
  try {
    await mkdir(path.dirname(dest), { recursive: true });
    const [src, existing] = await Promise.all([
      stat(font.filePath),
      stat(dest).catch(() => undefined),
    ]);
    if (!existing || existing.size !== src.size) await copyFile(font.filePath, dest);
    return rel;
  } catch (err) {
    log.warn('could not copy the handwriting font into the project', err);
    return undefined;
  }
}
