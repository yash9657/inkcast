# Handoff — 2026-07-31 · close the gap: chalkboard explanations of anything, free

Session state, not design. `PIPELINE.md` is the durable architecture, `STATUS.md` the
verification record, `docs/research/golpo-ux.md` the competitor teardown. **Read that
teardown before you plan anything** — the previous session did not, and re-derived a
worse answer over several hours.

## The goal, stated once

**A chalkboard-style explanation of any concept, at any level the user asks for, free.**

Free means two things and both are load-bearing:

- **Bring your own key.** No paywall, no hosted tier, no credits. The user's own
  Anthropic / Replicate / ElevenLabs keys, spent at cost.
- **Open weights all the way down.** Someone with no keys and no money must be able to
  run the whole thing locally and get a real video — not a degraded fixture. Knowledge
  should not be gated. This is the premise the competitor cannot match and **it is the
  part we have not built** (see item 3).

## Where things stand

Branch **`visuals-morph-density`**, sixteen commits on top of `e95258b`, no remote.
`pnpm lint` clean · `pnpm -r typecheck` 0 errors across 9 projects · `pnpm -r test`
**586 pass / 0 fail** across eight test-bearing packages.

The engine is in good shape and is not the problem. Pipeline, caching, word-exact cue
alignment, the accumulating board and camera, morphing, typeset equations, the pinned
asset library, character rigs, cadence-driven pacing — all real, all verified, all
documented in `STATUS.md`'s six appendices.

**What it cannot do is explain anything that is not gradient descent.** Measured, on a
real photosynthesis document, rendered end to end:

- 11 of 14 technical terms are **spoken and never written on the board** — ATP, NADPH
  and G3P three times each, plus chlorophyll, thylakoid, chloroplast, rubisco, glucose,
  enzyme, membrane, carbon dioxide. 203 words spoken, 51 drawn, and those 51 are beat
  headings — three of them the identical string "The Calvin cycle".
- "The Calvin cycle" is drawn as a **sine wave of value against time**, because the word
  _cycle_ matched a plot recipe. That is not vague, it is false.
- "The light stage" is a stack-of-plates icon. Mean frame fill **31%**.
- Three unrelated topics (photosynthesis, the French Revolution, mRNA vaccines) compile
  to identical structure: 4 text, 3 asset, 1 diagram, zero curves. `critiqueLesson`
  passes all three with **zero problems** — the quality gate cannot see any of this.

## The correction that matters

The previous session concluded that the drawing vocabulary had to be designed from
scratch and called it "larger than everything done in three sessions combined."

**That was wrong, and the audit already said so.** `docs/research/golpo-ux.md` §2 records
the competitor's actual answer to "draw any topic": **generated images under a style
preset** — their _Canvas_ line ships `chalkboard_white`, `whiteboard`, `marker`,
`technical`, `editorial`, `neon`, `playful`, `modern_minimal` — sketch-revealed and
narrated. There is no hand-authored drawing language behind it. It is text-to-image with
a chalkboard prompt.

**We already built that lane.** `packages/visuals/src/image.ts`: text-to-image →
vectorise → roughen, flux-schnell via Replicate or fal, request shapes verified against
the live provider schemas. It prompts for **flat line art rather than photorealism** —
because a photoreal render vectorises into colour noise while flat strokes vectorise into
a few dozen outlines that roughen into something that belongs on a board. It caches the
raster three deep, including **machine-wide**, so "the rover" is the same rover in every
video you ever make.

It has **never run**. There is no key on this machine. That is the entire distance
between the current output and the competitor's.

And on the three things the audit lists as their standing defects (§5.1–5.3, §5.8) we are
already structurally ahead: our board never wipes (`Storyboard.canvas` + `persist`),
entities are resolved once and reused by id with a locked seed (their character
consistency is still "(Beta)" on the $999.99/mo tier), and `Enter.style: 'write'` is a
real per-stroke reveal rather than an outline trace.

So the gap is **four concrete pieces**, not a research project.

## The plan

### 1. Write what you say — no key, biggest single win

The narration says "ATP" and nothing on the board ever says ATP. A chalkboard explainer
writes the term as it says it; that is the whole idiom, and we do not do it once.

**The machinery already exists and already works.** `Enter.cue` resolves a phrase to a
real timestamp, word-exactly (39 of 39 elements on the last verification). It is used to
_time pictures_ and never to _write vocabulary_.

_What to build:_ the lesson stage names the terms a beat introduces; the compiler emits a
text element per term, cued to the word; the board writes it as it is spoken. Captions
today come from `step.idea` (`captionFor` in `planner/src/compile.ts`) — that is why the
board shows headings instead of content.

_Done when:_ on the photosynthesis render, every technical term spoken appears on the
board within a second of being said. The probe that produced the 11-of-14 number is four
lines over `storyboard.json`; rerun it and it should read 14 of 14.

### 2. Turn the illustration lane on and judge it — needs a key

`REPLICATE_API_TOKEN` or `FAL_KEY`. Then render the same photosynthesis document and
compare against `/tmp/photo-frames`. This is the fastest way to learn whether the drawing
problem is solved or merely improved, and **nothing should be designed before that
measurement exists**.

Expect to tune `illustrationPrompt` for the chalkboard register specifically — the
audit's §2 style-preset list is the vocabulary worth copying (`chalkboard_white`,
`technical`, `editorial`), and `StoryboardMeta.style` already has
`marker | pencil | chalk | ink` to hang it on.

_Done when:_ "a chloroplast with thylakoid membranes" draws a chloroplast.

### 3. Open weights, end to end — the premise, and entirely unbuilt

`inkcast providers` today: the lesson stage is Anthropic or a structural heuristic. The
image stage is Replicate, fal, or lucide icons. **There is no open-weight path for
either.** Someone with no money gets the degraded fixture, which contradicts the reason
this project exists.

Two adapters, both well-trodden:

- **Lesson author:** an OpenAI-compatible endpoint (Ollama, llama.cpp, vLLM, LM Studio)
  so Qwen/Llama/Mistral can write the lesson. `lesson-anthropic.ts` already forces a
  tool call against the zod-derived JSON schema; the same schema drives any
  function-calling model. Gate on `INKCAST_LLM_BASE_URL`, keep Anthropic the default
  when its key is present.
- **Image:** a local diffusion path (ComfyUI, or diffusers/ONNX SDXL-Turbo) behind the
  `ImageProvider` seam `image.ts` already defines. `detectImageProvider()` is the one
  place to extend.

_Done when:_ `inkcast providers` shows a fully local, fully open-weight column, and a
render with **no keys of any kind** produces a real illustrated video rather than a
lettered card.

### 4. Density and the recipe trap — no key

- **Frame fill 31% on photosynthesis against 52% on the benchmark.** One figure per beat
  in its own cell, so the camera holds whitespace. `planBoard`/`groupIntoRegions` in
  `planner/src/regions.ts` decide which beats share a region.
- **Keyword recipes fire on topic words.** _cycle_ → sine wave is the live example.
  `PLOT_SHAPES` in `lesson-derive.ts` and `recipeFor` in `plots.ts` match on words with
  no notion of whether a plot is appropriate at all. A plot belongs where there is a
  quantity and an axis, not where a word matched.

## What is done, and where the reasoning lives

Steps 1, 2, 3, 4, 6, 7 and 5b are ✅ in `PIPELINE.md`; step 5 is 🟡 (composed rigs ship,
generated poses need a provider); root cause 1 is 🟡 (plots and equations read from the
sidecar; `render/src/sketch.ts` is still a second hand — `PIPELINE.md` step 10 states the
options and what each costs). Every commit message carries its own reasoning and is worth
reading before its diff.

Recent, in order: the asset router (`f392e11`), cadence-driven pacing (`bb3c695`), the
camera moving to core (`0ea3128`), initialisms spoken as letters (`6b46e14`).

## How to verify a change cheaply

Six tools, cheapest first. **Use the first one that can see your change.** They chain:
storyboard → visuals geometry → render plan → pixels.

**1. Storyboard hashing** — `packages/pipeline/src/sbhash.mts`. Sub-second. The only tool
that sees a planner change.

**2. Per-element geometry** — `packages/visuals/src/geomhash.mts`. Seconds. What the
visuals stage resolves. `projects/handwritten` is the control with asset elements;
`projects/final-169` is the benchmark with 8 plots and zero assets.

**3. Render-plan hashing** — `packages/render/src/planhash.mts`. What the renderer will
actually draw, timing excluded. The proof that a refactor changed nothing. A bare name
resolves under `projects/`; a path lets you measure a scratch copy.

All three take a stash diff:

    npx tsx <tool> <targets> > /tmp/after.txt
    git stash push -u && git status --short          # confirm the tree is CLEAN
    npx tsx <tool> <targets> > /tmp/before.txt
    git stash pop
    diff /tmp/before.txt /tmp/after.txt

**4. Contact sheet** — `packages/visuals/src/libsheet.mts`, then `frames.mts` over it.
The only way to look at a library asset or a rig's poses.

**5. Frame grabs** — `packages/render/src/frames.mts <projectDir> <outDir> [seconds...]`.
~76 ms each. Needs the visuals stage to have run: plot geometry is no longer derivable by
the renderer, so a project without `assets/visuals.json` draws labelled placeholder
frames. That is correct degradation, not a bug. Write the storyboard **`resolveVisuals`
returned**, not the one you compiled — it returns a clone.

**6. A full render** —

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
measurement. `sbhash`, `geomhash`, `planhash`, `libsheet` and `frames` are committed for
exactly that reason; commit a new one before you rely on it.

**A stage that starts reading another stage's output has gained a cache input.**
`renderFingerprint` hashed only the storyboard until the renderer began reading
`visuals.json`; `visualsFingerprint` is folded in now. Ask what the key must carry.

**A constant that is only ever one value hides every bug in the code that reads it.** The
`silence` provider applied the speech rate twice, invisibly, until per-scene cadence made
the rate vary.

**Words-per-minute read off a whole scene is not the speech rate** — `durationSec`
includes clause gaps. To measure delivery, synthesise identical words at two cadences.

**`pnpm -r test | tail` lies.** Redirect to a file and sum with
`awk '/# pass [0-9]+$/ {p+=$NF}'` — note `$NF`, because lines carry a package prefix.
Eight test-bearing packages (`core` has none).

**`pnpm lint` is `prettier --check .`** — a hard gate, including hand-edited
`examples/*.lesson.json`.

**Judge quality from a keyed render, not the default.** Both shipped lessons are
hand-authored; nothing here has ever measured a model-authored lesson.

**Stage versions** are `storyboard@5, visuals@7, voice@3, render@5` in
`packages/pipeline/src/keys.ts`, which explains when to bump and when not to.

**`teach <topic> --lesson <file>` silently ignores the file.** Use `cast`.

**`seed: 0` means "no seed" in roughjs** — `baseOptions` nudges it to 1; do not remove.

## Known defects

**Nothing writes on the board what the narrator says.** Item 1. The measurement is in
"Where things stand".

**Keyword recipes fire on topic words.** _cycle_ → sine wave. Item 4.

**A single-figure beat fills about a quarter of the frame.** 31% against 52%. Item 4.

**`render/src/sketch.ts` is a second hand.** Mulberry32 against the visuals stage's
roughjs for path/shape/arrow/diagram/emphasis/text; those SVGs are written and never
read. Unifying redraws about half of every board, so it is a visual decision, not a
refactor. `PIPELINE.md` step 10.

**The planner and visuals disagree about `doubleWell`.** Two catalogues of the same
curve; the drawn curve and the simulated descent can disagree enough to put the step dots
off the curve. `planner/src/curves.ts` vs `visuals/src/plot.ts`.

**The lucide lane is confidently wrong for an unmatched subject.**
`odysseus-tied-the-mast` matches `presentation`. Better than the `rocket` it drew before —
the id and prompt now survive, so item 2 fixes it properly — but still a wrong drawing.

**An author's `hold` is a request.** `cadence` clamps it: 0.8 / 1.6 / 3.0s for punchy /
building_energy / slow_deliberate. Deliberate, and surprising when you set one.

**Emphasis lands on a clause, not a word.** The clip is assembled per clause. Word-level
stress needs the aligner's output fed back into synthesis.

**`illustration` needs a key for anything that is not a person.** Items 2 and 3.

**Open elsewhere:** no multi-line equations; `coreInsight` is validated and read by
nothing; the `$0.20/min` target predates keyed operation being the product.
