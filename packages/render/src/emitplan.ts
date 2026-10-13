/**
 * `plan.json` on request — the compiled timeline, written down so a human can read it
 * (plan item 7.2; audit S7-a).
 *
 * The audit's verdict on S7-a was PARTIAL for one reason and it is worth restating,
 * because it is also the reason this file is written the way it is: **a persisted plan
 * would be a drift-capable derived copy.** The plan is a pure function of
 * `storyboard.json` (A-5), it is recompiled from scratch on every render, and nothing
 * here — not the renderer, not the gate stage, not the cache — ever reads it back. Its
 * remediation was therefore "optional `--emit-plan`", not "persist the plan": an
 * artefact that exists when somebody asks for it, and does not exist the rest of the
 * time, cannot become a second source of truth.
 *
 * Three decisions follow, and each is a trap avoided rather than a preference:
 *
 * 1. **The file says out loud that nothing reads it.** `_note` is the first key, so the
 *    next person to find `plan.json` in a project directory and start editing it learns
 *    in one line that their edit changes no pixel. That is cheaper than the bug report.
 * 2. **It compiles its own plan, quietly.** Not the gate stage's plan (that one is
 *    compiled without the resolved font family, because it is measuring rather than
 *    drawing) and not the renderer's (that one does not exist on a cached render, which
 *    is the common case on a re-cast — a flag that silently writes nothing whenever the
 *    video is already current would be the worse half of useless). One quiet compile,
 *    with the font resolved exactly as `render()` resolves it, is the only version that
 *    is both always available and honestly the plan the film was drawn from.
 * 3. **It never gates.** `gates: 'degrade'` here is not a posture choice: the run's real
 *    gate has already fired in `check()`, and a second compile that could throw would
 *    turn "show me the plan" into a way to fail a run. The plan's own `problems[]`
 *    carries what was compiled through, so the artefact still says what was wrong.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Storyboard } from '@inkcast/core';
import { compileBoard } from './compile.js';
import { resolveFont } from './font.js';

/** Where the emitted plan lands, relative to the project directory. */
export const PLAN_FILE = 'plan.json';

const NOTE =
  'Written by --emit-plan, for reading. Nothing reads it back: the render plan is a pure ' +
  'function of storyboard.json and is recompiled from it every time. Editing this file ' +
  'changes no pixel — edit storyboard.json and re-cast.';

/**
 * Compile this storyboard's plan and write it to `<dir>/plan.json`. Returns the path.
 *
 * Deliberately independent of every cache in the pipeline. The question it answers —
 * "what timeline does this storyboard compile to?" — has the same answer whether or not
 * the mp4 on disk is current, and the compile costs milliseconds.
 */
export async function emitPlan(
  sb: Storyboard,
  dir: string,
  opts: { fontPath?: string; grid?: boolean } = {},
): Promise<string> {
  const font = resolveFont(sb.meta.style, dir, opts.fontPath, 'degrade');
  const { plan } = compileBoard(sb, dir, {
    fontFamily: font.family,
    gates: 'degrade',
    quiet: true,
    ...(opts.grid === undefined ? {} : { grid: opts.grid }),
  });
  const file = path.resolve(dir, PLAN_FILE);
  await writeFile(file, `${JSON.stringify({ _note: NOTE, ...plan }, null, 2)}\n`);
  return file;
}
