# Handoff — 2026-08-05 (later still) · the board can draw now

Session state, not design. `PIPELINE.md` is the durable architecture, `STATUS.md` the
verification record. **`docs/research/drawing.md` is the one to read before touching a
drawing lane** — it is the research and the experiment behind everything below, and it
exists so the next session does not re-derive it. `docs/research/golpo-ux.md` is the
competitor teardown.

## The goal, stated once

**A chalkboard-style explanation of any concept, at any level the user asks for, free.**
Bring your own key, and open weights all the way down so someone with no money still gets a
real video. Nothing below changes that.

## What changed, and why it is the whole architecture

The user asked the right question: _is a folder of hand-written drawing rules a crude way
to build this, given it can never cover every topic?_ It is, and the answer was not to
extend the lists.

Every lane answered **"which of the things I already know is this?"** — six freeform
shapes, twelve plot recipes, a symbol set. Last session made those lanes honest about what
they cannot draw. This session removed the need: **eight marks** — box, ellipse, line,
freehand stroke, arrow, written label, hatching, scattered dots — composed by the model
into any drawing at all. A topic space cannot be enumerated; a mark space can, because
composition has no ceiling.

`pnpm lint` clean · `pnpm -r typecheck` 0 errors across 9 projects · `pnpm -r test`
**614 pass / 0 fail**. Commits `cd72eab` (the lane) and `d31ca5c` (the research).

- `Mark` and `DRAW_W`/`DRAW_H` in `core/src/lesson.ts` — the vocabulary and the canvas.
- `planner/src/drawing.ts` — marks → elements, pure and tested. Fit, and label repair.
- `planner/src/draw-anthropic.ts` — the author: one focused call per picture, in parallel,
  cached machine-wide by the hash of its instruction _and the brief_.
- The teaching brief makes `draw` the normal choice and narrows `illustration` to
  likeness — a living thing, a person, a real place.

**A mark compiles to an ordinary element.** A stroke is a `PathElement`, a box a
`ShapeElement`, a label a `TextElement`. Nothing downstream changed: roughening, cueing,
stroke-by-stroke reveal, camera, `persist` are all inherited. That is why a change this
large touched no renderer code, and it is why **the sync work already done applies to
drawings for free.**

## The measurement

Same battery lesson, every picture switched to the new lane
(`scratchpad/redraw.mts` → `sbjson` → `drawcheck` → `frames`):

    before (image lane)   1 asset  · 11 path (hills, fog, a walker) · 13 text
    now   (drawing lane)  43 path · 49 shape · 25 arrow · 63 text · 0 images

**9/9 drawings composed, 0 compiler warnings, 0 image generations** — the whole video
draws itself for the price of text tokens, in 25 seconds, in parallel. Frames were
rendered and looked at: labelled electrodes, a soaked gap with ions crossing it and
electrons stopped at it, a wire looping through a phone. Both shipped lessons compile
byte-identically at both presets.

Two capabilities no image model has, both visible in those frames: **it can spell** (the
fourteen generated illustrations measured earlier came back carrying `+e> --`), and **it
can draw a relation** (the image model's version of that same beat was two empty
rectangles).

## The work, in order

### 1. Show the drawing to the model that drew it

The single highest-value thing left, and both the literature and our own frames say so.
`drawing.md` §3: the paper's ablation is that removing canvas feedback degrades geometry;
the working Excalidraw agents all render, look, and fix. Our remaining defects are exactly
that class — labels crowding each other, a duplicate label, a leader line across the
picture. `repairLabels` fixes the mechanical half already; the rest needs eyes.

We have the renderer (`frames.mts` draws a storyboard in ~76ms a frame) and the model has
vision. Render the drawing alone, hand it back with its own marks, ask for corrections.
One extra call per picture, and only when a cheap geometric check says something is wrong.

_Done when:_ on the battery lesson, no label overlaps ink or another label, and you have
looked at the frames.

### 2. Cue the parts, and let the drawing drive the narration

Every mark is now a named element on the board — `b4_v0_damp-gap`, `b4_v0_ion-1` — and
nothing uses that yet. Three things the IR already supports and the drawing lane just made
reachable:

- **Cue a part to its own words.** `enter.cue` per element: the gap is drawn on "the damp
  gap", the ion on "a lithium ion crosses". Today the whole drawing shares the intent's
  one cue and is spread evenly across the beat.
- **Highlight while discussing.** `EmphasisElement` targets an element id. A later beat can
  circle `damp-gap` instead of drawing a second picture of it.
- **Move a part.** `motion` on one mark — the ion actually crossing the gap as it is
  described.

This is the user's other half arriving from the drawing side: _once we know what we are
drawing, we can plan the script, the cadence and the pauses around it._ The lesson author
writes narration and marks in the same run — it can be told to name the parts in the
narration and cue them.

### 3. Reuse a drawing across beats

Caching makes two identical instructions the same picture. Nothing lets beat 7 say "the
drawing from beat 2, with the arrow reversed" — so a lesson still redraws its subject per
beat, and the recap redraws it again. `cast`/`character` is the shape of the fix for
people; the same idea for subjects is a small schema addition.

### 4. Density, now that drawings fill the cell honestly

`fillcheck` 20.0% against a 48% benchmark. The canvas is landscape and a drawn beat gives
its caption 26% of the cell instead of 40%, which helped; what is left is the cell grid
itself — a two-column cell (words beside the picture) or framing the ink rather than the
cell. `regions.ts` deliberately decided one cell is the tightest shot there is; that
decision is now the binding constraint.

### 5. Story, cadence, and the space between cuts

Untouched, and now better positioned: item 2 is what makes it tractable. The levers are
still the reveal order across a cut, camera transitions that never vary by role, and the
`dominant` clamp.

### 6. The voice bill

ElevenLabs at **$0.21/min** is past the target the README quotes and was 86% of the last
render's cost. `eleven_flash_v2_5` is about half the price at similar quality;
`voice/src/providers/elevenlabs.ts`. Also: `pipeline.json` records the _requested_ voice
id, not the one the adapter resolved to.

## How to verify a change cheaply

Ten tools, cheapest first. **Use the first one that can see your change.**

1. **`vocabcheck.mts`** — terms spoken vs written.
2. **`synccheck.mts <projectDir>`** — every element against the word being spoken.
3. **`sbhash.mts <lesson…>`** — storyboard hash, both presets, both shipped lessons.
4. **`sbjson.mts <doc|lesson> <outDir>`** — a `storyboard.json` from anything, no key.
5. **`drawcheck.mts <dir>`** — the visuals stage alone, keys hydrated. For the _image_ lane
   it generates; for the drawing lane it just resolves, free.
6. **`geomhash.mts`** / 7. **`planhash.mts`** — what visuals resolves, what render draws.
7. **`libsheet.mts`** — a library asset or rig.
8. **`frames.mts <projectDir> <outDir> [seconds…]`** — ~76ms a frame. **Every defect fixed
   in the last two sessions was found here, not by reading code.** Copy
   `storyboard.resolved.json` over `storyboard.json` first.
9. **`fillcheck.mts`** — mean content fill. A regression check, not a target.

**To test a brief or lane change without paying for a render**, call `designLesson` (the
lesson stage alone, ~$0.06 against $0.45) or `drawLesson` on a lesson you already have —
`scratchpad/redraw.mts` in this session's scratchpad does exactly that, and is ten lines.

A full keyed render:

    node apps/cli/bin/inkcast.mjs cast "How a lithium-ion battery charges" --project try

Drop `--json`; it silences stderr and a clean log then proves nothing.

## Traps

**This repo is `inkcast`, at `~/code/inkcast`.** No remote — `git log` tells you where.

**Read `docs/research/` before designing anything.** Three sessions have now paid for
skipping it. `drawing.md` is the newest and the most load-bearing.

**A keyword table answers "which", never "whether"** — and the deeper version, which this
session is the answer to: _a table of subjects cannot be completed at all._ If you find
yourself adding an entry so one more topic works, you are on the wrong axis.

**A zod tuple breaks the tool schema.** `z.tuple([number, number])` compiles to draft-07
`items: [...]`, which the Messages API rejects as an invalid `input_schema` — every call
400s. `Mark.points` is `number[][]` for that reason and pair-ness is checked in code.

**`elements` sometimes comes back as a JSON string**, twice in eighteen calls, and the
retry does not fix it because the model does not recognise it as an error. Parsed rather
than rejected.

**A brief is part of its own cache key.** `drawKey` hashes `DRAW_BRIEF` itself; a cache
that survived a brief change would serve drawings composed for a canvas that no longer
exists.

**Roughjs hachure at dot scale is one line.** Small filled circles come out as rings —
dots are drawn small and heavily stroked instead.

**A path with `points` is splined; a path with `d` is verbatim.** An angular stroke must go
in as `d` or Catmull-Rom rounds its corners into a wave.

**`git stash -u` takes your untracked measurement tool with it.** Every committed tool is
committed for that reason.

**`pnpm -r test | tail` lies.** `awk '/# pass [0-9]+$/ {p+=$NF}'` — note `$NF`.

**`pnpm lint` is `prettier --check .`** — a hard gate, `docs/*.md` included.

**Stage versions** `lesson@8, storyboard@11, voice@5, visuals@7, render@5` in
`packages/pipeline/src/keys.ts`.

**`seed: 0` means "no seed" in roughjs** — `baseOptions` nudges it to 1.

## Known defects, ranked by what a viewer notices

1. **Labels crowd each other inside a drawing.** `repairLabels` moves a label off _ink_;
   two labels can still stack, and near-duplicate labels get placed twice. Item 1.
2. **A drawing is drawn evenly across its beat**, not cued part by part to the words that
   name each part. Item 2.
3. **The board is sparse** — 20% fill against a 48% benchmark. Item 4.
4. **A subject is redrawn per beat** rather than referred to. Item 3.
5. **The recap redraws its picture** in a fresh panel while the original is still up.
6. **No open-weight path for the lesson stage.** The drawing lane is now the _closest_ — it
   is a text model emitting JSON, so a local model could serve it. Untested.
7. **`render/src/sketch.ts` is a second hand** — Mulberry32 against the visuals stage's
   roughjs. Unifying redraws half of every board.
8. **The planner and visuals disagree about `doubleWell`** — two catalogues of one curve.
9. **Emphasis lands on a clause, not a word.**
10. **`coreInsight` is validated and read by nothing.** No multi-line equations.

## What has NOT been judged

**No full keyed render has run since the drawing lane landed.** Everything above is a
compile, a visuals resolve and stills — deliberately, because that is cents rather than
dollars. The board has been seen in frames; the _video_ has not. Do that after item 1, so
the render pays for a real change.

## The one thing to hold on to

The pedagogy was never the problem. The routing was fixed last session. What was left was
that we had exactly two ways to draw — a plot, and whatever an image model returned for a
sentence — and neither could draw two things and the relationship between them. Now the
board composes its own pictures out of marks, labels its own parts, and every part has a
name. **The next win is not a new lane. It is using the names.**
