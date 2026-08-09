/**
 * The illustration lane: text-to-image → vectorise → roughen.
 *
 * Nine roughened lucide icons is not a visual language. An Odyssey explainer
 * needs a drawn Odysseus, an onboarding video needs a drawn laptop, and no icon
 * set contains either. So this is a **real lane**, on by default wherever a key
 * exists, not a switch nobody flips.
 *
 * Adapter order is fixed and env-driven: `REPLICATE_API_TOKEN`, then `FAL_KEY`,
 * then none. With no key we log exactly once and the caller uses the icon lane —
 * a missing key is a downgrade, never an error, because the project's headline
 * promise is that everything works offline for free.
 *
 * Two decisions are worth understanding before changing them:
 *
 * 1. **We prompt for line art, not for a picture.** A photorealistic render
 *    vectorises into hundreds of overlapping colour blobs that animate as noise;
 *    flat black strokes on white vectorise into a few dozen closed outlines that
 *    roughen into something that belongs on a whiteboard. The aesthetic
 *    constraint and the technical one point the same way, which is lucky.
 * 2. **One generation per asset id, ever — and per machine, not per project.** The
 *    raster is cached in three places, checked in that order: the project's own
 *    `assets/illustrations/<id>-<promptHash>.png`, the machine-wide
 *    `~/.inkcast/cache/illustrations/`, and a per-process map. Generating "the rover"
 *    a second time is exactly what makes competing tools render a different rover in
 *    every scene, and it also costs money per scene instead of per film. The
 *    machine-wide tier is what extends that from *per film* to *per subject*: the
 *    second video about the rover pays nothing and, more importantly, draws the same
 *    rover. The project copy stays because a project directory has to remain
 *    portable on its own.
 *
 * Request shapes were checked against the live provider schemas (Replicate's
 * OpenAPI for `black-forest-labs/flux-schnell`, fal's OpenAPI for
 * `fal-ai/flux/schnell`) rather than recalled; see the notes on each adapter.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { cacheDir, hash, logger } from '@inkcast/core';
import type { DrawContext, InkPath } from './geometry.js';
import { roughenPathData } from './geometry.js';
import type { Box } from './svg.js';
import {
  fitMatrix,
  parsePath,
  pathToString,
  pointsBBox,
  samplePath,
  transformSegs,
  unionBox,
} from './svg.js';
import { sanitiseId } from './writer.js';

const log = logger('visuals:image');

export type ImageProvider = 'replicate' | 'fal' | 'none';

/**
 * What we are asking a raster for, and they are two different jobs.
 *
 * - `form` — the *shape* of a real thing, as line art, for the tracer to redraw in the
 *   board's own hand with composed marks naming its parts. The lane that already exists.
 * - `figure` — the beat's whole *teaching figure*, in colour: the view, the internal
 *   structures, the pathway, the arrows. It is shown as a raster and never traced, because
 *   a binary trace of a colour figure erases exactly the part that teaches.
 *
 * See `docs/PLAN-FIGURE-LANE.md`. The split is not stylistic: measured on 2026-08-06, a
 * four-step model asked for a cutaway heart returns an external heart however the prompt is
 * written, and a 28-step model returns the cutaway on the first try.
 */
export type ImageKind = 'form' | 'figure';

/**
 * Flux-schnell class models: four denoising steps, cents per image, and by far
 * the best of the cheap tier at flat line art.
 *
 * The figure tier costs roughly ten times as much per image (~$0.025 against ~$0.003) and
 * is worth it only where the picture carries the teaching, which is why the lane is chosen
 * per beat rather than per film. `INKCAST_FIGURE_MODEL` overrides the endpoint without a
 * code change — `fal-ai/nano-banana` is the marker-style pick and also cleared the bar.
 */
const MODELS: Record<Exclude<ImageProvider, 'none'>, Record<ImageKind, string>> = {
  replicate: {
    form: 'black-forest-labs/flux-schnell',
    figure: 'black-forest-labs/flux-dev',
  },
  fal: {
    form: 'fal-ai/flux/schnell',
    figure: 'fal-ai/flux/dev',
  },
};

/** Denoising steps. Schnell is *capped* at 4; the figure tier needs the full schedule. */
const STEPS: Record<ImageKind, number> = { form: 4, figure: 28 };

/**
 * What both providers price an image at, and what `square_hd` already was: ~1 megapixel.
 * Holding the *area* rather than the long edge is what makes a 3:2 request cost the same
 * as a square one.
 */
const RASTER_PIXELS = 1024 * 1024;
/** Diffusion models quantise their latent grid anyway; asking off-grid buys nothing. */
const RASTER_STEP = 32;
/**
 * The widest (or tallest) shape worth asking for. A very long box is a layout defect
 * upstream, and a model asked for a 6:1 banner of one subject returns a strip of repeats
 * rather than one subject — so the raster is clamped and letterboxes a little instead.
 */
const RASTER_ASPECT_LIMIT = 2.5;

/**
 * The pixel size to ask a provider for, from the shape of the box the raster will fill.
 *
 * Both providers were hard-coded square, and that cost the figure lane a third of every box
 * it was handed. Measured on `projects/cardiac8`: a 1024×1024 PNG in a 567×378 element drew
 * **378×378 — 66.7% of its box**, the remainder reserved paper with nothing on it, on all
 * three cutaway beats. The runtime fits an asset uniformly and centres it (the `Math.min`
 * in `page/runtime.js`), which is correct and must stay correct — a stretched heart is
 * worse than a small one. So the fix belongs here: ask for the shape we are going to show.
 *
 * A square request still returns exactly 1024×1024, which is what `square_hd` meant, so
 * every raster in the caches is still bit-for-bit what would be asked for today.
 */
export function rasterSize(aspect: number): { width: number; height: number } {
  const a =
    Number.isFinite(aspect) && aspect > 0
      ? Math.min(RASTER_ASPECT_LIMIT, Math.max(1 / RASTER_ASPECT_LIMIT, aspect))
      : 1;
  const snap = (v: number): number =>
    Math.max(RASTER_STEP, Math.round(v / RASTER_STEP) * RASTER_STEP);
  return { width: snap(Math.sqrt(RASTER_PIXELS * a)), height: snap(Math.sqrt(RASTER_PIXELS / a)) };
}

/**
 * Replicate's flux models take a named `aspect_ratio`, not pixel dimensions, so a request
 * is served by the nearest name they accept. Nearest in *log* space: 3:2 has to be exactly
 * as far from 1:1 as 2:3 is, and a linear distance says otherwise.
 */
const REPLICATE_ASPECTS = [
  '21:9',
  '16:9',
  '3:2',
  '4:3',
  '5:4',
  '1:1',
  '4:5',
  '3:4',
  '2:3',
  '9:16',
  '9:21',
] as const;

export function replicateAspect(aspect: number): string {
  const want = Math.log(Number.isFinite(aspect) && aspect > 0 ? aspect : 1);
  let best = '1:1';
  let bestGap = Infinity;
  for (const name of REPLICATE_ASPECTS) {
    const [w, h] = name.split(':').map(Number) as [number, number];
    const gap = Math.abs(Math.log(w / h) - want);
    if (gap < bestGap) {
      bestGap = gap;
      best = name;
    }
  }
  return best;
}

function modelFor(provider: Exclude<ImageProvider, 'none'>, kind: ImageKind): string {
  const override = kind === 'figure' ? process.env.INKCAST_FIGURE_MODEL : undefined;
  return override && override.trim().length > 0 ? override.trim() : MODELS[provider][kind];
}

/** Where cached rasters live, relative to the project directory. */
export const ILLUSTRATION_DIR = 'assets/illustrations';

let announced = false;

/** Which provider (if any) is configured. Logged once per process. */
export function detectImageProvider(): ImageProvider {
  const provider: ImageProvider = process.env.REPLICATE_API_TOKEN
    ? 'replicate'
    : process.env.FAL_KEY
      ? 'fal'
      : 'none';
  if (!announced) {
    announced = true;
    if (provider === 'none') {
      log.info(
        'no REPLICATE_API_TOKEN or FAL_KEY — illustrations fall back to the built-in icon set ' +
          '(free, offline); set either key to draw real illustrated subjects',
      );
    } else {
      log.info(`illustration lane enabled via ${provider}`);
    }
  }
  return provider;
}

/** Reset the once-per-process log latch. Tests only. */
export function resetImageProviderNotice(): void {
  announced = false;
}

/**
 * Shape the prompt for our aesthetic *and* for the tracer, which want the same
 * thing: one subject, black strokes, white ground, no shading, no background,
 * high contrast.
 *
 * The negatives matter as much as the positives. "no text" stops the model
 * lettering the subject (traced lettering is unreadable mush); "no background"
 * and "no shading" stop the large flat regions that swamp a binary trace; "not
 * cropped" keeps the silhouette closed so the outline traces as one shape.
 */
export function illustrationPrompt(prompt: string): string {
  return (
    `${prompt.trim()}, a single centred subject, clean black line art on a plain white ` +
    'background, bold even marker outlines, high contrast pure black on pure white, ' +
    'no shading, no hatching, no gradients, no colour, no grey tones, no background scenery, ' +
    'no frame, no text, no watermark, whole subject in frame not cropped, ' +
    'minimal hand-drawn whiteboard illustration'
  );
}

/**
 * Shape the prompt for a **teaching figure**, which is not shaped for the tracer at all.
 *
 * Every negative `illustrationPrompt` carries exists to protect a binary trace, and a
 * figure is never traced — so shading, colour fills and interior structure are not merely
 * allowed here, they are the point. What survives from the other prompt is the framing (one
 * centred subject, whole subject in frame, plain background) and, above all, **no text**:
 * lettering is the one limit that did not move. An image model still cannot spell, and
 * names remain the mark layer's job, which is the half we are genuinely better at.
 *
 * "Hand-drawn educational diagram" rather than "photorealistic" or "3D render" is doing
 * real work: it keeps the figure inside the board's own idiom, so a generated picture and a
 * composed one can share a frame without looking like a collage.
 */
export function figurePrompt(prompt: string): string {
  return (
    `${prompt.trim()}, hand-drawn educational diagram in the style of a marker illustration ` +
    'on white paper, clean confident outlines, flat semantic colour fills, clearly separated ' +
    'parts, plain white background, no background scenery, no frame, ' +
    'no text, no lettering, no labels, no captions, no watermark, ' +
    'whole subject in frame not cropped'
  );
}

/** The prompt shaping a raster of this kind goes through. */
export function shapePrompt(prompt: string, kind: ImageKind): string {
  return kind === 'figure' ? figurePrompt(prompt) : illustrationPrompt(prompt);
}

async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs = 120_000,
): Promise<Record<string, unknown> | undefined> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      log.warn(`image API ${res.status} ${res.statusText}`, (await res.text()).slice(0, 200));
      return undefined;
    }
    return (await res.json()) as Record<string, unknown>;
  } catch (err) {
    log.warn('image API request failed', err);
    return undefined;
  }
}

function firstUrl(value: unknown): string | undefined {
  if (typeof value === 'string' && value.startsWith('http')) return value;
  if (Array.isArray(value)) {
    for (const v of value) {
      const u = firstUrl(v);
      if (u) return u;
    }
    return undefined;
  }
  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    return firstUrl(rec.url ?? rec.image ?? rec.images ?? rec.output);
  }
  return undefined;
}

/**
 * Replicate.
 *
 * `POST /v1/models/{owner}/{model}/predictions` is the endpoint for official
 * models, and `Prefer: wait` holds the connection open until the prediction
 * finishes (60s ceiling, after which the incomplete prediction comes back with
 * `status: starting|processing` and `urls.get` to poll — which is why the poll
 * loop below still exists).
 *
 * Input fields are exactly flux-schnell's schema. Two are easy to get wrong:
 * `output_format` defaults to **webp**, which the vectoriser cannot read, so png
 * is explicit; and `num_inference_steps` is capped at 4 on **schnell** — passing the
 * figure tier's 28 to it is an API error, not a slower image, which is why the step count
 * travels with the kind rather than being a constant.
 *
 * `aspect_ratio` here is a name from a fixed list, unlike fal's explicit pixel size, so the
 * request is the nearest name — see `replicateAspect`.
 */
async function generateReplicate(
  prompt: string,
  kind: ImageKind,
  aspect: number,
  seed?: number,
): Promise<Buffer | undefined> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) return undefined;
  const model = modelFor('replicate', kind);
  let body = await fetchJson(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      prefer: 'wait',
    },
    body: JSON.stringify({
      input: {
        prompt,
        num_outputs: 1,
        aspect_ratio: replicateAspect(aspect),
        num_inference_steps: STEPS[kind],
        output_format: 'png',
        megapixels: '1',
        go_fast: true,
        ...(seed !== undefined ? { seed } : {}),
      },
    }),
  });
  if (!body) return undefined;

  for (let i = 0; i < 40 && (body.status === 'starting' || body.status === 'processing'); i++) {
    const urls = body.urls as Record<string, string> | undefined;
    if (!urls?.get) break;
    await new Promise((r) => setTimeout(r, 1500));
    const next = await fetchJson(
      urls.get,
      { headers: { authorization: `Bearer ${token}` } },
      30_000,
    );
    if (!next) break;
    body = next;
  }
  if (body.status && body.status !== 'succeeded') {
    log.warn(`replicate prediction ${String(body.status)}`, String(body.error ?? ''));
    return undefined;
  }
  // flux-schnell's output is an array of file URIs.
  return download(firstUrl(body.output));
}

/**
 * fal.
 *
 * `https://fal.run/{endpoint}` is the synchronous endpoint (the queue lives on
 * `queue.fal.run`), authenticated with `Authorization: Key <FAL_KEY>`.
 *
 * Schema notes: `output_format` defaults to **jpeg**, so png is explicit;
 * `image_size` takes the named presets or an explicit `{width, height}`, and
 * `square_hd` is 1024×1024; the response is `{ images: [{ url, width, height }] }`.
 *
 * The explicit `{width, height}` is used rather than a preset name because the shape asked
 * for is the shape of a box on the board, and no preset matches an arbitrary one. A square
 * request still resolves to 1024×1024 — the same bytes `square_hd` requested.
 */
async function generateFal(
  prompt: string,
  kind: ImageKind,
  aspect: number,
  seed?: number,
): Promise<Buffer | undefined> {
  const key = process.env.FAL_KEY;
  if (!key) return undefined;
  const body = await fetchJson(`https://fal.run/${modelFor('fal', kind)}`, {
    method: 'POST',
    headers: { authorization: `Key ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt,
      image_size: rasterSize(aspect),
      num_images: 1,
      num_inference_steps: STEPS[kind],
      output_format: 'png',
      enable_safety_checker: true,
      ...(seed !== undefined ? { seed } : {}),
    }),
  });
  if (!body) return undefined;
  return download(firstUrl(body.images ?? body.image));
}

async function download(url: string | undefined): Promise<Buffer | undefined> {
  if (!url) {
    log.warn('image API returned no usable image url');
    return undefined;
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) {
      log.warn(`image download ${res.status}`);
      return undefined;
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    log.warn('image download failed', err);
    return undefined;
  }
}

/**
 * Generate one raster illustration, or `undefined` if unavailable.
 *
 * Prefer `illustrationRaster`, which caches; this is the uncached call beneath
 * it and is exported for previewing a prompt.
 */
export async function generateIllustration(
  prompt: string,
  opts: { seed?: number; kind?: ImageKind; aspect?: number } = {},
): Promise<Buffer | undefined> {
  const provider = detectImageProvider();
  if (provider === 'none') return undefined;
  const kind = opts.kind ?? 'form';
  const aspect = opts.aspect ?? 1;
  const shaped = shapePrompt(prompt, kind);
  const size = rasterSize(aspect);
  log.debug(
    `generating ${kind} ${size.width}x${size.height} via ${provider} (${modelFor(provider, kind)})`,
    prompt,
  );
  return provider === 'replicate'
    ? generateReplicate(shaped, kind, aspect, opts.seed)
    : generateFal(shaped, kind, aspect, opts.seed);
}

/* ------------------------------------------------------------------ caching */

/**
 * Cache key for an illustration: the asset id plus a hash of its prompt, its kind **and the
 * shape it was asked for**.
 *
 * The kind is in the hash because a form and a figure of the same subject are two different
 * pictures — one flat line art for the tracer, one a colour teaching figure — and a key that
 * could not tell them apart would serve whichever was generated first. That is the same
 * silent aliasing that cost `projects/cardiac5` its two best cards through `underlayAsset`,
 * and it is worth being paranoid about twice. The shape is in for exactly the same reason:
 * a 3:2 figure and a square one of the same subject are two different pictures, and serving
 * the square one for a 3:2 box would silently restore the defect the aspect exists to fix.
 *
 * **A square request contributes nothing to the hash**, and that is deliberate rather than
 * lazy: every raster in every cache was generated when both providers were hard-coded
 * square, so the square token has to stay absent or the whole machine cache — a few dollars
 * of images, and the only reason two videos about the rover agree what the rover looks
 * like — invalidates on a change that would ask for the identical bytes.
 */
export function illustrationKey(
  id: string,
  prompt: string,
  kind: ImageKind = 'form',
  aspect = 1,
): string {
  const size = rasterSize(aspect);
  const shape = size.width === size.height ? [] : [`${size.width}x${size.height}`];
  return `${sanitiseId(id)}-${hash('illustration/v2', kind, prompt.trim(), ...shape).slice(0, 10)}`;
}

export type IllustrationRaster = {
  png: Buffer;
  /** Project-relative path to the cached raster. */
  rel: string;
  /** True when this run did not call the provider. */
  cached: boolean;
  /** Which tier answered — `project`, the machine-wide `cache`, or a `provider` call. */
  from: 'project' | 'cache' | 'provider';
  provider: ImageProvider;
};

/**
 * In-flight and completed generations, keyed by `illustrationKey`.
 *
 * The promise (not the buffer) is memoised on purpose: two elements referencing
 * one asset can be resolved concurrently, and racing them would generate the
 * subject twice and then disagree about which file won.
 */
const inflight = new Map<string, Promise<IllustrationRaster | undefined>>();

/** Drop the per-process raster memo. Tests only. */
export function resetIllustrationCache(): void {
  inflight.clear();
}

/** Read a PNG, treating an empty or unreadable file as a cache miss. */
async function readCachedPng(file: string): Promise<Buffer | undefined> {
  if (!existsSync(file)) return undefined;
  try {
    const png = await readFile(file);
    return png.length > 0 ? png : undefined;
  } catch (err) {
    log.warn(`could not read the cached illustration ${file}`, err);
    return undefined;
  }
}

/**
 * The raster for one asset id — generated at most once per id and prompt, ever.
 *
 * The order is project cache, machine cache, in-process memo, provider. Project
 * first even though the machine cache is the more valuable tier, because a project
 * directory is meant to be self-describing: if someone hands you a project, the
 * rasters in it are the ones it was rendered from, and a machine cache entry under
 * the same key must not be allowed to disagree.
 *
 * Returns `undefined` when no key is configured or the provider failed; the caller
 * then falls through to the icon lane.
 */
export async function illustrationRaster(args: {
  id: string;
  prompt: string;
  /** Project working directory. */
  dir: string;
  seed?: number;
  /** `form` (line art, to be traced) or `figure` (a colour teaching picture). */
  kind?: ImageKind;
  /** Width over height of the box this raster will fill. Defaults to square. */
  aspect?: number;
}): Promise<IllustrationRaster | undefined> {
  const kind = args.kind ?? 'form';
  const aspect = args.aspect ?? 1;
  const key = illustrationKey(args.id, args.prompt, kind, aspect);
  const rel = `${ILLUSTRATION_DIR}/${key}.png`;
  const abs = path.resolve(args.dir, rel);
  const shared = path.join(cacheDir('illustrations'), `${key}.png`);
  const memoKey = `${path.resolve(args.dir)}::${key}`;

  const existing = inflight.get(memoKey);
  if (existing) return existing;

  /** Keep a copy where the caller expects one, without failing the resolve over it. */
  const stash = async (file: string, png: Buffer, what: string): Promise<void> => {
    try {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, png);
    } catch (err) {
      log.warn(`could not cache the illustration in the ${what} (${file})`, err);
    }
  };

  const task = (async (): Promise<IllustrationRaster | undefined> => {
    const own = await readCachedPng(abs);
    if (own) {
      log.debug(`illustration ${args.id} served from the project`, rel);
      return { png: own, rel, cached: true, from: 'project', provider: detectImageProvider() };
    }

    // The tier that makes the tenth video cheaper than the first: this subject may
    // have been drawn for a different project entirely, and reusing it is both free
    // and the only way two videos agree about what the subject looks like.
    const machine = await readCachedPng(shared);
    if (machine) {
      log.debug(`illustration ${args.id} served from the machine cache`, shared);
      await stash(abs, machine, 'project');
      return { png: machine, rel, cached: true, from: 'cache', provider: detectImageProvider() };
    }

    const provider = detectImageProvider();
    if (provider === 'none') return undefined;
    const png = await generateIllustration(args.prompt, {
      ...(args.seed !== undefined ? { seed: args.seed } : {}),
      kind,
      aspect,
    });
    if (!png || png.length === 0) return undefined;
    await stash(abs, png, 'project');
    await stash(shared, png, 'machine cache');
    return { png, rel, cached: false, from: 'provider', provider };
  })();

  inflight.set(memoKey, task);
  return task;
}

/* ------------------------------------------------------------- vectorisation */

type VectorizeFn = (source: Buffer, config?: unknown) => Promise<string>;
let vectorizer: { vectorize: VectorizeFn; config: unknown } | null | undefined;

/**
 * `@neplex/vectorizer` (the Rust vtracer binding) is verified working on
 * darwin-arm64 and linux-x64 prebuilds, which is why it is preferred over
 * potrace: it traces to splines rather than to polygons, so the outline is
 * already smooth before roughjs touches it, and it needs no ImageMagick-class
 * external binary.
 *
 * It is still an `optionalDependency` — it ships a native binary, and a platform
 * without a prebuild must degrade to the icon lane rather than fail to install.
 * Hence the lazy import through a variable, so `tsc` never needs it either.
 *
 * `webpackIgnore` is what keeps that working inside the studio. To webpack an
 * `import()` of a variable is a context module it cannot resolve, so it warned
 * "Critical dependency: the request of a dependency is an expression" and the
 * only symptom in a production build was this lane quietly reporting itself
 * unavailable — a paid-for key silently ignored. Left alone, Node resolves the
 * package at runtime from the root `node_modules` (`.npmrc` public-hoists
 * `@neplex/*` exactly so the app directory can reach it), and `next.config.ts`
 * already lists it under `serverExternalPackages`.
 */
async function loadVectorizer(): Promise<{ vectorize: VectorizeFn; config: unknown } | null> {
  if (vectorizer !== undefined) return vectorizer;
  try {
    const specifier = '@neplex/vectorizer';
    const mod = (await import(/* webpackIgnore: true */ specifier)) as {
      vectorize: VectorizeFn;
      ColorMode: { Binary: number };
      Hierarchical: { Stacked: number };
      PathSimplifyMode: { Spline: number };
    };
    vectorizer = {
      vectorize: mod.vectorize,
      config: {
        // Binary mode is the whole reason we prompt for black-on-white: it
        // collapses the image to one layer of outlines instead of a stack of
        // colour regions.
        colorMode: mod.ColorMode.Binary,
        hierarchical: mod.Hierarchical.Stacked,
        mode: mod.PathSimplifyMode.Spline,
        filterSpeckle: 6,
        cornerThreshold: 60,
        lengthThreshold: 4.5,
        spliceThreshold: 45,
        maxIterations: 10,
        colorPrecision: 6,
        layerDifference: 16,
        pathPrecision: 2,
      },
    };
  } catch (err) {
    log.warn('@neplex/vectorizer unavailable — cannot vectorise generated rasters', err);
    vectorizer = null;
  }
  return vectorizer;
}

const PATH_RE = /<path\b([^>]*)>/g;
const D_RE = /\bd="([^"]+)"/;
const TRANSLATE_RE = /\btransform="translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)"/;

/**
 * Pull the path data out of a vectoriser's SVG output, each path placed where it belongs.
 *
 * **vtracer writes every path's coordinates relative to its own origin and carries the
 * real position in a `transform="translate(x,y)"` attribute.** Reading `d` alone — which
 * is what this did — stacks every traced part on one point. Measured on the anatomical
 * heart the hybrid lane is built for: six paths, all six starting at `M0 0`, five of them
 * small interior details that landed in a smudge on the aortic arch instead of scattered
 * across the organ. It survived this long because the one path carrying most of the ink is
 * usually much the largest, so the union bounds barely move and the subject still looks
 * roughly like itself; the parts inside it do not.
 *
 * The translate is baked into the returned data rather than handed back beside it, because
 * every caller wants one coordinate space and none of them wants to remember why.
 */
export function extractPathData(svg: string): string[] {
  const out: string[] = [];
  PATH_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PATH_RE.exec(svg)) !== null) {
    const attrs = m[1] as string;
    const d = D_RE.exec(attrs);
    if (!d) continue;
    const t = TRANSLATE_RE.exec(attrs);
    if (!t) {
      out.push(d[1] as string);
      continue;
    }
    const e = Number(t[1]);
    const f = Number(t[2]);
    out.push(
      e === 0 && f === 0
        ? (d[1] as string)
        : pathToString(transformSegs(parsePath(d[1] as string), { a: 1, b: 0, c: 0, d: 1, e, f })),
    );
  }
  return out;
}

/** One traced path, measured. */
type TracedPath = { segs: ReturnType<typeof parsePath>; bbox: Box; area: number };

/**
 * A raster traced to measured paths, plus the box its ink occupies.
 *
 * One function because two callers must agree on it exactly: the lane that draws the ink,
 * and the hybrid lane's seam, which reports where the subject will land so a drawing author
 * can aim marks at it. Two implementations of "where is the ink" would put a leader arrow
 * on empty board and look like the model being bad at aiming.
 */
async function traceImage(png: Buffer): Promise<{ paths: TracedPath[]; ink: Box } | undefined> {
  const v = await loadVectorizer();
  if (!v) return undefined;
  let traced: string;
  try {
    traced = await v.vectorize(png, v.config);
  } catch (err) {
    log.warn('vectorisation failed', err);
    return undefined;
  }
  const raw = extractPathData(traced);
  if (raw.length === 0) {
    log.warn('vectoriser produced no paths');
    return undefined;
  }
  const paths = raw
    .map((d) => {
      const segs = parsePath(d);
      const bbox = pointsBBox(samplePath(segs));
      return { segs, bbox, area: bbox.w * bbox.h };
    })
    .filter((p) => p.area > 0);
  if (paths.length === 0) return undefined;
  return { paths, ink: unionBox(paths.map((p) => p.bbox)) };
}

/**
 * Where a generated image's ink actually is, in the image's own pixel coordinates.
 *
 * The hybrid drawing lane needs this before it can brief anybody: a text-to-image model
 * asked for "a human heart" returns a heart with a wide white margin around it, and the
 * board draws the *ink*, not the frame. So the box the subject will occupy on the canvas
 * is derived from this, and the author is shown a picture of exactly that.
 */
export async function tracedInkBox(png: Buffer): Promise<Box | undefined> {
  return (await traceImage(png))?.ink;
}

/**
 * Raster → traced SVG → roughened strokes fitted into `box`.
 *
 * The trace is scaled into the box *before* roughening (same reason as the icon
 * lane: wobble applied in 1024-unit space and then scaled down disappears, and
 * the reverse turns into a scribble) and specks are dropped, since 400
 * two-pixel paths animate as noise rather than as a drawing. Largest-area first,
 * so the reveal builds the silhouette before the details.
 */
export async function vectoriseToInk(
  png: Buffer,
  box: Box,
  ctx: DrawContext,
  opts: { maxPaths?: number; fit?: 'contain' | 'exact' } = {},
): Promise<InkPath[] | undefined> {
  const traced = await traceImage(png);
  if (!traced) return undefined;
  const { paths: measured, ink: source } = traced;

  const minArea = source.w * source.h * 0.0006;
  const kept = measured
    .filter((p) => p.area >= minArea)
    .sort((a, b) => b.area - a.area)
    .slice(0, opts.maxPaths ?? 40);
  if (kept.length === 0) return undefined;

  // `exact` is for an asset something else on the board is aimed at. The caller has
  // already sized the box to this image's own ink — via `tracedInkBox`, the same trace —
  // so the usual breathing room would shift the subject a few units out from under every
  // leader arrow pointing at it. Nothing but the hybrid lane asks for it.
  const m = fitMatrix(source, box, opts.fit === 'exact' ? 0 : Math.min(box.w, box.h) * 0.04);
  const paths: InkPath[] = [];
  kept.forEach((p, i) => {
    const d = pathToString(transformSegs(p.segs, m));
    paths.push(
      ...roughenPathData({ ...ctx, group: 'illustration' }, d, 70 + i, {
        roughness: ctx.style.roughness * 0.7,
        bowing: ctx.style.bowing * 0.8,
        fill: undefined,
      }),
    );
  });
  return paths.length > 0 ? paths : undefined;
}

/**
 * A PNG's intrinsic size, straight out of the IHDR chunk.
 *
 * The placement reads the real header rather than assuming the shape it asked for: a
 * provider is free to round a request to its own latent grid, and an aspect assumption that
 * is right until it is not is the kind of thing that comes back as a stretched heart nobody
 * can explain. Falls back to a square if the header is not a PNG.
 */
function pngSize(png: Buffer): { w: number; h: number } {
  const PNG_MAGIC = '89504e470d0a1a0a';
  if (png.length < 24 || png.subarray(0, 8).toString('hex') !== PNG_MAGIC) {
    log.warn('a figure raster is not a PNG — assuming it is square');
    return { w: 1024, h: 1024 };
  }
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  return w > 0 && h > 0 ? { w, h } : { w: 1024, h: 1024 };
}

/**
 * A colour figure, kept as a raster and never traced.
 *
 * Measured, and this is the whole argument for the mode: thresholding a figure whose
 * conduction arrows are orange **erases the arrows** — vtracer runs in `ColorMode.Binary`
 * and orange sits on the wrong side of the luminance cut — merges the red and blue chambers
 * into one black mass, and turns the interiors into scribble. See
 * `docs/research/figure-lane/binary-destroys-colour.png`. There is no tracer setting that
 * fixes that, because the information being destroyed is hue and a binary trace has no
 * hue. `docs/STYLES.md` §1 called this years before it was measured: **do not vectorize
 * rich illustration.**
 *
 * What comes back is an `<image>` wrapped in an SVG. `inlineImages` in the renderer already
 * data-URIs a relative `<image href>`, and the runtime already paints one — `image` is in
 * its `PAINTABLE` set. Nothing upstream had ever produced one.
 */
export async function figureRaster(args: {
  id: string;
  prompt: string;
  dir: string;
  box: Box;
  seed?: number;
}): Promise<{ svg: string; raster: string; cached: boolean } | undefined> {
  const raster = await illustrationRaster({
    id: args.id,
    prompt: args.prompt,
    dir: args.dir,
    ...(args.seed !== undefined ? { seed: args.seed } : {}),
    kind: 'figure',
    // The box is the whole point of asking. Every figure before this drew at **66.7% of
    // the box reserved for it** — measured on all three of `cardiac8`'s cutaways, e.g. a
    // 1024×1024 raster in a 567×378 element drawing 378×378 — because the request was
    // hard-coded square and the box is 3:2. A third of the area the figure lane exists to
    // claim was reserved paper with nothing on it, and no check in the repo could see it.
    aspect: args.box.h > 0 ? args.box.w / args.box.h : 1,
  });
  if (!raster) return undefined;
  // Fit the raster's own aspect inside the box and emit the `<image>` at exactly that
  // rectangle, rather than letting `preserveAspectRatio` letterbox it inside a wider one.
  // The difference is not cosmetic: the reveal mask and the pen both work from the
  // element's bounding box, so a letterboxed image spends a fifth of its sweep on empty
  // margin and parks the nib off the picture entirely.
  const size = pngSize(raster.png);
  const scale = Math.min(args.box.w / size.w, args.box.h / size.h);
  const w = size.w * scale;
  const h = size.h * scale;
  const x = (args.box.w - w) / 2;
  const y = (args.box.h - h) / 2;
  // The href is project-relative: the renderer resolves and inlines it against the project
  // directory, and keeping it relative is what lets a project stay self-describing.
  //
  // `mix-blend-mode: multiply` is what makes the picture sit *on* the board rather than on
  // a white card laid over it. Every one of these rasters is drawn on white, the board's
  // paper is `#fcfbf9`, and multiplying by white is the identity — so the card disappears,
  // the paper's warmth carries through the picture, and the grid dots read underneath it.
  // The first render without it showed the card's edges plainly against the paper.
  const n = (v: number): string => String(Math.round(v * 100) / 100);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(args.box.w)}" ` +
    `height="${n(args.box.h)}" viewBox="0 0 ${n(args.box.w)} ${n(args.box.h)}" ` +
    'data-ink-space="local" data-ink-mode="raster-reveal">' +
    `<image href="${raster.rel}" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" ` +
    'preserveAspectRatio="none" style="mix-blend-mode:multiply"/>' +
    '</svg>';
  return { svg, raster: raster.rel, cached: raster.cached };
}

/**
 * The whole lane for one asset: cached raster → vector → hand-drawn strokes.
 *
 * Returns `undefined` for every kind of unavailability (no key, provider error,
 * no vectoriser, nothing traceable) so the caller has exactly one fallback path
 * to write.
 */
export async function illustrationPaths(args: {
  id: string;
  prompt: string;
  dir: string;
  box: Box;
  ctx: DrawContext;
  seed?: number;
  /** `exact` when the box was sized to this image's own ink and must not be padded. */
  fit?: 'contain' | 'exact';
}): Promise<{ paths: InkPath[]; raster: string; cached: boolean } | undefined> {
  const raster = await illustrationRaster({
    id: args.id,
    prompt: args.prompt,
    dir: args.dir,
    ...(args.seed !== undefined ? { seed: args.seed } : {}),
    kind: 'form',
  });
  if (!raster) return undefined;
  const paths = await vectoriseToInk(raster.png, args.box, args.ctx, {
    ...(args.fit ? { fit: args.fit } : {}),
  });
  if (!paths) return undefined;
  return { paths, raster: raster.rel, cached: raster.cached };
}
