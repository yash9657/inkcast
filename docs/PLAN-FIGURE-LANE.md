# Plan — beautiful illustrations on any topic, and the four things standing in the way

This supersedes **item 2 of `HANDOFF-PARITY.md`** ("ask the image model for the figure, not
the object"). That item is right about what to ask for and wrong about what it costs. Its
closing claim — _"That is a prompt and a brief, not an architecture"_ — is falsified below,
with the images to prove it. It is a prompt, a brief, **a different image model, and a
second rendering lane.**

Everything asserted here was measured on 2026-08-06 against `projects/cardiac5/out.mp4` and
seven live image calls costing about $0.12. **Every frame referenced is committed under
`docs/research/figure-lane/`** so the next session does not have to take this on trust — the
last handoff's evidence was a signed URL that expired, and that must not happen twice.

## What was measured, and what it says

### 1. Our real ink coverage is 4.7% of pixels, not the 21.6% `fillcheck` reports

Seventeen frames of the cardiac film, sampled every ten seconds, counting pixels that
differ from paper rather than bounding boxes:

|                             | min  | mean  | max  |
| --------------------------- | ---- | ----- | ---- |
| ink coverage, real pixels   | 2.6% | 4.7%  | 7.5% |
| `fillcheck`, bounding boxes | 15%  | 21.6% | 32%  |

`fillcheck` counts the union of element bounding boxes over the view (`core/src/camera.ts:419`),
so a heart outline scores its whole box. **The board is 95% paper.** `fillcheck.mts:11-15`
admits this in its own header; nobody had put a number on the gap.

The hue census over those frames finds exactly two: 210° (the `#2f6fed` accent) on every
frame, and 30° (the `#c2410c` contrast) on five of seventeen at 1–7% of ink. Everything else
is one dark ink.

### 2. The image model cannot compose a teaching figure — and that is the model, not the prompt

`docs/research/figure-lane/prompt-probe-schnell.png`. Four prompts through the configured
provider (`fal-ai/flux/schnell`, 4 steps — `visuals/src/image.ts:63`), one variable changed
at a time:

- **A · object + our current suffix** — a clean external heart. What ships today.
- **B · teaching figure + our current suffix** — asked for a cutaway with four chambers, the
  septum, the AV node and arrows fanning through the ventricles. Returned **an external heart
  with two faint arrows scribbled on it.** No cutaway.
- **C · teaching figure + a colour-permitting suffix** — colour arrived, red and blue vessels.
  Still an external view. Still no cutaway.
- **D · object + colour** — the best-looking of the four, and still the object we asked for.

So loosening the prompt gets you colour and does not get you the figure. **Do not plan on
`HANDOFF-PARITY.md` item 2 as written: rewriting the brief against this model produces a
prettier version of the same card.**

### 3. A model that follows instructions produces Golpo's card on the first try

`docs/research/figure-lane/model-probe.png`. The same figure prompt, three stronger models:

- **`fal-ai/flux/dev`** (28 steps) — cutaway, four chambers, septum, red and blue vessels,
  orange conduction arrows fanning down through both ventricles.
- **`fal-ai/flux-pro/v1.1`** — cutaway with valves and chamber interiors, the AV node visible
  as a dark nodule at the junction.
- **`fal-ai/nano-banana`** — bold marker style, cutaway, the AV node a distinct dark nodule,
  orange arrows fanning through both ventricles, red and blue semantic colour. **This is the
  card `HANDOFF-PARITY.md` describes as theirs**, from one prompt, first attempt.

The competitor's advantage is not craft we lack. It is a model tier we are not buying. The
cost is real but small: schnell is roughly $0.003 an image against nano-banana's $0.039, so
eight figures a film moves the image bill from about $0.02 to about $0.31 — a ~$0.70 video
becomes a ~$1.00 video, against $39.99/mo.

### 4. Our tracer destroys a good picture, and would destroy a colour one completely

Two separate failures, both in `docs/research/figure-lane/`.

**On the line art we already generate** (`trace-degrades-source.png`): the source is fine,
delicate, accurate — clear chamber boundaries, coronary vessels branching. What lands on the
board is a lumpy black silhouette 6–8× too heavy with the internal detail gone. The traced
SVG carries `data-ink-strokes="6"`: **six strokes for the whole organ.** This is why our best
card (`ours-av-delay-card.png`) shows names pointing at an opaque blob — there is no interior
left to point at.

**On a colour figure** (`binary-destroys-colour.png`): `vectoriseToInk` runs vtracer in
`ColorMode.Binary` (`visuals/src/image.ts:430`) and every path is emitted with `fill: undefined`
(`image.ts:580`). Thresholding the nano-banana figure **erases the orange conduction arrows
entirely** — the one thing the picture was generated to teach — merges the red and blue
chambers into indistinguishable black, and turns the interiors into scribble. A colour
teaching figure cannot go through this lane at all.

`docs/STYLES.md:15-25` already specifies the fix, under the heading **"Do not vectorize rich
illustration"**: a `raster-reveal` mode that keeps the PNG and sweeps a hand-drawn mask
across it. `grep -r 'raster-reveal' packages/ apps/` returns **zero hits**. It is a document,
not code.

### 5. Two different prompts collide on one asset id, and the collision is invisible

`underlayAsset()` (`planner/src/underlay.ts:94-105`) slugs an id from the first four words
longer than two characters. So:

    "a human heart, anatomical, external front view, whole organ with great vessels"
    "a human heart, anatomical, external front view, coronal cut-open view showing
     both ventricles and the septum"

both become `underlay-human-heart-anatomical-external`, and the visuals stage caches on that
id (`visuals:asset:underlay-human-heart-anatomical-external`). The lesson **did** ask for a
cut-open view on the two most anatomically demanding beats — the bundle of His down the
septum, and the Purkinje fibres — and both silently received the external silhouette
generated for an earlier beat. Seven of eight heart beats share one picture.

The one coronal image that did get its own id is used by exactly one beat: the recap, which
is the frame nobody can read (`ours-recap.png`). **We paid for the cutaway and showed it at
postage-stamp size.**

This is a real bug, it is cheap to fix, and no existing tool can see it: `markcheck` reads
marks, `underlaysheet` renders one prompt at a time, and nothing compares the set of prompts
a lesson asked for against the set of images it got.

### 6. The board cannot lay down a filled area of colour, in any lane

`fill: true` on a shape or path does not fill. It emits roughjs hachure at `opacity: 0.26`
in `ctx.pal.accent` (`render/src/compile.ts:969-974`, `:996-1005`) — sparse diagonal lines,
always the same blue, whatever `tone` the element carries. And `assetPrims` never calls
`toneInk` at all (`compile.ts:1197`): an asset is always `ctx.pal.ink`, so a traced
illustration is monochrome by construction.

Semantic colour — red arterial, blue venous, orange electrical, holding across four cards —
is not a brief change. Today there is no code path that puts a red region on the board.

### 7. The camera pulls back as the board fills, and two camera systems disagree

`persist` defaults to `true` on every element factory in `planner/src/elements.ts`; all 179
elements in the cardiac storyboard persist and none is `false`. `persistingBounds`
(`core/src/camera.ts:289`) accumulates them, so the frame must widen to hold everything drawn
so far. There is no wipe, no clear, no per-scene layer anywhere in the codebase — and
`render/src/page.test.ts:371` asserts their absence: `'a persistent board never wipes'`.

Worth knowing before anyone acts on the old numbers: the planner's per-cell zoom (5.6439 on
every non-recap scene) **never renders.** `resolveFraming` re-derives every camera from the
accumulated region ink, giving 3.13–6.28, and the recap renders at 1.48 rather than the
authored 1.04. `HANDOFF-PARITY.md`'s "the recap shows all eleven cards" is read off the JSON;
the rendered recap shows nine (`ours-recap.png`). It is still indefensible — that is the
point of keeping the frame rather than the number.

## What this makes the job

Not "change the prompt". The pipeline has **one** illustration lane — trace a mono raster to
ink and redraw it in the board's hand — and it needs **two**, because it is serving two
different jobs with one mechanism.

|                          | the ink lane (exists)                         | the figure lane (to build)                        |
| ------------------------ | --------------------------------------------- | ------------------------------------------------- |
| what it is for           | relations, quantities, abstractions, change   | a real thing whose appearance carries meaning     |
| where it comes from      | composed marks + traced mono form             | a strong image model, in colour                   |
| how it reaches the board | vectorised, roughened, drawn stroke by stroke | shown as a raster under a hand-drawn reveal       |
| what marks do            | carry the whole mechanism                     | name parts, in the clear margin, and nothing else |
| what it costs            | free                                          | ~$0.04 a picture                                  |
| its failure mode         | a blob nobody can read                        | a picture we cannot address the parts of          |

Neither lane subsumes the other. The timing bar chart at 2:00 of our film is a real
quantitative figure that no image model can produce; the AV-delay cutaway is a real
anatomical figure that no composed mark set has managed in five sessions of trying. **The
win is having both and choosing correctly, and the choosing is the part that generalises to
any topic.**

## Where this plan has got to

Items 0, 1 and the generating half of 2 are **built and verified** — see `STATUS.md` under
**2026-08-06, later still**. `figuresheet.mts` renders a full-colour cutaway on the real
board through every real transform, at **17.2% ink against the shipped card's 5.3%**, with
red and blue carrying meaning rather than accenting.

**Nothing asks for a figure yet, and that is the next job.** The lesson brief still says to
write `underlay.prompt` as "the OBJECT and nothing else", `Asset.kind` has no `figure`, and
the compiler cannot mint one — so the lane is reachable only from its own sheet. That is the
exact failure both handoffs name, written down twice already, and it is now item 2.5 below.

## The work, in order

### 0. Two free fixes and one free measurement, before anything else — **DONE**

Nothing here needs a key, and item 0a is the highest value-per-line in the document.

**0a. Make the underlay asset id total over its prompt.** Hash the full prompt into the id
rather than slugging four words: `underlay-${slug4}-${hash(prompt).slice(0,6)}`. Both sides
already derive the id from the prompt through this one function, so they cannot disagree.
Add a test asserting the two cardiac prompts above produce different ids.

**0b. Add `inkstat` — pixel ink coverage and a hue census.** `fillcheck` cannot see the
difference between a board that is 5% ink and one that is 40%, and every density target in
the repo is written against it. This measures rendered frames, so it cannot be gamed by a
big empty box, and it is the number the figure lane will be judged on. Report mean ink,
per-frame ink, and the share of ink in each hue.

**0c. Add a lane census to `lanesheet.mts`.** For a finished lesson: how many beats asked for
a figure, how many got a distinct image, how many collided. 0a is invisible without it.

_Done:_ `underlayAsset` is `underlay-<slug4>-<hash8>` with a test over the two cardiac
prompts; `sbhash` on both shipped lessons is byte-identical. `render/src/inkstat.mts` reports
the cardiac film at `mean ink 4.7%  hues: 210° 21.0%  30° 1.4%`. The census landed as its own
tool, `planner/src/lanecheck.mts`, rather than inside `lanesheet.mts` — it answers a question
about a whole lesson, where `lanesheet` compares two lanes on one beat. It exits non-zero on
a collision and reports cardiac as 3 prompts over 3 ids.

### 1. Split the prompt, and configure a figure-capable model — **DONE**

`illustrationPrompt()` (`visuals/src/image.ts:106`) serves the tracer, and its negatives —
`no shading, no colour, no grey tones` — are exactly what forbids a teaching figure. Split it
in two rather than editing it:

- **`formPrompt()`** — today's text, unchanged, for the ink lane. It is correct for what it
  does and the tracer still depends on every one of those negatives.
- **`figurePrompt()`** — one centred subject, hand-drawn educational-diagram style, flat
  semantic colour fills, plain white background, **still `no text, no lettering, no labels`**,
  because lettering is the one limit that did not move: names remain the mark layer's job and
  that is the half we are genuinely better at.

Provider config gains a figure model alongside the form model. Default to `fal-ai/flux/dev`
on cost and pick `nano-banana` when the style pack asks for marker; both cleared the bar.
Keep schnell as the form model — it is fine at line art and 13× cheaper.

_Done:_ `figurePrompt()` sits beside `illustrationPrompt()` (which keeps its name — it is
still exactly the tracer's prompt, and renaming it would have churned every call site to say
the same thing). An `ImageKind` of `form | figure` carries its own model **and its own step
count**, which matters more than it looks: schnell is capped at 4 steps and passing the
figure tier's 28 to it is an API error, not a slower image. `INKCAST_FIGURE_MODEL` overrides
the endpoint without a code change. The kind is hashed into `illustrationKey` (now
`illustration/v2`) so a form and a figure of one subject cannot alias — the same bug as 0a,
guarded against before it could happen.

### 2. Build `raster-reveal`, the lane that does not trace — **generating half done**

Specified in `docs/STYLES.md:15-25`, never built, and the renderer is already most of the way
there: `PAINTABLE` includes `image` (`render/src/page/runtime.js:203-214`), and `inlineImages()`
(`render/src/compile.ts:129-156`) already data-URIs a relative `<image href>` for `.png`,
`.jpg` and `.webp`. It is wired into `assetPrims` and nothing upstream produces one.

- **Emit the raster as an asset.** A new resolve lane writes an SVG wrapping `<image href>`
  rather than traced paths — the existing `inline` branch (`visuals/src/resolve.ts:383-400`)
  already proves such an asset survives the whole pipeline untouched.
- **Reveal it with a mask**, not a fade. A roughened diagonal sweep with the pen sprite riding
  the mask edge, direction varying per asset. `STYLES.md` is right that a straight wipe reads
  mechanical, and a fade-in on a hand-drawn board reads worse.
- **Choose per asset, from a `detail` hint** — `simple → vector`, `rich → raster-reveal`.
  Default it from the lane: anything the figure model drew is `rich` by construction.

_Done:_ `figureRaster()` returns the PNG wrapped in an `<image>` SVG and never traces it, and
`figuresheet.mts` renders it on the real board. **What is not done is the reveal**: it
currently arrives as a fade, because the inline branch reports no strokes and there is
nothing for the runtime to dash along. Two finish defects are visible in the frame and both
are worth fixing before anyone judges the lane: the raster is letterboxed inside its box, and
it sits on a **white card against warm `#fcfbf9` paper** — the seam is plainly visible. Either
key the white out or generate on the paper colour.

Fix the ink lane's weight while you are in there: whatever the figure lane does, six lumpy
strokes for a whole organ is wrong, and `trace-degrades-source.png` is the before shot.

### 2.5. Make a stage ask for a figure — the item this repo keeps not doing

The lane is reachable only from `figuresheet.mts`. To reach a film it needs, in order: a
`figure` value on `Asset.kind` in core; a resolve lane that calls `figureRaster` for it; a
`VisualIntent` that can express "this beat's picture is a figure" (the natural shape is a
`kind` on `underlay`, since `underlay` already means "a generated picture this beat is built
on"); a compiler branch minting it; and **the brief change that makes the author use it** —
today `UNDERLAY_ADVICE` says to write the prompt as "the OBJECT and nothing else", which is
correct for the form lane and exactly wrong for this one.

`STAGE_CODE_VERSION.lesson` must go 10 → 11 with the brief, because the lesson brief is not
in the lesson stage's cache key, and `visuals` 8 → 9 for the kind in the illustration key.

_Done when:_ a keyed `cast` of the cardiac topic produces a lesson whose `lanecheck` shows
figures on the anatomy beats and composed marks on the timing chart, and `inkstat` on the
film clears 20%.

_Done when:_ a colour cutaway reaches a rendered frame with its orange arrows intact, and
`inkstat` on that frame reads north of 25%.

### 3. Give the marks the margin, and let the figure have the middle

`UNDERLAY_AREA` is `620×560` of a `1000×560` canvas (`planner/src/underlay.ts:41`), reserving
190 units either side for names. That rule was written for a picture the marks had to
annotate heavily. A figure that carries its own mechanism needs the opposite split: the
figure takes the frame, and the marks are names and leaders in a thin margin.

This is also where the aiming problem gets easier rather than harder. `draw-audit.ts` still
cannot see a mark that misses the thing it names — the blind spot `HANDOFF.md` calls the most
valuable thing left to measure — and a mark set reduced to "names around the outside" is the
case that blind spot matters least for.

### 4. Wipe the board, or frame one card

Unchanged from `HANDOFF-PARITY.md` item 1, and still free, but do it **after** the figure
lane rather than before: framing one card tighter is worth much more when the card is a
colour cutaway than when it is a six-stroke blob.

The mechanism exists — `persist: false` already gives a 0.2–0.55s fade at scene end
(`page/runtime.js:891-895`). What it needs is a preset knob, a `regions.ts` that stops
building a grid when nothing accumulates, a recap that **redraws its summary** instead of
zooming out to find it, and the fade starting before `Scene.hold` rather than after. Note
both camera systems have to change together or `resolveFraming` overwrites the intent.

Update `render/src/page.test.ts:371` deliberately, not incidentally: it asserts the board
never wipes, and that assertion is a decision, not an accident.

### 5. Semantic colour, which needs a filled region to exist first

Three things, in order: let an asset carry its own colour rather than being forced to
`pal.ink` (`compile.ts:1197`); make `fill` a tone rather than a boolean so a chamber can be
red and its neighbour blue; then loosen `DRAW_BRIEF`'s "if the drawing reads correctly in one
ink, use one ink", which is right for a two-flow diagram and wrong for a board of anatomical
figures.

Do not start here. A palette rule with no filled region to apply it to changes nothing, and
the figure lane delivers most of the semantic colour for free — the models put red on
arterial and blue on venous unprompted.

### 6. The router: which beats get a figure, on a topic nobody has seen

This is the item that decides whether any of the above generalises, and it is a brief, not a
table. `HANDOFF.md`'s trap stands and gets sharper here: _a table of subjects cannot be
completed at all._ The test the brief should give, and it is the one question that has held
across every subject checked:

> **Does the thing have a form a learner would recognise, and does that form carry meaning?**
> A heart, a kidney, a neuron, a jet engine, a cathedral, a beetle — yes, and the figure lane
> is right. A relation, a quantity, a change over time, a comparison, a process, a hierarchy —
> no, and the ink lane is right, because it can draw all three things the image model cannot.

Two mechanical notes. The lesson brief is **not** in the lesson stage's cache key
(`pipeline/src/cast.ts:450-466`), so every brief change here is invisible until
`STAGE_CODE_VERSION.lesson` goes 10 → 11. And `lanesheet.mts`'s own header still asserts an
image model "cannot draw a relation" — that is now false for the stronger tier and the file
should say so, or the next session will re-derive the wrong plan from it.

_Done when:_ the twelve `drawsheet` subjects each route to a lane you would defend, and the
census in 0c shows the split rather than assuming it.

### 7. Then, and only then, the runtime and the title treatment

`HANDOFF-PARITY.md` items 4, 5 and 6 — cutting 2:45 toward 60s, titles that look like titles,
a recurring presenter — are all still right and none is blocked by anything above. They are
below the fold because a 59-second film of six-stroke blobs is a faster bad film.

## Traps

**The old handoff's item 2 is falsified in its cost, not its direction.** "Ask for the figure"
is right. "That is a prompt and a brief, not an architecture" is wrong, and planning against
it wastes a session rewriting a brief that the configured model cannot satisfy. Evidence:
`prompt-probe-schnell.png` against `model-probe.png`.

**`lanesheet.mts` and `PIPELINE.md` still carry the three beliefs.** "Cannot spell" survives.
"Cannot draw a relation" and "cannot draw a change" are false above the schnell tier. Anything
reasoning from them needs re-deriving — this is the second time a doc's central claim has
shaped a lane, and the first time cost several sessions.

**Do not trust `fillcheck` as a density target.** 21.6% where the pixels say 4.7%. A number
that far from the frame will approve the wrong change.

**Do not put a colour raster through `vectoriseToInk`.** It does not fail loudly. It returns
paths, the render succeeds, and the teaching content is silently gone — see
`binary-destroys-colour.png`, where the arrows the figure exists to show simply are not there.

**An id derived from a truncated prompt is a silent aliasing bug.** It cost this film its two
best cards and left no warning in any log. Anywhere else a prompt becomes an id, check the
same thing.

**A capability is not shipped when it works, it is shipped when the stage that has to ask for
it actually asks.** This has now happened twice — the hybrid lane went a full keyed render
unused, and `raster-reveal` has been specified in `STYLES.md` through several sessions of
people wishing for exactly it. Budget a keyed render per item and read the lesson JSON before
the film.

## The one thing to hold on to

Five sessions went into making composed marks draw a mechanism, on the belief that the image
model could not. The belief was true of the model we had configured and false of the tier
above it, and nobody had spent twelve cents to find out. **The composed-mark lane is not
wasted — it is the half that spells, the half that draws a quantity, and the half that can
address a part by name.** What it should stop doing is drawing the heart.
