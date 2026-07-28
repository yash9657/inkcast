/**
 * `render(sb, dir, opts)` — the last stage of the pipeline.
 *
 * The frame range is split across several browser contexts working concurrently,
 * each piping its own segment into its own encoder; the segments are then joined
 * with a stream copy and the narration is muxed in. That is what keeps a
 * 60-second 30 fps film (1800 frames) in the tens of seconds rather than minutes.
 *
 * Determinism makes the split safe: worker 3 rendering frame 1200 produces
 * exactly what a single sequential pass would, because the page state is a pure
 * function of `1200 / fps`.
 */
import { existsSync } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { hash, isFresh, logger, markFresh, report } from '@inkcast/core';
import type { Storyboard } from '@inkcast/core';
import { chromiumAvailable, CHROMIUM_HINT, launchChromium, openCapture } from './browser.js';
import type { FrameFormat } from './browser.js';
import { compilePlan } from './compile.js';
import { resolveFont } from './font.js';
import {
  concatAndMux,
  concatWavs,
  ensureFfmpeg,
  openSegmentEncoder,
  writeConcatList,
} from './ffmpeg.js';
import type { SegmentEncoder } from './ffmpeg.js';
import { buildPageHtml } from './html.js';
import type { RenderOptions, RenderPlan, RenderResult } from './types.js';

const log = logger('render');

/** Bump when the animation runtime changes in a way that alters output pixels. */
const RENDER_VERSION = 3;

type Segment = { index: number; from: number; to: number; poster: number | null };

function defaultConcurrency(): number {
  const cpus = typeof os.availableParallelism === 'function' ? os.availableParallelism() : 4;
  return Math.max(1, Math.min(4, cpus - 1));
}

async function fileSignature(file: string | null): Promise<string> {
  if (!file) return 'none';
  try {
    const s = await stat(file);
    return `${path.basename(file)}:${s.size}:${Math.round(s.mtimeMs)}`;
  } catch {
    return 'missing';
  }
}

/**
 * The narration track. Prefers `<dir>/audio/narration.wav`; if the voice stage
 * only left per-scene clips, joins them once (losslessly) so re-renders are cheap.
 * A silent film is a warning, never a failure.
 */
async function resolveNarration(
  sb: Storyboard,
  dir: string,
  opts: RenderOptions,
): Promise<string | null> {
  const target = path.resolve(dir, opts.audioPath ?? 'audio/narration.wav');
  if (existsSync(target)) return target;

  const clips = sb.scenes.map((s) => s.audioPath).filter((p): p is string => Boolean(p));
  const abs = clips.map((c) => path.resolve(dir, c));
  if (clips.length === sb.scenes.length && abs.length > 0 && abs.every((p) => existsSync(p))) {
    await mkdir(path.dirname(target), { recursive: true });
    const listPath = path.join(path.dirname(target), 'scenes.txt');
    if (await concatWavs(listPath, abs, target)) {
      log.info(`joined ${abs.length} scene clips into ${path.relative(dir, target)}`);
      return target;
    }
  }
  log.warn(
    `no narration at ${path.relative(dir, target)} — rendering a silent video. Run the voice stage first.`,
  );
  return null;
}

function planSegments(frames: number, workers: number, posterFrame: number): Segment[] {
  const count = Math.max(1, Math.min(workers, Math.ceil(frames / 24)));
  const per = Math.ceil(frames / count);
  const segs: Segment[] = [];
  for (let from = 0, i = 0; from < frames; from += per, i++) {
    const to = Math.min(frames, from + per);
    segs.push({ index: i, from, to, poster: null });
  }
  const owner = segs.find((s) => posterFrame >= s.from && posterFrame < s.to) ?? segs[0];
  if (owner) owner.poster = posterFrame;
  return segs;
}

export async function render(
  sb: Storyboard,
  dir: string,
  opts: RenderOptions = {},
): Promise<RenderResult> {
  const t0 = Date.now();
  await mkdir(dir, { recursive: true });
  report(opts, { stage: 'render', pct: 1, note: 'checking tools' });

  const ffmpegVersion = await ensureFfmpeg();
  if (!chromiumAvailable()) throw new Error(CHROMIUM_HINT);
  log.debug(ffmpegVersion);

  const font = resolveFont(sb.meta.style, dir, opts.fontPath);
  const plan: RenderPlan = compilePlan(sb, dir, {
    fontFamily: font.family,
    ...(opts.grid === undefined ? {} : { grid: opts.grid }),
  });

  const outName = opts.outName ?? 'out.mp4';
  const videoPath = path.resolve(dir, outName);
  const thumbnailPath = path.resolve(dir, 'thumbnail.png');
  const frames = Math.max(1, Math.ceil(plan.duration * plan.fps));
  const durationSec = frames / plan.fps;

  const audio = await resolveNarration(sb, dir, opts);
  const crf = opts.crf ?? 18;
  const preset = opts.preset ?? 'medium';
  const cacheKey = hash(
    RENDER_VERSION,
    plan,
    frames,
    outName,
    crf,
    preset,
    opts.frameFormat ?? 'png',
    await fileSignature(audio),
    await fileSignature(font.file),
  );
  if (!opts.force && (await isFresh(dir, 'render', cacheKey, [outName, 'thumbnail.png']))) {
    log.info(`${outName} is up to date — skipping ${frames} frames`);
    report(opts, { stage: 'render', pct: 100, note: 'cached' });
    return { videoPath, thumbnailPath, durationSec, frames, cached: true };
  }

  const html = buildPageHtml(plan, {
    mode: 'capture',
    fontCss: font.css,
    title: sb.title,
  });

  const posterAt = opts.posterAt ?? posterTime(plan);
  const posterFrame = Math.min(frames - 1, Math.max(0, Math.round(posterAt * plan.fps)));
  const segments = planSegments(frames, opts.concurrency ?? defaultConcurrency(), posterFrame);
  const segDir = path.resolve(dir, 'frames');
  await mkdir(segDir, { recursive: true });

  log.info(
    `rendering ${frames} frames (${durationSec.toFixed(2)}s @ ${plan.fps}fps, ${plan.frame.w}x${plan.frame.h}) across ${segments.length} worker${segments.length === 1 ? '' : 's'}`,
  );
  report(opts, { stage: 'render', pct: 3, note: `${frames} frames` });

  const shot: FrameFormat =
    opts.frameFormat === 'jpeg'
      ? { type: 'jpeg', quality: opts.jpegQuality ?? 95 }
      : { type: 'png' };

  let done = 0;
  const step = Math.max(1, Math.floor(frames / 200));
  const tick = (): void => {
    done += 1;
    if (done % step === 0 || done === frames) {
      report(opts, {
        stage: 'render',
        pct: 3 + (done / frames) * 85,
        note: `frame ${done}/${frames}`,
      });
    }
  };

  // Leave the cores for Chromium; the encoders are not the bottleneck.
  const cores = typeof os.availableParallelism === 'function' ? os.availableParallelism() : 4;
  const threads = Math.max(1, Math.min(4, Math.floor(cores / segments.length)));

  const browser = await launchChromium();
  const encoders = new Set<SegmentEncoder>();
  const segFiles: string[] = [];

  try {
    await Promise.all(
      segments.map(async (seg) => {
        const out = path.join(segDir, `seg-${String(seg.index).padStart(3, '0')}.mp4`);
        segFiles[seg.index] = out;
        const cap = await openCapture(browser, plan.frame, html, shot);
        const enc = openSegmentEncoder({ out, fps: plan.fps, crf, preset, threads });
        encoders.add(enc);
        try {
          for (let i = seg.from; i < seg.to; i++) {
            await cap.seek(i / plan.fps);
            await enc.write(await cap.frame());
            tick();
          }
          if (seg.poster !== null) {
            await cap.seek(seg.poster / plan.fps);
            await cap.savePng(thumbnailPath);
          }
          await enc.finish();
          encoders.delete(enc);
        } catch (err) {
          enc.kill();
          encoders.delete(enc);
          throw err;
        } finally {
          await cap.close();
        }
      }),
    );
  } catch (err) {
    for (const enc of encoders) enc.kill();
    throw err;
  } finally {
    await browser.close().catch(() => undefined);
  }

  report(opts, { stage: 'render', pct: 90, note: 'encoding' });
  const listPath = path.join(segDir, 'segments.txt');
  await writeConcatList(listPath, segFiles);
  await concatAndMux({ listPath, audio, out: videoPath, duration: durationSec });

  if (!opts.keepSegments) {
    await rm(segDir, { recursive: true, force: true });
  }

  await markFresh(dir, 'render', cacheKey);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  log.info(
    `wrote ${shortPath(videoPath)} — ${durationSec.toFixed(2)}s of video in ${secs}s${audio ? '' : ' (no audio)'}`,
  );
  report(opts, { stage: 'render', pct: 100, note: outName });

  return { videoPath, thumbnailPath, durationSec, frames, cached: false };
}

/** A poster showing a finished first beat, not an empty board. */
function posterTime(plan: RenderPlan): number {
  const first = plan.scenes[0];
  // A very short opening beat has nothing worth showing yet, so dip into the film.
  const t =
    first && first.dur >= 0.5 ? first.start + first.dur - 0.15 : Math.min(plan.duration * 0.5, 1.2);
  return Math.min(plan.duration, Math.max(0, t));
}

/** Repo-relative when that is shorter to read, absolute otherwise. */
function shortPath(file: string): string {
  const rel = path.relative(process.cwd(), file);
  return rel && !rel.startsWith('..') ? rel : file;
}
