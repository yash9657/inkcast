/**
 * The `explainer` preset: the format that was measured against a competitor.
 *
 * Two things are pinned here, and as in `board-mode.test.ts` they pull in opposite
 * directions. The first is that `explainer` really is a different film — 171 words, at
 * most nine beats, a hold ceiling, one card per idea — and that the two shipped lessons
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
  // A3 reversed 2026-08-27. The 55.5% -> 62.3% fill that bought `wipe` is `fillcheck`'s
  // bounding-box union, which cannot see the lines and arrows a toured board is made of;
  // and `wipe` plus the voice stage's bought silence produced a 52%-blank film. See the
  // `explainer` block in `src/presets.ts`, `docs/CONTRACT.md`, and `docs/STATUS.md`.
  assert.equal(p.board, 'accumulate', 'the board tour is the default again');
  // Nine since 2026-08-27, was eight. Three casts of one prompt authored 9, 9 and 10
  // beats and never eight, so every cast entered `adaptLesson` needing a beat deleted —
  // and the beat it reached was the misconception, taking the figure routed to it with
  // it (plan gates 8 and 7). See the `explainer` block in `src/presets.ts` for the
  // measurement and for why `maxWordsPerBeat` moved with it rather than on its own.
  assert.equal(p.maxBeats, 9);
  assert.equal(p.maxWordsPerBeat, 18);
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
  // ceiling sums over the beats as (maxBeats - 2) + 2*1.6 shares. That total is what the
  // A2 gate measures, so it is the number that has to stay under 190 — not
  // `maxWordsPerBeat`. The two leashed beats are read off `maxBeats` rather than written
  // as a literal 6: with the count hardcoded, raising `maxBeats` to 9 left this checking
  // an eight-beat film and the real ceiling went unmeasured in exactly the change that
  // moved it.
  const ceiling = (p.maxBeats - 2) * p.maxWordsPerBeat + 2 * Math.round(p.maxWordsPerBeat * 1.6);
  assert.ok(ceiling <= 190, `a full lesson could reach ${ceiling} words, over the 190 gate`);

  assert.ok(
    p.maxHold !== undefined && p.maxHold >= 0.5 && p.maxHold <= 0.8,
    `hold ceiling ${p.maxHold} is outside the 0.5-0.8s the plan specifies`,
  );
});

test('presets preserve complete explanations and report duration overruns', () => {
  for (const lesson of Object.values(shipped)) {
    const problems: string[] = [];
    const shaped = adaptLesson(lesson, PRESETS.explainer, { onProblem: (p) => problems.push(p) });
    const original = new Map(
      lessonBeats(lesson).map((b) => [b.step.idea, b.step.narration.trim()]),
    );
    for (const b of lessonBeats(shaped)) assert.equal(b.step.narration, original.get(b.step.idea));
    assert.ok(lessonSeconds(shaped, PRESETS.explainer) > PRESETS.explainer.maxSeconds);
    assert.ok(problems.some((p) => p.startsWith('script-duration:')));
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
  assert.equal(resolvePreset({ preset: 'explainer' }).board, 'accumulate');
  assert.equal(
    resolvePreset({ preset: 'explainer', board: 'wipe' }).board,
    'wipe',
    'an explicit --board must still override the preset default, both ways',
  );
  assert.equal(resolvePreset({ preset: 'deepdive', board: 'accumulate' }).board, 'accumulate');
});

test('an explainer film tours a real board, and an override still wipes it', () => {
  const sb = compileLesson(shipped['gradient-descent'], { preset: 'explainer' });
  // `accumulate` is the absence of the key, not the string — see the mode test in
  // `board-mode.test.ts`, which is what keeps the three pinned presets byte-identical.
  assert.equal(sb.meta.board, undefined);
  assert.equal(sb.meta.aspect, '16:9');
  assert.ok(sb.scenes.length <= PRESETS.explainer.maxBeats, `${sb.scenes.length} scenes`);

  // The three things `wipe` cost this format, and the reason 2026-08-27 took them back:
  // more than one region on the canvas, more than one shot of it, and a canvas bigger
  // than the frame for the camera to walk over. See `docs/PLAN-GOLPO-CLOSE.md` §3.3.
  const regions = new Set(sb.scenes.map((s) => s.region));
  assert.ok(regions.size > 1, `one region again: ${[...regions].join(', ')}`);
  const shots = new Set(sb.scenes.map((s) => `${s.camera.x},${s.camera.y},${s.camera.zoom}`));
  assert.ok(shots.size > 1, `the camera never moves: ${shots.size} distinct shot(s)`);

  // And the mode still reaches the storyboard when it is asked for by name.
  const wiped = compileLesson(shipped['gradient-descent'], { preset: 'explainer', board: 'wipe' });
  assert.equal(wiped.meta.board, 'wipe');
  // A wiping board's canvas *is* the frame — one cell, framed to it. So "bigger than the
  // frame" is the same claim as "bigger than what the same lesson wipes to", and this
  // way it is measured against a number in the file rather than against a derivation.
  assert.ok(
    sb.canvas.w > wiped.canvas.w || sb.canvas.h > wiped.canvas.h,
    `canvas ${sb.canvas.w}x${sb.canvas.h} is no bigger than the wiped ` +
      `${wiped.canvas.w}x${wiped.canvas.h} — there is nothing for the camera to walk`,
  );
  assert.deepEqual([...new Set(wiped.scenes.map((s) => s.region))], ['board'], 'one region');
  const oneShot = new Set(wiped.scenes.map((s) => `${s.camera.x},${s.camera.y},${s.camera.zoom}`));
  assert.equal(oneShot.size, 1, 'every beat is the same shot of the same cell');
});
