/**
 * Can anything actually *ask* for a wiping board?
 *
 * The compiler has been able to draw one card at a time since the mode landed, and
 * for that whole time no command, option or preset could request it — `wipe` was
 * reachable only from a hand-written `compileLesson(lesson, { board: 'wipe' })`.
 * This repo has paid for that shape four times, and the pattern is always the same:
 * the capability is tested, the stage that has to pass the option on is not, and
 * every test of either end passes.
 *
 * So this test runs the two halves of the join that was missing — the options
 * `cast()` builds from a caller's request, handed to the real compiler — and the
 * cache key that decides whether the answer is recomputed at all.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { Lesson } from '@inkcast/core';
import { compileLesson } from '@inkcast/planner';
import { compileRequest } from '../src/cast.js';
import { storyboardKey } from '../src/keys.js';

const LESSON = path.resolve(
  import.meta.dirname,
  '../../../examples/lessons/gradient-descent.lesson.json',
);
const lesson = Lesson.parse(JSON.parse(await readFile(LESSON, 'utf8')));

/** The key `cast()` builds, with only the field under test varying. */
const keyFor = (board?: 'accumulate' | 'wipe'): string =>
  storyboardKey({
    compiler: 1,
    planner: 2,
    route: 'lesson',
    source: 'lesson-hash',
    meta: { aspect: '16:9' },
    preset: 'standard',
    seconds: 150,
    title: '',
    ...(board === undefined ? {} : { board }),
  });

test('a cast can ask for the wiped board, and the compiler wipes it', () => {
  const opts = compileRequest({ preset: 'standard', board: 'wipe' }, 150);
  assert.equal(opts.board, 'wipe', 'the request the storyboard stage is given');

  // Through the real compiler, because "the option is on the type" is exactly the
  // assertion that was true throughout the bug.
  const sb = compileLesson(lesson, opts);
  assert.equal(sb.meta.board, 'wipe');
  assert.ok(
    sb.scenes.slice(0, -1).flatMap((s) => s.elements).length > 0,
    'the lesson has ink before its closing card',
  );
  assert.equal(
    sb.scenes
      .slice(0, -1)
      .flatMap((s) => s.elements)
      .some((el) => el.persist),
    false,
    'every card before the last one goes out',
  );
});

test('the default is untouched, and says nothing about a mode', () => {
  const opts = compileRequest({ preset: 'standard' }, 150);
  assert.equal('board' in opts, false, 'absent, not `accumulate` — see `StoryboardMeta.board`');
  const sb = compileLesson(lesson, opts);
  assert.equal('board' in sb.meta, false);
  assert.equal(
    sb.scenes.flatMap((s) => s.elements).some((el) => !el.persist),
    false,
    'nothing is wiped from a board nobody asked to wipe',
  );
});

test('the two modes do not share a storyboard cache entry', () => {
  // The failure this closes is silent and total: with the mode outside the key,
  // `cast <doc> --board wipe` and the same command without the flag build the same
  // key, the second run finds the first one's `storyboard.json` fresh, and the
  // storyboard of the other mode is served with `storyboard: cached` printed next
  // to it. That is `keys.ts`'s own cautionary tale, one stage further on.
  assert.notEqual(keyFor('wipe'), keyFor(undefined));
  assert.notEqual(keyFor('wipe'), keyFor('accumulate'));
  assert.equal(keyFor('wipe'), keyFor('wipe'));
});
