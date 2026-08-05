# Handoff — 2026-08-05 · the board draws its own pictures

You are picking this up cold. Everything you need is here or named here. Read
**`docs/research/drawing.md` before you touch a drawing lane** — it is the research and
the experiment behind the current architecture, and two sessions were lost to skipping
`docs/research/`. `PIPELINE.md` is the durable architecture, `STATUS.md` the dated
verification record, `docs/research/golpo-ux.md` the competitor teardown.

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

## Where the drawing problem got to

Three sessions of history, compressed, because the shape of it matters more than the
detail:

1. The board drew mostly text, and what it drew was wrong — a battery cross-section came
   out as a parabola. Cause: every drawing lane was a **hand-written list** answering
   "which of the things I already know is this?" — six freeform shapes, twelve plot
   recipes, a symbol set, all written from one lesson about gradient descent.
2. Those lanes were made **honest** (they now decline what they cannot draw and route it
   elsewhere) and the generated-image lane was measured properly: fourteen images, opened
   one by one. Objects came back acceptably; **relations came back wrong** ("a plus charge
   crossing the gap while an electron is turned back" → two empty rectangles), **words
   came back as scribble**, and a raster has no parts, no reuse and no free path.
3. So the axis was wrong, and the fix was not a longer list. **A topic space cannot be
   enumerated; a mark space can.** Eight marks — `rect`, `ellipse`, `line`, `stroke`,
   `arrow`, `label`, `hatch`, `dots` — composed by the model into any drawing at all.

### The drawing lane, as it stands

- **`packages/core/src/lesson.ts`** — `Mark` (the eight kinds) and `DRAW_W`/`DRAW_H`
  (1000×560, landscape to match the hole a beat leaves for a picture). A `VisualIntent`
  with `kind: 'draw'` carries its own `marks`.
- **`packages/planner/src/draw-anthropic.ts`** — the author. One focused call per picture,
  four in flight, `claude-sonnet-5` by default (`INKCAST_DRAW_MODEL` overrides). Cached
  machine-wide in `~/.inkcast/cache/drawings/` by a hash of the instruction **and the
  brief**, so a re-render is free and two lessons wanting the same picture get the same
  drawing.
- **`packages/planner/src/drawing.ts`** — marks → elements. Pure, tested. Fits by content
  bounds (uniformly, never stretched), drops self-titles, repairs label collisions.
- **`packages/planner/src/compile.ts`** — `buildIntent` prefers marks over every other
  lane; a beat carrying a drawing gives its caption 26% of the cell instead of 40%.

**A mark compiles to an ordinary element** — a stroke is a `PathElement`, a box a
`ShapeElement`, a label a `TextElement`. That is why this was a small change: roughening,
cueing, stroke-by-stroke reveal, camera framing and `persist` are all inherited, and no
renderer code was touched. Every element carries its part's own name
(`b4_v0_damp-gap`, `b4_v0_ion-1`).

## What is proven, and what is not

**A twelve-subject breadth test, drawn and looked at** (`scratchpad/breadth.mts` pattern,
rebuild it in ten lines): calculus area-under-curve, Pythagoras, matrix multiplication,
free-body diagram on a ramp, magnetic field lines, the double slit, benzene, a titration
rig, a heart in cross-section, a neuron, a knee joint, binary search.

**12/12 drew.** Ranked by how well:

- **Strong** — benzene (ring, alternating bonds, all six hydrogens), the neuron, the
  heart (four chambers, septum, named valves, blood arrows), titration, Pythagoras,
  free-body, calculus, binary search, matrix multiplication.
- **Adequate** — magnetic field lines, the double slit (wavefronts tangle).
- **Weak** — the knee joint. **Irregular organic anatomy is where a composed drawing is
  least convincing**, and where the image lane still earns its place. If you want to close
  the user's "human anatomy" requirement properly, that is the case to work on: either a
  better brief for organic outlines, or routing likeness-heavy anatomy to `illustration`.

Basic maths notation survives as Unicode (`a² + b²  = c²` rendered correctly). **Fractions,
integrals, roots and matrices do not** — a `label` is plain text. The IR already has an
`EquationElement` that typesets TeX to glyph outlines; a ninth mark, `math`, mapping to it
is the obvious fix and is not done.

**Not judged: a full keyed render.** Everything above is compiles, the visuals stage and
stills. The board has been seen in frames; the _video_ has not, since the drawing lane
landed. Do that once item 1 below is in, so the render pays for a real change.

## The work, in order

### 1. Show the drawing to the model that drew it

The highest-value thing left, and both the literature and our own frames say so.
`drawing.md` §3: the paper's ablation is that removing canvas feedback degrades geometry;
every working Excalidraw agent renders, looks, and fixes. Our residual defects are exactly
that class — tangled wavefronts, a label still crowding an arrow, the odd word broken
across lines.

We have the renderer (`frames.mts`, ~76ms a frame) and the model has vision. Render the
drawing alone, hand it back with its own marks, ask for corrections. Gate it on a cheap
geometric check so it costs one extra call only when something is measurably wrong.

_Done when:_ on the twelve-subject sheet, no label overlaps ink or another label, and you
have looked at the frames.

### 2. Cue the parts, and let the drawing drive the narration

Every mark is a named element and **nothing uses that yet**. Three things the IR already
supports:

- **`enter.cue` per element** — the gap drawn on "the damp gap", the ion on "a lithium ion
  crosses". Today the whole drawing shares the intent's one cue, spread evenly.
- **`EmphasisElement`** targets an element id — circle `damp-gap` in a later beat instead
  of drawing a second picture of it.
- **`motion`** on one mark — the ion actually crossing the gap as it is described.

This is the user's own framing: _once we nail the drawing, we know what we are drawing, so
we can plan the lesson, the script, the cadence and the pauses around it._ It is now
reachable because the drawing is structured, and it is the reason sync is the easier half.

### 3. A `math` mark

`label` cannot set a fraction, an integral, a root or a matrix. `EquationElement` already
typesets TeX (see `visuals/src/equation.ts`). One more `Mark.kind` closes maths and
physics properly.

### 4. Reuse a drawing across beats

Caching makes two _identical instructions_ the same picture; nothing lets beat 7 say "the
drawing from beat 2, with the arrow reversed", so a lesson still redraws its subject per
beat and the recap redraws it again. `cast`/`character` is the shape of the fix for people.

### 5. Density

`fillcheck` 20% against a 48% benchmark. The canvas is landscape and drawn beats give
their caption less of the cell, which helped; what is left is the cell grid itself — a
two-column cell (words beside the picture), or framing the ink rather than the cell.
`regions.ts` decided one cell is the tightest shot there is; that decision now binds.

### 6. Story, cadence, and the space between cuts

Untouched, and item 2 is what makes it tractable. Levers: reveal order across a cut,
camera transitions that never vary by role (0.45s in-region, 0.95s between, 1.3s recap),
the `dominant` clamp.

### 7. The voice bill

ElevenLabs at **$0.21/min** — past the `$0.20/min`target the README quotes and 86% of the
last full render's cost.`eleven_flash_v2_5`is about half the price at similar quality;
the model id is a constant in`voice/src/providers/elevenlabs.ts`. Also `pipeline.json`
records the _requested_ voice id, not the one the adapter resolved to.

## How to verify a change cheaply

Ten tools, cheapest first. **Use the first one that can see your change.** All are run
from the repo root with `npx tsx <path>`.

1. `packages/pipeline/src/vocabcheck.mts` — terms spoken vs written.
2. `packages/pipeline/src/synccheck.mts <projectDir>` — every element against the word
   being spoken. Needs a project the voice stage has run over.
3. `packages/pipeline/src/sbhash.mts gradient-descent longitude` — storyboard hash, both
   presets, both shipped lessons. **The only tool that sees a planner change on them.**
4. `packages/pipeline/src/sbjson.mts <doc|lesson.json> <outDir>` — a storyboard from
   anything, no key.
5. `packages/pipeline/src/drawcheck.mts <dir>` — the visuals stage alone with keys
   hydrated. Generates images for the image lane; free for the drawing lane.
6. `packages/visuals/src/geomhash.mts` — what the visuals stage resolves.
7. `packages/render/src/planhash.mts` — what the renderer will draw, timing excluded.
8. `packages/visuals/src/libsheet.mts` — the only way to look at a library asset or rig.
9. `packages/render/src/frames.mts <projectDir> <outDir> [seconds…]` — ~76ms a frame.
   **Every defect fixed in the last three sessions was found here, not by reading code.**
   Copy `storyboard.resolved.json` over `storyboard.json` first so it draws real ink.
10. `packages/render/src/fillcheck.mts <storyboard.json>` — mean content fill. A regression
    check, not a target: it counts bounding boxes, so it can be gamed.

Tools 3, 6 and 7 take a stash diff:

    npx tsx <tool> <targets> > /tmp/after.txt
    git stash push -u && git status --short          # confirm the tree is CLEAN
    npx tsx <tool> <targets> > /tmp/before.txt
    git stash pop
    diff /tmp/before.txt /tmp/after.txt

**To test the lesson brief without a render**, call `designLesson` from `@inkcast/pipeline`
(the lesson stage alone, ~$0.06 against ~$0.45). **To test the drawing lane**, call
`drawOne` / `drawLesson` from `@inkcast/planner` on a lesson you already have. Both are
ten-line scripts; hydrate keys with `hydrateEnv()` from `@inkcast/keyvault` the way
`drawcheck.mts` does.

A full keyed render, when you need one:

    node apps/cli/bin/inkcast.mjs cast "How a lithium-ion battery charges" --project try

Drop `--json`; it silences stderr and a clean log then proves nothing.

## Traps

**A keyword table answers "which", never "whether"** — and the deeper version this
architecture is the answer to: _a table of subjects cannot be completed at all._ If you
are adding an entry so one more topic works, you are on the wrong axis.

**Read the frames.** Every defect worth fixing in three sessions was visible in a rendered
frame and invisible in the code.

**A zod tuple breaks the tool schema.** `z.tuple([number, number])` compiles to draft-07
`items: [...]`, which the Messages API rejects as an invalid `input_schema` — every call
400s. `Mark.points` is `number[][]` for that reason; pair-ness is checked in code.

**`elements` sometimes comes back as a JSON string** — twice in eighteen calls, and the
retry does not fix it because the model does not recognise it as an error. It is parsed
rather than rejected.

**A brief belongs inside its own cache key.** `drawKey` hashes `DRAW_BRIEF` itself; a cache
that survived a brief change would serve drawings composed for a canvas that no longer
exists, which is the subtlest possible way to make a fix look like it did nothing.

**`measureText` can only return its own estimate**, and the renderer wraps again against
real font metrics. Any box sized exactly to the estimate will break words mid-syllable.

**Roughjs hachure at dot scale is one line** — filled circles come out as rings, so dots
are drawn small and heavily stroked instead.

**A path with `points` is splined (Catmull-Rom); a path with `d` is verbatim.** An angular
stroke must go in as `d` or its corners round off into a wave.

**`seed: 0` means "no seed" in roughjs** — `baseOptions` nudges it to 1; do not remove.

**`git stash -u` takes untracked measurement tools with it.** Every tool above is committed
for that reason.

**`pnpm -r test | tail` lies.** Redirect and sum with `awk '/# pass [0-9]+$/ {p+=$NF}'` —
note `$NF`, because lines carry a package prefix.

**`pnpm lint` is `prettier --check .`** — a hard gate, `examples/*.lesson.json` and every
`docs/*.md` included.

**Stage versions** are `lesson@8, storyboard@11, voice@5, visuals@7, render@5` in
`packages/pipeline/src/keys.ts`, which explains when to bump and when not to.

**`teach <topic> --lesson <file>` silently ignores the file.** Use `cast`.

## Known defects, ranked by what a viewer notices

1. **Irregular organic anatomy is weak** — the knee joint reads as blobs. Item 1 helps;
   routing likeness to `illustration` may be the real answer.
2. **Long single words still break across lines** on the tightest labels.
3. **A drawing is drawn evenly across its beat**, not cued part by part. Item 2.
4. **No maths notation beyond Unicode.** Item 3.
5. **The board is sparse** — 20% fill against a 48% benchmark. Item 5.
6. **A subject is redrawn per beat** rather than referred to. Item 4.
7. **The recap redraws its picture** in a fresh panel while the original is still up.
8. **No open-weight path for the lesson stage.** The drawing lane is the closest — a text
   model emitting JSON, so a local model could serve it. Untested.
9. **`render/src/sketch.ts` is a second hand** — Mulberry32 against the visuals stage's
   roughjs. Unifying redraws half of every board. `PIPELINE.md` step 10.
10. **The planner and visuals disagree about `doubleWell`** — two catalogues of one curve.
11. **Emphasis lands on a clause, not a word.** **`coreInsight` is read by nothing.**

## Current state

Branch `visuals-morph-density`, working tree clean, six commits ahead of where the session
started. `pnpm lint` clean · `pnpm -r typecheck` 0 errors across 9 projects · `pnpm -r test`
**616 pass / 0 fail**. Both shipped lessons (`examples/lessons/*.lesson.json`) compile
byte-identically at both presets across every change.

## The one thing to hold on to

The pedagogy was never the problem. The routing was fixed. What was left was that we had
exactly two ways to draw — a plot, and whatever an image model returned for a sentence —
and neither could draw two things and the relationship between them. Now the board
composes its own pictures out of eight marks, labels its own parts in its own handwriting,
and every part has a name. **The next win is not a new lane. It is using the names.**
