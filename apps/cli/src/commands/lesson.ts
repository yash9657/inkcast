/**
 * `inkcast lesson <id>` — print what a project actually teaches.
 *
 * This exists because the lesson is the editable artefact of the pipeline. When a
 * video explains the wrong thing, the fix is almost never in the storyboard: it is
 * the hook that opened with a definition, the step that asserted instead of
 * deriving, the missing worked example. So this prints the lesson in the shape it
 * was designed in — role by role, with the reason each idea is true and the visual
 * that carries it — plus the critique, plus the exact command to re-cast after
 * editing `lesson.json` by hand.
 */
import path from 'node:path';
import { critiqueLesson, lessonBeats } from '@inkcast/core';
import { projectLesson, readState } from '@inkcast/pipeline';
import type { CliContext } from '../env.js';
import { paint } from '../ui.js';
import { pretty, resolveProject } from './shared.js';

const ROLE_LABEL: Record<string, string> = {
  hook: 'HOOK',
  anchor: 'ANCHOR',
  step: 'STEP',
  worked: 'WORKED',
  misconception: 'MISCONCEPTION',
  recap: 'RECAP',
};

export async function lessonCommand(ctx: CliContext, id: string | undefined): Promise<number> {
  const c = paint(ctx.color);
  const project = await resolveProject(id);
  const { lesson, file } = await projectLesson(project.id);
  const state = await readState(project.dir);
  const problems = critiqueLesson(lesson);
  const beats = lessonBeats(lesson);

  if (ctx.json) {
    process.stdout.write(
      `${JSON.stringify(
        { projectId: project.id, file, lesson, problems, beats: beats.length },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  let out = `\n${c.bold(lesson.topic)} ${c.dim(`· ${beats.length} beats · ${project.id}`)}\n`;
  out += `  ${c.dim('for'.padEnd(10))}${lesson.audience}\n`;
  out += `  ${c.dim('objective'.padEnd(10))}${lesson.objective}\n`;
  if (lesson.jargonBudget.length > 0) {
    out += `  ${c.dim('earn first'.padEnd(10))}${c.dim(lesson.jargonBudget.join(', '))}\n`;
  }
  out += `  ${c.dim('file'.padEnd(10))}${pretty(ctx, file)}\n`;

  let n = 0;
  for (const { step, role } of beats) {
    n += 1;
    out += `\n${c.cyan(String(n).padStart(2))} ${c.bold(ROLE_LABEL[role] ?? role.toUpperCase())}`;
    out += step.hold > 0 ? c.dim(`  ${step.hold.toFixed(1)}s silence after\n`) : '\n';
    out += `   ${c.dim('idea')}     ${step.idea}\n`;
    if (step.because.trim()) out += `   ${c.dim('because')}  ${step.because}\n`;
    out += `   ${c.dim('says')}     ${quote(step.narration)}\n`;
    for (const v of step.visuals) {
      out += `   ${c.dim('shows')}    ${c.dim(`[${v.kind}]`)} ${v.describe}${v.cue ? c.dim(` · on “${v.cue}”`) : ''}\n`;
    }
    if (step.visuals.length === 0 && role !== 'recap') {
      out += `   ${c.yellow('shows')}    ${c.yellow('nothing — this beat has no visual')}\n`;
    }
  }

  out += '\n';
  if (problems.length === 0) {
    out += `  ${c.green('✔')} ${c.dim('the lesson passes every structural check')}\n`;
  } else {
    out += `  ${c.yellow(`${problems.length} problem(s)`)}\n`;
    for (const p of problems) out += `    ${c.dim('·')} ${p}\n`;
  }

  out += `\n  ${c.dim('edit')} ${pretty(ctx, file)}${c.dim(', then re-run:')} ${c.cyan(recastCommand(project.id, state?.source))}\n`;
  out += `  ${c.dim(`your edits survive — the lesson cache keeps them and only the board is rebuilt.`)}\n\n`;
  process.stdout.write(out);
  return 0;
}

/** The words spoken, kept on one line and quoted so it reads as speech. */
function quote(narration: string): string {
  return `“${narration.replace(/\s+/g, ' ').trim()}”`;
}

/**
 * The exact command that rebuilds this project from an edited lesson.
 *
 * Re-casting with the same source and `--project` finds the lesson cache still
 * fresh, so the edited file is used as-is; the storyboard key follows the lesson's
 * content, so the board recompiles and only changed scenes are re-voiced.
 */
function recastCommand(id: string, source?: { kind: string; ref: string }): string {
  const project = `--project ${id}`;
  if (!source) return `inkcast rerender ${id}`;
  switch (source.kind) {
    case 'topic':
      return `inkcast teach ${JSON.stringify(source.ref)} ${project}`;
    case 'file':
      return `inkcast cast ${path.basename(source.ref)} ${project}`;
    case 'url':
      return `inkcast cast ${source.ref} ${project}`;
    case 'lesson':
      return `inkcast cast ${path.basename(source.ref)} ${project}`;
    default:
      return `inkcast rerender ${id}`;
  }
}
