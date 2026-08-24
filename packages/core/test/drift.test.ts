/**
 * Drift — the plan's promise about length against the audio's measurement (4.3).
 *
 * The two questions are deliberately different in kind, and the tests are shaped
 * to keep them apart: a film over its budget is a fact about that film (a problem),
 * and a delivered rate that no longer matches `DELIVERED_WPS` is a fact about a
 * constant in `presets.ts` (an advisory). A check that mixed them would either
 * block films for a stale calibration or shrug at a film that came out a minute
 * long.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { BUDGET_TOLERANCE, measureDrift, parseStoryboard, type Storyboard } from '../src/index.js';

/**
 * A board of `scenes` beats, each with `words` words of narration measured at
 * `sec` seconds of speech — so the delivered rate is exactly what the test says.
 */
function board(spec: { scenes: number; words: number; sec: number; hold?: number }): Storyboard {
  return parseStoryboard({
    version: 1,
    title: 'a board',
    canvas: { x: 0, y: 0, w: 1920, h: 1080 },
    meta: { outroSec: 1.6 },
    scenes: Array.from({ length: spec.scenes }, (_, i) => ({
      id: `s${i}`,
      narration: Array.from({ length: spec.words }, (_, w) => `word${w}`).join(' ') + '.',
      camera: { x: 960, y: 540, zoom: 1 },
      durationSec: spec.sec,
      hold: spec.hold ?? 0,
      elements: [],
    })),
  }) as Storyboard;
}

test('a film inside its budget, delivered at the planned rate, has nothing to say', () => {
  // 10 beats × 22 words = 220 words over 100s of speech = 2.2 w/s exactly.
  const drift = measureDrift(board({ scenes: 10, words: 22, sec: 10 }), {
    budgetSec: 150,
    expectedWps: 2.2,
  });
  assert.equal(drift.words, 220);
  assert.equal(drift.spokenSec, 100);
  // A stopwatch number: narration plus holds plus the outro.
  assert.equal(drift.measuredSec, 101.6);
  assert.equal(drift.wps, 2.2);
  assert.equal(drift.wpsDrift, 0);
  assert.deepEqual([drift.problems, drift.advisories], [[], []]);
});

test('a film past the tolerance the lesson critique plans with is a problem', () => {
  const drift = measureDrift(board({ scenes: 10, words: 22, sec: 10, hold: 1 }), {
    budgetSec: 60,
    expectedWps: 2.2,
  });
  // 111.6s against 60s is 1.86×, well past 1.25×.
  assert.ok(drift.budgetRatio! > BUDGET_TOLERANCE);
  assert.equal(drift.problems.length, 1);
  assert.match(drift.problems[0]!, /111\.6s against a 60s target/);
  assert.match(drift.problems[0]!, /the trimming ran and the film is still long/);
});

test('a film just inside the tolerance is long, and long is not a defect', () => {
  // 10 beats × 22 words at 12s each = 121.6s against 100s: 1.22×, under 1.25×.
  const drift = measureDrift(board({ scenes: 10, words: 22, sec: 12 }), {
    budgetSec: 100,
    expectedWps: 2.2,
  });
  assert.ok(drift.budgetRatio! > 1.2 && drift.budgetRatio! < BUDGET_TOLERANCE);
  assert.deepEqual(drift.problems, []);
});

test('a delivered rate the calibration no longer describes is advisory, not blocking', () => {
  // 220 words over 80s is 2.75 w/s — 25% faster than the constant every length
  // decision upstream is made with.
  const drift = measureDrift(board({ scenes: 10, words: 22, sec: 8 }), {
    budgetSec: 150,
    expectedWps: 2.2,
  });
  assert.equal(drift.wps, 2.75);
  assert.equal(drift.wpsDrift, 0.25);
  assert.deepEqual(drift.problems, [], 'a fast voice is not a broken film');
  assert.equal(drift.advisories.length, 1);
  assert.match(drift.advisories[0]!, /\+25%/);
  assert.match(drift.advisories[0]!, /re-measuring in presets\.ts/);
});

test('a rate is not measured from a film too short to have one', () => {
  // Four seconds of speech delivers whatever its one sentence delivers.
  const drift = measureDrift(board({ scenes: 1, words: 20, sec: 4 }), {
    budgetSec: 60,
    expectedWps: 2.2,
  });
  assert.equal(drift.wps, 5);
  assert.deepEqual(drift.advisories, []);
});

test('a board with no measured audio reports zeros and complains about nothing', () => {
  const sb = board({ scenes: 3, words: 20, sec: 5 });
  for (const scene of sb.scenes) delete scene.durationSec;
  const drift = measureDrift(sb, { budgetSec: 60, expectedWps: 2.2 });
  assert.equal(drift.spokenSec, 0);
  assert.equal(drift.wps, 0);
  assert.equal(drift.wpsDrift, 0);
  // There is no drift in a film that has not been spoken, and in particular no
  // budget breach: the outro alone must not read as a film running long.
  assert.deepEqual([drift.problems, drift.advisories], [[], []]);
});

test('with no budget there is still a rate, and no ratio invented for it', () => {
  const drift = measureDrift(board({ scenes: 10, words: 22, sec: 10 }), { expectedWps: 2.2 });
  assert.equal(drift.budgetSec, undefined);
  assert.equal(drift.budgetRatio, undefined);
  assert.equal(drift.wps, 2.2);
});
