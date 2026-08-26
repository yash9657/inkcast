# Handoff — close the gap with Golpo, and it is not the gap we thought

You are picking this up cold. The job is one thing: **make a video of this quality on any
topic.** Everything below is measured from two videos of the same lesson, made on the same
day from the same one-sentence prompt — theirs and ours.

Read this before `HANDOFF.md` or `HANDOFF-HYBRID.md`. Both are still accurate about the
machinery and **both are built on a premise this document falsifies.**

## The evidence, and how to get it back

The user made a video on Golpo's own system with this prompt:

> Explain the cardiac conduction system to a first-year medical student: trace the impulse
> from the SA node through the AV node, bundle of His, and bundle branches to the Purkinje
> fibres, and explain why the AV node delay exists.

Ours is `projects/cardiac5/out.mp4`, made from the same words. Theirs was a signed stream
URL that has since expired and is deliberately recorded nowhere; if you need it again, ask
the user to export another. Everything asserted here was read off a contact sheet, and you
can rebuild ours in one command:

    ffmpeg -i projects/cardiac5/out.mp4 -vf "fps=1/11,scale=440:-1,tile=5x3" -frames:v 1 out.png

**A contact sheet is the right tool and reading code is the wrong one.** Nine frames of a
film in one image shows you the _structure_ of the thing, which is exactly what we have
been getting wrong.

## The scoreboard, measured

| on the same prompt               | Golpo                                                  | `projects/cardiac5`                                  |
| -------------------------------- | ------------------------------------------------------ | ---------------------------------------------------- |
| runtime                          | **59.5s**                                              | **2:45** — 2.8× longer for the same ideas            |
| narration                        | 158 words, 159 wpm, 14 lines                           | ~430 words, 11 beats                                 |
| seconds before the first anatomy | **0**                                                  | **~25** (an analogy about squeezing a bag)           |
| scenes                           | ~9 cards, board **wipes** between them                 | 11 cells accumulating on one 6572×2908 board         |
| the subject's share of the frame | **55–65% of frame height**                             | ~12% — and ~3% in the recap                          |
| mean content fill (`fillcheck`)  | not measurable, but visibly ~50%+                      | **21.6%** (min 15%, max 32%)                         |
| colour                           | semantic: red arterial, blue venous, orange electrical | one ink + blue accent + rare orange                  |
| the heart                        | a different purpose-drawn figure per beat              | **one traced external outline, reused in all eight** |
| labelled cross-section           | **yes** — see below                                    | yes, but tiny and monochrome                         |
| cost per video                   | $39.99–$999.99/mo                                      | ~$0.70 bring-your-own-key                            |

## What is on their screen, frame by frame

Fifteen samples, one every four seconds.

- **0s** Title card: _"ALRIGHT, LET'S TRACE A SINGLE HEARTBEAT."_ handwritten, multicoloured,
  underlined. A full-colour anatomical heart; a **cartoon presenter in a lab coat pointing at
  it with a stick**; an orange **ECG trace** running along the bottom; and a **roadmap
  flowchart** on the right — START (SA NODE) → ATRIA CONTRACT → VENTRICLES CONTRACT.
  The viewer knows the whole shape of the lesson in the first four seconds.
- **4s** _"THE HEART'S PACEMAKER ORIGINATES HERE."_ Cutaway heart, chambers in red and blue,
  a yellow starburst at the SA node, a boxed label _"SINOATRIAL NODE, THE SA NODE."_ with a
  leader to it.
- **8s** The presenter again with a **speech bubble**: _"THIS IS YOUR HEART'S NATURAL
  PACEMAKER."_ Energy lines radiating off the organ.
- **12s / 16s** _"ELECTRICAL IMPULSE CAUSES ATRIA TO CONTRACT"_ — the same card at two
  stages. Big orange arrows sweep across both atria; blue droplets fall into the ventricles.
- **20s / 24s / 28s** _"THE DELIBERATE AV DELAY"_, built in three stages. **This is the card
  to look at and it is described in full below.**
- **32s / 36s** A cleaner line-art heart labelled ATRIA / AV NODE / VENTRICLES with leaders,
  _"PAUSE!"_ in red, and a **character holding a stopwatch, thumbs up**, beside a thought
  bubble that fills in with _"AV DELAY: VENTRICLES FILLING WITH BLOOD"_.
- **40s** _"IMPULSE ROCKETS DOWN THE BUNDLE OF HIS"_, inside a hand-drawn border.
- **44s** The next title mid-write: `P RK NJE F BERS  THE F VA. SPARK` — letters landing one
  at a time. Titles are a text layer, not part of the picture.
- **48s** _"PURKINJE FIBERS: THE FINAL SPARK"_.
- **52s** _"POWERFUL, COORDINATED CONTRACTION"_.
- **56s** A decorative outro: swirls, musical notes, a lightbulb, stars.

### The one card that should change your mind

Their **AV delay** card, in full: a heart in **cutaway cross-section** — four chambers,
valves, septum, great vessels — with arterial vessels red, venous blue, and the electrical
signal orange. The signal enters top-left as a **red lightning bolt** labelled `SIGNAL`.
The AV node is a small dark nodule labelled `AV NODE` with a black leader arrow. `PAUSE` in
orange points at a **wavy line with trailing dots** drawn across the junction — the delay,
drawn as a delay. `SLOWED SIGNAL` in orange points at the fan of arrows spreading down
through the ventricle. Title across the top in three colours. The organ fills about
two-thirds of the frame height.

**`docs/research/golpo-video-craft.md` says they do not attempt this.** Its exact words:
"Technical, structural, labelled diagrams. This is the important half… Neither film contains
a labelled cross-section, a mechanism, a pathway, a part-named structure… **the space we have
been trying to occupy is genuinely unoccupied.**"

That is wrong, and it matters more than anything else in this document, because **the entire
drawing lane was justified by it.** The doc was written from two videos in their public
gallery — a sleep film and an AP Chem film — that happened to be text-and-metaphor. Given a
STEM anatomy prompt, their system produces exactly the labelled mechanism we believed only
we could make, and produces it better. Do not plan against "the space is open". It is not.

## What is on our screen, frame by frame

- **0–25s** _"Squeezing a full bag from the top wastes"_ — a bag/balloon with a tick and a
  cross, water spouting. **Twenty-five seconds of analogy before a heart appears.** The
  user's reaction to this line was the sharpest thing said all session and it is right: a
  first-year medical student studying for an exam does not need a parable about a bag.
- **33–44s** _"Heart muscle cells pass an electrical signal"_ — three hatched blue boxes and
  three grey boxes, "shortened (squeezed)" and "long (resting)". Abstract, and it is the
  clearest card in our film.
- **55s onwards** The hearts. Real anatomical outlines with the conduction system marked and
  labelled — the thing the last session built and it does work. They are **monochrome,
  external-view, identical in every beat, and about 12% of the frame**, with labels at a size
  you cannot read without pausing.
- **~2:00** _"Adding the times shows the beat fits inside"_ — a timing bar chart, 0.28s
  against 1s. Genuinely good, and nothing like it is in their film.
- **2:35** The recap zooms the camera to `zoom 1.04` and shows **the entire 6572×2908 board at
  once**: eleven cards, each heart perhaps 60 pixels tall. This frame is indefensible.

## The root cause, and it is one decision

Both systems have the same three layers. We assigned the work between them backwards.

|                 | Golpo                                              | us                                         |
| --------------- | -------------------------------------------------- | ------------------------------------------ |
| generated image | **the whole teaching figure**, in colour, per beat | a generic object, monochrome, once, reused |
| composed marks  | a few names and leaders                            | **the entire mechanism**, in 8 primitives  |
| text layer      | a big multicolour title                            | a small dark caption                       |

Look again at their Purkinje card: the whole branching conduction network, through both
ventricles, in orange with sparks — **and not one text label on it.** The image carries
100% of the teaching content. Their image prompt for that beat cannot have been "a human
heart"; it has to have been something close to "cutaway heart with the Purkinje network
branching through both ventricles, glowing orange, hand-drawn marker style".

Ours, from `projects/cardiac5/lesson.json`, is literally:

    "a human heart, anatomical, external front view, whole organ with great vessels"

We wrote that prompt deliberately — `lesson-anthropic.ts` tells the author to describe "the
OBJECT, not the beat's idea and not the annotation" — because we believed an image model
"cannot spell", "cannot draw a relation" and "cannot draw a change", and that composed marks
therefore had to carry the mechanism. **Two of those three beliefs are now falsified by their
output.** An image model can draw the relation and the change; it is the one thing it does
better than a model placing coordinates.

**This is good news and you should read it as such.** The lane built last session is not
wasted — the seam, the exact-fit asset, the one-transform alignment, the label repair, the
per-mark cues, `underlaysheet.mts` — all of it stays. What changes is **what we ask the
image for**. That is a prompt and a brief, not an architecture.

## What to build, in the order a viewer notices it

> **Statuses below were written on 2026-08-25**, at the end of `docs/PLAN-WATCHABILITY.md`.
> That plan was a second, independent dissection — of `projects/deb81002b073` rather than
> `cardiac5` — and it reached four of the six items here from a different direction, so the
> ones it closed are marked in place rather than left for a reader to rediscover. A status
> line says which commit did it and what is still open under the same heading; nothing that
> is only partly done is marked done.

### 1. Wipe the board, or frame one card. This is the biggest single win and it is free.

**Status: done** — `e6ba0cf` (plan 3.1, 3.2). The local studio applies `explainer` (which
is `board: 'wipe'`) unconditionally instead of only under `INKCAST_HOSTED`, and the create
form's **Length** control chooses between it and a new `deepdive` preset, which is
`standard`'s budget wiped. Every studio-reachable shape now holds one card for the whole
film, the recap included, and the accumulate-only 1.3s pull-back is unreachable by
construction under `wipe`. The CLI still defaults to `standard` on purpose — both shipped
lessons pin byte-identical compiles to it.

_Still open:_ the `fillcheck` half of the "done when" below, which needs the acceptance
render. Note that the zoom number in that clause does not transfer: under `wipe` the canvas
is 1280×895 and every scene sits at zoom ≈ 1.62, which is _more_ pixels per unit than
`standard`'s 4.44 on a 4448-wide board. Judge it by `fillcheck`, not by the zoom.

`projects/cardiac5/storyboard.json` is a 6572×2908 canvas, every element `persist: true`,
camera `zoom: 5.64` for ten scenes and **`zoom: 1.04` for the recap**. At 5.64 the shot is
about 1165 canvas units wide — **two cells**, so every card is drawn at half frame width
before the picture inside it takes its own share. At 1.04 you see all eleven.

Golpo's answer is to wipe. `golpo-ux.md` §5.1 recorded "whiteboard wipes constantly" as a
_weakness to beat_ and `golpo-video-craft.md` already retracted that. **Nobody acted on the
retraction.** Do it now: one card, one frame, wiped between beats. Persistence is a real
idea and it has never once been measured to buy anything, and it is currently costing us
every ounce of legibility we have.

_Done when:_ `fillcheck` on a cardiac render reads 45%+ instead of 21.6%, and the recap frame
does not contain eleven cards.

### 2. Ask the image model for the figure, not the object

**Status: done, and by a mechanism this item did not propose** — `8f73ff4` (plan 4.1).
The prompt change below is right and was not enough on its own: `STAGE_CODE_VERSION.lesson`
records versions 10, 11 and 12 as three successive attempts to make the lesson author ask
for a figure _via the brief_, and `projects/deb81002b073` — nine `draw` intents and zero
underlays on a topic full of bowling balls, feathers and vacuum tubes — is the fourth data
point that a rule stated in a brief is a suggestion. So it is a **pass** now, not a
sentence: `packages/planner/src/artdirect.ts` runs one forced tool call per lesson after
authoring, routes every beat `figure | form | marks`, and writes the figure intent straight
into the lesson's `underlay` without asking the author's consent. Budget four figures a
film, hook and worked example first. `routecheck.mts` is the harness.

The two sub-points were both already closed: colour survives (a figure is never traced, so
`illustrationPrompt`'s binary constraint does not apply to it), and the letterbox and the
white-card-on-warm-paper seam are fixed (`figureImageRect`; `mix-blend-mode: multiply` on
light paper, alpha keying on dark).

Change `VisualIntent.underlay.prompt` from "the object as an illustrator would draw it
before anyone wrote on it" to **the beat's whole teaching figure**: the view, the internal
structures, the pathway, the arrows, the state. "Cutaway cross-section of the heart, the AV
node highlighted, the electrical signal slowing across the junction, orange arrows fanning
down through the ventricles, red and blue chambers, hand-drawn marker style."

Then the mark layer's job shrinks to what it is genuinely best at — **naming parts with
leaders that always spell correctly** — which is a small, reliable job it already does well.

Two things to sort out and both are cheap to test with `underlaysheet.mts`:

- **`illustrationPrompt()` in `visuals/src/image.ts` forces "no colour, no shading, no
  hatching, pure black on pure white".** That exists because `vectoriseToInk` traces in
  binary mode. Colour is item 3 and these two are the same change.
- **Alignment gets easier, not harder.** If the figure carries the mechanism, there are fewer
  marks and they are all labels and leaders around the outside — the case the aiming already
  handles best.

_Done when:_ `underlaysheet.mts` on an AV-delay instruction produces a composite you would
put next to their card without wincing.

### 3. Colour, and semantic colour

Theirs is not decoration: **red arterial, blue venous, orange electrical, and it never
varies.** A learner tracking "the orange thing" across four cards is learning. We have four
`Tone` values with a brief that says "if the drawing reads correctly in one ink, use one
ink", which is the correct rule for a two-flow diagram and completely wrong for a board of
separate anatomical figures.

This is two jobs: let the generated figure be in colour at all (item 2), and loosen the
`tone` rule where objects are spatially separate. `render/src/palette.ts` and `toneInk()`
already carry the machinery.

### 4. Cut the runtime in half, and start with the subject

**Status: done** — `e6ba0cf` (plan 3.1) for the runtime, and the trimmer change of plan 5.1
for the question this item asks about the last three beats. The studio's default film is
now `explainer`: ~165 words, at most eight beats, 60–100s, against `standard`'s 150s. The
"look hard at whether `worked`, `misconception` and `recap` all earn their beats" clause is
answered, and the answer is not the one the item expected — **the misconception earns it,
and the trimmer was deleting it.** On `projects/deb81002b073` it is derived from the worked
example, which makes it the correction to the error that beat's own arithmetic creates, and
QC's `stages` check called its cut the film's worst wound. `adaptLesson` now drops a
misconception derived from `worked` **last** of everything droppable rather than first, and
cutting it fails the gate at `strict` (`misconception-cut`). Length comes out of the preset;
it does not come out of the payload.

_Still open:_ "the brief should let the audience cancel the anchor". Untouched.

We spend 25 seconds on an analogy and 2:45 total. They spend 0 and 59s. Our lesson brief's
CONCRETE BEFORE ABSTRACT rule is good pedagogy in general and wrong for an exam-prep
audience who already has the vocabulary — and the `--audience` string said exactly that:
"a first-year medical student who knows basic cardiac anatomy". **The brief should let the
audience cancel the anchor.** Also look hard at whether `worked`, `misconception` and
`recap` all earn their beats; their film has none of the three and loses nothing.

### 5. Titles that look like titles

**Status: partly done** — `e6ba0cf` (plan 3.3, 3.4). Two of the three things here landed,
and a third defect this item had not noticed was fixed with them. The hand-drawn double
underline is in (one pass out, one shorter pass back), and the heading role is two steps
heavier. The defect: the title was `shorten(idea, captionWords)`, a word count applied to a
sentence, which produced "Falling is a tug of war between bigger pull" — a board promising a
noun it never writes. Beats now carry an authored `LessonStep.title` (≤ 6 words, a name),
`captionFor` prefers it, and the fallback cuts at a clause boundary and refuses to orphan a
correlative.

_Still open:_ **multicoloured word by word**, and letter-by-letter lettering before anything
else. Both are palette/type work, both are unstarted.

We now write a title per card — the last session's "a beat is a card" — but it is small dark
text with a thin blue rule. Theirs is large, hand-lettered, **multicoloured word by word**,
with a hand-drawn double underline, written letter by letter before anything else. Ours is
already at `at: 0` with a rule. This is a type-scale and a palette change, not a feature.

### 6. A presenter, and vignettes

A recurring cartoon character appears in three of their nine cards — pointing, speaking in a
bubble, holding a stopwatch beside a thought bubble. It is what makes the film feel authored
rather than generated. We have `Lesson.cast` and character rigs already, and nothing uses
them outside a narrative lesson.

This is the lowest item on the list because it is charm, not comprehension. Do not do it
before 1–4.

## What is already right, and must not be thrown away

Do not restart. The following are ours, are good, and none of them exists in their film:

- **Every part of a drawing is an addressable, named element** cued to the word that names
  it — 0 unresolved cues on the current render. Their pictures have no parts.
- **Labels that always spell**, in the board's own hand.
- **The audit / repair / critic loop**, and a cache that keeps the drawing as composed
  beside the drawing as corrected.
- **The timing bar chart** at 2:00 — a real quantitative figure derived from the lesson's own
  numbers. They cannot do this at all.
- **$0.70 a video, bring-your-own-key, open weights all the way down**, against $39.99/mo.
- Fifteen free verification tools, and `underlaysheet.mts` in particular.

## Traps

**The research doc's central claim is false — see above.** Anything in `HANDOFF.md`,
`STATUS.md` or `golpo-video-craft.md` that reasons from "they decline technical diagrams"
needs re-deriving. `golpo-ux.md` §5.1's "wiping is a weakness" was already retracted once and
is still shaping our layout.

**A capability is not shipped when it works, it is shipped when the stage that has to ask
for it actually asks.** Last session's lane went through a full keyed render unused because
the brief's caution outweighed its case. Every item above is a brief change as much as a
code change; budget a keyed render for each and read the lesson JSON before the film.

**A good frame is not evidence that the stage you changed works.** The loop has two model
calls in it. The composite that proved the hybrid lane worked was the critic's, not the
author's, and the cache would have said so.

**Do not trust a number you have not seen a frame for.** 21.6% mean fill and "0 unresolved
cues" are both true of a film whose recap shows eleven postage stamps.

**Every stage you change needs its version bumped** in `packages/pipeline/src/keys.ts`.
Current: `lesson@10, storyboard@14, voice@6, visuals@8, render@5`. **The lesson brief is not
in the lesson stage's cache key** — a brief change is invisible without the bump.

## The one thing to hold on to

We have spent several sessions making the composed-mark lane better at drawing a mechanism,
on the belief that no one else was attempting it. Someone is, they are better at it, and
they get there by asking a diffusion model for the finished figure instead of asking a
language model for two hundred coordinates. The machinery to do the same thing is already
built and wired; it is being handed the wrong prompt and shown through the wrong camera.
**Fix the camera and the prompt before you write another line of drawing code.**
