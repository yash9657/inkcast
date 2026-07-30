# Handoff — 2026-07-29 · start on step 5 (character rigs)

Session state, not design. `PIPELINE.md` is the durable architecture and `STATUS.md` is
the verification record; this file exists so a session starting cold knows exactly where
things stand, what to do next, and which traps are waiting.

Delete or rewrite this once step 5 lands. It goes stale by design.

**Your job: step 5.** The baseline under you is verified — read "Where things stand", then
go to "Step 5" and start. Everything after that is reference.

## Where things stand

Branch **`visuals-morph-density`**, ten commits on top of `e95258b`. Everything is local;
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
    The asset library: drawings we chose, pinned by version             <- step 4

Each message carries the reasoning for its own change and is worth reading before the
diff it belongs to. Steps 1, 6, 2, 3 and 4 of `PIPELINE.md` are done and marked ✅ there.

**The baseline is measured, not inherited.** `pnpm lint` clean, `pnpm -r typecheck` 0
errors across 9 projects, `pnpm -r test` **539 pass / 0 fail** across all eight
test-bearing packages. The benchmark renders end to end in both formats from the shipped
hand-authored lesson with no keys: 104.667 s / 3140 frames at 1920x1080, 61.500 s at
1080x1920, `cost $0.00`. Mean content fill 52.2% / 55.9%.

**`STATUS.md` now has two appendices**, both dated 07-29. Take library figures from the
second one ("The asset library"), pipeline figures from either — they agree — and treat
the 07-28 body as a historical record that is deliberately unedited.

## Step 5 — character rigs

**The goal**, verbatim from `PIPELINE.md`:

> **5. Character rigs.** `character.json`, composed poses, generated-variant cache,
> similarity gate. _Done when:_ the same character across three beats is pixel-identical
> where composed and above threshold where generated.

`PIPELINE.md`'s "The asset library" section has the `CharacterRig` shape and the
identity-across-poses gate. Read both. Note the acceptance bar is about **identity**, not
about drawing quality: three poses of one character that are recognisably the same person.

### What step 4 built for you

The library skeleton is done and the rigs hang off it. Concretely:

- **`packages/visuals/src/library.ts`** is the lane. It loads `assets/library/library.json`,
  resolves `<path>.v<N>.svg`, converts children to `InkPath`s honouring the entry's ink
  mode, and matches unreferenced entities by id then prompt. Its header carries the
  authoring rules; `assets/library/README.md` is the short version for whoever adds an asset.
- **`AssetRef`** is real: `packages/core/src/storyboard.ts`, reachable as `Asset.ref`.
  `variant` is **already in the type and read by nothing** — that is step 5's field, and it
  is the seam a pose arrives through.
- **`assets/library/figures/`** holds the four archetypes as v1. They are _poses_, not a
  character: four separate files with no shared identity, which is exactly the gap.
- **`AssetVisual.lane`** gained `'library'`, and `AssetVisual.library` records
  `{ path, version, ink, how }`. Assert on those rather than on "something was drawn".
- **`~/.inkcast/cache/`** is the machine-wide cache root (`cacheDir()` in
  `@inkcast/core`). The illustration lane already uses `cacheDir('illustrations')`; PIPELINE
  wants generated _variants_ under `~/.inkcast/cache/<id>/<pose>-<seed>.svg`, so the root and
  the convention are both there.

### The two traps waiting specifically for you

**A sketch fill must go into roughjs, not onto its output.** This cost a render to find.
Crisp output _is_ the authored contour, so setting `fill` on the returned `InkPath` works —
the equation lane does it. Sketch output is not: roughjs returns the wobbly _stroke_ it
drew, so a post-hoc fill fills the outline of a pen line, and the whole cast rendered with
ringed heads and hollow faces. `libraryPaths` now branches on the mode; a rig composing
limbs will hit exactly the same fork.

**A `<circle>` becomes a diamond under the sketch pass.** `svgChildren` converts a circle
to two half arcs, which leaves four control points for roughjs to displace, and at marker
roughness that reads as a rhombus. Every head in the cast is four cubics anchored at the
compass points instead. If a rig generates or composes round parts, author them the same way
— and do **not** "fix" this in `svgChildren`, because lucide shares that reader and every
icon's geometry would move.

### Acceptance

"Pixel-identical where composed" is a geometry assertion, so make it one: compose the same
part at the same pivot twice and compare `d` strings, not images. The seed discipline is
already load-bearing here — `seedFrom` is deterministic and `baseOptions` pins the crisp
seed — so identical composition input must give identical output or something upstream is
non-deterministic.

The generated half needs a key and cannot be asserted offline. Structure it so the
similarity gate is testable with a stub: the _decision_ (accept, retry once, fall back to a
composed pose) is code and should be pinned; the embedding call is the part that needs a
provider.

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
    npx tsx packages/render/src/frames.mts /tmp/sheet /tmp/sheet-frames 18

Every library asset in a grid with its path under it, rendered with the cloud lane off. A
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
keychain tests are opt-in, so 539/542 is the expected shape, not a failure.

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

**Bump the stage version when output changes.** `packages/pipeline/src/keys.ts` carries
`STAGE_CODE_VERSION` and the reasoning; current state is
`storyboard@3, visuals@6, render@5`. A rig changing how a character is drawn is a `visuals`
bump; `render` stays where it is as long as the renderer keeps inlining an asset's SVG
rather than re-deriving it.

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

**Nothing upstream constructs an `AssetRef`.** The planner mints slugs and prompts; every
library resolution in a real run happens through the alias table, and the reference is
written _back_. So the library is reachable but not yet _addressable_ by the pedagogy — a
lesson cannot ask for `figures/pointing` by name. `VisualIntent` is where that would go.

**`illustration` still needs a key for anything that is not a person.** Step 4 closed the
character half of this. An arbitrary object — a trebuchet, a rover — is a lucide icon or a
lettered card without a provider, and the degradation notice in `pipeline/src/degrade.ts`
now says exactly that.

**Open elsewhere in the plan:** no multi-line/`align` equations (one `equation` is one
line); the planner only ever emits one equation, the worked example's update line, with no
`VisualIntent.kind: 'equation'` to ask for others; `coreInsight` is validated but nothing
downstream reads it; and the `$0.20/min` cost target is still unaddressed — marginal cost is
currently $0.00 on this machine because everything runs locally.
