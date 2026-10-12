import { providerEnv } from '@inkcast/core';
import { textProvider } from '@inkcast/core';
/**
 * Stage 2+3 — plan. `SourceDoc` in, `Storyboard` out.
 *
 * This used to be one step that chopped a document into beats and narrated them.
 * It is now two, and the first one is the point:
 *
 *     ingest -> lesson -> storyboard
 *
 * `teachLesson` decides what to teach and what each beat should show; then
 * `compileLesson` turns that into a board. `plan()` keeps its signature so the
 * pipeline, the CLI and the studio do not have to care — but what it does inside
 * is now pedagogy first, drawing second.
 *
 * The old document→storyboard path is still reachable with `via: 'document'`. It
 * is the zero-key fixture the renderer is tested against, not a route to a
 * watchable video; `docs/LESSON-ENGINE.md` explains why that distinction matters.
 */
import type { Lesson, Storyboard } from '@inkcast/core';
import {
  hash,
  isFresh,
  loadStoryboard,
  logger,
  markFresh,
  report,
  saveStoryboard,
} from '@inkcast/core';
import { anthropicAvailable, anthropicPlan, plannerModel } from './anthropic.js';
import { COMPILER_VERSION, compileLesson } from './compile.js';
import { heuristicPlan } from './heuristic.js';
import { layoutStoryboard } from './layout.js';
import { LESSON_VERSION, resolveLessonAdapter, teachLesson } from './lesson.js';
import { lessonModel } from './lesson-anthropic.js';
import { readLessonFile } from './lesson-io.js';
import { resolvePreset } from './presets.js';
import type { PlanOptions, PlannerAdapter, SourceDoc } from './types.js';

const log = logger('planner');

/** Bump when planner output changes in a way that should invalidate caches. */
export const PLANNER_VERSION = 2;

const CACHE_KEY = 'plan';
const ARTEFACT = 'storyboard.json';

/** Which adapter a given set of options resolves to, given the environment. */
export function resolveAdapter(opts: PlanOptions = {}): Exclude<PlannerAdapter, 'auto'> {
  return textProvider(providerEnv(), opts.adapter);
}

/** Whether this plan runs the pedagogy stage. Default: yes. */
export function resolveRoute(opts: PlanOptions = {}): 'lesson' | 'document' {
  return opts.via ?? 'lesson';
}

function inputHash(doc: SourceDoc, opts: PlanOptions, adapter: string, route: string): string {
  return hash(PLANNER_VERSION, adapter, route, doc.title, doc.text, {
    lesson: typeof opts.lesson === 'string' ? opts.lesson : opts.lesson ? 'inline' : undefined,
    lessonVersion: route === 'lesson' ? LESSON_VERSION : undefined,
    compiler: route === 'lesson' ? COMPILER_VERSION : undefined,
    preset: opts.preset,
    // Only the lesson route can honour it, so only the lesson route may key on it —
    // and it must, or the same document served the other mode's cached storyboard.
    board: route === 'lesson' ? opts.board : undefined,
    aspect: opts.aspect,
    palette: opts.palette,
    style: opts.style,
    voice: opts.voice,
    language: opts.language,
    fps: opts.fps,
    maxScenes: opts.maxScenes,
    maxSeconds: opts.maxSeconds,
    wordsPerSecond: opts.wordsPerSecond,
    audience: opts.audience,
    objective: opts.objective,
    brief: opts.brief,
    model:
      adapter !== 'heuristic'
        ? route === 'lesson'
          ? lessonModel(opts)
          : plannerModel(opts)
        : undefined,
  });
}

/** A lesson supplied by the caller: an object, or a path to a `.lesson.json`. */
async function suppliedLesson(opts: PlanOptions): Promise<Lesson | undefined> {
  if (!opts.lesson) return undefined;
  if (typeof opts.lesson !== 'string') return opts.lesson;
  const lesson = await readLessonFile(opts.lesson);
  log.info(`using the hand-authored lesson at ${opts.lesson}`, { topic: lesson.topic });
  return lesson;
}

/**
 * Compile a `SourceDoc` into a `Storyboard`: a lesson, then beats, narration,
 * plots, drawn ink, regions, cues and camera. The result is validated against the
 * IR before it is returned, so every later stage can trust its shape.
 */
export async function plan(doc: SourceDoc, opts: PlanOptions = {}): Promise<Storyboard> {
  const route = resolveRoute(opts);
  const adapter = route === 'lesson' ? resolveLessonAdapter(opts) : resolveAdapter(opts);
  const key = inputHash(doc, opts, adapter, route);

  if (opts.dir && !opts.force) {
    if (await isFresh(opts.dir, CACHE_KEY, key, [ARTEFACT])) {
      const cached = await loadStoryboard(opts.dir);
      log.info(`reusing cached plan (${cached.scenes.length} scenes)`);
      report(opts, { stage: 'plan', pct: 100, note: 'cached' });
      return cached;
    }
  }

  let sb: Storyboard | undefined;

  if (route === 'lesson') {
    const preset = resolvePreset(opts);
    report(opts, { stage: 'plan', pct: 2, note: `${adapter} lesson → ${preset.name}` });
    const lesson = (await suppliedLesson(opts)) ?? (await teachLesson(doc, opts));
    sb = compileLesson(lesson, {
      ...opts,
      ...(opts.title === undefined ? {} : { title: opts.title }),
    });
  } else {
    report(opts, { stage: 'plan', pct: 2, note: `${adapter} document planner` });
    if (adapter !== 'heuristic') {
      sb = await anthropicPlan(doc, opts);
      if (sb && opts.relayout !== false) {
        // The model chooses the content; the layout engine guarantees the geometry.
        sb = layoutStoryboard(sb, { aspect: sb.meta.aspect });
        log.debug('re-laid out the model storyboard for collision-free placement');
      }
      if (!sb) log.warn('falling back to the heuristic planner');
    }
    if (!sb) sb = heuristicPlan(doc, opts);
  }

  if (opts.dir) {
    await saveStoryboard(opts.dir, sb);
    await markFresh(opts.dir, CACHE_KEY, key);
  }

  log.info(`plan ready: "${sb.title}"`, {
    route,
    scenes: sb.scenes.length,
    assets: sb.assets.length,
    canvas: `${sb.canvas.w}x${sb.canvas.h}`,
  });
  return sb;
}
