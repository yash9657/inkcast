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
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { cacheDir, hash, logger, type OnSpend } from '@inkcast/core';
import { groundWhiteness, pngSize, readPng, writePng } from './png.js';
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
 * Every built-in figure endpoint, across providers.
 *
 * A model token naming one of these contributes nothing to a cache key (see
 * `illustrationKey`), which is what lets the key start telling the truth without
 * invalidating the eight figure rasters already in the machine cache. Setting
 * `INKCAST_FIGURE_MODEL` to the value it already had is therefore a no-op on the key,
 * as it should be — the override is only interesting when it changes the picture.
 */
const DEFAULT_FIGURE_MODELS = new Set(Object.values(MODELS).map((m) => m.figure));

/**
 * The figure endpoint `INKCAST_FIGURE_MODEL` asks for, or `undefined` for the built-in one.
 *
 * Read here rather than in two places so the model that goes into the cache key and the
 * model that is actually called can never disagree — which is the whole of plan 6.5.
 */
export function figureModelOverride(): string | undefined {
  const raw = process.env.INKCAST_FIGURE_MODEL?.trim();
  return raw && raw.length > 0 ? raw : undefined;
}

/**
 * What a figure model contributes to a cache key — nothing, unless it is not a built-in one.
 *
 * Kept as one function because two callers hash it: the raster key here and the `figure`
 * asset's key in `resolve.ts`. They have to agree about which models are the default, or a
 * project would re-resolve an asset whose raster then comes straight back from the cache.
 * Takes the model explicitly rather than reading the environment, so every key it feeds
 * stays a pure function of its inputs.
 */
export function figureModelToken(model: string | undefined): string {
  const named = model?.trim();
  return named && !DEFAULT_FIGURE_MODELS.has(named) ? `model:${named}` : '';
}

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
  const override = kind === 'figure' ? figureModelOverride() : undefined;
  return override ?? MODELS[provider][kind];
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
 *
 * **The model goes in for `figure` only** (plan 6.5, audit S5-d), and by the same rule: a
 * token only when it is not one of the built-in endpoints, so today's keys are byte-identical
 * to yesterday's and `illustration/v2` stays honest. Three things decided the shape of this:
 *
 * - A `form` raster is binarised and re-traced, so the model that drew it does not survive
 *   into the board and re-billing those would be paying twice for the same ink. A `figure`
 *   is shown as it arrived, so the model *is* the picture — `flux/dev` and `nano-banana`
 *   draw two different hearts, and serving one for the other is the silent aliasing the
 *   `kind` token already exists to stop.
 * - **Style reaches the raster through the model and nowhere else.** `figurePrompt` takes no
 *   style, and `InkStyle` has no `stylePrompt` to give it — the field is still only a line in
 *   `docs/STYLES.md` §2. What STYLES.md §6 actually wants (an asset cached per style, not per
 *   prompt) is satisfied the moment a style pack picks the endpoint, which is
 *   `PLAN-FIGURE-LANE.md`'s own plan for it ("nano-banana when the style pack asks for
 *   marker"): that arrives here as a different `model` and keys itself. Folding a style name
 *   in *before* it can change a pixel would invalidate eight cached figures for bytes that
 *   would be identical — the square token's mistake, made deliberately. 7.3 is where this
 *   becomes real, and it needs no change here.
 * - What this cannot do is label the past. Nothing records which model drew a raster already
 *   in the cache, so a figure generated under an override is still filed under the default
 *   key and will still be served for a default-model request. The key tells the truth from
 *   here on; a cache cleared by hand is the only way to make it retroactive.
 */
export function illustrationKey(
  id: string,
  prompt: string,
  kind: ImageKind = 'form',
  aspect = 1,
  model?: string,
): string {
  const size = rasterSize(aspect);
  const shape = size.width === size.height ? [] : [`${size.width}x${size.height}`];
  const token = kind === 'figure' ? figureModelToken(model) : '';
  const tier = token ? [token] : [];
  return `${sanitiseId(id)}-${hash('illustration/v2', kind, prompt.trim(), ...shape, ...tier).slice(0, 10)}`;
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

/** Drop the per-process raster and trace memos. Tests only. */
export function resetIllustrationCache(): void {
  inflight.clear();
  traceMemo.clear();
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
  /** The trust gate. Defaults to `rasterGate`; injected for tests. */
  gate?: RasterGate;
  /** Where the raster comes from. Defaults to the real provider call. */
  generate?: RasterGenerator;
  /** Where a rejection is reported, so it reaches `qc.json` and not only the bill. */
  onProblem?: (note: string) => void;
  /**
   * Where a **real** provider call is reported, one `images: 1` per call.
   *
   * Here rather than in the caller, and that is the whole point of the field. Three tiers
   * answer above this function's generator — the project's copy, the machine cache, and
   * then the provider — and only this function can tell which one did. A caller counting
   * assets that came back marked `generated` counts a film's worth of cache hits as a bill
   * (audit X-e); `projects/qc64-hashmap` measures four such assets, zero provider calls,
   * and a `$0.0120` line for them.
   *
   * **A rejected generation is still a call.** The gate below throws away a raster that
   * arrived and was not good enough, and the provider still charged for drawing it — so
   * the spend is reported the moment bytes come back, before the verdict, and a run whose
   * two attempts were both rejected is billed for two images and draws none. A call that
   * returned nothing at all (no key, a 402, a network error) is not billed, because
   * nothing was drawn.
   */
  onSpend?: OnSpend;
  /**
   * The cost lane these calls belong to. Defaults to the asset kind, which is what the
   * visuals stage wants; the underlay generator passes `underlay`, because it spends in
   * the *lesson* stage and a bill that filed it under `figure` would be describing a
   * different part of the run.
   */
  lane?: string;
}): Promise<IllustrationRaster | undefined> {
  const kind = args.kind ?? 'form';
  const aspect = args.aspect ?? 1;
  const gate = args.gate ?? rasterGate;
  const generate: RasterGenerator =
    args.generate ??
    ((a) =>
      generateIllustration(a.prompt, {
        ...(a.seed !== undefined ? { seed: a.seed } : {}),
        kind: a.kind,
        aspect: a.aspect,
      }));
  // The endpoint this raster would be drawn by, in the key as well as in the request: a
  // figure is shown as it arrived, so a switched model is a different picture (plan 6.5).
  const model = kind === 'figure' ? figureModelOverride() : undefined;
  const key = illustrationKey(args.id, args.prompt, kind, aspect, model);
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

  /**
   * Judge a raster on its way to the board, whichever tier it came from.
   *
   * **Cached rasters are gated too, which is where this departs from the pose lane.**
   * `resolveGeneratedPose` trusts its cache because that cache has only ever held accepted
   * candidates. These two caches predate the gate by months and contain the audit's own
   * evidence — a blank page reading "Salèylic acisH.", a page of gibberish handwriting.
   * A gate that trusted them would be a gate that never fires on the corpus we have.
   *
   * A rejected *cache hit* is not regenerated, though. Silently re-billing for a subject
   * the cache already answered would break the lane's one loud promise (one generation per
   * id, ever) to fix a picture the cache can be cleared of by hand — so it is reported,
   * naming the file, and the caller degrades.
   */
  const judge = async (png: Buffer, where: string, file: string): Promise<boolean> => {
    const verdict = await gate({ png, kind, aspect });
    if (verdict.ok) return true;
    const note =
      `the ${kind} raster for "${args.id}" (${where}) was rejected: ${verdict.why} ` +
      `[score ${verdict.score.toFixed(2)}]. Delete ${file} to have it drawn again`;
    log.warn(note);
    args.onProblem?.(note);
    return false;
  };

  const task = (async (): Promise<IllustrationRaster | undefined> => {
    const own = await readCachedPng(abs);
    if (own) {
      log.debug(`illustration ${args.id} served from the project`, rel);
      if (!(await judge(own, 'from the project', abs))) return undefined;
      return { png: own, rel, cached: true, from: 'project', provider: detectImageProvider() };
    }

    // The tier that makes the tenth video cheaper than the first: this subject may
    // have been drawn for a different project entirely, and reusing it is both free
    // and the only way two videos agree about what the subject looks like.
    const machine = await readCachedPng(shared);
    if (machine) {
      log.debug(`illustration ${args.id} served from the machine cache`, shared);
      if (!(await judge(machine, 'from the machine cache', shared))) return undefined;
      await stash(abs, machine, 'project');
      return { png: machine, rel, cached: true, from: 'cache', provider: detectImageProvider() };
    }

    // A miss the key caused on purpose says so, and names the file it declined to serve —
    // otherwise switching `INKCAST_FIGURE_MODEL` looks like an unexplained re-bill of a
    // subject the cache visibly already holds. Two `existsSync` calls, only on a figure
    // whose model was overridden, so the common path pays nothing for it.
    if (model && figureModelToken(model)) {
      const plain = illustrationKey(args.id, args.prompt, kind, aspect);
      const drawn = [
        path.resolve(args.dir, `${ILLUSTRATION_DIR}/${plain}.png`),
        path.join(cacheDir('illustrations'), `${plain}.png`),
      ].find((f) => existsSync(f));
      if (drawn) {
        log.info(
          `the figure for "${args.id}" is keyed to INKCAST_FIGURE_MODEL=${model}, so the ` +
            `cached raster drawn by the built-in model (${drawn}) was not served — ` +
            `${model} draws this subject under its own key`,
        );
      }
    }

    const provider = detectImageProvider();
    // The keyless short-circuit, kept: a run with no provider must not spend two turns of a
    // retry loop discovering that twice. An injected generator answers for itself.
    if (provider === 'none' && !args.generate) return undefined;

    // One retry and no more — `resolveGeneratedPose`'s rule, for its reason: a model that
    // missed twice on the same prompt will miss a third time, and the caller is holding up
    // a render. The seed moves with the attempt so the retry is a different draw rather
    // than a re-request of the picture that was just rejected, and moves *deterministically*
    // so the second attempt is reproducible from the same inputs.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const png = await generate({
        prompt: args.prompt,
        kind,
        aspect,
        attempt,
        ...(args.seed !== undefined ? { seed: args.seed + attempt - 1 } : {}),
      });
      if (!png || png.length === 0) {
        const note = `the ${kind} raster for "${args.id}": attempt ${attempt} produced nothing`;
        log.warn(note);
        args.onProblem?.(note);
        continue;
      }
      // Bytes came back, so this was billed — before the gate looks at them, because the
      // provider does not refund a picture we decide not to use. See `onSpend`.
      args.onSpend?.({
        lane: args.lane ?? (kind === 'figure' ? 'figure' : 'illustration'),
        provider,
        images: 1,
      });
      const verdict = await gate({ png, kind, aspect });
      if (verdict.ok) {
        // Only an *accepted* candidate is written, and that is the part that matters most:
        // caching a rejection makes it permanent, and the retry above would then be paying
        // to reject it once and enshrine it forever.
        await stash(abs, png, 'project');
        await stash(shared, png, 'machine cache');
        return { png, rel, cached: false, from: 'provider', provider };
      }
      // A rejected generation still cost money, so it goes on the run's record and not
      // just in the log.
      const note =
        `the ${kind} raster for "${args.id}": attempt ${attempt} was rejected because ` +
        `${verdict.why} [score ${verdict.score.toFixed(2)}] — it was paid for and not kept`;
      log.warn(note);
      args.onProblem?.(note);
    }
    return undefined;
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
 * What a trace turned out to be. The failures are named rather than collapsed to
 * `undefined` because the gate below has to tell two of them apart:
 *
 * - `unavailable` / `unreadable` — the tracer could not run, or could not read these bytes.
 *   The gate **abstains**: a check that condemns what it cannot see turns a missing
 *   optional dependency into a lane outage.
 * - `empty` — the tracer ran fine and found nothing. That is a measurement, and a blank
 *   page is exactly what this lane is supposed to stop paying for twice.
 */
type TraceResult =
  | { ok: true; paths: TracedPath[]; ink: Box }
  | { ok: false; why: 'unavailable' | 'unreadable' | 'empty' };

/**
 * Traces, memoised on the raster's own bytes.
 *
 * The gate and the draw both trace, and they trace the very same bytes: gating first and
 * then re-tracing would double the most expensive step in the lane for no new information.
 * Safe to share because a trace is pure — `vectoriseToInk` transforms the segments into new
 * arrays rather than in place, and vtracer is deterministic on identical input.
 */
const traceMemo = new Map<string, TraceResult>();

/**
 * A raster traced to measured paths, plus the box its ink occupies.
 *
 * One function because two callers must agree on it exactly: the lane that draws the ink,
 * and the hybrid lane's seam, which reports where the subject will land so a drawing author
 * can aim marks at it. Two implementations of "where is the ink" would put a leader arrow
 * on empty board and look like the model being bad at aiming.
 */
async function traceImage(png: Buffer): Promise<TraceResult> {
  const memoKey = createHash('sha1').update(png).digest('hex');
  const memo = traceMemo.get(memoKey);
  if (memo) return memo;

  const result = await (async (): Promise<TraceResult> => {
    const v = await loadVectorizer();
    if (!v) return { ok: false, why: 'unavailable' };
    let traced: string;
    try {
      traced = await v.vectorize(png, v.config);
    } catch (err) {
      log.warn('vectorisation failed', err);
      return { ok: false, why: 'unreadable' };
    }
    const raw = extractPathData(traced);
    if (raw.length === 0) {
      log.warn('vectoriser produced no paths');
      return { ok: false, why: 'empty' };
    }
    const paths = raw
      .map((d) => {
        const segs = parsePath(d);
        const bbox = pointsBBox(samplePath(segs));
        return { segs, bbox, area: bbox.w * bbox.h };
      })
      .filter((p) => p.area > 0);
    if (paths.length === 0) return { ok: false, why: 'empty' };
    return { ok: true, paths, ink: unionBox(paths.map((p) => p.bbox)) };
  })();

  traceMemo.set(memoKey, result);
  return result;
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
  const traced = await traceImage(png);
  return traced.ok ? traced.ink : undefined;
}

/**
 * How small a traced path has to be, against the subject's own ink box, to be a speck —
 * and how many paths the reveal will draw at most.
 *
 * Named because two readers have to agree on them: the lane that draws the ink, and the
 * gate that judges the raster. A gate that scored the raw trace would be scoring 400
 * two-pixel paths the reveal never draws, and would call a page of dust a drawing.
 */
const SPECK_AREA_SHARE = 0.0006;
const MAX_TRACED_PATHS = 40;

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
  if (!traced.ok) return undefined;
  const { paths: measured, ink: source } = traced;

  const minArea = source.w * source.h * SPECK_AREA_SHARE;
  const kept = measured
    .filter((p) => p.area >= minArea)
    .sort((a, b) => b.area - a.area)
    .slice(0, opts.maxPaths ?? MAX_TRACED_PATHS);
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

/* ------------------------------------------------------------- the trust gate */

/**
 * The verdict on one raster.
 *
 * `score` is normalised the way `plausibilityGate`'s is, so the same sentence reads here:
 * **1 is comfortably fine, 0.5 is exactly at the floor, and `ok` is `score >= 0.5`.** A
 * gate that abstained returns `ok: true` with no `why` — see `TraceResult`.
 */
export type RasterVerdict = { ok: boolean; score: number; why?: string };

/**
 * The seam a better check arrives through, exactly as `PoseGate` is for the pose lane.
 * Injected so the retry orchestration below is testable with no provider and no tracer.
 */
export type RasterGate = (args: {
  png: Buffer;
  kind: ImageKind;
  /** Width over height of the box this raster will fill. */
  aspect: number;
}) => Promise<RasterVerdict>;

/** Abstention: the check could not run, so it says nothing. */
const ABSTAIN: RasterVerdict = { ok: true, score: 1 };

/**
 * Where a raster comes from.
 *
 * Injected rather than imported for the reason `PoseGenerator` gives: it is the only way
 * the retry orchestration below can be tested with no provider, no key and no network, and
 * the orchestration — not the request shape — is what this item added.
 */
export type RasterGenerator = (args: {
  prompt: string;
  kind: ImageKind;
  aspect: number;
  seed?: number;
  /** 1 on the first try, 2 on the single retry. */
  attempt: number;
}) => Promise<Buffer | undefined>;

/**
 * The floor under a traced illustration: total stroke length over the diagonal of the box
 * that ink occupies — `inkProfile`'s measure in `character.ts`, scale-free for the same
 * reason.
 *
 * **A corpus recalibration, not a spec value.** Measured over all 42 rasters in this
 * machine's illustration cache on 2026-08-24. Three came back with essentially nothing on
 * them and all three are failures anyone would call by eye: a page of pale blobs the tracer
 * could not even find (1.6), a page of gibberish handwriting (1.8), and three dots where a
 * lithium nucleus was asked for (2.0). The next lowest raster measured **4.3** and is a real
 * drawing. The floor sits at 3.0 — 1.5× above the worst accepted failure and 1.4× below the
 * lowest real drawing — and the number is the corpus's, not a threshold anyone liked the
 * look of.
 */
const MIN_TRACED_INK = 3.0;

/**
 * How far out of shape a subject may be before it is a strip rather than a picture.
 *
 * The same corpus: the two rasters where the model wrote a line of words instead of drawing
 * anything measured **4.57:1** and **4.81:1** (`"Salèylic acisH."` across an empty page is
 * the second), and the widest genuine drawing in the corpus — two stacks side by side, and
 * a ship on a horizon — measured **3.15:1** and **2.90:1**. So the ceiling is 4:1, and the
 * margin above real work is 1.27×, which is thinner than the ink floor's and is stated here
 * rather than hidden.
 *
 * **This is where the plan's "the ink/aspect plausibility gate, verbatim" cannot be taken
 * verbatim, and the reason is worth keeping.** `plausibilityGate` compares a candidate pose
 * against *a composed pose of the same character*, so a wildly different aspect means a
 * different subject. An illustration has no base: the shape we asked the provider for is the
 * shape of the **box**, not a prediction of the subject, and a ship really is wider than its
 * box. Scoring illustration aspect against the request the way the pose lane scores it
 * against its base was measured on this corpus and rejected two good drawings out of 42 — a
 * ship and a cross-section — which would have cost a retry each and then drawn a lucide icon
 * in their place. An absolute ceiling on how strip-like a subject may be is what survives.
 */
const MAX_INK_ASPECT = 4.0;

/**
 * How white a figure's ground has to be, as the median luminance of its border ring.
 *
 * A figure is composited with `mix-blend-mode: multiply`, which is the identity against
 * white — that is the whole reason the card disappears into the paper. A ground that is not
 * white multiplies into a visible grey rectangle sitting on the board.
 *
 * The corpus again: all 42 cached rasters measure **0.954 or whiter**, and the lowest is a
 * faint paper texture that reads as white to the eye. 0.90 is below every raster the
 * providers have actually returned and at the point where a card is unmistakable — a ground
 * a tenth darker than the board's own paper. A subtly-off ground is deliberately *not*
 * caught, because the corpus says good rasters live there.
 *
 * **Only figures are checked.** A `form` raster on a grey ground is caught by the trace
 * instead and more decisively: a ground below vtracer's luminance cut traces as one filled
 * rectangle, whose perimeter over its diagonal is ~2.8 and therefore under `MIN_TRACED_INK`.
 */
const MIN_GROUND_WHITE = 0.9;

/**
 * The default gate — and read the name the way `plausibilityGate`'s header asks its name to
 * be read, because this one is no better than that one.
 *
 * It measures how much ink a raster traces to and how strip-like that ink is. So it rejects
 * a blank page, a page of handwriting where a drawing was asked for, and a smear. It
 * **accepts a confident drawing of the wrong thing**, and the corpus proves it: the
 * hallucinated benzene ring the audit's S5-a is named after — a red circle containing
 * `"B,H,"` with eight arrows into it — scores 5.5 on ink and 1.02 on aspect and sails
 * through. That failure needs a model that can look at a picture, which is Tier 2's vision
 * pass, not this. This is a floor under the lane, and the commit that added it should not
 * claim more.
 */
export const rasterGate: RasterGate = async ({ png, kind }) =>
  kind === 'figure' ? figureGround(png) : formPlausibility(png);

/** The ink/shape floor under a `form` raster, measured on what the tracer will actually draw. */
export async function formPlausibility(png: Buffer): Promise<RasterVerdict> {
  const traced = await traceImage(png);
  if (!traced.ok) {
    if (traced.why === 'empty') {
      return { ok: false, score: 0, why: 'it traced to nothing at all — the page is blank' };
    }
    return ABSTAIN;
  }

  // Measured on the paths that survive the lane's own speck filter and cap, because those
  // are the ones that reach the board. Judging the raw trace would score specks the reveal
  // never draws.
  const minArea = traced.ink.w * traced.ink.h * SPECK_AREA_SHARE;
  const kept = traced.paths
    .filter((p) => p.area >= minArea)
    .sort((a, b) => b.area - a.area)
    .slice(0, MAX_TRACED_PATHS);
  if (kept.length === 0) {
    return { ok: false, score: 0, why: 'every traced path was a speck — there is no drawing here' };
  }

  const diag = Math.hypot(traced.ink.w, traced.ink.h) || 1;
  let length = 0;
  for (const p of kept) {
    const s = samplePath(p.segs);
    for (let i = 1; i < s.length; i++) {
      const a = s[i - 1];
      const b = s[i];
      if (a && b) length += Math.hypot(b.x - a.x, b.y - a.y);
    }
  }
  const ink = length / diag;
  const aspect =
    Math.max(traced.ink.w, traced.ink.h) / Math.max(1e-6, Math.min(traced.ink.w, traced.ink.h));

  // Each leg is normalised so that sitting exactly on its floor scores 0.5, which is what
  // lets one `score >= 0.5` stand for both — the shape `plausibilityGate` established.
  const inkLeg = Math.min(1, ink / (2 * MIN_TRACED_INK));
  const aspectLeg = Math.min(1, MAX_INK_ASPECT / (2 * aspect));
  const score = Math.min(inkLeg, aspectLeg);
  if (score >= 0.5) return { ok: true, score };
  return {
    ok: false,
    score,
    why:
      inkLeg < aspectLeg
        ? `it traced to too little ink (${ink.toFixed(1)} against a floor of ${MIN_TRACED_INK}) — ` +
          'a nearly blank page, or words where a drawing was asked for'
        : `its ink is ${aspect.toFixed(1)}:1 — a strip rather than a subject, which is what ` +
          'comes back when the model writes a line of text instead of drawing',
  };
}

/** The ground check under a `figure` raster: white paper, or a visible card. */
export async function figureGround(png: Buffer): Promise<RasterVerdict> {
  const white = groundWhiteness(png);
  if (white === undefined) return ABSTAIN;
  const score = Math.max(
    0,
    Math.min(1, 0.5 + (0.5 * (white - MIN_GROUND_WHITE)) / (1 - MIN_GROUND_WHITE)),
  );
  if (score >= 0.5) return { ok: true, score };
  return {
    ok: false,
    score,
    why:
      `its ground is not white (${white.toFixed(3)} against a floor of ${MIN_GROUND_WHITE}) — ` +
      'the figure is composited with multiply, so a ground like this draws a grey card on ' +
      'the board with the picture inside it',
  };
}

/* ------------------------------------------------------ keying a dark surface */

/**
 * The board a figure is being drawn on, when that is not white paper.
 *
 * Two colours rather than the whole palette, because those are the only two the keying
 * below can act on: what shows through where the raster's ground was, and what a neutral
 * mark should be made of.
 */
export type Surface = { paper: string; ink: string };

/** WCAG relative luminance of an `#rrggbb`, 0–1. Mirrors `core`'s, on 0–255 channels. */
function luma255(r: number, g: number, b: number): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function parseHex(hex: string): [number, number, number] | undefined {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return undefined;
  const v = Number.parseInt(m[1] as string, 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

/**
 * True when a board is too dark for `mix-blend-mode: multiply` to be the right composite.
 *
 * The same 0.5 midpoint `MIN_PAPER_LUMA` used to *refuse* a dark pack with (plan 7.3), now
 * used to route one — which is the answer that constant's own comment asked for in writing:
 * "raise the bar or delete it when the alpha lane lands, and say which". It is deleted as a
 * refusal and kept as a switch, at the same value and for the same reason: below the
 * midpoint "light surface" stops being arguable, and multiply — which can only darken — is
 * multiplying a picture's ink into a board already darker than the ink.
 */
export function isDarkSurface(paper: string): boolean {
  const rgb = parseHex(paper);
  // An unparseable paper is treated as light, which is the behaviour every film on disk
  // already has. A colour this cannot read must not silently change how figures composite.
  return rgb ? luma255(...rgb) < 0.5 : false;
}

/**
 * Re-light a figure for a dark board: key its ground to real alpha, and put its ink back.
 *
 * **This is audit S5.6, and the thing that made it S5.6 is that detection was not enough.**
 * 6.4's `MIN_GROUND_WHITE` measures a raster's ground and refuses one that is not white;
 * what it cannot do is *remove* a ground that is. Every figure the providers return is dark
 * ink on white, composited with `mix-blend-mode: multiply` — the identity against white
 * paper, which is exactly why the card disappears into the board. Multiply can only darken.
 * On a slate board the white ground correctly becomes slate and the picture's own black ink
 * also becomes slate-or-darker, so the picture does not degrade, it *vanishes*, and no gate
 * in the repo can see it because the raster itself is fine.
 *
 * The transform, per pixel:
 *
 *  - **Alpha is ink density**, `1 − luminance`, taken after compositing the raster's own
 *    alpha over white. A white ground keys to fully transparent, black ink to fully opaque,
 *    and — the part a hard threshold would lose — an anti-aliased edge keys to exactly the
 *    partial coverage it was drawn with. That is what makes this real alpha rather than a
 *    chroma key: no halo, no stair-stepping, and the board's own texture reads through the
 *    picture the way the paper used to.
 *  - **Colour is the pixel's chroma, re-lit, mixed toward the board's ink by how neutral
 *    the pixel is.** A black or grey mark (saturation 0) is drawn in the pack's own ink, so
 *    line art — 34 of the 42 rasters in the cache — comes out as chalk on slate, which is
 *    what a chalkboard drawing *is*. A saturated mark keeps its hue at full brightness, so
 *    the orange conduction arrows that `figureRaster`'s header is named after stay orange
 *    instead of turning into eight chalk lines. Between the two it mixes, which is how
 *    coloured chalk actually reads.
 *
 * Inverting lightness outright was the other candidate and is wrong for the same reason
 * binary tracing was wrong for colour: it is a transform on the *value* channel that a
 * picture's meaning does not live in. A negative of a red apple is a cyan apple.
 *
 * Returns `undefined` when the PNG is a shape `readPng` does not read — the caller then
 * composites the way it always has, which on a dark board is a picture that does not show.
 * That is worse, and it is still better than a guess: see `png.ts`'s header on abstaining.
 */
export function keyFigureToSurface(png: Buffer, surface: Surface): Buffer | undefined {
  const img = readPng(png);
  if (!img) return undefined;
  const ink = parseHex(surface.ink) ?? [255, 255, 255];
  const { width, height, rgba } = img;
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const a = (rgba[o + 3] as number) / 255;
    // Over white first: the ground this is keying out is the raster's *apparent* ground,
    // and a provider that returns transparent corners has already said those are paper.
    const r = (rgba[o] as number) * a + 255 * (1 - a);
    const g = (rgba[o + 1] as number) * a + 255 * (1 - a);
    const b = (rgba[o + 2] as number) * a + 255 * (1 - a);
    const density = (1 - luma255(r, g, b) - GROUND_FLOOR) / (1 - GROUND_FLOOR);
    if (density <= 0) continue; // ground: fully transparent, and nothing to colour
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    // How much of this pixel's own hue to keep, against the board's ink. See `CHROMA_FLOOR`.
    const spread = max - min;
    const chromatic =
      spread <= CHROMA_FLOOR
        ? 0
        : Math.min(1, (spread - CHROMA_FLOOR) / (CHROMA_FULL - CHROMA_FLOOR));
    // The hue at full brightness. `max === 0` is pure black, which has no hue to keep.
    const gain = max > 0 ? 255 / max : 0;
    for (let c = 0; c < 3; c++) {
      const chroma = ([r, g, b][c] as number) * gain;
      out[o + c] = Math.round((ink[c] as number) * (1 - chromatic) + chroma * chromatic);
    }
    out[o + 3] = Math.round(Math.min(1, density) * 255);
  }
  return writePng({ width, height, rgba: out });
}

/**
 * Ink density at or below which a pixel is the raster's ground, not its drawing.
 *
 * Without it a figure keys onto a dark board with a **visible disc of haze around the
 * drawing** — measured on `battery-cut-open-cross-section` against the slate pack, and
 * obvious on sight. The cause is that these grounds are not mathematically white: a
 * provider returns a faint vignette or paper texture at luminance 0.98–1.00, which keys to
 * 0–2% alpha. On white paper `multiply` erased that completely, which is why nobody has
 * ever had to think about it; over slate, 2% of a pale ink is a grey veil across a quarter
 * of the frame.
 *
 * The corpus sets the number, as it set 6.4's three. All 42 rasters in
 * `~/.inkcast/cache/illustrations` measure a ground of **0.954 white or better**
 * (`MIN_GROUND_WHITE`'s comment records the sweep), which is a density of 0.046, and
 * `MIN_GROUND_WHITE` refuses anything below 0.90 outright. **0.06** sits just above the
 * dirtiest ground the providers have actually returned and far below anything that reads as
 * a mark. The remaining range is rescaled rather than clipped, so full-strength ink still
 * keys to fully opaque instead of losing 6% of its alpha.
 */
const GROUND_FLOOR = 0.06;

/**
 * How far apart a pixel's channels must be, in the eight bits they arrived in, before its
 * own hue is kept instead of the board's ink.
 *
 * The second artefact measured on the same raster: **coloured speckle along every stroke**.
 * A neutral pixel is never exactly neutral after a provider's compression — `(5,30,5)` is a
 * black stroke with a rounding error in it — and `gain` normalises a hue to full
 * brightness, so a 25-count error in a *dark* pixel becomes a saturated green dot.
 *
 * The first attempt floored relative saturation and did not work, for a reason worth
 * keeping: `(max−min)/max` divides by the pixel's own level, so the same absolute error
 * reads as 0.1 on a mid-tone and 0.83 on a near-black one. It is largest exactly where the
 * hue is least trustworthy. Absolute spread does not have that inversion, because
 * compression error is bounded in absolute terms and real colour is not.
 *
 * **Measured across all 42 rasters in `~/.inkcast/cache/illustrations`**, over the pixels
 * that survive `GROUND_FLOOR` — the ones this will actually colour. The corpus separates
 * into two populations with an empty band between them:
 *
 *   - **31 line-art rasters**: not one pixel above spread 46, p99.9 between 11 and 24.
 *   - **11 rasters carrying real colour**: p99 between 183 and 252.
 *
 * Nothing in the cache lives between 46 and 183, so the ramp is placed inside that gap
 * rather than at either edge of it: 64 is above the dirtiest line art by a comfortable
 * margin and 128 is below the palest real colour by a larger one. A ramp rather than a
 * switch so a wash that crosses the threshold does not grow a hard edge along the contour
 * where it does.
 */
const CHROMA_FLOOR = 64;
const CHROMA_FULL = 128;

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
/**
 * Where a raster's `<image>` goes inside the box the board reserved for it.
 *
 * The raster's own aspect, fitted and centred, emitted at exactly that rectangle —
 * rather than handing the box to `preserveAspectRatio` and letting the renderer
 * letterbox inside it. The difference is not cosmetic and it is why this is its own
 * function: the reveal mask and the pen sprite both work from the *element's* bounding
 * box, so a letterboxed image spends a fifth of its sweep on empty margin and parks
 * the nib off the picture entirely.
 *
 * Extracted so the arithmetic can be checked without a provider, a key or a cache —
 * `docs/PLAN-WATCHABILITY.md` §4.2 names the letterbox as one of two finish defects
 * that had to be closed before the lane could be judged, and a defect closed by a
 * comment is a defect waiting to reopen.
 */
export function figureImageRect(
  box: { w: number; h: number },
  size: { w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  if (!(size.w > 0) || !(size.h > 0)) return { x: 0, y: 0, w: box.w, h: box.h };
  const scale = Math.min(box.w / size.w, box.h / size.h);
  const w = size.w * scale;
  const h = size.h * scale;
  return { x: (box.w - w) / 2, y: (box.h - h) / 2, w, h };
}

export async function figureRaster(args: {
  id: string;
  prompt: string;
  dir: string;
  box: Box;
  seed?: number;
  gate?: RasterGate;
  onProblem?: (note: string) => void;
  /** Where a real provider call is billed. See `illustrationRaster`'s `onSpend`. */
  onSpend?: OnSpend;
  /**
   * The board this figure will sit on (plan 9.2).
   *
   * Absent means white paper, which is every caller that predates the alpha lane and
   * every film in the corpus. Only consulted when the paper is dark — see
   * `keyFigureToSurface`.
   */
  surface?: Surface;
}): Promise<{ svg: string; raster: string; cached: boolean } | undefined> {
  const raster = await illustrationRaster({
    id: args.id,
    prompt: args.prompt,
    dir: args.dir,
    ...(args.seed !== undefined ? { seed: args.seed } : {}),
    ...(args.gate ? { gate: args.gate } : {}),
    ...(args.onProblem ? { onProblem: args.onProblem } : {}),
    ...(args.onSpend ? { onSpend: args.onSpend } : {}),
    kind: 'figure',
    // The box is the whole point of asking. Every figure before this drew at **66.7% of
    // the box reserved for it** — measured on all three of `cardiac8`'s cutaways, e.g. a
    // 1024×1024 raster in a 567×378 element drawing 378×378 — because the request was
    // hard-coded square and the box is 3:2. A third of the area the figure lane exists to
    // claim was reserved paper with nothing on it, and no check in the repo could see it.
    aspect: args.box.h > 0 ? args.box.w / args.box.h : 1,
  });
  if (!raster) return undefined;
  const { x, y, w, h } = figureImageRect(args.box, pngSize(raster.png));
  // The href is project-relative: the renderer resolves and inlines it against the project
  // directory, and keeping it relative is what lets a project stay self-describing.
  //
  // **Two composites, chosen by the board** (plan 9.2, audit S5.6).
  //
  // On light paper: `mix-blend-mode: multiply`, unchanged and untouched. Every one of
  // these rasters is drawn on white, the board's paper is `#fcfbf9`, and multiplying by
  // white is the identity — so the card disappears, the paper's warmth carries through the
  // picture, and the grid dots read underneath it. The first render without it showed the
  // card's edges plainly against the paper. Every film in the corpus is on this path and
  // not one pixel of it moves.
  //
  // On a dark board: the raster is keyed to real alpha and composited normally, because
  // multiply can only darken and there is nothing below the slate to darken *to*. The
  // keyed copy is a derived artefact written beside the raster it came from — the original
  // stays exactly as the provider sent it, which is what keeps both cache tiers style-blind
  // and re-keyable. It is named for the surface it was keyed against, so two packs in one
  // project do not overwrite each other's copy, and so a pack whose colours were edited
  // gets a new file rather than yesterday's ink.
  const keyed = args.surface && isDarkSurface(args.surface.paper) ? args.surface : undefined;
  let href = raster.rel;
  let blend = 'mix-blend-mode:multiply';
  if (keyed) {
    const alpha = keyFigureToSurface(raster.png, keyed);
    if (alpha) {
      href = `${raster.rel.replace(/\.png$/, '')}-on-${hash(keyed.paper, keyed.ink).slice(0, 8)}.png`;
      await writeFile(path.resolve(args.dir, href), alpha);
      blend = 'mix-blend-mode:normal';
    } else {
      // `readPng` abstained. Say so where the run can read it: on a dark board this is
      // not a cosmetic miss, it is a picture the viewer will not see at all.
      args.onProblem?.(
        `the figure "${args.id}" could not be keyed for a dark board — its PNG is a shape ` +
          'the decoder does not read (interlaced, or a sub-byte palette), so it is ' +
          'composited with multiply and will be close to invisible on this surface',
      );
    }
  }
  const n = (v: number): string => String(Math.round(v * 100) / 100);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(args.box.w)}" ` +
    `height="${n(args.box.h)}" viewBox="0 0 ${n(args.box.w)} ${n(args.box.h)}" ` +
    'data-ink-space="local" data-ink-mode="raster-reveal">' +
    `<image href="${href}" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" ` +
    `preserveAspectRatio="none" style="${blend}"/>` +
    '</svg>';
  return { svg, raster: href, cached: raster.cached };
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
  gate?: RasterGate;
  onProblem?: (note: string) => void;
  /** Where a real provider call is billed. See `illustrationRaster`'s `onSpend`. */
  onSpend?: OnSpend;
}): Promise<{ paths: InkPath[]; raster: string; cached: boolean } | undefined> {
  const raster = await illustrationRaster({
    id: args.id,
    prompt: args.prompt,
    dir: args.dir,
    ...(args.seed !== undefined ? { seed: args.seed } : {}),
    ...(args.gate ? { gate: args.gate } : {}),
    ...(args.onProblem ? { onProblem: args.onProblem } : {}),
    ...(args.onSpend ? { onSpend: args.onSpend } : {}),
    kind: 'form',
  });
  if (!raster) return undefined;
  const paths = await vectoriseToInk(raster.png, args.box, args.ctx, {
    ...(args.fit ? { fit: args.fit } : {}),
  });
  if (!paths) return undefined;
  return { paths, raster: raster.rel, cached: raster.cached };
}
