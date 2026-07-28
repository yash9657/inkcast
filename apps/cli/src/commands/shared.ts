/** Helpers shared by the subcommands. */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { listProjects, type ProjectSummary } from '@inkcast/pipeline';
import { UsageError } from '../main.js';
import type { CliContext } from '../env.js';
import { paint } from '../ui.js';

/** Resolve an id, a unique id prefix, or `last` / `latest` to one project. */
export async function resolveProject(id: string | undefined): Promise<ProjectSummary> {
  const projects = await listProjects();
  if (projects.length === 0) {
    throw new Error('no projects yet — run `cast <file>` first');
  }
  if (!id || id === 'last' || id === 'latest') return projects[0]!;

  const exact = projects.find((p) => p.id === id);
  if (exact) return exact;
  const matches = projects.filter((p) => p.id.startsWith(id));
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    throw new UsageError(
      `"${id}" matches ${matches.length} projects: ${matches.map((m) => m.id).join(', ')}`,
    );
  }
  throw new Error(
    `no project "${id}". Known projects: ${projects
      .slice(0, 8)
      .map((p) => p.id)
      .join(', ')}${projects.length > 8 ? ', …' : ''}`,
  );
}

/** Hand a file to the desktop's default application. Never fails the command. */
export function openInOs(file: string): void {
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [file]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', file]]
        : ['xdg-open', [file]];
  try {
    const child = spawn(cmd as string, args as string[], { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    /* headless machine: the path is already printed, that is enough */
  }
}

/** Paths are friendlier relative to where the user is standing. */
export function pretty(ctx: CliContext, file: string): string {
  const rel = path.relative(ctx.cwd, file);
  return rel !== '' && !rel.startsWith('..') ? rel : file;
}

export function heading(ctx: CliContext, text: string): string {
  return paint(ctx.color).bold(text);
}
