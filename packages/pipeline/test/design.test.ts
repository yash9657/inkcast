/**
 * The front half of the pipeline, end to end, with no keys and no network.
 *
 * `designLesson()` stops before voice/visuals/render, so this exercises real
 * ingest, the real lesson stage, real persistence and the real cache without
 * needing Chromium, ffmpeg or a model. Everything the render stages do is covered
 * in their own packages.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { withProjects, sampleLesson, type Sandbox } from './helpers.js';

let sandbox: Sandbox;
let pipeline: typeof import('../src/index.js');

before(async () => {
  sandbox = await withProjects();
  // Zero-key run: assert on the local path deliberately, not on whatever the
  // developer happens to have exported.
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  delete process.env.REPLICATE_API_TOKEN;
  delete process.env.FAL_KEY;
  pipeline = await import('../src/index.js');
});

after(async () => {
  await sandbox.cleanup();
});

test('a supplied lesson file skips the lesson stage entirely', async () => {
  const file = path.join(sandbox.root, 'hand.lesson.json');
  await writeFile(file, JSON.stringify(sampleLesson(), null, 2));

  const result = await pipeline.designLesson({ lesson: file }, { projectId: 'supplied' });

  assert.equal(result.lesson?.topic, 'Gradient descent');
  assert.equal(result.route, 'lesson');
  assert.ok(result.lessonPath && existsSync(result.lessonPath), 'the lesson is persisted');
  // Nothing was read and nothing was authored.
  assert.ok(!existsSync(path.join(result.dir, 'source.json')));
  assert.equal(result.problems.length, 0, `critique: ${result.problems.join(' | ')}`);

  const written = JSON.parse(await readFile(result.lessonPath, 'utf8')) as { topic: string };
  assert.equal(written.topic, 'Gradient descent');
});

test('a bare topic needs no document, and reports the missing key honestly', async () => {
  const result = await pipeline.designLesson(
    { topic: 'gradient descent', objective: 'explain the minus sign' },
    { projectId: 'topic-only' },
  );

  assert.ok(result.lesson, 'a topic alone produces a lesson');
  assert.ok(result.lesson.hook.narration.trim().length > 0);
  assert.ok(result.lesson.steps.length >= 1);
  // No document was ingested, so that stage did nothing.
  assert.ok(!existsSync(path.join(result.dir, 'source.json')));

  const lessonNotice = result.degradations.find((d) => d.stage === 'lesson');
  assert.equal(lessonNotice?.severity, 'major');
  assert.equal(lessonNotice?.fix, 'inkcast keys set anthropic');
  assert.equal(result.providers.planner.name, 'heuristic');
});

test('the lesson stage is resumable: a second run is served from cache', async () => {
  const seen: string[] = [];
  const first = await pipeline.designLesson(
    { topic: 'compound interest' },
    { projectId: 'resume' },
  );
  const second = await pipeline.designLesson(
    { topic: 'compound interest' },
    { projectId: 'resume', onProgress: (p) => seen.push(`${p.stage}:${p.note ?? ''}`) },
  );

  assert.deepEqual(second.lesson, first.lesson);
  assert.ok(
    seen.some((s) => s === 'lesson:cached'),
    `expected a cached lesson, saw ${seen.join(', ')}`,
  );
});

test('a hand-edited lesson.json survives the cache but changes the storyboard key', async () => {
  const first = await pipeline.designLesson({ topic: 'entropy' }, { projectId: 'edited' });
  const file = first.lessonPath!;
  const edited = { ...first.lesson!, objective: 'explain why entropy only goes up' };
  await writeFile(file, JSON.stringify(edited, null, 2));

  const second = await pipeline.designLesson({ topic: 'entropy' }, { projectId: 'edited' });
  assert.equal(second.lesson?.objective, 'explain why entropy only goes up');
  assert.notEqual(pipeline.lessonHash(second.lesson!), pipeline.lessonHash(first.lesson!));
});

test('--force re-authors even when the cache is warm', async () => {
  const notes: string[] = [];
  await pipeline.designLesson({ topic: 'binary search' }, { projectId: 'forced' });
  await pipeline.designLesson(
    { topic: 'binary search' },
    { projectId: 'forced', force: true, onProgress: (p) => notes.push(p.note ?? '') },
  );
  assert.ok(!notes.includes('cached'), `expected no cache hits, saw ${notes.join(', ')}`);
});

test('a document is ingested once and cached', async () => {
  const doc = path.join(sandbox.root, 'note.md');
  await writeFile(
    doc,
    '# Why B-trees beat binary trees on disk\n\nA disk read costs milliseconds. ' +
      'A binary tree asks for one comparison per read, so depth is the cost. ' +
      'A B-tree packs hundreds of keys into one page, so one read answers many comparisons.\n',
  );
  const notes: string[] = [];
  const first = await pipeline.designLesson({ filePath: doc }, { projectId: 'doc' });
  assert.ok(existsSync(path.join(first.dir, 'source.json')));
  assert.ok(first.lesson);

  await pipeline.designLesson(
    {
      filePath: doc,
    },
    { projectId: 'doc', onProgress: (p) => notes.push(`${p.stage}:${p.note ?? ''}`) },
  );
  assert.ok(notes.includes('ingest:cached'), notes.join(', '));
});

test('depth changes the runtime target the lesson is written against', async () => {
  const quick = await pipeline.designLesson(
    { topic: 'why the sky is blue', depth: 'quick' },
    { projectId: 'depth-quick' },
  );
  const deep = await pipeline.designLesson(
    { topic: 'why the sky is blue', depth: 'deep' },
    { projectId: 'depth-deep' },
  );
  assert.ok(quick.targetSec < deep.targetSec);
});

test('the short preset targets a vertical runtime', async () => {
  const result = await pipeline.designLesson(
    { topic: 'learning rate', preset: 'short' },
    { projectId: 'vertical' },
  );
  assert.equal(result.preset, 'short');
  assert.ok(result.targetSec <= 60, `a short must stay short, got ${result.targetSec}s`);
});

test('nothing to cast is a stage error, not a crash', async () => {
  await assert.rejects(pipeline.designLesson({}, { projectId: 'empty' }), (err: Error) => {
    assert.ok(err.message.includes('nothing to cast'));
    return true;
  });
});
