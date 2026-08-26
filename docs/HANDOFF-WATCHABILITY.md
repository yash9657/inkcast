# Handoff — PLAN-WATCHABILITY, phases 0–4 landed, 5 open

Written 2026-08-25 at the end of the session that implemented `docs/PLAN-WATCHABILITY.md`.
Read the plan first; this says only what is **done**, what is **not**, and the handful of
things a fresh session would otherwise re-derive or get wrong.

## Do these two things, in order

**1. Audit what landed.** Phases 0–4 were written in one long session and the last of them
was cut short by a context limit. Every package typechecks and `pnpm -r test` is green
(1,335 tests), but green tests are not the same as correct work, and Phase 4 in particular
has one piece that was being wired when the session ended (see "the last edit" below).
Read the five commits, in order, against the plan:

```
21538fe  Phase 0 — keys, provider honesty, the voice that spoke, stale meta.json
4958b67  Phase 1 — one hand, ink-proportional draw times, dwell
2379bc3  Phase 2 — multilingual v2, sentence split, speed clamp, per-provider pace
e6ba0cf  Phase 3 — the studio casts a card; every card has a name
8f73ff4  Phase 4 — the art director, the figure seam, the finish defects
```

**2. Then finish Phase 5**, which is untouched. It is the smallest phase and it is what
closes the loop: 5.1 pedagogical priority in the trimmer, 5.2 scope `ocr-diff` to the
camera, 5.3 re-measure and pin.

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
- **4.2 done, and most of it was already done.** The letterbox is fixed (`figureImageRect`,
  now extracted and unit-tested) and the white-card-on-warm-paper seam was already closed
  by `mix-blend-mode: multiply` on light paper and alpha keying on dark. The **masked
  reveal is still not built** — a figure fades in. The plan explicitly allows that.
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

## Phase 5 — not started

- **5.1** `droppableIds` / trim order must treat `misconception` as the LAST droppable
  beat when it is derived from the worked example. QC `stages` upgrade: cutting it at
  `strict` becomes a failure. (`packages/planner/src/presets.ts`, `adaptLesson`.)
- **5.2** Scope `ocr-diff` to the camera rect. Mostly moot under `wipe`, still worth it.
- **5.3** Re-measure and pin. This is the one that needs a real keyed run:
  - `ELEVENLABS_BASELINE_WPM` (185, stale — flash+clause)
  - `DELIVERED_LPS_BY_PROVIDER.elevenlabs` (10.87, stale — one film, flash+clause)
  - `fillcheck` / `inkstat` on the acceptance film
  - record the acceptance-test results in `STATUS.md` with frame grabs
  - update `docs/HANDOFF-PARITY.md` item statuses (1 → done via 3.1/3.2; 2 → done via
    4.1; 4 → done via 3.1 + 5.1)

## The acceptance test has not been run

`docs/PLAN-WATCHABILITY.md` states it at the top and it is the bar. Cast

> Why do heavy and light objects fall at the same time

through the local studio with no flags, and check all nine gates. Everything measurable
without a render has been checked and passes; **1 (fill ≥ 45%), 6 (the delivered pace),
7 (two figures on the finished board) and 8 (runtime 60–90s, misconception survives) need
the film.** Note that gate 1's "no scene with `zoom < 2`" was written against the
mega-canvas: under `wipe` the canvas is 1280×895 and every scene sits at zoom ≈ 1.62,
which is _more_ pixels per unit than `standard`'s 4.44 on a 4448-wide board. Judge that
gate by `fillcheck`, not by the zoom number.

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
