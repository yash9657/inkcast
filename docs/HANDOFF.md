# Handoff — 2026-08-05 (later) · the lanes are honest, the pictures are not structural

Session state, not design. `PIPELINE.md` is the durable architecture, `STATUS.md` the
verification record, `docs/research/golpo-ux.md` the competitor teardown. **Read §2 of that
teardown before you plan anything.**

## The goal, stated once

**A chalkboard-style explanation of any concept, at any level the user asks for, free.**
Bring your own key, and open weights all the way down so someone with no money still gets a
real video. Nothing below changes that.

## Where the last session left it, and what changed

The complaint was that the board writes text and draws badly. The cause was that
`buildFreeform` answered every instruction it did not recognise with a hillside, and the
brief advertised that lane's six shapes as if they were examples. **Both are fixed** —
three commits, `f41c726`, `c8d0c15`, `6af3981`. `pnpm lint` clean · `pnpm -r typecheck` 0
errors across 9 projects · `pnpm -r test` **606 pass / 0 fail**.

- `drawsAsFreeform` asks _whether_ the path lane can draw an instruction; `PART` still
  asks _which_ of six shapes. Anything else goes to `buildFallback` — a diagram when it
  names short parts in a flow, an illustration otherwise.
- The brief says `path` draws **exactly six things** and names them, and says
  `illustration` is the normal choice for any concrete object, place, person or structure.
- No stick figure from the word "you"; no hillside dragged in under a lone figure; a
  `motion` intent with no plot to ride now draws the scene it moves through.
- `steep` no longer selects the tangent recipe, and an axis the instruction states
  outright ("a plot of **charge remaining** against **time**") beats both keyword tables.
- `drawcheck.mts` runs the visuals stage alone with keys, so a generated drawing can be
  looked at for $0.003 instead of a $0.45 render.

**Both shipped lessons compile byte-identically across all of it** (`sbhash`, both
presets). The change is only visible where the old code was inventing.

## The measurement that matters now

I paid for one lesson-stage round trip on the same topic as the last render
(`projects/3872fbc14e6f`, $0.06, no voice, no render — see "how to verify" below). **This
is the test of the brief**, and it passed:

    asked for, before:  5 path · 2 motion · 1 diagram · 1 plot · 1 illustration
    asked for, now:     6 illustration · 3 diagram · 1 text · ZERO path

    board, before:  1 asset · 11 path · 13 text   (11 hills, bowls, fog, a walker)
    board, now:     6 asset ·  3 diagram · 13 text
    board, on the OLD lesson recompiled:  9 asset · 2 path · 12 text

Not one compiler warning: every intent went to the lane the author asked for.

**Then I generated all six drawings and looked at them, and that is where the good news
stops.** Fourteen images now exist across the two lessons. Roughly a third are good, a
third are generic, a third are wrong — and the split is not random:

- **Objects come back well.** Two battery cells, one with a level line. Two hatched
  electrode stacks with a damp gap between them — the exact picture the old lane drew as a
  parabola. A wire looping through a bulb between two stacks.
- **Structure and relation come back wrong.** "Two parallel sheets with a gap; circles with
  plus marks crossing freely while plain dots stop dead at the edge" came back as **two
  empty rectangles with a couple of x's floating in them**. "A nucleus with two dots close
  in and one lone dot far out" is a circle with two dots in it. The _relationship_ — which
  is the entire idea of the beat — does not survive.
- **Two rules already went into the brief from the first eight images**, and both worked:
  the new drawings carry no invented lettering (the old ones had `+e> --` and two labels
  both reading "full"), because the brief now forbids asking for a word inside a picture,
  and no drawing tries to show a before and an after at once.

## The work, in order

### 1. Structure needs its own primitives. Start here.

This is the old handoff's item 2, and the evidence it asked for is now in front of you.
A generated image draws _a thing_. It cannot draw _these two things, in this relation_,
and it cannot animate one part of what it drew. That is most of a STEM or process lesson.

Two facts point the same way. The images fail exactly on relation. And **the model, told
that `path` cannot draw a circuit, now asks for a `diagram`** — three of ten beats, e.g.
`right sheet → wire out the top → phone → wire back in → left sheet`. Our diagram lane
(`makeDiagram`) draws labelled boxes joined by arrows, so those three beats put _more words_
on the board. Four of ten beats on the new lesson have no drawing at all.

A small compositional set would cover them, deterministically and for nothing per render:
a labelled box, a stack of layers, a region with contents, a labelled arrow between two
named things, a particle that travels a named path. `plots.ts` is the model for how to
build a lane that derives real geometry from an instruction's own numbers and words.

_Done when:_ on `projects/3872fbc14e6f/lesson.json`, the three `diagram` beats draw a
circuit rather than three captions in boxes, and `fillcheck` is up rather than down.

### 2. One entity, one drawing, forever

The battery lesson mints **five separate drawings of the same two stacks**, one per beat,
each generated independently and each different. That is the competitor's own admitted
defect (`golpo-ux.md` §5.2, still "(Beta)" on their $999/mo tier) and our structural answer
to it already exists — `assets[]` keyed by a stable id with a locked seed, resolved once.

It is unreachable from a lesson: nothing in the schema lets a beat say "the picture from
beat 2, again". **`cast` + `character` already does exactly this for people** — declare
once, reference by id, one asset per pose. Generalising that to subjects is a small schema
addition with a large payoff, and it also cuts the image bill.

### 3. The board is sparse, and it is now the loudest visual defect

`fillcheck`: 31.0% before, 29.7% on the same lesson recompiled, **25.8%** on the new one.
Both falls are honest — an asset element is a _square_ centred in a cell where a hillside
spanned the cell's whole width, and a diagram of two nodes is mostly air. The benchmark is
48%. Two fixes, both changing every board: a two-column cell (words beside the drawing), or
framing the ink rather than the cell — the second argues with a deliberate decision in
`regions.ts` that one cell is the tightest shot there is. `buildAsset` sizing
(`min(w,h) * 0.82`) is the cheap half of it.

### 4. Story, cadence and the space between cuts

Untouched this session, and still the user's other half. The levers, all cheap:

- **The hook works.** Do not rewrite that part of the brief.
- **A beat that asks a question should hold on a nearly-empty board.** The next beat's
  picture is drawn from the start of its own narration, so the answer often appears before
  it is spoken. The reveal order across a cut is unexamined.
- **Camera transitions are 0.45s inside a region, 0.95s between, 1.3s for the recap**, and
  nothing varies them by role. A cut into a misconception should not feel like a cut to the
  next step.
- **The `dominant` clamp fires** whenever the model cues a beat's main picture on a late
  phrase. Either brief for an opening cue, or draw the picture in stages.

### 5. The voice bill, which is the largest line

ElevenLabs charged **$0.3835 for 110 seconds** — $0.21/min, past the `$0.20/min` target the
README quotes, and 86% of that render's cost. `eleven_flash_v2_5` is about half the price at
similar quality for narration; the model id is a constant in
`voice/src/providers/elevenlabs.ts`. Also an honest-reporting bug: `pipeline.json` records
`elevenlabs/af_heart`, the _requested_ id, not the stock voice the adapter resolved it to.

## How to verify a change cheaply

Ten tools, cheapest first. **Use the first one that can see your change.**

1. **`packages/pipeline/src/vocabcheck.mts`** — terms spoken vs written.
2. **`packages/pipeline/src/synccheck.mts <projectDir>`** — every element against the word
   being spoken. Needs a project the voice stage has run over.
3. **`packages/pipeline/src/sbhash.mts <lesson…>`** — storyboard hash, both presets. The
   only tool that sees a planner change on the shipped lessons.
4. **`packages/pipeline/src/sbjson.mts <doc|lesson> <outDir>`** — a `storyboard.json` from
   anything, with no key.
5. **`packages/pipeline/src/drawcheck.mts <dir>`** — new. Resolves the visuals stage alone
   over a storyboard on disk, with the keyvault hydrated, so the illustration lane really
   draws. One image per asset (~$0.003 on fal) instead of a whole render. Writes
   `storyboard.resolved.json`; copy it over `storyboard.json` to point `frames.mts` at it.
   **Then open `assets/illustrations/*.png` and actually look.**
6. **`packages/visuals/src/geomhash.mts`** — what the visuals stage resolves.
7. **`packages/render/src/planhash.mts`** — what the renderer will draw, timing excluded.
8. **`packages/visuals/src/libsheet.mts`** — the only way to look at a library asset or rig.
9. **`packages/render/src/frames.mts <projectDir> <outDir> [seconds…]`** — ~76ms a frame.
   **Both false plots fixed this session were found here, not by reading code.**
10. **`packages/render/src/fillcheck.mts <storyboard.json>`** — mean content fill. A
    regression check, not a target: it counts bounding boxes, so it can be gamed.

Tools 3, 6 and 7 take a stash diff:

    npx tsx <tool> <targets> > /tmp/after.txt
    git stash push -u && git status --short          # confirm the tree is CLEAN
    npx tsx <tool> <targets> > /tmp/before.txt
    git stash pop
    diff /tmp/before.txt /tmp/after.txt

**To test a brief change without paying for a render**, call `designLesson` from
`@inkcast/pipeline` — the lesson stage alone, one model round trip, about $0.06 against
$0.45 for the full run — and print the `kind` of every visual. That is how the brief change
above was verified, and it is a ten-line script. The vault hydrates the same way
`drawcheck.mts` does it.

A full keyed render, when you need one:

    node apps/cli/bin/inkcast.mjs cast "How a lithium-ion battery charges" --project try

Drop `--json`; it silences stderr and a clean log then proves nothing.

## Traps

**This repo is `inkcast`, at `~/code/inkcast`.** Sessions have been launched in the sibling
`finito` checkout. No remote — `git log` tells you where you are.

**A keyword table answers "which", never "whether".** Three instances have now been fixed
by the same separation: `worthPlotting` (is a plot appropriate at all), `drawsAsFreeform`
(can this lane draw it at all), and `steep` selecting a tangent for a beat comparing two
straight lines. Assume the fourth exists. `PART`, `RECIPES`, `Y_WORDS`, the lucide match and
`nodesFrom` are all tables of this shape.

**An author states things the tables cannot infer.** `axisLabels` reads "a plot of X against
Y" ahead of any vocabulary list, because the instruction says outright what the tables can
only guess. Look for the same opportunity everywhere a table has a fallback.

**The brief's examples are read as examples.** Anywhere it lists what a lane can do, it must
say whether the list is exhaustive. `path` is now explicit that six is all there is; check
`plot`'s recipe list and `icon` before trusting them.

**An image model cannot spell, and cannot draw a change.** Any prompt asking for a word
inside the picture comes back as scribble, and "the same thing drawn twice, before and
after" comes back as one muddled frame. Both are briefed against now; do not undo them.

**A lane the brief does not name will not be used.** `illustration` was absent from the
brief for the whole project's life, so a configured image key drew nothing on any topic.

**`git stash -u` takes your untracked measurement tool with it.** Every tool above is
committed for that reason.

**A stage that starts reading another stage's output has gained a cache input.** See
`renderFingerprint` folding in `visualsFingerprint`.

**Words-per-minute read off a whole scene is not the speech rate** — `narrationSec` includes
the sentence gaps. `DELIVERED_WPS` (2.2) is the measured figure.

**`pnpm -r test | tail` lies.** Redirect and sum with `awk '/# pass [0-9]+$/ {p+=$NF}'` —
note `$NF`, because lines carry a package prefix. Eight test-bearing packages.

**`pnpm lint` is `prettier --check .`** — a hard gate, `examples/*.lesson.json` and every
`docs/*.md` included.

**Stage versions** are `lesson@7, storyboard@10, voice@5, visuals@7, render@5` in
`packages/pipeline/src/keys.ts`, which explains when to bump and when not to.

**`teach <topic> --lesson <file>` silently ignores the file.** Use `cast`.

**`seed: 0` means "no seed" in roughjs** — `baseOptions` nudges it to 1; do not remove.

## Known defects, ranked by what a viewer notices

1. **A generated image cannot draw a relation.** Two sheets with something crossing one gap
   and blocked at another comes back as two empty rectangles. Item 1.
2. **A `diagram` beat is captions in boxes.** The model now asks for diagrams where it used
   to ask for ink, and three of ten beats on the newest lesson are labelled rectangles.
3. **The same subject is redrawn differently every beat.** Five drawings of two stacks.
   Item 2.
4. **The board is sparse** — 25.8% fill against a 48% benchmark. Item 3.
5. **The recap redraws its picture** in a fresh panel while the original is still on the
   board. `findReuse` only lets a hook or anchor beat annotate an existing drawing.
6. **No open-weight path for the lesson or the image stage.** The premise of the project. An
   OpenAI-compatible endpoint (Ollama/vLLM/LM Studio) behind `lesson-anthropic.ts`'s forced
   tool call, and a local diffusion path behind `detectImageProvider()`.
7. **`render/src/sketch.ts` is a second hand.** Mulberry32 against the visuals stage's
   roughjs for path/shape/arrow/diagram/emphasis/text; those SVGs are written and never
   read. Unifying redraws half of every board — a visual decision. `PIPELINE.md` step 10.
8. **The planner and visuals disagree about `doubleWell`** — two catalogues of one curve.
9. **The lucide lane is confidently wrong for an unmatched subject** —
   `odysseus-tied-the-mast` matches `presentation`.
10. **Emphasis lands on a clause, not a word.** The clip is assembled per clause.
11. **`coreInsight` is validated and read by nothing.** No multi-line equations.

## What has NOT been judged

**No full keyed render has run since the change.** Everything above is a compile, a
visuals-only resolve, and frames — deliberately, because that is $0.08 instead of $0.90 for
two lessons. The board has been seen in stills and the drawings one by one; the _video_ has
not. Do that once item 1 lands, so the render pays for a real change rather than for a
measurement you can take for six cents.

## The one thing to hold on to

The pedagogy stage is not the problem and has not been for three sessions. The routing is
no longer the problem either: the author now asks for the right lane on every beat of a
fresh lesson. What is left is that we have exactly two ways to draw — a plot, and whatever
an image model returns for a sentence — and neither of them can draw _two things and the
relationship between them_, which is what almost every explanation is made of. **Build the
lane that draws structure.**
