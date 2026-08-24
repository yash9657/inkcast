/**
 * Drift — what the plan promised about length against what the audio measured
 * (plan item 4.3; audit S0-c and S6-d).
 *
 * The pipeline enforces its duration budget three times before a frame is drawn:
 * `critiqueLesson` rejects an estimate over `maxSeconds × 1.25`, `adaptLesson`
 * trims narration and drops droppable beats until the estimate fits, and the brief
 * states the budget to the model in words. Every one of those is arithmetic over
 * the *estimate*, and the estimate rests on one constant — `DELIVERED_WPS = 2.2`,
 * measured once, from one film, at one preset, with one voice.
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
 *  - **Is the constant still true?** Delivered words a second against
 *    `DELIVERED_WPS`, warned outside ±10%. Advisory on purpose: the film is fine,
 *    and what is wrong is a number in `presets.ts` that a person has to re-measure.
 *    An advisory is the mechanism the audit asked for, replacing a comment that
 *    said "re-measure this if the gaps change".
 *
 * Counting matches `lessonSeconds` exactly, because a comparison between two
 * conventions is not a measurement: words are the authored narration's words, the
 * seconds they are divided by are the measured *narration* (holds and the outro
 * excluded, since the estimate adds those on top), and the runtime compared against
 * the budget is the whole file — narration, holds and outro, the number a viewer
 * would get with a stopwatch.
 *
 * Deliberately pure and storyboard-shaped, so it can be computed on a cached voice
 * stage: `scene.durationSec` is a measurement that survives on disk, and a run that
 * re-used every clip still has to be able to say how long its film is.
 */
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

/** How far the delivered rate may sit from the calibration before it is worth saying. */
export const WPS_TOLERANCE = 0.1;

/** Words the way `lessonSeconds` counts them — the count the budget was set in. */
function wordsIn(text: string): number {
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu)?.length ?? 0;
}

export type Drift = {
  /** Runtime a stopwatch would give: narration, holds and outro. */
  measuredSec: number;
  /** Measured narration only — what the delivered rate is per. */
  spokenSec: number;
  /** Authored narration words, counted as `lessonSeconds` counts them. */
  words: number;
  /** Delivered words a second. 0 when nothing has been measured yet. */
  wps: number;
  /** The preset's target, when the caller knows one. */
  budgetSec?: number;
  /** `measuredSec / budgetSec`, rounded. Absent without a budget. */
  budgetRatio?: number;
  /** Signed fraction the delivered rate sits from the expected one: +0.12 is 12% fast. */
  wpsDrift: number;
  /** The rate the pipeline plans with, carried so the record says what it compared against. */
  expectedWps: number;
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
  const wps = spokenSec > 0 ? round3(words / spokenSec) : 0;
  const expected = opts.expectedWps > 0 ? opts.expectedWps : 1;
  const wpsDrift = spokenSec > 0 ? round3(wps / expected - 1) : 0;
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
  if (spokenSec > 20 && Math.abs(wpsDrift) > WPS_TOLERANCE) {
    advisories.push(
      `delivered ${wps.toFixed(2)} words a second over ${spokenSec.toFixed(1)}s of narration, ` +
        `against the ${expected} this pipeline plans with (${wpsDrift > 0 ? '+' : ''}` +
        `${Math.round(wpsDrift * 100)}%) — every length decision upstream is made with that ` +
        'constant, so it wants re-measuring in presets.ts rather than trusting',
    );
  }

  return {
    measuredSec,
    spokenSec,
    words,
    wps,
    ...(opts.budgetSec === undefined ? {} : { budgetSec: opts.budgetSec }),
    ...(budgetRatio === undefined ? {} : { budgetRatio }),
    wpsDrift,
    expectedWps: expected,
    problems,
    advisories,
  };
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
