# Handoff — 2026-07-29 (steps 1, 6 and 2 landed; step 3 is next)

Session state, not design. `PIPELINE.md` is the durable architecture and `STATUS.md`
is the last verification report; this file exists so a session starting cold knows
what changed underneath both of them, and which traps are waiting.

Delete or rewrite this once the next piece of work lands. It goes stale by design.

## Where the code is

Branch **`visuals-morph-density`**, seven commits on top of `e95258b`. Everything is
local; there is **no remote**, so nothing is pushed anywhere. In order, by subject:

    Keyvault: one vault, shared by the CLI and the studio
    Morph the anchor into the plot, and make cells frame-shaped
    docs: the staged-pipeline architecture, and a handoff
    One implementation of plot geometry, and it is the good one
    docs: rewrite the handoff for step 6
    Lesson schema v2: the morph comes from the mapping, not the prose
    Two ink modes, and plots draw crisp                                <- new

Each message carries the reasoning for its own change; read them before the diffs.

Which files step 2 touched:

    packages/visuals/src/geometry.ts        `DrawContext.ink`, the `CRISP` options, the seed guard
    packages/visuals/src/plot.ts            the plot sets its own mode; crisp keeps every sample
    packages/visuals/src/index.ts           exports `InkMode`
    packages/pipeline/src/keys.ts           visuals@4, render@4
    packages/visuals/src/geomhash.mts       NEW: the verification tool used to prove this
    packages/visuals/test/{geometry,plot}.test.ts
    docs/PIPELINE.md                        step 2 marked done; "as built" note on the mode

Verified at that commit: `pnpm lint` clean, `pnpm -r typecheck` 0 errors across 9
projects, `pnpm -r test` **513 pass / 0 fail** (was 507; six new tests). Plot pixels
were read at `t=40` and `t=64` of the benchmark via frame grabs either side of a stash.
**No full render or encode has been done since step 1**, so the 104.6 s / 1920x1080
benchmark figure is still inherited rather than re-measured.

## What step 2 actually did

`DrawContext.ink?: 'crisp' | 'sketch'`, defaulting to `sketch`, applied in **exactly one
place**: `baseOptions()` in `geometry.ts`. Crisp zeroes roughjs's perturbation family
and pins its seed; sketch is untouched, byte for byte.

The reason it is one place and not a crisp emitter per primitive is the thing worth
knowing: **`gen.path(d)` at `roughness: 0` returns `d` verbatim**, segment for segment.
Every displacement roughjs applies is multiplied by `roughness`, so zero is a master
switch, and the mode needs no second implementation of any shape. That matters here
specifically — step 1 was spent deleting a duplicate geometry implementation, and
hand-writing exact emitters for line/arc/polygon would have reintroduced the same class
of bug one layer down.

`resolvePlot` sets the mode for **the whole plot**, not only its curves. An axis, a tick
and a marked point are all things a learner reads a coordinate against, and a wobbling
axis under an exact curve is worse than either choice made consistently. The
handwriting is untouched (it comes from the text lane, a real font either way), so the
board still reads hand-drawn rather than turning into a chart — that is visible in the
frame grabs and was the thing worth checking with eyes rather than assertions.

One judgement call beyond the literal wording of the step: **crisp skips the polyline
simplification.** The tolerance is `max(1.1, strokeWidth * 0.35)`, and the module header
justifies it explicitly as landing the _wobble_ at human scale — feed roughjs 240
one-unit segments and you get 240 tiny wobbles. With nothing smearing the curve that
argument is gone and the tolerance only buys up to a stroke-width of deviation from the
real function, so crisp keeps every sample. `simplifyPolyline` reads a non-positive
epsilon as "dedupe only", which is the one part of it the spline still needs.

### Two traps found on the way, both now guarded

**`seed: 0` means "no seed" in roughjs.** `Random.next()` tests `if (this.seed)` and
falls through to `Math.random()` when it is falsy — so zero is the single seed value
that is _not_ reproducible. `seedFrom()` returns `hash % 0x7fffffff` and `baseOptions`
then adds a bump modulo the same, both of which can land on 0, so this was a latent
one-in-two-billion non-determinism in the sketch lane as well. Nudged to 1, which
changes no output except in the case that was already broken.

**Crisp geometry is exact but its _encoding_ still consumed the RNG.** roughjs emits a
straight segment as a degenerate cubic whose interior control points come from a
`divergePoint` drawn from the RNG. Left on the mark's own seed, two identical crisp axes
lie on exactly the same line with different control points — reproducible but not
comparable. Hence the pinned seed in `CRISP`. Consequence to respect: each zeroed
offset still _consumes_ a draw, so **adding or removing a flag from that list reshuffles
those control points** — the geometry is unaffected, the bytes are not. The list is
pinned deliberately; the comment says so.

Not done, and not required by step 2:

- **`AssetRef.ink` is not wired.** `AssetRef` is still a stage-1 sketch in `PIPELINE.md`
  and nothing constructs one, so the plot resolver decides its own mode. A
  caller-supplied `ink` wins where given, which is the seam the field arrives through.
- The renderer's freehand lane (`sketchAlong`, `render/src/sketch.ts`) is untouched and
  therefore implicitly sketch. It has no crisp form and does not need one.
- `cast`, `coreInsight`'s consumer and the `$0.20/min` cost target are all still open,
  exactly as the last handoff left them.

## Step 3 — the equation lane. Start here.

**The goal** (`PIPELINE.md` step 3): a new `equation` element; KaTeX -> SVG -> glyph path
extraction -> crisp stroke reveal. _Done when:_ `w \leftarrow 3 - 0.1 \times 4 = 2.6`
renders as real glyphs and reveals left to right. _Replaces:_ arithmetic-as-text.

Step 2 is the half of this that was in the way: the mode exists, it is one flag, and
`roughenPathData(ctx, d)` with `ink: 'crisp'` hands back glyph outlines untouched — which
is exactly what an extracted KaTeX path needs, and the test
`crisp path data is used verbatim` pins it. What is left is genuinely the KaTeX side:
getting glyph outlines out (KaTeX emits `<span>`s with fonts by default, so this needs
its MathML/SVG path or a font-outline pass), then ordering the strokes left to right so
the reveal reads as writing rather than as a wipe.

Note that the text lane already solves the adjacent problem — `text.ts` writes real
handwriting with per-line reveal masks and per-word progress windows — so read it before
inventing a reveal scheme for equations.

## How to verify a visual change cheaply

Three tools, cheapest first. **Use the first one that can see your change.**

**1. Per-element geometry hashing across a stash — seconds, and it sees what a frame
grab cannot.** This is how both halves of step 2 were established, and it is now a
committed tool, `packages/visuals/src/geomhash.mts` (sibling of `frames.mts`, likewise
not wired into any script):

    npx tsx packages/visuals/src/geomhash.mts final-169 handwritten > /tmp/after.txt
    git stash push -u && git status --short          # confirm the tree is CLEAN
    npx tsx packages/visuals/src/geomhash.mts final-169 handwritten > /tmp/before.txt
    git stash pop
    diff /tmp/before.txt /tmp/after.txt

It resolves the visuals stage into a temp dir, so the real project's cached assets are
neither read nor written, and hashes each element's stroke `d` values only. Being
_committed_ is what makes the stash step work: `git stash -u` takes untracked files with
it and leaves tracked ones alone, so the tool survives the stash it is measuring.

`projects/final-169` is the benchmark (8 plots, 19 paths, arrows, a diagram);
`projects/handwritten` complements it (shapes, emphasis, assets) and between them they
cover every element type. One gotcha when reading the output: the stage logs to
**stdout** as well, so filter on the tab separator rather than trusting redirection.

**2. Frame grabs — ~76 ms each, no encode.** `packages/render/src/frames.mts`:

    npx tsx packages/render/src/frames.mts <projectDir> <outDir> [seconds...]

With no timestamps it takes eight evenly spaced frames. It compiles the plan itself, so
it picks up live geometry changes **without re-running the pipeline** — the existing
`projects/final-169` is enough, no `cast` needed. For plot work `t=40` and `t=64` are the
plot-dense beats and the morph lands in scene `s6` (65.98–80.01 s).

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

**`git stash push --keep-index=false` fails and stashes nothing.** The flag takes no
value, so git errors out — but the error is one line and easy to miss, and the follow-up
command then runs against an _unstashed_ tree, producing a "baseline" identical to the
new one that looks like proof when nothing was compared. After any stash, run
`git status --short` and confirm the tree is actually clean before trusting a measurement.
`git stash push -u` is what works; `-u` matters if your verification script is untracked
_inside_ the repo, which is a reason to keep it outside.

**`pnpm -r test | tail` will lie to you.** Piping through `tail` truncates per-package
output and the totals. Redirect the whole log to a file and sum with
`awk '/# pass [0-9]+$/ {p+=$NF} ...'` — note the `$NF`, because the lines are prefixed
with the package name and `$3` silently sums nothing. Check that all **eight**
test-bearing packages appear (`core` has no tests). Also: `keyvault` reports 58 tests but
55 passes — three are skipped, so 513/516 is the expected shape, not a failure.

**`pnpm lint` is `prettier --check .`,** so formatting is a hard gate, not advice. Run
`npx prettier --write` on what you touched before claiming green.

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

**Existing projects are stale against visuals@4 / render@4.** That is intended — the plot
geometry genuinely changed — but it means the next `cast` over `projects/final-169` will
recompute visuals and re-render rather than serving cache, and will look like it is doing
more work than your change should cause.

## Deliberate stopgaps

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
benchmark — "downhill" is struck through and "too small" sits under the marker — and
unchanged by step 2, which moved the ink under it but not the sprite over it.

## Known defects, not fixed

**The planner and visuals disagree about `doubleWell`.** Two catalogues of the named
curve functions remain and they disagree:

    planner/src/curves.ts   a*x^4 - b*x^2 + tilt*x + k          defaults [1, 2, 0, 2]
    visuals/src/plot.ts     a*((x/b)^2 - 1)^2 + tilt*(x/b) + k  defaults [1, 1, 0.35, 0.4]

The planner **authors** these params (`plots.ts:402` passes `[1, 2, 0.55, 2.2]`) and also
runs `descend()` on its own `evalFn` to place the step dots, while visuals draws the
curve. So the drawn curve and the simulated descent can disagree and the dots can leave
the curve. Reachable through the `local-minima` recipe; the benchmark does not use it.
Same class of duplication as root cause 1, one layer up — and crisp plots make it
**more** visible, not less, since a dot off an exact curve no longer hides in a wobble.

**`rerender()` has a weaker cache gate of its own.** The visuals cache naming was fixed
in `cast.ts`, but `rerender()` (`cast.ts:796`) still re-runs visuals only when an asset
lacks an `svg` (`missingArt`, :871) or the board fingerprint moved, and never checks that
element SVGs or the manifest exist.

**`visuals.json` is still written and never read.** Step 1 removed the duplicated
geometry, so there is one implementation — but the renderer consumes `resolvePlot()`
directly rather than the recorded artefact. Closing that needs
`resolveFraming`/`unitsPerPixel` (`render/src/camera.ts`) derivable somewhere the visuals
stage can reach, probably `@inkcast/core`. It is the only part of root cause 1 left, and
it is why `visuals` and `render` had to be version-bumped together for step 2.

**`STATUS.md` is dated 2026-07-28 and is now four changes stale.** Its "two vaults",
"anchor draws a second hillside" and "mean content fill 48%/53%" defects are fixed, its
"`visuals.json` is written and never read" is half-fixed as described above, and its
account of plot ink predates crisp mode entirely. Everything else in it stands, including
`illustration` never resolving without a key.
