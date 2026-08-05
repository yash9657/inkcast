/**
 * The orchestrator: ingest -> lesson -> storyboard -> voice -> visuals -> render.
 *
 * ## Why the order is what it is
 *
 * The MVP ran ingest -> plan -> voice -> visuals -> render and shipped a
 * slideshow. Two things changed, and both are structural rather than cosmetic:
 *
 *  1. **`lesson` is its own stage, ahead of anything visual.** `plan()` used to
 *     split a document into beats and read them aloud, which is summarising. What
 *     to teach — the hook, the everyday anchor, one idea per step with a reason
 *     rather than an assertion, a worked example with real numbers, the
 *     misconception the learner just formed — has to be decided before there is
 *     any question of how to draw it. The `Lesson` is persisted as `lesson.json`
 *     so it can be read, criticised and hand-edited; editing it and re-casting
 *     recompiles the board without re-authoring the teaching.
 *  2. **`voice` runs before `visuals` and `render`.** The voice stage measures
 *     real audio into `scene.durationSec` and resolves every `Enter.cue` — a
 *     verbatim phrase of narration — into the fraction of the scene where those
 *     words are actually spoken. Elements that arrive seconds before the sentence
 *     naming them read as drift even when the audio is sample-accurate, so
 *     nothing may be drawn or rendered against unresolved timing.
 *
 * Everything else this file guarantees is unchanged:
 *
 *  - **Resumable.** Artefacts are saved after every stage and each stage's inputs
 *    are hashed into `cache.json` (see `./keys.ts`, which explains why the code
 *    version is part of every key), so a crash costs you one stage.
 *  - **One progress number.** Stages report 0–100 of their own work; callers get a
 *    single monotonic 0–100, weighted so it tracks wall clock.
 *  - **Failures name the stage.** Every throw is wrapped in a `StageError`
 *    carrying `stage` and the original `cause`.
 *  - **Degradation is spoken aloud.** A stage running without its key reports what
 *    that costs and the one command that fixes it (see `./degrade.ts`).
 */

import { existsSync } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  critiqueLesson,
  hash,
  loadStoryboard,
  logger,
  isFresh,
  markFresh,
  openProject,
  parseStoryboard,
  projectId as makeProjectId,
  saveStoryboard,
  totalDuration,
  type Lesson,
  type OnProgress,
  type Storyboard,
  type StoryboardMeta,
} from '@inkcast/core';
import { costOf, type CostReport } from './cost.js';
import { degradations, formatDegradation, type Degradation } from './degrade.js';
import { openDrawPreview } from './draw-preview.js';
import { inStage, StageError } from './errors.js';
import {
  assetFingerprint,
  cacheKey,
  cacheSlot,
  renderFingerprint,
  visualsFingerprint,
  voiceFingerprint,
} from './keys.js';
import {
  beatCount,
  lessonHash,
  parseLesson,
  readLessonFile,
  saveLessonFile,
  targetSeconds,
  LESSON_FILE,
  type Depth,
} from './lesson.js';
import { progressBus, type ProgressBus, type StageName } from './progress.js';
import { fullyLocal, providers as detectProviders, type Providers } from './providers.js';
import { findVideo, readState, writeState, type PipelineState, type SourceRef } from './state.js';
import {
  loadLessonStage,
  loadPlanner,
  loadRender,
  loadVisuals,
  loadVoice,
  versionOf,
  type CompileStageOptions,
  type LessonStageOptions,
  type PlanOptions,
  type PresetName,
  type PresetShape,
  type SourceDoc,
} from './stages.js';

const log = logger('pipeline');

/**
 * The visuals stage's own output file, as a cache artefact.
 *
 * Spelled out rather than imported as `MANIFEST_PATH` from `@inkcast/visuals`: this
 * module loads that package lazily so a run that never reaches the visuals stage does
 * not pay for roughjs, dagre and a 2000-icon set, and a value import would undo that.
 */
const VISUALS_MANIFEST = 'assets/visuals.json';

/**
 * The files the visuals stage must have left behind for its cache entry to be believed.
 *
 * Both entry points — `cast()` and `rerender()` — gate the stage on this, and they take
 * it from one place because they did not, and drifted: `rerender()` hashed the board
 * without naming a single artefact, so a project whose `assets/` had been deleted or
 * truncated still read as fresh and skipped the stage.
 *
 * What that costs has grown. A missing manifest used to mean the renderer resolved
 * plots in-process to make up for a cache entry that was lying — wasteful but correct.
 * An **equation cannot be typeset in the renderer at all** (typesetting is an async
 * import; `compilePlan` is synchronous), so it degrades to raw TeX on the board.
 *
 * Asset SVGs are named for the same reason at one remove: `Asset.svg` records that
 * artwork *was* resolved, which a restored project without its `assets/` directory
 * still claims. Only the filesystem knows whether it is still there.
 */
export function visualsArtefacts(sb: Storyboard): string[] {
  return [VISUALS_MANIFEST, ...sb.assets.flatMap((a) => (a.svg ? [a.svg] : []))];
}

export type CastInput = {
  /** Raw text or markdown to teach from. */
  text?: string;
  /** An article URL to teach from. */
  url?: string;
  /** A `.md`, `.txt`, `.pdf` or `.docx` file to teach from. */
  filePath?: string;
  /**
   * A bare topic — "gradient descent" — with no source document.
   *
   * This is the primary way people use Inkcast: they want to understand a thing,
   * not to convert a document they already have. The lesson stage takes a topic
   * string directly, so nothing has to be written first.
   */
  topic?: string;
  /**
   * A ready-made lesson: a `Lesson` object, or a path to a `*.lesson.json`.
   *
   * Skips the lesson stage entirely, so `examples/lessons/*.lesson.json` render
   * with no planner, no model and no key — which is exactly what makes them
   * usable as fixtures and as a demonstration of the ceiling.
   */
  lesson?: Lesson | string;
  title?: string;
  meta?: Partial<StoryboardMeta>;
  /** Who the lesson is pitched at. Drives vocabulary and what is assumed. */
  audience?: string;
  /** What the learner must be able to DO afterwards. The acceptance test. */
  objective?: string;
  /** Extra direction for the lesson author (tone, emphasis, constraints). */
  brief?: string;
  /** Output format. `short` is 9:16 vertical with its own pacing rules. */
  preset?: PresetName;
  /** How thorough to be. Scales the preset's runtime target. */
  depth?: Depth;
  /** Hard runtime target in seconds. Overrides `depth` and the preset. */
  maxSeconds?: number;
  /**
   * How to get from a source to a storyboard.
   *
   * `lesson` (the default) runs the pedagogy stage. `document` is the MVP's
   * summarising path, kept because it is the zero-key fixture the renderer is
   * tested against — it is not a route to a watchable video.
   */
  via?: 'lesson' | 'document';
};

export type CastOptions = {
  /** Reuse (and resume) a specific project directory. */
  projectId?: string;
  onProgress?: OnProgress;
  /** Redo every stage even when the cache says it is fresh. */
  force?: boolean;
};

/** What the front half of the pipeline produced. */
export type LessonResult = {
  projectId: string;
  /** Absolute path to the project directory. */
  dir: string;
  /** The lesson, or `undefined` on the `via: 'document'` route. */
  lesson?: Lesson;
  /** Absolute path to `lesson.json`, when there is one. */
  lessonPath?: string;
  /** `critiqueLesson()` output. Empty means it passed. */
  problems: string[];
  /**
   * Who wrote the lesson: Claude, the local derivation, the user (a supplied
   * `*.lesson.json`), or nobody on the `via: 'document'` route. Reported because
   * "which of these four" is the single strongest predictor of whether the video
   * teaches anything.
   */
  author: 'anthropic' | 'heuristic' | 'supplied' | 'none';
  /** Which route produced it. */
  route: 'lesson' | 'document';
  /** Resolved output format. */
  preset: PresetName;
  /** Runtime target the lesson was written against, in seconds. */
  targetSec: number;
  providers: Providers;
  /** Stages running in a lesser mode, each with the command that fixes it. */
  degradations: Degradation[];
};

export type CastResult = LessonResult & {
  /** Absolute path to the finished mp4. */
  videoPath: string;
  storyboard: Storyboard;
  cost: CostReport;
  /** Wall-clock milliseconds per stage. Skipped stages are ~0. */
  timings: Partial<Record<StageName, number>>;
  /** Stages that did no work this run (cached, or nothing to do). */
  skipped: StageName[];
};

/* ------------------------------------------------------------------ the run */

type Run = {
  id: string;
  dir: string;
  bus: ProgressBus;
  force: boolean;
  source: SourceRef;
  previous: PipelineState | undefined;
  timings: Partial<Record<StageName, number>>;
  skipped: StageName[];
  time<T>(stage: StageName, fn: () => Promise<T>): Promise<T>;
  /** Mark a stage as having done nothing, filling its progress band. */
  skip(stage: StageName, why: string): void;
};

async function openRun(input: CastInput, opts: CastOptions): Promise<Run> {
  const source = sourceRef(input);
  const id =
    opts.projectId ??
    makeProjectId(
      JSON.stringify({
        source,
        meta: input.meta,
        title: input.title,
        preset: input.preset,
        depth: input.depth,
        objective: input.objective,
        audience: input.audience,
      }),
    );
  const project = await openProject(id);
  const previous = await readState(project.dir);
  const timings: Partial<Record<StageName, number>> = {};
  const skipped: StageName[] = [];
  const bus = progressBus(opts.onProgress);
  log.info(`project ${id}`, project.dir);

  return {
    id,
    dir: project.dir,
    bus,
    force: opts.force ?? false,
    source,
    previous,
    timings,
    skipped,
    async time(stage, fn) {
      const t0 = Date.now();
      const out = await inStage(stage, id, fn);
      timings[stage] = Date.now() - t0;
      return out;
    },
    skip(stage, why) {
      skipped.push(stage);
      timings[stage] = 0;
      bus.done(stage, why);
    },
  };
}

/* ----------------------------------------------------- 1 + 2: source, lesson */

type Design = LessonResult & {
  doc: SourceDoc | undefined;
  sourceChars: number;
  presetShape: PresetShape;
  /** The loaded planner module, so the storyboard stage does not reload it. */
  planner: Awaited<ReturnType<typeof loadLessonStage>>;
};

/**
 * Run ingest and the lesson stage, and persist the lesson.
 *
 * Exposed on its own because reviewing the teaching before paying for a render is
 * a legitimate and cheap thing to want: a lesson costs one model round trip, a
 * render costs minutes of CPU. The studio's "review the plan" flow and the
 * pipeline's own tests both stop here.
 */
export async function designLesson(
  input: CastInput,
  opts: CastOptions = {},
): Promise<LessonResult> {
  const run = await openRun(input, opts);
  const design = await design_(run, input);
  return stripDesign(design);
}

function stripDesign(d: Design): LessonResult {
  const { doc: _doc, sourceChars: _n, presetShape: _p, planner: _pl, ...rest } = d;
  return rest;
}

async function design_(run: Run, input: CastInput): Promise<Design> {
  const route: 'lesson' | 'document' = input.via ?? 'lesson';
  const supplied = input.lesson !== undefined;
  const metaOverrides = resolveMetaOverrides(input.meta);
  const provs = detectProviders(metaOverrides.voice);
  const degraded = degradations(provs, { via: route, lessonSupplied: supplied });
  for (const d of degraded) {
    if (d.severity === 'major') log.warn(formatDegradation(d));
    else log.info(formatDegradation(d));
  }

  const planner = await loadLessonStage(route === 'document' ? 'storyboard' : 'lesson');
  const format = {
    ...(input.preset === undefined ? {} : { preset: input.preset }),
    ...(metaOverrides.aspect === undefined ? {} : { aspect: metaOverrides.aspect }),
    ...(input.maxSeconds === undefined ? {} : { maxSeconds: input.maxSeconds }),
  };
  const presetShape = planner.resolvePreset(format);
  const seconds = targetSeconds(presetShape, {
    ...(input.depth === undefined ? {} : { depth: input.depth }),
    ...(input.maxSeconds === undefined ? {} : { maxSeconds: input.maxSeconds }),
  });
  const targetSec = seconds ?? presetShape.maxSeconds;

  /* ------------------------------------------------------------- 1. ingest */

  const wantsDoc = !supplied && (input.topic === undefined || route === 'document');
  let doc: SourceDoc | undefined;

  if (!wantsDoc) {
    run.skip('ingest', supplied ? 'lesson supplied' : 'teaching a topic, no document');
  } else {
    const key = cacheKey('ingest', run.source.kind, run.source.ref, await sourceStamp(input));
    if (!run.force && (await isFresh(run.dir, cacheSlot('ingest'), key, ['source.json']))) {
      doc = await readJson<SourceDoc>(path.resolve(run.dir, 'source.json'));
    }
    if (doc) {
      run.skip('ingest', 'cached');
    } else {
      doc = await run.time('ingest', async () => {
        run.bus.stage('ingest', 5, describeSource(run.source));
        const { ingest } = await loadPlanner('ingest');
        const bare = !input.filePath && !input.url ? input.topic : undefined;
        const text = input.text ?? bare;
        const result = await ingest({
          ...(text === undefined ? {} : { text }),
          ...(input.filePath === undefined ? {} : { filePath: input.filePath }),
          ...(input.url === undefined ? {} : { url: input.url }),
        });
        if (!result || typeof result !== 'object') throw new Error('ingest returned no document');
        await writeFile(path.resolve(run.dir, 'source.json'), JSON.stringify(result, null, 2));
        await markFresh(run.dir, cacheSlot('ingest'), key);
        return result;
      });
      run.bus.done('ingest');
    }
  }
  const sourceChars = doc
    ? (typeof doc.text === 'string' ? doc.text : JSON.stringify(doc)).length
    : 0;

  /* ------------------------------------------------------------- 2. lesson */

  const base: Omit<LessonResult, 'author'> = {
    projectId: run.id,
    dir: run.dir,
    problems: [],
    route,
    preset: presetShape.name,
    targetSec,
    providers: provs,
    degradations: degraded,
  };

  if (route === 'document') {
    // No lesson exists on this route, and pretending otherwise would leave a
    // stale `lesson.json` describing a video it did not produce.
    run.skip('lesson', 'via document: summarising, not teaching');
    log.warn(
      'via=document skips the lesson stage — this is the renderer fixture path and it does not teach',
    );
    return { ...base, author: 'none', doc, sourceChars, presetShape, planner };
  }

  const brief = briefFor(input);
  // The renderer, handed to the drawing author so a picture with something measurably wrong
  // with it can be shown to the model that drew it and corrected (`draw-preview.ts`). The
  // planner has no renderer and must not acquire one, so the stage that has all three
  // passes it down. Lazy in every direction: nothing loads and no browser launches unless
  // a drawing is actually found wanting.
  const drawing = openDrawPreview(metaOverrides);
  const lessonOpts: LessonStageOptions = {
    drawPreview: drawing.preview,
    ...format,
    maxSeconds: targetSec,
    ...(input.audience === undefined ? {} : { audience: input.audience }),
    ...(input.objective === undefined ? {} : { objective: input.objective }),
    ...(brief === undefined ? {} : { brief }),
    // What the drawing lanes can actually do, decided once in `providers.ts` and told to
    // the author. A model that is not told about the illustration lane asks for an `icon`
    // for every concrete object, and the icon lane never calls the generator — so a
    // configured key drew nothing at all on a keyed render.
    illustrations: provs.images.cloud,
    onProgress: run.bus.child('lesson'),
    force: run.force,
  };

  let lesson: Lesson;
  let author: LessonResult['author'] = 'supplied';
  if (supplied) {
    lesson = await run.time('lesson', async () => {
      const supplied_ =
        typeof input.lesson === 'string'
          ? await readLessonFile(path.resolve(input.lesson))
          : parseLesson(input.lesson);
      log.info(`using a supplied lesson: "${supplied_.topic}"`, {
        beats: beatCount(supplied_),
        from: typeof input.lesson === 'string' ? input.lesson : 'inline object',
      });
      return supplied_;
    });
    await saveLessonFile(run.dir, lesson);
    run.bus.done('lesson', 'supplied');
  } else {
    const lessonInput: SourceDoc | string = doc ?? input.topic!;
    const adapter = planner.resolveLessonAdapter(lessonOpts);
    author = adapter;
    const key = cacheKey(
      'lesson',
      versionOf(planner.LESSON_VERSION),
      adapter,
      provs.planner.name,
      provs.planner.model ?? '',
      typeof lessonInput === 'string' ? lessonInput : [lessonInput.title, lessonInput.text],
      {
        audience: input.audience,
        objective: input.objective,
        brief,
        preset: presetShape.name,
        aspect: presetShape.aspect,
        seconds: targetSec,
        depth: input.depth ?? 'standard',
      },
    );

    let cached: Lesson | undefined;
    if (!run.force && (await isFresh(run.dir, cacheSlot('lesson'), key, [LESSON_FILE]))) {
      cached = await readLessonFile(path.resolve(run.dir, LESSON_FILE)).catch((err: unknown) => {
        log.warn(`cached ${LESSON_FILE} is unreadable — writing a new one`, err);
        return undefined;
      });
    }
    if (cached) {
      lesson = cached;
      run.skip('lesson', 'cached');
    } else {
      lesson = await run.time('lesson', async () => {
        run.bus.stage('lesson', 4, `${adapter} lesson author · target ${targetSec}s`);
        try {
          const written = await planner.teachLesson(lessonInput, lessonOpts);
          // Validate here rather than trusting the stage: everything downstream
          // reads required fields, and a malformed lesson should fail in the stage
          // that produced it.
          return parseLesson(written);
        } finally {
          // Chromium outlives the stage that opened it unless it is told not to, and a
          // stage that fails is the case that matters.
          await drawing.close();
        }
      });
      await saveLessonFile(run.dir, lesson);
      await markFresh(run.dir, cacheSlot('lesson'), key);
      run.bus.done('lesson', `${beatCount(lesson)} beats`);
    }
  }

  const problems = critiqueLesson(lesson, { maxSeconds: targetSec });
  if (problems.length > 0) {
    log.warn(`lesson critique: ${problems.length} problem(s)`, problems.join(' | '));
  }
  log.info(`lesson: "${lesson.topic}"`, {
    objective: lesson.objective,
    beats: beatCount(lesson),
    problems: problems.length,
  });

  return {
    ...base,
    author,
    lesson,
    lessonPath: path.resolve(run.dir, LESSON_FILE),
    problems,
    doc,
    sourceChars,
    presetShape,
    planner,
  };
}

/* ----------------------------------------------------------------- the cast */

/**
 * Teach a topic. No document, no planner input beyond the topic itself.
 *
 * ```ts
 * const { videoPath } = await teach('gradient descent', { preset: 'short' });
 * ```
 */
export function teach(
  topic: string,
  opts: CastOptions & Omit<CastInput, 'topic' | 'text' | 'url' | 'filePath' | 'lesson'> = {},
): Promise<CastResult> {
  const trimmed = topic.trim();
  if (trimmed === '') throw new StageError('lesson', 'nothing to teach — pass a topic');
  const { projectId, onProgress, force, ...rest } = opts;
  return cast(
    { ...rest, topic: trimmed },
    {
      ...(projectId === undefined ? {} : { projectId }),
      ...(onProgress === undefined ? {} : { onProgress }),
      ...(force === undefined ? {} : { force }),
    },
  );
}

export async function cast(input: CastInput, opts: CastOptions = {}): Promise<CastResult> {
  const run = await openRun(input, opts);
  const design = await design_(run, input);
  const { planner, doc } = design;
  const provs = design.providers;
  const metaOverrides = resolveMetaOverrides(input.meta);

  /* --------------------------------------------------------- 3. storyboard */

  const compileOpts: CompileStageOptions = {
    ...metaOverrides,
    ...(input.preset === undefined ? {} : { preset: input.preset }),
    maxSeconds: design.targetSec,
    ...(input.title === undefined ? {} : { title: input.title }),
    onProgress: run.bus.child('storyboard'),
    force: run.force,
  };
  const boardKey = cacheKey(
    'storyboard',
    versionOf(planner.COMPILER_VERSION),
    versionOf(planner.PLANNER_VERSION),
    design.route,
    design.lesson ? lessonHash(design.lesson) : hash(doc?.title ?? '', doc?.text ?? ''),
    metaOverrides,
    { preset: design.preset, seconds: design.targetSec, title: input.title ?? '' },
    design.route === 'document' ? [provs.planner.name, provs.planner.model ?? ''] : '',
  );

  let sb: Storyboard | undefined;
  if (
    !run.force &&
    (await isFresh(run.dir, cacheSlot('storyboard'), boardKey, ['storyboard.json']))
  ) {
    try {
      sb = await loadStoryboard(run.dir);
      run.skip('storyboard', 'cached');
    } catch (err) {
      log.warn('cached storyboard.json is unreadable — rebuilding it', err);
      sb = undefined;
    }
  }
  if (!sb) {
    sb = await run.time('storyboard', async () => {
      if (design.lesson) {
        run.bus.stage('storyboard', 10, `${beatCount(design.lesson)} beats → ${design.preset}`);
        return parseStoryboard(planner.compileLesson(design.lesson, compileOpts));
      }
      // via: 'document' — the summarising fixture path.
      run.bus.stage('storyboard', 5, `document planner: ${provs.planner.name}`);
      const { plan } = await loadPlanner('storyboard');
      const planOpts: PlanOptions = {
        ...metaOverrides,
        ...(input.title === undefined ? {} : { title: input.title }),
        meta: metaOverrides,
        via: 'document',
        onProgress: run.bus.child('storyboard'),
        force: run.force,
      };
      return parseStoryboard(await plan(doc!, planOpts));
    });
    // Saved before marking fresh: the cache may only ever describe what is
    // already on disk, never what we are about to write.
    await saveStoryboard(run.dir, sb);
    await markFresh(run.dir, cacheSlot('storyboard'), boardKey);
    run.bus.done('storyboard', `${sb.scenes.length} scenes`);
  }

  // The user's flags always win over whatever the compiler chose.
  sb = applyOverrides(sb, input.title, metaOverrides);
  await saveStoryboard(run.dir, sb);

  /* -------------------------------------------------------------- 4. voice */

  const voiceKeyFor = (scene: { narration: string; hold: number }) =>
    voiceFingerprint(
      scene,
      { voice: sb!.meta.voice, language: sb!.meta.language },
      provs.voice.name,
    );

  const staleScenes = new Set<string>();
  for (const scene of sb.scenes) {
    const ready = scene.durationSec !== undefined && scene.audioPath !== undefined;
    const fresh =
      !run.force &&
      ready &&
      (await isFresh(run.dir, cacheSlot('voice', scene.id), voiceKeyFor(scene), [
        scene.audioPath!,
      ]));
    if (!fresh) staleScenes.add(scene.id);
  }

  if (staleScenes.size === 0) {
    run.skip('voice', 'cached');
  } else {
    // Drop measurements that no longer describe the audio we are about to make,
    // so a crash can never leave a duration pointing at the wrong clip.
    for (const scene of sb.scenes) {
      if (!staleScenes.has(scene.id)) continue;
      delete scene.audioPath;
      delete scene.durationSec;
      delete scene.words;
    }
    await saveStoryboard(run.dir, sb);

    sb = await run.time('voice', async () => {
      run.bus.stage('voice', 1, `${provs.voice.name} (${sb!.meta.voice}) · resolving cues`);
      const { narrate } = await loadVoice();
      const out = await narrate(sb!, run.dir, {
        onProgress: run.bus.child('voice'),
        force: run.force,
      });
      const next = parseStoryboard(out);
      const missing = next.scenes.filter((s) => !s.durationSec || !s.audioPath);
      if (missing.length > 0) {
        throw new Error(
          `no audio for scene(s) ${missing.map((s) => s.id).join(', ')} — the voice stage must set durationSec and audioPath`,
        );
      }
      return next;
    });
    await saveStoryboard(run.dir, sb);
    for (const scene of sb.scenes) {
      await markFresh(run.dir, cacheSlot('voice', scene.id), voiceKeyFor(scene));
    }
    run.bus.done('voice', `${Math.round(totalDuration(sb))}s of narration`);
  }
  const narratedChars = sb.scenes
    .filter((s) => staleScenes.has(s.id))
    .reduce((n, s) => n + s.narration.length, 0);

  /* ------------------------------------------------------------ 5. visuals */

  const assetKeyFor = (a: { kind: string; prompt?: string; seed?: number }) =>
    assetFingerprint(a, { style: sb!.meta.style, palette: sb!.meta.palette }, provs.images.name);
  const boardVisualsKey = visualsFingerprint(sb);

  const staleAssets = new Set<string>();
  for (const a of sb.assets) {
    const fresh =
      !run.force &&
      Boolean(a.svg) &&
      (await isFresh(run.dir, cacheSlot('visuals', a.id), assetKeyFor(a)));
    if (!fresh) staleAssets.add(a.id);
  }
  // Artefacts, not just a hash — see `visualsArtefacts` for what a lying cache entry
  // costs now that equations are read from the manifest rather than recomputed.
  const visualsFresh =
    !run.force &&
    staleAssets.size === 0 &&
    (await isFresh(run.dir, cacheSlot('visuals'), boardVisualsKey, visualsArtefacts(sb)));

  const assetsBefore = new Set(sb.assets.filter((a) => a.svg).map((a) => a.id));
  if (visualsFresh) {
    run.skip('visuals', 'cached');
  } else {
    for (const a of sb.assets) if (staleAssets.has(a.id)) delete a.svg;
    sb = await run.time('visuals', async () => {
      run.bus.stage('visuals', 1, `images: ${provs.images.name}`);
      const { resolveVisuals } = await loadVisuals();
      const out = await resolveVisuals(sb!, run.dir, {
        onProgress: run.bus.child('visuals'),
        force: run.force,
      });
      return parseStoryboard(out);
    });
    await saveStoryboard(run.dir, sb);
    for (const a of sb.assets) {
      await markFresh(run.dir, cacheSlot('visuals', a.id), assetKeyFor(a));
    }
    // Recomputed against the storyboard the stage returned, so a stage that
    // enriched an element cannot leave the board key describing the input.
    await markFresh(run.dir, cacheSlot('visuals'), visualsFingerprint(sb));
    run.bus.done('visuals');
  }
  const generatedAssets = sb.assets.filter(
    (a) => a.source === 'generated' && !assetsBefore.has(a.id),
  ).length;

  /* ------------------------------------------------------------- 6. render */

  const renderKey = renderFingerprint(sb);
  const existing = await findVideo(run.dir, run.previous?.videoPath);
  let videoPath: string;
  if (
    !run.force &&
    existing &&
    (await isFresh(run.dir, cacheSlot('render'), renderKey, [existing]))
  ) {
    videoPath = existing;
    run.skip('render', 'cached');
  } else {
    videoPath = await run.time('render', async () => {
      run.bus.stage('render', 0, `${sb!.meta.aspect} at ${sb!.meta.fps}fps`);
      const { render } = await loadRender();
      const out = await render(sb!, run.dir, {
        onProgress: run.bus.child('render'),
        force: run.force,
      });
      if (!out || typeof out.videoPath !== 'string' || out.videoPath === '') {
        throw new Error('render returned no videoPath');
      }
      const abs = path.isAbsolute(out.videoPath)
        ? out.videoPath
        : path.resolve(run.dir, out.videoPath);
      if (!existsSync(abs)) throw new Error(`render reported ${abs} but no file is there`);
      await markFresh(run.dir, cacheSlot('render'), renderKey);
      return abs;
    });
    run.bus.done('render');
  }

  /* ---------------------------------------------------------------- wrap up */

  // A supplied lesson never reaches the model, so a key being present must not
  // invent a bill for work nobody did.
  const costProviders =
    design.author === 'supplied'
      ? {
          ...provs,
          planner: { ...provs.planner, cloud: false, why: 'the lesson was supplied' },
        }
      : provs;
  const cost = costOf(sb, {
    providers: costProviders,
    sourceChars: design.sourceChars,
    storyboardChars: JSON.stringify(sb).length,
    ...(design.lesson ? { lessonChars: JSON.stringify(design.lesson).length } : {}),
    narratedChars,
    generatedAssets,
  });
  const now = new Date().toISOString();
  const state: PipelineState = {
    projectId: run.id,
    title: sb.title,
    videoPath: path.relative(run.dir, videoPath) || path.basename(videoPath),
    source: run.source,
    createdAt: run.previous?.createdAt ?? now,
    updatedAt: now,
    durationSec: round2(totalDuration(sb)),
    timings: run.timings,
    skipped: run.skipped,
    cost,
    providers: {
      // `lesson` is the accurate label ("who wrote it"); `planner` is kept because
      // the studio's library and older `pipeline.json` files both speak it.
      lesson:
        design.author === 'anthropic' && provs.planner.model
          ? `${provs.planner.name}/${provs.planner.model}`
          : design.author,
      planner: provs.planner.model
        ? `${provs.planner.name}/${provs.planner.model}`
        : provs.planner.name,
      voice: `${provs.voice.name}${provs.voice.model ? `/${provs.voice.model}` : ''}`,
      images: provs.images.name,
    },
    ...(design.lesson
      ? {
          lesson: {
            topic: design.lesson.topic,
            objective: design.lesson.objective,
            beats: beatCount(design.lesson),
            problems: design.problems,
          },
        }
      : {}),
  };
  await writeState(run.dir, state);
  log.info(
    `done in ${(run.bus.elapsedMs() / 1000).toFixed(1)}s`,
    fullyLocal(provs) ? 'fully local, $0.00' : `cost ~$${cost.usd.toFixed(4)}`,
  );

  return {
    ...stripDesign(design),
    videoPath,
    storyboard: sb,
    cost,
    timings: run.timings,
    skipped: run.skipped,
  };
}

/**
 * Re-run the tail of the pipeline for a saved project.
 *
 * Voice and visuals are cache-checked (so an edited scene is re-voiced and
 * nothing else is), then the video is rebuilt. This is the cheap path behind
 * `inkcast rerender` and the studio's "apply changes" button. It never touches the
 * lesson: rerendering is a drawing operation, and `inkcast lesson <id>` plus a
 * re-cast is how you change the teaching.
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

  const bus = progressBus(opts.onProgress);
  const provs = detectProviders(sb.meta.voice);
  const timings: Partial<Record<StageName, number>> = {};
  const skipped: StageName[] = ['ingest', 'lesson', 'storyboard'];
  for (const s of skipped) bus.done(s, 'unchanged');

  const force = opts.force ?? true; // "rerender" means rebuild the video.
  const time = async <T>(stage: StageName, fn: () => Promise<T>): Promise<T> => {
    const t0 = Date.now();
    const out = await inStage(stage, projectId, fn);
    timings[stage] = Date.now() - t0;
    return out;
  };

  /* voice: only scenes whose narration, silence or voice changed */
  const voiceKeyFor = (scene: { narration: string; hold: number }) =>
    voiceFingerprint(scene, { voice: sb.meta.voice, language: sb.meta.language }, provs.voice.name);
  let stale = 0;
  for (const scene of sb.scenes) {
    const ready = scene.durationSec !== undefined && scene.audioPath !== undefined;
    const fresh =
      ready &&
      (await isFresh(dir, cacheSlot('voice', scene.id), voiceKeyFor(scene), [scene.audioPath!]));
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
      await markFresh(dir, cacheSlot('voice', scene.id), voiceKeyFor(scene));
    }
    bus.done('voice');
  }

  /* visuals: whenever artwork is missing or the board's geometry moved */
  //
  // Gated on the same artefacts `cast()` gates on. This path did not name any, which
  // made it the one place that could still skip the stage against a missing manifest
  // and put raw TeX on the board where an equation belongs.
  const visualsKey = visualsFingerprint(sb);
  const missingArt = sb.assets.some((a) => !a.svg);
  if (!missingArt && (await isFresh(dir, cacheSlot('visuals'), visualsKey, visualsArtefacts(sb)))) {
    skipped.push('visuals');
    bus.done('visuals', 'cached');
  } else {
    sb = await time('visuals', async () => {
      const { resolveVisuals } = await loadVisuals();
      return parseStoryboard(await resolveVisuals(sb, dir, { onProgress: bus.child('visuals') }));
    });
    await saveStoryboard(dir, sb);
    await markFresh(dir, cacheSlot('visuals'), visualsFingerprint(sb));
    bus.done('visuals');
  }

  const renderKey = renderFingerprint(sb);
  const existing = await findVideo(dir, previous?.videoPath);
  let videoPath: string;
  if (!force && existing && (await isFresh(dir, cacheSlot('render'), renderKey, [existing]))) {
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
      await markFresh(dir, cacheSlot('render'), renderKey);
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
    ...(previous?.lesson ? { lesson: previous.lesson } : {}),
  });
  return { videoPath, storyboard: sb, cost, projectId, dir };
}

/* ------------------------------------------------------------------ helpers */

export function sourceRef(input: CastInput): SourceRef {
  if (input.lesson !== undefined) {
    return {
      kind: 'lesson',
      ref: typeof input.lesson === 'string' ? path.resolve(input.lesson) : 'inline',
    };
  }
  if (input.filePath) return { kind: 'file', ref: path.resolve(input.filePath) };
  if (input.url) return { kind: 'url', ref: input.url };
  if (typeof input.text === 'string' && input.text.trim() !== '') {
    return { kind: 'text', ref: input.text };
  }
  if (typeof input.topic === 'string' && input.topic.trim() !== '') {
    return { kind: 'topic', ref: input.topic.trim() };
  }
  throw new StageError(
    'ingest',
    'nothing to cast — pass a topic, text, filePath, url, or a lesson',
  );
}

function describeSource(s: SourceRef): string {
  if (s.kind === 'file') return path.basename(s.ref);
  if (s.kind === 'url') return s.ref;
  if (s.kind === 'topic') return `topic: ${s.ref}`;
  if (s.kind === 'lesson') return `lesson: ${path.basename(s.ref)}`;
  return `${s.ref.length} characters of text`;
}

/**
 * A topic given *alongside* a document is a focus instruction, not the material:
 * "teach me backprop from this paper" is a real request and the paper is still
 * the source of truth.
 */
export function briefFor(input: CastInput): string | undefined {
  const parts: string[] = [];
  if (input.brief?.trim()) parts.push(input.brief.trim());
  const hasDoc = Boolean(input.filePath ?? input.url ?? input.text);
  if (hasDoc && input.topic?.trim()) parts.push(`Focus on: ${input.topic.trim()}.`);
  return parts.length > 0 ? parts.join(' ') : undefined;
}

/** Cheap fingerprint of the source so an edited file re-ingests. */
async function sourceStamp(input: CastInput): Promise<string> {
  const file = input.filePath ?? (typeof input.lesson === 'string' ? input.lesson : undefined);
  if (!file) return '';
  try {
    const st = await stat(file);
    return `${st.size}:${Math.round(st.mtimeMs)}`;
  } catch (cause) {
    throw new StageError('ingest', `cannot read ${file}`, { cause });
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
