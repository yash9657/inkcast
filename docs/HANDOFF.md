# Handoff — 2026-07-29 (steps 1, 6, 2 and 3 landed; step 4 is next)

Session state, not design. `PIPELINE.md` is the durable architecture and `STATUS.md`
is the last verification report; this file exists so a session starting cold knows
what changed underneath both of them, and which traps are waiting.

Delete or rewrite this once the next piece of work lands. It goes stale by design.

## Where the code is

Branch **`visuals-morph-density`**, eight commits on top of `e95258b`. Everything is
local; there is **no remote**, so nothing is pushed anywhere. In order, by subject:

    Keyvault: one vault, shared by the CLI and the studio
    Morph the anchor into the plot, and make cells frame-shaped
    docs: the staged-pipeline architecture, and a handoff
    One implementation of plot geometry, and it is the good one
    docs: rewrite the handoff for step 6
    Lesson schema v2: the morph comes from the mapping, not the prose
    Two ink modes, and plots draw crisp
    The equation lane: real typeset mathematics                        <- new

Each message carries the reasoning for its own change; read them before the diffs.

Which files step 3 touched:

    packages/core/src/storyboard.ts          `EquationElement`, into the Element union
    packages/visuals/src/equation.ts         NEW: the lane — MathJax, extraction, fitting
    packages/visuals/src/geometry.ts         crisp now bypasses roughjs (see the defect below)
    packages/visuals/src/manifest.ts         `ElementVisual.equation`
    packages/visuals/src/resolve.ts          case 'equation', with a text fallback
    packages/render/src/visuals.ts           `equationFor` — the first sidecar *read*
    packages/render/src/compile.ts           `equationPrims`, one prim per glyph
    packages/planner/src/elements.ts         `makeEquation`, and TeX width estimation
    packages/planner/src/compile.ts          `updateLine` emits TeX; the sum is an equation
    packages/pipeline/src/keys.ts            storyboard@3, visuals@5, render@5
    packages/visuals/test/equation.test.ts   NEW
    docs/PIPELINE.md                         step 3 done; the step 2 correction

Verified at that commit: `pnpm lint` clean, `pnpm -r typecheck` 0 errors across 9
projects, `pnpm -r test` **524 pass / 0 fail** (was 513). Frame grabs confirm the
milestone example renders as real glyphs, revealing left to right with the pen tracking
the write position, both standalone and as the benchmark's worked-beat update line.
**No full render or encode has been done since step 1** — the benchmark check compiled
the lesson and ran visuals only, skipping voice, so the 104.6 s figure is still
inherited.

## What step 3 actually did

A new `equation` element carrying **TeX**, typeset by the visuals stage into exact glyph
outlines, revealed glyph by glyph from left to right, and drawn `crisp`.

**The typesetter is MathJax (`@mathjax/src` v4), not KaTeX, and that is a departure from
the plan.** KaTeX has no SVG output — it emits `<span>`s positioned by CSS, so getting
geometry out of it means running a CSS engine or reimplementing KaTeX's layout rules
against its internal tree. MathJax's SVG output is pure Node, needs no browser and no
font files, and returns glyph outlines already placed. The plan's _goal_ was real glyphs
as exact vector; the engine was a means, and this is the one that gets there without a
second implementation of TeX layout to drift out of sync.

Three consequences worth knowing before touching the lane:

**The output surface is tiny, and the extractor asserts it stays that way.** With
`fontCache: 'none'` MathJax emits only `<g>`, `<path>` and `<rect>` inside one `<svg>`,
and only `translate`/`scale` transforms — verified across fractions, roots, sums,
integrals, matrices and accents. So `equation.ts` walks the tree composing matrices
rather than parsing SVG, and an unrecognised transform **warns and drops that mark**
rather than guessing. That asymmetry is deliberate: a misplaced glyph is a _different
equation_, and the whole point of the lane is that the notation can be trusted.

**Glyphs are filled outlines, so the reveal is per glyph rather than per stroke.** The
marks come out ordered left to right, and the page runtime already gives every part of an
item a slice of the timeline proportional to its ink, in drawing order — so the ordering
_is_ the animation and the renderer needed no new capability. Each glyph also carries a
thin stroke (3% of its em) because the stroke is what gets dash-revealed, with the fill
fading in over the same window.

**`visuals.json` is finally read, not just written.** Equations are the first geometry the
renderer consumes from the sidecar. They escape the reason plots cannot be: an equation is
fit to its element's box in canvas units and has no camera-dependent unit anywhere in it,
whereas a plot's caption size _is_ its unit of measurement. And they could not be
recomputed in the renderer even if we wanted to — typesetting is an async import and
`compilePlan` is synchronous.

`base` is the only TeX package loaded. It already covers fractions, roots, sub/
superscripts, Greek, integrals, sums, `\text`, `\hat`, `\vec` and the standard operators
and arrows. MathJax 4 requires each further package to be imported to self-register, so
adding one is a deliberate act rather than a default.

### The defect step 3 found in step 2, and fixed

**Step 2's "crisp path data is used verbatim" was only nearly true**, and the equation
lane is what exposed it. roughjs at `roughness: 0` keeps every control point but re-emits
the result **one subpath per segment**, inserting a `moveto` before each curve and
dropping the `Z` that closed the contour. On a stroked line that is invisible — each
`moveto` lands exactly where the previous segment ended, so the same pixels are drawn.
On a _filled_ one it is fatal: a glyph outline arrives as forty independent open curves
with no closed contour left to fill, and every letter rendered as a hollow outline. The
frame of that looks like a deliberate stylistic choice, which is what makes it dangerous.

`roughenPathData` now bypasses roughjs entirely when the mode is crisp, taking our own
`parsePath`/`pathToString` round-trip, which preserves subpaths and closes and only
normalises precision. Crisp plot curves changed as a side effect — one subpath of 240
segments where there were 240 subpaths of one — which is why `visuals`/`render` moved to
@5 rather than only gaining a field.

**The step 2 test that should have caught this used a single-segment path**, the one input
for which roughjs inserts no extra `moveto`. It now uses a multi-segment closed path and
asserts both the subpath count and the trailing `Z`, plus a second test that a crisp path
can carry a fill at all. Worth remembering as a shape of mistake: the test named the right
property and chose the one input that could not exercise it.

Not done, and not required by step 3:

- **No `\begin{align}` or multi-line equations.** One `equation` is one line. Stacking
  two is two elements, and nothing aligns them on `=`.
- **The planner only ever emits one equation**, the worked example's update line. Every
  other beat still gets prose. A `VisualIntent.kind: 'equation'` would be the way to let
  the lesson ask for one, and it does not exist.
- **`makeEquation` estimates its box from the TeX source**, since the planner cannot see
  the typeset result. Control sequences count as one glyph and `\frac` collapses to its
  longer side. An over-generous estimate costs whitespace and an under-generous one costs
  size — never a collision, because the visuals stage fits into whatever box it is given,
  preserving aspect.
- `AssetRef.ink` is still not wired, and `cast`, `coreInsight`'s consumer and the
  `$0.20/min` target are all still open.

## Step 4 — the library skeleton. Start here.

**The goal** (`PIPELINE.md` step 4): `library.json`, `AssetRef`, resolution order
(library -> cache -> generate -> lucide), and the hand-authored `figures/` cast. Closes
the no-key character gap as a side effect. _Done when:_ an asset resolves by path and
version with no network.

Two things from steps 2 and 3 land directly on this. `AssetRef.ink` is the field the ink
mode was built for — `resolvePlot` and `resolveEquation` each decide their own mode today,
and both already let a caller-supplied mode win, so the seam is open. And a library symbol
is exactly the filled crisp path that the roughjs defect above would have broken, so treat
that fix as load-bearing rather than incidental.

Note that `resolveVisuals`' `case 'asset'` already fits a resolved entity's strokes into
the element box with `fitMatrix` + `placeStrokes`, which is most of what "resolve by path
and version" has to produce.

## How to verify a visual change cheaply

Three tools, cheapest first. **Use the first one that can see your change.**

**1. Per-element geometry hashing across a stash — seconds, and it sees what a frame
grab cannot.** `packages/visuals/src/geomhash.mts` (sibling of `frames.mts`, not wired
into any script):

    npx tsx packages/visuals/src/geomhash.mts final-169 handwritten > /tmp/after.txt
    git stash push -u && git status --short          # confirm the tree is CLEAN
    npx tsx packages/visuals/src/geomhash.mts final-169 handwritten > /tmp/before.txt
    git stash pop
    diff /tmp/before.txt /tmp/after.txt

It resolves the visuals stage into a temp dir, so the real project's cached assets are
neither read nor written, and hashes each element's stroke `d` values only. Being
_committed_ is what makes the stash step work: `git stash -u` takes untracked files with
it and leaves tracked ones alone.

`projects/final-169` is the benchmark (8 plots, 19 paths, arrows, a diagram);
`projects/handwritten` complements it (shapes, emphasis, assets) and between them they
cover every element type. Both storyboards predate the equation element, which made them
a clean control for step 3: only the 8 plots moved, and all 45 sketch elements came back
byte-identical. One gotcha when reading the output — the stage logs to **stdout** too, so
filter on the tab separator rather than trusting redirection.

**2. Frame grabs — ~76 ms each, no encode.** `packages/render/src/frames.mts`:

    npx tsx packages/render/src/frames.mts <projectDir> <outDir> [seconds...]

With no timestamps it takes eight evenly spaced frames. It compiles the plan itself, so
it picks up live geometry changes **without re-running the pipeline** — except for
equations, which come from the sidecar and therefore need the visuals stage to have run.
For plot work `t=40` and `t=64` of `projects/final-169` are the plot-dense beats.

**To see a planner change in a frame without paying for voice**, compile the lesson and
run visuals into a temp dir, then point `frames.mts` at it — about ten seconds against
four minutes. `Lesson.parse` (there is no `parseLesson` export) -> `compileLesson` ->
`resolveVisuals`, write `storyboard.json` back, then grab frames. Scene windows are
estimated from the narration when voice has not run, so compute the offsets yourself:
`max(1.8, words / 2.6 + 0.6) + hold` per scene, accumulated. The worked beat is `s6`,
landing around 68–82 s. A script that does this has to live in `packages/pipeline` — it is
the only package that depends on both the planner and the renderer.

**3. A full render**, only when you need audio or the encode:

    INKCAST_PROJECTS=/tmp/verify node apps/cli/bin/inkcast.mjs \
      cast examples/lessons/gradient-descent.lesson.json \
      --project bench --force --json

Add `--short` for the 9:16 pass. ~4 minutes, including a local Kokoro voice pass.

There is still **no golden-image or frame-diff harness**; the only pixel assertion
anywhere is a same-run self-consistency check in `page.test.ts`. And **for anything that
only changes the storyboard, skip all three** — compile the lesson and hash the JSON
either side of a stash.

## Traps

**This repo is `inkcast`, at `~/code/inkcast`.** It has **no git remote**, so
`git remote -v` is empty and cannot confirm anything — check `git log` against the commit
list above instead. **Three** sessions have now been launched with their working
directory set to the sibling `finito` checkout. If the first thing you see is a Next.js
finance app, you are in the wrong repo. Shell `cd` does not persist between commands;
use absolute paths.

**A script under `/tmp` resolves its imports from `/tmp`.** This bites immediately with
workspace packages: `import ... from '@inkcast/visuals'` in a `/tmp` script fails with
`ERR_MODULE_NOT_FOUND` however the path is written. Put throwaway scripts _inside_ the
package whose dependencies they need — and remember `render` does not depend on `planner`;
only `pipeline` depends on everything.

**`git stash push --keep-index=false` fails and stashes nothing.** The flag takes no
value, so git errors out — but the error is one line and easy to miss, and the follow-up
command then runs against an _unstashed_ tree, producing a "baseline" identical to the
new one that looks like proof when nothing was compared. After any stash, run
`git status --short` and confirm the tree is actually clean before trusting a measurement.

**`pnpm -r test | tail` will lie to you.** Piping through `tail` truncates per-package
output and the totals. Redirect the whole log to a file and sum with
`awk '/# pass [0-9]+$/ {p+=$NF} ...'` — note the `$NF`, because the lines are prefixed
with the package name and `$3` silently sums nothing. Check that all **eight**
test-bearing packages appear (`core` has no tests). Also: `keyvault` reports 58 tests but
55 passes — three are skipped, so 524/527 is the expected shape, not a failure.

**`pnpm lint` is `prettier --check .`,** so formatting is a hard gate, not advice. Run
`npx prettier --write` on what you touched before claiming green — and re-run it after
late edits to a doc, which is how an unformatted `HANDOFF.md` got committed once already.

**`teach <topic> --lesson <file>` silently ignores the file.** Passing both a topic and
`--lesson` derives a lesson from the topic instead, and with no Anthropic key that
produces a ~20-second stub. Use `cast`. Still worth fixing: the flag combination should
either honour `--lesson` or refuse.

**`next build` over a dirty `.next` still breaks.** `rm -rf apps/web/.next` first.

**Judge output from a keyed render, not the default.** The benchmark runs
`providers: planner heuristic` — the pedagogy is `lesson-derive.ts`, not a model. It only
holds together because the lesson is hand-authored; a topic-only run with no key
degenerates, and does not morph. Set an Anthropic key before concluding anything about
whether the concept lands.

**`seed: 0` means "no seed" in roughjs.** `Random.next()` tests `if (this.seed)` and
falls through to `Math.random()` when it is falsy, so zero is the single seed value that
is _not_ reproducible. `baseOptions` nudges it to 1; do not remove that.

**Existing projects are stale against storyboard@3 / visuals@5 / render@5.** Intended —
the boards and the plot geometry genuinely changed — but the next `cast` over
`projects/final-169` will recompile, re-resolve and re-render rather than serving cache,
and will look like it is doing far more work than your change should cause.

## Deliberate stopgaps

**MathJax is a ~110 MB dependency.** There is no small correct option: KaTeX is ~2.5 MB
and cannot produce geometry, and writing a TeX layout engine is not a trade anyone should
take. It is imported **lazily**, so a storyboard with no equations never loads it, and its
absence is survivable — `resolveEquation` returns `undefined` and the caller draws the TeX
source as text. That fallback is tested on both sides (`unusable source falls back` in
visuals, `an equation with no typeset geometry falls back` in render).

**Frame fill is measured as a proxy.** `contentFill` in `render/src/camera.ts` is the
union of element _bounding boxes_ over the view area. A single hand-drawn line has a
large box and little ink, so the number rewards big sparse shapes. Useful for catching
regressions, misleading as a target — read frames as well.

**One legacy vault may still exist on a machine.** `<repo>/.inkcast/keys.json` from the
pre-unification studio is no longer read. `vaultInfo()` reports it as `legacyPath`. There
is no migration and deliberately so.

**The pen sprite is invisible to the label solver.** Visuals places labels clear of ink
and of each other, but the marker sprite is a renderer-side decoration it knows nothing
about, so a label can still be struck through by the pen. Still visible at `t=64` of the
benchmark — "downhill" is struck through and "too small" sits under the marker.

## Known defects, not fixed

**The planner and visuals disagree about `doubleWell`.** Two catalogues of the named
curve functions remain and they disagree:

    planner/src/curves.ts   a*x^4 - b*x^2 + tilt*x + k          defaults [1, 2, 0, 2]
    visuals/src/plot.ts     a*((x/b)^2 - 1)^2 + tilt*(x/b) + k  defaults [1, 1, 0.35, 0.4]

The planner **authors** these params (`plots.ts:402` passes `[1, 2, 0.55, 2.2]`) and also
runs `descend()` on its own `evalFn` to place the step dots, while visuals draws the
curve. So the drawn curve and the simulated descent can disagree and the dots can leave
the curve. Reachable through the `local-minima` recipe; the benchmark does not use it.
Crisp plots make this **more** visible, not less: a dot off an exact curve no longer
hides in a wobble.

**`rerender()` has a weaker cache gate of its own.** The visuals cache naming was fixed
in `cast.ts`, but `rerender()` (`cast.ts:796`) still re-runs visuals only when an asset
lacks an `svg` (`missingArt`, :871) or the board fingerprint moved, and never checks that
element SVGs or the manifest exist. **This now matters more than it did:** equations are
read from the manifest, so a path that skips visuals against a stale manifest yields a
board whose equations fall back to raw TeX.

**`visuals.json` is read for equations only.** Step 3 made the sidecar a real input for
the first time, but plots still go through `resolvePlot` in-process and every other
element type is re-derived by the renderer's own `primsFor`. Closing the rest needs
`resolveFraming`/`unitsPerPixel` (`render/src/camera.ts`) derivable somewhere the visuals
stage can reach, probably `@inkcast/core` — that is the remaining part of root cause 1.

**`STATUS.md` is dated 2026-07-28 and is now five changes stale.** Its "two vaults",
"anchor draws a second hillside" and "mean content fill 48%/53%" defects are fixed, its
"`visuals.json` is written and never read" is now half-true as described above, and its
account of plot ink predates crisp mode while its account of the worked beat predates the
equation lane. Everything else in it stands, including `illustration` never resolving
without a key.
