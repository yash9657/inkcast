/**
 * The optional text-to-image lane. **Strictly opt-in.**
 *
 * With `REPLICATE_API_TOKEN` or `FAL_KEY` set we generate one raster
 * illustration per *asset id* (never per scene — that is what makes competing
 * tools' characters mutate between shots), vectorise it with the Rust vtracer
 * binding, and roughen the traced paths so it belongs on the same board as the
 * icons.
 *
 * Without a key — the default in this project — nothing here runs, we log one
 * info line, and the caller uses the icon lane. Every failure path returns
 * `undefined`; none of them throws, because a flaky image API must never fail a
 * render.
 */
import { logger } from '@inkcast/core';
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

const log = logger('visuals:image');

export type ImageProvider = 'replicate' | 'fal' | 'none';

/** Flux-schnell class models: fast, cheap, and good at flat line art. */
const REPLICATE_MODEL = 'black-forest-labs/flux-schnell';
const FAL_MODEL = 'fal-ai/flux/schnell';

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
        'no REPLICATE_API_TOKEN or FAL_KEY — illustrations come from the built-in icon set (free, offline)',
      );
    } else {
      log.info(`text-to-image enabled via ${provider}`);
    }
  }
  return provider;
}

/**
 * Steer the model towards something a tracer can actually vectorise: flat,
 * high-contrast, no gradients, no text, nothing bleeding off the edge.
 */
export function illustrationPrompt(prompt: string): string {
  return (
    `${prompt.trim()}, single centred subject, hand-drawn thick black marker line art, ` +
    'bold clean outlines, flat white background, no shading, no gradients, no colour fill, ' +
    'no text, no watermark, whiteboard illustration'
  );
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

async function generateReplicate(prompt: string): Promise<Buffer | undefined> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) return undefined;
  let body = await fetchJson(`https://api.replicate.com/v1/models/${REPLICATE_MODEL}/predictions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      // Ask the API to hold the connection open until the prediction is done.
      prefer: 'wait',
    },
    body: JSON.stringify({
      input: {
        prompt,
        num_outputs: 1,
        aspect_ratio: '1:1',
        output_format: 'png',
        output_quality: 90,
        go_fast: true,
      },
    }),
  });
  if (!body) return undefined;

  // `Prefer: wait` usually returns a finished prediction, but poll if not.
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
  return download(firstUrl(body.output));
}

async function generateFal(prompt: string): Promise<Buffer | undefined> {
  const key = process.env.FAL_KEY;
  if (!key) return undefined;
  const body = await fetchJson(`https://fal.run/${FAL_MODEL}`, {
    method: 'POST',
    headers: { authorization: `Key ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt,
      image_size: 'square_hd',
      num_images: 1,
      num_inference_steps: 4,
      enable_safety_checker: true,
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

/** Generate one raster illustration, or `undefined` if unavailable. */
export async function generateIllustration(prompt: string): Promise<Buffer | undefined> {
  const provider = detectImageProvider();
  if (provider === 'none') return undefined;
  const shaped = illustrationPrompt(prompt);
  log.debug(`generating illustration via ${provider}`, prompt);
  return provider === 'replicate' ? generateReplicate(shaped) : generateFal(shaped);
}

/* ------------------------------------------------------------- vectorisation */

type VectorizeFn = (source: Buffer, config?: unknown) => Promise<string>;
let vectorizer: { vectorize: VectorizeFn; config: unknown } | null | undefined;

/**
 * `@neplex/vectorizer` is an optional native dependency: lazily imported, and a
 * missing binary is a warning, not a crash.
 */
async function loadVectorizer(): Promise<{ vectorize: VectorizeFn; config: unknown } | null> {
  if (vectorizer !== undefined) return vectorizer;
  try {
    // Deliberately imported through a variable: the package is an
    // optionalDependency (a prebuilt native binary), so `pnpm typecheck` must
    // not depend on it being present.
    const specifier = '@neplex/vectorizer';
    const mod = (await import(specifier)) as {
      vectorize: VectorizeFn;
      ColorMode: { Binary: number };
      Hierarchical: { Stacked: number };
      PathSimplifyMode: { Spline: number };
    };
    vectorizer = {
      vectorize: mod.vectorize,
      config: {
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

const PATH_D_RE = /<path\b[^>]*\bd="([^"]+)"/g;

/** Pull the path data out of a vectoriser's SVG output. */
export function extractPathData(svg: string): string[] {
  const out: string[] = [];
  PATH_D_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PATH_D_RE.exec(svg)) !== null) out.push(m[1] as string);
  return out;
}

/**
 * Raster → traced SVG → roughened strokes fitted into `box`.
 *
 * The trace is scaled into the box before roughening (same reason as the icon
 * lane) and tiny specks are dropped, since a vtracer output of 400 two-pixel
 * paths animates as noise.
 */
export async function vectoriseToInk(
  png: Buffer,
  box: Box,
  ctx: DrawContext,
  opts: { maxPaths?: number } = {},
): Promise<InkPath[] | undefined> {
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

  const measured = raw
    .map((d) => {
      const segs = parsePath(d);
      const bbox = pointsBBox(samplePath(segs));
      return { segs, bbox, area: bbox.w * bbox.h };
    })
    .filter((p) => p.area > 0);
  if (measured.length === 0) return undefined;

  const source = unionBox(measured.map((p) => p.bbox));
  const minArea = source.w * source.h * 0.0006;
  const kept = measured
    .filter((p) => p.area >= minArea)
    .sort((a, b) => b.area - a.area)
    .slice(0, opts.maxPaths ?? 40);
  if (kept.length === 0) return undefined;

  const m = fitMatrix(source, box, Math.min(box.w, box.h) * 0.04);
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
