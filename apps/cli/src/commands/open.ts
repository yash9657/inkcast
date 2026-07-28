/** `inkcast open <id>` — print what a project is and hand the video to the OS. */
import { loadStoryboard, sceneOffsets, totalDuration } from '@inkcast/core';
import { formatCost, readState } from '@inkcast/pipeline';
import type { CliContext } from '../env.js';
import { clock, paint } from '../ui.js';
import { openInOs, pretty, resolveProject } from './shared.js';

export async function openCommand(ctx: CliContext, id: string | undefined): Promise<number> {
  const c = paint(ctx.color);
  const project = await resolveProject(id);
  const state = await readState(project.dir);

  if (ctx.json) {
    process.stdout.write(`${JSON.stringify({ ...project, state }, null, 2)}\n`);
  } else {
    let out = `\n${c.bold(project.title)} ${c.dim(`· ${project.id}`)}\n\n`;
    out += `  ${c.dim('dir'.padEnd(10))}${pretty(ctx, project.dir)}\n`;
    out += `  ${c.dim('video'.padEnd(10))}${project.videoPath ? pretty(ctx, project.videoPath) : c.yellow('not rendered yet')}\n`;
    out += `  ${c.dim('runtime'.padEnd(10))}${clock(project.durationSec)} over ${project.scenes} scenes\n`;
    out += `  ${c.dim('cost'.padEnd(10))}${formatCost(project.cost)}\n`;
    if (state?.source) {
      const ref =
        state.source.kind === 'text'
          ? `${state.source.ref.length} chars of text`
          : state.source.ref;
      out += `  ${c.dim('source'.padEnd(10))}${state.source.kind}: ${ref.slice(0, 80)}\n`;
    }

    try {
      const sb = await loadStoryboard(project.dir);
      const offsets = sceneOffsets(sb);
      out += `\n${c.dim('  scenes')}\n`;
      sb.scenes.forEach((scene, i) => {
        out += `  ${c.dim(clock(offsets[i] ?? 0).padStart(6))}  ${c.bold(scene.id)}  ${trim(scene.narration, 74)}\n`;
      });
      out += `  ${c.dim(clock(totalDuration(sb)).padStart(6))}  ${c.dim('end')}\n`;
    } catch {
      out += `\n  ${c.yellow('storyboard.json is missing or invalid')}\n`;
    }
    process.stdout.write(`${out}\n`);
  }

  if (!project.videoPath) {
    process.stderr.write(
      `No video yet — run ${paint(ctx.color).cyan(`inkcast rerender ${project.id}`)}.\n`,
    );
    return 1;
  }
  openInOs(project.videoPath);
  return 0;
}

function trim(s: string, n: number): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length <= n ? flat : `${flat.slice(0, n - 1)}…`;
}
