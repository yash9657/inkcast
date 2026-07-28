/**
 * `inkcast edit <id> "<instruction>"` — patch the storyboard, don't regenerate it.
 *
 * With no API key the instruction is matched locally; with `ANTHROPIC_API_KEY`
 * set, Claude maps it onto the same edit operations. Either way the video is not
 * rebuilt here — `rerender` does that, and only for the scenes that changed.
 */
import { EditError, editProject, EDIT_USAGE_HINT } from '@inkcast/pipeline';
import type { CliContext } from '../env.js';
import { paint } from '../ui.js';
import { UsageError } from '../main.js';
import { resolveProject } from './shared.js';

export async function editCommand(
  ctx: CliContext,
  id: string | undefined,
  instruction: string,
): Promise<number> {
  const c = paint(ctx.color);
  if (!instruction.trim()) {
    throw new UsageError(
      'nothing to change. Example: inkcast edit last "scene 2 narration: give a concrete example"',
    );
  }
  const project = await resolveProject(id);

  let result;
  try {
    result = await editProject(project.id, instruction);
  } catch (err) {
    if (err instanceof EditError) {
      process.stderr.write(`${c.red('✗')} ${err.message}\n`);
      if (!err.message.includes('understand')) {
        process.stderr.write(`\n${c.dim(EDIT_USAGE_HINT)}\n`);
      }
      return 1;
    }
    throw err;
  }

  if (ctx.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          projectId: project.id,
          via: result.via,
          applied: result.applied,
          ops: result.ops,
          scenes: result.storyboard.scenes.length,
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  let out = `\n${c.green('✔')} ${result.applied.length} change${result.applied.length === 1 ? '' : 's'} to ${c.bold(project.title)} ${c.dim(`(via ${result.via})`)}\n\n`;
  for (const line of result.applied) out += `  ${c.cyan('·')} ${line}\n`;
  out += `\n  ${c.dim(`then: inkcast rerender ${project.id}`)}\n\n`;
  process.stdout.write(out);
  return 0;
}
