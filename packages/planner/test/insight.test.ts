/**
 * `coreInsight` is read by something, and this is what it decides.
 *
 * The field was added to the lesson schema, briefed at length ("the sentence the whole
 * video exists to install… a beat that does not serve it is a beat to cut") and then read
 * by nothing but an is-it-empty check. Two consumers in `presets.ts` now read it, and they
 * are not equally important, so both halves are pinned here:
 *
 *  - `stepScores` ranks the drop order against it. Measured: this changes no real
 *    lesson's output, because `droppableIds` offers exactly one candidate per cut on all
 *    three lessons we have. A ranking cannot choose between one thing. Asserted anyway,
 *    because the day a lesson has two independent tails is the day it matters.
 *  - `insightArrival` decides what may be cut **at all**, and that is where the defect
 *    was. On the cardiac lesson every step scored zero against objective + topic, the
 *    drop order fell through to "the later beat", and the trimmer deleted `step7` —
 *    "Starting at the bottom wrings blood upward" — at every preset. The film that
 *    shipped therefore never says the second half of its own thesis, and the cut did not
 *    even buy the budget: the estimate still overran by 15s at `standard` and by 59s at
 *    `square`.
 *
 * The numbers below are measurements of the fixture text, not preferences. If a fixture
 * word changes they should be re-measured rather than adjusted to fit.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { lessonBeats } from '@inkcast/core';
import type { Lesson } from '@inkcast/core';
import { readLessonFile } from '../src/lesson-io.js';
import { PRESETS, adaptLesson, insightArrival, lessonSeconds } from '../src/presets.js';
import { keywords } from '../src/text.js';
import { CARDIAC } from './cardiac-lesson.js';

const SHIPPED = ['gradient-descent', 'longitude'] as const;
const shipped = await Promise.all(
  SHIPPED.map((name) =>
    readLessonFile(
      path.resolve(import.meta.dirname, `../../../examples/lessons/${name}.lesson.json`),
    ),
  ),
);

/** The share of the insight's own content words that a beat's narration says. */
function arrivalShare(lesson: Lesson, step: { narration: string }): number {
  const insight = new Set(keywords(lesson.coreInsight));
  if (!insight.size) return 0;
  return new Set(keywords(step.narration).filter((w) => insight.has(w))).size / insight.size;
}

/* ------------------------------------------------- where the insight arrives */

test('the beat that lands the cardiac lesson thesis is the last step, and it is spared', () => {
  assert.equal(insightArrival(CARDIAC), 'step7');

  // Not a near miss on either side of the line: the beat that lands it says nearly a third
  // of the insight, and the closest runner-up says a quarter.
  const shares = CARDIAC.steps.map((s) => arrivalShare(CARDIAC, s));
  assert.equal(shares.length, 7);
  assert.ok(shares[6]! > 0.3, `step7 says ${shares[6]!.toFixed(2)} of the insight`);
  assert.equal(Math.max(...shares), shares[6]);

  // And it is the beat that was missing from the film. Its narration is the only place the
  // lesson ever explains the "from the base upward" half of its own `coreInsight`.
  assert.match(CARDIAC.steps[6]!.narration, /squeeze starts at the tip and travels upward/);
  assert.match(CARDIAC.coreInsight, /from the base upward/);
});

test('every preset keeps the cardiac payoff, and the trimmer says why it ran long', () => {
  for (const name of ['standard', 'short', 'square', 'explainer'] as const) {
    const shaped = adaptLesson(CARDIAC, PRESETS[name]);
    assert.equal(shaped.steps.length, 7, `${name} dropped a step`);
    assert.match(
      shaped.steps[6]!.narration,
      /travels upward/,
      `${name} cut the beat the insight lands on`,
    );
  }
});

test('keeping complete teaching reports the runtime cost instead of cutting its conclusion', () => {
  const problems: string[] = [];
  const shaped = adaptLesson(CARDIAC, PRESETS.standard, { onProblem: (p) => problems.push(p) });
  assert.equal(shaped.steps[6]!.narration, CARDIAC.steps[6]!.narration);
  assert.ok(lessonSeconds(shaped, PRESETS.standard) > PRESETS.standard.maxSeconds);
  assert.ok(problems.some((p) => p.startsWith('script-duration:')));
});

/* ------------------------------------------- the shipped lessons do not move */

test('neither shipped lesson has a beat above the arrival threshold', () => {
  // This is why the four pinned storyboard hashes do not move: nothing is spared on either
  // shipped lesson, so `droppableIds` returns exactly what it always returned. Measured
  // maxima are 0.18 (gradient descent) and 0.14 (longitude) against a 0.25 line.
  for (const lesson of shipped) {
    const shares = lesson.steps.map((s) => arrivalShare(lesson, s));
    assert.ok(
      Math.max(...shares) < 0.25,
      `${lesson.topic} has a beat at ${Math.max(...shares).toFixed(2)}`,
    );
    assert.equal(insightArrival(lesson), undefined, lesson.topic);
  }
});

test('duration alone no longer deletes shipped teaching steps', () => {
  for (const lesson of shipped) {
    for (const preset of [PRESETS.standard, PRESETS.short]) {
      const shaped = adaptLesson(lesson, preset);
      assert.deepEqual(
        shaped.steps.map((s) => s.narration),
        lesson.steps.map((s) => s.narration),
      );
    }
  }
});

/* ------------------------------------------------------------- the guardrails */

test('a lesson with no core insight spares nothing', () => {
  // Every `lesson.json` written before the field existed parses with `coreInsight: ''`,
  // and those must trim exactly as they did.
  const blank: Lesson = { ...CARDIAC, coreInsight: '' };
  assert.equal(insightArrival(blank), undefined);
  assert.ok(
    adaptLesson(blank, { ...PRESETS.standard, maxBeats: 8 }).steps.length < CARDIAC.steps.length,
  );
});

test('at most one beat is ever spared, however many serve the insight', () => {
  // The teaching brief tells the author that *every* beat should serve the insight, so a
  // rule that spared every beat serving it would disable trimming on exactly the lessons
  // that followed the brief best. Here all seven steps say the whole insight.
  const chorus: Lesson = {
    ...CARDIAC,
    steps: CARDIAC.steps.map((s) => ({ ...s, narration: `${CARDIAC.coreInsight} ${s.narration}` })),
  };
  const spared = insightArrival(chorus);
  // The later of equals: a build-up and a landing are both "serving it", and it is the
  // landing that has to survive.
  assert.equal(spared, 'step7');

  const shaped = adaptLesson(chorus, PRESETS.short);
  assert.ok(
    shaped.steps.length < chorus.steps.length ||
      lessonBeats(shaped).length < lessonBeats(chorus).length,
    'sparing the arrival must cost the trimmer one candidate, not all of them',
  );
});

/* ------------------------------------------------ the ranking reads it too */

test('the drop order now ranks against the insight rather than the objective alone', () => {
  // The objective is the acceptance test, written in the technical register — "SA node",
  // "Purkinje fibres" — and half of those words are in `jargonBudget`, which the beats may
  // not use until they have earned them. So overlap with it is *lowest* for the lessons
  // that follow the vocabulary rule best: all seven cardiac steps score zero against
  // objective + topic, which is why the drop order used to fall through to "the later
  // beat". Against objective + topic + insight the same steps separate.
  const objectiveOnly = new Set(keywords(`${CARDIAC.objective} ${CARDIAC.topic}`));
  const withInsight = new Set(
    keywords(`${CARDIAC.coreInsight} ${CARDIAC.objective} ${CARDIAC.topic}`),
  );
  const score = (goal: Set<string>, s: { idea: string; because: string }) =>
    keywords(`${s.idea} ${s.because}`).filter((w) => goal.has(w)).length;

  assert.deepEqual(
    CARDIAC.steps.map((s) => score(objectiveOnly, s)),
    [0, 0, 0, 0, 0, 0, 0],
  );
  assert.deepEqual(
    CARDIAC.steps.map((s) => score(withInsight, s)),
    [1, 0, 2, 1, 6, 0, 5],
  );
});
