/**
 * Reading and writing lessons.
 *
 * A lesson is the editable artefact of the pipeline: it is what a user should
 * revise when the video explains the wrong thing, because editing the storyboard
 * only changes the drawing. It lives next to `storyboard.json` in the project
 * directory, and can also be authored by hand — `examples/lessons/*.lesson.json`
 * are hand-written lessons that render with no API key at all.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Lesson } from '@inkcast/core';
import { Lesson as LessonSchema } from '@inkcast/core';

export const LESSON_FILE = 'lesson.json';

/** Validate unknown JSON as a Lesson. Throws with zod's issue list on failure. */
export function parseLesson(input: unknown): Lesson {
  return LessonSchema.parse(input);
}

export async function saveLesson(dir: string, lesson: Lesson): Promise<string> {
  const file = path.resolve(dir, LESSON_FILE);
  await writeFile(file, `${JSON.stringify(lesson, null, 2)}\n`);
  return file;
}

export async function loadLesson(dir: string): Promise<Lesson> {
  return readLessonFile(path.resolve(dir, LESSON_FILE));
}

/** Read a lesson from an explicit path, e.g. a hand-authored example. */
export async function readLessonFile(file: string): Promise<Lesson> {
  const raw = await readFile(file, 'utf8');
  try {
    return parseLesson(JSON.parse(raw));
  } catch (err) {
    throw new Error(`${file} is not a valid Lesson: ${(err as Error).message}`);
  }
}
