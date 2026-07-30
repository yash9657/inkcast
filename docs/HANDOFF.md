# Handoff — 2026-07-29 · the remaining sequence, starting with step 1 of it

Session state, not design. `PIPELINE.md` is the durable architecture and `STATUS.md` is
the verification record; this file exists so a session starting cold knows exactly where
things stand, what to do next, and which traps are waiting.

Delete or rewrite this once the first item lands. It goes stale by design.

**Read "Where things stand", then "The sequence".** Item 1 is specified in full under "The
next piece" and needs no API key; the rest of the sequence is one paragraph each. Everything
after "How to verify a visual change cheaply" is reference.

## Where things stand

Branch **`visuals-morph-density`**, twelve commits on top of `e95258b`. Everything is local;
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
diff it belongs to. Steps 1, 6, 2, 3 and 4 are ✅ in `PIPELINE.md`; step 5 is 🟡 with the
split spelled out there.

**The baseline is measured, not inherited.** `pnpm lint` clean, `pnpm -r typecheck` 0
errors across 9 projects, `pnpm -r test` **557 pass / 0 fail** across all eight
test-bearing packages. The benchmark renders end to end in both formats from the shipped
hand-authored lesson with no keys: 104.667 s / 3140 frames at 1920x1080, 61.500 s at
1080x1920, `cost $0.00`. Mean content fill 52.2% / 55.9%. The `projects/handwritten`
geometry hashes are byte-identical across both of the last two steps.

**`STATUS.md` has three appendices**, all 2026-07-29. Rig figures are in the third, library
figures in the second, pipeline figures in either of the last two — they agree. The 07-28
body is a historical record and deliberately unedited.

## The sequence

`PIPELINE.md`'s "Order of work" is a dependency order and says so; after step 1 it asks to be
ordered **by leverage**. This is that ordering re-done now that steps 4 and 5 have changed the
picture, with the evidence each position rests on. Numbered steps keep their `PIPELINE.md`
numbers; unnumbered work is marked.

| #   | Work                                                   | Key? | Why here                                                                                               |
| --- | ------------------------------------------------------ | ---- | ------------------------------------------------------------------------------------------------------ |
| 1   | **Planner addressability** (unnumbered)                | no   | Unlocks steps 4 and 5 entirely, and fixes a shippable defect. Specified in full below.                 |
| 2   | **Step 7 — the script stage**                          | no   | The only remaining numbered step that attacks the live quality complaint. Self-contained.              |
| 3   | **Close root cause 1** (unnumbered)                    | no   | Architectural debt whose cost has now bitten twice. Promote to 2 if you prefer architecture to polish. |
| 4   | **The `doubleWell` disagreement** (known defect)       | no   | Small, contained, and a wrong drawing today.                                                           |
| 5   | **Step 8 — `entersAtWord`**                            | no   | **Demoted on evidence** — see below. Insurance, not a fix.                                             |
| 6   | **Finish step 5** — i2i adapter + real identity gate   | YES  | Blocked without a provider. Nothing else waits on it.                                                  |
| 7   | **Step 9, the cost target, 9:16 equations, music/SFX** | some | Genuinely later. `PIPELINE.md` "Still open" carries the reasoning.                                     |

**2 — step 7.** `cadence` drives both the TTS rate and the trailing `hold`; `emphasis` drives
voice and board weight. It is here because `STATUS.md`'s standing verdict names pacing among
the live quality failures ("every region change opens on a caption in a void") and this is the
step that owns pacing. _Done when:_ a punchy beat is measurably faster and holds shorter than a
`slow_deliberate` one. No key, and it touches nothing item 1 touches, so the two are safe to
do in either order.

**3 — close root cause 1.** `visuals.json` is read for equations only; plots still go through
`resolvePlot` in-process and every other element type is re-derived by the renderer's own
`primsFor`. It needs `resolveFraming`/`unitsPerPixel` (`render/src/camera.ts`) derivable
somewhere the visuals stage can reach, probably `@inkcast/core`. It sits at 3 rather than 2
only because its payoff is invisible in a frame — but note that **this exact bug class has now
cost two steps of work**: the dead plot solver (step 1) and the planner pre-empting the asset
router (item 1). A third instance is likely while the pattern is still available.

**5 — step 8, and why it moved down.** The rationale in `PIPELINE.md` is sound: a phrase has
to be found again by the aligner and can fail to match or match twice, where an index cannot.
But **measured on the shipped lesson, 67 of 67 cues locate cleanly in their own narration by
text alone** (both formats; the probe is four lines over `findCueSpan` and `matchTokens`). So
it is fixing a fragility that does not currently fire. It would matter more for an
LLM-authored lesson, where the cue is written separately from the narration and can drift —
and that is exactly the case nobody can measure here, because it needs an Anthropic key. Do it
when you have one, or when a cue warning actually appears.

## The next piece (item 1) — one asset router, and a pedagogy that can ask for a pose

Steps 4 and 5 built a library and a rig that **the pedagogy cannot address**. That is the
highest-leverage thing left, it needs no key, and the case for it is measured rather than
argued. Three findings, from probing the planner directly:

**1. The planner contains a second, earlier copy of the asset router, and it wins.**
`buildAsset` (`planner/src/compile.ts:786`) calls `matchIcons(describe, 1)` and, on a hit,
mints the asset with the **lucide slug as its id and lucide's own prompt as its prompt** —
throwing away what the beat actually described. The visuals stage's lane order
(inline → library → cache → generate → lucide → letter) then runs against evidence that has
already been destroyed. This is root cause 1 all over again: two implementations of one
decision, the earlier and worse one running first. Step 1 fixed exactly this shape for plots.

What that costs, measured:

    describe                                    planner mints            library then sees
    "a hiker walking downhill in thick fog"     illustration lane        figures/walking   ✅
    "a teacher pointing at a chalkboard"        illustration lane        figures/pointing  ✅
    "a lone explorer crossing a desert"         illustration lane        characters/explorer ✅
    "a person standing at the edge of a cliff"  icon: id=user            figures/standing  ✅ (luck)
    "Odysseus tied to the mast of his ship"     icon: id=rocket          NOTHING           ❌

The last row is a real defect you can ship today: **Odysseus draws a rocket.** Once the id is
`rocket` and the prompt is "a rocket taking off", nothing downstream can recover — the library
is asked after the evidence is gone. The `user` row only works by luck, because lucide's
substitute prompt happens to contain the word "person".

**2. No pose can ever be requested, so step 5 currently buys nothing in a real run.**
`VisualIntent` is `{ describe, kind, cue }` — there is no way to name a library path or a
variant. Every rig resolution therefore takes the default pose, `standing`. The explorer can
be the same person across three beats and is always standing, which is exactly what
`figures/standing` already did. **The rig's payoff is zero until this is fixed**, and that
is the strongest argument for doing this next rather than finishing step 5's generated half.

**3. `kind: 'narrative'` is accepted, prompted for, and then ignored.** It is a real value in
`LessonKind`, `lesson-anthropic.ts` prompts for it — and nothing downstream branches on it.
`Lesson.cast` is sketched as NEW in `PIPELINE.md` and **does not exist in the zod**. So a
lesson can say "this is a story carried by characters" and the compiler treats it identically
to a derivation.

### What to build

In dependency order. The first is worth doing alone even if you stop there.

**a. Delete the planner's pre-resolution and let the visuals stage route.** `buildAsset` should
mint the _description_ — `ctx.assets.use(slugOf(describe), describe, kind)` — and stop
consulting lucide. The lane order already lives in `resolveAsset`, it is already correct, and
it now has a library in front of it. Expect asset ids to change from lucide slugs to
description slugs, which is a `storyboard` bump (→ 4) and invalidates visuals downstream. The
benchmark is unaffected because it has zero assets.

**Scope this to `compile.ts` and leave `heuristic.ts` alone unless you have a reason.**
`heuristic.ts:211` calls `matchIcons` too, but for a different job: it decorates a _document_
beat — a heading, a quote, a definition — where there is no described subject to preserve and
lucide picking something apt is the whole intent. `compile.ts` is the one routing a subject a
lesson described, and that is where throwing the description away costs something.

While you are there: the `log.debug` at `compile.ts:814` says an illustration "degrades to a
placeholder without one", which stopped being true for characters in step 4. Same class of
stale message as the one fixed in `pipeline/src/degrade.ts`.

**b. `Lesson.cast`, for real.** `{ id, name, look }[]` as `PIPELINE.md` sketches it, defaulted
so every saved `lesson.json` still parses (the `version: 1` note in the lesson schema explains
why that matters and how the cache invalidates instead). A narrative lesson declares who is in
it once, rather than re-describing them per beat — which is the same "resolve once, reuse by
id" argument that made `storyboard.assets[]` a top-level library.

**c. `VisualIntent` gains a way to name a cast member and a pose.** Something like
`character?: { id: string; pose?: string }`. **Do not derive the pose from the beat's verb** —
that is the guessing step 6 removed for the analogy, and it would fail the same way. Explicit
or absent.

**d. The compiler mints `Asset.ref`.** A cast member becomes an `Asset` with
`ref: { path: 'characters/<id>', variant: pose }`. Resolution already pins the version on the
way out, so the compiler should not invent one.

### Done when

**A narrative lesson renders one character across three beats in three different poses, with
no key.** That is step 5's acceptance bar reached _through the product_ rather than through a
unit test, which is the part that is currently missing — and it is checkable with
`frames.mts` on a hand-written narrative lesson in `examples/lessons/`, so it costs about ten
seconds to see.

Two cheaper checks worth writing on the way: `Odysseus tied to the mast` must no longer mint
`rocket` (that is a planner test, not a visuals one), and a lesson with a `cast` must produce
`Asset.ref` entries pointing at rig paths.

### If you would rather not touch the planner

Take item 2 (step 7) instead — it is self-contained, needs no key, and shares no code with
this. See "The sequence" above for the rest.

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
   trustworthy, so it is worth getting right rather than shipping approximately.

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

**That last line is the one that matters for "the next piece".** A planner change is a
storyboard change, and none of the four tools above is pointed at it: `geomhash.mts` resolves
the visuals stage against a storyboard _already on disk_, so it cannot see the planner at all
and `projects/handwritten` will stay byte-identical whatever you do to `buildAsset`. Compile
the lesson and diff the storyboard JSON instead — `Lesson.parse` → `compileLesson`, no voice,
no visuals, sub-second. What you want to read in that diff is `assets[]`: the ids should stop
being lucide slugs and start being description slugs, and cast members should carry a `ref`.

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

**`--json` suppresses every log line, so a clean log is not a clean run.** A `cast --json`
render writes the report to stdout and leaves stderr **completely empty** — zero bytes, not
"warnings only". Grepping that file for `cue`, `warn` or `fill` returns nothing whatever
happened, which reads exactly like "no problems found". This nearly produced a false finding
about cue resolution in this very session; the honest measurement came from calling
`findCueSpan` over the storyboard instead. Drop `--json` when you want to see what a stage
said, and check `wc -c` on a log before concluding anything from its silence.

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
stage can reach, probably `@inkcast/core` — the remaining part of root cause 1, and item 3 in
"The sequence".

**Cue resolution is not currently failing, which is worth knowing before you fix it.** 67 of
67 cues on the shipped lesson locate in their own narration by text alone, both formats.
`enter.cue` fragility is real in principle and step 8 removes it properly, but on this lesson
it never fires — so treat a cue warning as news rather than as the expected state.

**The planner draws a rocket for Odysseus.** `buildAsset` matches lucide _before_ the visuals
stage gets a say, and mints the asset with the lucide slug as its id and lucide's prompt as its
prompt — so `"Odysseus tied to the mast of his ship"` becomes `id: 'rocket'`,
`prompt: 'a rocket taking off'`, and every downstream lane including the library is asked about
a rocket. Measured, not hypothesised; the probe table is in "The next piece" above. This is the
first thing that section fixes, and the fix is to delete the pre-resolution rather than to
patch the matcher.

**Nothing upstream constructs an `AssetRef`, so step 5 currently buys nothing in a real run.**
`VisualIntent` is `{ describe, kind, cue }` — no path, no variant. Every rig resolution takes
the default pose, so the explorer is always `standing`, which is what `figures/standing`
already did. The library is reachable through the alias table and not _addressable_ by the
pedagogy. **This is the biggest gap in the area** and it is the second thing "The next piece"
fixes.

**`kind: 'narrative'` is accepted and then ignored.** A real value in `LessonKind`, prompted
for in `lesson-anthropic.ts`, and nothing downstream branches on it. `Lesson.cast` is sketched
as NEW in `PIPELINE.md` and does not exist in the zod, so a lesson can declare itself a story
carried by characters and be compiled exactly like a derivation.

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
