import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DEPTHS,
  beatCount,
  isDepth,
  lessonHash,
  parseLesson,
  readLessonFile,
  saveLessonFile,
  targetSeconds,
} from '../src/lesson.js';
import type { PresetShape } from '../src/stages.js';
import { sampleLesson } from './helpers.js';

const standard: PresetShape = {
  name: 'standard',
  aspect: '16:9',
  maxSeconds: 120,
  wordsPerSecond: 2.5,
  vertical: false,
  maxBeats: 14,
};
const short: PresetShape = {
  name: 'short',
  aspect: '9:16',
  maxSeconds: 58,
  wordsPerSecond: 2.5,
  vertical: true,
  maxBeats: 8,
};

test('depth scales the preset target rather than replacing it', () => {
  assert.equal(targetSeconds(standard, { depth: 'standard' }), undefined);
  assert.equal(targetSeconds(standard, { depth: 'quick' }), 72);
  assert.equal(targetSeconds(standard, { depth: 'deep' }), 216);
  // A deep short is still a short: it scales the vertical target, not the landscape one.
  assert.ok(targetSeconds(short, { depth: 'deep' })! < targetSeconds(standard, { depth: 'deep' })!);
  assert.equal(targetSeconds(short, { depth: 'quick' }), 35);
});

test('an explicit runtime always wins, and is clamped to something renderable', () => {
  assert.equal(targetSeconds(standard, { depth: 'deep', maxSeconds: 45 }), 45);
  assert.equal(targetSeconds(standard, { maxSeconds: 2 }), 20);
  assert.equal(targetSeconds(standard, { maxSeconds: 99999 }), 300);
});

test('depth names are validated, not trusted', () => {
  for (const d of DEPTHS) assert.ok(isDepth(d));
  assert.equal(isDepth('thorough'), false);
  assert.equal(isDepth(undefined), false);
});

test('a hand-authored lesson round-trips through the schema and the disk', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'inkcast-lesson-'));
  const lesson = parseLesson(sampleLesson());
  assert.equal(lesson.topic, 'Gradient descent');
  // hook + anchor + 2 steps + worked + misconception + recap
  assert.equal(beatCount(lesson), 7);

  const file = await saveLessonFile(dir, lesson);
  assert.equal(path.basename(file), 'lesson.json');
  const again = await readLessonFile(file);
  assert.deepEqual(again, lesson);
  assert.equal(lessonHash(again), lessonHash(lesson));

  // Editing it by hand must change the hash, or the board would never recompile.
  const edited = { ...lesson, recap: { ...lesson.recap, narration: 'Different ending.' } };
  assert.notEqual(lessonHash(edited), lessonHash(lesson));
});

test('an invalid lesson file names the file and the reason', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'inkcast-lesson-'));
  const file = path.join(dir, 'broken.lesson.json');
  await writeFile(file, JSON.stringify({ version: 1, topic: 'Nothing else' }));
  await assert.rejects(readLessonFile(file), (err: Error) => {
    assert.ok(err.message.includes(file));
    assert.ok(/objective|hook|recap/.test(err.message));
    return true;
  });
});

test('saved lessons are human-editable: indented, newline-terminated JSON', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'inkcast-lesson-'));
  const file = await saveLessonFile(dir, parseLesson(sampleLesson()));
  const raw = await readFile(file, 'utf8');
  assert.ok(raw.endsWith('\n'));
  assert.ok(raw.includes('\n  "topic"'));
});
