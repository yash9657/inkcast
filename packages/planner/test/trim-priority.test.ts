/**
 * The trimmer's pedagogical priority (plan 5.1).
 *
 * `adaptLesson` optimises seconds. Given a lesson that overruns it deletes beats until
 * the estimate fits, and until this landed the first thing it reached for was always the
 * misconception — a caveat on the argument, by the old comment's reasoning, and therefore
 * the cheapest thing to lose.
 *
 * That reasoning is right about a footnote and wrong about a payload. On
 * `projects/deb81002b073` ("why do heavy and light objects fall at the same time") the
 * misconception is *derived from the worked example*: the arithmetic beat shows that
 * double the mass gets double the pull, and the misconception is the correction to the
 * belief that arithmetic just created — "gravity doesn't pull equally, it pulls harder,
 * and that's the whole point". The trimmer cut it to reach 150s and QC's `stages` check
 * then reported that the film never names the wrong belief it creates. A film that plants
 * an error and ends is worse than a film that runs eight seconds long.
 *
 * So two things are pinned here: the payload survives everything else that may legally
 * go, and a misconception that is *not* the payload keeps its old place at the front of
 * the queue — because that is what keeps the six pinned storyboard hashes still.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import type { Lesson, LessonStep } from '@inkcast/core';
import { Lesson as LessonSchema, lessonBeats } from '@inkcast/core';
import { readLessonFile } from '../src/lesson-io.js';
import {
  MISCONCEPTION_CUT_PREFIX,
  PRESETS,
  adaptLesson,
  lessonSeconds,
  misconceptionCutInBoard,
  misconceptionCutProblems,
  misconceptionIsPayload,
} from '../src/presets.js';

/**
 * A beat with enough narration that a handful of them overrun any preset.
 *
 * The words are real sentences rather than filler because `lessonSeconds` counts spoken
 * letters — see `DELIVERED_LPS` — so "lorem ipsum" would measure a length no film has.
 */
function step(idea: string, derivedFrom: string[] = []): LessonStep {
  return {
    idea,
    because: 'because the previous beat established it and this one follows from that',
    from: derivedFrom.length ? 'derived' : 'given',
    derivedFrom,
    emphasis: [],
    terms: [],
    narration:
      `${idea} Think about what that means for a moment, because it is the part that ` +
      'people skip over and then wonder why the rest of the explanation stops making ' +
      'any sense at all when they try to use it on a real problem of their own.',
    hold: 0.4,
    visuals: [{ describe: idea, kind: 'draw' }],
  };
}

/**
 * A lesson that overruns every preset, with a worked example and a misconception.
 *
 * `misconceptionFrom` is the only variable: it is what decides whether the beat is the
 * payload or a caveat, and therefore which end of the queue it sits at.
 */
function overlongLesson(misconceptionFrom: string[]): Lesson {
  // Through the schema rather than cast: a fixture that is not a `Lesson` measures a
  // lesson nothing can produce, and `insightArrival` reads fields a hand-written literal
  // is easy to forget (`coreInsight` was one).
  return LessonSchema.parse({
    version: 1,
    topic: 'why heavy and light objects fall at the same time',
    title: 'Why heavy and light things fall together',
    objective: 'A learner can say why mass cancels out of free fall',
    coreInsight: 'A bigger pull and a bigger reluctance cancel, so mass drops out.',
    audience: 'a curious adult',
    kind: 'stem',
    strategy: 'first-principles',
    terms: [],
    cast: [],
    hook: step('A bowling ball and an apple hit the ground at the same moment.'),
    anchor: step('Everyone has felt that a heavy box is harder to shove.'),
    // Deliberately not one long chain. `droppableIds` only offers beats no surviving beat
    // derives from, so a strict chain leaves exactly one legal victim and the priority
    // this file is about never gets to express itself. Steps 3, 4 and 6 are leaves — the
    // elaborations a real lesson can spare — and they are what has to go before the
    // payload does.
    steps: [
      step('Heavy things are also harder to get moving.', ['anchor']),
      step('That stubbornness has a name, and the name is inertia.', ['step1']),
      step('You can feel the same reluctance in a shopping trolley.', ['step1']),
      step('A loaded lorry needs far more road to stop than an empty one.', ['step1']),
      step('Falling is a tug of war between a bigger pull and a bigger reluctance.', ['step2']),
      step('Air resistance is the only thing that makes a feather lose.', ['step5']),
    ],
    worked: step('Ten kilograms gets ten times the pull and ten times the resistance.', ['step5']),
    misconception: step(
      "Gravity doesn't pull equally — it pulls harder, and that's the whole point.",
      misconceptionFrom,
    ),
    recap: step('Bigger pull, bigger reluctance, same fall.'),
  });
}

const idsOf = (l: Lesson): string[] => lessonBeats(l).map((b) => b.id);

/**
 * A beat short enough that nine of them fit the `explainer` runtime.
 *
 * One sentence, about fifteen words, so `clampNarration` has nothing to take: the point
 * of the fixture below is a lesson that overruns the beat *count* and nothing else, and a
 * beat the clamp shortens would confound the two rules this file has to tell apart.
 */
function briefStep(idea: string, derivedFrom: string[] = []): LessonStep {
  return {
    ...step(idea, derivedFrom),
    narration: idea,
    hold: 0.3,
  };
}

/**
 * Nine beats, every one inside its word ceiling, together inside the 75s target.
 *
 * This is the shape all three casts of the falling-objects prompt actually produced —
 * hook, anchor, four steps, worked, misconception, recap — and the shape `maxBeats: 8`
 * had no way to accept.
 */
function nineBeatLesson(misconceptionFrom: string[]): Lesson {
  return LessonSchema.parse({
    version: 1,
    topic: 'why heavy and light objects fall at the same time',
    title: 'Why heavy and light things fall together',
    objective: 'A learner can say why mass cancels out of free fall',
    coreInsight: 'A bigger pull and a bigger reluctance cancel, so mass drops out.',
    audience: 'a curious adult',
    kind: 'stem',
    strategy: 'first-principles',
    terms: [],
    cast: [],
    hook: briefStep('A bowling ball and an apple hit the ground at the very same moment.'),
    anchor: briefStep('Everyone has felt that a heavy box is much harder to shove along.'),
    steps: [
      briefStep('Heavy things are also harder to get moving in the first place.', ['anchor']),
      briefStep('That stubbornness has a name, and the name for it is inertia.', ['step1']),
      briefStep('Earth pulls harder on more stuff, exactly in step with the amount.', ['step1']),
      briefStep('Falling is a tug of war between bigger pull and bigger reluctance.', ['step2']),
    ],
    worked: briefStep('Ten kilograms gets ten times the pull and ten times the resistance.', [
      'step4',
    ]),
    misconception: briefStep(
      'A feather falls slowly because of the air, not because it is light.',
      misconceptionFrom,
    ),
    recap: briefStep('Bigger pull, bigger reluctance, and so exactly the same fall.'),
  });
}

test('a misconception derived from the worked example is the payload', () => {
  assert.equal(misconceptionIsPayload(overlongLesson(['worked'])), true);

  // Derived, but from a step: a caveat on the argument rather than the correction to the
  // error the worked example just invited. This is what all three shipped lessons look
  // like, and it is why the condition is not simply `from === 'derived'`.
  assert.equal(misconceptionIsPayload(overlongLesson(['step1'])), false);
  assert.equal(misconceptionIsPayload(overlongLesson([])), false);

  // No worked example at all: there is nothing for the beat to be the payload *of*, even
  // if an author writes `derivedFrom: ['worked']` by hand.
  const orphan = overlongLesson(['worked']);
  delete orphan.worked;
  assert.equal(misconceptionIsPayload(orphan), false);
});

test('the payload survives a trim that has anything else left to cut', () => {
  const problems: string[] = [];
  const lesson = overlongLesson(['worked']);
  const shaped = adaptLesson(lesson, PRESETS.short, { onProblem: (p) => problems.push(p) });

  // The premise of the test: this lesson really is over budget at `short`, so beats
  // really were dropped. Without this the assertion below passes vacuously.
  assert.ok(
    idsOf(shaped).length < idsOf(lesson).length,
    'the fixture is meant to overrun the short preset',
  );
  assert.ok(shaped.misconception, 'the payload was cut while steps were still droppable');
  assert.equal(
    misconceptionCutProblems(problems).length,
    0,
    'nothing should have reported the payload as cut',
  );
});

test('a misconception that is not the payload still goes first', () => {
  const lesson = overlongLesson(['step1']);
  const shaped = adaptLesson(lesson, PRESETS.short);

  // The old order, unchanged and deliberately so: this is the path all three shipped
  // lessons take, and moving it would move the pinned hashes for lessons nobody has
  // looked at frames of. See `misconceptionIsPayload`.
  assert.equal(shaped.misconception, undefined);
});

test('the cut payload is reported on the channel the blocking check reads', () => {
  // A budget so small that even the payload has to go: every step but one is droppable,
  // and when they are gone the misconception is all that is left.
  const problems: string[] = [];
  const tiny = { ...PRESETS.short, maxSeconds: 20, maxBeats: 4 };
  const shaped = adaptLesson(overlongLesson(['worked']), tiny, {
    onProblem: (p) => problems.push(p),
  });

  assert.equal(shaped.misconception, undefined, 'the fixture is meant to run out of steps');
  const cuts = misconceptionCutProblems(problems);
  assert.equal(cuts.length, 1, `expected one cut line, got ${JSON.stringify(problems)}`);
  assert.ok(cuts[0]!.startsWith(MISCONCEPTION_CUT_PREFIX));
  // The line has to name what was lost, not which id went: "misconception" means nothing
  // to the person reading `qc.json` a week later.
  assert.match(cuts[0]!, /pulls harder/);

  // And it must not also appear in what is left for the advisory `stages` check — the
  // two lists are partitioned in `cast.ts` on exactly this predicate.
  assert.equal(
    problems.filter((p) => !cuts.includes(p)).some((p) => /misconception/.test(p)),
    false,
  );
});

/**
 * The other half of plan gate 8, and the one `misconceptionIsPayload` cannot cover.
 *
 * The protection above only fires when the author cited `worked`, and the author is not
 * consistent about it: three casts of one prompt declared `derivedFrom` as
 * `['step3','worked']`, `['worked']` and `['step4']`, so the payload branch held on two
 * of them by luck. The third (`projects/df62ce29a563`) lost its misconception — and the
 * figure routed to that beat with it, which was the whole of gate 7's failure.
 *
 * The cause was not the word budget. After `clampNarration` those casts said 147, 151
 * and 158 words against a 171-word budget; what did not fit was the *beat count*, 9, 9
 * and 10 against `maxBeats: 8`. So this pins the fix at the level that matters — a
 * nine-beat lesson that fits the runtime keeps all nine beats — rather than at the two
 * preset numbers, which `presets.test.ts` asserts and which a future re-derivation may
 * legitimately move. What must not come back is a beat being deleted for a count on a
 * film that was already inside its runtime.
 */
test('a nine-beat lesson that fits the runtime keeps its misconception, payload or not', () => {
  const lesson = nineBeatLesson(['step4']);
  assert.equal(misconceptionIsPayload(lesson), false, 'this beat is not protected as payload');
  assert.equal(lessonBeats(lesson).length, 9, 'nine authored beats, the count all three casts hit');

  const problems: string[] = [];
  const shaped = adaptLesson(lesson, PRESETS.explainer, { onProblem: (p) => problems.push(p) });

  assert.ok(shaped.misconception, 'the misconception survived without needing the payload branch');
  assert.equal(lessonBeats(shaped).length, 9, 'and nothing else was deleted to make room');
  assert.deepEqual(
    misconceptionCutProblems(problems),
    [],
    'so the blocking check has nothing to report',
  );
  // Non-vacuous in the direction that matters: the beat count was the only thing over, so
  // a fixture that also overran the seconds would pass this test for the wrong reason.
  assert.ok(
    lessonSeconds(shaped, PRESETS.explainer) <= PRESETS.explainer.maxSeconds,
    'the nine-beat film fits the runtime target, so only the count was ever over',
  );
});

/**
 * On a wiping board the beat count is not a reason to delete a beat; on an accumulating
 * one it still is.
 *
 * `planBoard` sends `wipe` to `oneCardBoard`, which lays one cell per beat and never
 * consults `maxBeats`, so there an extra beat costs seconds and nothing else — and seconds
 * are the other half of `overBudget`. Enforcing the count as well deleted pedagogy from
 * films that fitted their runtime: `projects/c5caa09eb153` clamped to **62.7s**, well
 * inside the 60–90s band, and still lost its misconception because it had 10 beats and the
 * ceiling said 9.
 *
 * The two halves are asserted against the same numbers with **only the board mode
 * differing**, because that is the whole claim. It is also what keeps the pinned hashes
 * still: `standard`, `short` and `square` all accumulate.
 */
test('the beat count binds on an accumulating board and not on a wiping one', () => {
  const lesson = nineBeatLesson(['step4']);
  // A ceiling of 8 against 9 authored beats, on a lesson that comfortably fits 75s — so
  // the count is the only thing over, and the board mode is the only variable below.
  // `countBinds` explicitly undefined on both, because this test is about the rule the
  // board mode gives when nobody has overridden it — and `explainer`, whose shape these
  // borrow, sets the override. Spreading it silently made this test assert its own
  // negation, which is why the field is written out here rather than inherited.
  const wiping = {
    ...PRESETS.explainer,
    board: 'wipe' as const,
    maxBeats: 8,
    countBinds: undefined,
  };
  const piling = {
    ...PRESETS.explainer,
    board: 'accumulate' as const,
    maxBeats: 8,
    countBinds: undefined,
  };

  const wiped = adaptLesson(lesson, wiping);
  assert.equal(lessonBeats(wiped).length, 9, 'a wiping board keeps the beat the count would cut');
  assert.ok(wiped.misconception, 'and therefore keeps the misconception');
  assert.ok(
    lessonSeconds(wiped, wiping) <= wiping.maxSeconds,
    'non-vacuous: the kept film really does fit its runtime',
  );

  const piled = adaptLesson(lesson, piling);
  assert.equal(
    lessonBeats(piled).length,
    8,
    'an accumulating board still enforces the count — the cells are regions on one canvas',
  );

  // …unless the preset has measured that it buys nothing. `explainer` accumulates and
  // sets `countBinds: false` (2026-08-27): the same 10-beat lesson at `maxBeats` 9 and 10
  // gave an identical canvas, zoom range and sparsest scene, so the cut bought 1.3 points
  // of a bounding-box metric and cost the misconception. See `presets.ts`.
  const overridden = adaptLesson(lesson, { ...piling, countBinds: false });
  assert.equal(lessonBeats(overridden).length, 9, 'countBinds: false disarms the count');
  assert.ok(overridden.misconception, 'and therefore keeps the misconception');
  assert.equal(PRESETS.explainer.countBinds, false, 'which is the shipped explainer');

  // Non-vacuous the other way: the presets whose hashes are pinned must not have acquired
  // the override, or they take a branch nobody re-pinned them against.
  for (const name of ['standard', 'short', 'square'] as const) {
    assert.equal(PRESETS[name].countBinds, undefined, `${name} must decide by board mode`);
  }
});

test('the shipped lessons are unaffected, which is what keeps the hashes still', async () => {
  const dir = path.resolve(import.meta.dirname, '../../../examples/lessons');
  for (const name of ['gradient-descent', 'longitude', 'hash-map']) {
    const lesson = await readLessonFile(path.join(dir, `${name}.lesson.json`));
    assert.equal(
      misconceptionIsPayload(lesson),
      false,
      `${name} would take the new branch — re-pin the hashes deliberately, with frames`,
    );
  }
});

test('the cut is visible in the board, not only in the run that made it', () => {
  /*
   * The check that blocks on a cut payload read the stage channel and nothing else, and
   * the stage channel is silent on a resumed project: the storyboard comes from cache,
   * `adaptLesson` is never called, and the gate reports pass on a film with its point
   * removed. Measured 2026-08-27 on `projects/gclose2-accum` — the identical strict
   * command blocked, then passed, with nothing changed but a warm cache. Re-running was
   * a way through a strict gate.
   *
   * Same shape of fix as the `drawing` check's: ask the artefact, not the run.
   */
  const preset = { maxSeconds: 75, name: 'explainer' as const };
  const lesson = nineBeatLesson(['step4']);
  assert.ok(lesson.misconception, 'the fixture has one to lose');

  const carried = [{ role: 'hook' }, { role: 'misconception' }, { role: 'recap' }];
  const cut = [{ role: 'hook' }, { role: 'step' }, { role: 'recap' }];

  assert.deepEqual(misconceptionCutInBoard(lesson, carried, preset), []);
  const [line] = misconceptionCutInBoard(lesson, cut, preset);
  assert.ok(line, 'a board with no misconception beat is a finding');
  // The same prefix the channel's line carries, because the pipeline partitions the
  // stage channel on it and a second spelling would be a finding nobody can classify.
  assert.ok(line.startsWith(MISCONCEPTION_CUT_PREFIX));
  assert.match(line, /75s explainer budget/);
  assert.ok(line.includes(lesson.misconception.idea), 'it names the belief that was lost');

  // A lesson with nothing to lose is not a finding, and neither is a board that never
  // claimed a role — `Scene.role` is optional, so a hand-authored board carrying none of
  // them has not said that the misconception is missing, it has said nothing at all.
  assert.deepEqual(misconceptionCutInBoard({ misconception: undefined }, cut, preset), []);
  assert.deepEqual(misconceptionCutInBoard(undefined, cut, preset), []);
  assert.deepEqual(misconceptionCutInBoard(lesson, [{}, {}, {}], preset), []);
  assert.deepEqual(misconceptionCutInBoard(lesson, [], preset), []);
});
