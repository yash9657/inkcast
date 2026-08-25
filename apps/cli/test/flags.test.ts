import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { styleIds } from '@inkcast/core';
import { UsageError, lessonFromFlags, metaFromFlags, readFlags } from '../src/main.js';
import { usage } from '../src/usage.js';

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

/*
 * The preset list, in all three places it is written down.
 *
 * `explainer` existed in `packages/planner/src/presets.ts` and in none of the mirrors, so
 * for as long as the preset has been shipping, `--preset explainer` was answered with
 * "must be one of standard | short | square". Three copies of one list, and no two of them
 * checked against each other: the planner's `PRESETS`, the stage contract's `PresetName`
 * (guarded now by `packages/pipeline/test/preset-mirror.test.ts`) and this CLI's flag
 * validator plus its help text.
 *
 * The help text is why this is a test and not a type. `usage.ts` prints the allowed values
 * as prose inside a template literal, and no compiler will ever notice that a sentence has
 * gone stale — the user-visible half of the list is exactly the half nothing was checking.
 */
test('every preset the flag accepts is a preset the help text offers', () => {
  const help = usage(false);
  const line = help.split('\n').find((l) => l.includes('--preset'));
  assert.ok(line, 'usage() must document --preset at all');

  for (const name of ['standard', 'short', 'square', 'explainer']) {
    // Accepted by the validator...
    assert.equal(readFlags({ preset: name }).preset, name);
    // ...and advertised to the user. A flag that works and is undocumented is as much a
    // drift as one that is documented and rejected; `explainer` was briefly both.
    assert.ok(line.includes(name), `usage()'s --preset line does not mention ${name}`);
  }

  // And the validator is still a validator: it must not have become a passthrough on the
  // way to fixing the list, or this test would pass for a flag that accepts anything.
  assert.throws(() => readFlags({ preset: 'widescreen' }), UsageError);
});

/**
 * The same drift, one flag over, and now unable to happen for the same reason the preset
 * list still can: since plan 7.3 a style is a JSON file in `styles/`, and both the
 * validator and the help line read `styleIds()`. This test is what proves the *user*
 * sees the fifth pack — a style the flag accepts and the help does not print is a style
 * nobody will ever type.
 */
test('every ink style the flag accepts is a style the help text offers', () => {
  const help = usage(false);
  const line = help.split('\n').find((l) => l.includes('--style'));
  assert.ok(line, 'usage() must document --style at all');

  for (const name of styleIds()) {
    assert.equal(readFlags({ style: name }).style, name);
    assert.ok(line.includes(name), `usage()'s --style line does not mention ${name}`);
  }
  assert.ok(styleIds().length >= 4, 'the four shipped personalities must all be packs');

  // Still a validator, not a passthrough — an unknown style must not reach the pipeline.
  assert.throws(() => readFlags({ style: 'crayon' }), UsageError);
});

test('--emit-plan reaches the pipeline, and is documented where a user would look', () => {
  // The link `--board` was missing for a whole phase, checked here for the same reason:
  // a flag that parses and reaches nothing is indistinguishable from a flag that works,
  // right up to the moment somebody looks for the file it promised.
  assert.equal(readFlags({ 'emit-plan': true }).emitPlan, true);
  assert.equal(readFlags({}).emitPlan, false, 'a plan on every run is a derived copy');
  const line = usage(false)
    .split('\n')
    .find((l) => l.includes('--emit-plan'));
  assert.ok(line, 'usage() must document --emit-plan');
  // And it says what the file is for. The audit's objection to a persisted plan was that
  // it becomes an input; the help text is the first place that can be said.
  assert.match(usage(false), /nothing reads it back/);
});
