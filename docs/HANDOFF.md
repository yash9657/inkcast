# Handoff — 2026-07-29 (steps 1 and 6 landed; step 2 is next)

Session state, not design. `PIPELINE.md` is the durable architecture and `STATUS.md`
is the last verification report; this file exists so a session starting cold knows
what changed underneath both of them, and which traps are waiting.

Delete or rewrite this once the next piece of work lands. It goes stale by design.

## Where the code is

Branch **`visuals-morph-density`**, six commits on top of `e95258b`. Everything is
local; there is **no remote**, so nothing is pushed anywhere. In order, by subject:

    Keyvault: one vault, shared by the CLI and the studio
    Morph the anchor into the plot, and make cells frame-shaped
    docs: the staged-pipeline architecture, and a handoff
    One implementation of plot geometry, and it is the good one
    docs: rewrite the handoff for step 6
    Lesson schema v2: the morph comes from the mapping, not the prose   <- new

Each message carries the reasoning for its own change; read them before the diffs. The
newest one is long because it records a deliberate departure from the plan, one
consequence that is a real behaviour change, and a defect it introduced and then fixed
— none of which are visible in the diff. The working tree is clean apart from this
file's own commit.

Which files step 6 touched, if you need to orient quickly:

    packages/core/src/lesson.ts                 the schema, beat ids, the validator
    packages/planner/src/compile.ts             findReuse derives the morph; regex gone
    packages/planner/src/presets.ts             derivedFrom survives beats being dropped
    packages/planner/src/lesson-anthropic.ts    the brief and the repair guidance
    packages/planner/src/lesson-derive.ts       the no-key author emits the new fields
    packages/pipeline/src/keys.ts               lesson@2, storyboard@2
    packages/pipeline/test/helpers.ts           sampleLesson gains an analogy
    packages/planner/test/{compile,lesson}.test.ts
    examples/lessons/gradient-descent.lesson.json
    docs/PIPELINE.md                            root cause 2 closed; the sketch corrected

Verified at that commit: `pnpm lint` clean, `pnpm -r typecheck` 0 errors across 9
projects, `pnpm -r test` **507 pass / 0 fail** (was 500). The benchmark storyboard is
**byte-identical** to before the change in both aspects — `sha da29fefa…` standard,
`ca563812…` short, morph `b2_v0 <- b0_v0` in both — so no render was needed to know the
board did not move. No full render has been done since step 1, and the 104.667 s /
1920x1080 / 3140 frames benchmark figure is inherited rather than re-measured.

## What step 6 actually did, and what it did not

`BECOMES_A_PLOT` is gone. `findReuse(beats, analogy)` decides where the abstraction
arrives from the lesson's own mapping table: the first `step` that draws a `plot`, given
an earlier `path` drawing to grow out of and a non-empty `analogy.maps`.

**It does no text matching at all — and that is a change from what the last handoff
specified.** That handoff called for "the beat that introduces the `to` side of a
mapping whose `from` side the anchor established". Do not reinstate it: the benchmark
keeps `loss`, `gradient` and `parameter` in its `jargonBudget` and never says them at
the bridge beat, so matching `to` terms against the narration finds nothing and the
shipped lesson stops morphing — failing the milestone's own first acceptance test. It
was tried. Wording is the thing being removed from this decision, and that has to
include the wording of the map.

The consequence, which is deliberate and is written up in `PIPELINE.md` root cause 2:
**a keyed run morphs and a no-key run does not.** `lesson-derive.ts` emits every new
field but never an `analogy`, because inferring a mapping table from prose is precisely
the guessing that was deleted. The old regex made the no-key path morph whenever a
document happened to put a becoming-verb near the word "curve", which was luck dressed
as pedagogy. If this ever needs to change, the honest fix is a hand-authored analogy per
fixture, not an inference.

Beat ids are **positional** — `hook`, `anchor`, `step1`…`stepN`, `worked`,
`misconception`, `recap`, from `lessonBeats()`. `LessonStep` has no id field, so nothing
mints one or keeps it unique and an old lesson gains ids without being rewritten. The
cost is that `adaptLesson` renumbers them when it drops steps to fit a budget, and that
bit immediately: on the shipped lesson at the `short` preset the surviving third step
became `step1` and its reference to the old `step1` pointed **at itself**. Now
`remapDerivations` splices dropped beats out of the chain — if B follows from A and A is
cut, B follows from whatever A followed from — and a beat left with no antecedents stops
claiming to be `derived`. Two tests pin it. Nothing in the compiler reads `derivedFrom`,
so this was latent rather than broken, but "step1 derives from step1" reads as a logic
bug and would have cost someone an hour.

Not done, and not required by step 6:

- **`cast`** (the character sheet in `PIPELINE.md`'s stage-1 sketch) is still not in the
  schema. It belongs with steps 4 and 5.
- **`coreInsight` is validated but not yet _used_.** `critiqueLesson` rejects an empty
  one and the brief tells the model to write everything in service of it; nothing
  downstream reads it. The obvious consumer is the recap, and a check that each beat
  serves it, but both are judgement calls that wanted their own change.
- The `$0.20/min` cost target is still open, and step 2 does not need it.

## Step 2 — two ink modes. Start here.

**The goal** (`PIPELINE.md` step 2): `ink: 'crisp' | 'sketch'` on the geometry contract;
plots become crisp. _Done when:_ a crisp plot's `d` contains no perturbation and a sketch
path is byte-identical to today.

That second half is the real constraint, and step 1 left it well set up: the renderer no
longer derives plot geometry, so there is exactly one place where a plot's path data is
produced (`packages/visuals/src/plot.ts`, via `resolvePlot()`) and one place where the
roughening is applied. Find the perturbation first and read `InkStyle`; the mode is
almost certainly a flag threaded into the same call that already receives
`InkStyle.strokeWidth` from the renderer (`ResolvePlotOptions`, added in step 1 — see the
previous handoff's note on why the type and stroke scales are passed _in_ rather than
read off the sidecar).

The byte-identical half is cheap to prove with the stash trick below, and worth proving
that way rather than by eye: a sketch path that shifts by one perturbation sample looks
identical in a frame grab and is not identical.

## How to verify a visual change cheaply

`packages/render/src/frames.mts` grabs single frames without an encode — ~76 ms each
against a 110-second full render.

    npx tsx packages/render/src/frames.mts <projectDir> <outDir> [seconds...]

With no timestamps it takes eight evenly spaced frames. It is not wired into any script
and not exported; it is a verification tool. For plot work, `t=40` and `t=64` of the
benchmark are the plot-dense beats, and the morph lands in scene `s6` (65.98–80.01 s).

To render the benchmark at all, use `cast` — see the trap below:

    INKCAST_PROJECTS=/tmp/verify node apps/cli/bin/inkcast.mjs \
      cast examples/lessons/gradient-descent.lesson.json \
      --project bench --force --json

Add `--short` for the 9:16 pass. A full run took ~4 minutes here, including a local
Kokoro voice pass.

There is **no golden-image or frame-diff harness** in the repo. The only pixel assertion
anywhere is a same-run self-consistency check in `page.test.ts`. For a before/after
comparison the trick that works is: render the project once, grab frames, `git stash`,
grab frames again, `git stash pop` — the storyboard is fixed, so the two frame sets
differ only by your change and no re-encode is needed.

**For anything that only changes the storyboard, skip the render entirely.** Compile the
lesson and hash the JSON either side of a stash. That is how step 6's byte-identical
result above was established, in seconds rather than eight minutes, and it catches
changes a frame grab cannot see. Write the script somewhere untracked so the stash does
not take it with it, and note that a script in `/tmp` resolves its relative imports from
`/tmp` — import through absolute paths or keep it in the repo root.

## Traps

**This repo is `inkcast`, at `~/code/inkcast`.** It has **no git remote**, so
`git remote -v` is empty and cannot confirm anything — check `git log` against the commit
list above instead. **Three** sessions have now been launched with their working
directory set to the sibling `finito` checkout; this one read `finito/HANDOFF.md`, spent
a while analysing the wrong project's uncommitted work, and was one tool call from
committing there. If the first thing you see is a Next.js finance app, you are in the
wrong repo. Shell `cd` does not persist between commands; use absolute paths.

**`git stash push --keep-index=false` fails and stashes nothing.** The flag takes no
value, so git errors out — but the error is one line and easy to miss, and the follow-up
command then runs against an _unstashed_ tree. That produced a "baseline" hash identical
to the new one and briefly looked like proof of byte-identical output when nothing had
been compared at all. After any stash, run `git status --short` and confirm the tree is
actually clean before trusting what you measure.

**`pnpm -r test | tail` will lie to you.** Piping through `tail` truncates per-package
output and the totals; it reports 303 of 507. Redirect the whole log to a file and sum
`# pass` / `# fail` across it. A backgrounded run can also be truncated mid-stream and
report only the first three packages, which looks like a clean pass of a smaller suite —
check that all **eight** test-bearing packages appear (`core` has no tests).

**`pnpm lint` is `prettier --check .`,** so formatting is a hard gate, not advice. Run
`npx prettier --write` on what you touched before claiming green.

**`teach <topic> --lesson <file>` silently ignores the file.** Passing both a topic and
`--lesson` derives a lesson from the topic instead, and with no Anthropic key that
produces a ~20-second stub. Use `cast`, as above. Still worth fixing: the flag
combination should either honour `--lesson` or refuse.

**`next build` over a dirty `.next` still breaks.** `rm -rf apps/web/.next` first.

**Judge output from a keyed render, not the default.** The benchmark runs
`providers: planner heuristic` — the pedagogy is `lesson-derive.ts`, not a model. It only
holds together because the lesson is hand-authored; a topic-only run with no key
degenerates, and now also does not morph. Set an Anthropic key before concluding
anything about whether the concept lands.

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
about, so a label can still be struck through by the pen. Visible at `t=64` of the
benchmark on "too large". Pre-existing.

## Known defects, not fixed

**The planner and visuals disagree about `doubleWell`.** Two catalogues of the named
curve functions remain and they disagree:

    planner/src/curves.ts   a*x^4 - b*x^2 + tilt*x + k          defaults [1, 2, 0, 2]
    visuals/src/plot.ts     a*((x/b)^2 - 1)^2 + tilt*(x/b) + k  defaults [1, 1, 0.35, 0.4]

The planner **authors** these params (`plots.ts:402` passes `[1, 2, 0.55, 2.2]`) and also
runs `descend()` on its own `evalFn` to place the step dots, while visuals draws the
curve. So the drawn curve and the simulated descent can disagree and the dots can leave
the curve. Reachable through the `local-minima` recipe; the benchmark does not use it.
Same class of duplication as root cause 1, one layer up.

**`rerender()` has a weaker cache gate of its own.** The visuals cache naming was fixed
in `cast.ts`, but `rerender()` (`cast.ts:796`) still re-runs visuals only when an asset
lacks an `svg` (`missingArt`, :871) or the board fingerprint moved, and never checks that
element SVGs or the manifest exist.

**`visuals.json` is still written and never read.** Step 1 removed the duplicated
geometry, so there is one implementation — but the renderer consumes `resolvePlot()`
directly rather than the recorded artefact. Closing that needs
`resolveFraming`/`unitsPerPixel` (`render/src/camera.ts`) derivable somewhere the visuals
stage can reach, probably `@inkcast/core`. It is the only part of root cause 1 left.

**`STATUS.md` is dated 2026-07-28 and is now three changes stale.** Its "two vaults",
"anchor draws a second hillside" and "mean content fill 48%/53%" defects are fixed, and
its "`visuals.json` is written and never read" is half-fixed as described above.
Everything else in it stands, including `illustration` never resolving without a key.
