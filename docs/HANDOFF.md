# Handoff — 2026-07-29 (step 1 landed; step 6 is next)

Session state, not design. `PIPELINE.md` is the durable architecture and `STATUS.md`
is the last verification report; this file exists so a session starting cold knows
what changed underneath both of them, and which traps are waiting.

Delete or rewrite this once the next piece of work lands. It goes stale by design.

## Where the code is

Branch **`visuals-morph-density`**, four commits on top of `e95258b`. Everything is
local; nothing is pushed. In order, by subject:

    Keyvault: one vault, shared by the CLI and the studio
    Morph the anchor into the plot, and make cells frame-shaped
    docs: the staged-pipeline architecture, and a handoff
    One implementation of plot geometry, and it is the good one   <- new

Each message carries the reasoning for its own change; read them before the diffs.
The newest one is long because it records two defects and one scope reduction that
are not visible in the diff.

Verified at that commit: `pnpm lint` clean, `pnpm -r typecheck` 0 errors across 9
projects, `pnpm -r test` **500 pass / 0 fail**. The benchmark renders at
**104.667 s / 1920x1080 / 3140 frames**, unchanged.

## Two decisions were taken this session

Both were open questions in the previous handoff. They are settled; do not re-open
them without saying so.

1. **9:16 and equations** — a typeset equation that exceeds the vertical frame's
   usable width **breaks across lines** at top-level relation/operator boundaries
   (`=`, `+`, `-`), each line revealed left to right. One layout rule for both
   aspects, no dedicated vertical mode. This unblocks step 3.
2. **Which part of Golpo is the target** — **coherence**, not look. So the order of
   work is now **1 -> 6 -> 2 -> 3 -> 4 -> 5 -> 7 -> 8 -> 9**: step 6 jumps ahead of
   ink modes and the equation lane, because every beat serving one insight is the
   goal.

Still open, and step 3 does not need it: the `$0.20/min` cost target, which was set
when zero-key was the headline.

## What step 1 actually did, and what it did not

`render/src/plot.ts` went from 926 lines of geometry to a ~380-line adapter that
derives nothing. Deleted from the renderer: `evalCurveFn`, `curveAt`, `curveSlope`,
`sampleCurve`, `plotMap`, `clipToBand`, `curvePolylines`, `axisPhase`, `curvePhase`,
`overlayPhases`, `deconflictLabels`, `collisionCost`, `curveInk`. What remains is
timing and packaging: grouping the resolver's parts into independently timed phases
and re-inking them from the board's palette.

**It reads the resolver, not the sidecar.** `PIPELINE.md` step 1 says "renderer
consumes plot geometry from `visuals.json`". It consumes `resolvePlot()` instead, and
the reason is structural rather than lazy: the visuals stage has no camera, so it
sizes type as a fraction of the whole canvas (caption = 69.8 units on the benchmark)
where the renderer quotes it in output pixels through the camera (13.3 units). In the
plot lane the caption size **is** the unit of measurement — gutters are
`caption * 2.1`, a tick `caption * 0.26`, an arrowhead `caption * 0.42`, a marked
point's radius `caption * 0.2` — and `InkStyle.strokeWidth` feeds the same geometry.
Consuming the recorded numbers on a framed board therefore does not mis-size labels;
it puts a dot on the curve four times too wide, baked into the path data where no
rescaling reaches it. The first attempt did exactly that and the frame grab caught
it. The type and stroke scales are now passed _into_ the resolver
(`ResolvePlotOptions.typeSizes`, and a substituted `InkStyle.strokeWidth`).

So: the duplication is gone, one implementation remains, and **`visuals.json` is
still written and never read.** Closing that needs `resolveFraming`/`unitsPerPixel`
(`render/src/camera.ts`) derivable somewhere the visuals stage can reach — probably
`@inkcast/core`. That is the follow-up, and it is the only part of root cause 1 left.

Three things moved into `visuals` because they existed on one side only, which is the
failure mode the whole change is about:

- the curve-label suppression (a lone curve must not name the vertical axis twice),
- label-versus-ink collision scoring (visuals measured with real font metrics but
  dodged only _boxes_; a curve's box is the whole frame, so it has to be charged for
  per stroke sample),
- per-hop sub-parts for a descent, so "one hop at a time" survives. Part ids are now
  `overlay:N:K` and plan item ids `id~ovNsK`, unchanged from before.

Colour is deliberately **not** taken from the manifest. The two packages keep
different palettes — visuals' accent is a red `#d7263d`, the renderer's a blue
`#2f6fed`, and their blacks differ by a shade. Geometry is visuals'; the pens are the
board's, mapped by part kind in `inkFor()`.

## Step 6 — lesson schema v2. Start here.

**The goal** (`PIPELINE.md` step 6): add `kind`, `strategy`, `coreInsight`,
`analogy.maps`, and `from`/`derivedFrom` with a no-`asserted` validator for
first-principles. Derive the morph from `analogy.maps` and **delete the
`BECOMES_A_PLOT` regex**. _Done when:_ the shipped lesson still morphs, and a lesson
with the same mapping but different wording also morphs.

### The exact code involved

**The schema** is zod, in `packages/core/src/lesson.ts` — `VisualIntent` (line 19),
`LessonStep` (37), `Lesson` (53), `lessonBeats` (89), `critiqueLesson` (111).

> **`PIPELINE.md`'s schema sketch is not the current field names.** It writes
> `LessonStep.why`; the real field is **`because`**. It writes `steps[]` carrying
> `idea + why + visual`; the real one is `idea`, `because`, `narration`,
> `visuals[]`, `hold`. Reconcile against the code, not the document, and consider
> fixing the document.

**The stopgap to delete** is `BECOMES_A_PLOT` at `packages/planner/src/compile.ts:230`
— a regex for a becoming-verb followed by plot vocabulary. It is used in exactly one
place, `findReuse()` (compile.ts:258-281), at line 276:

    if (!BECOMES_A_PLOT.test(`${step.idea} ${step.narration}`)) continue;
    bridge = { beat: i, host: owner };

**The chain it feeds**, which is what `analogy.maps` must reproduce:

1. `findReuse(beats)` — compile.ts:114 — returns `{ annotates, bridge }`. The bridge
   is at most one per lesson: it must be a `step` role, it must ask for a `plot`, and
   there must be an earlier `path` drawing (the hook's or anchor's) to grow out of.
2. `morphsAnchor: reuse.bridge?.beat === i` — compile.ts:162.
3. `buildIntent()` — compile.ts:574 — `const grow = ctx.morphsAnchor ? ctx.memory.anchor : undefined`, which makes the plot take the anchor's box and then attaches
   `el.morph = { fromId: grow.id, from: 0.12, to: 0.62, easing: 'ease', retire: true, retires: [...grow.ink] }` (compile.ts:587-598).

So the derivation to write is: **the bridge beat is the first `step` whose visuals ask
for a `plot` and whose `analogy.maps` counterpart arrives for the first time** —
i.e. the beat that introduces the `to` side of a mapping whose `from` side the anchor
established. Nothing about the narration's wording should enter into it. That is the
whole point, and it is what makes the second half of the "done when" testable.

**The benchmark's bridge beat** is `steps[0]` of
`examples/lessons/gradient-descent.lesson.json`:

    idea:      "That hillside is really a graph"
    narration: "That hill is really a graph. Height is just a number that
                depends on where you stand. So draw it as a curve."

It matches the regex on "is really a graph". Its mapping, once `analogy.maps` exists,
is `height -> loss`, `position -> parameter`, `slope -> gradient`. Write the
reworded-but-same-mapping variant as a fixture and assert it morphs; that is the test
the regex cannot pass.

**The validator** belongs in `critiqueLesson` (core/lesson.ts:111), which already
rejects an empty `because` with `"asserts without justifying it"`. The new rule:
when `strategy === 'first-principles'`, no step may be `from: 'asserted'`, and a
`from: 'derived'` step must name existing step ids in `derivedFrom`. Note
`lesson-anthropic.ts:222` already feeds that exact critique string back to the model
as a repair instruction, so the new problems will be repaired the same way for free.

**Blast radius** — files that read Lesson fields and will need the new ones threaded
or defaulted:

    packages/core/src/lesson.ts            the schema, beats, critique
    packages/planner/src/lesson-anthropic.ts  the LLM author: tool schema + prompt
                                           (prompt rules at :54, :88; repair at :222)
    packages/planner/src/lesson-derive.ts     the heuristic author (no key)
    packages/planner/src/lesson-edit.ts       hand edits
    packages/planner/src/compile.ts           findReuse, morphsAnchor, buildIntent
    packages/planner/src/{lesson,presets,types,index}.ts
    packages/pipeline/src/{lesson,cast,state,index}.ts
    apps/cli/src/commands/lesson.ts
    apps/web/components/studio/create-form.tsx
    packages/planner/test/{lesson,compile}.test.ts
    packages/pipeline/test/helpers.ts
    examples/lessons/gradient-descent.lesson.json   add kind/strategy/coreInsight/analogy

Both authors must emit the new fields, or a keyed run and a no-key run will disagree
about whether the morph happens — which is exactly the class of bug step 1 was about.
Make the fields required in the schema with defaults chosen so an old `lesson.json`
still parses, or `parseLesson` will start rejecting saved projects.

**Bump `STAGE_CODE_VERSION.lesson`** in `packages/pipeline/src/keys.ts` (currently 1)
when the stage's output changes for identical inputs. `storyboard` too, if the morph
derivation changes what it emits. The file's header explains why.

## How to verify a visual change cheaply

New this session: `packages/render/src/frames.mts` grabs single frames without an
encode — ~76 ms each against a 110-second full render.

    npx tsx packages/render/src/frames.mts <projectDir> <outDir> [seconds...]

With no timestamps it takes eight evenly spaced frames. It is not wired into any
script and not exported; it is a verification tool. For step 6, `t=40` and `t=64` of
the benchmark are the plot-dense beats, and the morph lands in scene `s6`
(65.98–80.01 s).

To render the benchmark at all, use `cast` — see the trap below:

    INKCAST_PROJECTS=/tmp/verify node apps/cli/bin/inkcast.mjs \
      cast examples/lessons/gradient-descent.lesson.json \
      --project bench --force --json

Add `--short` for the 9:16 pass. A full run took ~4 minutes end to end here,
including a local Kokoro voice pass.

There is **no golden-image or frame-diff harness** in the repo. The only pixel
assertion anywhere is a same-run self-consistency check in `page.test.ts`. If you
want a before/after comparison, the trick that worked is: render the project once,
then grab frames, `git stash`, grab frames again, `git stash pop` — the storyboard is
fixed, so the two frame sets differ only by your change, and no re-encode is needed.

## Traps

**This repo is `inkcast`, at `~/code/inkcast`.** It has **no git remote**, so
`git remote -v` is empty and cannot confirm anything — check `git log` against the
commit list above instead. Two sessions running have now been launched with their
working directory set to the sibling `finito` checkout and nearly edited the wrong
project. Shell `cd` does not persist between commands here; use absolute paths.

**`teach <topic> --lesson <file>` silently ignores the file.** Passing both a topic
and `--lesson` derives a lesson from the topic instead, and with no Anthropic key
that produces a ~20-second stub. Use `cast`, as above. This is still worth fixing:
the flag combination should either honour `--lesson` or refuse.

**`next build` over a dirty `.next` still breaks.** `rm -rf apps/web/.next` first.

**Judge output from a keyed render, not the default.** The benchmark above runs
`providers: planner heuristic` — the pedagogy is `lesson-derive.ts`, not a model. It
only holds together because the lesson is hand-authored; a topic-only run with no key
degenerates. Set an Anthropic key before concluding anything about whether the
concept lands. This matters more for step 6 than for step 1: the new fields are
written by the _lesson author_, so the no-key path is where they will be thinnest.

**`pnpm -r test | tail` will lie to you.** Piping through `tail` truncates
per-package output and the totals; it cost this session a wrong baseline reading.
Redirect the whole log to a file and sum `# pass` / `# fail` across it.

## Deliberate stopgaps

**`BECOMES_A_PLOT`** — `planner/src/compile.ts:230`. Step 6 deletes it. Do not build
on it. See above for the full chain it feeds.

**Frame fill is measured as a proxy.** `contentFill` in `render/src/camera.ts` is the
union of element _bounding boxes_ over the view area. A single hand-drawn line has a
large box and little ink, so the number rewards big sparse shapes. Useful for
catching regressions, misleading as a target — read frames as well.

**One legacy vault may still exist on a machine.** `<repo>/.inkcast/keys.json` from
the pre-unification studio is no longer read. `vaultInfo()` reports it as
`legacyPath`. There is no migration and deliberately so.

**The pen sprite is invisible to the label solver.** Visuals places labels clear of
ink and of each other, but the marker sprite is a renderer-side decoration it knows
nothing about, so a label can still be struck through by the pen. Visible at `t=64`
of the benchmark on "too large". Pre-existing; not a step-1 regression.

## Known defects, not fixed

**The planner and visuals disagree about `doubleWell`.** Three catalogues of the
named curve functions existed; step 1 deleted the renderer's, which fixed a real bug
(`step` with params `[3, 0, 1]` means a single jump at x=3 and the renderer drew
`1 + 3*floor(x)`, a climbing staircase). Two remain and they disagree:

    planner/src/curves.ts   a*x^4 - b*x^2 + tilt*x + k      defaults [1, 2, 0, 2]
    visuals/src/plot.ts     a*((x/b)^2 - 1)^2 + tilt*(x/b) + k   defaults [1, 1, 0.35, 0.4]

The planner **authors** these params (`plots.ts:402` passes `[1, 2, 0.55, 2.2]`) and
also runs `descend()` on its own `evalFn` to place the step dots, while visuals draws
the curve. So the drawn curve and the simulated descent can disagree and the dots
can leave the curve. Reachable through the `local-minima` recipe; the benchmark does
not use it. Same class of duplication as root cause 1, one layer up.

**The visuals cache named no artefact** until this commit, so a deleted
`visuals.json` read as fresh and the stage was skipped. Fixed in `cast.ts`, but
`rerender()` (`cast.ts:796`) still has a weaker gate of its own at `cast.ts:870-881`:
it re-runs visuals only when an asset lacks an `svg` (`missingArt`, :871) or the board
fingerprint moved, and never checks that element SVGs or the manifest exist.

**`STATUS.md` is dated 2026-07-28 and is now two changes stale.** Its "two vaults",
"anchor draws a second hillside" and "mean content fill 48%/53%" defects are fixed,
and its "`visuals.json` is written and never read" is now half-fixed in the sense
described above — the duplication is gone, the file is still unread. Everything else
in it stands, including `illustration` never resolving without a key.
