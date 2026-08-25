/**
 * `check(sb, dir, opts)` — the quality gate, as a stage (plan item 3.1; audit S9-a,
 * S9-b).
 *
 * Everything this stage asserts was already asserted somewhere. The board sweeps run
 * inside `compilePlan`, the board graph is checkable by `critiqueStoryboard`, and the
 * lesson has been critiqued since the lesson stage existed. What did not exist was a
 * *stage*: a named step, between visuals and render, that runs all of them together,
 * writes down what it found, and refuses to let the encode start on a board it knows
 * is wrong. Three things follow from making it one, and they are the whole point:
 *
 *  1. **It fails before the expensive part.** `compilePlan`'s own gate fires inside
 *     `render()`, after Chromium has launched and the font has resolved; this fires
 *     before either. On a strict run the difference is a second instead of a minute,
 *     which is the difference between a gate people keep on and a gate people turn
 *     off.
 *  2. **The verdict is an artefact.** `qc.json` outlives the terminal. "Was this film
 *     checked, and what did the checks say" is answerable a week later, which it was
 *     not when every verdict was a log line (see `core/src/qc.ts`).
 *  3. **It is the one place the whole board is judged.** Geometry, the reference
 *     graph, the pedagogy critique and whatever earlier stages degraded on all land
 *     in one report, so nothing is checked twice and nothing falls between stages.
 *
 * ## What it deliberately does not do
 *
 * **It never calls a model, and never retries one.** A structural failure names the
 * beat and stops. The repair loops in this pipeline live upstream, where repair is
 * cheap and the thing being repaired is still soft — the lesson author revises
 * against `critiqueLesson`, the drawing critic redraws a picture it has looked at. A
 * gate that re-prompts is the infinite-repair trap the audit's own S9.10 warns about:
 * it converts "this board is wrong" into "we spent nine model calls and the board is
 * still wrong, differently".
 *
 * **It does not compile a plan anybody uses.** It compiles one to measure — `quiet`,
 * so the compiler reports instead of saying anything, since the saying belongs to
 * whoever owns the verdict — and throws the plan away. The render compiles its own,
 * deterministically, from the same storyboard, so they are the same plan; and it gates
 * again at the encode. Two gates on one fact is not duplication here: this one is
 * early and writes the record, that one is the last thing before pixels and catches a
 * render driven directly, without this stage.
 *
 * ## The one check that costs a browser
 *
 * Everything above is arithmetic. The realized-layout sweep (plan 2.7) is not: the
 * browser's shrink-to-fit is invisible to the solver, so the only way to know what was
 * really lettered is to open the page and ask. That is one Chromium launch and about a
 * second, with no key and no network, and it belongs here rather than only in
 * `render()` for the plainest possible reason — it is the check most likely to fail,
 * because it is the only one measuring reality instead of intent, and catching it here
 * saves the whole encode. Where Chromium is not installed it *skips*, with the reason
 * recorded: a report that could not look at the layout must not read as one that did.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  critiqueStoryboard,
  gate,
  logger,
  qcCheck,
  qcReport,
  qcSkip,
  describeQc,
  type GateMode,
  type QcCheck,
  type QcReport,
  type Storyboard,
} from '@inkcast/core';
import { densityWarnings, realizedTextViolations, type BoardViolation } from './boardcheck.js';
import { chromiumAvailable, launchChromium, openCapture } from './browser.js';
import { compileBoard } from './compile.js';
import { resolveFont } from './font.js';
import { buildPageHtml } from './html.js';
import {
  captureSamples,
  inkFloorViolations,
  inkNote,
  ocrDiff,
  reportTier2,
  visionViolations,
  type FrameSample,
  type FrameVerdict,
  type VisionPass,
} from './tier2.js';
import type { RenderPlan } from './types.js';

const log = logger('check');

/** Where the report goes, relative to the project directory. */
export const QC_FILE = 'qc.json';

/**
 * A verdict an earlier stage already reached, folded into this report.
 *
 * The lesson critique is the standing example: it runs at the top of `cast()`, before
 * a board exists, and its problems used to live only in `pipeline.json`. They are
 * advisory here and stay advisory — the lesson stage gates itself, and a lesson that
 * survived its own author's revision pass is not something to stop a render over —
 * but they belong in the same file as everything else, because the question "what is
 * wrong with this film" has one answer.
 */
export type InheritedProblems = {
  /** Check id in the report, e.g. `lesson` or `planner`. */
  id: string;
  findings: string[];
  /** Defaults to `warn`. Only pass `fail` for something that must block. */
  severity?: 'fail' | 'warn';
  note?: string;
};

export type CheckOptions = {
  gates?: GateMode;
  /** Verdicts from earlier stages. See `InheritedProblems`. */
  inherited?: InheritedProblems[];
  /** Skip writing `qc.json` — for callers that only want the verdict. */
  write?: boolean;
  /**
   * `false` leaves the realized-layout sweep unrun, recorded as skipped.
   *
   * For tests and tools that want the arithmetic without a Chromium launch. Not a
   * production posture: the check it drops is the one that measures what was really
   * lettered, and `qc.json` says plainly that it did not run.
   */
  layout?: boolean;
  /** Explicit handwriting font file, as `render()` takes one. */
  fontPath?: string;
  /**
   * The keyed half of Tier 2 (plan 3.3): a model that looks at the sampled frames.
   *
   * Injected rather than imported, for the reason `tier2.ts` gives at length — this
   * package must stay renderable on a machine with no keys. Absent means Tier 2's
   * *pixel* half still runs (it is free) and its vision and OCR checks are recorded as
   * skipped, with the reason.
   */
  vision?: VisionPass;
};

/** Violations of one kind, as one check. */
function of(violations: readonly BoardViolation[], kind: BoardViolation['kind']): string[] {
  return violations.filter((v) => v.kind === kind).map((v) => v.message);
}

export async function check(
  sb: Storyboard,
  dir: string,
  opts: CheckOptions = {},
): Promise<QcReport> {
  // `degrade`, always: this function decides what blocks, and a compiler that threw
  // partway through would leave the other checks unrun and the report unwritten —
  // which is the log-line behaviour this stage exists to replace.
  const { plan, report } = compileBoard(sb, dir, { gates: 'degrade', quiet: true });

  const checks: QcCheck[] = [
    qcCheck('storyboard', critiqueStoryboard(sb)),
    qcCheck('ink-on-ink', of(report.blocking, 'ink-on-ink')),
    qcCheck('off-frame', of(report.blocking, 'off-frame')),
    qcCheck('overrun', of(report.blocking, 'overrun')),
    qcCheck('illegible', of(report.blocking, 'illegible')),
    qcCheck('vacant', report.vacancy ? [report.vacancy.message] : [], {
      note: fillNote(report.fill),
    }),
    // The advisory half. `off-frame-derived` is a different check from `off-frame`
    // above and not a softer reading of it: a derived camera trading the oldest ink
    // for a legible close-up is the framing solver doing its job, and an authored
    // camera that misses is somebody's mistake.
    qcCheck('off-frame-derived', of(report.advisories, 'off-frame'), { severity: 'warn' }),
    qcCheck('dwell', of(report.advisories, 'dwell'), { severity: 'warn' }),
    // Thin fill on a board that cleared the vacancy floor, and which of fill's two
    // factors is the thin one (plan 9.3). A judgement, so `warn`: `vacant` above is
    // the fact, and the two disagree by design — 8.1's longitude cast passed the
    // floor at 20.3% while this said the deficit was the drawing, and only the
    // terminal ever heard it.
    qcCheck('thin-fill', report.thinFill, { severity: 'warn' }),
    qcCheck(
      'crowded',
      densityWarnings(sb.scenes).map((v) => v.message),
      { severity: 'warn' },
    ),
  ];
  for (const extra of opts.inherited ?? []) {
    checks.push(
      qcCheck(extra.id, extra.findings, {
        severity: extra.severity ?? 'warn',
        ...(extra.note === undefined ? {} : { note: extra.note }),
      }),
    );
  }

  const looked = await lookAtFrames(sb, dir, plan, opts);
  checks.push(...looked.checks);

  const out = qcReport(opts.gates ?? 'degrade', checks, {
    fill: report.fill,
    tier2: looked.tier2,
  });
  if (opts.write !== false) {
    await writeFile(path.resolve(dir, QC_FILE), JSON.stringify(out, null, 2));
  }

  if (out.advisories.length > 0) {
    const shown = out.advisories.slice(0, 3);
    const more = out.advisories.length - shown.length;
    log.warn(
      `${out.advisories.length} advisor${out.advisories.length === 1 ? 'y' : 'ies'}:\n  - ` +
        shown.join('\n  - ') +
        (more > 0 ? `\n  … and ${more} more` : ''),
    );
  }
  if (!out.ok) {
    // Through the gate, like every other assertion in this repo, so `--degrade` stays
    // the one escape and the message format stays uniform. The report on disk records
    // the posture it was written under, so a `degrade` run's `ok: false` is not
    // mistakable for a run that was never checked.
    gate(opts.gates, describeQc(out), (m) => log.warn(m));
  } else {
    log.info(`quality gate passed — ${checks.length} checks, ${QC_FILE} written`);
  }
  return out;
}

/**
 * Everything that needs the page open: the realized-layout sweep (plan 2.7) and Tier 2
 * (plan 3.3). One Chromium launch for all of it, because launching is the whole cost.
 *
 * All three checks skip rather than fail when the page cannot be opened, and each skip
 * carries its reason — a report that could not look must never read as one that looked
 * and found nothing. The board that would be lettered by an unmeasured system face is a
 * skip too: sizes measured against a face the film will not use describe a different
 * film. A missing font is the render's own gate to fail on (1.4), not this one's.
 */
async function lookAtFrames(
  sb: Storyboard,
  dir: string,
  plan: RenderPlan,
  opts: CheckOptions,
): Promise<{ checks: QcCheck[]; tier2: string }> {
  const skipAll = (why: string): { checks: QcCheck[]; tier2: string } => ({
    checks: [
      qcSkip('realized-layout', why),
      qcSkip('ink-floor', why, 2),
      qcSkip('frame-vision', why, 2),
      qcSkip('ocr-diff', why, 2),
    ],
    tier2: `skipped: ${why}`,
  });
  if (opts.layout === false) return skipAll('skipped by the caller');
  if (!chromiumAvailable()) {
    return skipAll('Chromium is not installed — the page was never opened');
  }
  const font = resolveFont(sb.meta.style, dir, opts.fontPath, 'degrade');
  if (!font.file) {
    return skipAll(
      'no handwriting font resolved — the layout would be measured against a face the ' +
        'film will not be lettered in',
    );
  }

  const html = buildPageHtml(plan, { mode: 'capture', fontCss: font.css, title: sb.title });
  const browser = await launchChromium();
  try {
    const probe = await openCapture(browser, plan.frame, html);
    let realized: QcCheck;
    try {
      realized = qcCheck(
        'realized-layout',
        realizedTextViolations(await probe.realizedLayout(), plan).map((v) => v.message),
      );
    } finally {
      await probe.close();
    }

    // The pixel half: free, so it always runs. This is the ungameable measure beside
    // the bbox fill gate, and the two disagreeing is a signal rather than noise.
    const samples = await captureSamples(browser, plan, html);
    const checks: QcCheck[] = [
      realized,
      qcCheck(
        'ink-floor',
        inkFloorViolations(samples).map((v) => v.message),
        { tier: 2, ...(inkNote(samples) === undefined ? {} : { note: inkNote(samples) }) },
      ),
    ];

    const asked = await visionVerdicts(samples, opts);
    if ('why' in asked) {
      checks.push(qcSkip('frame-vision', asked.why, 2), qcSkip('ocr-diff', asked.why, 2));
      reportTier2(samples, 0);
      return { checks, tier2: `pixels only: ${asked.why}` };
    }
    const verdicts = asked.verdicts;
    // Advisory for one release, per the plan: a vision model's false-positive rate on
    // hand-drawn boards is unmeasured, and a blocking check with unmeasured false
    // positives teaches everyone to reach for `--degrade`.
    checks.push(
      qcCheck(
        'frame-vision',
        visionViolations(verdicts, samples).map((v) => v.message),
        { tier: 2, severity: 'warn', note: `${verdicts.length} frames answered for` },
      ),
      qcCheck(
        'ocr-diff',
        ocrDiff(verdicts, samples).map((v) => v.message),
        { tier: 2, severity: 'warn' },
      ),
    );
    reportTier2(samples, verdicts.length);
    return { checks, tier2: `run: ${samples.length} frames sampled, ${verdicts.length} answered` };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/**
 * The vision pass's answers, or why there are none.
 *
 * A provider failure costs the verdicts and not the run — the same posture as every
 * other keyed lane here. Reported as a skip with the reason rather than as an empty set
 * of findings, because "the model said nothing was wrong" and "the model was never
 * reached" are different facts and only one of them is reassuring. And the reason has to
 * be the *real* one: "no key" and "the key has no credit left" send the reader of
 * `qc.json` to two different places, and the second was being reported as the first.
 */
async function visionVerdicts(
  samples: readonly FrameSample[],
  opts: CheckOptions,
): Promise<{ verdicts: FrameVerdict[] } | { why: string }> {
  if (!opts.vision) {
    return { why: 'no vision pass configured — Tier 2 needs a key (ANTHROPIC_API_KEY)' };
  }
  if (samples.length === 0) return { why: 'no frames were captured' };
  try {
    const out = await opts.vision(samples);
    if (!Array.isArray(out)) return { why: 'the vision pass answered with nothing usable' };
    return { verdicts: out };
  } catch (err) {
    const why = `the vision pass failed: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`;
    log.warn(`the Tier-2 vision pass failed — the frames were not looked at`, err);
    return { why };
  }
}

/** The fill numbers, recorded whether or not they breached the floor. */
function fillNote(fill: readonly number[]): string | undefined {
  if (fill.length === 0) return undefined;
  const mean = fill.reduce((a, b) => a + b, 0) / fill.length;
  const min = Math.min(...fill);
  return `mean content fill ${(mean * 100).toFixed(1)}%, sparsest scene ${(min * 100).toFixed(1)}%`;
}
