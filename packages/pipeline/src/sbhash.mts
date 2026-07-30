/**
 * Hash the storyboard a lesson compiles to, for before/after comparison across a
 * `git stash`.
 *
 * The gap this fills: `geomhash.mts` resolves the visuals stage against a storyboard
 * *already on disk*, so it cannot see the planner at all — change `buildAsset` and
 * `projects/handwritten` stays byte-identical whatever you did. Every one of the four
 * verification tools is pointed downstream of the compiler, and a planner change is a
 * storyboard change. This is the one that sees it.
 *
 * Sub-second: it compiles only, with no voice, no visuals and no render. Used from the
 * repo root as
 *
 *     npx tsx packages/pipeline/src/sbhash.mts <lesson...>
 *
 * where each argument names a file in `examples/lessons/` without its
 * `.lesson.json` suffix. The usual shape of a verification:
 *
 *     npx tsx packages/pipeline/src/sbhash.mts gradient-descent longitude > /tmp/after.txt
 *     git stash push -u && git status --short          # confirm the tree is CLEAN
 *     npx tsx packages/pipeline/src/sbhash.mts gradient-descent longitude > /tmp/before.txt
 *     git stash pop
 *     diff /tmp/before.txt /tmp/after.txt
 *
 * Committed rather than kept in a scratch directory for exactly that middle step, and
 * the reason is worth stating because it has already cost one measurement: `git stash
 * -u` takes untracked files *with* it, so a throwaway version of this tool vanishes at
 * the moment it is needed and the "before" run silently measures nothing. A tool that
 * lives in the repo survives the stash it is being used to measure.
 *
 * It lives in `pipeline` because that is the only package depending on both the lesson
 * schema and the compiler, and it is not part of the package's public API — same
 * standing as `visuals/src/geomhash.mts` and `render/src/frames.mts`.
 *
 * Both presets are hashed. `standard` and `short` take different branches through
 * `adaptLesson` — the vertical one drops beats to fit a 60s budget — so a change that
 * only moves the trimmed path is invisible in one of them.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Lesson } from '@inkcast/core';
import { compileLesson } from '@inkcast/planner';

const lessons = process.argv.slice(2);
if (lessons.length === 0) {
  console.error('usage: sbhash.mts <lesson...>   (names under examples/lessons/, no suffix)');
  process.exit(2);
}

const repoRoot = path.resolve(import.meta.dirname, '../../..');

for (const name of lessons) {
  const file = path.join(repoRoot, 'examples', 'lessons', `${name}.lesson.json`);
  const lesson = Lesson.parse(JSON.parse(await readFile(file, 'utf8')));

  for (const preset of ['standard', 'short'] as const) {
    const sb = compileLesson(lesson, { preset });
    const whole = createHash('sha256').update(JSON.stringify(sb)).digest('hex').slice(0, 12);
    // The asset table separately, because it is what a change to the asset router
    // moves and a whole-storyboard hash cannot tell you *what* differed. Ids and refs
    // only — a resolved `svg` or `seed` is the next stage's business.
    const assets = sb.assets.map(
      (a) => `${a.id}:${a.kind}:${a.ref ? `${a.ref.path}/${a.ref.variant ?? '-'}` : '-'}`,
    );
    // Tab-separated, and note the compiler logs to stdout too: filter on the tabs
    // rather than assuming this is the only thing on the stream.
    console.log(
      [
        `SB`,
        name,
        preset,
        whole,
        `${sb.scenes.length} scenes`,
        assets.join(',') || '(no assets)',
      ].join('\t'),
    );
  }
}
