/**
 * The lesson as a project artefact.
 *
 * `lesson.json` sits next to `storyboard.json` in the project directory and is
 * the thing a user should edit when the video explains the wrong thing — editing
 * the storyboard only changes the drawing. So it has to be: written on every run,
 * readable without loading the planner, validated against the schema in
 * `@inkcast/core`, and hashed into the storyboard stage's cache key so that
 * hand-editing it recompiles the board on the next `cast`.
 *
 * Nothing here loads `@inkcast/planner`. Printing a lesson, or rendering a
 * hand-authored one, must work on a machine where the planner's optional
 * dependencies were never installed.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Lesson as LessonSchema, hash, lessonBeats, openProject } from '@inkcast/core';
import type { Lesson } from '@inkcast/core';
import type { PresetShape } from './stages.js';

export const LESSON_FILE = 'lesson.json';

/** Validate unknown JSON as a Lesson. Throws zod's issue list on failure. */
export function parseLesson(input: unknown): Lesson {
  return LessonSchema.parse(input);
}

/** Read a lesson from an explicit path — `examples/lessons/*.lesson.json`. */
export async function readLessonFile(file: string): Promise<Lesson> {
  const raw = await readFile(file, 'utf8');
  try {
    return parseLesson(JSON.parse(raw) as unknown);
  } catch (cause) {
    throw new Error(`${file} is not a valid lesson: ${(cause as Error).message}`, { cause });
  }
}

export async function saveLessonFile(dir: string, lesson: Lesson): Promise<string> {
  const file = path.resolve(dir, LESSON_FILE);
  await writeFile(file, `${JSON.stringify(lesson, null, 2)}\n`);
  return file;
}

export async function loadLessonFrom(dir: string): Promise<Lesson> {
  return readLessonFile(path.resolve(dir, LESSON_FILE));
}

export type ProjectLesson = {
  projectId: string;
  dir: string;
  /** Absolute path to `lesson.json`. */
  file: string;
  lesson: Lesson;
};

/** The lesson a saved project was built from. Throws if it has none. */
export async function projectLesson(projectId: string): Promise<ProjectLesson> {
  const project = await openProject(projectId);
  const file = path.resolve(project.dir, LESSON_FILE);
  const lesson = await readLessonFile(file).catch((cause: unknown) => {
    throw new Error(
      `project "${projectId}" has no readable ${LESSON_FILE} — it may predate the lesson stage, ` +
        `or have been cast with --via document. Re-run \`inkcast cast\` to write one.`,
      { cause },
    );
  });
  return { projectId, dir: project.dir, file, lesson };
}

/** Stable hash of a lesson's teaching content, for the storyboard cache key. */
export function lessonHash(lesson: Lesson): string {
  return hash(lesson);
}

/** Beat count, including hook, anchor, worked example, misconception and recap. */
export function beatCount(lesson: Lesson): number {
  return lessonBeats(lesson).length;
}

/* ------------------------------------------------------------------- depth */

/**
 * How thorough the lesson should be.
 *
 * Depth is not "more words about the same thing" — the lesson author and the
 * preset both read the runtime target, so a deeper lesson gets more *steps*, each
 * still one idea, and a quick one keeps the spine (hook, anchor, one or two
 * steps, recap) and drops the rest. It is expressed as a multiplier on the
 * preset's own target so `--depth deep --short` still produces a short.
 */
export const DEPTHS = ['quick', 'standard', 'deep'] as const;
export type Depth = (typeof DEPTHS)[number];

const DEPTH_SCALE: Record<Depth, number> = { quick: 0.6, standard: 1, deep: 1.8 };

/** Longest and shortest runtime we will aim for, in seconds. */
const MIN_SECONDS = 20;
const MAX_SECONDS = 300;

/**
 * The runtime target for a run, or `undefined` to leave the preset's own alone.
 *
 * An explicit `maxSeconds` always wins: it is the only way to say "exactly 45
 * seconds because the platform cuts me off there".
 */
export function targetSeconds(
  preset: PresetShape,
  opts: { depth?: Depth; maxSeconds?: number } = {},
): number | undefined {
  if (opts.maxSeconds && Number.isFinite(opts.maxSeconds)) {
    return clamp(Math.round(opts.maxSeconds), MIN_SECONDS, MAX_SECONDS);
  }
  const depth = opts.depth ?? 'standard';
  if (depth === 'standard') return undefined;
  return clamp(Math.round(preset.maxSeconds * DEPTH_SCALE[depth]), MIN_SECONDS, MAX_SECONDS);
}

export function isDepth(value: unknown): value is Depth {
  return typeof value === 'string' && (DEPTHS as readonly string[]).includes(value);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
