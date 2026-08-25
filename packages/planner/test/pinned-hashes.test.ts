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
 *
 * ## One re-pin, 2026-08-22: longitude/short, `c0f2ccc5024c` -> `882002cbf24c`
 *
 * Cause: `text.ts`'s `DANGLING` list grew the closed classes it had only half enumerated
 * (defect 0b), and `between` was one of the words it had been missing. Effect on this film,
 * measured rather than argued: **one string**. The whole storyboard delta is
 *
 *     "label": "Longitude is a difference between"   ->   "Longitude is a difference"
 *
 * How that was established, because "updating the number is easier than checking the
 * pixels" is the hazard this header opens with. `text.ts` was unmodified in the working
 * tree, so `git show HEAD~1:packages/planner/src/text.ts` is exactly the trimmer that
 * produced `c0f2ccc5024c`. Compiling longitude/short under each version and diffing the
 * two pretty-printed storyboards gives `4` lines of `diff` output — one changed `label`
 * and nothing else. `standard` stayed at `a9b5b8960ed0` under both, and the two
 * gradient-descent pins never moved, which is the cross-check that says this is a string
 * and not geometry: the type-scale attempt reverted in `45d4ff9` moved all four hashes and
 * rewrote 330 geometric values, and that is what a geometry regression looks like here.
 *
 * No frames were rendered for this re-pin and none were needed. The header asks for pixels
 * because a moved hash is normally a moved *shape*, and a diff cannot tell you whether a
 * new shape is better. A one-word-shorter caption at an unchanged anchor has no shape to
 * look at; the trimmed word is the evidence, and it is a caption that used to promise a
 * noun it never delivered.
 *
 * ## The re-pin, 2026-08-23: all four, for the one text-metrics stack (plan item 2.1)
 *
 * From `b6ed04d68aaa` / `4aa467530110` / `a9b5b8960ed0` / `882002cbf24c`. The planner's
 * `measureText` moved from chars × `ADVANCE = 0.52` to the real advance table in
 * `@inkcast/core`'s `fontmetrics.ts` — the same cmap/hmtx parse the visuals stage wraps
 * with — and equation reservations moved from handwriting-advance estimates to the
 * MathJax-em estimator (`texBox`). Every reserved box was expected to shift a few
 * percent, and did: the full storyboard diff is width tightenings (real Shantell
 * advances run 0.538 em/char against the 0.52 estimate), line heights +0.2 units (real
 * ascent+descent+lineGap against the 1.34 guess), and exactly two re-wraps, both of
 * which are the *estimate* having disagreed with what the board was always going to
 * letter: gradient-descent's "Height becomes how wrong we are" reserves the two lines
 * it measures at heading size, and longitude's "The sky gives you latitude for free"
 * reserves the one line it honestly fits on.
 *
 * Frames were rendered for this re-pin (`packages/render/src/frames.mts` over both
 * standard boards, old tree vs new). The longitude board is the visible win: the old
 * frame letters the latitude headline broken as "…latitude / for free" inside its
 * two-line reservation; the new frame letters it on one line over its underline, and
 * the freed vertical space goes to the figure beside it.
 *
 * ## The re-pin, 2026-08-23 (later): all four, for the recap chain's layout
 *
 * From `2a014f1e2eae` / `0670ab50fe80` / `a750d3d78b5e` / `e6e5e7d6e6b2`.
 *
 * `recapChain` emitted a `flow` diagram, which reads left to right, so four or five
 * ideas divided the recap's cell into columns about 160 units wide. A beat's `idea` is a
 * clause of six or seven words and has nowhere to go in 160 units: the browser wrapped
 * each to five lines, found five lines did not fit either, and shrank the type until they
 * did. On longitude that is **31 canvas units asked for and 16.3 delivered — 7.2 output
 * pixels**, against the 10px floor. The rendered frame is four boxes of grey mush at the
 * foot of the board under a heading reading "From a wreck to a watch". It survived every
 * check in the repo until the realized-layout sweep (plan 2.7) was finally pointed at
 * this lesson, and it is the reason that sweep exists.
 *
 * The fix is one word — `stack`, a column — plus the word budget rising with the width
 * (7 → 10 on 16:9, 5 → 6 vertical), because at seven words the labels were truncated
 * mid-thought and a full-width row fits the sentence that finishes them.
 *
 * The delta is small enough to read in full. Longitude: 12 lines of `diff`, one of them
 * `"layout"`, and two labels that stop being fragments —
 *
 *     "The sky gives you latitude"                 -> "…latitude for free"
 *     "A carpenter built the clock the astronomers" -> "…the astronomers could not"
 *
 * Gradient-descent: 16 lines, `"layout"` and three labels ("Feel the ground" -> "Feel
 * the ground, step downhill, repeat", and two more). **No geometry moved at all** — the
 * diagram's own `at` box is unchanged and the node boxes are computed by the renderer at
 * layout time, which is why a change this visible is this small in the bytes.
 *
 * Frames were rendered and looked at, on a full strict cast of longitude
 * (`projects/qc33-longitude`, which now passes the gate that was blocking it). The recap
 * reads as four full-width rows, one line each, chained downward: "The sky gives you
 * latitude for free" → "Longitude is a difference between two clocks" → "So the problem
 * was never astronomy" → "A carpenter built the clock the astronomers could not". That
 * is the argument, legible, where there used to be a smudge.
 *
 * ## The re-pin, 2026-08-24: all four, for `enter.cueWord` (plan item 4.1)
 *
 * From `e1212df828d0` / `6b03be35c3c6` / `a8c3f262502a` / `f03df5431b68`.
 *
 * Every cue now leaves the compiler with the index of the word it starts on, so the
 * voice stage looks a reveal up instead of searching for its phrase. **The diff is
 * purely additive and nothing else moved at all** — measured, not asserted: compiling
 * each board under `HEAD` and under the working tree and diffing the pretty-printed
 * JSON gives 30 / 23 / 47 / 38 added `"cueWord"` lines and **zero** other changed
 * lines. Not a fraction, not a string, not a box. The counts are also the coverage
 * proof: each board has exactly that many cues, so every cue in both shipped lessons
 * resolved to an exact index and none fell back.
 *
 * No frames were rendered for this re-pin and none were needed, for the reason the
 * 2026-08-22 one gives: the header asks for pixels because a moved hash is normally a
 * moved *shape*, and here there is no shape to look at — the numbers describe when ink
 * arrives, and `enter.at` is unchanged in all four boards. What was verified instead is
 * the thing that *is* new: a strict end-to-end cast of both lessons, where the voice
 * stage reports every reveal placed `by authored word index` and no fallback, and
 * `synccheck.mts` still finds no stroke landing on the same frame as the one before it.
 *
 * ## A fifth and sixth pin, 2026-08-24: `hash-map`, for the code lane (plan item 6.2)
 *
 * Not a re-pin — the four above did not move, and could not have: the code lane adds a
 * member to the element union and a ninth `VisualIntent.kind`, and neither shipped lesson
 * uses either. Verified by this file passing unchanged throughout.
 *
 * `hash-map` is pinned on the rule this header already states for `explainer`: a format
 * gets pinned when the first film ships from it. One has —
 * `projects/qc62-hashmap`, a strict cast, watched — and the pin is what keeps the two
 * things the lane rests on from moving silently: `codeBox`'s reservation (the planner's
 * half of the character grid) and `FONT.label`, the size a listing is set at. A change to
 * either moves these two hashes and nothing else in the repo would notice.
 *
 * The listing's *geometry* is not in here and cannot be: `at` is a reservation and the
 * glyph outlines are resolved a stage later. That half is guarded by
 * `visuals/test/code.test.ts` (byte-identical across two resolves) and by
 * `geomhash.mts`, which reports `s3/b3_v0` and `s5/b5_v0` identically across two runs of
 * the visuals stage.
 *
 * ## The re-pin, 2026-08-24: `hash-map`/short only, for the length estimate's unit
 *
 * From `5a5362c4fd0a` (5 scenes) to `66cb5a33474b` (6). **One of the six moved**, and
 * which five did not is the argument: `lessonSeconds` stopped counting words and started
 * counting spoken letters (`DELIVERED_LPS`, and the finding behind it is argued there).
 * That changes an estimate by exactly how far a lesson's word length sits from the corpus
 * mean of 4.23 letters — so longitude (4.35) moved 133.2s → 132.4s and did not cross a
 * boundary, and hash-map (3.99, the shortest-worded lesson we ship) moved 139.0s → 127.4s
 * and did. Gradient-descent (3.79) moved furthest of all in seconds and still did not
 * change, because at `short` its chain rule had already run out of legal cuts under both
 * numbers. Six pins, one boundary crossed, and every non-move explained.
 *
 * **What the extra scene is: the collision beat.** `step3` — "But there are more keys
 * than slots, so sooner or later two keys are sent to the same one" — which the vertical
 * preset had been dropping. That is the consequence a hash-map lesson exists to deliver,
 * and it was being cut because the estimator over-charged a short-worded film by 8%. The
 * whole storyboard delta is that scene inserted at `s4`, the recap moving to `s5` with its
 * narration byte-identical, one asset added, the canvas growing 11,958 → 15,878 units, and
 * every scene's camera zoom rising 5.7989 → 7.6996 as the region packing changed from 3
 * regions to 4. Established by compiling the board under `git stash` and under the working
 * tree and diffing the two pretty-printed storyboards.
 *
 * **Frames were rendered and looked at**, which this header requires and which the zoom
 * change makes non-negotiable — every scene is framed differently, so a diff cannot answer
 * it. `projects/qcf2-hashmap-short`, at t=8s (scene 0 at the new zoom: the pigeonhole wall
 * is framed with the headline legible above it, no overflow), t=40s (the new beat, its
 * headline "Two keys can be sent" legible) and t=49s. The recap frame is the one that
 * settles it: the chain now reads as **four** boxes — "Unless the name tells" → "The rule
 * is a hash function" → "Fold the number down" → "Two keys can be sent" — where it used to
 * read as three and end before the collision.
 *
 * That render needed `--degrade`, for a defect this change did not cause and does not fix:
 * `hash-map` at `short` cannot pass the strict gate, because its Python listing wants
 * 25.82 canvas units to fit the 567×117 cell the vertical preset gives it, against the
 * 32.78 floor. Verified pre-existing rather than assumed — `b3_v0`'s box is byte-identical
 * in the before and after storyboards, and a cast from `HEAD` fails with the same message.
 * The lesson has never been renderable at this preset since the code lane landed in 6.2;
 * the pin is a *compile* hash, so nothing had ever tried. It is written up as a finding in
 * `docs/HANDOFF-AUDIT-REMAINDER.md` rather than fixed here.
 */
const PINNED = [
  { lesson: 'gradient-descent', preset: 'standard', hash: 'd3f35564b27b', scenes: 9 },
  { lesson: 'gradient-descent', preset: 'short', hash: 'e3a1f7338b26', scenes: 7 },
  { lesson: 'longitude', preset: 'standard', hash: '417495edcde8', scenes: 8 },
  { lesson: 'longitude', preset: 'short', hash: '01b682decdbd', scenes: 6 },
  { lesson: 'hash-map', preset: 'standard', hash: '6534c50131fa', scenes: 9 },
  // Re-pinned 2026-08-24 from `5a5362c4fd0a` / 5 scenes — see the section above.
  { lesson: 'hash-map', preset: 'short', hash: '66cb5a33474b', scenes: 6 },
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
