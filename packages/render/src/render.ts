/**
 * `render(sb, dir, opts)` — the last stage of the pipeline.
 *
 * The film is cut into segments on scene boundaries (`segments.ts`), and the segments are
 * encoded by a pool of browser contexts each piping into its own ffmpeg; they are then
 * joined with a stream copy and the narration is muxed in. That is what keeps a 60-second
 * 30 fps film (1800 frames) in the tens of seconds rather than minutes.
 *
 * Determinism makes the split safe: worker 3 rendering frame 1200 produces
 * exactly what a single sequential pass would, because the page state is a pure
 * function of `1200 / fps`.
 *
 * **The same determinism is what makes the segments reusable** (plan 7.1). Each is named
 * by a hash of everything that can change its pixels, so `<dir>/frames` is a cache rather
 * than scratch: a re-render encodes only the segments whose contents moved and streams the
 * rest through untouched. Measured on a 2:14 longitude cast — adding a second of hold to
 * the final beat re-encoded 5 of 32 segments, and the result was byte-identical to a full
 * re-render of the same film in a different directory. A render with nothing to redo
 * finishes in 1.4s against 57s.
 *
 * Two consequences worth knowing before editing this file. The directory is pruned on
 * success rather than deleted, because deleting it would mean only a *failed* render ever
 * left anything to reuse. And a segment is written under a `.part-` name and renamed once
 * ffmpeg has closed it — without that, a render killed mid-segment leaves a truncated mp4
 * at exactly the path the next run treats as finished, which is the one way a segment
 * cache can corrupt a film without anybody noticing.
 */
import { existsSync } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gate, hash, isFresh, logger, markFresh, report } from '@inkcast/core';
import type { Storyboard } from '@inkcast/core';
import { realizedTextViolations } from './boardcheck.js';
import { chromiumAvailable, CHROMIUM_HINT, launchChromium, openCapture } from './browser.js';
import type { FrameFormat } from './browser.js';
import { emitCaptions } from './captions.js';
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
import { planSegments, segmentKey, type EncoderSettings, type Segment } from './segments.js';
import type { RenderOptions, RenderPlan, RenderResult } from './types.js';

const log = logger('render');

/**
 * Bump when the animation runtime changes in a way that alters output pixels.
 *
 * 4: board accumulation and the derived camera, plot/path/motion, cue-accurate
 * entry, holds, and text that fits by binary search instead of overflowing.
 * 5: an element's `tone` selects its ink, and every glyph is painted over a halo of
 * paper so a name written across shading stays readable. The halo is unconditional and
 * therefore touches every frame that has ever had text on it, which is all of them.
 */
const RENDER_VERSION = 7;

/**
 * Capture workers when the caller does not say: `INKCAST_RENDER_WORKERS` if it is a
 * positive integer, otherwise `min(4, cpus - 1)`.
 *
 * The variable has been documented in `.env.example` for a long time and read by
 * nothing. It matters on a memory-capped container (a Vercel Performance instance is
 * 4 GB / 2 vCPU), where `availableParallelism()` can report the *host's* cores and four
 * 1080p Chromium contexts plus four encoders is the difference between headroom and the
 * OOM killer. Segmentation does not depend on the worker count (see `segments.ts`), so
 * changing it never invalidates a cached segment.
 */
function defaultConcurrency(): number {
  const configured = Number(process.env.INKCAST_RENDER_WORKERS);
  if (Number.isInteger(configured) && configured >= 1) return configured;
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

/**
 * Run `jobs` with at most `limit` in flight.
 *
 * `Promise.all` over the segments was correct while there was one segment per worker; the
 * scene-aligned cut (plan 7.1) makes the count a property of the *film* instead, so a
 * two-minute lesson is thirty segments and thirty simultaneous Chromium contexts would
 * take the machine down. The pool is the smallest thing that keeps the old behaviour when
 * the counts happen to match.
 *
 * A rejection is not swallowed and the pool does not stop: the caller kills the encoders
 * and rethrows, and a worker that abandoned its slot mid-flight would leave the others
 * running into a browser that is about to close.
 */
async function pooled(jobs: (() => Promise<void>)[], limit: number): Promise<void> {
  let next = 0;
  const failures: unknown[] = [];
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      const job = jobs[i];
      if (!job) return;
      try {
        await job();
      } catch (err) {
        failures.push(err);
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, jobs.length)) }, worker));
  if (failures.length) throw failures[0];
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

  const font = resolveFont(sb.meta.style, dir, opts.fontPath, opts.gates);
  const plan: RenderPlan = compilePlan(sb, dir, {
    fontFamily: font.family,
    ...(opts.grid === undefined ? {} : { grid: opts.grid }),
    ...(opts.gates === undefined ? {} : { gates: opts.gates }),
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
    // Captions are outside the render cache on purpose: they are a pure function of the
    // storyboard, cost milliseconds, and are not part of the key that says the pixels are
    // current. Emitting them here is what gives every already-rendered project a caption
    // track on its next `rerender` instead of only films made after this landed.
    await emitCaptions(sb, plan, dir, opts, outName);
    report(opts, { stage: 'render', pct: 100, note: 'cached' });
    return {
      videoPath,
      thumbnailPath,
      durationSec,
      frames,
      cached: true,
      ...(plan.problems ? { problems: plan.problems } : {}),
    };
  }

  const html = buildPageHtml(plan, {
    mode: 'capture',
    fontCss: font.css,
    title: sb.title,
  });

  const posterAt = opts.posterAt ?? posterTime(plan);
  const posterFrame = Math.min(frames - 1, Math.max(0, Math.round(posterAt * plan.fps)));
  // Cut on scene boundaries, subdivided (plan 7.1). The worker count no longer decides
  // where the cuts fall — see `segments.ts` — it decides how many run at once.
  const segments = planSegments(plan, frames, posterFrame);
  const workers = Math.max(1, opts.concurrency ?? defaultConcurrency());
  const segDir = path.resolve(dir, 'frames');
  await mkdir(segDir, { recursive: true });

  log.info(
    `rendering ${frames} frames (${durationSec.toFixed(2)}s @ ${plan.fps}fps, ${plan.frame.w}x${plan.frame.h}) in ${segments.length} segment${segments.length === 1 ? '' : 's'} across ${workers} worker${workers === 1 ? '' : 's'}`,
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

  // Leave the cores for Chromium; the encoders are not the bottleneck. Divided by the
  // number running *at once* rather than by the number of segments: since 7.1 the segment
  // count is a property of the film, so dividing by it would hand a long lesson one thread
  // per encoder no matter how idle the machine was. It is also in every segment's cache
  // key, so it has to be a function of the settings and not of the film.
  const cores = typeof os.availableParallelism === 'function' ? os.availableParallelism() : 4;
  const threads = Math.max(1, Math.min(4, Math.floor(cores / workers)));
  const encSettings: EncoderSettings = {
    crf,
    preset,
    threads,
    format: opts.frameFormat ?? 'png',
  };

  const browser = await launchChromium();
  const encoders = new Set<SegmentEncoder>();
  // Named by content, not by position: `seg-003.mp4` would be a different film's third
  // segment tomorrow, and the whole point is that a file's name is a claim about what is
  // inside it. `RENDER_VERSION` is folded in here rather than in `segmentKey` for the
  // reason that function's header gives.
  const segFiles = segments.map((seg) =>
    path.join(segDir, `seg-${segmentKey(plan, seg, encSettings, RENDER_VERSION)}.mp4`),
  );
  const realizedProblems: string[] = [];
  let reused = 0;

  try {
    // The realized-layout report (plan 2.7), before frame 0: the browser's
    // shrink-to-fit is invisible to the solver, so what it actually laid out is
    // read back over CDP and swept the way compile swept the estimates. A box
    // narrowed past the legibility floor fails here, from reality, not from the
    // estimate that said it was fine.
    {
      const probe = await openCapture(browser, plan.frame, html, shot);
      try {
        const violations = realizedTextViolations(await probe.realizedLayout(), plan);
        if (violations.length > 0) {
          gate(
            opts.gates,
            `${violations.length} realized-layout violation${violations.length === 1 ? '' : 's'}:\n` +
              violations.map((v) => `  - ${v.message}`).join('\n'),
            (m) => {
              log.warn(m);
              realizedProblems.push(m);
            },
          );
        }
      } finally {
        await probe.close();
      }
    }

    await pooled(
      segments.map((seg) => async () => {
        const out = segFiles[seg.index]!;
        // Already encoded, by this render's predecessor or by the attempt that failed
        // half way. The file is only ever *named* after it is complete (see the rename
        // below), so its existence is a real answer and not a maybe.
        if (existsSync(out)) {
          reused += 1;
          for (let i = seg.from; i < seg.to; i++) tick();
          return;
        }
        // Encoded under a name nothing looks for, and renamed when ffmpeg has closed the
        // file. Without this a render killed mid-segment leaves a truncated mp4 sitting at
        // the exact path the next run treats as a finished segment — which is the one way
        // a segment cache can corrupt a film silently, and the retry is the case it exists
        // to serve.
        const tmp = path.join(segDir, `.part-${String(seg.index).padStart(3, '0')}.mp4`);
        const cap = await openCapture(browser, plan.frame, html, shot);
        const enc = openSegmentEncoder({ out: tmp, fps: plan.fps, crf, preset, threads });
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
          await rename(tmp, out);
        } catch (err) {
          enc.kill();
          encoders.delete(enc);
          await rm(tmp, { force: true }).catch(() => undefined);
          throw err;
        } finally {
          await cap.close();
        }
      }),
      workers,
    );

    // The poster lives in one segment, so a run that reused that segment never captured
    // it. Cheap to notice and cheap to fix — one seek — and the alternative is a project
    // whose thumbnail silently stops existing the second time it is rendered.
    if (!existsSync(thumbnailPath)) {
      const cap = await openCapture(browser, plan.frame, html, shot);
      try {
        await cap.seek(posterFrame / plan.fps);
        await cap.savePng(thumbnailPath);
      } finally {
        await cap.close();
      }
    }
  } catch (err) {
    for (const enc of encoders) enc.kill();
    throw err;
  } finally {
    await browser.close().catch(() => undefined);
  }

  if (reused > 0) {
    log.info(
      `reused ${reused} of ${segments.length} segments — encoded ${segments.length - reused}`,
    );
  }

  report(opts, { stage: 'render', pct: 90, note: 'encoding' });
  const listPath = path.join(segDir, 'segments.txt');
  await writeConcatList(listPath, segFiles);
  await concatAndMux({ listPath, audio, out: videoPath, duration: durationSec });

  // Pruned, not deleted — this directory *is* the segment cache (plan 7.1), and deleting
  // it on success would mean only a failed render ever left anything to reuse. What goes
  // is everything this film does not reference: the segments of the version before the
  // edit, and any `.part-*` a killed run left behind. So the cache stays exactly one
  // film's worth on disk and a re-render after a tail edit still finds its head.
  //
  // `keepSegments` keeps those too. It was a debugging flag for "let me look at the
  // per-worker mp4s" and it still is; it now also means "do not garbage-collect".
  if (!opts.keepSegments) {
    const keep = new Set(segFiles.map((f) => path.basename(f)));
    keep.add(path.basename(listPath));
    for (const name of await readdir(segDir).catch(() => [] as string[])) {
      if (!keep.has(name)) await rm(path.join(segDir, name), { force: true });
    }
  }

  await markFresh(dir, 'render', cacheKey);
  // After the mux, because the optional burn-in pass reads the finished mp4.
  await emitCaptions(sb, plan, dir, opts, outName);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  log.info(
    `wrote ${shortPath(videoPath)} — ${durationSec.toFixed(2)}s of video in ${secs}s${audio ? '' : ' (no audio)'}`,
  );
  report(opts, { stage: 'render', pct: 100, note: outName });

  const problems = [...(plan.problems ?? []), ...realizedProblems];
  return {
    videoPath,
    thumbnailPath,
    durationSec,
    frames,
    cached: false,
    ...(problems.length > 0 ? { problems } : {}),
  };
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
