/**
 * The four pinned storyboard hashes, asserted by something other than prose.
 *
 * They have been the repo's load-bearing regression guard for a while — every plan that
 * touches type sizes, framing or the compiler is told not to move them, and
 * `packages/planner/src/compile.ts` records their values in a comment next to
 * `COMPILER_VERSION` — but until now *nothing executed that check*. The only way to see a
 * moved hash was to remember to run `sbhash.mts` by hand and diff it across a `git
 * stash`, which means the guard was exactly as strong as the next person's memory. A
 * launch build ran eleven agents in parallel across the compiler, the camera and the
 * renderer with "do not move the pinned hashes" in every brief, and not one line of CI
 * could have caught it if they had.
 *
 * So this file is the missing half of `sbhash.mts`. That tool stays: it prints the asset
 * table alongside the hash, which is what tells you *what* moved once something has, and
 * it can be pointed at any lesson. This test answers the narrower question the comment in
 * `compile.ts` was already asserting — are these four still what they were — and it
 * answers it on every `pnpm -r test`.
 *
 * ## When one of these fails
 *
 * A failure here is not automatically a bug, and it must not be treated as one to be
 * silenced. It says a change reached the compiled storyboard of a shipped lesson. Either
 * that was the point, or it was not:
 *
 * - **Not the point** (the usual case): something meant to be additive was not. A new
 *   preset key, a new optional field, a new brief — none of those should reach these
 *   bytes. `sbhash.mts` plus `sbjson.mts` will show which part of the storyboard moved.
 * - **The point**: the change is a deliberate correction to what these lessons compile
 *   to, e.g. the type-scale fixed point (`docs/PLAN-LAUNCH.md` A7, reverted once in
 *   `45d4ff9`). Then re-pin — but only after rendering the affected project and *looking*
 *   at the frames that were supposed to change, because the whole hazard of a pinned hash
 *   is that updating the number is easier than checking the pixels. Record the old value
 *   and the date, here and in `compile.ts`.
 *
 * Both presets are hashed for each lesson, and that is not redundancy: `standard` and
 * `short` take different branches through `adaptLesson` — the vertical one drops beats to
 * fit a 60s budget — so a change that only moves the trimmed path shows up in one of them
 * and not the other. `explainer` is deliberately *not* pinned: it is new, nothing has
 * shipped from it, and pinning a format still being tuned would only manufacture
 * failures. It gets pinned when the first film ships from it.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { Lesson } from '@inkcast/core';
import { compileLesson } from '../src/compile.js';

/**
 * Pinned 2026-08-21, unchanged from the values recorded beside `COMPILER_VERSION` in
 * `src/compile.ts` and in `docs/STATUS.md`. Verified with
 * `npx tsx packages/pipeline/src/sbhash.mts gradient-descent longitude` against the
 * launch build, which touched `presets.ts`, `lesson-anthropic.ts`, `draw-anthropic.ts`,
 * `core/src/camera.ts`, `render/src/sketch.ts` and `render/src/render.ts` and moved none
 * of them.
 */
const PINNED = [
  { lesson: 'gradient-descent', preset: 'standard', hash: 'b6ed04d68aaa', scenes: 9 },
  { lesson: 'gradient-descent', preset: 'short', hash: '4aa467530110', scenes: 7 },
  { lesson: 'longitude', preset: 'standard', hash: 'a9b5b8960ed0', scenes: 8 },
  { lesson: 'longitude', preset: 'short', hash: 'c0f2ccc5024c', scenes: 6 },
] as const;

const repoRoot = path.resolve(import.meta.dirname, '../../..');

/** Byte-for-byte what `sbhash.mts` prints, so the two can never disagree. */
function storyboardHash(lessonName: string, preset: 'standard' | 'short'): string {
  const file = path.join(repoRoot, 'examples', 'lessons', `${lessonName}.lesson.json`);
  const lesson = Lesson.parse(JSON.parse(readFileSync(file, 'utf8')));
  const sb = compileLesson(lesson, { preset });
  return createHash('sha256').update(JSON.stringify(sb)).digest('hex').slice(0, 12);
}

for (const { lesson, preset, hash, scenes } of PINNED) {
  test(`${lesson} at the ${preset} preset still compiles to ${hash}`, () => {
    const file = path.join(repoRoot, 'examples', 'lessons', `${lesson}.lesson.json`);
    const parsed = Lesson.parse(JSON.parse(readFileSync(file, 'utf8')));
    const sb = compileLesson(parsed, { preset });

    // The scene count first, because it localises the common failure before the opaque
    // one: a hash mismatch with the expected scene count means the bytes of a scene
    // moved, and a mismatch in both means a beat was added, dropped or trimmed
    // differently. Reading that off two assertions is faster than off `sbjson.mts`.
    assert.equal(
      sb.scenes.length,
      scenes,
      `${lesson}/${preset} now compiles to ${sb.scenes.length} scenes, not ${scenes} — ` +
        `a beat was added, dropped, or trimmed differently`,
    );

    assert.equal(
      storyboardHash(lesson, preset),
      hash,
      `${lesson}/${preset} no longer compiles to ${hash}. This is a shipped lesson's ` +
        `storyboard changing. Run \`npx tsx packages/pipeline/src/sbhash.mts ${lesson}\` ` +
        `and \`sbjson.mts\` to see what moved, and read the header of this file before ` +
        `re-pinning — a re-pin without looking at the rendered frames blesses whatever ` +
        `regression caused it`,
    );
  });
}

test('the pinned hashes are the ones compile.ts advertises', () => {
  // Two catalogues of one fact is the pathology this repo keeps paying for — it is
  // written up as such in `docs/HANDOFF.md` for type scales, `doubleWell` and the two
  // ink engines. The hashes are now in three places (here, `compile.ts`, `STATUS.md`),
  // and this is the cheap guard that at least the two in code agree: if someone re-pins
  // this file and leaves the comment, the comment becomes a lie that the next person
  // will measure against.
  const compileSrc = readFileSync(path.join(import.meta.dirname, '../src/compile.ts'), 'utf8');
  for (const { lesson, preset, hash } of PINNED) {
    assert.ok(
      compileSrc.includes(hash),
      `${hash} (${lesson}/${preset}) is pinned here but no longer appears in compile.ts — ` +
        `re-pin the comment beside COMPILER_VERSION in the same commit`,
    );
  }
});
