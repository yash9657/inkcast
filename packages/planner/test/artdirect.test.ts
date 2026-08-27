/**
 * The art director, tested where it can be tested without a key.
 *
 * The model call is not the interesting part — the *application* is. Four rewrites of
 * the lesson brief failed to make an author ask for a picture, so what has to be
 * pinned here is that a verdict, once given, actually reaches `lesson.json`: the
 * intent's `underlay` is written, the budget is spent on the beats that earn it, and
 * a half-formed answer degrades to ink rather than to a broken asset.
 *
 * `routeFigures` itself is covered for the one branch that matters without a key:
 * with no image provider it must not spend a model call at all, because routing to a
 * lane that cannot run buys nothing and then composes marks against a picture that
 * never arrives.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { Lesson, LessonStep, VisualIntent } from '@inkcast/core';
import { MAX_FIGURES, applyRoutes, readVerdicts, routeFigures } from '../src/artdirect.js';

function step(idea: string, describe: string): LessonStep {
  return {
    idea,
    because: 'because it does',
    from: 'given',
    derivedFrom: [],
    emphasis: [],
    terms: [],
    narration: idea,
    hold: 0.3,
    visuals: [{ describe, kind: 'draw' }],
  };
}

function entry(id: string, idea: string, describe: string) {
  const s = step(idea, describe);
  return { id, step: s, intent: s.visuals[0] as VisualIntent };
}

test('a verdict reaches the lesson, and the author is not asked first', () => {
  const hook = entry('hook', 'A bowling ball and an apple land together.', 'the two objects');
  const rel = entry('step1', 'Pull and inertia scale together.', 'two boxes with arrows');

  applyRoutes(
    [hook, rel],
    [
      {
        id: 'hook',
        route: 'figure',
        prompt: 'a person holding a bowling ball and an apple at shoulder height, side view',
      },
      { id: 'step1', route: 'marks', why: 'a relation, not a thing' },
    ],
  );

  // Written straight into the intent. This is the whole pass: three brief rewrites
  // (`STAGE_CODE_VERSION.lesson` 10, 11, 12) asked the author to do this and were
  // ignored, and `projects/deb81002b073` came back with zero underlays on a lesson
  // about bowling balls, feathers and vacuum tubes.
  assert.equal(hook.intent.kind, 'draw');
  assert.equal(hook.intent.underlay?.kind, 'figure');
  assert.match(String(hook.intent.underlay?.prompt), /bowling ball/);

  // A beat routed to marks is left exactly as it was — including an underlay the
  // author asked for. This pass adds pictures that were missing; it does not remove
  // somebody else's decision.
  assert.equal(rel.intent.underlay, undefined);
  assert.equal(rel.intent.kind, 'draw');
});

test('the figure budget is spent on the beats that earn it', () => {
  const ids = ['anchor', 'step1', 'step2', 'step3', 'step4', 'worked', 'hook'];
  const beats = ids.map((id) => entry(id, `${id} idea`, `${id} picture`));
  const problems: string[] = [];

  // Seven beats nominated, all of them plausible. The hook and the worked example are
  // last in the list on purpose: priority is a property of the beat, not of the order
  // the model happened to answer in.
  const decided = applyRoutes(
    beats,
    ids.map((id) => ({ id, route: 'figure' as const, prompt: `a picture of ${id}` })),
    { onProblem: (p) => problems.push(p) },
  );

  const figures = decided.filter((d) => d.route === 'figure').map((d) => d.id);
  assert.equal(figures.length, MAX_FIGURES, `spent ${figures.length} figures`);
  assert.ok(figures.includes('hook'), 'the hook is where the learner meets the thing');
  assert.ok(figures.includes('worked'), 'the worked example is where they watch it work');

  // The ones over budget are not discarded: the router said they have a recognisable
  // shape, and that judgement is still true — what ran out is the expensive lane.
  const overflow = decided.filter((d) => d.route === 'form');
  assert.equal(overflow.length, ids.length - MAX_FIGURES);
  for (const beat of beats) {
    assert.ok(beat.intent.underlay?.prompt, `${beat.id} kept a picture`);
  }
  // And it is said out loud rather than silently downgraded.
  assert.equal(problems.length, overflow.length);
  assert.match(problems[0] as string, /already has 4/);
});

test('a picture lane with no prompt falls back to ink rather than minting a broken asset', () => {
  const beat = entry('hook', 'Something.', 'a picture');
  const decided = applyRoutes([beat], [{ id: 'hook', route: 'figure' }]);

  assert.deepEqual(
    decided.map((d) => d.route),
    ['marks'],
  );
  // An asset whose prompt is missing would be minted with an id derived from an empty
  // string and generate whatever an empty prompt generates.
  assert.equal(beat.intent.underlay, undefined);
});

test('a verdict for a beat that was never offered is ignored, and so is a repeat', () => {
  const hook = entry('hook', 'Something.', 'a picture');
  const decided = applyRoutes(
    [hook],
    [
      { id: 'hook', route: 'figure', prompt: 'a thing' },
      { id: 'hook', route: 'marks' },
      { id: 'step9', route: 'figure', prompt: 'a beat that does not exist' },
    ],
  );

  assert.deepEqual(
    decided.map((d) => `${d.id}:${d.route}`),
    ['hook:figure'],
  );
  assert.equal(hook.intent.underlay?.kind, 'figure');
});

test('a null in a field this ignores does not throw away every other verdict', () => {
  // How the figure lane went missing from a whole film. The parse is all-or-nothing, so
  // one `null` where the model could have written nothing at all dropped ten verdicts on
  // the floor and every beat fell back to marks. `projects/df62ce29a563`, cast 2026-08-27:
  // "beats.2.prompt: Expected string, received null", 0 figures where the same prompt had
  // given 3, gate 7 failed, and the only trace was one `warn` in a 300-line log.
  //
  // A model told a field is optional says "not applicable" both ways, and for a `marks`
  // beat this code ignores the field either way. So both readings mean absent.
  const answer = {
    beats: [
      { id: 'hook', route: 'figure', prompt: 'a person dropping two things', why: 'a scene' },
      { id: 'anchor', route: 'marks', prompt: null, why: 'a relation' },
      { id: 'recap', route: 'marks', prompt: null, why: null },
    ],
  };
  const verdicts = readVerdicts(answer);
  assert.ok(verdicts, 'one ignorable null made the whole answer unreadable');
  assert.deepEqual(
    verdicts.map((v) => `${v.id}:${v.route}`),
    ['hook:figure', 'anchor:marks', 'recap:marks'],
  );
  // Absent, not `null` — nothing downstream should have to know the wire allowed it.
  assert.equal('prompt' in (verdicts[1] as object), false);
  assert.equal('why' in (verdicts[2] as object), false);
  assert.equal(verdicts[0]?.prompt, 'a person dropping two things');

  // An answer that really cannot be read is still `undefined`, and the caller still
  // degrades to ink rather than throwing.
  assert.equal(readVerdicts({ beats: [{ id: 'hook', route: 'sculpture' }] }), undefined);
  assert.equal(readVerdicts('not an answer at all'), undefined);
});

test('with no image provider the router does not spend a call', async () => {
  // Routing to a lane that cannot run is worse than not routing: it costs a model
  // call to write a prompt nothing will generate, and then the drawing author
  // composes marks against a picture that never arrives.
  const lesson = {
    version: 1,
    topic: 'Falling',
    objective: 'know why',
    coreInsight: 'they fall together',
    kind: 'stem',
    strategy: 'first-principles',
    jargonBudget: [],
    hook: step('A bowling ball and an apple.', 'the two objects'),
    anchor: step('You have held both.', 'a hand holding them'),
    steps: [step('Pull scales with mass.', 'a scale')],
    recap: step('They land together.', 'both landing'),
  } as unknown as Lesson;

  assert.deepEqual(await routeFigures(lesson, { illustrations: false }), []);
  assert.equal(lesson.hook.visuals[0]?.underlay, undefined);
});
