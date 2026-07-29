/**
 * Saying out loud when a stage is running in its lesser mode.
 *
 * Inkcast works with no keys and that is worth keeping, but the MVP turned it
 * into a marketing line — "$0.00/min" — while the zero-key path shipped a video
 * that taught nothing. The honest version is this: the local path is a *fallback*,
 * it is visibly worse for two stages, and the user should be told which command
 * fixes it rather than left to infer it from a quality they cannot name.
 *
 * Rules for what belongs here:
 *  - Only report a stage that is genuinely *degraded*, not merely local. Kokoro is
 *    a good local voice; `say` is not. The built-in icon set is fine for arrows
 *    and boxes and hopeless for a drawn character.
 *  - Every entry carries exactly one command that fixes it. "Set an API key" is
 *    not actionable; `inkcast keys set anthropic` is.
 */

import type { StageName } from './progress.js';
import type { Providers } from './providers.js';

export type Degradation = {
  stage: StageName;
  /** What is missing, in the user's terms. */
  missing: string;
  /** What runs instead, and why that is worse. Written to be read aloud. */
  effect: string;
  /** The single command that fixes it. */
  fix: string;
  /**
   * `major` means the output is meaningfully worse than what Inkcast can do —
   * worth interrupting for. `minor` is a nice-to-have.
   */
  severity: 'major' | 'minor';
};

/**
 * Which stages are running degraded, in the order they will run.
 *
 * Two suppressions, both about not lying: `via: 'document'` does not even attempt
 * to teach, and a supplied lesson never reaches the lesson author — blaming a
 * missing key for either would send the user to buy something that changes
 * nothing about their output.
 */
export function degradations(
  p: Providers,
  opts: { via?: 'lesson' | 'document'; lessonSupplied?: boolean } = {},
): Degradation[] {
  const out: Degradation[] = [];

  if (!p.planner.cloud && opts.via !== 'document' && !opts.lessonSupplied) {
    out.push({
      stage: 'lesson',
      missing: 'no Anthropic key',
      effect:
        'the lesson is derived from structure rather than taught from first principles — no ' +
        'invented anchor, no worked example, no named misconception. This is the biggest ' +
        'single quality difference in Inkcast.',
      fix: 'inkcast keys set anthropic',
      severity: 'major',
    });
  }

  if (p.voice.name === 'say') {
    out.push({
      stage: 'voice',
      missing: 'no local Kokoro voice available',
      effect:
        'narration is coming from the macOS `say` command, which is a build-verification voice. ' +
        'Nobody will watch a teaching video read by it.',
      fix: 'inkcast cast … --voice af_heart',
      severity: 'major',
    });
  } else if (!p.voice.cloud) {
    out.push({
      stage: 'voice',
      missing: 'no ElevenLabs key',
      effect:
        'narrating locally with Kokoro, which is genuinely listenable. A cloud voice is worth ' +
        'a fraction of a cent for anything you publish.',
      fix: 'inkcast keys set elevenlabs',
      severity: 'minor',
    });
  }

  if (!p.images.cloud) {
    out.push({
      stage: 'visuals',
      missing: 'no image model key',
      effect:
        'plots, paths and diagrams are unaffected, but illustrated objects and characters fall ' +
        'back to the built-in icon set — there is no icon for a Greek hero.',
      fix: 'inkcast keys set replicate',
      severity: 'minor',
    });
  }

  return out;
}

/** One-line rendering, for logs and non-interactive output. */
export function formatDegradation(d: Degradation): string {
  return `${d.stage}: ${d.missing} — ${d.effect} Fix: ${d.fix}`;
}
