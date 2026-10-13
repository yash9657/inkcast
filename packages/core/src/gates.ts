/**
 * The enforcement posture for quality gates: `strict` or `degrade`.
 *
 * The audit (`docs/AUDIT-FINDINGS.md`, S4-g) found that the pipeline already
 * *computes* most of its quality guarantees — fill ratio, glyph coverage, cue
 * resolution, font resolution — and then logs and continues, so every shipped
 * defect it documents rode through a warning. This type is the fix's vocabulary:
 * one flag, threaded from `cast()` into every stage, that promotes the named
 * warn sites to errors that stop before the encode.
 *
 * Two rules keep it honest:
 *
 *  - **The pipeline defaults to `strict`; the stages default to `degrade`.**
 *    A product run should never ship a defect it detected, but a stage called
 *    directly — a test, a fixture tool, a sheet script — keeps today's behaviour
 *    unless it asks for the gate. That is why `gateMode()` treats `undefined`
 *    as `degrade`: the caller that owns the run opts in.
 *  - **`degrade` is loud, never silent.** Every gated site that continues must
 *    warn and, where the caller persists problems, land in `problems[]`. The
 *    escape hatch exists so a demo is never blocked while the real thing is
 *    fixed — not so the defect disappears.
 */
export type GateMode = 'strict' | 'degrade';

export function isGateMode(value: unknown): value is GateMode {
  return value === 'strict' || value === 'degrade';
}

/**
 * Enforce one gate: throw under `strict`, warn under `degrade` (or when no mode
 * was threaded — see the module header for why absence means today's behaviour).
 *
 * The thrown message names the escape hatch, because the person it stops is
 * mid-render and the alternative is them reading this file.
 */
export function gate(
  mode: GateMode | undefined,
  message: string,
  warn: (msg: string) => void,
): void {
  if (mode === 'strict') {
    throw new Error(
      `${message} — blocked by the strict quality gate. Fix the input, or pass ` +
        `gates: 'degrade' (CLI: --degrade) to render anyway; the defect is then ` +
        'recorded instead of blocking.',
    );
  }
  warn(message);
}
