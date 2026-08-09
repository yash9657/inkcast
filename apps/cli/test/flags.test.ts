import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { UsageError, lessonFromFlags, metaFromFlags, readFlags } from '../src/main.js';

test('--short means 9:16 with short-form pacing, not a cropped landscape video', () => {
  const flags = readFlags({ short: true, force: false, open: false });
  assert.equal(flags.aspect, '9:16');
  assert.equal(flags.preset, 'short');
  assert.equal(metaFromFlags(flags).aspect, '9:16');
});

test('--aspect 9:16 implies the short preset, and an explicit preset still wins', () => {
  assert.equal(readFlags({ aspect: '9:16' }).preset, 'short');
  assert.equal(readFlags({ aspect: '9:16', preset: 'square' }).preset, 'square');
  assert.equal(readFlags({ short: true, preset: 'standard' }).preset, 'standard');
});

test('depth is validated against the three levels', () => {
  assert.equal(readFlags({ depth: 'deep' }).depth, 'deep');
  assert.equal(readFlags({ depth: 'QUICK' }).depth, 'quick');
  assert.throws(() => readFlags({ depth: 'thorough' }), UsageError);
});

test('--board reaches the pipeline input the compiler reads', async () => {
  // The whole point of the flag, and the half that was missing for a whole phase:
  // `board: 'wipe'` compiled a one-card-at-a-time board from the day it landed and
  // nothing a user could type reached it. `baseInput` is the last CLI-side link.
  const { baseInput } = await import('../src/commands/cast.js');
  assert.equal(readFlags({ board: 'WIPE' }).board, 'wipe');
  assert.equal(baseInput(readFlags({ board: 'wipe' })).board, 'wipe');
  // Not in `meta`: that is stamped onto the storyboard after it has compiled, so a
  // mode there would announce a wiping board over ink that was never marked to go.
  assert.equal(metaFromFlags(readFlags({ board: 'wipe' })).board, undefined);
  assert.equal(baseInput(readFlags({})).board, undefined, 'absent is `accumulate`');
});

test('--board with --via document is refused rather than quietly dropped', () => {
  // The document route never reaches `compileLesson`, and its planners compose their
  // own boards. Accepting the flag there would print a mode nothing performs.
  assert.throws(() => readFlags({ board: 'wipe', via: 'document' }), UsageError);
  assert.equal(readFlags({ board: 'wipe', via: 'lesson' }).board, 'wipe');
});

test('every enum flag rejects nonsense with the valid options in the message', () => {
  for (const [name, bad] of [
    ['aspect', '4:3'],
    ['style', 'crayon'],
    ['palette', 'sepia'],
    ['preset', 'tall'],
    ['via', 'vibes'],
    ['board', 'erase'],
  ] as const) {
    assert.throws(
      () => readFlags({ [name]: bad }),
      (err: Error) => {
        assert.ok(err instanceof UsageError);
        assert.match(err.message, new RegExp(`--${name} must be one of`));
        return true;
      },
    );
  }
});

test('--seconds must be a positive number', () => {
  assert.equal(readFlags({ seconds: '45' }).seconds, 45);
  assert.equal(readFlags({ seconds: '45.6' }).seconds, 46);
  assert.throws(() => readFlags({ seconds: 'soon' }), UsageError);
  assert.throws(() => readFlags({ seconds: '0' }), UsageError);
});

test('lesson text flags are trimmed and passed through', () => {
  const flags = readFlags({
    objective: '  explain the minus sign  ',
    audience: ' a first-year undergrad ',
    brief: ' keep it warm ',
  });
  assert.equal(flags.objective, 'explain the minus sign');
  assert.equal(flags.audience, 'a first-year undergrad');
  assert.equal(flags.brief, 'keep it warm');
});

test('meta overrides only contain flags the user actually passed', () => {
  assert.deepEqual(metaFromFlags(readFlags({})), {});
  assert.deepEqual(metaFromFlags(readFlags({ style: 'chalk', voice: 'am_puck', lang: 'es' })), {
    style: 'chalk',
    voice: 'am_puck',
    language: 'es',
  });
});

test('--lesson resolves against the cwd, then the repo root, and fails loudly', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'inkcast-cli-'));
  const file = path.join(dir, 'x.lesson.json');
  writeFileSync(file, '{}');
  const ctx = { cwd: dir, root: '/nowhere' };

  assert.equal(lessonFromFlags(ctx, readFlags({ lesson: 'x.lesson.json' })), file);
  assert.equal(lessonFromFlags(ctx, readFlags({})), undefined);
  assert.throws(() => lessonFromFlags(ctx, readFlags({ lesson: 'missing.json' })), UsageError);
});
