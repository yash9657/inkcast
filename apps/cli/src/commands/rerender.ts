/**
 * `inkcast rerender <id>` — rebuild the video from the saved storyboard.
 *
 * Scenes whose narration changed are re-voiced, assets that already have artwork
 * are left alone, and the frames are captured again. This is the loop you sit in
 * while editing, so it has to be the cheap path.
 */
import { totalDuration } from '@inkcast/core';
import { formatCost, rerender } from '@inkcast/pipeline';
import type { CliContext } from '../env.js';
import type { Flags } from '../main.js';
import { clock, paint, reporter, secs } from '../ui.js';
import { openInOs, pretty, resolveProject } from './shared.js';

export async function rerenderCommand(
  ctx: CliContext,
  id: string | undefined,
  flags: Flags,
): Promise<number> {
  const c = paint(ctx.color);
  const project = await resolveProject(id);
  const rep = reporter(ctx);
  const started = Date.now();

  process.once('SIGINT', () => {
    rep.stop();
    process.exit(1);
  });

  try {
    const result = await rerender(project.id, {
      onProgress: rep.progress,
      ...(flags.force ? { force: true } : {}),
    });
    rep.stop();

    if (ctx.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            ok: true,
            projectId: result.projectId,
            videoPath: result.videoPath,
            durationSec: totalDuration(result.storyboard),
            cost: result.cost,
          },
          null,
          2,
        )}\n`,
      );
    } else if (!ctx.quiet) {
      const sb = result.storyboard;
      process.stdout.write(
        `\n${c.green('✔')} ${c.bold(sb.title)} ${c.dim(`· ${clock(totalDuration(sb))} · ${secs(Date.now() - started)}`)}\n` +
          `  ${c.dim('video'.padEnd(10))}${pretty(ctx, result.videoPath)}\n` +
          `  ${c.dim('cost'.padEnd(10))}${formatCost(result.cost)}\n\n`,
      );
    }
    if (flags.open) openInOs(result.videoPath);
    return 0;
  } catch (err) {
    rep.stop();
    if (ctx.json) {
      process.stdout.write(
        `${JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }, null, 2)}\n`,
      );
      return 1;
    }
    throw err;
  }
}
