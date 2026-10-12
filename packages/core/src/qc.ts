/**
 * `qc.json` — what the quality gate found, as an artefact (plan item 3.1; audit
 * S9-a/S9-b).
 *
 * The audit's finding was not that the pipeline fails to notice defects. It notices
 * nearly all of them: fill, cue misses, font fallbacks, equation fallbacks, overlap,
 * off-frame ink, illegible type. What it did not have was a *place to say so* that
 * outlives the run — every verdict was a log line inside a four-minute render, and a
 * log line is gone the moment the terminal scrolls. So there was no way to ask "was
 * this film checked, and what did the checks say", which is the question a QC stage
 * exists to answer.
 *
 * This file is only the contract, and it lives in core for the reason every contract
 * here does: the renderer writes it, the pipeline reads it to decide whether a render
 * may start, and the studio displays it — three packages that must not import each
 * other. The checks themselves live where the truth is (`render/src/boardcheck.ts`
 * for geometry, `critiqueStoryboard` for the board graph).
 *
 * ## Two tiers, one file
 *
 * **Tier 1** is arithmetic over the IR: free, deterministic, always run. **Tier 2**
 * looks at rendered frames with a model and costs money, so it is keyed, cached, and
 * skipped with a reason when there is no key — the same posture as every other keyed
 * lane in this repo. A report with `tier2: 'skipped'` is not a report that passed
 * Tier 2, and the field exists so nobody can read it as one.
 *
 * ## Status, and what blocks
 *
 * A check is `pass`, `warn`, `fail` or `skip`, and **only `fail` blocks**. The split
 * is not severity-by-feel: a `fail` is a statement of fact about the board that is
 * wrong however you look at it (ink written through other ink, a reference to an
 * element that does not exist, type below the legibility floor), and a `warn` is a
 * judgement that could reasonably go the other way (nine reveals in one beat, a
 * derived camera that let old ink scroll off, thin dwell). Mixing them is how a gate
 * becomes something everyone passes with `--degrade`.
 */
import type { GateMode } from './gates.js';

/** Bump when the shape below changes in a way a reader has to know about. */
export const QC_VERSION = 1;

export type QcStatus = 'pass' | 'warn' | 'fail' | 'skip';

/** Which tier a check belongs to: 1 is free arithmetic, 2 costs a model call. */
export type QcTier = 1 | 2;

export type QcCheck = {
  /** Stable slug — `ink-on-ink`, `storyboard`, `vacant`, `frame-vision`. */
  id: string;
  tier: QcTier;
  status: QcStatus;
  /** One line per finding, already human-readable. Empty on a pass or a skip. */
  findings: string[];
  /** Why it skipped, or what the numbers were. Always present on a `skip`. */
  note?: string;
};

export type QcReport = {
  version: number;
  /** The posture the check ran under. `degrade` means a `fail` did not block. */
  gates: GateMode;
  /** False when any check failed — the one field a caller has to read. */
  ok: boolean;
  checks: QcCheck[];
  /** Every `fail` finding, flattened, ready for `problems[]`. */
  problems: string[];
  /** Every `warn` finding, flattened. Said out loud, never blocking. */
  advisories: string[];
  /** Per-scene content fill as the compiler measured it, for the record. */
  fill?: number[];
  /** Present once Tier 2 exists: `run`, or why it did not. */
  tier2?: string;
  /** Check coverage, distinct from `ok` (which only means no blocking failure). */
  verification?: {
    state: 'failed' | 'incomplete' | 'advisories' | 'checked';
    skipped: string[];
    warnings: string[];
    /** No visual/layout check proves factual correctness. */
    semantics: 'not-checked' | 'checked';
  };
};

/** The checks that failed. */
export function failed(report: QcReport): QcCheck[] {
  return report.checks.filter((c) => c.status === 'fail');
}

/**
 * Assemble a report from its checks, deriving the roll-up fields.
 *
 * Here rather than at the call site so `ok`, `problems` and `advisories` cannot
 * disagree with `checks` — a report whose `ok` is true beside a failing check is
 * worse than no report, because everything downstream reads the summary.
 */
export function qcReport(
  gates: GateMode,
  checks: QcCheck[],
  extra: Partial<QcReport> = {},
): QcReport {
  const of = (status: QcStatus): string[] =>
    checks.filter((c) => c.status === status).flatMap((c) => c.findings);
  return {
    version: QC_VERSION,
    gates,
    ok: !checks.some((c) => c.status === 'fail'),
    checks,
    problems: of('fail'),
    advisories: of('warn'),
    ...extra,
    verification: {
      state: checks.some((c) => c.status === 'fail')
        ? 'failed'
        : checks.some((c) => c.status === 'skip')
          ? 'incomplete'
          : checks.some((c) => c.status === 'warn')
            ? 'advisories'
            : 'checked',
      skipped: checks.filter((c) => c.status === 'skip').map((c) => c.id),
      warnings: checks.filter((c) => c.status === 'warn').map((c) => c.id),
      semantics: checks.some((c) => c.id === 'semantic-explanation' && c.status === 'pass')
        ? 'checked'
        : 'not-checked',
    },
  };
}

/**
 * One check, from its findings: `fail` when there are any, `pass` when there are not.
 *
 * `warn` is asked for explicitly (`severity: 'warn'`) because it is a decision about
 * the check, not about this run's findings — see the module header.
 */
export function qcCheck(
  id: string,
  findings: string[],
  opts: { tier?: QcTier; severity?: 'fail' | 'warn'; note?: string } = {},
): QcCheck {
  const status: QcStatus = findings.length === 0 ? 'pass' : (opts.severity ?? 'fail');
  return {
    id,
    tier: opts.tier ?? 1,
    status,
    findings,
    ...(opts.note === undefined ? {} : { note: opts.note }),
  };
}

/** A check that could not run, and why. Never reads as a pass. */
export function qcSkip(id: string, note: string, tier: QcTier = 1): QcCheck {
  return { id, tier, status: 'skip', findings: [], note };
}

/** The line a human wants when the gate stops a render. */
export function describeQc(report: QcReport): string {
  const bad = failed(report);
  if (bad.length === 0) {
    const skipped = report.checks.filter((c) => c.status === 'skip');
    const warned = report.checks.filter((c) => c.status === 'warn');
    if (skipped.length)
      return `no blocking failures; ${skipped.length} checks did not run (${skipped.map((c) => c.id).join(', ')})`;
    if (warned.length) return `no blocking failures; ${warned.length} checks reported advisories`;
    return 'the board passed the checks that ran; factual accuracy requires semantic review';
  }
  const total = bad.reduce((n, c) => n + c.findings.length, 0);
  return (
    `${total} quality problem${total === 1 ? '' : 's'} in ${bad.length} check` +
    `${bad.length === 1 ? '' : 's'} (${bad.map((c) => c.id).join(', ')}):\n` +
    bad.flatMap((c) => c.findings.map((f) => `  - [${c.id}] ${f}`)).join('\n')
  );
}
