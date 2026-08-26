# Handoff — PLAN-WATCHABILITY, phases 0–5 landed; the acceptance test fails on one gate

Written 2026-08-25 at the end of the session that implemented `docs/PLAN-WATCHABILITY.md`.
Read the plan first; this says only what is **done**, what is **not**, and the handful of
things a fresh session would otherwise re-derive or get wrong.

**Revised 2026-08-25 (later)** by the session that did the audit this file asked for, wrote
Phase 5, and ran the acceptance test. Phases 0–5 are all landed. The film was cast, and
**seven of the nine gates pass and two do not.** The full record, with the numbers, is the
last section of `docs/STATUS.md`; this file says what to do about it.

## What is left, and it is one problem

**Gate 1: `fillcheck` reads 27.8% against a 45% bar.** Everything else about gate 1 is
right — one card a beat, wiped, and a recap that redraws at card scale instead of pulling
back. The number splits cleanly by lane and that is the finding:

| beats                     | mean fill |
| ------------------------- | --------- |
| the 3 figure/plot beats   | **48.2%** |
| the 5 mark-composed beats | **15.5%** |

**The figure lane clears the bar; the mark lane composes to a third of the card it is
handed.** Frame-vision independently reports "a mostly empty board" on one of them. That is
the defect, and it is a real one.

The threshold is also weaker than it looks, and the two facts must not be conflated.
Compiling the three shipped lessons at `explainer` (free, no keys — see `STATUS.md` for the
table) gives gradient-descent 60.9%, longitude 35.8%, hash-map 38.0%. Wipe genuinely buys
9–16 points on every one of them, so `presets.ts`'s claim is sound — but the "55.5% → 62.3%"
that 45% was drawn from is **gradient-descent alone**, and two of three shipped lessons miss
45% under the very preset the plan mandates.

So there are two pieces of work and only the first is this plan's:

1. **Make the mark lane fill its card.** This film's mark beats sit at 14–19%. That is
   below the other shipped lessons, so it is not only a threshold question.
2. **Then re-derive the bar from more than one lesson**, and do it after 1, not before.
   Moving it now would stop measuring the thing in 1.

**Gate 6 is not re-verified rather than failing.** It failed as cast (+12%), 5.3 re-pinned
the constant to the measured 12.16, and the constant now equals this film's own rate — which
makes the gate true for this film by construction. Whether a _second_ film lands within ±5%
of 12.16 needs another keyed cast (~$0.70). That is the cheapest remaining piece of real
information about this plan.

## What the acceptance run established

Beyond the gate table, three things this repo had never observed:

- **The figure seam works against a real provider.** `no figure board for` appears zero
  times and `assets/illustrations/` holds exactly three rasters for three figure prompts —
  so the seam and the compiler agree on id, prompt, seed, kind and aspect, and the film did
  not pay for a second set of pictures the marks were not aimed at. This was the piece "the
  last edit" below warns has never been run.
- **The 402 substitution is recorded end to end.** `pipeline.json` carries
  `voiceId: EXAVITQu4vr4xnSDxMaL` (Sarah, who spoke) and
  `substitutedFrom: 21m00Tcm4TlvDq8ikWAM` (Rachel, who was asked for), with a problem line
  saying why. Plan 0.3, on a real free-plan refusal.
- **Plan 5.1 fired on a live lesson.** The author wrote 9 beats, `explainer` caps at 8, and
  the trimmer cut `step4` and kept the misconception. Before this session it would have cut
  the misconception first.

## The audit, and what it found

Phases 0–4 were read against the plan, commit by commit. `pnpm -r typecheck` is clean and
`pnpm -r test` is **1,233 tests, 0 failures** — note that number, because this file
previously said 1,335, which is not a count `pnpm -r test` produces and should not be
trusted as a baseline. The five commits:

```
21538fe  Phase 0 — keys, provider honesty, the voice that spoke, stale meta.json
4958b67  Phase 1 — one hand, ink-proportional draw times, dwell
2379bc3  Phase 2 — multilingual v2, sentence split, speed clamp, per-provider pace
e6ba0cf  Phase 3 — the studio casts a card; every card has a name
8f73ff4  Phase 4 — the art director, the figure seam, the finish defects
```

**Everything the phase notes below claim is done, is done**, with two corrections and one
thing verified rather than trusted:

- **The masked reveal was already built.** The Phase 4.2 note below said "a figure fades in"
  and that is wrong: `data-ink-mode="raster-reveal"` on the figure's `<image>` and
  `makeSweepPart`/`applySweep` in `render/src/page/runtime.js` sweep a hand-drawn mask
  across the raster, seeded per asset so two figures in one film do not sweep identically.
  It landed in `b8f6291` (2026-08-08, the figure lane) — months before this plan — and is
  covered by `page.test.ts`. Nothing needs building; the note has been corrected in place.
- **`inkcast cast` already hydrates the vault**, so 0.1's "verify the CLI path" clause needs
  nothing: `apps/cli/src/main.ts:176` calls `hydrateKeys()` for every command that runs a
  stage, and `vault.ts` says out loud which commands are excluded and why.
- **The figure seam's cache alignment is right, checked by hand** rather than by running it.
  This is the piece "the last edit" below warns has never met a real provider, and the way
  it fails is silent — a second, different picture, with the marks aimed at the first. All
  four inputs agree between `openDrawUnderlay(...).figure` and what the compiler mints:
  `underlayAsset(prompt)` for the id and prompt, `assetSeed(id)` for the seed (it is
  `seedOf`, the registry's own function, re-exported), `kind: 'figure'`, and — the one that
  is easy to get wrong — the **aspect**. The seam asks for `figureBox()`'s 840/560 = 1.5;
  the visuals stage asks for the element's box, which is `boxAt(fitCanvas(...), figureBox())`
  and `fitCanvas` is a uniform scale, so the aspect survives the transform. `illustrationKey`
  hashes `rasterSize(aspect)`, which snaps to `RASTER_STEP`, so float wobble cannot separate
  them either. **It still has not been run against a real provider** — see "the last edit".

---

## What is done, phase by phase

### Phase 0 — done

- **0.1** Hydration moved to `apps/web/lib/keys.ts`. `POST /api/generate`,
  `/rerender` and `/edit` all call it; `withKeys` wraps the job runner so a film that
  queued before a key was pasted still gets it. `apps/web/lib/keys.test.ts` asserts the
  end of the chain — `voiceProvider()` says `elevenlabs` — not that a variable was set.
- **0.2** `VoiceRejection` on the chain, with providers explaining their own refusal
  (`VoiceProvider.unavailableReason`). Only the **head** of the chain is loud: every
  unkeyed run walks past ElevenLabs by design.
- **0.3** The 402 voice substitution travels out on `SynthesisResult.substitution` →
  `ActiveProvider.spokenVoice` → `ResolvedVoice.voice` + `substitutedFrom` →
  `pipeline.json`. **`ActiveProvider.voice` deliberately does not move** — it is a clip
  cache-key input, and moving it would re-synthesise a film whose narration never changed.
- **0.4** `healMeta` in `apps/web/lib/store.ts` writes the disk truth back into a stale
  `meta.json`. `projects/deb81002b073/meta.json` is repaired on disk.

### Phase 1 — done

- **1.1** `packages/core/src/inktime.ts`. `durationFor(prims, pace)`; the cost model is
  the page runtime's own (`layoutAll`), reproduced so the two cannot disagree. Speed is
  **output pixels per second** and lives in the style pack (`pen.inkSpeed`).
- **1.2** `serializePen` — one mark at a time, 15% lift-off overlap, the beat's subject
  keeps its cue, late cues are pulled back, an over-full beat packs evenly. Asserted by
  the new blocking `pen` board check.
- **1.3** The voice stage buys reading time (`allowReadingTime`), the renderer reserves it
  (`readingTail`). `SceneTiming.authoredHold` is what stops a second run re-synthesising:
  `Scene.hold` is now both an input to the clip and an output of the stage.
- **1.4** `dwell` is a gate. Its floor is `min(1.0s, 45% of the beat, whatever is left
after the marks are drawn at the floor)` — see `sceneDwellViolations` for why all three
  terms are needed. The per-text advisory moved to `dwell-text`.
- **1.5** `Preset.maxGestures` (10) coalesces reveals onto shared cues. **Only `explainer`
  and `deepdive` set it**; `standard` has no ceiling, so all four pinned hashes hold.

Measured on `projects/deb81002b073`: 158 pen items, 0 invariant breaches, every scene ≥
1.50s of dwell, durations spread 0.27–2.21s where they were a flat 0.8.

### Phase 2 — done

- **2.1** `eleven_multilingual_v2` is the default. `ELEVENLABS_MODEL_ID` still selects flash.
- **2.2** `preferredSplit: 'sentence'` on the ElevenLabs adapter.
- **2.3** `elevenLabsSpeed` clamps the correction to ±10%. **`ELEVENLABS_BASELINE_WPM` is
  still 185 and is marked stale in its own comment** — it was measured under flash+clause
  and has not been re-measured under multilingual+sentence. That is 5.3's job.
- **2.4** `DELIVERED_LPS_BY_PROVIDER` + `deliveredWps(provider)`, threaded from `cast()`
  through `PresetInput.voiceProvider`. `elevenlabs: 10.87` is **one film, measured under
  the old engine** — recorded as measured-but-stale rather than adjusted by guesswork.
- **2.5** `preflightVoice` learns a plan refusal from `/voices` before the first
  generation. It runs at first synthesis, **not** in `resolveVoice`: a mood must keep
  resolving by id, offline, on a fully cached run (there is a test that counts `fetch`).

### Phase 3 — done

- **3.1** `studioFormat` always returns a preset; `GenerateFields.preset` is a two-value
  enum (`explainer`, `deepdive`); the create form's **Length** control sends it. The
  control it replaced ("Teaching depth") sent `meta.depth`/`meta.targetSeconds`, which the
  endpoint has never validated — it was inert and the form said so. `deepdive` is a new
  preset: `standard`'s budget with `wipe`, `maxHold: 1.2`, `holdBonus: 0`, `maxGestures: 10`.
- **3.2** Pinned rather than added: every studio-reachable shape holds one shot for the
  whole film, recap included. Under `wipe` the pull-back is unreachable by construction.
- **3.3** `LessonStep.title` (≤ 6 words, a name); `captionFor` prefers it; the brief has a
  `NAME EVERY CARD` block. The fallback's own defect is fixed narrowly: `unpaired()` in
  `text.ts` refuses to orphan a correlative — "Falling is a tug of war between bigger
  pull" → "Falling is a tug of war". **All four pinned hashes hold**, verified.
- **3.4** The heading rule is a double underline: one pass out, one shorter one back.

### Phase 4 — mostly done; see the two notes below

- **4.1 done.** `packages/planner/src/artdirect.ts`. One forced tool call per lesson,
  `figure | form | marks` per beat, `MAX_FIGURES = 4` with hook and worked first, written
  straight into the intent's `underlay`. Runs from `illustrate()` in `lesson-anthropic.ts`
  **before** `drawLesson` — the marks are composed on top of whatever picture the beat
  ends up with, so the order is load-bearing. `routecheck.mts` is the harness.
- **4.2 done, and all of it was already done.** The letterbox is fixed (`figureImageRect`,
  now extracted and unit-tested) and the white-card-on-warm-paper seam was already closed
  by `mix-blend-mode: multiply` on light paper and alpha keying on dark. This note used to
  end "the masked reveal is still not built — a figure fades in", and **that was wrong**:
  it has been built since `b8f6291`. See the audit section at the top.
- **4.3 measured, and it agrees with the plan.** A live run of `routecheck.mts` on
  `projects/deb81002b073/lesson.json` (claude-sonnet-5, ~$0.02):

  ```
  hook           figure  A stick figure … a large bowling ball falling from one hand and a
                         small apple falling from the other … side view.
  step6          figure  Two sealed glass tubes side by side, one with a feather drifting
                         slowly and a hammer resting at the bottom …
  anchor/step1-4 marks   comparisons of arrow strengths, trails, inertia, a balance scale
  worked         marks   arithmetic and labelled numbers
  misconception  marks   a crossed-out phrase and comparative bars
  recap          marks   a chain of labelled boxes
  ```

  That is exactly what §4.3 predicted. **The first run of the brief produced only one
  figure and contradicted its own reasoning** — it wrote "worth a figure slot" in `why`
  and routed `marks` — which is why the brief now states the budget as _at least two and
  at most four_ and says "do not reason your way to a picture and then write `marks`".
  If you touch that brief, re-run `routecheck` and check the count, not just the prose.

## The last edit, and the one thing to verify first

The session ended part-way through wiring **`drawFigure`** — the seam that shows the
generated figure to the mark author. Without it `underlayFor` composes a figure's marks
blind against `DRAW_BRIEF` and redraws structure the picture already contains (measured on
`cardiac8f`: 23 of 45 marks). It is now wired:

- `openDrawUnderlay(...).figure` in `packages/pipeline/src/draw-underlay.ts` — same
  browser, same paper, generating under the **same id, prompt, seed and aspect** the
  compiler will mint, so the visuals stage resolves that very raster from cache;
- `DrawFigure` declared in `planner/src/types.ts` beside `DrawUnderlay`, re-exported from
  `draw-anthropic.ts` (its test imports it from there);
- `drawFigure: underlays.figure` passed in `cast.ts`.

It typechecks and every test passes, **but it has never been run against a real image
provider.** Verify it before trusting it:

```
npx tsx packages/pipeline/src/figuresheet.mts   # the lane on the real board
# then a keyed cast, and read the log for "no figure board for …" — that line means
# the seam did not fire and the marks were composed unseen.
```

## Phase 5 — 5.1 and 5.2 done; 5.3 needs the keyed run

- **5.1 done.** `misconceptionIsPayload` in `packages/planner/src/presets.ts`: a
  misconception with `from: 'derived'` that cites `worked` is the payload, and `scoreOf`
  ranks it `Infinity` so it is the **last** droppable beat instead of the first. Everything
  else keeps the old order. The QC half is a **new check id, `misconception-cut`**, at
  `severity: 'fail'` — not a severity bump on `stages`, because `stages` carries every other
  degradation the run survived and a `qcCheck` id is a contract (same argument as
  `dwell-text`). `cast.ts` partitions the stage channel on `misconceptionCutProblems`, which
  the planner exports because the planner owns the sentence it matches.
  `COMPILER_VERSION` 5 → 6: `adaptLesson` runs inside `compileLesson`, so a cached
  storyboard has the wrong beat already deleted.

  **Two deliberate narrowings, both to keep something the repo paid for.** The condition is
  not `from === 'derived'` alone: all three shipped lessons declare that (citing steps), so
  the broad reading would reorder their trim and move the pinned hashes for films nobody has
  looked at frames of. And the anchor and the worked example are **still not droppable**,
  which is where this departs from the letter of 5.1's preference list — `droppableIds`
  refuses them because a shipped render once lost the beat that turns the hillside into a
  graph. Moving the misconception to the back of the queue gets what 5.1 wants without
  reopening that. `test/trim-priority.test.ts` pins all of it, including a test that fails
  the day a shipped lesson starts taking the new branch.

- **5.2 done.** `textAt` in `packages/render/src/tier2.ts` now intersects each text prim's
  own box against the camera rect, reproducing `seek()`'s framing arithmetic from
  `page/runtime.js` (`min(frame.w/canvas.w, frame.h/canvas.h) × zoom`, centred on
  `camera.x/y`). A missing or degenerate camera falls back to the whole board. Measured on
  the `lessonStoryboard` fixture: the hook expects 1 of 1, the plot beat 2 of 4, the slope
  beat 4 of 6, and the recap — which really does pull back to zoom 1.0 — still expects all 8. The last of those is the assertion worth keeping: scoping must not start hiding ink
  that is genuinely on screen.

- **5.3 done.** `DELIVERED_LPS_BY_PROVIDER.elevenlabs` 10.87 → **12.16**, measured on the
  acceptance film over 54.6s of narration (158 words, 2.89 words a second, 4.20 letters a
  word) under multilingual + sentence split. `ELEVENLABS_BASELINE_WPM` 185 → **193**, and
  that one changes no audio: the film delivered 173.6 wpm at `speed 0.9`, 173.6/0.9 = 192.9,
  and the ±10% clamp floors both 150/185 and 150/193 to 0.9 — so the constant only starts
  affecting what is spoken when it comes within 10% of the target. Both still rest on **one
  film**, which is what the old number's own comment complained about; pool them the moment
  there is a second. `fillcheck` and `inkstat` are run and recorded, `STATUS.md` carries the
  acceptance record with the contact sheet at
  `renders/acceptance-f3ac9c760194/contact-sheet.png`, and `docs/HANDOFF-PARITY.md` item
  statuses are updated (1 → done via 3.1/3.2, 2 → done via 4.1, 4 → done via 3.1 + 5.1, and
  5 marked _partly_ done — the double underline landed, the multicoloured word-by-word
  lettering did not).

## The acceptance test, as run

It has been run — `projects/f3ac9c760194`, 78.65s, 8 scenes, `qc.json` `ok: true` at
`gates: strict`, seven of nine gates clear. The gate table and every number behind it are
in the last section of `docs/STATUS.md`. What follows is the original note, kept because
its last paragraph is still the right warning about how to read gate 1.

To repeat it: cast

> Why do heavy and light objects fall at the same time

through the local studio with no flags. Of the four gates that needed the film, **7 (two
figures) and 8 (runtime and the misconception) passed**, 6 was re-pinned rather than
re-verified, and 1 failed.

The zoom warning was right and is worth keeping. Gate 1's "no scene with `zoom < 2`" was
written against the mega-canvas; under `wipe` this film's canvas is 1280×895 and every
scene sits at **zoom 1.37** — which is _more_ pixels per unit than `standard`'s 4.44 on a
4448-wide board, because the canvas is a quarter the width. Judging that gate by the zoom
number would have failed a film whose board is correct. Judge it by `fillcheck`, which is
what caught the real defect.

## Traps this session hit, so nobody hits them twice

- **`Scene.hold` is now both an input and an output.** The voice stage lengthens it and
  the storyboard is saved with the longer number, so the clip cache key had to move to
  `SceneTiming.authoredHold` or every second run re-synthesises — and re-bills — a film
  whose narration never moved. Anything else that starts writing back into a field a
  cache key reads needs the same treatment.
- **A `qcCheck` id is a contract.** `dwell` changed severity, so the old per-text
  advisory needed a new id (`dwell-text`) rather than sharing one.
- **The pinned hashes are cheap to move and expensive to justify.** Two changes in this
  session could have moved them and were narrowed until they did not: the caption
  shortener (scoped to the correlative defect) and the gesture ceiling (scoped to the new
  presets). If a change genuinely must move them, `packages/planner/test/pinned-hashes.test.ts`
  says what to do and it involves looking at frames.
- **`illustrations` was never in the lesson cache key** and has been changing the brief
  since the drawing lane existed. It is now (`images: provs.images.name`), along with
  `voice`. Look for more of these: a brief input outside the key is invisible.
- **`docs/PLAN-FIGURE-LANE.md` item 6 proposes a brief for the router.** It is right about
  the test and wrong about the mechanism; the brief had already failed four times
  (`STAGE_CODE_VERSION.lesson` 10, 11, 12 and `deb81002b073`). It is a pass now.
