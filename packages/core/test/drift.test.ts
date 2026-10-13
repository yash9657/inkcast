/**
 * Drift — the plan's promise about length against the audio's measurement (4.3).
 *
 * The two questions are deliberately different in kind, and the tests are shaped
 * to keep them apart: a film over its budget is a fact about that film (a problem),
 * and a delivered rate that no longer matches `DELIVERED_LPS` is a fact about a
 * constant in `presets.ts` (an advisory). A check that mixed them would either
 * block films for a stale calibration or shrug at a film that came out a minute
 * long.
 *
 * **The advisory is judged in spoken letters, and the last test here is why.** Against
 * words a second it fired on two of four corpus films for a reason no re-measurement
 * could fix — their vocabulary — and an advisory that cannot be satisfied is one people
 * learn to scroll past.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { BUDGET_TOLERANCE, measureDrift, parseStoryboard, type Storyboard } from '../src/index.js';

/**
 * A board of `scenes` beats, each `words` words of narration measured at `sec` seconds
 * of speech — so the delivered rate is exactly what the test says it is.
 *
 * `word` is a real word of a stated length rather than `word1 word2 …`: the letters are
 * counted off the *normalised* narration, so a digit glued to a token would be spoken as
 * "one" and the fixture would no longer mean what it says. Five letters by default, which
 * makes letters-a-second exactly five times words-a-second and keeps the arithmetic in
 * these tests legible.
 */
function board(spec: {
  scenes: number;
  words: number;
  sec: number;
  hold?: number;
  word?: string;
}): Storyboard {
  const word = spec.word ?? 'alpha';
  return parseStoryboard({
    version: 1,
    title: 'a board',
    canvas: { x: 0, y: 0, w: 1920, h: 1080 },
    meta: { outroSec: 1.6 },
    scenes: Array.from({ length: spec.scenes }, (_, i) => ({
      id: `s${i}`,
      narration: Array.from({ length: spec.words }, () => word).join(' ') + '.',
      camera: { x: 960, y: 540, zoom: 1 },
      durationSec: spec.sec,
      hold: spec.hold ?? 0,
      elements: [],
    })),
  }) as Storyboard;
}

/** The calibration a five-letter-word fixture is on plan at. */
const ON_PLAN = { expectedWps: 2.2, expectedLps: 11 };

test('a film inside its budget, delivered at the planned rate, has nothing to say', () => {
  // 10 beats × 22 words = 220 words (1,100 letters) over 100s = 2.2 w/s and 11 letters/s.
  const drift = measureDrift(board({ scenes: 10, words: 22, sec: 10 }), {
    budgetSec: 150,
    ...ON_PLAN,
  });
  assert.equal(drift.words, 220);
  assert.equal(drift.letters, 1100);
  assert.equal(drift.spokenSec, 100);
  // A stopwatch number: narration plus holds plus the outro.
  assert.equal(drift.measuredSec, 101.6);
  assert.equal(drift.wps, 2.2);
  assert.equal(drift.lps, 11);
  assert.equal(drift.paceDrift, 0);
  assert.deepEqual([drift.problems, drift.advisories], [[], []]);
});

test('a film past the tolerance the lesson critique plans with is a problem', () => {
  const drift = measureDrift(board({ scenes: 10, words: 22, sec: 10, hold: 1 }), {
    budgetSec: 60,
    ...ON_PLAN,
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
    ...ON_PLAN,
  });
  assert.ok(drift.budgetRatio! > 1.2 && drift.budgetRatio! < BUDGET_TOLERANCE);
  assert.deepEqual(drift.problems, []);
});

test('a delivered rate the calibration no longer describes is advisory, not blocking', () => {
  // 1,100 letters over 80s is 13.75 a second — 25% faster than the constant every
  // length decision upstream is made with.
  const drift = measureDrift(board({ scenes: 10, words: 22, sec: 8 }), {
    budgetSec: 150,
    ...ON_PLAN,
  });
  assert.equal(drift.lps, 13.75);
  assert.equal(drift.paceDrift, 0.25);
  assert.deepEqual(drift.problems, [], 'a fast voice is not a broken film');
  assert.equal(drift.advisories.length, 1);
  assert.match(drift.advisories[0]!, /\+25%/);
  assert.match(drift.advisories[0]!, /re-measuring in presets\.ts/);
  // The words are quoted too, so a reader can tell a fast pipeline from a short-worded
  // film without going to look the numbers up.
  assert.match(drift.advisories[0]!, /2\.75 words a second at 5\.00 letters a word/);
});

test('a rate is not measured from a film too short to have one', () => {
  // Four seconds of speech delivers whatever its one sentence delivers.
  const drift = measureDrift(board({ scenes: 1, words: 20, sec: 4 }), {
    budgetSec: 60,
    ...ON_PLAN,
  });
  assert.equal(drift.lps, 25);
  assert.deepEqual(drift.advisories, []);
});

test('a board with no measured audio reports zeros and complains about nothing', () => {
  const sb = board({ scenes: 3, words: 20, sec: 5 });
  for (const scene of sb.scenes) delete scene.durationSec;
  const drift = measureDrift(sb, { budgetSec: 60, ...ON_PLAN });
  assert.equal(drift.spokenSec, 0);
  assert.equal(drift.wps, 0);
  assert.equal(drift.lps, 0);
  assert.equal(drift.paceDrift, 0);
  // There is no drift in a film that has not been spoken, and in particular no
  // budget breach: the outro alone must not read as a film running long.
  assert.deepEqual([drift.problems, drift.advisories], [[], []]);
});

test('with no budget there is still a rate, and no ratio invented for it', () => {
  const drift = measureDrift(board({ scenes: 10, words: 22, sec: 10 }), ON_PLAN);
  assert.equal(drift.budgetSec, undefined);
  assert.equal(drift.budgetRatio, undefined);
  assert.equal(drift.lps, 11);
});

test('a caller that names only a word rate is converted, not refused', () => {
  // The compatibility path. `expectedLps` is optional so an un-updated caller still gets
  // its numbers, and the conversion is `LETTERS_PER_WORD` — right for an average-worded
  // film and stated to be a conversion rather than a second measurement.
  const drift = measureDrift(board({ scenes: 10, words: 22, sec: 10 }), { expectedWps: 2.2 });
  assert.equal(drift.expectedLps, 9.306, '2.2 words a second at 4.23 letters a word');
  assert.equal(drift.lps, 11);
});

/* ------------------------------------------------ why the unit is letters (finding 2) */

test('two films at one speaking speed are on plan, whatever their words weigh', () => {
  // The finding, as a test. Both boards are spoken at exactly 11 letters a second — the
  // same voice, the same speed, the same pipeline. One uses three-letter words and the
  // other seven-letter ones, which is roughly the real spread between `qc64-gd` (3.79
  // letters a word) and `qc0-doc` (4.86).
  const short = measureDrift(board({ scenes: 10, words: 22, sec: 6, word: 'cat' }), ON_PLAN);
  const long = measureDrift(board({ scenes: 10, words: 22, sec: 14, word: 'oxidise' }), ON_PLAN);

  assert.equal(short.lps, 11);
  assert.equal(long.lps, 11);
  assert.deepEqual(short.advisories, [], 'a short-worded film is not a stale calibration');
  assert.deepEqual(long.advisories, [], 'nor is a long-worded one');

  // And the delivered *word* rates they would have been judged on: 3.67 and 1.57 a
  // second, 67% and −29% from 2.2. Both would have raised the advisory, on films where
  // nothing is wrong and no number in `presets.ts` could have made them agree — which is
  // the whole reason the constant moved from words to letters.
  assert.equal(short.wps, 3.667);
  assert.equal(long.wps, 1.571);
  for (const d of [short, long]) {
    assert.ok(Math.abs(d.wps / d.expectedWps - 1) > 0.1, 'the old check would have fired');
  }
});
