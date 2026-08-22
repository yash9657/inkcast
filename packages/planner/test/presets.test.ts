/**
 * The `explainer` preset: the format that was measured against a competitor.
 *
 * Two things are pinned here, and as in `board-mode.test.ts` they pull in opposite
 * directions. The first is that `explainer` really is a different film — 165 words, at
 * most eight beats, a hold ceiling, one card per idea — and that the two shipped lessons
 * actually fit inside it, which is the offline half of the A2 gate ("total words ≤ 190,
 * runtime 60–100s"). The second is that adding a fourth key to `PRESETS` changed nothing
 * about the other three, because four pinned storyboard hashes
 * (`npx tsx packages/pipeline/src/sbhash.mts gradient-descent longitude`) say so and
 * nothing in CI can see them.
 *
 * The second half is the one worth having a test for. The hashes are checked by hand,
 * across a `git stash`, by whoever remembers — so what is pinned below is not the hashes
 * themselves but the *property* that makes them safe: the one shared code path this
 * change touched, `trimStep`'s new hold cap, is provably a no-op on a preset that does
 * not ask for one. A cap that quietly applied everywhere would move all four hashes and
 * would look, in the diff, exactly like a cap that did not.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import type { Lesson, LessonStep } from '@inkcast/core';
import { lessonBeats } from '@inkcast/core';
import { compileLesson } from '../src/compile.js';
import { readLessonFile } from '../src/lesson-io.js';
import {
  DELIVERED_WPS,
  PRESETS,
  adaptLesson,
  lessonSeconds,
  resolvePreset,
} from '../src/presets.js';

const lessonPath = (name: string): string =>
  path.resolve(import.meta.dirname, `../../../examples/lessons/${name}.lesson.json`);
const shipped = {
  'gradient-descent': await readLessonFile(lessonPath('gradient-descent')),
  longitude: await readLessonFile(lessonPath('longitude')),
};

/** Spoken words in a shaped lesson, counted the way the budget is stated. */
const spokenWords = (lesson: Lesson): number =>
  lessonBeats(lesson).reduce(
    (t, b) => t + b.step.narration.trim().split(/\s+/).filter(Boolean).length,
    0,
  );

test('the explainer preset is the measured shape, and its arithmetic is the stated one', () => {
  const p = PRESETS.explainer;
  assert.equal(p.aspect, '16:9', 'landscape: it is the format the comparison was filmed in');
  assert.equal(p.board, 'wipe', 'A3 — content fill 55.5% to 62.3%, regions 4 to 1');
  assert.equal(p.maxBeats, 8);
  assert.equal(p.visualsPerBeat, 2);
  assert.equal(p.outroSec, 1);

  // The budget the brief states, recomputed here from the two numbers it is built from.
  // ~160 words is the target taken off the competitor's own film (~145 measured), and
  // the point of asserting it is that the budget is a *derived* number: change
  // `maxSeconds` or `DELIVERED_WPS` and the brief silently starts asking for something
  // else, which is how a 60s cut came to be written against a 150s budget.
  const budget = Math.round(p.maxSeconds * DELIVERED_WPS);
  assert.ok(budget >= 150 && budget <= 175, `${budget} words is not the ~160 the plan asks for`);
  assert.ok(
    p.maxSeconds >= 60 && p.maxSeconds <= 90,
    `${p.maxSeconds}s is outside the 60-90s band`,
  );

  // `wordBudget` gives the hook and the worked example a 1.6x leash, so the per-beat
  // ceiling sums over eight beats as 6 + 2*1.6 shares. That total is what the A2 gate
  // measures, so it is the number that has to stay under 190 — not `maxWordsPerBeat`.
  const ceiling = 6 * p.maxWordsPerBeat + 2 * Math.round(p.maxWordsPerBeat * 1.6);
  assert.ok(ceiling <= 190, `a full lesson could reach ${ceiling} words, over the 190 gate`);

  assert.ok(
    p.maxHold !== undefined && p.maxHold >= 0.5 && p.maxHold <= 0.8,
    `hold ceiling ${p.maxHold} is outside the 0.5-0.8s the plan specifies`,
  );
});

test('both shipped lessons fit the explainer budget, words and seconds', () => {
  for (const [name, lesson] of Object.entries(shipped)) {
    const shaped = adaptLesson(lesson, PRESETS.explainer);
    const words = spokenWords(shaped);
    const seconds = lessonSeconds(shaped, PRESETS.explainer);
    const beats = lessonBeats(shaped).length;

    assert.ok(words <= 190, `${name} at explainer says ${words} words, over the 190 gate`);
    assert.ok(beats <= 8, `${name} kept ${beats} beats`);
    assert.ok(
      seconds >= 55 && seconds <= 100,
      `${name} at explainer estimates ${seconds.toFixed(1)}s, outside the 60-100s gate`,
    );
    // Non-vacuous, and this is the whole of Phase 3 in one assertion: the same lesson at
    // `standard` says half again as much. 348 words against ~145 is the measured defect.
    const long = spokenWords(adaptLesson(lesson, PRESETS.standard));
    assert.ok(long > words * 1.4, `${name}: ${long} words at standard vs ${words} at explainer`);
  }
});

test('the hold ceiling is a property of the format, not a new global', () => {
  /** A beat that asks for a long pause, which is the only input that can show a cap. */
  const asked = (hold: number): LessonStep => ({
    idea: 'The dial moves against the slope.',
    because: 'The slope points uphill, and the valley is downhill.',
    from: 'given',
    derivedFrom: [],
    narration: 'The slope points uphill. So step the other way.',
    visuals: [],
    emphasis: [],
    terms: [],
    hold,
  });
  const lessonAsking = (hold: number): Lesson => ({
    ...shipped['gradient-descent'],
    steps: shipped['gradient-descent'].steps.map((s) => ({ ...s, ...asked(hold) })),
  });

  const holdsOf = (preset: keyof typeof PRESETS): number[] =>
    adaptLesson(lessonAsking(2.5), PRESETS[preset]).steps.map((s) => s.hold);

  // The three pinned presets pass the request through untouched — `standard` and
  // `square` because they have no ceiling at all, `short` because its own vertical rule
  // (0.5s, or 1.2s on the hook) is the one that was already there and has not moved.
  assert.deepEqual(
    [...new Set(holdsOf('standard'))],
    [2.5],
    'standard invented a ceiling it never had — this moves two of the four pinned hashes',
  );
  assert.deepEqual([...new Set(holdsOf('square'))], [2.5]);
  assert.deepEqual([...new Set(holdsOf('short'))], [0.5], 'the vertical rule, unchanged');
  assert.deepEqual([...new Set(holdsOf('explainer'))], [0.8], 'the format cap, applied');

  for (const name of ['standard', 'short', 'square'] as const) {
    assert.equal(PRESETS[name].maxHold, undefined, `${name} must not acquire a hold ceiling`);
  }
});

test('explainer is selectable by name only, and an explicit board still wins', () => {
  assert.equal(resolvePreset({ preset: 'explainer' }).name, 'explainer');
  // It shares 16:9 with `standard`, so the aspect table cannot choose between them and
  // must keep choosing `standard`: the CLI default is not allowed to move under anyone.
  assert.equal(resolvePreset({ aspect: '16:9' }).name, 'standard');
  assert.equal(resolvePreset({}).name, 'standard');
  assert.equal(resolvePreset({ preset: 'explainer' }).board, 'wipe');
  assert.equal(
    resolvePreset({ preset: 'explainer', board: 'accumulate' }).board,
    'accumulate',
    'an explicit --board must still override the preset default, both ways',
  );
});

test('an explainer film is one card per idea, and the mode reaches the storyboard', () => {
  const sb = compileLesson(shipped['gradient-descent'], { preset: 'explainer' });
  assert.equal(sb.meta.board, 'wipe');
  assert.equal(sb.meta.aspect, '16:9');
  assert.ok(sb.scenes.length <= 8, `${sb.scenes.length} scenes`);
  assert.deepEqual([...new Set(sb.scenes.map((s) => s.region))], ['board'], 'one region');
  // The camera never moves, because there is nothing else on the board to move to. This
  // is the mechanism behind the 55.5% to 62.3% fill: one cell, framed to the frame.
  const shots = new Set(sb.scenes.map((s) => `${s.camera.x},${s.camera.y},${s.camera.zoom}`));
  assert.equal(shots.size, 1, 'every beat is the same shot of the same cell');
});
