/**
 * Drift — what the plan promised about length against what the audio measured
 * (plan item 4.3; audit S0-c and S6-d).
 *
 * The pipeline enforces its duration budget three times before a frame is drawn:
 * `critiqueLesson` rejects an estimate over `maxSeconds × 1.25`, `adaptLesson`
 * trims narration and drops droppable beats until the estimate fits, and the brief
 * states the budget to the model in words. Every one of those is arithmetic over
 * the *estimate*, and the estimate rests on one constant — `DELIVERED_LPS`, spoken
 * letters a second, measured over four films at one preset with one voice.
 *
 * It used to rest on `DELIVERED_WPS = 2.2`, measured once from one film, and this
 * advisory is what proved that number unfixable: it fired on two of four corpus films,
 * for a reason no re-measurement could reach. Words a second is a property of a film's
 * vocabulary rather than of this pipeline — 1.98 for photosynthesis, 2.50 for gradient
 * descent, at the same speaking speed — so the unit changed and the check with it. See
 * `DELIVERED_LPS` in `planner/src/presets.ts` for the measurement and the argument.
 *
 * Nothing ever checked it again. That is the whole of the finding: a cadence-rate
 * change, a new gap table, a different engine or a slower language silently
 * invalidates the number every length decision in the pipeline is made with, and
 * the pipeline would go on cutting beats to fit a budget it was mis-measuring.
 * `narrate()` already measured the delivered *rate* against the teaching band —
 * but that is a question about the voice, not about the estimate.
 *
 * So this is one function, run on every render, that asks the two questions the
 * estimate cannot ask about itself:
 *
 *  - **Did the film come out inside its budget?** Measured runtime against
 *    `maxSeconds`, at `critiqueLesson`'s own 1.25× tolerance so the two agree
 *    about what "over" means. A breach past that is a fact about this film — the
 *    trimming ran and the film is still long — so it is a problem, not a taste.
 *  - **Is the constant still true?** Delivered spoken letters a second against
 *    `DELIVERED_LPS`, warned outside ±10%. Advisory on purpose: the film is fine,
 *    and what is wrong is a number in `presets.ts` that a person has to re-measure.
 *    An advisory is the mechanism the audit asked for, replacing a comment that
 *    said "re-measure this if the gaps change".
 *
 * Counting matches `lessonSeconds` exactly, because a comparison between two
 * conventions is not a measurement: the letters are `spokenLetters` of the authored
 * narration — the same function the estimate calls, in `@inkcast/core` so that it can be —
 * the seconds they are divided by are the measured *narration* (holds and the outro
 * excluded, since the estimate adds those on top), and the runtime compared against
 * the budget is the whole file — narration, holds and outro, the number a viewer
 * would get with a stopwatch.
 *
 * Deliberately pure and storyboard-shaped, so it can be computed on a cached voice
 * stage: `scene.durationSec` is a measurement that survives on disk, and a run that
 * re-used every clip still has to be able to say how long its film is.
 */
import { LETTERS_PER_WORD, spokenLetters } from './speech.js';
import { sceneLength, type Storyboard } from './storyboard.js';

/**
 * How far past its budget a film may measure before that is a problem.
 *
 * `critiqueLesson`'s own number (`core/src/lesson.ts`), and shared rather than
 * re-chosen: the estimate rejects a lesson at 1.25×, so a film that measures 1.3×
 * is one the same tolerance would have refused to plan. Two thresholds for one
 * question is how a budget becomes unenforceable.
 */
export const BUDGET_TOLERANCE = 1.25;

/**
 * How far the delivered rate may sit from the calibration before it is worth saying.
 *
 * Unchanged at ±10%, and it means something now. Against words a second this band was
 * breached by two of four corpus films for a reason no re-measurement could fix — their
 * vocabulary — so the advisory fired on films that were fine and would have gone on firing
 * whatever number was written in `presets.ts`. Against spoken letters a second the corpus
 * sits inside ±2.1%, so a breach is what it claims to be: the pipeline changed.
 */
export const PACE_TOLERANCE = 0.1;

/**
 * Words, for the reported `words`/`wps` pair only.
 *
 * No longer the count any decision is made from — `spokenLetters` is — but still the count
 * a person reads, so it stays exactly as it was rather than being re-derived.
 */
function wordsIn(text: string): number {
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu)?.length ?? 0;
}

export type Drift = {
  /** Runtime a stopwatch would give: narration, holds and outro. */
  measuredSec: number;
  /** Measured narration only — what the delivered rate is per. */
  spokenSec: number;
  /** Authored narration words. Reported because a person thinks in words. */
  words: number;
  /** Delivered words a second. 0 when nothing has been measured yet. */
  wps: number;
  /**
   * Spoken letters, counted as `lessonSeconds` counts them — see `spokenLetters`.
   *
   * This is the pair that carries the calibration; `words`/`wps` above are kept because
   * they are what a person reads and what every `pipeline.json` written before this
   * already speaks.
   */
  letters: number;
  /** Delivered spoken letters a second. The rate that holds still across films. */
  lps: number;
  /** The preset's target, when the caller knows one. */
  budgetSec?: number;
  /** `measuredSec / budgetSec`, rounded. Absent without a budget. */
  budgetRatio?: number;
  /**
   * Signed fraction the delivered rate sits from the expected one: +0.12 is 12% fast.
   *
   * Measured in letters, which is what the advisory fires on. It replaces `wpsDrift`
   * rather than sitting beside it: the same number under a words-shaped name would be a
   * record that lies about its own unit, and two drift figures for one question is how a
   * calibration becomes unarguable.
   */
  paceDrift: number;
  /** The rate the pipeline plans with, carried so the record says what it compared against. */
  expectedWps: number;
  /** The letters-a-second calibration `paceDrift` is against. See `DELIVERED_LPS`. */
  expectedLps: number;
  /** A budget breach past `BUDGET_TOLERANCE`. A fact about this film. */
  problems: string[];
  /** A calibration that no longer describes this pipeline. A fact about the constant. */
  advisories: string[];
};

export type DriftOptions = {
  /** The preset's `maxSeconds`, when the caller has a preset. */
  budgetSec?: number;
  /** `DELIVERED_WPS`, passed in because it is the planner's constant to own. */
  expectedWps: number;
  /**
   * `DELIVERED_LPS` — the calibration the advisory actually judges against.
   *
   * Optional so a caller that has not been updated still gets its numbers rather than an
   * error, and then it is derived from `expectedWps` at `LETTERS_PER_WORD`. That fallback
   * is a conversion, not a second measurement, and it is only ever right for a film of
   * average vocabulary — which is the assumption this whole item exists to stop making
   * silently. Pass the real constant.
   */
  expectedLps?: number;
};

/**
 * Measure a rendered storyboard against the plan that budgeted it.
 *
 * Returns numbers always and complains rarely — the numbers are the point, and
 * they belong in the record whether or not they breach anything. A film with no
 * measured audio yet (no `durationSec` anywhere) reports zeros and says nothing:
 * there is no drift in a film that has not been spoken.
 */
export function measureDrift(sb: Storyboard, opts: DriftOptions): Drift {
  const spokenSec = round3(sb.scenes.reduce((t, s) => t + (s.durationSec ?? 0), 0));
  const measuredSec = round3(sb.scenes.reduce((t, s) => t + sceneLength(s), 0) + sb.meta.outroSec);
  const words = sb.scenes.reduce((t, s) => t + wordsIn(s.narration), 0);
  const letters = sb.scenes.reduce((t, s) => t + spokenLetters(s.narration), 0);
  const wps = spokenSec > 0 ? round3(words / spokenSec) : 0;
  const lps = spokenSec > 0 ? round3(letters / spokenSec) : 0;
  const expected = opts.expectedWps > 0 ? opts.expectedWps : 1;
  const expectedLps =
    opts.expectedLps && opts.expectedLps > 0
      ? opts.expectedLps
      : round3(expected * LETTERS_PER_WORD);
  const paceDrift = spokenSec > 0 ? round3(lps / expectedLps - 1) : 0;
  const budgetRatio =
    opts.budgetSec && opts.budgetSec > 0 ? round3(measuredSec / opts.budgetSec) : undefined;

  const problems: string[] = [];
  const advisories: string[] = [];

  if (budgetRatio !== undefined && spokenSec > 0 && budgetRatio > BUDGET_TOLERANCE) {
    problems.push(
      `the film measures ${measuredSec.toFixed(1)}s against a ${opts.budgetSec}s target ` +
        `(${Math.round(budgetRatio * 100)}% of it) — past the ${BUDGET_TOLERANCE}× the lesson ` +
        'critique would have refused to plan, so the trimming ran and the film is still long',
    );
  }

  // Only worth asking of a film with enough speech in it to measure a rate: a
  // fifteen-second short delivers whatever its two sentences happen to deliver.
  //
  // Judged in letters, and the words are quoted alongside rather than instead: a reader
  // who sees "9.1 letters a second" and nothing else cannot tell whether that is a film
  // with long words or a pipeline that slowed down, and the whole value of this advisory
  // is that it now separates those two.
  if (spokenSec > 20 && Math.abs(paceDrift) > PACE_TOLERANCE) {
    advisories.push(
      `delivered ${lps.toFixed(2)} spoken letters a second over ${spokenSec.toFixed(1)}s of ` +
        `narration, against the ${expectedLps} this pipeline plans with ` +
        `(${paceDrift > 0 ? '+' : ''}${Math.round(paceDrift * 100)}%) — every length decision ` +
        `upstream is made with that constant, so it wants re-measuring in presets.ts rather ` +
        `than trusting. (This film ran ${wps.toFixed(2)} words a second at ` +
        `${(letters / Math.max(1, words)).toFixed(2)} letters a word; word length is already ` +
        'divided out of the figure above, so this is the pipeline and not the vocabulary.)',
    );
  }

  return {
    measuredSec,
    spokenSec,
    words,
    wps,
    letters,
    lps,
    ...(opts.budgetSec === undefined ? {} : { budgetSec: opts.budgetSec }),
    ...(budgetRatio === undefined ? {} : { budgetRatio }),
    paceDrift,
    expectedWps: expected,
    expectedLps,
    problems,
    advisories,
  };
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
