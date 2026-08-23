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
  type BoardMode,
  type GateMode,
  type Lesson,
  type OnProgress,
  type Scene,
  type Storyboard,
  type StoryboardMeta,
} from '@inkcast/core';
import { costOf, type CostReport } from './cost.js';
import { degradations, formatDegradation, type Degradation } from './degrade.js';
import { openDrawPreview } from './draw-preview.js';
import { openDrawUnderlay } from './draw-underlay.js';
import { inStage, StageError } from './errors.js';
import {
  assetFingerprint,
  cacheKey,
  cacheSlot,
  renderFingerprint,
  storyboardKey,
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
import {
  billedVoiceChoice,
  fullyLocal,
  providers as detectProviders,
  resolvedVoiceChoice,
  voiceEngine,
  type Providers,
} from './providers.js';
import {
  findVideo,
  readState,
  writeState,
  type PipelineState,
  type SourceRef,
  type VoiceRecord,
} from './state.js';
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
  type ResolvedVoice,
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
  /**
   * What the board does between beats: `accumulate` (the default) or `wipe`.
   *
   * Deliberately not folded into `meta`, which every stage reads and `applyOverrides`
   * stamps onto the finished storyboard: `meta.board` there would announce a wiping
   * board on ink the compiler never marked non-persistent — a mode in the file that
   * nothing in the film performs. It is a request to the compiler, so it travels as
   * one, and it only reaches a compiler on `via: 'lesson'`.
   */
  board?: BoardMode;
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
  /**
   * Quality-gate posture, threaded into every stage. **Defaults to `strict`**:
   * a pipeline run must not ship a defect it detected — a codepoint the
   * handwriting font cannot draw, an equation degrading to TeX-as-handwriting,
   * a missing font, a missed cue on a beat's dominant visual all stop the run
   * before the encode, naming the defect. `degrade` is the explicit escape
   * (CLI: `--degrade`): today's log-and-continue behaviour, with each defect
   * recorded instead of blocking. See `GateMode` in `@inkcast/core`.
   */
  gates?: GateMode;
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
  /**
   * Which voice actually spoke, and what it was billed for.
   *
   * `providers.voice` above is the environment's *intention*, decided before the run.
   * This is what happened, including a mid-run fallback and its reason — the two
   * differ exactly when someone is about to be told they paid for something free.
   */
  voice: ResolvedVoice;
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
  /** Resolved gate posture for every stage this run drives. See `CastOptions.gates`. */
  gates: GateMode;
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
    gates: opts.gates ?? 'strict',
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
  // The other half of the drawing lane's seam: an intent that names a real object gets a
  // generated picture of it to compose its marks on top of (`draw-underlay.ts`). Same
  // laziness — no key, no vectoriser or no Chromium and the beat is drawn in marks alone.
  const underlays = openDrawUnderlay(run.dir);
  const lessonOpts: LessonStageOptions = {
    drawPreview: drawing.preview,
    drawUnderlay: underlays.underlay,
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
          // stage that fails is the case that matters. Both browsers, and neither may
          // stop the other being closed.
          await Promise.allSettled([drawing.close(), underlays.close()]);
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
 * What the caller is asking the compiler for, without the run's own machinery.
 *
 * Split out of `cast()` and exported so it can be handed to the real `compileLesson`
 * in a test. The defect this closes was never in the compiler — `board: 'wipe'`
 * worked from the day it landed and nothing in the product could ask for it — and an
 * option a stage quietly fails to pass on is invisible to every test that exercises
 * the two ends separately. This is the join, so this is what gets asserted.
 *
 * `onProgress` and `force` belong to the run rather than to the request, so they are
 * added at the call site.
 */
export function compileRequest(
  input: Pick<CastInput, 'preset' | 'title' | 'board' | 'meta'>,
  targetSec: number,
): CompileStageOptions {
  return {
    ...resolveMetaOverrides(input.meta),
    ...(input.preset === undefined ? {} : { preset: input.preset }),
    maxSeconds: targetSec,
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.board === undefined ? {} : { board: input.board }),
  };
}

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
  const { projectId, onProgress, force, gates, ...rest } = opts;
  return cast(
    { ...rest, topic: trimmed },
    {
      ...(projectId === undefined ? {} : { projectId }),
      ...(onProgress === undefined ? {} : { onProgress }),
      ...(force === undefined ? {} : { force }),
      ...(gates === undefined ? {} : { gates }),
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

  // The mode is asked for on the one route that has a compiler in it. Said out loud
  // rather than dropped: a flag that changes nothing and reports nothing is how a
  // capability comes to be shipped with no way to reach it.
  if (input.board !== undefined && design.route === 'document') {
    log.warn(
      `board: '${input.board}' was ignored — the document route summarises instead of ` +
        'compiling a lesson, and its planners compose their own boards',
      'cast the same source without `via: document` to get the mode you asked for',
    );
  }
  const compileOpts: CompileStageOptions = {
    ...compileRequest(input, design.targetSec),
    onProgress: run.bus.child('storyboard'),
    force: run.force,
  };
  const boardKey = storyboardKey({
    compiler: versionOf(planner.COMPILER_VERSION),
    planner: versionOf(planner.PLANNER_VERSION),
    route: design.route,
    source: design.lesson ? lessonHash(design.lesson) : hash(doc?.title ?? '', doc?.text ?? ''),
    meta: metaOverrides,
    preset: design.preset,
    seconds: design.targetSec,
    title: input.title ?? '',
    // Keyed on the route that honours it, exactly as `plan()` keys its own cache: a
    // mode the storyboard was not compiled with must not divide the cache, and a mode
    // it was must never share a key with the mode it was not.
    ...(design.route === 'lesson' && compileOpts.board !== undefined
      ? { board: compileOpts.board }
      : {}),
    ...(design.route === 'document'
      ? { documentPlanner: [provs.planner.name, provs.planner.model ?? ''] as const }
      : {}),
  });

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

  const staleScenes = await staleVoiceScenes(run.dir, sb, provs.voice.name, {
    force: run.force,
  });

  /** What the voice stage reported it actually did. Undefined when it did not run. */
  let resolvedVoice: ResolvedVoice | undefined;

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
      const { storyboard: out, voice } = await narrate(sb!, run.dir, {
        onProgress: run.bus.child('voice'),
        force: run.force,
        gates: run.gates,
      });
      resolvedVoice = voice;
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
    await markVoiceFresh(run.dir, sb, resolvedVoice, provs.voice.name);
    run.bus.done('voice', `${Math.round(totalDuration(sb))}s of narration`);
  }

  const voiceRecord = voiceRecordOf(resolvedVoice, run.previous?.voice, provs.voice.name, {
    voiceId: sb.meta.voice,
  });
  const resolvedChoice = {
    provider: voiceRecord.provider,
    ...(voiceRecord.model ? { model: voiceRecord.model } : {}),
    voice: voiceRecord.voiceId,
  };
  const voiceChoice = resolvedVoiceChoice(resolvedChoice, provs.voice);
  // Measured inside the stage, per provider, and never inferred from the pipeline's own
  // stale set: the two caches key on different material, so a scene can be stale here
  // and fresh there — and counting its narration would bill for audio nobody made.
  const narratedChars = resolvedVoice?.charsByProvider.elevenlabs ?? 0;
  /**
   * The engine the *paid* provider was running, which is the only one the bill may use.
   *
   * `resolvedVoice.model` names the provider that finished, and after a demotion that is
   * Kokoro's engine — no price at all. Leaving it unnamed is not free either: an unknown
   * model is billed at the full credit rate, so a mixed flash run was charged double.
   */
  const billedEngine = resolvedVoice?.modelByProvider.elevenlabs;

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
        gates: run.gates,
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
  // Defects the renderer detected and carried through under `degrade`. On a cached
  // render they are inherited, not cleared: unlike a voice demotion (an event of one
  // run), these describe the artifact on disk, and the artifact did not change.
  let renderProblems: string[] | undefined = run.previous?.render?.problems;
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
        gates: run.gates,
      });
      if (!out || typeof out.videoPath !== 'string' || out.videoPath === '') {
        throw new Error('render returned no videoPath');
      }
      renderProblems = out.problems;
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

  // Both halves of the same rule: a stage is billed for what it did, not for which
  // key was set. A supplied lesson never reaches the model, and a run that fell back
  // to the free voice is billed nothing at all — see `resolvedVoiceChoice`.
  const costProviders = {
    ...provs,
    voice: billedVoiceChoice(resolvedChoice, narratedChars, provs.voice, billedEngine),
    ...(design.author === 'supplied'
      ? { planner: { ...provs.planner, cloud: false, why: 'the lesson was supplied' } }
      : {}),
  };
  const cost = costOf(sb, {
    providers: costProviders,
    sourceChars: design.sourceChars,
    storyboardChars: JSON.stringify(sb).length,
    ...(design.lesson ? { lessonChars: JSON.stringify(design.lesson).length } : {}),
    narratedChars,
    generatedAssets,
    /*
     * Did the lesson stage actually call a model on *this* run? Only the caller can
     * answer that, which is why `costOf` takes it rather than inferring it.
     *
     * The half of the phantom-cost bug that `authoredChars > 0` cannot reach. When the
     * lesson is served from cache at the top of this file (`run.skip('lesson',
     * 'cached')`), `design.author` stays `'anthropic'` and `design.lesson` is the full
     * cached lesson, so the line above hands `costOf` nine thousand tokens' worth of
     * real characters — a defensive floor against *zero* characters is no help against
     * text that genuinely exists. That is `projects/cardiac`: $0.2567 billed to a stage
     * its own `skipped` array names, 41% of that project's recorded $0.627, and the
     * reason a user who re-rendered a film watched the price go up.
     *
     * `costProviders` above does not cover it either — its `planner` override fires only
     * for `author === 'supplied'`, and a cached Anthropic lesson is not that.
     *
     * Both conditions, not just the skip: `design.author` also covers `'supplied'` and
     * `'none'`, where no model ran and there was never a cache entry to skip.
     */
    lessonAuthored: design.author === 'anthropic' && !run.skipped.includes('lesson'),
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
    gates: run.gates,
    ...(renderProblems && renderProblems.length > 0
      ? { render: { problems: renderProblems } }
      : {}),
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
      // The provider that spoke and the engine it spoke with — not the key that
      // happened to be set. See `voiceRecord` above and `state.ts`'s `VoiceRecord`.
      voice: `${voiceChoice.name}${voiceChoice.model ? `/${voiceChoice.model}` : ''}`,
      images: provs.images.name,
    },
    voice: voiceRecord,
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
    voice: resolvedVoice ?? cachedVoice(voiceRecord),
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
  const gates: GateMode = opts.gates ?? 'strict';
  const time = async <T>(stage: StageName, fn: () => Promise<T>): Promise<T> => {
    const t0 = Date.now();
    const out = await inStage(stage, projectId, fn);
    timings[stage] = Date.now() - t0;
    return out;
  };

  /* voice: only scenes whose narration, silence, voice or engine changed */
  const stale = await staleVoiceScenes(dir, sb, provs.voice.name);
  for (const scene of sb.scenes) {
    if (!stale.has(scene.id)) continue;
    delete scene.audioPath;
    delete scene.durationSec;
    delete scene.words;
  }
  let resolvedVoice: ResolvedVoice | undefined;
  if (stale.size === 0) {
    skipped.push('voice');
    bus.done('voice', 'cached');
  } else {
    await saveStoryboard(dir, sb);
    sb = await time('voice', async () => {
      const { narrate } = await loadVoice();
      const { storyboard: out, voice } = await narrate(sb, dir, {
        onProgress: bus.child('voice'),
        gates,
      });
      resolvedVoice = voice;
      return parseStoryboard(out);
    });
    await saveStoryboard(dir, sb);
    await markVoiceFresh(dir, sb, resolvedVoice, provs.voice.name);
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
      return parseStoryboard(
        await resolveVisuals(sb, dir, { onProgress: bus.child('visuals'), gates }),
      );
    });
    await saveStoryboard(dir, sb);
    await markFresh(dir, cacheSlot('visuals'), visualsFingerprint(sb));
    bus.done('visuals');
  }

  const renderKey = renderFingerprint(sb);
  const existing = await findVideo(dir, previous?.videoPath);
  let videoPath: string;
  // Inherited on a cached render — these describe the artifact on disk, not one run.
  let renderProblems: string[] | undefined = previous?.render?.problems;
  if (!force && existing && (await isFresh(dir, cacheSlot('render'), renderKey, [existing]))) {
    videoPath = existing;
    skipped.push('render');
    bus.done('render', 'cached');
  } else {
    videoPath = await time('render', async () => {
      const { render } = await loadRender();
      const out = await render(sb, dir, { onProgress: bus.child('render'), force: true, gates });
      if (!out || typeof out.videoPath !== 'string' || out.videoPath === '') {
        throw new Error('render returned no videoPath');
      }
      renderProblems = out.problems;
      const abs = path.isAbsolute(out.videoPath) ? out.videoPath : path.resolve(dir, out.videoPath);
      if (!existsSync(abs)) throw new Error(`render reported ${abs} but no file is there`);
      await markFresh(dir, cacheSlot('render'), renderKey);
      return abs;
    });
    bus.done('render');
  }

  // Re-voicing goes through this path, so the correction has to live here too: with
  // only `cast()` fixed, the one command the voice work is verified with would keep
  // writing the record it exists to correct.
  const voiceRecord = voiceRecordOf(resolvedVoice, previous?.voice, provs.voice.name, {
    voiceId: sb.meta.voice,
  });
  const resolvedChoice = {
    provider: voiceRecord.provider,
    ...(voiceRecord.model ? { model: voiceRecord.model } : {}),
    voice: voiceRecord.voiceId,
  };
  const voiceChoice = resolvedVoiceChoice(resolvedChoice, provs.voice);
  const narratedChars = resolvedVoice?.charsByProvider.elevenlabs ?? 0;
  const cost = costOf(sb, {
    providers: {
      ...provs,
      voice: billedVoiceChoice(
        resolvedChoice,
        narratedChars,
        provs.voice,
        resolvedVoice?.modelByProvider.elevenlabs,
      ),
    },
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
    gates,
    ...(renderProblems && renderProblems.length > 0
      ? { render: { problems: renderProblems } }
      : {}),
    // The inherited record for the stages this path never re-runs, with the voice line
    // recomputed — it copied the whole block verbatim, so a re-voice could change the
    // provider and the file would go on naming the old one.
    providers: {
      ...(previous?.providers ?? {}),
      voice: `${voiceChoice.name}${voiceChoice.model ? `/${voiceChoice.model}` : ''}`,
    },
    voice: voiceRecord,
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

/**
 * The stage's per-provider tally as a plain record.
 *
 * `charsByProvider` is partial — a provider that never spoke has no entry, not a zero
 * — and `pipeline.json` should carry exactly the providers that did.
 */
function charsSpoken(by: Partial<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, n] of Object.entries(by)) if (typeof n === 'number') out[id] = n;
  return out;
}

/**
 * What `pipeline.json` records about the voice, from what the stage reported.
 *
 * One function for both entry points because they used to build this block separately,
 * and `rerender()` is the path a re-voice actually takes — a correction that landed in
 * `cast()` alone would have been undone by the command it is verified with.
 */
export function voiceRecordOf(
  resolved: ResolvedVoice | undefined,
  previous: VoiceRecord | undefined,
  requested: string,
  fallback: { voiceId: string },
): VoiceRecord {
  if (resolved) {
    return {
      provider: resolved.provider,
      ...(resolved.model ? { model: resolved.model } : {}),
      voiceId: resolved.voice,
      requested,
      observed: resolved.spoke,
      chars: charsSpoken(resolved.charsByProvider),
      problems: resolved.problems,
    };
  }
  return {
    // Inherited, because the audio on disk is the audio the previous run described:
    // re-deriving the provider from the environment is exactly how a project voiced by
    // the free engine came to be recorded, and billed, as a paid one.
    ...(previous ?? {
      provider: requested,
      voiceId: fallback.voiceId,
      requested,
      problems: [],
    }),
    // Except these three, which are about *this* run, and this run synthesised nothing.
    // `problems` most of all: a demotion is an event, not a property. Carrying it
    // forward made the CLI print "voice fell back to kokoro (elevenlabs:
    // quota_exceeded)" on every later cached run of a project that was no longer in
    // that state. The durable half of the fact survives as `provider` beside
    // `requested`.
    observed: false,
    chars: {},
    problems: [],
  };
}

/**
 * The `ResolvedVoice` shape for a run where the stage never ran.
 *
 * `CastResult.voice` is what the CLI prints from, and a cached run still has to be able
 * to say who spoke — it just cannot claim anybody spoke *this time*, which is what the
 * empty tallies and `spoke: false` are for.
 */
function cachedVoice(record: VoiceRecord): ResolvedVoice {
  return {
    provider: record.provider,
    label: record.provider,
    voice: record.voiceId,
    ...(record.model ? { model: record.model } : {}),
    charsByProvider: {},
    modelByProvider: {},
    spoke: false,
    problems: record.problems,
  };
}

/**
 * The pipeline's cache key for one scene's audio, under a given provider.
 *
 * Separate from `voiceFingerprint` so that the engine is resolved in exactly one place:
 * a key written with the engine and read without it is a cache that never hits.
 */
function voiceSceneKey(
  sb: Storyboard,
  scene: Pick<Scene, 'narration' | 'hold'>,
  provider: string,
  env?: NodeJS.ProcessEnv,
): string {
  return voiceFingerprint(
    scene,
    { voice: sb.meta.voice, language: sb.meta.language },
    provider,
    voiceEngine(provider, env),
  );
}

/**
 * Record this project's audio as cached, under the provider that **spoke**.
 *
 * Not under the one that was asked for, which is what both call sites used to write and
 * is what made a mid-run demotion permanent: the free take was filed under the paid
 * provider's fingerprint, so topping the balance back up and re-running found every
 * scene fresh and the kokoro audio stayed in the film forever — `--force` was the only
 * way out. Filed this way, the next run recomputes the requested provider's key, does
 * not find it, and re-records, which is exactly what a fallback should cost. The
 * equality with `staleVoiceScenes` is the whole mechanism, so they live together.
 */
export async function markVoiceFresh(
  dir: string,
  sb: Storyboard,
  resolved: ResolvedVoice | undefined,
  requested: string,
  env?: NodeJS.ProcessEnv,
): Promise<void> {
  const provider = resolved?.provider ?? requested;
  for (const scene of sb.scenes) {
    await markFresh(dir, cacheSlot('voice', scene.id), voiceSceneKey(sb, scene, provider, env));
  }
}

/**
 * The scenes the voice stage has to re-record — the seam this phase exists to close.
 *
 * The stage keys each clip on its own inputs, the adapter's delivery signature among
 * them; this key decides whether the stage is called at all. When the two disagree
 * about what changes the audio, the stage is skipped and the change simply does not
 * happen: with no engine on this side, `ELEVENLABS_MODEL_ID=eleven_multilingual_v2` on
 * a keyed project left every scene fresh, `cast()` reported `voice cached`, `narrate`
 * was never called, and the film kept its flash audio with nothing said. Exported so a
 * test can cross the seam rather than check one side of it: voice's own "the ElevenLabs
 * engine is flash, and its id is inside the clip key" asserts the delivery signature
 * carries the model, and passed throughout. See `test/voice-key.test.ts`.
 */
export async function staleVoiceScenes(
  dir: string,
  sb: Storyboard,
  provider: string,
  opts: { force?: boolean; env?: NodeJS.ProcessEnv } = {},
): Promise<Set<string>> {
  const stale = new Set<string>();
  for (const scene of sb.scenes) {
    const ready = scene.durationSec !== undefined && scene.audioPath !== undefined;
    const fresh =
      !opts.force &&
      ready &&
      (await isFresh(
        dir,
        cacheSlot('voice', scene.id),
        voiceSceneKey(sb, scene, provider, opts.env),
        [scene.audioPath!],
      ));
    if (!fresh) stale.add(scene.id);
  }
  return stale;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
