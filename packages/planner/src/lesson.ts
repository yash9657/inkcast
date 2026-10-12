import { providerEnv } from '@inkcast/core';
import { textProvider, FIREWORKS_GENERATION_POLICY } from '@inkcast/core';
/**
 * Stage 2 — lesson. Document (or a bare topic) in, `Lesson` out.
 *
 *     ingest -> lesson -> storyboard -> voice -> visuals -> render
 *
 * This stage exists because the MVP did not have it. `plan()` split a document
 * into beats and read them aloud, which is summarising; teaching is a different
 * algorithm and it has to happen *before* anything is drawn, or the drawing has
 * nothing to be about.
 *
 * Two authors, one contract. Claude is the primary path and the product's quality
 * ceiling; the derived author is the honest zero-key fallback, and says so — to the log,
 * and through `onAuthor` to whoever is going to print a provider name or a bill.
 * Either way the result is validated against the Lesson schema and put through
 * `critiqueLesson`, so a weak plan is caught before it costs a render.
 */
import type { Lesson } from '@inkcast/core';
import { hash, isFresh, logger, markFresh, noteProblem, report } from '@inkcast/core';
import { anthropicAvailable } from './anthropic.js';
import { deriveLesson } from './lesson-derive.js';
import { anthropicLesson, lessonModel } from './lesson-anthropic.js';
import { LESSON_FILE, loadLesson, saveLesson } from './lesson-io.js';
import { critiqueFor, lessonSeconds, resolvePreset } from './presets.js';
import type { LessonInput, LessonOptions, PlannerAdapter } from './types.js';

const log = logger('planner:lesson');

/** Bump when lesson output changes in a way that should invalidate caches. */
export const LESSON_VERSION = 3;

const CACHE_KEY = 'lesson';

/** Which lesson author a given set of options resolves to, in this environment. */
export function resolveLessonAdapter(opts: LessonOptions = {}): Exclude<PlannerAdapter, 'auto'> {
  return textProvider(providerEnv(), opts.adapter);
}

function inputHash(input: LessonInput, opts: LessonOptions, adapter: string): string {
  const doc = typeof input === 'string' ? { title: input, text: input } : input;
  return hash(LESSON_VERSION, adapter, doc.title, doc.text, {
    fireworksReasoning: providerEnv().INKCAST_FIREWORKS_REASONING ?? 'bounded-default',
    fireworksOutputPolicy: FIREWORKS_GENERATION_POLICY,
    language: opts.language,
    style: opts.style,
    drawModel: opts.drawModel,
    audience: opts.audience,
    objective: opts.objective,
    brief: opts.brief,
    preset: opts.preset,
    aspect: opts.aspect,
    maxSeconds: opts.maxSeconds,
    wordsPerSecond: opts.wordsPerSecond,
    model: adapter !== 'heuristic' ? lessonModel(opts) : undefined,
  });
}

/**
 * Design the lesson.
 *
 * `input` is either a `SourceDoc` from `ingest()` or a bare topic string, because
 * "teach me gradient descent" is a legitimate input and should not require a
 * document to exist first.
 */
export async function teachLesson(input: LessonInput, opts: LessonOptions = {}): Promise<Lesson> {
  const preset = resolvePreset(opts);
  const adapter = resolveLessonAdapter(opts);
  const key = inputHash(input, opts, adapter);

  if (opts.dir && !opts.force) {
    if (await isFresh(opts.dir, CACHE_KEY, key, [LESSON_FILE])) {
      try {
        const cached = await loadLesson(opts.dir);
        log.info(`reusing cached lesson: "${cached.topic}"`);
        report(opts, { stage: 'lesson', pct: 100, note: 'cached' });
        return cached;
      } catch (err) {
        log.warn('cached lesson.json is unreadable — writing a new one', err as Error);
      }
    }
  }

  report(opts, { stage: 'lesson', pct: 5, note: `${adapter} lesson author` });

  let lesson: Lesson | undefined;
  if (adapter !== 'heuristic') {
    lesson = await anthropicLesson(input, opts, preset.maxSeconds);
    if (!lesson) {
      log.warn('the model did not produce a usable lesson — deriving one instead');
      noteProblem(
        opts,
        'lesson-author: cloud generation failed; this lesson is a local fallback, not a cloud-authored explanation',
      );
    }
  }
  // The fallback that used to be invisible from outside. `adapter` above is what the
  // environment resolved to; this is what wrote the lesson, and on a keyless — or, more
  // often, a creditless — run they are different. See `LessonOptions.onAuthor`.
  const author: Exclude<PlannerAdapter, 'auto'> = lesson ? adapter : 'heuristic';
  if (!lesson) lesson = deriveLesson(input, opts, preset);
  opts.onAuthor?.(author);

  const problems = critiqueFor(lesson, preset);
  if (problems.length) {
    log.warn(`lesson critique: ${problems.length} problem(s)`, problems.join(' | '));
  }
  log.info(`lesson ready: "${lesson.topic}"`, {
    objective: lesson.objective,
    steps: lesson.steps.length,
    seconds: Math.round(lessonSeconds(lesson, preset.wordsPerSecond)),
    problems: problems.length,
  });

  if (opts.dir) {
    await saveLesson(opts.dir, lesson);
    await markFresh(opts.dir, CACHE_KEY, key);
  }
  report(opts, { stage: 'lesson', pct: 100, note: `${3 + lesson.steps.length} beats` });
  return lesson;
}
