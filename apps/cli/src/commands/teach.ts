/**
 * `inkcast teach "<topic>"` — the primary command.
 *
 * No document, no source material, no preparation: a topic is enough, because
 * "explain gradient descent to me" is what people actually want and requiring
 * them to write the explainer first defeats the point.
 *
 * It is a thin wrapper on the same pipeline `cast` drives — the only difference is
 * that the positional becomes `topic`, which the lesson stage takes directly.
 */
import type { CliContext } from '../env.js';
import { UsageError, type Flags } from '../main.js';
import { paint } from '../ui.js';
import { baseInput, runCast } from './cast.js';

export async function teachCommand(
  ctx: CliContext,
  positionals: string[],
  flags: Flags,
): Promise<number> {
  const topic = positionals.join(' ').trim();
  if (topic === '') {
    throw new UsageError('what should I teach? e.g. `inkcast teach "gradient descent"`');
  }
  if (topic.length < 3) {
    throw new UsageError(`"${topic}" is too short to be a topic.`);
  }

  const c = paint(ctx.color);
  if (!ctx.json && !ctx.quiet && !flags.objective) {
    // The objective is the acceptance test for the video; a good one measurably
    // improves the lesson, so it is worth one line telling people it exists.
    process.stdout.write(
      `${c.dim('tip: --objective "explain why the update has a minus sign" makes the lesson aim at something checkable.')}\n`,
    );
  }

  return runCast(ctx, { ...baseInput(flags), topic }, flags);
}
