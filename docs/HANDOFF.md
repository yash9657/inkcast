# Handoff — 2026-07-29 · step 5 is half done; finish it or move to step 7

Session state, not design. `PIPELINE.md` is the durable architecture and `STATUS.md` is
the verification record; this file exists so a session starting cold knows exactly where
things stand, what to do next, and which traps are waiting.

Delete or rewrite this once the next step lands. It goes stale by design.

**Your job: read "Where step 5 stopped" and pick.** Finishing step 5 needs an API key and
cannot be verified without one. If you do not have one, step 7 (the script stage) is the next
thing that is fully doable offline. Everything after that is reference.

## Where things stand

Branch **`visuals-morph-density`**, eleven commits on top of `e95258b`. Everything is local;
there is **no remote**, so nothing is pushed anywhere and `git remote -v` is empty. In
order, by subject:

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

Each message carries the reasoning for its own change and is worth reading before the
diff it belongs to. Steps 1, 6, 2, 3 and 4 are done and marked ✅ in `PIPELINE.md`; step 5
is marked 🟡 with the split spelled out.

**The baseline is measured, not inherited.** `pnpm lint` clean, `pnpm -r typecheck` 0
errors across 9 projects, `pnpm -r test` **557 pass / 0 fail** across all eight
test-bearing packages. The benchmark renders end to end in both formats from the shipped
hand-authored lesson with no keys: 104.667 s / 3140 frames at 1920x1080, 61.500 s at
1080x1920, `cost $0.00`. Mean content fill 52.2% / 55.9%. The `projects/handwritten`
geometry hashes are byte-identical across both of the last two steps.

**`STATUS.md` now has three appendices.** Rig figures are in the third ("Character rigs"),
library figures in the second, pipeline figures in either of the last two — they agree. The
07-28 body is a historical record and deliberately unedited.

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

**What is left needs a key.** Two pieces:

1. **An image-to-image adapter.** `PoseGenerator` is the injected seam and nothing calls a
   provider. Do not guess the request shape — `image.ts` checked its shapes against the live
   provider schemas rather than recalling them, and that standard is the reason the lane works
   at all. Check flux's i2i schema before writing it.
2. **The real identity gate.** `plausibilityGate` is a deliberately-named floor: it compares
   ink quantity and proportion, rejects mush, and would accept a different person's face.
   `PoseGate` is the seam. This is the piece that decides whether a generated pose is
   trustworthy, so it is the piece worth getting right rather than shipping approximately.

**The largest gap here is not in the rig at all: nothing upstream can ask for a pose.** The
planner mints slugs and prompts, never an `AssetRef` and never a `variant`, so a rig is
reachable by hand and by alias and not by pedagogy. `VisualIntent` is where that would go, and
it is a planner change that needs no key.

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

Four tools, cheapest first. **Use the first one that can see your change.**

**1. Per-element geometry hashing across a stash — seconds, and it sees what a frame grab
cannot.** `packages/visuals/src/geomhash.mts`:

    npx tsx packages/visuals/src/geomhash.mts handwritten > /tmp/after.txt
    git stash push -u && git status --short          # confirm the tree is CLEAN
    npx tsx packages/visuals/src/geomhash.mts handwritten > /tmp/before.txt
    git stash pop
    diff /tmp/before.txt /tmp/after.txt

It resolves the visuals stage into a temp dir, so the real project's cached assets are
neither read nor written, and hashes each element's stroke `d` values only. Being
_committed_ is what makes the stash step work: `git stash -u` takes untracked files with it
and leaves tracked ones alone.

**`projects/handwritten` is the project with `asset` elements** (2: `cpu` and `ram`, both on
the icon lane). It is the control that proves you have not disturbed what was already drawn —
step 4's most useful single measurement was this diff coming out byte-identical.
`projects/final-169` is the benchmark (8 plots, 19 paths, a diagram) and has **zero**
assets, so it will tell you nothing about the library or a rig.

One gotcha reading the output: the stage logs to **stdout** too, so filter on the tab
separator rather than trusting redirection.

**2. A contact sheet of the library — about ten seconds, and it is how you look at a
drawing.** `packages/visuals/src/libsheet.mts`:

    npx tsx packages/visuals/src/libsheet.mts /tmp/sheet
    npx tsx packages/render/src/frames.mts /tmp/sheet /tmp/sheet-frames 20

Every library asset in a grid with its path under it, and **one cell per pose** for a rig —
which is the only way to see the thing that makes it a rig, since a rig drawn once tells you
nothing about whether its poses read as the same person. Rendered with the cloud lane off. A
static SVG cannot show you what matters — the sketch pass rewrites the geometry, fills are
hachured, and document order becomes reveal order — so **render a new asset before
committing it.** Both of step 4's real defects were invisible until this frame existed.

**3. Frame grabs — ~76 ms each, no encode.** `packages/render/src/frames.mts`:

    npx tsx packages/render/src/frames.mts <projectDir> <outDir> [seconds...]

With no timestamps it takes eight evenly spaced frames. It compiles the plan itself, so it
picks up live geometry changes **without re-running the pipeline** — except for equations,
which come from the sidecar and so need the visuals stage to have run.

Scene windows are estimated from the narration when voice has not run, so compute offsets
yourself: `max(1.8, words / 2.6 + 0.6) + hold` per scene, accumulated. A script that needs
both the planner and the renderer has to live in `packages/pipeline` — it is the only
package that depends on both.

**4. A full render**, only when you need audio or the encode:

    INKCAST_PROJECTS=/tmp/verify node apps/cli/bin/inkcast.mjs \
      cast examples/lessons/gradient-descent.lesson.json \
      --project bench --force --json

Add `--short` for the 9:16 pass. ~100 s each including a local Kokoro voice pass; render
stage alone is 38.8 s / 23.4 s. Afterwards, `npx tsx packages/render/src/fillcheck.mts
/tmp/verify/bench/storyboard.json` gives the content-fill number `STATUS.md` quotes, in a
second, instead of digging it out of a debug log.

There is still **no golden-image or frame-diff harness**; the only pixel assertion anywhere
is a same-run self-consistency check in `page.test.ts`. And **for anything that only changes
the storyboard, skip all four** — compile the lesson and hash the JSON either side of a
stash.

## Traps

**This repo is `inkcast`, at `~/code/inkcast`.** **Three** sessions have now been launched
with their working directory set to the sibling `finito` checkout. If the first thing you
see is a Next.js finance app, you are in the wrong repo. There is no git remote, so check
`git log` against the commit list above to confirm where you are. Shell `cd` does not
persist between commands; use absolute paths.

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

**`pnpm -r test | tail` will lie to you.** Piping through `tail` truncates per-package
output and the totals. Redirect the whole log to a file and sum with
`awk '/# pass [0-9]+$/ {p+=$NF} …'` — note the `$NF`, because the lines are prefixed with
the package name and `$3` silently sums nothing. Check that all **eight** test-bearing
packages appear (`core` has no tests). `keyvault` reports 58 tests but 55 passes — three
keychain tests are opt-in, so 557/560 is the expected shape, not a failure.

**`pnpm lint` is `prettier --check .`,** so formatting is a hard gate, not advice. Run
`npx prettier --write` on what you touched before claiming green — and re-run it after late
edits to a doc, which is how an unformatted `HANDOFF.md` got committed once already.

**A library asset's cache key is not just the storyboard.** An unpinned `AssetRef` resolves
to whatever the manifest calls newest, and an aliased entity depends on a match table that
lives outside the storyboard entirely — so `libraryFingerprint()` feeds both into the asset
key, and `assetFingerprint`/`visualsFingerprint` in `pipeline/src/keys.ts` carry `ref`. A rig
adds a third such input (the pose, and whatever the rig file says), and forgetting it means
your improvement is invisible until someone deletes the project.

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
judged without one.

**`seed: 0` means "no seed" in roughjs.** `Random.next()` tests `if (this.seed)` and falls
through to `Math.random()` when it is falsy, so zero is the single seed value that is _not_
reproducible. `baseOptions` nudges it to 1; do not remove that.

**Bump the stage version when output changes — and know when not to.**
`packages/pipeline/src/keys.ts` carries `STAGE_CODE_VERSION` and the reasoning; current state
is `storyboard@3, visuals@6, render@5`. The test is whether the stage produces a different
artefact _for identical inputs_. Step 5 bumped nothing on purpose: no existing asset's geometry
moved, and an asset that newly resolves to a rig invalidates itself through
`libraryFingerprint`. A global bump is for when you cannot tell which assets moved. **Editing a
shipped rig in place is the case that does need one** — every project that resolved it keeps its
old drawing otherwise, which is also the argument for adding `explorer.v2.json` instead.
`render` stays where it is as long as the renderer keeps inlining an asset's SVG rather than
re-deriving it.

## Deliberate stopgaps

**MathJax is a ~110 MB dependency** (`@mathjax/src` v4, used by the equation lane). There
is no small correct option: KaTeX is ~2.5 MB and cannot produce geometry. It is imported
**lazily**, so a storyboard with no equations never loads it, and its absence is survivable
— `resolveEquation` returns `undefined` and the caller draws the TeX source as text, tested
on both sides.

**An equation does not grow with the vertical type gain.** 9:16 applies a 1.42x gain to
_text_, but an equation is geometry fitted to a planner-measured box, so it does not scale
with it: in 16:9 the equation is about twice the caption's height, in 9:16 slightly smaller.
Legible in both — taste, not breakage — and the fix is a role or a gain at the
`makeEquation` call site, which wants a frame to judge it by.

**The worked example's arithmetic lands late.** Its cue resolves to 82% of the beat, so the
update line arrives after the descent it describes. Cue resolution is doing as it was
asked; whether that is the right cue is a pedagogy question about the beat.

**Frame fill is measured as a proxy.** `contentFill` in `render/src/camera.ts` is the union
of element _bounding boxes_ over the view area. A single hand-drawn line has a large box and
little ink, so the number rewards big sparse shapes. Useful for catching regressions,
misleading as a target — read frames as well.

**One legacy vault may still exist on a machine.** `<repo>/.inkcast/keys.json` from the
pre-unification studio is no longer read. `vaultInfo()` reports it as `legacyPath`. There is
no migration and deliberately so.

**The pen sprite is invisible to the label solver.** Visuals places labels clear of ink and
of each other, but the marker sprite is a renderer-side decoration it knows nothing about,
so a label can still be struck through by the pen. Visible at `t=64` of the benchmark —
"downhill" struck through, "too small" under the marker.

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
this **more** visible, not less: a dot off an exact curve no longer hides in a wobble.

**`visuals.json` is read for equations only.** Step 3 made the sidecar a real input for the
first time, but plots still go through `resolvePlot` in-process and every other element type
is re-derived by the renderer's own `primsFor`. Closing the rest needs
`resolveFraming`/`unitsPerPixel` (`render/src/camera.ts`) derivable somewhere the visuals
stage can reach, probably `@inkcast/core` — the remaining part of root cause 1.

**Nothing upstream constructs an `AssetRef`, and this is now the biggest gap in the area.**
The planner mints slugs and prompts; every library resolution in a real run happens through the
alias table, and the reference is written _back_. So the library is reachable but not
_addressable_ by the pedagogy — a lesson cannot ask for `figures/pointing` by name, and it
certainly cannot ask for `characters/explorer` in the `walking` pose, which is the entire point
of having built a rig. `VisualIntent` is where that goes, and it needs no key.

**A generated pose that fell back keeps the fallback.** A project resolved against a cold
variant cache draws the composed pose, and its asset key does not depend on machine state — so
warming the cache later changes nothing until someone re-resolves. Same trade as a pinned asset
version, deliberately, but it means `library.pose.how` in a sidecar records what happened once
rather than what is available now.

**A rigged figure sits in more air than a hand-authored one.** The rig's `viewBox` has to
contain its widest pose, so narrow poses are fitted with slack — visible on the contact sheet,
where the explorer cells are smaller than the `figures/` cells. Inherent to the fixed viewBox
that identity requires; tightening it to the measured union of all poses recovered about 10%.

**`illustration` still needs a key for anything that is not a person.** Step 4 closed the
character half of this. An arbitrary object — a trebuchet, a rover — is a lucide icon or a
lettered card without a provider, and the degradation notice in `pipeline/src/degrade.ts`
now says exactly that.

**Open elsewhere in the plan:** no multi-line/`align` equations (one `equation` is one
line); the planner only ever emits one equation, the worked example's update line, with no
`VisualIntent.kind: 'equation'` to ask for others; `coreInsight` is validated but nothing
downstream reads it; and the `$0.20/min` cost target is still unaddressed — marginal cost is
currently $0.00 on this machine because everything runs locally.
