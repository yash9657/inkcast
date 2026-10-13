import type { QcCheck, Storyboard } from '@inkcast/core';
import type { RenderPlan } from './types.js';

/** Check the rendered schedule, after the pen queue, against spoken label cues. */
export function speechSyncCheck(sb: Storyboard, plan: RenderPlan): QcCheck {
  const findings: string[] = [];
  let count = 0,
    worst = 0;
  for (const [i, scene] of sb.scenes.entries()) {
    for (const element of scene.elements) {
      if (element.motion || !element.enter.cue || element.enter.cueWord === undefined) continue;
      if (element.type !== 'text' && element.type !== 'equation') continue;
      const word = scene.words?.[element.enter.cueWord];
      const item = plan.items.find((p) => p.scene === i && p.id === element.id);
      if (!word || !item || !plan.scenes[i]) continue;
      const lag = item.start - plan.scenes[i]!.start - word.start;
      count++;
      worst = Math.max(worst, Math.abs(lag));
      if (Math.abs(lag) > 1)
        findings.push(
          `${scene.id}/${element.id}: ${element.type === 'text' ? `label "${element.text}"` : 'equation'} starts ${Math.abs(lag).toFixed(2)}s ${lag < 0 ? 'before' : 'after'} its spoken cue "${element.enter.cue}".`,
        );
    }
  }
  return {
    id: 'speech-visual-sync',
    tier: 1,
    status: count === 0 ? 'skip' : findings.length ? 'warn' : 'pass',
    findings,
    note: count
      ? `${count} label/equation cues checked against the rendered schedule; maximum absolute start offset ${worst.toFixed(3)}s. This measures cue placement, not perceptual speech quality.`
      : 'No measured word-indexed label or equation cues to check.',
  };
}
