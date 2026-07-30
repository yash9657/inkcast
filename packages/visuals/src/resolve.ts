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
  hash,
  isFresh,
  logger,
  markFresh,
  report,
  type Asset,
  type AssetRef,
  type Element,
  type StageOptions,
  type Storyboard,
} from '@inkcast/core';
import { resolveDiagram } from './diagram.js';
import { resolveEquation } from './equation.js';
import type { FontMetrics } from './fontmetrics.js';
import { loadFontMetrics } from './fontmetrics.js';
import type { DrawContext, InkPath } from './geometry.js';
import {
  arrowMidpoint,
  arrowPaths,
  createGenerator,
  emphasisPaths,
  seedFrom,
  shapePaths,
} from './geometry.js';
import { iconPaths, iconsAvailable, matchAsset } from './icons.js';
import { detectImageProvider, illustrationPaths } from './image.js';
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
    style: style.name,
    preferred: style.fontFiles,
    fontFamily: style.fontFamily,
    ...(opts.fontPath ? { fontPath: opts.fontPath } : {}),
  });
  const fontRel = await copyFontIntoProject(dir, font);
  // The SVGs live in `assets/`, so the @font-face href is relative to that.
  const fontHref = fontRel ? fontRel.replace(/^assets\//, '') : undefined;
  const fontFP = [font.familyName, font.source, font.unitsPerEm, font.ascent, font.descent].join(
    '|',
  );
  const canvasHeight = out.canvas.h;

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

  for (const asset of out.assets) {
    const rel = `assets/${sanitiseId(asset.id)}.svg`;
    const key = `visuals:asset:${asset.id}`;
    const inputHash = hash(
      // v3: the library lane resolves ahead of illustration and icon, so an asset
      // whose id or prompt now matches a curated drawing has different geometry for
      // identical storyboard inputs.
      'asset/v3',
      asset.id,
      asset.kind,
      asset.prompt ?? '',
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
        ...(opts.maxUpscale !== undefined ? { maxUpscale: opts.maxUpscale } : {}),
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

async function resolveAsset(args: {
  asset: Asset;
  dir: string;
  rel: string;
  style: InkStyle;
  font: FontMetrics;
  canvasHeight: number;
  provider: string;
  fontHref?: string;
}): Promise<AssetVisual> {
  const { asset, dir, rel, style, font } = args;
  const seed = asset.seed ?? seedFrom('asset', asset.id);
  const box: Box = { x: 0, y: 0, w: NOMINAL_ASSET, h: NOMINAL_ASSET };
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

  // 1. the library: drawings we chose, by path and version. First because it is the
  //    only lane whose output improves — everything below re-derives the same
  //    quality forever, so anything the library can answer, it should.
  //
  //    An entity with no `ref` still gets a look-up, on its id and then its prompt.
  //    That is what closes the no-key character gap: a planner minting `hiker` has
  //    no idea the library exists, and matching here means it does not need to.
  const curated = asset.ref
    ? { path: asset.ref.path, how: 'path' as const }
    : matchLibrary({ id: asset.id, ...(asset.prompt ? { prompt: asset.prompt } : {}) });
  if (curated) {
    const ref: AssetRef = asset.ref ?? { path: curated.path };
    const drawn = libraryPaths({ ref, box, ctx });
    if (drawn) {
      items = pathItems(drawn.paths);
      lane = 'library';
      library = { path: drawn.path, version: drawn.version, ink: drawn.ink, how: curated.how };
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

  // 3. the offline fallback provider: a roughened lucide icon, matched on the id
  //    first. The library is the things we chose; this is the things we settle for.
  if (!items) {
    const match = matchAsset({ id: asset.id, ...(asset.prompt ? { prompt: asset.prompt } : {}) });
    const found = iconPaths(term, box, ctx, match ? { slug: match.slug } : {});
    if (found) {
      items = pathItems(found.paths);
      lane = 'icon';
      icon = { slug: found.slug, how: match ? match.how : found.how };
    }
  }

  // 4. last resort: a labelled card, still hand-drawn and still on-brand
  if (!items) {
    items = letterCardItems(term, box, ctx, font, args.canvasHeight);
    lane = 'letter';
  }

  const written = writeElementSvg({
    id: asset.id,
    items,
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
}): Promise<ElementVisual> {
  const { el, style, font, canvasHeight } = args;
  const seed = seedFrom('element', el.id, args.sceneId);
  const gen = createGenerator(style);
  const base: DrawContext = { style, gen, seed };

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
      // The typesetter is unavailable or the source would not set. Draw the TeX as
      // handwriting rather than losing the beat: unset `\frac{a}{b}` on the board is
      // poor, but a blank space where the worked example should be is worse, and the
      // warning naming the cause has already been logged by the lane.
      log.warn(`equation ${el.id} could not be typeset — drawing its source as text`);
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
      const resolved = resolvePlot(el, base, {
        style,
        font,
        canvasHeight,
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
    style,
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
