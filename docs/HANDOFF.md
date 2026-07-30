# Handoff — 2026-07-30 · root cause 1 is mostly closed; next is what the frames show

Session state, not design. `PIPELINE.md` is the durable architecture and `STATUS.md` is
the verification record; this file exists so a session starting cold knows exactly where
things stand, what to do next, and which traps are waiting.

Delete or rewrite this once the first item lands. It goes stale by design.

**Read "Where things stand", then "The sequence".** Item 1 is specified in full under "The
next piece" and needs no API key; the rest of the sequence is one paragraph each. Everything
after "How to verify a visual change cheaply" is reference.

## Where things stand

Branch **`visuals-morph-density`**, fifteen commits on top of `e95258b`. Everything is
local; there is **no remote**, so nothing is pushed anywhere and `git remote -v` is empty.
In order, by subject:

    Keyvault: one vault, shared by the CLI and the studio
    Morph the anchor into the plot, and make cells frame-shaped
    docs: the staged-pipeline architecture, and a handoff
    One implementation of plot geometry, and it is the good one          <- step 1
    docs: rewrite the handoff for step 6
    Lesson schema v2: the morph comes from the mapping, not the prose    <- step 6
    Two ink modes, and plots draw crisp                                  <- step 2
    The equation lane: real typeset mathematics                          <- step 3
    Consolidate: a real render, a re-verified STATUS, one cache gate
    docs: rewrite the handoff to start on step 4
    The asset library: drawings we chose, pinned by version              <- step 4
    Character rigs: one person, several poses                            <- step 5 (half)
    docs: sequence the remaining work, and demote step 8 on evidence
    One asset router, and a pedagogy that can ask for a pose             <- step 5b
    Pacing is one decision, and it is cadence                            <- step 7
    The camera moves to core, and plots are read not re-derived          <- root cause 1

Each message carries the reasoning for its own change and is worth reading before the
diff it belongs to. Steps 1, 6, 2, 3, 4, 5b and 7 are ✅ in `PIPELINE.md`; step 5 and
root cause 1 are 🟡, with what remains of each spelled out there.

**The baseline is measured, not inherited.** `pnpm lint` clean, `pnpm -r typecheck` 0
errors across 9 projects, `pnpm -r test` **582 pass / 0 fail** across all eight
test-bearing packages. Two lessons now render end to end with no keys: the benchmark
(104.667 s / 3140 frames at 1920x1080, 61.500 s at 1080x1920, mean fill 52.2% / 55.9%)
and the new narrative one (2:11, 8 scenes, 4 assets, mean fill 23%). Both `cost $0.00`.

**`STATUS.md` has six appendices**, the last two dated 2026-07-30, newest last. The 07-28 body is a
historical record and deliberately unedited.

## What just landed, in one paragraph

Root cause 1's remaining half. Step 1 had already made `resolvePlot` the only plot
solver, but the renderer still had to _call_ it, because the visuals stage had **no
camera**: it sized type against the whole canvas while the renderer frames a region, a
factor of five on the benchmark, and in the plot lane the caption size _is_ the unit of
measurement. So the recorded geometry had wrong numbers baked into its path data.
`boardMetrics()` in `packages/core/src/camera.ts` fixes that — the camera, the unit
scale, the type scale and the pen weight now live where **both** stages reach them. The
stage resolves plots at the size they are drawn; the renderer reads them; `openVisuals`
resolves nothing. Proof is byte-identical: all 109 plan items unchanged across both
projects, while exactly the 8 plots moved in the sidecar. Two real bugs fell out —
`renderFingerprint` did not cover the sidecar it had just started depending on, and a
plot with no sidecar drew nothing at all. Both fixed. What is **not** done is the sketch
duplication; see item 1 below.

## The sequence

Re-ordered by leverage. Numbered steps keep their `PIPELINE.md` numbers; unnumbered work
is marked.

| #   | Work                                                   | Key? | Why here                                                                                           |
| --- | ------------------------------------------------------ | ---- | -------------------------------------------------------------------------------------------------- |
| 1   | **Region grouping for single-figure beats**            | no   | The live quality complaint with the most measured evidence: 23% frame fill against 52%. Below.     |
| 2   | **Step 10 — one hand, not two** (rest of root cause 1) | no   | The last duplication. A _visual_ decision, not a refactor — read `PIPELINE.md` step 10 first.      |
| 3   | **The `doubleWell` disagreement** (known defect)       | no   | Small, contained, a wrong drawing today, and now the last two-catalogue instance in the plot path. |
| 4   | **The lucide confidence threshold** (known defect)     | no   | Odysseus draws `presentation`. Better than `rocket`, still wrong.                                  |
| 5   | **Step 8 — `entersAtWord`**                            | no   | **Still demoted on evidence.** Step 7 took the wind out of it further.                             |
| 6   | **Finish step 5** — i2i adapter + real identity gate   | YES  | Blocked without a provider. Nothing else waits on it.                                              |
| 7   | **Step 9, the cost target, 9:16 equations, music/SFX** | some | Genuinely later. `PIPELINE.md` "Still open" carries the reasoning.                                 |

**2 — the rest of root cause 1, and why it is not item 1.** `render/src/sketch.ts` is a
hand-rolled mulberry32 sketch engine; the visuals stage draws the same element types with
roughjs. Two genuinely different implementations for `path`, `shape`, `arrow`, `diagram`,
`emphasis` and `text`, and for those types the stage's SVGs are written and never read.

The plumbing is the move plots just made and is not the hard part. The hard part is that
**whichever hand wins, about half of every board is redrawn** — 21 of 39 elements in
`final-169`, 6 of 14 in `handwritten`. Adopting roughjs changes the video; moving the
renderer's engine into the visuals stage preserves the video and changes the library
assets and character rigs instead. Do not start this without frames in front of you, and
do not treat a byte-identical control as achievable — it is not, and expecting one will
send you looking for a bug that is the feature.

**3 — `doubleWell`.** Worth doing soon now that the plot path is otherwise single-sourced:
it is the last place two catalogues of one fact remain in that lane, and the drawn curve
and the simulated descent can disagree enough to put the step dots off the curve.

## The next piece (item 1) — region grouping for single-figure beats

The complaint with the most evidence behind it and no key required. The narrative lesson
renders at **23% mean content fill** against the benchmark's 52%, and the camera warning
names the cause outright: each beat is one figure in its own cell, so the camera holds a
mostly-empty frame. The benchmark hides this because its beats share a drawing. Any lesson
whose beats each have their own picture looks like this — which is most narrative lessons.

_Where it lives:_ `planBoard`/`groupIntoRegions` in `planner/src/regions.ts` decide which
beats share a region, and `resolveFraming` in `core/src/camera.ts` frames the union. The
question is whether consecutive single-figure beats should share a region the way
annotating beats already do.

_Done when:_ `examples/lessons/longitude.lesson.json` renders above roughly 40% mean fill
without the benchmark regressing. Both numbers come from
`npx tsx packages/render/src/fillcheck.mts <project>/storyboard.json`.

**Verify it with `planhash.mts` and frames** — it is a storyboard _and_ a framing change,
so `sbhash.mts` sees the region assignment move and `planhash.mts` sees what that did to
the drawing.

## Where step 5 stopped

Done, and pinned by 18 tests in `visuals/test/character.test.ts`:

- `assets/library/characters/explorer.v1.json` — a ten-part rig, profile, four composed poses
  (`standing`, `walking`, `pointing`, `sitting`) plus `thinking` marked generated.
- `packages/visuals/src/character.ts` — loader with structural validation, composition with a
  parent chain, per-part seeding, the generated-pose orchestration.
- `AssetRef.variant` selects a pose end to end; `AssetVisual.library.pose` records
  `{ name, how, requested }`, and `name !== requested` is where a fallback shows up.
- The variant cache at `~/.inkcast/cache/characters/<id>/<pose>-<seed>.svg`, storing
  **geometry not a rendering**, written only for accepted candidates.
- **New:** the pedagogy can reach all of it. See step 5b in `PIPELINE.md`.

**What is left needs a key.** Two pieces:

1. **An image-to-image adapter.** `PoseGenerator` is the injected seam and nothing calls a
   provider. Do not guess the request shape — `image.ts` checked its shapes against the live
   provider schemas rather than recalling them, and that standard is the reason the lane works
   at all. Check flux's i2i schema before writing it.
2. **The real identity gate.** `plausibilityGate` is a deliberately-named floor: it compares
   ink quantity and proportion, rejects mush, and would accept a different person's face.
   `PoseGate` is the seam. This is the piece that decides whether a generated pose is
   trustworthy, so it is worth getting right rather than shipping approximately.

**If you add a pose to a rig, `CAST_POSES` in `planner/src/lesson-anthropic.ts` has to learn
about it.** That constant is what the model is told exists, and the planner cannot read the
library — it does not depend on `@inkcast/visuals` and should not start. The copy is pinned:
`pipeline/test/cast.test.ts` fails if the two disagree, so this is a caught mistake rather
than a silent one.

## Three things about rigs that are silent when wrong

Learned the hard way; all three are in `character.ts`'s header too.

**A rig must declare its `viewBox`, and it must contain the widest pose.** Every pose is
fitted through it. Measure it per pose instead and the head changes size between beats —
nothing looks broken, the character just stops being the same size. Size it to one pose and
the others hang outside their element box. `loadRig` refuses a rig without one; measure the
union of every pose and add a margin.

**Seed a part from the rig and the part id, never from its index.** A pose that hides the far
leg shifts every later part by one and re-wobbles the whole body. And never from the asset id:
one character in three beats is three `Asset` entries, so that gives the same face three
different wobbles.

**A sketch fill goes into roughjs, not onto its output.** Crisp output is the authored contour
so a fill can be set afterwards; sketch output is the wobbly stroke roughjs drew, so a
post-hoc fill fills the outline of a pen line. Both the library lane and `inkParts` branch on
this. It cost a render to find the first time.

## How to verify a visual change cheaply

Six tools, cheapest first. **Use the first one that can see your change.** They form a
chain — storyboard, then visuals geometry, then the render plan, then pixels — and the
right one is whichever sits at the stage you touched.

**1. Storyboard hashing — sub-second, and the only one that can see the planner.**
`packages/pipeline/src/sbhash.mts`:

    npx tsx packages/pipeline/src/sbhash.mts gradient-descent longitude > /tmp/after.txt
    git stash push -u && git status --short          # confirm the tree is CLEAN
    npx tsx packages/pipeline/src/sbhash.mts gradient-descent longitude > /tmp/before.txt
    git stash pop
    diff /tmp/before.txt /tmp/after.txt

Compiles only — no voice, no visuals, no render — and prints the whole-storyboard hash plus
the asset table (ids and refs) for both presets. **A planner change is a storyboard change and
tools 2–4 are all pointed downstream of the compiler**, so `projects/handwritten` will stay
byte-identical whatever you do to `buildAsset`. This is the one that notices.

**2. Per-element geometry hashing across a stash — seconds, and it sees what a frame grab
cannot.** `packages/visuals/src/geomhash.mts`:

    npx tsx packages/visuals/src/geomhash.mts handwritten > /tmp/after.txt
    git stash push -u && git status --short          # confirm the tree is CLEAN
    npx tsx packages/visuals/src/geomhash.mts handwritten > /tmp/before.txt
    git stash pop
    diff /tmp/before.txt /tmp/after.txt

It resolves the visuals stage into a temp dir, so the real project's cached assets are
neither read nor written, and hashes each element's stroke `d` values only.

**`projects/handwritten` is the project with `asset` elements** (2: `cpu` and `ram`, both on
the icon lane). It is the control that proves you have not disturbed what was already drawn.
`projects/final-169` is the benchmark (8 plots, 19 paths, a diagram) and has **zero**
assets, so it will tell you nothing about the library or a rig.

One gotcha reading the output of either tool: the stage logs to **stdout** too, so filter on
the tab separator rather than trusting redirection.

**3. Render-plan hashing — a second or two, and the proof that a refactor changed
nothing.** `packages/render/src/planhash.mts`:

    npx tsx packages/render/src/planhash.mts final-169 handwritten > /tmp/after.txt
    git stash push -u && git status --short          # confirm the tree is CLEAN
    npx tsx packages/render/src/planhash.mts final-169 handwritten > /tmp/before.txt
    git stash pop
    diff /tmp/before.txt /tmp/after.txt

Compiles the plan and hashes each item's prims — path data, text, colours, weights —
excluding timing, because `enter.at` is rewritten on every re-narration and a tool that
diffed on it would be useless for the geometry questions it exists to answer. A bare name
resolves under `projects/`; anything with a slash is a path, which is what lets you
measure a _scratch_ copy after re-running the visuals stage into it.

This is what `geomhash.mts` cannot tell you. `geomhash` measures what the visuals stage
resolves; `planhash` measures what the renderer will actually draw. Closing root cause 1
needed both at once: the plan had to come out byte-identical while the sidecar changed in
exactly eight places.

**4. A contact sheet of the library — about ten seconds, and it is how you look at a
drawing.** `packages/visuals/src/libsheet.mts`:

    npx tsx packages/visuals/src/libsheet.mts /tmp/sheet
    npx tsx packages/render/src/frames.mts /tmp/sheet /tmp/sheet-frames 20

Every library asset in a grid with its path under it, and **one cell per pose** for a rig —
which is the only way to see the thing that makes it a rig. Rendered with the cloud lane off.
A static SVG cannot show you what matters — the sketch pass rewrites the geometry, fills are
hachured, and document order becomes reveal order — so **render a new asset before
committing it.**

**5. Frame grabs — ~76 ms each, no encode.** `packages/render/src/frames.mts`:

    npx tsx packages/render/src/frames.mts <projectDir> <outDir> [seconds...]

With no timestamps it takes eight evenly spaced frames. It compiles the plan itself, so it
picks up live geometry changes **without re-running the pipeline** — except for equations,
which come from the sidecar and so need the visuals stage to have run.

**A project it can read needs the visuals stage to have run.** Plot geometry is no longer
derivable by the renderer — it reads `assets/visuals.json` — so a project without one draws
a labelled placeholder frame where each plot should be, and says so in the log. That is the
correct degradation, not a bug, and it is why the render tests resolve visuals through the
`planWithVisuals` helper in `render/src/fixture.ts`.

**A project dir it can read needs the storyboard the visuals stage returned, not the one you
compiled.** `resolveVisuals` returns a _clone_ carrying each asset's `svg` path and pinned
`ref`; it does not mutate its input. Write the return value to `storyboard.json` or every
asset renders as a labelled placeholder box, which looks like a resolution failure and is not.

Scene windows are estimated from the narration when voice has not run, so compute offsets
yourself: `max(1.8, words / 2.6 + 0.6) + hold` per scene, accumulated. A script that needs
both the planner and the renderer has to live in `packages/pipeline` — it is the only
package that depends on both.

**6. A full render**, only when you need audio or the encode:

    INKCAST_PROJECTS=/tmp/verify node apps/cli/bin/inkcast.mjs \
      cast examples/lessons/gradient-descent.lesson.json \
      --project bench --force --json

Add `--short` for the 9:16 pass. ~100 s each including a local Kokoro voice pass; render
stage alone is 38.8 s / 23.4 s. Afterwards, `npx tsx packages/render/src/fillcheck.mts
/tmp/verify/bench/storyboard.json` gives the content-fill number `STATUS.md` quotes.
**Stage timings from a loaded machine are worthless** — a narrative render measured 62.5 s of
voice on an idle machine and 275.7 s for the identical work while other jobs ran.

There is still **no golden-image or frame-diff harness**; the only pixel assertion anywhere
is a same-run self-consistency check in `page.test.ts`.

## Traps

**This repo is `inkcast`, at `~/code/inkcast`.** **Three** sessions have now been launched
with their working directory set to the sibling `finito` checkout. If the first thing you
see is a Next.js finance app, you are in the wrong repo. There is no git remote, so check
`git log` against the commit list above to confirm where you are. Shell `cd` does not
persist between commands; use absolute paths.

**A stage that starts _reading_ another stage's output has just gained a cache input.**
`renderFingerprint` hashed only the storyboard, which was correct for as long as the
renderer re-derived plot geometry. The moment it began reading `assets/visuals.json`, the
sidecar became a real input living outside the key — so a visuals change that left the
storyboard untouched would have kept serving the old video, which is the exact failure
`keys.ts`'s header is a cautionary tale about. Fixed by folding `visualsFingerprint` into
`renderFingerprint`. Whenever you make one stage consume another's artefact, ask what its
key now has to carry.

**A constant that is only ever one value hides every bug in the code that reads it.**
The `silence` provider sized its clip from `req.targetWpm` _and_ divided by `req.speed` —
which is already `targetWpm / naturalWpm` — so it applied the rate twice. That was invisible
for as long as every scene shared one global rate, because `speed` stayed at 1 and squaring
1 changes nothing. Per-scene `cadence` made it measurable in the first test that used it:
140 vs 160 wpm came out as 1.31x instead of 1.14x. When you make something vary that never
varied before, expect its consumers to be wrong in ways nothing could previously detect.

**Words-per-minute read off a whole scene is not the speech rate.** `durationSec` includes
the inter-clause gaps and the trailing pad, and a beat of four short sentences has far more
gap than one long sentence. Measured that way, the narrative lesson's `punchy` hook looks
_slower_ (121.7 wpm) than its `building_energy` steps (146 wpm) — which reads like cadence
being backwards and is not. To measure delivery, synthesise **identical words** at two
cadences and compare, the way `voice.test.ts` does.

**`git stash -u` takes your untracked measurement tool with it.** This cost a measurement in
the session that wrote this file: a throwaway hashing script under `packages/` vanished at
the exact moment the "before" run needed it. That is precisely why `geomhash.mts`,
`sbhash.mts`, `libsheet.mts` and `frames.mts` are _committed_ rather than kept in scratch. If
you write a new one, commit it first or recreate it inside the stash window and delete it
before `stash pop` — pop fails if the file is back in the way.

**A script under `/tmp` resolves its imports from `/tmp`.** This bites immediately with
workspace packages: `import … from '@inkcast/visuals'` in a `/tmp` script fails with
`ERR_MODULE_NOT_FOUND` however the path is written. Put throwaway scripts _inside_ the
package whose dependencies they need — and note `render` does not depend on `planner`; only
`pipeline` depends on everything.

**`git stash push --keep-index=false` fails and stashes nothing.** The flag takes no value,
so git errors out — but the error is one line and easy to miss, and the follow-up command
then runs against an _unstashed_ tree, producing a "baseline" identical to the new one that
looks like proof when nothing was compared. After any stash, run `git status --short` and
confirm the tree is actually clean before trusting a measurement.

**`--json` suppresses every log line, so a clean log is not a clean run.** A `cast --json`
render writes the report to stdout and leaves stderr **completely empty** — zero bytes, not
"warnings only". Grepping that file for `cue`, `warn` or `fill` returns nothing whatever
happened, which reads exactly like "no problems found". Drop `--json` when you want to see
what a stage said, and check `wc -c` on a log before concluding anything from its silence.
Dropping it is how the six cue warnings on the narrative lesson were found at all.

**`pnpm -r test | tail` will lie to you.** Piping through `tail` truncates per-package
output and the totals. Redirect the whole log to a file and sum with
`awk '/# pass [0-9]+$/ {p+=$NF} …'` — note the `$NF`, because the lines are prefixed with
the package name and `$3` silently sums nothing. Check that all **eight** test-bearing
packages appear (`core` has no tests).

**`pnpm lint` is `prettier --check .`,** so formatting is a hard gate, not advice. Run
`npx prettier --write` on what you touched before claiming green — and re-run it after late
edits to a doc, which is how an unformatted `HANDOFF.md` got committed once already.
**A hand-edited `examples/*.lesson.json` needs it too.**

**A library asset's cache key is not just the storyboard.** An unpinned `AssetRef` resolves
to whatever the manifest calls newest, and an aliased entity depends on a match table that
lives outside the storyboard entirely — so `libraryFingerprint()` feeds both into the asset
key, and `assetFingerprint`/`visualsFingerprint` in `pipeline/src/keys.ts` carry `ref`. A rig
adds a third such input (the pose, and whatever the rig file says).

**`teach <topic> --lesson <file>` silently ignores the file.** Passing both a topic and
`--lesson` derives a lesson from the topic instead, and with no Anthropic key that produces
a ~20-second stub. Use `cast`. Still worth fixing: the flag combination should either
honour `--lesson` or refuse.

**`next build` over a dirty `.next` still breaks.** `rm -rf apps/web/.next` first.

**Judge output from a keyed render, not the default.** The benchmark runs
`providers: planner heuristic` — the pedagogy is `lesson-derive.ts`, not a model. It only
holds together because the lesson is hand-authored; a topic-only run with no key
degenerates, and does not morph. Set an Anthropic key before concluding anything about
whether a concept lands. **For step 5 this cuts both ways:** the composed half of a rig must
be judged with no key at all (that is the point of it), and the generated half cannot be
judged without one. **The same now applies to `cast`:** the two shipped lessons are
hand-authored, so nothing here measures whether a _model_ fills in a cast sensibly.

**`seed: 0` means "no seed" in roughjs.** `Random.next()` tests `if (this.seed)` and falls
through to `Math.random()` when it is falsy, so zero is the single seed value that is _not_
reproducible. `baseOptions` nudges it to 1; do not remove that.

**Bump the stage version when output changes — and know when not to.**
`packages/pipeline/src/keys.ts` carries `STAGE_CODE_VERSION` and the reasoning; current state
is `storyboard@5, visuals@7, render@5`. The test is whether the stage produces a different
artefact _for identical inputs_. Step 5b bumped `storyboard` because every asset id moved from
a lucide slug to a description slug — note honestly that the benchmark's own hash did _not_
move, since it has no assets, so the bump is conservative for that lesson and correct in
general. Step 7 bumped it again for `cadence`/`emphasis` on every scene. Step 5 bumped nothing
on purpose, and **step 7 deliberately did not bump `voice`**: a storyboard with no cadence
produces byte-identical audio, and a scene that has one invalidates itself precisely, because
the per-scene wpm and the emphasis list are both in the voice cache key. Root cause 1
bumped `visuals` to 7 (every plot's recorded path data moved to board scale) and again
left `render` alone, this time on a byte-identical measurement of all 109 plan items —
and because `renderFingerprint` now folds in `visualsFingerprint`, so the visuals bump
propagates to the render on its own. **Editing a shipped rig in place is the case that
does need one** — every project that resolved it keeps its old drawing otherwise, which is
also the argument for adding `explorer.v2.json` instead.

## Deliberate stopgaps

**MathJax is a ~110 MB dependency** (`@mathjax/src` v4, used by the equation lane). There
is no small correct option: KaTeX is ~2.5 MB and cannot produce geometry. It is imported
**lazily**, so a storyboard with no equations never loads it, and its absence is survivable
— `resolveEquation` returns `undefined` and the caller draws the TeX source as text, tested
on both sides.

**An equation does not grow with the vertical type gain.** 9:16 applies a 1.42x gain to
_text_, but an equation is geometry fitted to a planner-measured box, so it does not scale
with it. Legible in both — taste, not breakage — and the fix is a role or a gain at the
`makeEquation` call site, which wants a frame to judge it by.

**Frame fill is measured as a proxy.** `contentFill` in `render/src/camera.ts` is the union
of element _bounding boxes_ over the view area. A single hand-drawn line has a large box and
little ink, so the number rewards big sparse shapes. Useful for catching regressions,
misleading as a target — read frames as well.

**One legacy vault may still exist on a machine.** `<repo>/.inkcast/keys.json` from the
pre-unification studio is no longer read. `vaultInfo()` reports it as `legacyPath`. There is
no migration and deliberately so.

**The pen sprite is invisible to the label solver.** Visuals places labels clear of ink and
of each other, but the marker sprite is a renderer-side decoration it knows nothing about,
so a label can still be struck through by the pen. Visible at `t=64` of the benchmark.

**A library asset is fitted to its element box, so it can be stretched.** `libraryPaths`
uses `fitMatrix`, which preserves aspect, but the box comes from the planner — a figure in a
wide box is centred with slack rather than distorted, and a figure in a box the wrong shape
is small. Nothing sizes an element box to the asset it will hold.

## Known defects, not fixed

**The planner and visuals disagree about `doubleWell`.** Two catalogues of the named curve
functions remain and they disagree:

    planner/src/curves.ts   a*x^4 - b*x^2 + tilt*x + k          defaults [1, 2, 0, 2]
    visuals/src/plot.ts     a*((x/b)^2 - 1)^2 + tilt*(x/b) + k  defaults [1, 1, 0.35, 0.4]

The planner **authors** these params (`plots.ts:402` passes `[1, 2, 0.55, 2.2]`) and also
runs `descend()` on its own `evalFn` to place the step dots, while visuals draws the curve.
So the drawn curve and the simulated descent can disagree and the dots can leave the curve.
Reachable through the `local-minima` recipe; the benchmark does not use it. Crisp plots make
this **more** visible, not less.

**The renderer draws with a different hand than the visuals stage.** `render/src/sketch.ts`
is a hand-rolled mulberry32 engine; the stage uses roughjs. Two implementations for `path`,
`shape`, `arrow`, `diagram`, `emphasis` and `text` — and for those types the stage's SVGs
are written and never read. This is the remaining half of root cause 1 and item 2 in "The
sequence". Plots and equations are closed: the renderer reads both from the sidecar.

**A single-figure beat fills about a quarter of the frame.** Measured at 23% mean content
fill on the narrative lesson against 52% on the benchmark, with the camera warning naming the
cause: one element per cell, so the camera holds mostly whitespace. Item 3 in "The sequence".

**The lucide lane is confidently wrong for an unmatched subject.** `odysseus-tied-the-mast`
matches `presentation` on a token where a lettered card carrying the real description would
be honest. Better than the `rocket` it drew before — the id and prompt now survive, so a key
fixes it properly — but still a wrong drawing. Item 5.

**Pacing is bounded by cadence, which means an author's `hold` is a request.** A beat marked
`punchy` asking for three seconds of silence gets 0.8, silently. That is the guarantee working
— it is what stops a quick beat sitting in dead air — but it will surprise someone who set a
hold and watched it not take effect. The ceilings are 0.8 / 1.6 / 3.0s for punchy /
building_energy / slow_deliberate, in `CADENCE` in `packages/core/src/lesson.ts`.

**Emphasis lands on a clause, not a word.** The clip is assembled per clause, so that is the
unit available: a phrase carrying emphasis slows the whole clause containing it by 0.92x and
adds 0.18s after it. Word-level stress needs the aligner's output fed back into synthesis,
which is step 8's machinery. The numbers are small on purpose — a heavy hand at this
granularity drags a sentence rather than stressing a word.

**Nothing writes on the board what the narrator says.** Measured on a photosynthesis
render: 11 of 14 technical terms are spoken and never drawn — ATP, NADPH and G3P three
times each, plus chlorophyll, thylakoid, chloroplast, rubisco, glucose, enzyme, membrane
and carbon dioxide. 203 words spoken against 51 drawn, and those 51 are beat headings,
three of them the identical string "The Calvin cycle". A whiteboard explainer writes the
term as it says it; this one never does. **The cue machinery to place a written term on
the exact spoken word already exists and already works word-exactly — nothing points it
at vocabulary.** No key and no new drawing ability required, which makes this the
cheapest large win available. Item 1 in "The sequence" once region grouping lands.

**Cue resolution is not failing for the reason step 8 addresses.** 67 of 67 cues on the
benchmark locate by text alone. The narrative lesson produced six warnings of a _different_
kind — the cue lands late in its own narration and the element is the beat's main picture, so
the voice stage clamps it to 15% and says so. That is a pedagogy problem the script stage
owns, not a matching problem `entersAtWord` would fix. One warning remains and it is
`b7_chain`, the compiler's own recap element, which no lesson can control.

**A generated pose that fell back keeps the fallback.** A project resolved against a cold
variant cache draws the composed pose, and its asset key does not depend on machine state — so
warming the cache later changes nothing until someone re-resolves. Same trade as a pinned asset
version, deliberately.

**A rigged figure sits in more air than a hand-authored one.** The rig's `viewBox` has to
contain its widest pose, so narrow poses are fitted with slack — visible on the contact sheet.
Inherent to the fixed viewBox that identity requires.

**The explorer's `sitting` pose reads thinly.** It hides the far leg correctly, but the arms
end up close enough to the torso outline that the seated figure reads as armless in a frame.
A rig-authoring fix (`explorer.v2.json`, not an edit in place), not a code one.

**`illustration` still needs a key for anything that is not a person.** Step 4 closed the
character half of this. An arbitrary object — a trebuchet, a rover — is a lucide icon or a
lettered card without a provider.

**Open elsewhere in the plan:** no multi-line/`align` equations; the planner only ever emits
one equation, the worked example's update line, with no `VisualIntent.kind: 'equation'` to ask
for others; `coreInsight` is validated but nothing downstream reads it; and the `$0.20/min`
cost target is still unaddressed — marginal cost is currently $0.00 on this machine because
everything runs locally.
