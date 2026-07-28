/**
 * The orchestrator: ingest -> plan -> voice -> visuals -> render.
 *
 * Three properties this file exists to guarantee:
 *
 *  1. **Resumable.** The storyboard is saved after every stage and each stage's
 *     inputs are hashed into `cache.json`, so a crash (or a Ctrl-C, or a laptop
 *     lid) costs you only the stage that was running. A second `cast` of the
 *     same document does no work at all.
 *  2. **One progress number.** Stages report 0–100 of their own work; callers
 *     get a single monotonic 0–100 with render weighted heaviest because render
 *     is most of the wall clock.
 *  3. **Failures name the stage.** Every throw is wrapped in a `StageError`
 *     carrying `stage` and the original `cause`, because "planner: ANTHROPIC_API_KEY
 *     rejected" is actionable and "TypeError: undefined" is not.
 */

import { existsSync } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  hash,
  isFresh,
  loadStoryboard,
  logger,
  markFresh,
  openProject,
  parseStoryboard,
  projectId as makeProjectId,
  saveStoryboard,
  totalDuration,
  type OnProgress,
  type Storyboard,
  type StoryboardMeta,
} from '@inkcast/core';
import { costOf, type CostReport } from './cost.js';
import { inStage, StageError } from './errors.js';
import { progressBus, type StageName } from './progress.js';
import { fullyLocal, providers as detectProviders, type Providers } from './providers.js';
import { findVideo, readState, writeState, type PipelineState, type SourceRef } from './state.js';
import {
  loadPlanner,
  loadRender,
  loadVisuals,
  loadVoice,
  type PlanOptions,
  type SourceDoc,
} from './stages.js';

const log = logger('pipeline');

export type CastInput = {
  text?: string;
  url?: string;
  filePath?: string;
  title?: string;
  meta?: Partial<StoryboardMeta>;
};

export type CastOptions = {
  /** Reuse (and resume) a specific project directory. */
  projectId?: string;
  onProgress?: OnProgress;
  /** Redo every stage even when the cache says it is fresh. */
  force?: boolean;
};

export type CastResult = {
  projectId: string;
  /** Absolute path to the finished mp4. */
  videoPath: string;
  storyboard: Storyboard;
  /** Absolute path to the project directory. */
  dir: string;
  cost: CostReport;
  /** Wall-clock milliseconds per stage. Skipped stages are ~0. */
  timings: Partial<Record<StageName, number>>;
  /** Stages served entirely from cache. */
  skipped: StageName[];
  providers: Providers;
};

export async function cast(input: CastInput, opts: CastOptions = {}): Promise<CastResult> {
  const source = sourceRef(input);
  const force = opts.force ?? false;
  const bus = progressBus(opts.onProgress);
  const timings: Partial<Record<StageName, number>> = {};
  const skipped: StageName[] = [];

  const id =
    opts.projectId ??
    makeProjectId(JSON.stringify({ source, meta: input.meta, title: input.title }));
  const project = await openProject(id);
  const dir = project.dir;
  const previous = await readState(dir);
  log.info(`project ${id}`, dir);

  const time = async <T>(stage: StageName, fn: () => Promise<T>): Promise<T> => {
    const t0 = Date.now();
    const out = await inStage(stage, id, fn);
    timings[stage] = Date.now() - t0;
    return out;
  };

  /* -------------------------------------------------------------- 1. ingest */

  const sourceHash = hash('ingest@1', source.kind, source.ref, await sourceStamp(input));
  let doc: SourceDoc | undefined;
  if (!force && (await isFresh(dir, 'pipeline.ingest', sourceHash, ['source.json']))) {
    doc = await readJson<SourceDoc>(path.resolve(dir, 'source.json'));
  }
  if (doc) {
    skipped.push('ingest');
    bus.done('ingest', 'cached');
    timings.ingest = 0;
  } else {
    doc = await time('ingest', async () => {
      bus.stage('ingest', 5, describeSource(source));
      const { ingest } = await loadPlanner('ingest');
      const result = await ingest({
        ...(input.text === undefined ? {} : { text: input.text }),
        ...(input.filePath === undefined ? {} : { filePath: input.filePath }),
        ...(input.url === undefined ? {} : { url: input.url }),
      });
      if (!result || typeof result !== 'object') {
        throw new Error('ingest returned no document');
      }
      await writeFile(path.resolve(dir, 'source.json'), JSON.stringify(result, null, 2));
      await markFresh(dir, 'pipeline.ingest', sourceHash);
      return result;
    });
    bus.done('ingest');
  }
  const sourceChars = (typeof doc.text === 'string' ? doc.text : JSON.stringify(doc)).length;

  /* ---------------------------------------------------------------- 2. plan */

  const metaOverrides = resolveMetaOverrides(input.meta);
  const provs = detectProviders(metaOverrides.voice);
  const planHash = hash(
    'plan@1',
    sourceHash,
    input.title ?? '',
    metaOverrides,
    provs.planner.name,
    provs.planner.model ?? '',
  );

  let sb: Storyboard | undefined;
  if (!force && (await isFresh(dir, 'pipeline.plan', planHash, ['storyboard.json']))) {
    try {
      sb = await loadStoryboard(dir);
      skipped.push('plan');
      bus.done('plan', 'cached');
      timings.plan = 0;
    } catch (err) {
      log.warn('cached storyboard.json is unreadable — replanning', err);
      sb = undefined;
    }
  }
  if (!sb) {
    sb = await time('plan', async () => {
      bus.stage('plan', 2, `planner: ${provs.planner.name}`);
      const { plan } = await loadPlanner();
      const planOpts: PlanOptions = {
        ...metaOverrides, // flat, for planners that read options directly
        ...(input.title === undefined ? {} : { title: input.title }),
        meta: metaOverrides,
        onProgress: bus.child('plan'),
        force,
      };
      const planned = await plan(doc!, planOpts);
      const validated = parseStoryboard(planned);
      // Saved before marking fresh: the cache may only ever describe what is
      // already on disk, never what we are about to write.
      await saveStoryboard(dir, validated);
      await markFresh(dir, 'pipeline.plan', planHash);
      return validated;
    });
    bus.done('plan');
  }

  // The user's flags always win over whatever the planner chose.
  sb = applyOverrides(sb, input.title, metaOverrides);
  await saveStoryboard(dir, sb);

  /* --------------------------------------------------------------- 3. voice */

  const voiceIdentity = (scene: string) =>
    hash('voice@1', scene, sb!.meta.voice, sb!.meta.language, provs.voice.name);

  const staleScenes = new Set<string>();
  for (const scene of sb.scenes) {
    const ready = scene.durationSec !== undefined && scene.audioPath !== undefined;
    const fresh =
      !force &&
      ready &&
      (await isFresh(dir, `pipeline.voice.${scene.id}`, voiceIdentity(scene.narration), [
        scene.audioPath!,
      ]));
    if (!fresh) staleScenes.add(scene.id);
  }

  if (staleScenes.size === 0) {
    skipped.push('voice');
    bus.done('voice', 'cached');
    timings.voice = 0;
  } else {
    // Drop measurements that no longer describe the audio we are about to make,
    // so a crash can never leave a duration pointing at the wrong clip.
    for (const scene of sb.scenes) {
      if (!staleScenes.has(scene.id)) continue;
      delete scene.audioPath;
      delete scene.durationSec;
      delete scene.words;
    }
    await saveStoryboard(dir, sb);

    sb = await time('voice', async () => {
      bus.stage('voice', 1, `voice: ${provs.voice.name} (${sb!.meta.voice})`);
      const { narrate } = await loadVoice();
      const out = await narrate(sb!, dir, { onProgress: bus.child('voice'), force });
      const next = parseStoryboard(out);
      const missing = next.scenes.filter((s) => !s.durationSec || !s.audioPath);
      if (missing.length > 0) {
        throw new Error(
          `no audio for scene(s) ${missing.map((s) => s.id).join(', ')} — the voice stage must set durationSec and audioPath`,
        );
      }
      return next;
    });
    await saveStoryboard(dir, sb);
    for (const scene of sb.scenes) {
      await markFresh(dir, `pipeline.voice.${scene.id}`, voiceIdentity(scene.narration));
    }
    bus.done('voice');
  }
  const narratedChars = sb.scenes
    .filter((s) => staleScenes.has(s.id))
    .reduce((n, s) => n + s.narration.length, 0);

  /* ------------------------------------------------------------- 4. visuals */

  const assetIdentity = (a: { kind: string; prompt?: string; seed?: number }) =>
    hash(
      'visuals@1',
      a.kind,
      a.prompt ?? '',
      a.seed ?? 0,
      sb!.meta.style,
      sb!.meta.palette,
      provs.images.name,
    );
  const visualsHash = hash(
    'visuals@1',
    sb.assets.map((a) => [a.id, assetIdentity(a)]),
    sb.scenes.map((s) => s.elements.filter((e) => e.type === 'diagram')),
    sb.meta.style,
    sb.meta.palette,
  );

  const staleAssets = new Set<string>();
  for (const a of sb.assets) {
    const fresh =
      !force &&
      Boolean(a.svg) &&
      (await isFresh(dir, `pipeline.visuals.${a.id}`, assetIdentity(a)));
    if (!fresh) staleAssets.add(a.id);
  }
  const visualsFresh =
    !force && staleAssets.size === 0 && (await isFresh(dir, 'pipeline.visuals', visualsHash));

  const assetsBefore = new Set(sb.assets.filter((a) => a.svg).map((a) => a.id));
  if (visualsFresh) {
    skipped.push('visuals');
    bus.done('visuals', 'cached');
    timings.visuals = 0;
  } else {
    for (const a of sb.assets) if (staleAssets.has(a.id)) delete a.svg;
    sb = await time('visuals', async () => {
      bus.stage('visuals', 1, `images: ${provs.images.name}`);
      const { resolveVisuals } = await loadVisuals();
      const out = await resolveVisuals(sb!, dir, { onProgress: bus.child('visuals'), force });
      return parseStoryboard(out);
    });
    await saveStoryboard(dir, sb);
    for (const a of sb.assets) {
      await markFresh(dir, `pipeline.visuals.${a.id}`, assetIdentity(a));
    }
    await markFresh(dir, 'pipeline.visuals', visualsHash);
    bus.done('visuals');
  }
  const generatedAssets = sb.assets.filter(
    (a) => a.source === 'generated' && !assetsBefore.has(a.id),
  ).length;

  /* -------------------------------------------------------------- 5. render */

  const renderHash = hash('render@1', sb);
  const existing = await findVideo(dir, previous?.videoPath);
  let videoPath: string;
  if (!force && existing && (await isFresh(dir, 'pipeline.render', renderHash, [existing]))) {
    videoPath = existing;
    skipped.push('render');
    bus.done('render', 'cached');
    timings.render = 0;
  } else {
    videoPath = await time('render', async () => {
      bus.stage('render', 0, `${sb!.meta.aspect} at ${sb!.meta.fps}fps`);
      const { render } = await loadRender();
      const out = await render(sb!, dir, { onProgress: bus.child('render'), force });
      if (!out || typeof out.videoPath !== 'string' || out.videoPath === '') {
        throw new Error('render returned no videoPath');
      }
      const abs = path.isAbsolute(out.videoPath) ? out.videoPath : path.resolve(dir, out.videoPath);
      if (!existsSync(abs)) throw new Error(`render reported ${abs} but no file is there`);
      await markFresh(dir, 'pipeline.render', renderHash);
      return abs;
    });
    bus.done('render');
  }

  /* ---------------------------------------------------------------- wrap up */

  const cost = costOf(sb, {
    providers: provs,
    sourceChars,
    storyboardChars: JSON.stringify(sb).length,
    narratedChars,
    generatedAssets,
  });
  const now = new Date().toISOString();
  const state: PipelineState = {
    projectId: id,
    title: sb.title,
    videoPath: path.relative(dir, videoPath) || path.basename(videoPath),
    source,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    durationSec: round2(totalDuration(sb)),
    timings,
    skipped,
    cost,
    providers: {
      planner: provs.planner.model
        ? `${provs.planner.name}/${provs.planner.model}`
        : provs.planner.name,
      voice: `${provs.voice.name}${provs.voice.model ? `/${provs.voice.model}` : ''}`,
      images: provs.images.name,
    },
  };
  await writeState(dir, state);
  log.info(
    `done in ${(bus.elapsedMs() / 1000).toFixed(1)}s`,
    fullyLocal(provs) ? 'fully local, $0.00' : `cost ~$${cost.usd.toFixed(4)}`,
  );

  return {
    projectId: id,
    videoPath,
    storyboard: sb,
    dir,
    cost,
    timings,
    skipped,
    providers: provs,
  };
}

/**
 * Re-run the tail of the pipeline for a saved project.
 *
 * Voice and visuals are cache-checked (so an edited scene is re-voiced and
 * nothing else is), then the video is rebuilt. This is the cheap path behind
 * `inkcast rerender` and the studio's "apply changes" button.
 */
export async function rerender(
  projectId: string,
  opts: CastOptions = {},
): Promise<{
  videoPath: string;
  storyboard: Storyboard;
  cost: CostReport;
  projectId: string;
  dir: string;
}> {
  const project = await openProject(projectId);
  const dir = project.dir;
  let sb: Storyboard;
  try {
    sb = await loadStoryboard(dir);
  } catch (cause) {
    throw new StageError('render', `project "${projectId}" has no storyboard.json`, {
      cause,
      projectId,
    });
  }
  const previous = await readState(dir);

  // Reuse `cast`'s machinery by handing it the already-planned storyboard: the
  // ingest and plan caches are marked fresh against this storyboard's own hash,
  // so only voice/visuals/render can run.
  const bus = progressBus(opts.onProgress);
  const provs = detectProviders(sb.meta.voice);
  const timings: Partial<Record<StageName, number>> = {};
  const skipped: StageName[] = ['ingest', 'plan'];
  bus.done('ingest', 'cached');
  bus.done('plan', 'cached');

  const force = opts.force ?? true; // "rerender" means rebuild the video.
  const time = async <T>(stage: StageName, fn: () => Promise<T>): Promise<T> => {
    const t0 = Date.now();
    const out = await inStage(stage, projectId, fn);
    timings[stage] = Date.now() - t0;
    return out;
  };

  /* voice: only scenes whose narration/voice changed */
  const voiceIdentity = (scene: string) =>
    hash('voice@1', scene, sb.meta.voice, sb.meta.language, provs.voice.name);
  let stale = 0;
  for (const scene of sb.scenes) {
    const ready = scene.durationSec !== undefined && scene.audioPath !== undefined;
    const fresh =
      ready &&
      (await isFresh(dir, `pipeline.voice.${scene.id}`, voiceIdentity(scene.narration), [
        scene.audioPath!,
      ]));
    if (!fresh) {
      stale++;
      delete scene.audioPath;
      delete scene.durationSec;
      delete scene.words;
    }
  }
  let narratedChars = 0;
  if (stale === 0) {
    skipped.push('voice');
    bus.done('voice', 'cached');
  } else {
    narratedChars = sb.scenes
      .filter((s) => !s.durationSec)
      .reduce((n, s) => n + s.narration.length, 0);
    await saveStoryboard(dir, sb);
    sb = await time('voice', async () => {
      const { narrate } = await loadVoice();
      return parseStoryboard(await narrate(sb, dir, { onProgress: bus.child('voice') }));
    });
    await saveStoryboard(dir, sb);
    for (const scene of sb.scenes) {
      await markFresh(dir, `pipeline.voice.${scene.id}`, voiceIdentity(scene.narration));
    }
    bus.done('voice');
  }

  /* visuals: only assets missing artwork */
  const missingArt = sb.assets.some((a) => !a.svg);
  if (!missingArt) {
    skipped.push('visuals');
    bus.done('visuals', 'cached');
  } else {
    sb = await time('visuals', async () => {
      const { resolveVisuals } = await loadVisuals();
      return parseStoryboard(await resolveVisuals(sb, dir, { onProgress: bus.child('visuals') }));
    });
    await saveStoryboard(dir, sb);
    bus.done('visuals');
  }

  const renderHash = hash('render@1', sb);
  const existing = await findVideo(dir, previous?.videoPath);
  let videoPath: string;
  if (!force && existing && (await isFresh(dir, 'pipeline.render', renderHash, [existing]))) {
    videoPath = existing;
    skipped.push('render');
    bus.done('render', 'cached');
  } else {
    videoPath = await time('render', async () => {
      const { render } = await loadRender();
      const out = await render(sb, dir, { onProgress: bus.child('render'), force: true });
      if (!out || typeof out.videoPath !== 'string' || out.videoPath === '') {
        throw new Error('render returned no videoPath');
      }
      const abs = path.isAbsolute(out.videoPath) ? out.videoPath : path.resolve(dir, out.videoPath);
      if (!existsSync(abs)) throw new Error(`render reported ${abs} but no file is there`);
      await markFresh(dir, 'pipeline.render', renderHash);
      return abs;
    });
    bus.done('render');
  }

  const cost = costOf(sb, {
    providers: provs,
    sourceChars: 0,
    storyboardChars: 0,
    narratedChars,
    generatedAssets: 0,
  });
  const now = new Date().toISOString();
  await writeState(dir, {
    projectId,
    title: sb.title,
    videoPath: path.relative(dir, videoPath) || path.basename(videoPath),
    ...(previous?.source ? { source: previous.source } : {}),
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    durationSec: round2(totalDuration(sb)),
    timings,
    skipped,
    cost,
    providers: previous?.providers ?? {},
  });
  return { videoPath, storyboard: sb, cost, projectId, dir };
}

/* ------------------------------------------------------------------ helpers */

function sourceRef(input: CastInput): SourceRef {
  if (input.filePath) return { kind: 'file', ref: path.resolve(input.filePath) };
  if (input.url) return { kind: 'url', ref: input.url };
  if (typeof input.text === 'string' && input.text.trim() !== '') {
    return { kind: 'text', ref: input.text };
  }
  throw new StageError('ingest', 'nothing to cast — pass text, filePath or url');
}

function describeSource(s: SourceRef): string {
  if (s.kind === 'file') return path.basename(s.ref);
  if (s.kind === 'url') return s.ref;
  return `${s.ref.length} characters of text`;
}

/** Cheap fingerprint of the source so an edited file re-ingests. */
async function sourceStamp(input: CastInput): Promise<string> {
  if (!input.filePath) return '';
  try {
    const st = await stat(input.filePath);
    return `${st.size}:${Math.round(st.mtimeMs)}`;
  } catch (cause) {
    throw new StageError('ingest', `cannot read ${input.filePath}`, { cause });
  }
}

/** CLI/API flags plus env defaults, with `undefined` entries removed. */
function resolveMetaOverrides(meta: Partial<StoryboardMeta> = {}): Partial<StoryboardMeta> {
  const envVoice = process.env.INKCAST_VOICE?.trim();
  const merged: Partial<StoryboardMeta> = { ...meta };
  if (merged.voice === undefined && envVoice) merged.voice = envVoice;
  return Object.fromEntries(
    Object.entries(merged).filter(([, v]) => v !== undefined && v !== ''),
  ) as Partial<StoryboardMeta>;
}

function applyOverrides(
  sb: Storyboard,
  title: string | undefined,
  meta: Partial<StoryboardMeta>,
): Storyboard {
  const next = {
    ...sb,
    title: title?.trim() ? title.trim() : sb.title,
    meta: { ...sb.meta, ...meta },
  };
  return parseStoryboard(next);
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as T) : undefined;
  } catch {
    return undefined;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
