> ## The hybrid drawing lane is built. `HANDOFF-HYBRID.md` is now history, not a job.
>
> An image for a real object's _form_, composed marks for its _parts and their names_. Run
> it and look:
>
>     npx tsx packages/pipeline/src/underlaysheet.mts \
>       "a human heart, anatomical, external front view, whole organ with great vessels" \
>       "Draw a bold line from the AV node down the septum, splitting into left and right \
>        bundle branches reaching the apex. Mark the SA node high in the right atrium. Label each." \
>       /tmp/ul
>
> **Open `/tmp/ul/composite.png`.** That is the board as the film draws it, through every
> real transform. One image call, one authoring call, everything cached after.
>
> Full record in `STATUS.md` under **the hybrid drawing lane — 2026-08-06, later**. Three
> things worth carrying even if you never touch this lane again:
>
> - **An `illustration` asset is vectorised and redrawn in the board's own hand, not
>   pasted.** Two bugs older than this work lived in that path — traced paths ignored their
>   own `translate`, and an asset is authored in a nominal square viewBox before being
>   scaled into its element's box. Both are fixed; both were invisible in the code.
> - **The library lane resolves ahead of the illustration lane and matches on the prompt.**
>   "A human heart, anatomical" matched _human_ and drew a stick figure with "Bundle of His"
>   pointing at it.
> - **A capability is not shipped when it works. It is shipped when the stage that has to
>   ask for it actually asks.** The finished lane went through a full keyed render unused,
>   because the brief's caution was louder than its case. Nothing in the repo measures that
>   gap.
> - **A good drawing is not evidence that the author is good.** The loop has two model calls
>   in it. The composite that proved this lane worked was the _critic's_ work — as composed,
>   its marks were nowhere near the organ — and the cache keeps both, so you can always find
>   out which call did it. `<key>.json` is as composed, `<key>.<fixTag>.json` as corrected.
>
> **The one thing this lane still cannot measure is aim.** `draw-audit.ts` fires on ink
> leaving the canvas, never on a mark missing the thing it names, so a drawing that is
> misaimed but comfortably inside the canvas trips nothing and is never sent to the critic.
> Same blind spot as benzene's chords, and now the most valuable thing left to measure here.

# Handoff — 2026-08-06 · the drawing keeps up with the sentence

> **Read this box first, then the 08-05 handoff below it, which is otherwise still
> accurate.** One session has happened since: the parts of a drawing now land on the words
> that name them, marks can carry one of four inks, and the voice is synthesised with the
> sentence around it. Full record and every number in `STATUS.md` under **2026-08-06**.
>
> **What changed, and where.**
>
> - **`planner/src/draw-cues.ts`** (new) — a cue per mark, from the mark's own name found
>   verbatim in that beat's narration; unnamed marks interpolate between the named ones.
>   Wired in at `buildDrawing` and registered in `compile.ts` so the intent's blanket cue no
>   longer overwrites it. Item 2 of the list below, done.
> - **`core`: `Tone`** (`ink`/`accent`/`contrast`/`muted`) on `Mark` and `ElementBase`,
>   `toneInk()` in `render/src/palette.ts`. **Optional, never defaulted** — a default writes
>   `"tone":"ink"` onto every element and breaks the byte-identical compile.
> - **`page/runtime.js`** — text is painted with a paper halo under the glyphs, so a name
>   across ink is legible. **Known defect 0a below is fixed**, without moving any label.
> - **`voice`** — `previous_text`/`next_text` per phrase, pinned voice settings, and the
>   scene cache key is now one closure instead of two copies that had already drifted.
> - **`DRAW_BRIEF` is `draw/v2`** — LEGIBILITY and COLOUR sections. The brief is in
>   `drawKey`, so **every cached drawing re-authors on the next keyed run.** Budget for it.
>
> **Two new tools**, both free and both in the list of twelve below: **`tandemcheck.mts`**
> (does the drawing keep up with the beat — the measurement that named the sync defect and
> then caught a regression in its own fix) and **`tonesheet.mts`** (the four inks, drawn
> toned and stripped, to be looked at).
>
> **What is not proven:** no keyed render has happened since. The renderer's half of colour
> is proven end to end from hand-authored marks; whether the _author_ uses tone well and
> sparingly is unmeasured, and the legibility brief is unmeasured. That is the first thing
> to do — `drawsheet.mts` over the twelve subjects, then watch a film.

# Handoff — 2026-08-05 · the board looks at what it drew

You are picking this up cold. Everything you need is here or named here. Read
**`docs/research/drawing.md` before you touch a drawing lane** — it is the research, the
experiment and now the measured feedback loop behind the current architecture, and two
sessions were lost to skipping `docs/research/`. `PIPELINE.md` is the durable architecture,
`STATUS.md` the dated verification record, `docs/research/golpo-ux.md` the competitor
teardown.

**This repo is `inkcast`, at `~/code/inkcast`.** Sessions have been launched in the sibling
`finito` checkout by mistake. There is no remote; `git log` tells you where you are.

## The goal, stated once

**A chalkboard-style explanation of any concept, at any level the user asks for, free.**
Bring your own key, and open weights all the way down so someone with no money still gets
a real video. The user's standard for the drawing pipeline, in their words: _maths,
physics, complex STEM, human anatomy — everything should be drawable, either through the
image model with the fal key, or by ourselves._ That is the bar. Measure against it.

## How a video is made

    ingest → lesson → storyboard → voice → visuals → render

`packages/` — `core` (the IR and its zod schemas), `planner` (lesson, drawing, compile),
`voice`, `visuals` (roughjs geometry, assets, images), `render` (Chromium + ffmpeg),
`pipeline` (orchestration, caching, cost), `keyvault` (macOS keychain), plus `apps/cli`
and `apps/web`.

The lesson stage decides _what to teach_; the compiler decides _what gets drawn_; voice
runs before visuals so every element resolves onto the word that introduces it.

## The drawing lane, as it stands

A topic space cannot be enumerated; a mark space can. Eight marks — `rect`, `ellipse`,
`line`, `stroke`, `arrow`, `label`, `hatch`, `dots` — composed by a model into any drawing
at all, compiled to ordinary elements so roughening, cueing, reveal, camera and `persist`
are all inherited. Every element carries its part's own name (`b4_v0_damp-gap`).

Then the board **looks at what it drew**:

    author (LLM, 1 call/picture) → repair (code, free) → audit (code, free)
      → if measurably wrong: render it, show it back, correct it (LLM, 1 call)
      → re-audit, and reject a correction that measures worse

- **`core/src/lesson.ts`** — `Mark`, and `DRAW_W`/`DRAW_H` (1000×560, landscape to match
  the hole a beat leaves for a picture).
- **`planner/src/draw-geom.ts`** — what ink a mark actually lays down. A rect is four
  edges, an arrow is its line, and shading (`hatch`, `dots`) covers an area you may write
  **on** while still being **near**. Shared by the repair and the audit so they cannot
  disagree. **This file is where the quality came from**, not the model.
- **`planner/src/drawing.ts`** — marks → elements, plus `repairLabels` (scores candidate
  positions; a collision justifies a move and nothing else does) and `prepareMarks` (what
  will actually be drawn — the audit and the preview both use it).
- **`planner/src/draw-audit.ts`** — what is _provably_ wrong: names on names, names across
  strokes, words too long for their line, ink off the canvas, a name naming nothing. Each
  defect is a sentence with coordinates. `AUDIT_VERSION` is in the correction's cache key.
- **`planner/src/draw-critic.ts`** — the render handed back with its own marks and the
  defect list. Never throws; a correction is kept unless it measures worse.
- **`planner/src/draw-anthropic.ts`** — the author, the gate, and two cache files per
  drawing: `<key>.json` (as composed) and `<key>.<fixTag>.json` (as corrected, or the
  original when the correction lost, so nothing is paid for twice).
- **`planner/src/underlay.ts`** — the hybrid lane's placement rules: the region a generated
  subject may occupy, where its traced ink lands on the canvas, and the asset id and prompt
  both sides must agree on. **Everything in it exists so two sides cannot disagree about one
  number** — a text-to-image model is not a function, and marks aimed at a picture that
  landed anywhere else look exactly like a model that cannot aim.
- **`pipeline/src/draw-underlay.ts`** — the other seam, `drawUnderlay`. Generates the raster,
  traces it to find where its ink really is, and renders **the board the author is shown**:
  that ink at the box it will occupy, on a canvas the size the author composes on. Not the
  raw raster — see the file for why that difference is the whole lane.
- **`pipeline/src/draw-preview.ts`** — the renderer, passed down as `drawPreview`. The
  planner has no browser and must not acquire one; same seam as `illustrations`.
- **`render/src/still.ts`** — `openStills()` / `captureStill()`: one frame, no encode.

## What is proven, and what is not

**Twelve subjects, drawn, audited and looked at** (`drawsheet.mts`, which now holds the
subject list so the breadth test stops being rebuilt from memory): **12/12 drew, 10/12
measure clean.** Four measured dirty as composed; the correction fixed two, tied on one and
was rejected on one. Frames opened for six of the twelve. The titration rig and the knee
joint are both good now — the knee was "blobs" last session, though the instruction differs
so that is not a controlled comparison.

**Mechanical repair does most of the work.** Cache defect score 713 → 110 with no model at
all. The correction pass is called on about a third of drawings.

**Not proven: that a clean audit means a good drawing.** Benzene audits clean with its
double bonds drawn as chords across the ring. See "the gate's blind spot" below.

**The keyed render has been watched.** `cast "How a lithium-ion battery charges"` → 1:42,
ten scenes, $0.57, and **zero assets**: every picture in the film came from the drawing lane,
with the image provider configured and never needed. Ten drawings, defect score 66 → 2, nine
of ten clean. The beat the image generator once returned as "two empty rectangles" now draws
as two hatched electrodes across a gap with lithium packed into one. It also showed two
defects older than this session — see items 0 and 0b under known defects, and open
`projects/try/out.mp4` before you believe either is cosmetic.

## The work, in order

### 1. A judge, not a corrector — close the gate's blind spot

The audit is arithmetic and the paper's ablation is about _geometry_. A drawing can be
measurably perfect and still wrong: benzene's double bonds as chords, the heart's septum
leader pointing at the outer wall, the double slit's wavefronts tangling. Nothing in the
loop can see any of it.

Two ways in, and they are different things:

- **`INKCAST_DRAW_FIX=all`** already runs the correction pass unconditionally, with its own
  cache namespace so the experiment cannot contaminate the default. Run the sheet both ways,
  compare the frames, and decide with evidence whether unconditional is worth the cost.
- **A judge pass** — a model scoring the render against the instruction ("does this teach
  what it was asked to?") and either failing it or feeding the correction. That is a
  measurement of teaching rather than of geometry, and it is the missing half.

_Done when:_ you have a number for "does this drawing teach" that you trust, and the twelve
frames back it up.

### 2. Cue the parts, and let the drawing drive the narration

Every mark is a named element and **nothing uses that yet** — the highest-value thing left
that is not about drawing quality. Three things the IR already supports:

- **`enter.cue` per element** — the gap drawn on "the damp gap", the ion on "a lithium ion
  crosses". Today the whole drawing shares the intent's one cue, spread evenly.
- **`EmphasisElement`** targets an element id — circle `damp-gap` in a later beat instead
  of drawing a second picture of it.
- **`motion`** on one mark — the ion actually crossing the gap as it is described.

This is the user's own framing: _once we nail the drawing, we know what we are drawing, so
we can plan the lesson, the script, the cadence and the pauses around it._

### 3. A `math` mark

`label` cannot set a fraction, an integral, a root or a matrix. `EquationElement` already
typesets TeX (`visuals/src/equation.ts`). One more `Mark.kind` closes maths and physics.

### 4. A second correction attempt

The loop the literature describes is iterative; ours looks once. The two subjects still
measuring dirty are ones where a second look would plausibly land. Cheap to try — the
plumbing is all there — and it needs a cost argument before it becomes the default.

### 5. Reuse a drawing across beats

Caching makes two _identical instructions_ the same picture; nothing lets beat 7 say "the
drawing from beat 2, with the arrow reversed", so a lesson redraws its subject per beat and
the recap redraws it again. `cast`/`character` is the shape of the fix for people.

### 6. Density

`fillcheck` 20% against a 48% benchmark. What is left is the cell grid itself — a
two-column cell (words beside the picture), or framing the ink rather than the cell.
`regions.ts` decided one cell is the tightest shot there is; that decision now binds.

### 7. Story, cadence, and the space between cuts

Untouched, and item 2 is what makes it tractable. Levers: reveal order across a cut,
camera transitions that never vary by role (0.45s in-region, 0.95s between, 1.3s recap),
the `dominant` clamp.

### 8. The voice bill

ElevenLabs at **$0.21/min** — past the `$0.20/min`target the README quotes and 86% of the
last full render's cost.`eleven_flash_v2_5`is about half the price at similar quality;
the model id is a constant in`voice/src/providers/elevenlabs.ts`. Also `pipeline.json`
records the _requested_ voice id, not the one the adapter resolved to.

## How to verify a change cheaply

Fifteen tools, cheapest first. **Use the first one that can see your change.** All are run
from the repo root with `npx tsx <path>`.

1. `packages/planner/src/markcheck.mts cache` — every cached drawing, audited before and
   after mechanical repair. **The cheapest thing that can see a drawing-lane change**: no
   key, no network, no browser, ~50 ms. Also takes `<lesson.json>` files. **It cannot see a
   hybrid drawing honestly** — a cache file is marks and nothing else, so the picture those
   marks annotate is not there, and names deliberately placed in the clear board beside it
   read as `label-adrift`. Use it as a regression check on the drawings that predate the
   hybrid lane, and `underlaysheet.mts` for the ones that do not.
2. `packages/pipeline/src/vocabcheck.mts` — terms spoken vs written.
3. `packages/pipeline/src/synccheck.mts <projectDir>` — every element against the word
   being spoken. Needs a project the voice stage has run over.
4. `packages/pipeline/src/sbhash.mts gradient-descent longitude` — storyboard hash, both
   presets, both shipped lessons. **The only tool that sees a planner change on them** —
   and note neither shipped lesson has marks, so it proves the drawing lane broke nothing
   rather than that it works.
5. `packages/pipeline/src/sbjson.mts <doc|lesson.json> <outDir>` — a storyboard from
   anything, no key.
6. `packages/pipeline/src/drawsheet.mts <outDir> [instruction…]` — **the tool the drawing
   lane is judged with.** Draws the twelve subjects (or anything you name), writes a
   full-frame PNG of each before and after correction, and prints both audit scores. One
   authoring call per subject the machine has never drawn, one correction call per subject
   that needs it, everything cached after.
7. `packages/pipeline/src/drawcheck.mts <dir>` — the visuals stage alone with keys
   hydrated. Generates images for the image lane; free for the drawing lane.
8. `packages/visuals/src/geomhash.mts` — what the visuals stage resolves.
9. `packages/render/src/planhash.mts` — what the renderer will draw, timing excluded.
10. `packages/visuals/src/libsheet.mts` — the only way to look at a library asset or rig.
11. `packages/render/src/frames.mts <projectDir> <outDir> [seconds…]` — ~76 ms a frame.
    **Every defect fixed in the last four sessions was found here, not by reading code.**
    Copy `storyboard.resolved.json` over `storyboard.json` first so it draws real ink.
12. `packages/render/src/fillcheck.mts <storyboard.json>` — mean content fill. A regression
    check, not a target: it counts bounding boxes, so it can be gamed.
13. `packages/pipeline/src/tandemcheck.mts <projectDir>` — **does the drawing keep up with
    the beat.** Recompiles from the project's own `lesson.json` and resolves cues against
    its _measured_ timings, so a planner change is re-measured against real speech with no
    key and no re-render. Reports dead board before the first stroke, first stroke to last,
    and how many distinct moments the beat's elements resolved to. Use it and not
    `synccheck.mts` for anything about _when_ a picture is drawn — synccheck checks each
    stroke against its own word and reported the shipped film's worst sync defect as 209
    elements, 0 in a silence, because they were all correctly cued to one phrase.
14. `packages/pipeline/src/underlaysheet.mts "<subject>" "<instruction>" [outDir]` — **the
    tool the hybrid lane is judged with**, and the cheapest thing that can see it at all:
    one image call, one authoring call, and a `composite.png` that has been through every
    transform the film uses. Every defect in that lane was found by opening it.
15. `packages/pipeline/src/tonesheet.mts <outDir>` — the four inks on a drawing built to
    need them, rendered twice: as authored, and with every tone stripped. Free, no key.
    **Open both.** Whether two flows crossing one space are legible is not a number.

Tools 4, 8 and 9 take a stash diff:

    npx tsx <tool> <targets> > /tmp/after.txt
    git stash push -u && git status --short          # confirm the tree is CLEAN
    npx tsx <tool> <targets> > /tmp/before.txt
    git stash pop
    diff /tmp/before.txt /tmp/after.txt

**To test the lesson brief without a render**, call `designLesson` from `@inkcast/pipeline`
(the lesson stage alone, ~$0.06 against ~$0.45). **To test one drawing**, `drawOne` from
`@inkcast/planner`, or just use `drawsheet.mts` with your own instruction.

A full keyed render, when you need one:

    node apps/cli/bin/inkcast.mjs cast "How a lithium-ion battery charges" --project try

Drop `--json`; it silences stderr and a clean log then proves nothing.

## Traps

**A measurement a fix can game is a measurement that will be gamed.** The two frames that
taught this, both in `STATUS.md` under this date: a repair pass that cleared every label
collision by throwing labels off the canvas (713 → 48, and all 48 were its own doing), and
an audit that counted hatching as ink, so the correction moved `N` and `S` out of a magnet
into the field lines and scored zero for it. **Before believing a number went down, look at
the frame.**

**A keyword table answers "which", never "whether"** — and the deeper version: _a table of
subjects cannot be completed at all._ If you are adding an entry so one more topic works,
you are on the wrong axis.

**Read the frames.** Every defect worth fixing in four sessions was visible in a rendered
frame and invisible in the code.

**The repair pass runs before the audit**, so a fixture whose only defect is a label lying
on a line is a fixture the critic never sees — `repairLabels` moved it. This looks exactly
like a broken critic. Test the critic against geometry nothing can nudge (a mark off the
canvas).

**A brief belongs inside its own cache key** — and so does the audit. `drawKey` hashes
`DRAW_BRIEF`; `fixTag()` hashes `FIX_VERSION` **and** `AUDIT_VERSION`, because the audit is
the _input_ to a correction. A cached correction that survived a change to either is an
answer to a question nobody asks any more.

**`revise: false` must not serve a cached correction.** It means "the drawing as composed",
and serving the corrected one silently collapses `drawsheet.mts`'s before/after columns so
the loop looks like it does nothing.

**A zod tuple breaks the tool schema.** `z.tuple([number, number])` compiles to draft-07
`items: [...]`, which the Messages API rejects as an invalid `input_schema` — every call
400s. `Mark.points` is `number[][]` for that reason; pair-ness is checked in code.

**`elements` sometimes comes back as a JSON string** — twice in eighteen calls, and the
retry does not fix it because the model does not recognise it as an error. It is parsed
rather than rejected.

**`measureText` can only return its own estimate**, and the renderer wraps again against
real font metrics. Any box sized exactly to the estimate will break words mid-syllable.
Measured this session: the mean advance of the real handwriting is 0.521 of cap height
against the planner's 0.52, so the estimate is _sound_ — the ±3%-of-canvas error is enough
to make two long names 30 units apart render tight without measuring as a collision.

**Roughjs hachure at dot scale is one line** — filled circles come out as rings, so dots
are drawn small and heavily stroked instead.

**A path with `points` is splined (Catmull-Rom); a path with `d` is verbatim.** An angular
stroke must go in as `d` or its corners round off into a wave.

**`seed: 0` means "no seed" in roughjs** — `baseOptions` nudges it to 1; do not remove.

**The pipeline reaches stage packages only through `stages.ts`**, with literal `import()`
inside a thunk. A static import of `@inkcast/render` anywhere in `pipeline` pulls Playwright
into every `inkcast list`, and a computed specifier hides the module from the studio's Next
build — which once left every render dying at request time.

**`git stash -u` takes untracked measurement tools with it.** Every tool above is committed
for that reason.

**`pnpm -r test | tail` lies.** Redirect and sum with `awk '/# pass [0-9]+$/ {p+=$NF}'` —
note `$NF`, because lines carry a package prefix.

**`pnpm lint` is `prettier --check .`** — a hard gate, `examples/*.lesson.json` and every
`docs/*.md` included.

**Stage versions** are `lesson@10, storyboard@14, voice@6, visuals@8, render@5` in
`packages/pipeline/src/keys.ts`, which explains when to bump and when not to. **The lesson
brief is not in the lesson stage's cache key**, so a brief change is invisible without the
bump — unlike `DRAW_BRIEF`, which is hashed into `drawKey` directly.

**`teach <topic> --lesson <file>` silently ignores the file.** Use `cast`.

## Known defects, ranked by what a viewer notices

0. **Text is clipped mid-word, and the cause is two type scales.** `empty stack` rendered as
   `empty stac` in the keyed film. The planner sizes a text box from `FONT` in
   `planner/src/elements.ts` (caption 22, label 27) and the renderer draws it at `TYPE_SCALE`
   in `core/src/camera.ts` (caption 26, label 32) — 18% bigger, every role. The 1.5× slack in
   `drawing.ts` hides it for most strings and the longest ones lose their last letter. **Two
   catalogues of one number**, the same pathology as items 9 and 10 below, and the cheapest
   real fix on this list: make one of them import the other. Older than the drawing lane —
   the same `lesson.json` compiled either side of this session differs in zero text fields.
   0a. **A name written on _dense_ hatching is hard to read** — `electron stuck`, `cathode` and
   `graphite` in the keyed film, each written inside a narrow heavily-hatched strip. This is
   the deliberate cost of the audit treating shading as writable-on, and that decision should
   not simply be reversed: the version that treated hatching as an obstacle got `N` and `S`
   moved out of a bar magnet into the field lines, which is worse. The fix is on the other
   side — break or lighten the hatching behind a label (roughjs can clip), or let the author
   place the name against the region's edge rather than in it. A wide hatched pole with one
   letter in it reads fine; a narrow strip with two words in it does not.
   0b. **A caption cut to the preset's word budget lands mid-phrase.** "A charged battery is
   lithium held on the wrong" — nine words, `captionWords: 9`. `shorten()` in `text.ts` was
   written to avoid exactly this and its `DANGLING` list misses a trailing adjective. The
   deeper fix is a lesson author that writes a caption that fits, rather than a compiler that
   cuts a sentence written for another purpose.
1. **Nothing measures whether a drawing teaches.** Benzene's double bonds are chords across
   the ring; the heart's septum leader points at the outer wall; the double slit's
   wavefronts tangle. All audit clean. Item 1.
2. **A drawing is drawn evenly across its beat**, not cued part by part. Item 2.
3. **Two of twelve still measure dirty** — the heart keeps one `label-on-ink`, the knee that
   plus an `off-canvas`, and the knee's correction measured worse and was rejected. Item 4.
4. **No maths notation beyond Unicode.** Item 3, and now the top of the list: it is the
   one thing Golpo is best at and we cannot do at all. `EquationElement` already typesets
   TeX (`visuals/src/equation.ts`); one more `Mark.kind` closes maths, physics and
   chemistry.
5. **The board is sparse** — 20% fill against a 48% benchmark. Item 6.
6. **A subject is redrawn per beat** rather than referred to. Item 5.
7. **The recap redraws its picture** in a fresh panel while the original is still up.
8. **No open-weight path for the lesson stage.** The drawing lane is the closest — a text
   model emitting JSON, so a local model could serve it. The correction pass now needs
   vision as well, which narrows the field. Untested.
9. **`render/src/sketch.ts` is a second hand** — Mulberry32 against the visuals stage's
   roughjs. Unifying redraws half of every board. `PIPELINE.md` step 10.
10. **The planner and visuals disagree about `doubleWell`** — two catalogues of one curve.
11. **Emphasis lands on a clause, not a word.** **`coreInsight` is read by nothing.**

## Current state

Branch `visuals-morph-density`, working tree clean. `pnpm lint` clean · `pnpm -r typecheck`
0 errors across 9 projects · `pnpm -r test` **636 pass / 0 fail**. Both shipped lessons
(`examples/lessons/*.lesson.json`) compile byte-identically at both presets.

## The one thing to hold on to

The board composes its own pictures, and now it looks at them before they are drawn for
real. But the thing that did most of the work was not the model looking — it was teaching
the code what ink _is_, so that a name lying across an arrow could be told apart from a name
sitting inside the shape it names. **Two of the three biggest quality gains this session came
from a measurement being wrong, and both were found by opening a PNG.** The next win is
still not a new lane. It is using the part names — and knowing whether a drawing teaches.
