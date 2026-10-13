# Handoff — build the hybrid drawing lane

You are picking this up cold, with one job. Everything you need is here or named here.

**The job:** wire up the hybrid drawing lane — an image for the _form_ of a real object,
composed marks for its _parts and their names_ — then re-render the cardiac conduction
lesson and compare it to what is there now.

**This repo is `inkcast`, at `~/code/inkcast`.** No remote; `git log` tells you where you
are. Branch `visuals-morph-density`, working tree clean at `61406aa`.

## Read before you touch anything

1. **`docs/research/golpo-video-craft.md`** — what the competitor's videos actually look
   like, read frame by frame. It is why the last session changed the layout, and it says
   what they can and cannot draw. Two sessions have been lost to skipping `docs/research/`.
2. **`docs/HANDOFF.md`** — the durable handoff. Its 08-06 box lists the drawing lane's
   architecture, the twelve-plus verification tools, and the traps. **Read its traps
   section**; the ones below are only the ones specific to this job.
3. `docs/STATUS.md` under **2026-08-06** — dated measurements for everything below.

## Why this lane exists, and the evidence for it

Measured on **one beat, the same `describe` text word for word, both lanes**
(`packages/pipeline/src/lanesheet.mts projects/cardiac 6`):

|                                                    | composed marks                         | fal / flux-schnell                            |
| -------------------------------------------------- | -------------------------------------- | --------------------------------------------- |
| AV node, bundle of His, L/R branches, apex         | all five, labelled, each with a leader | **none of them**                              |
| the relation ("splits in two, both reach the tip") | correct                                | absent                                        |
| labels                                             | spelled, in the board's hand           | impossible — the prompt must say "no text"    |
| **the organ's own shape**                          | **a valentine ❤️**                     | **anatomical — great vessels, real chambers** |

Each lane supplies exactly what the other lacks. The user's words, and they are the
acceptance test: _"the heart can't be the emoji shaped heart we have in texts, it needs to
be the actual diagram of the heart."_

Nothing Golpo does could copy this — their illustrations are pictures with no addressable
parts, so nothing in them can be labelled, cued, highlighted or moved.

## The mechanism is already proven. Read this before designing anything

The open question was **alignment**: marks are placed on a 1000x560 canvas by a model that
has never seen the picture they must sit on. It was tested on its own, deliberately, before
any plumbing was built:

    npx tsx packages/pipeline/src/underlaysheet.mts \
      "a human heart, anatomical, external front view, whole organ with great vessels" \
      "Draw a bold line from the AV node down the septum, splitting into left and right \
       bundle branches reaching the apex. Mark the SA node high in the right atrium. Label each." \
      /tmp/ul

**Open `/tmp/ul/composite.png` and re-run it before you build.** Result:

- **It aims.** The SA node marker landed on the right atrium at the caval junction —
  anatomically correct _and_ correctly aimed at the drawn organ. AV node on the septum.
  Every label in clear space with a leader arrow reaching its structure. On a real heart.
- **It overruns.** 8 of 22 marks fell outside the canvas; the bundle branches ran to
  `y=720` on a board 560 tall. The model reasons in fractions of the image and scales them
  wrong. **This is a range problem, not an aim problem** — see "the overrun" below.

The brief that produced this is inside `underlaysheet.mts`. It is the starting point for
the real one; do not rewrite it from scratch, and note the sentence that does the work:

> The image occupies exactly the box x=220, y=0, w=560, h=560. So a feature you can see a
> fraction fx across and fy down the image is at canvas x = 220 + fx\*560, y = fy\*560.

A square image centred on a 1000x560 canvas leaves 220 units of clear board on each side,
which is where the labels go. That is why it is square and centred; keep it.

## What to build

### 1. `VisualIntent.underlay?: string` — `packages/core/src/lesson.ts`

A short prompt naming the subject's physical form: `"a human heart, anatomical, external
front view, whole organ with great vessels"`. Not the beat's idea, not the annotation — the
**object**, as an image generator should draw it.

Optional, never defaulted. (Same reasoning as `Tone` last session: a default writes a field
onto every intent of every lesson on disk and breaks two pinned byte-identical compiles.)

### 2. The seam — `packages/planner/src/types.ts`

    drawUnderlay?: (prompt: string) => Promise<Uint8Array | undefined>;

on `LessonOptions`, supplied by whoever has an image provider. **Exactly the same seam as
`drawPreview`**: the planner has no image provider and must not acquire one — detection
lives in `@inkcast/visuals`, which the planner does not depend on. Copy how `drawPreview`
is passed (`pipeline/src/cast.ts:409`, `pipeline/src/stages.ts:63`,
`pipeline/src/draw-preview.ts`) and mirror it for the underlay, backed by
`illustrationRaster` in `@inkcast/visuals` so it is cached per prompt like every other
image.

### 3. The author — `packages/planner/src/draw-anthropic.ts`

`drawLesson` → for a job whose intent has `underlay` and where `drawUnderlay` is supplied:
generate the image first, then pass it to `drawOne`. `drawOne` gains `underlay?:
Uint8Array`; when present it uses an `UNDERLAY_BRIEF` (adapted from `underlaysheet.mts`)
instead of `DRAW_BRIEF`, and sends `imagePart(png)` ahead of the instruction — the same
message shape the critic already uses (`draw-critic.ts:168`).

**The cache key must include the image, not just its prompt.** `drawKey` hashes
`BRIEF_VERSION + DRAW_BRIEF + instruction`. Marks aimed at a _specific_ picture are only
valid for that picture, so hash a digest of the image bytes in too — a regenerated,
different underlay must re-author its marks. Getting this wrong produces marks aimed at an
image nobody can see any more, which looks exactly like the model being bad at aiming.

### 4. **The fit — `packages/planner/src/drawing.ts`. This is the one that will bite you.**

`buildDrawing` fits marks into the beat's box **by their content bounds** (`fitDrawing`),
uniformly, so a drawing that used half the canvas still fills the cell. That is right for a
composed drawing and **catastrophic for an annotated one**: it rescales exactly the
coordinates whose whole value is that they line up with the image.

So `buildDrawing` needs to know which it is doing:

- **content fit** (today's behaviour) when there is no underlay;
- **canvas fit** when there is — map the whole 1000x560 canvas onto the box with one
  transform, and place the `AssetElement` at that same transform's image of
  `{x:220, y:0, w:560, h:560}`.

If the image and the marks do not go through _one_ transform, they will not line up, and no
amount of briefing the author will save it. `underlaysheet.mts` sidesteps this by
compositing in flat SVG rather than through `openDrawPreview` — for the same reason, and
the comment in it says so.

### 5. The compiler — `packages/planner/src/compile.ts`

In `buildIntent`, where `intent.marks?.length` is handled: when `intent.underlay` is also
set, mint an asset for it (`ctx.assets.use(slug, prompt, 'illustration')` — see
`buildAsset` at ~line 1349 for the pattern), emit its `AssetElement` **first** and at
`enter.at` ~0.02 so the form is on the board before anything annotates it, then the marks
on top. The per-mark cues from `draw-cues.ts` keep working unchanged; register them in
`ctx.cues` exactly as the current code does.

### 6. The lesson brief — `packages/planner/src/lesson-anthropic.ts`

Teach the author when to set `underlay`: a real physical object whose actual shape matters
and which a learner would recognise — an organ, an instrument, a plant, a machine. **Not**
for an abstraction, a process, a comparison, a graph or anything schematic. Bump
`lesson: 8` in `packages/pipeline/src/keys.ts`.

## The overrun, and how to fix it

8 of 22 marks fell outside the canvas. Three things to do, cheapest first:

1. **State the bound twice.** The brief gives the image box; it should also say plainly
   that the canvas is 1000x560 and **nothing may have a coordinate outside it**, with the
   y bound spelled out. Cheap, and it may be most of the fix.
2. **`draw-audit.ts` already has an `off-canvas` rule.** It will fire. Let it — the
   correction pass (`draw-critic.ts`) can be shown the composite and asked to pull the
   marks back in, which is the loop working as designed.
3. **Do not silently clamp.** Squashing a mark to the edge moves a leader arrow off the
   structure it names, which is worse than the overrun and invisible in the numbers. If you
   add a mechanical repair, `markcheck.mts` must show it improving the score _and_ a frame
   must show it improving the picture. See the trap below.

## Traps specific to this work

**`elements` came back as a JSON string AND malformed** — `{"x":565,y":300}`, one quote
missing. The retry does not fix it because the model does not recognise it as an error.
`underlaysheet.mts` has the repair for that one corruption plus a re-ask loop; lift it into
the real lane rather than rediscovering it.

**A measurement a fix can game is a measurement that will be gamed.** Two frames taught
this and both are in `STATUS.md`: a repair that cleared every label collision by throwing
labels off the canvas (713 → 48, all 48 self-inflicted), and an audit that counted hatching
as ink so the correction moved `N` and `S` out of a magnet. **Before believing a number
went down, open the PNG.**

**`repairLabels` cannot see the underlay.** It moves a label off _ink_, and `inkOf` only
knows about marks. With an image on the board, a label sitting in the middle of the organ
scores as free space. Either feed the underlay box in as an obstacle or accept it and check
the frames — but decide deliberately, and note that the audit treats shading as
writable-on for a reason (the bar-magnet frame).

**Do not widen a package's public surface for a tool.** `imagePart` and `drawingJsonSchema`
are internals; `underlaysheet.mts` imports them by path, the way `drawcheck.mts` reaches
the keyvault. Keep it that way.

**Every stage you change needs its version bumped** in `packages/pipeline/src/keys.ts`, or
the pipeline serves the old artefact and your fix looks like it did nothing. This bit the
last session: a re-run reported `done in 0.2s` and served stale audio. Current values are
`lesson@8, storyboard@13, voice@6, visuals@7, render@5`, plus `RENDER_VERSION = 5` in
`render/src/render.ts`. **This job changes lesson, storyboard, and probably visuals.**

**`git stash -u` takes untracked measurement tools with it.** Every tool is committed for
that reason; commit yours before you stash.

## How to verify, cheapest first

1. `npx tsx packages/pipeline/src/underlaysheet.mts "<subject>" "<instruction>" /tmp/ul` —
   the mechanism alone, one image call + one author call. **Open `composite.png`.**
2. `npx tsx packages/planner/src/markcheck.mts cache` — every cached drawing, audited
   before and after mechanical repair. No key, no browser, ~50 ms. Baseline today:
   **1080 raw → 146 kept across 71 drawings.**
3. `npx tsx packages/pipeline/src/lanesheet.mts <projectDir> <beatIndex> /tmp/lanes` — the
   same beat both ways. One image call. This is what produced the table above.
4. `npx tsx packages/pipeline/src/tandemcheck.mts <projectDir>` — does the drawing keep up
   with the beat. Baseline on `projects/cardiac`: **mean lead 5%, span 83%, 0 unresolved.**
   Do not let this regress; the underlay must not steal the beat's opening.
5. `npx tsx packages/pipeline/src/sbhash.mts gradient-descent longitude` with a stash diff —
   proves you broke nothing on the two shipped lessons. **They changed last session** (the
   card layout moved every camera), so re-baseline rather than expecting the old hashes.
6. `npx tsx packages/render/src/frames.mts <projectDir> <outDir> <seconds…>` — ~76 ms a
   frame. **Every defect worth fixing in five sessions was found here and was invisible in
   the code.**

`pnpm lint` (prettier, a hard gate) · `pnpm -r typecheck` · `pnpm -r test` — **646 pass / 0
fail** today. Sum tests with
`awk '/# pass [0-9]+$/ {p+=$NF} END {print p}'`; `pnpm -r test | tail` lies.

## The deliverable

    node apps/cli/bin/inkcast.mjs teach "the cardiac conduction system" \
      --audience "a first-year medical student who knows basic cardiac anatomy but has not studied electrophysiology" \
      --objective "trace the impulse from the SA node to the Purkinje fibres and explain why the AV node delay exists" \
      --depth standard --project cardiac2

`ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY` and `FAL_KEY` are all in the macOS keychain and
hydrate automatically through the CLI. The previous run cost **~$0.63** and took ~6 minutes.
Note the brief changes bust `drawKey`, so **every drawing re-authors** — budget for it.

Then compare against `projects/cardiac/out.mp4`, which is the current best and has the
valentine in it. Pull frames from both at the same beats and open them side by side. **The
acceptance test is a real anatomical heart with the conduction system drawn and labelled on
it.** A clean audit is not the test; the frame is.

## What is already done, so you do not redo it

Five commits this session, newest first:

- `61406aa` the alignment experiment above — proven, not built
- `fa055f2` **a beat is a card** — its `idea` is written as a heading at `at: 0` with an
  accent rule under it, and the camera holds one cell instead of every cell drawn so far
- `54e65af` the Golpo video research
- `9ff479e` the cloud voice had no declared speaking rate, so the 140–160 wpm correction
  was silently skipped and a film shipped at 185 wpm; now 145. Three stage versions bumped
- `96572bc` per-mark cues (the drawing keeps up with the sentence), `Tone` on marks and
  elements, and a paper halo under every glyph

## Known defects this job does not fix

Ranked by what a viewer notices. Do not get pulled into these.

1. **The board is still sparse in places.** `fillcheck` reads ~25% on `projects/cardiac`.
   The card layout fixed the framing; the drawing not filling its own cell is separate.
2. **No maths notation beyond Unicode.** `label` cannot set a fraction, an integral, a root
   or a matrix. It is the thing Golpo is best at and we cannot do at all, and it is the
   next job after this one. `EquationElement` already typesets TeX
   (`visuals/src/equation.ts`); one more `Mark.kind` closes maths, physics and chemistry.
3. **A beat that another beat derives from is being dropped.** `projects/cardiac` logs
   `a beat "step6" that another beat derives from was dropped splicing the reference so the
lesson still validates, which is the behaviour that shipped an unfollowable video —
droppableIds should have refused this cut`. Pre-existing, and it is the exact pathology
   that produced an unfollowable film before.
4. **Nothing measures whether a drawing teaches.** The audit is arithmetic. Benzene's
   double bonds are chords across the ring and it audits clean.

## The one thing to hold on to

The last session's biggest wins came from **opening a PNG**, not from reading code — the
per-mark cue fix, the regression in that same fix, the valentine, and the whole Golpo
research. This job has a proven mechanism and a known failure mode. Build it, render it,
and look at the frames.
