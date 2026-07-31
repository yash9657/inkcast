# Handoff — 2026-07-31 (later) · close the gap: chalkboard explanations of anything, free

Session state, not design. `PIPELINE.md` is the durable architecture, `STATUS.md` the
verification record, `docs/research/golpo-ux.md` the competitor teardown. **Read that
teardown before you plan anything** — a previous session did not, and re-derived a worse
answer over several hours.

## The goal, stated once

**A chalkboard-style explanation of any concept, at any level the user asks for, free.**

Free means two things and both are load-bearing:

- **Bring your own key.** No paywall, no hosted tier, no credits. The user's own
  Anthropic / Replicate / ElevenLabs keys, spent at cost.
- **Open weights all the way down.** Someone with no keys and no money must be able to
  run the whole thing locally and get a real video — not a degraded fixture. Knowledge
  should not be gated. This is the premise the competitor cannot match and **it is still
  the part we have not built** (item 2).

## Where things stand

Branch **`visuals-morph-density`**, twenty-four commits on top of `e95258b`, no remote.
`pnpm lint` clean · `pnpm -r typecheck` 0 errors across 9 projects · `pnpm -r test`
**595 pass / 0 fail** across eight test-bearing packages.

The engine is in good shape and is not the problem. Pipeline, caching, word-exact cue
alignment, the accumulating board and camera, morphing, typeset equations, the pinned
asset library, character rigs, cadence-driven pacing — all real, all verified, all
documented in `STATUS.md`'s seven appendices.

**This session closed the biggest gap between the board and the narration.** The board
used to write nothing the narrator said: its only words were each beat's `idea`. Measured
on `examples/photosynthesis.md`, with tools that are now committed:

    npx tsx packages/pipeline/src/vocabcheck.mts examples/photosynthesis.md
    before   3 of 22 spoken terms on the board (0 of 3 initialisms)   70 words drawn
    after   15 of 22                           (3 of 3)              100 words drawn

    npx tsx packages/pipeline/src/vocabcheck.mts examples/lessons/longitude.lesson.json
    before   4 of 19 (0 of 6 names)   after  10 of 19 (6 of 6)

Three commits, each with its reasoning in the message:

- **`f6892a1` Write the word as you say it.** `LessonStep.terms` — the vocabulary a beat
  introduces, verbatim from its narration, written along the foot of that beat's cell and
  cued to the spoken word. One shared, form-based definition of what counts as a term
  (`packages/core/src/terms.ts`). A spoken initialism or name that no beat writes is now
  a critique failure.
- **`e79042d` One cell, one caption.** Three cells said "The one-line version" because
  every beat of a section reached for its heading. The heading is a preference now, and a
  repeated `idea` is a critique failure.
- **`06d2ddd` A plot belongs where there is a quantity.** "The Calvin cycle" was drawn as
  a sine wave, because `cycle` selected the wave recipe. The keyword tables answer _which_
  plot and were being asked _whether_ a plot; `worthPlotting` and `describesAPlot` ask
  the second question, on both sides of the compiler seam.

`gradient-descent` compiles byte-identically across all three, at both presets. That is
the shape of the work: it costs nothing where there is nothing to write.

## What is left, in order of leverage

### 1. Turn the illustration lane on and judge it — needs a key

`REPLICATE_API_TOKEN` or `FAL_KEY`. Render `examples/photosynthesis.md` end to end and
look at it. Nothing else on this list should be designed before that measurement exists.

The audit (`golpo-ux.md` §2) records the competitor's whole answer to "draw any topic":
**generated images under a style preset**, sketch-revealed and narrated. There is no
hand-authored drawing language behind it. **We already built that lane** —
`packages/visuals/src/image.ts`: text-to-image → vectorise → roughen, flux-schnell via
Replicate or fal, prompting for flat line art rather than photorealism (a photoreal
render vectorises into colour noise; flat strokes vectorise into a few dozen outlines that
roughen into something that belongs on a board), cached three deep including machine-wide.
**It has never run.** There is no key on this machine.

Expect to tune `illustrationPrompt` for the chalkboard register. The audit's style-preset
list is the vocabulary worth copying (`chalkboard_white`, `technical`, `editorial`), and
`StoryboardMeta.style` already has `marker | pencil | chalk | ink` to hang it on.

_Done when:_ "a chloroplast with thylakoid membranes" draws a chloroplast.

### 2. Open weights, end to end — the premise, and entirely unbuilt

`inkcast providers` today: the lesson stage is Anthropic or a structural heuristic; the
image stage is Replicate, fal, or lucide icons. **There is no open-weight path for
either.** Someone with no money gets the degraded fixture, which contradicts the reason
this project exists.

Two adapters, both well-trodden:

- **Lesson author:** an OpenAI-compatible endpoint (Ollama, llama.cpp, vLLM, LM Studio)
  so Qwen/Llama/Mistral can write the lesson. `lesson-anthropic.ts` already forces a tool
  call against the zod-derived JSON schema; the same schema drives any function-calling
  model. Gate on `INKCAST_LLM_BASE_URL`, keep Anthropic the default when its key is
  present.
- **Image:** a local diffusion path (ComfyUI, or diffusers/ONNX SDXL-Turbo) behind the
  `ImageProvider` seam `image.ts` already defines. `detectImageProvider()` is the one
  place to extend.

_Done when:_ `inkcast providers` shows a fully local, fully open-weight column, and a
render with **no keys of any kind** produces a real illustrated video rather than a
lettered card.

### 3. Density — a visual decision, so take it with frames

**Frame fill 17.1% on the photosynthesis document against 47.6% on `final-169`**,
reproducible in two committed commands:

    npx tsx packages/pipeline/src/sbjson.mts examples/photosynthesis.md /tmp/photo
    npx tsx packages/render/src/fillcheck.mts /tmp/photo/storyboard.json

The cause is not a constant: a beat whose only figure is one square asset, centred in a
frame-shaped cell under a centred caption, leaves the sides empty at any size. Two honest
fixes, both of which change every board:

- **A two-column cell** — words beside the drawing rather than above it. Contained in
  `buildBeat`, and the layout invariants in `compile.test.ts` will hold you to it.
- **Framing the ink rather than the cell.** `cameraFor` unions _cells_; the fill metric
  is the union of _element boxes_. But `regions.ts` deliberately makes one cell the
  tightest shot there is, and `planBoard` runs before any element exists — so this is an
  inversion, not a tweak.

And a trap: `contentFill` counts bounding boxes, so inflating an element's box raises the
number without enlarging the picture. Do not optimise it directly.

## What is done, and where the reasoning lives

Steps 1, 2, 3, 4, 6, 7, 5b and 11 are ✅ in `PIPELINE.md`; step 5 is 🟡 (composed rigs
ship, generated poses need a provider); root cause 1 is 🟡 (`render/src/sketch.ts` is
still a second hand — `PIPELINE.md` step 10 states the options and what each costs).
Every commit message carries its own reasoning and is worth reading before its diff.

## How to verify a change cheaply

Eight tools, cheapest first. **Use the first one that can see your change.** They chain:
lesson → storyboard → visuals geometry → render plan → pixels.

**1. Vocabulary** — `packages/pipeline/src/vocabcheck.mts`. Sub-second. Takes a
`storyboard.json`, a `lesson.json`, or a raw document (which it compiles through the
no-key authors). Reports every term spoken and whether anything writes it. Read it as a
floor, not a target: the term detector is loose on its third rule by design, so what
matters is the ratio and the specific words in the `UNWRITTEN` column.

**2. Storyboard hashing** — `packages/pipeline/src/sbhash.mts`. Sub-second. The only tool
that sees a planner change on the shipped lessons.

**3. A storyboard from any document** — `packages/pipeline/src/sbjson.mts <doc> <outDir>`.
Writes `storyboard.json` with no key, so the pixel-side tools below can be pointed at
something other than a shipped lesson.

**4. Per-element geometry** — `packages/visuals/src/geomhash.mts`. Seconds. What the
visuals stage resolves. `projects/handwritten` is the control with asset elements;
`projects/final-169` is the benchmark with 8 plots and zero assets.

**5. Render-plan hashing** — `packages/render/src/planhash.mts`. What the renderer will
actually draw, timing excluded. The proof that a refactor changed nothing. A bare name
resolves under `projects/`; a path lets you measure a scratch copy.

Tools 2, 4 and 5 take a stash diff:

    npx tsx <tool> <targets> > /tmp/after.txt
    git stash push -u && git status --short          # confirm the tree is CLEAN
    npx tsx <tool> <targets> > /tmp/before.txt
    git stash pop
    diff /tmp/before.txt /tmp/after.txt

**6. Contact sheet** — `packages/visuals/src/libsheet.mts`, then `frames.mts` over it.
The only way to look at a library asset or a rig's poses.

**7. Frame grabs** — `packages/render/src/frames.mts <projectDir> <outDir> [seconds...]`.
~76 ms each. Needs the visuals stage to have run: plot geometry is no longer derivable by
the renderer, so a project without `assets/visuals.json` draws labelled placeholder
frames. That is correct degradation, not a bug. Write the storyboard **`resolveVisuals`
returned**, not the one you compiled — it returns a clone.

**8. A full render** —

    INKCAST_PROJECTS=/tmp/verify node apps/cli/bin/inkcast.mjs \
      cast examples/lessons/gradient-descent.lesson.json --project bench --force

Drop `--json`; it silences stderr completely and a clean log then proves nothing. Stage
timings from a loaded machine are worthless — the same render measured 62.5 s of voice
idle and 275.7 s under load. `fillcheck.mts <project>/storyboard.json` gives the
content-fill number in a second.

## Traps

**This repo is `inkcast`, at `~/code/inkcast`.** Three sessions have been launched in the
sibling `finito` checkout. No git remote — check `git log` to confirm where you are.

**Read `docs/research/` before designing anything.** The competitor teardown and the
verified library APIs are both there. A session already burned hours re-deriving a worse
version of what §2 of the teardown states plainly.

**`git stash -u` takes your untracked measurement tool with it.** This has cost one
measurement. Every tool above is committed for exactly that reason; commit a new one
before you rely on it. A path-limited `git stash push <file>...` is the way to measure a
"before" without stashing the tool.

**A stage that starts reading another stage's output has gained a cache input.**
`renderFingerprint` hashed only the storyboard until the renderer began reading
`visuals.json`; `visualsFingerprint` is folded in now. Ask what the key must carry.

**A constant that is only ever one value hides every bug in the code that reads it.** The
`silence` provider applied the speech rate twice, invisibly, until per-scene cadence made
the rate vary.

**A keyword table answers "which", never "whether".** `cycle` selected a sine wave for the
Calvin cycle, and a lone `supply` offered a demand curve for "an energy supply". Both were
one table being asked a question it cannot answer. `worthPlotting` in `plots.ts` is the
separate question, and it is a **veto**: the shape table still has to match, so the gate
can only take a plot away, never add one.

**Anything the board writes has to be findable in the narration.** `terms`, `emphasis` and
`cue` are all located by searching the text, so all three are verbatim or they are silent
no-ops. `resolveTerms`/`resolveEmphasis` report what they cannot find, and critique fails
on it.

**Words-per-minute read off a whole scene is not the speech rate** — `durationSec`
includes clause gaps. To measure delivery, synthesise identical words at two cadences.

**`pnpm -r test | tail` lies.** Redirect to a file and sum with
`awk '/# pass [0-9]+$/ {p+=$NF}'` — note `$NF`, because lines carry a package prefix.
Eight test-bearing packages (`core` has none).

**`pnpm lint` is `prettier --check .`** — a hard gate, including hand-edited
`examples/*.lesson.json`.

**Judge quality from a keyed render, not the default.** Both shipped lessons are
hand-authored; nothing here has ever measured a model-authored lesson. The teaching brief
now teaches the vocabulary idiom and the caption rule, and that is untested.

**Stage versions** are `storyboard@7, lesson@4, visuals@7, voice@3, render@5` in
`packages/pipeline/src/keys.ts`, which explains when to bump and when not to.

**`teach <topic> --lesson <file>` silently ignores the file.** Use `cast`.

**`seed: 0` means "no seed" in roughjs** — `baseOptions` nudges it to 1; do not remove.

## Known defects

**`illustration` needs a key for anything that is not a person.** Items 1 and 2, and the
biggest visible gap now that the board writes its vocabulary.

**A single-figure beat fills about a fifth of the frame.** 17.1% against 47.6%. Item 3.

**`render/src/sketch.ts` is a second hand.** Mulberry32 against the visuals stage's
roughjs for path/shape/arrow/diagram/emphasis/text; those SVGs are written and never
read. Unifying redraws about half of every board, so it is a visual decision, not a
refactor. `PIPELINE.md` step 10.

**The planner and visuals disagree about `doubleWell`.** Two catalogues of the same
curve; the drawn curve and the simulated descent can disagree enough to put the step dots
off the curve. `planner/src/curves.ts` vs `visuals/src/plot.ts`.

**The lucide lane is confidently wrong for an unmatched subject.**
`odysseus-tied-the-mast` matches `presentation`. Better than the `rocket` it drew before —
the id and prompt now survive, so item 1 fixes it properly — but still a wrong drawing.

**The derived author's third-best term is filler.** `findTerms` will offer "Chemists" or
"ingredients" when a beat has nothing better, because a long content word is the only
recall rule available without a word-frequency corpus. The cap and the ranking keep them
off the board wherever anything better exists, and the gate only requires initialisms and
names. A keyed lesson names its own vocabulary.

**An author's `hold` is a request.** `cadence` clamps it: 0.8 / 1.6 / 3.0s for punchy /
building_energy / slow_deliberate. Deliberate, and surprising when you set one.

**Emphasis lands on a clause, not a word.** The clip is assembled per clause. Word-level
stress needs the aligner's output fed back into synthesis.

**Open elsewhere:** no multi-line equations; `coreInsight` is validated and read by
nothing; the `$0.20/min` target predates keyed operation being the product.
