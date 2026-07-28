# The Lesson Engine — redesign after MVP review

The MVP renders correctly and teaches nothing. This document is the honest
diagnosis and the plan. It is written to be executable by someone starting cold.

## Verdict on the MVP

We built a working *compiler* and shipped a *slideshow*. The machinery is sound:
25ms narration sync across 164 seconds, deterministic frames, real stroke-by-stroke
drawing, a marker sprite riding the ink, resumable caching, 180 passing tests. None
of that is the problem.

The problem is that a learner watching the gradient-descent output learns nothing.

## Root cause 1 — the IR cannot draw (blocking, fix first)

`Element` supports: text, asset (lucide icon), shape (rect/ellipse/line/bracket/
underline/circle-highlight), arrow, diagram (boxes + edges), emphasis.

It cannot express a curve, axes, a plotted function, a tangent, a point moving
along a path, a freeform stroke, or an illustrated object or character.

Gradient descent is a bowl-shaped loss curve with a ball descending it and a
tangent showing the downhill direction. **No sequence of current elements can
express that picture.** The planner was never the binding constraint; the
vocabulary was. Every "explain a concept" video degenerates to captions in boxes
because captions in boxes is all the IR can say.

This is why the output looks rudimentary while a competitor's looks illustrated.
They generate imagery; we enumerate rectangles.

### The fix: four new element types

1. `plot` — the highest-leverage single addition. A cartesian frame with
   hand-drawn axes, optional gridlines and labels, one or more curves defined
   either as sampled points or as a named function over a domain, plus overlays:
   points, vertical/horizontal droplines, tangent line at x, shaded region,
   arrows between points, and axis annotations. Unlocks essentially all of maths,
   ML, physics, economics and statistics teaching. Gradient descent, learning
   rate, overfitting, compound interest, supply/demand are all one `plot` each.
2. `path` — a freeform hand-drawn stroke from a point list or SVG path, roughened
   to match the ink style. The escape hatch for any shape the vocabulary lacks:
   a bowl, a hill, a container, a brace, a squiggle.
3. `illustration` — a drawn object, character or scene, resolved through the
   text-to-image → vectorize → roughen lane and cached in `assets[]` by id. This
   must become a DEFAULT path, not opt-in. Odyssey needs a drawn Odysseus; an
   onboarding video needs a drawn laptop. Nine roughened lucide icons is not a
   visual language.
4. `motion` — an existing element moving along a path over a time window (the
   ball descending the curve, a token flowing through a pipeline). Currently every
   element can only appear; nothing can move. Movement is most of what makes an
   explanation legible.

`plot` and `path` are fully local, free and deterministic. Do those two first;
they alone lift the ceiling enormously. `illustration` needs a key or a local
diffusion model.

## Root cause 2 — no pedagogy layer

`plan()` splits a document into beats and narrates them. That is summarization.
Teaching is a different algorithm, and it must be modelled explicitly as a stage
that runs BEFORE storyboarding:

    ingest -> **lesson** -> storyboard -> voice -> visuals -> render

A `Lesson` is not a document outline. It has a required shape:

- `hook` — a concrete question or surprise in the first 5 seconds. Never a
  definition, never "in this video we will".
- `anchor` — a physical, everyday situation the learner already understands,
  which the abstraction will later map onto. Hiking downhill in fog, for
  gradient descent.
- `steps[]` — one new idea each, ordered so nothing forward-references. Each
  step carries: the idea in one sentence, why it must be true (first
  principles, not assertion), and the visual that makes it obvious.
- `worked` — a concrete numeric or narrative walkthrough. Real numbers. This is
  where understanding actually consolidates and we currently have nothing.
- `misconception` — the specific wrong belief a learner forms here, named and
  refuted. For gradient descent: that it finds *the* minimum.
- `recap` — the chain of ideas restated compactly against the accumulated board.

Rules the lesson stage must enforce, because they are what "thorough and
first-principles" actually decomposes into:
- Concrete before abstract, always. Never introduce notation before the picture.
- One new idea per beat. If a beat needs two, split it.
- Every abstraction must point back to the anchor.
- No unexplained jargon; if a term is needed, earn it first.
- Every claim gets a reason, not an assertion.

## Root cause 3 — the board does not accumulate

One region per scene and a camera framing exactly that region gives a slideshow
with ~80% whitespace. Group consecutive steps into one region; frame the camera on
the union of what has been drawn so far; zoom in for detail and pull back for
recap. The accumulated board at the end IS the summary — that is the whole reason
to use a whiteboard rather than slides.

## Root cause 4 — voice, pacing and cuts

We chose the free provider and made $0.00/min the headline. A learner will not sit
through robotic narration, so this was the wrong variable to optimise.

- Default to a genuinely good voice. Kokoro's better voices are acceptable; a
  cloud voice is worth the fraction of a cent for anything published.
- macOS `say` is a build-verification fallback only. Never a user default.
- Model silence explicitly. A beat needs a breath before the next idea lands, and
  a pause after a question so the learner can attempt an answer. Add a `hold`
  field so the visual persists in silence — currently every gap is dead air the
  planner did not intend.
- Narrate at 140-160 wpm for teaching, not the summarizer's dump-and-move-on pace.
- Never split a sentence across beats. The MVP does, producing fragments like
  "under you gets gentler".

## Root cause 5 — LLM planning was made optional

The Anthropic adapter exists and is dormant, so the shipped quality ceiling is
regex sentence-splitting. Invert this: the LLM planner is the product, the
heuristic planner is a CI fixture for testing the renderer without a key. Keep
zero-key operation for development; stop presenting it as the recommended path.

## Priority order

1. `plot` + `path` elements, end to end through visuals and renderer. Unblocks
   real explanation. Local and free.
2. The `lesson` stage with the structure above, LLM-first.
3. Board accumulation + camera on the union of drawn content.
4. Voice quality, explicit silences, sentence-boundary beats.
5. `motion`, so things move.
6. `illustration` lane on by default where a key exists.
7. 9:16 vertical as a first-class target — see below.

## Why 9:16 matters strategically

Short-form vertical is the highest-leverage distribution channel for teaching, and
the constraint improves the product: 45 seconds forces one idea, one visual, one
payoff. The persistent-canvas model suits it well — a tall canvas the camera walks
down. Schools and commuters are the same product with different framing. This
should be a first-class output mode with its own pacing rules, not a cropped 16:9.

## The benchmark: gradient descent

Judge every change against a single question — after watching, can a learner who
did not know calculus explain why the minus sign is there?

Target shape, roughly 90 seconds:

1. HOOK — "You are on a foggy hillside and want to reach the valley. You cannot
   see it. What do you do?" Drawn hill (`path`), a figure, fog.
2. ANCHOR — feel the ground, step downhill, repeat. Three drawn steps down the
   hill. No notation yet.
3. STEP — that hillside is a graph. Rotate to a `plot`: horizontal axis is one
   parameter, vertical is loss. The hill becomes the curve. This is the moment
   the abstraction earns its keep, and it needs the anchor visually morphing
   into the plot.
4. STEP — "how wrong we are" gets a number. Loss on the vertical axis, with a
   drawn point on the curve.
5. STEP — steepness at a point is the tangent. Draw the tangent at the ball.
   Slope up-to-the-right means downhill is left, hence the minus sign. Derive
   it, do not assert it.
6. WORKED — real numbers. w = 3, slope = +4, lr = 0.1, so w becomes 2.6. Show
   the ball actually move (`motion`). Repeat twice; watch the steps shorten as
   the slope flattens.
7. MISCONCEPTION — it finds *a* minimum, not *the* minimum. Draw a second valley
   and land the ball in the wrong one.
8. STEP — learning rate, shown as three plots side by side: too small crawls,
   too large diverges, about right converges.
9. RECAP — pull the camera back over the whole accumulated board and retrace the
   chain in one breath.

Note how much of that is impossible today: the hill, the morph, the tangent, the
moving ball, the three-plot comparison. That is the measure of the gap.
