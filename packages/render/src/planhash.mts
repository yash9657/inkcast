/**
 * Hash the compiled render plan, one line per item, for before/after comparison
 * across a `git stash`.
 *
 * The instrument the other three could not provide. `sbhash.mts` stops at the
 * storyboard, `geomhash.mts` measures what the *visuals stage* resolves, and
 * `frames.mts` renders pictures a human has to look at. None of them answers the
 * question a change to the render path actually raises: **did the drawn geometry
 * move?** This compiles the plan and hashes the prims — the path data, the text, the
 * colours and weights — so "byte-identical render" becomes a diff rather than a claim.
 *
 * It matters most for a change that is *supposed* to be invisible. Moving the camera
 * derivation into `@inkcast/core` and feeding plot geometry from the sidecar are both
 * refactors whose whole promise is that the video does not change; without this the
 * only available proof was eight PNGs and an assertion of good faith.
 *
 * Used from the repo root as
 *
 *     npx tsx packages/render/src/planhash.mts final-169 handwritten > /tmp/after.txt
 *     git stash push -u && git status --short          # confirm the tree is CLEAN
 *     npx tsx packages/render/src/planhash.mts final-169 handwritten > /tmp/before.txt
 *     git stash pop
 *     diff /tmp/before.txt /tmp/after.txt
 *
 * Committed rather than kept in scratch, for the reason its two siblings' headers give
 * and that has now cost one measurement: `git stash -u` takes untracked files with it,
 * so a throwaway version of this vanishes at the moment it is needed.
 *
 * Timing is deliberately excluded from the default hash. `enter.at` is rewritten by the
 * voice stage on every re-narration, and a tool that reported a diff for that would be
 * useless for the geometry questions it exists to answer. What is hashed is what is
 * drawn, not when.
 *
 * **`--timing` is the opt-in second mode** (plan 7.2), for the question the paragraph
 * above declines to answer: did the *schedule* move? It adds the film's length, each
 * scene's start/speech/hold and each item's start, duration and schedule hash to the
 * same rows. Never the default, for exactly the reason the default excludes timing —
 * see `planrows.ts`, which is where both modes are implemented and tested.
 *
 *     npx tsx packages/render/src/planhash.mts --timing final-169 > /tmp/after.txt
 */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { parseStoryboard } from '@inkcast/core';
import { compilePlan } from './compile.js';
import { planRows } from './planrows.js';

const argv = process.argv.slice(2);
const timing = argv.includes('--timing');
const projects = argv.filter((a) => a !== '--timing');
const unknown = projects.find((a) => a.startsWith('--'));
if (projects.length === 0 || unknown) {
  console.error(
    unknown
      ? `unknown flag ${unknown}`
      : 'usage: planhash.mts [--timing] <project|path...>   (a name under projects/, or a path)',
  );
  process.exit(2);
}

const repoRoot = path.resolve(import.meta.dirname, '../../..');

/**
 * A project directory: a bare name resolves under `projects/`, anything containing a
 * separator is taken as a path. The path form is what lets a *scratch* copy be
 * measured — re-running the visuals stage into `projects/` to test a change would
 * edit the very control the change is being measured against.
 */
function projectDir(nameOrPath: string): string {
  return nameOrPath.includes('/')
    ? path.resolve(nameOrPath)
    : path.join(repoRoot, 'projects', nameOrPath);
}

for (const name of projects) {
  const dir = projectDir(name);
  const sb = parseStoryboard(JSON.parse(readFileSync(path.join(dir, 'storyboard.json'), 'utf8')));
  const plan = compilePlan(sb, dir);
  // Tab-separated, and note the compiler logs to stdout too: filter on the tabs
  // rather than assuming this is the only thing on the stream.
  for (const row of planRows(name, plan, { timing })) console.log(row);
}
