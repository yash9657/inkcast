# Handoff — 2026-07-29 · start on step 4 (the library skeleton)

Session state, not design. `PIPELINE.md` is the durable architecture and `STATUS.md` is
the verification record; this file exists so a session starting cold knows exactly where
things stand, what to do next, and which traps are waiting.

Delete or rewrite this once step 4 lands. It goes stale by design.

**Your job: step 4.** The baseline under you is verified — read "Where things stand", then
go to "Step 4" and start. Everything after that is reference.

## Where things stand

Branch **`visuals-morph-density`**, nine commits on top of `e95258b`. Everything is local;
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

Each message carries the reasoning for its own change and is worth reading before the
diff it belongs to. Steps 1, 6, 2 and 3 of `PIPELINE.md` are done and marked ✅ there.

**The baseline is measured, not inherited.** `pnpm lint` clean, `pnpm -r typecheck` 0
errors across 9 projects, `pnpm -r test` **528 pass / 0 fail** across all eight
test-bearing packages. The benchmark renders end to end in both formats from the shipped
hand-authored lesson with no keys: 104.667 s / 3140 frames at 1920x1080, 61.500 s at
1080x1920, `cost $0.00`. Mean content fill 52.2% / 55.9%.

**Take figures from `STATUS.md`'s 2026-07-29 appendix, not from its body.** That document
is a dated record rather than a checklist, so the 07-28 body is deliberately unedited and
the appendix names the six claims that have moved.

## Step 4 — the library skeleton

**The goal**, verbatim from `PIPELINE.md`:

> **4. Library skeleton.** `library.json`, `AssetRef`, resolution order
> (library -> cache -> generate -> lucide), and the hand-authored `figures/` cast. Closes
> the no-key character gap as a side effect. _Done when:_ an asset resolves by path and
> version with no network.

`PIPELINE.md` has the intended directory layout under "The asset library" and the
`AssetRef` shape under "Asset reference". Read both before designing anything — and note
that `CharacterRig` in the same section belongs to **step 5**, not this one. Step 4 is the
skeleton the rigs will hang from.

### What exists today, concretely

Asset resolution lives in **`resolveAsset()`, `packages/visuals/src/resolve.ts:285`**, and
its lane order is currently:

1. **inline** — `Asset.svg` already holding `<svg…`, written out untouched and authoritative.
2. **illustration** — `illustrationPaths()` (`image.ts`), text-to-image → vectorise →
   roughen. Needs `REPLICATE_API_TOKEN` or `FAL_KEY`; a missing key downgrades, never errors.
3. **icon** — `matchAsset()` + `iconPaths()` (`icons.ts`), a roughened `lucide-static` glyph
   matched on the asset id first and the prompt second.
4. **letter card** — `letterCardItems()`, a hand-drawn rect with the entity's name in it.

Step 4 inserts the library as the new first stop after inline, and turns lane 2 into
"cache, then generate". `lucide` stays exactly where it is — `PIPELINE.md` is explicit that
it is a ~2000-icon _fallback provider_, not the library: "the library is the things we
chose; lucide is the things we settle for."

Other ground truth you will want:

- **`Asset`** is `packages/core/src/storyboard.ts:36` — `{ id, kind, prompt?, svg?, seed?,
source? }`, where `kind` is `illustration | icon | diagram | image`. `AssetRef`
  (`path`, `version`, `variant?`, `ink`) is a **new** type; nothing constructs one yet.
- **`AssetElement`** references an asset by `assetId` string, and the planner's `registry()`
  (`planner/src/compile.ts`) mints those ids from slugs. That is the seam where a
  library path would replace a bare slug.
- **Generated illustrations already cache**, but per project: `ILLUSTRATION_DIR =
'assets/illustrations'` (`visuals/src/image.ts:61`), keyed by id + prompt hash.
  `PIPELINE.md` wants the machine-wide cache at `~/.inkcast/cache/<id>/…` instead.
- **`assets/` in the repo currently holds only fonts** (`assets/fonts/hand`, `.../ui`).
  `assets/library/` does not exist. There is no `figures/` cast, which is why a character
  falls through to a lucide icon or a lettered card today.
- **`resolveVisuals`' `case 'asset'`** already fits a resolved entity's strokes from the
  sidecar into the element box with `fitMatrix` + `placeStrokes` — that is most of the
  machinery "resolve by path and version" needs on the drawing side.

### What steps 2 and 3 left open for you

**`AssetRef.ink` is the field the ink mode was built for.** `DrawContext.ink` exists and
defaults to `sketch`; `resolvePlot` and `resolveEquation` each set their own mode, and both
let a caller-supplied mode win. So threading `AssetRef.ink` through is wiring, not design.

**A library symbol is a filled crisp path, and that path used to break.** Step 3 found that
roughjs at zero roughness re-emits one subpath per segment and drops the closing `Z` —
invisible on a stroked line, fatal on a filled outline, which rendered every glyph hollow.
`roughenPathData` now bypasses roughjs entirely when the mode is crisp. Treat that as
load-bearing for step 4 rather than incidental: a hand-authored symbol with a filled
counter is exactly the case that regressed.

**`visuals.json` is now read, for equations.** If a library asset needs geometry the
renderer cannot recompute, the sidecar is the established route — see the "Equations _are_
read from `visuals.json`" note in `render/src/visuals.ts`, which explains what makes a lane
eligible (no camera-dependent unit in its geometry).

### Acceptance

"An asset resolves by path and version with no network" is the bar, so the test to write is
a resolution that runs with the image provider disabled and asserts the _library_ lane was
taken — not merely that something was drawn, which the icon and letter lanes already
guarantee. `AssetVisual.lane` is the field that records which lane won; add the new one to
that union and assert on it. Pin the version too: the point of `AssetRef.version` is that
improving an asset leaves existing videos rendering the old one, so a test that resolves v1
while v2 exists is the one that proves it.

## How to verify a visual change cheaply

Three tools, cheapest first. **Use the first one that can see your change.**

**1. Per-element geometry hashing across a stash — seconds, and it sees what a frame grab
cannot.** `packages/visuals/src/geomhash.mts` (sibling of `frames.mts`, not wired into any
script):

    npx tsx packages/visuals/src/geomhash.mts final-169 handwritten > /tmp/after.txt
    git stash push -u && git status --short          # confirm the tree is CLEAN
    npx tsx packages/visuals/src/geomhash.mts final-169 handwritten > /tmp/before.txt
    git stash pop
    diff /tmp/before.txt /tmp/after.txt

It resolves the visuals stage into a temp dir, so the real project's cached assets are
neither read nor written, and hashes each element's stroke `d` values only. Being
_committed_ is what makes the stash step work: `git stash -u` takes untracked files with it
and leaves tracked ones alone.

For step 4, **`projects/handwritten` is the project that matters** — it is the one with
`asset` elements (2), plus shapes and emphasis. `projects/final-169` is the benchmark (8
plots, 19 paths, a diagram) and has **zero** assets, so it will tell you nothing about the
library lane while making a useful control that you have not disturbed anything else.

One gotcha reading the output: the stage logs to **stdout** too, so filter on the tab
separator rather than trusting redirection.

**2. Frame grabs — ~76 ms each, no encode.** `packages/render/src/frames.mts`:

    npx tsx packages/render/src/frames.mts <projectDir> <outDir> [seconds...]

With no timestamps it takes eight evenly spaced frames. It compiles the plan itself, so it
picks up live geometry changes **without re-running the pipeline** — except for equations,
which come from the sidecar and so need the visuals stage to have run.

**To see a planner change in a frame without paying for voice**, compile the lesson and run
visuals into a temp dir, then point `frames.mts` at it — about ten seconds against four
minutes. `Lesson.parse` (there is no `parseLesson` export) → `compileLesson` →
`resolveVisuals`, write `storyboard.json` back, then grab frames. Scene windows are
estimated from the narration when voice has not run, so compute the offsets yourself:
`max(1.8, words / 2.6 + 0.6) + hold` per scene, accumulated. Such a script has to live in
`packages/pipeline` — it is the only package that depends on both the planner and the
renderer.

**3. A full render**, only when you need audio or the encode:

    INKCAST_PROJECTS=/tmp/verify node apps/cli/bin/inkcast.mjs \
      cast examples/lessons/gradient-descent.lesson.json \
      --project bench --force --json

Add `--short` for the 9:16 pass. ~4 minutes each including a local Kokoro voice pass;
render stage alone is 41.2 s / 30.1 s. The last full render's numbers are in `STATUS.md`'s
appendix, so you have a baseline to compare against rather than a vibe.

There is still **no golden-image or frame-diff harness**; the only pixel assertion anywhere
is a same-run self-consistency check in `page.test.ts`. And **for anything that only changes
the storyboard, skip all three** — compile the lesson and hash the JSON either side of a
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
keychain tests are opt-in, so 528/531 is the expected shape, not a failure.

**`pnpm lint` is `prettier --check .`,** so formatting is a hard gate, not advice. Run
`npx prettier --write` on what you touched before claiming green — and re-run it after late
edits to a doc, which is how an unformatted `HANDOFF.md` got committed once already.

**`teach <topic> --lesson <file>` silently ignores the file.** Passing both a topic and
`--lesson` derives a lesson from the topic instead, and with no Anthropic key that produces
a ~20-second stub. Use `cast`. Still worth fixing: the flag combination should either
honour `--lesson` or refuse.

**`next build` over a dirty `.next` still breaks.** `rm -rf apps/web/.next` first.

**Judge output from a keyed render, not the default.** The benchmark runs
`providers: planner heuristic` — the pedagogy is `lesson-derive.ts`, not a model. It only
holds together because the lesson is hand-authored; a topic-only run with no key
degenerates, and does not morph. Set an Anthropic key before concluding anything about
whether a concept lands. **This matters unusually much for step 4:** the no-key path is
exactly where the character gap shows, so test the `figures/` cast without a key on
purpose.

**`seed: 0` means "no seed" in roughjs.** `Random.next()` tests `if (this.seed)` and falls
through to `Math.random()` when it is falsy, so zero is the single seed value that is _not_
reproducible. `baseOptions` nudges it to 1; do not remove that.

**Bump the stage version when output changes.** `packages/pipeline/src/keys.ts` carries
`STAGE_CODE_VERSION` and the reasoning; current state is
`storyboard@3, visuals@5, render@5`. A library asset changing how something is drawn is a
`visuals` bump, and the file's header explains why forgetting costs you an afternoon of
suspecting the wrong thing.

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

**`illustration` never resolves without a key**, and characters are stick figures or
lettered cards. **This is the gap step 4 is meant to close**, so it is listed here as the
starting condition rather than as a complaint.

**Open elsewhere in the plan:** no multi-line/`align` equations (one `equation` is one
line); the planner only ever emits one equation, the worked example's update line, with no
`VisualIntent.kind: 'equation'` to ask for others; `coreInsight` is validated but nothing
downstream reads it; and the `$0.20/min` cost target is still unaddressed — marginal cost is
currently $0.00 on this machine because everything runs locally.
