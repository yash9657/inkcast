/** `inkcast list` — every project on disk, newest first. */
import { formatCost, listProjects } from '@inkcast/pipeline';
import type { CliContext } from '../env.js';
import { ago, clock, paint } from '../ui.js';
import { pretty } from './shared.js';

export async function listCommand(ctx: CliContext): Promise<number> {
  const c = paint(ctx.color);
  const projects = await listProjects();

  if (ctx.json) {
    process.stdout.write(`${JSON.stringify(projects, null, 2)}\n`);
    return 0;
  }
  if (projects.length === 0) {
    process.stdout.write(
      `No projects yet. Make one:\n  ${c.cyan('inkcast teach "gradient descent"')}\n`,
    );
    return 0;
  }

  const titleWidth = Math.min(
    40,
    Math.max(5, ...projects.map((p) => Math.min(p.title.length, 40))),
  );
  const head = [
    'ID'.padEnd(14),
    'TITLE'.padEnd(titleWidth),
    'RUNTIME'.padStart(7),
    'SCENES'.padStart(6),
    'COST'.padStart(7),
    'UPDATED'.padEnd(10),
    'VIDEO',
  ].join('  ');
  let out = `${c.dim(head)}\n`;

  for (const p of projects) {
    const title = p.title.length > titleWidth ? `${p.title.slice(0, titleWidth - 1)}…` : p.title;
    out += [
      c.bold(p.id.padEnd(14)),
      title.padEnd(titleWidth),
      clock(p.durationSec).padStart(7),
      String(p.scenes).padStart(6),
      formatCost(p.cost).padStart(7),
      ago(p.updatedAt).padEnd(10),
      p.videoPath ? c.green('✔') : c.dim('—'),
    ].join('  ');
    out += '\n';
  }

  out += `\n${c.dim(`${projects.length} project${projects.length === 1 ? '' : 's'} in ${pretty(ctx, dirOf(projects[0]!.dir))}`)}\n`;
  process.stdout.write(out);
  return 0;
}

function dirOf(projectDir: string): string {
  return projectDir.replace(/[/\\][^/\\]+$/, '');
}
