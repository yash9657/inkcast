# Handoff — 2026-08-05 · the board cannot draw

Session state, not design. `PIPELINE.md` is the durable architecture, `STATUS.md` the
verification record, `docs/research/golpo-ux.md` the competitor teardown. **Read §2 of that
teardown before you plan anything** — two sessions have now re-derived a worse answer than
the one it states plainly.

## The goal, stated once

**A chalkboard-style explanation of any concept, at any level the user asks for, free.**
Bring your own key, and open weights all the way down so someone with no money still gets a
real video. Nothing below changes that.

## The complaint, in the user's words

> Most of what it does is really just write text onto the drawing board, and very little
> drawing is done. Whatever drawing is done is still extremely poor. The concept, the hooks,
> the speech cadence, where to pause, where to create a sort of suspense between cuts is
> extremely important. It is a story that we're trying to tell the user. Whatever Golpo AI
> is doing is not groundbreaking or revolutionary — it should be doable and replicable.

They are right, and the cause is narrower and more embarrassing than it sounds. **It is not
the pedagogy and it is not the sync.** Both are now good. It is that the drawing lane the
model naturally reaches for can draw exactly six shapes, all of them from the gradient
descent lesson.

## Read this first: what is already fixed, so you do not redo it

Seven commits this session, ending `f3f421a`. `pnpm lint` clean · `pnpm -r typecheck` 0
errors across 9 projects · `pnpm -r test` **600 pass / 0 fail**.

- **Vocabulary is written on the board** as the narrator says it (`LessonStep.terms`).
- **The trimmer may not cut the spine.** It had been deleting the middle two links of a
  five-link chain to hit 120s, then rewiring the survivors so the wreckage validated.
  `derivedFrom` is binding now; the standard target is 150s; the model is briefed in words.
- **Sync is solved.** One picture is one gesture, cued to the word that names it.
  `synccheck.mts` on the newest render: **0 strokes in a silence, 0 on the same frame.**
  Do not spend time here — measure before you touch it.
- **Pauses are graduated** by the length of the sentence that ended (five lengths, less
  total silence than the flat 0.24s rule).
- **A paid key is actually used.** ElevenLabs was being ignored; a present key now wins.
- **The macOS keychain save works** (`security` was prompting on a tty and timing out).

## The measurement that matters

`projects/1d80720ea373` — "How a Lithium-Ion Battery Charges and Discharges", 110s, all
three providers live: `anthropic/claude-opus-5`, `elevenlabs`, `fal`. Cost $0.445, of which
**voice was $0.38**.

**The lesson is good.** Read it before you judge anything else —
`projects/1d80720ea373/lesson.json`. The hook is _"A full phone battery and a dead one weigh
exactly the same. Nothing went in. Nothing came out. So what actually changed inside?"_ That
is a real hook. The anchor opens the cell and finds "two flat stacks facing each other, and
between them a damp gap… like a sponge holds water". Ten beats, a clean chain,
`problems: []`.

**Every drawing instruction in it is specific, and almost all of them were thrown away.**
What the lesson asked for, against what reached the board:

    asked for:   5 path · 2 motion · 1 diagram · 1 plot · 1 illustration
    board got:  13 text · 11 path · 1 asset · 1 plot · 1 arrow
    written words on the board: 90   ·   spoken words: 306

The five `path` intents read like this:

    anchor  "Cross-section: a left rectangular stack and a right rectangular stack drawn
             as hatched blocks, with a damp gap between them"
    step2   "The two stacks again, a big plus dot crossing the damp gap freely, and a tiny
             electron blocked at the gap"
    step4   "Same cross-section drawn twice: left stack full and right empty…"

Now read `buildFreeform` in `planner/src/compile.ts` (line ~963). The entire vocabulary of
the `path` lane is six regexes:

    HILL      /hill|hillside|mountain|terrain|slope of|walk(?:ing)? down|foggy|landscape/i
    BOWL      /bowl|valley|u[- ]shape|basin|dip|cross[- ]section/i
    CONTAINER /blob|cloud|container|group|everything inside|circle around/i
    FIGURE    /figure|person|walker|hiker|someone|you (?:are|stand)|standing/i
    FOG       /fog|mist|cloud|cannot see|can't see|blind/i
    STEPS     /steps?|stride|footstep|one step at a time|repeat/i

So: **`cross-section` is in the `BOWL` regex**, and a battery cross-section was drawn as a
parabola. Everything else fell through to the default, which is a hillside. And a **stick
figure is drawn whenever the narration contains the word "you"** —
`if (FIGURE.test(text) || /you\b/i.test(ctx.step.narration))` — which is why
`b8_v0_you_head/spine/legs/arm` appear in the misconception beat of a video about lithium
ions. Eleven of the eleven `path` elements on that board are hills, bowls, fog or a walker.

That is the whole complaint. The board writes text because text is the only lane that
reliably renders what the beat is about; it draws badly because `path` answers every
instruction with terrain.

**And `illustration` — the one lane that can draw anything — ran once.** One image, three
tenths of a cent. The model asked for it for the hook and used `path` for the nine beats of
actual content, which is exactly what the brief invites: it advertises `path` as "freeform
ink with no axes: a hillside, a figure standing on it, fog, three steps down it, a bowl, a
container blob". Those read as examples. They are the complete set.

Two numbers that are better and still not good: mean content fill **31%** (was 17%, the
benchmark is 48%), and `vocabcheck` confirms the terms lane working.

## The work, in order

### 1. Make `path` tell the truth, and route specifics to a lane that can draw them

The cheapest change with the largest effect, and it is a **brief** change plus a **router**
change, not a drawing engine.

- Say in `teachingBrief` exactly what `path` can draw — those six shapes, named — and that
  anything else described as freeform ink will come out as a hillside. Models obey precise
  capability statements and ignore vague ones.
- Route every other concrete drawing to `illustration`, which already exists, already
  prompts for flat line art, already vectorises and roughens, and already caches per
  machine. It cost $0.003 for the one image in this render. Ten images is three cents.
- Then **look at ten generated drawings** before deciding anything else. One image is not a
  measurement, and this lane has never been judged at scale. `assets/illustrations/` in the
  project holds the raster; `libsheet.mts` + `frames.mts` show what the board did with it.

This is precisely what the teardown says the competitor does (§2: generated images under a
style preset, sketch-revealed and narrated). The user is right that it is replicable — we
have the lane and have never used it.

_Done when:_ on this same battery lesson, eight of ten beats carry a drawn object rather
than a hillside, and you have looked at the frames.

### 2. Then decide whether structure needs its own primitives

Some of what this lesson wanted is not a _picture_ of a thing, it is a **diagram of
structure**: two labelled stacks with a gap between them, a wire looping over the top, an
arrow crossing a boundary. A generated image draws that unreliably and cannot animate one
part of it; a composable primitive draws it deterministically and free.

`diagram` today is only node labels in a flow or a stack (`makeDiagram`), which is why the
model reached for `path` instead. A small compositional set — a labelled box, a stack of
layers, a region with contents, a labelled arrow between two named things, a particle that
travels a named path — would cover most process and STEM topics for nothing per render.

Take this **after** step 1, with the generated drawings in front of you, so the decision is
about what the images cannot do rather than a guess. Do not start here: a previous session
concluded a hand-authored drawing language was the whole job, and `golpo-ux.md` §2 is the
correction to that.

### 3. Story, cadence and the space between cuts

The user's other half, and a real gap rather than a defect: nothing in the pipeline thinks
about _suspense_. Concretely available levers, all cheap:

- **The hook already works.** Do not rewrite that part of the brief.
- **A beat that asks a question should hold on a nearly-empty board.** `cadence` gives a
  question `slow_deliberate` and up to 3s of `hold`, but the _next_ beat's picture is drawn
  from the start of its own narration — so the answer often appears before it is spoken. The
  reveal order across a cut is unexamined.
- **Camera transitions are 0.45s inside a region, 0.95s between, 1.3s for the recap**
  (`compile.ts`). Nothing varies them by role. A cut into a misconception should not feel
  like a cut to the next step.
- **The `dominant` clamp fires** whenever the model cues a beat's main picture on a late
  phrase: the voice stage holds it to 15% of the beat so the frame is not empty. Three times
  on the previous render. Either the brief should ask for an opening cue, or the clamp should
  be replaced by drawing the picture in stages.

### 4. The voice cost, which is now the largest line

ElevenLabs charged **$0.3835 for 110 seconds** — $0.21 a minute, on its own past the
`$0.20/min` target the README still quotes. `eleven_flash_v2_5` is roughly half the price of
`eleven_multilingual_v2` at very similar quality for narration; the model id is a constant in
`voice/src/providers/elevenlabs.ts`. Decide deliberately: cheaper model, restate the target,
or use the paid voice only on a final render.

Also an honest-reporting bug: `pipeline.json` records `elevenlabs/af_heart` — the _requested_
id, not the stock voice the adapter resolved it to. Report what was used.

## How to verify a change cheaply

Nine tools, cheapest first. **Use the first one that can see your change.**

1. **`packages/pipeline/src/vocabcheck.mts`** — terms spoken vs written. Takes a storyboard,
   a lesson, or a raw document (which it compiles with no key).
2. **`packages/pipeline/src/synccheck.mts <projectDir>`** — every element against the word
   being spoken as it appears; counts strokes landing in a silence or on the same frame.
   Needs a project the voice stage has run over.
3. **`packages/pipeline/src/sbhash.mts <lesson…>`** — storyboard hash, both presets. The only
   tool that sees a planner change on the shipped lessons.
4. **`packages/pipeline/src/sbjson.mts <doc|lesson> <outDir>`** — a `storyboard.json` from
   anything, with no key, so the pixel-side tools below can be pointed at it.
5. **`packages/visuals/src/geomhash.mts`** — what the visuals stage resolves.
6. **`packages/render/src/planhash.mts`** — what the renderer will draw, timing excluded.
7. **`packages/visuals/src/libsheet.mts`** — the only way to look at a library asset or rig.
8. **`packages/render/src/frames.mts <projectDir> <outDir> [seconds…]`** — ~76ms a frame.
   Needs `assets/visuals.json` to exist or it draws labelled placeholders.
9. **`packages/render/src/fillcheck.mts <storyboard.json>`** — mean content fill. A
   regression check, not a target: it counts bounding boxes, so it can be gamed.

Tools 3, 5 and 6 take a stash diff:

    npx tsx <tool> <targets> > /tmp/after.txt
    git stash push -u && git status --short          # confirm the tree is CLEAN
    npx tsx <tool> <targets> > /tmp/before.txt
    git stash pop
    diff /tmp/before.txt /tmp/after.txt

A full keyed render, when you need one:

    node apps/cli/bin/inkcast.mjs cast "How a lithium-ion battery charges" --project try

Drop `--json`; it silences stderr and a clean log then proves nothing.

## Traps

**This repo is `inkcast`, at `~/code/inkcast`.** Sessions have been launched in the sibling
`finito` checkout. No remote — `git log` tells you where you are.

**Read `docs/research/` before designing anything.** Two sessions have now paid for skipping
§2 of the competitor teardown.

**A keyword table answers "which", never "whether".** `cross-section` selecting a parabola is
this trap in its purest form, and it is the same shape as `cycle` selecting a sine wave
(fixed in `06d2ddd`). `worthPlotting` in `plots.ts` is the pattern for separating the two
questions.

**The brief's examples are read as examples.** Anywhere it lists what a lane can do, it must
say whether the list is exhaustive. `path` says "a hillside, a figure, fog, steps, a bowl, a
blob" and that is not an illustrative sample, it is the whole implementation.

**A lane the brief does not name will not be used.** `illustration` was absent from the brief
for the whole project's life, so a configured image key drew nothing on any topic (fixed in
`f3f421a`, and `opts.illustrations` gates it on a provider existing).

**`git stash -u` takes your untracked measurement tool with it.** Every tool above is
committed for that reason. Use a path-limited `git stash push <file>…` to measure a before.

**A stage that starts reading another stage's output has gained a cache input.** See
`renderFingerprint` folding in `visualsFingerprint`.

**Words-per-minute read off a whole scene is not the speech rate** — `narrationSec` includes
the sentence gaps. `DELIVERED_WPS` (2.2) is the measured figure the estimator uses; the
teaching band (140–160 wpm) is about the rate inside a phrase.

**`pnpm -r test | tail` lies.** Redirect and sum with `awk '/# pass [0-9]+$/ {p+=$NF}'` —
note `$NF`, because lines carry a package prefix. Eight test-bearing packages.

**`pnpm lint` is `prettier --check .`** — a hard gate, `examples/*.lesson.json` included.

**Stage versions** are `lesson@6, storyboard@9, voice@5, visuals@7, render@5` in
`packages/pipeline/src/keys.ts`, which explains when to bump and when not to.

**`teach <topic> --lesson <file>` silently ignores the file.** Use `cast`.

**`seed: 0` means "no seed" in roughjs** — `baseOptions` nudges it to 1; do not remove.

## Known defects, ranked by what a viewer notices

1. **`path` draws terrain for everything.** Item 1. Eleven of eleven path elements on the
   newest render are hills, bowls, fog or a walker, in a video about batteries.
2. **A stick figure appears whenever the narration says "you".** `compile.ts` line ~1038.
3. **The board is mostly text.** 13 text elements against 3 real drawings; 90 written words.
4. **The recap redraws its picture** in a fresh panel — twelve strokes on the previous render
   — while the original is still on the board. `findReuse` only lets a hook or anchor beat
   annotate an existing drawing. Fixing it helps density _and_ the sense of a summary.
5. **A single small drawing leaves the frame sparse.** 31% fill against 48%. Two honest
   fixes, both changing every board: a two-column cell (words beside the drawing), or framing
   the ink rather than the cell — the second argues with a deliberate decision in
   `regions.ts` that one cell is the tightest shot there is.
6. **No open-weight path for the lesson or the image stage.** The premise of the project. An
   OpenAI-compatible endpoint (Ollama/vLLM/LM Studio) behind `lesson-anthropic.ts`'s forced
   tool call, and a local diffusion path behind `detectImageProvider()`.
7. **`render/src/sketch.ts` is a second hand.** Mulberry32 against the visuals stage's
   roughjs for path/shape/arrow/diagram/emphasis/text; those SVGs are written and never read.
   Unifying redraws half of every board — a visual decision. `PIPELINE.md` step 10.
8. **The planner and visuals disagree about `doubleWell`** — two catalogues of one curve.
9. **The lucide lane is confidently wrong for an unmatched subject** —
   `odysseus-tied-the-mast` matches `presentation`.
10. **Emphasis lands on a clause, not a word.** The clip is assembled per clause.
11. **`coreInsight` is validated and read by nothing.** No multi-line equations.

## The one thing to hold on to

The pedagogy stage is not the problem and has not been for two sessions. Claude wrote _"A
full phone battery and a dead one weigh exactly the same"_ and asked for a hatched
cross-section of two electrode stacks with a damp gap between them. Everything after that
sentence is our failure to draw it. **Fix the drawing, not the writing.**
