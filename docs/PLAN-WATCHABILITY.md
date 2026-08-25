# Plan — make the film watchable: pacing, voice, board, figures, and honest defaults

Written 2026-08-25 from a full dissection of `projects/deb81002b073` (the "why do heavy
and light objects fall at the same time" film, 131.3s, strict-clean QC) against the real
Golpo references in `~/Downloads` ("How does day and night happen in your town_720p.mp4",
"Quantum Computing_720p.mp4" — note: `why-do-heavy-and-light-objects-fall-at-the.mp4` is
NOT a Golpo video and must not be used as a reference).

**The single sentence:** the lesson content is fine — the _realization_ is wrong, and it
is wrong in ways this repo has already measured and half-fixed but never turned on for
the run the user actually makes. The app's local default is the `standard` preset
(mega-canvas, accumulate, 150s) with a firehose element schedule, clause-fragment flash
TTS, and a lesson author that never asks for a picture. The `explainer`/`wipe`/figure
machinery from PLAN-GOLPO-PARITY and PLAN-FIGURE-LANE exists and is _not reachable from
the studio_.

## The acceptance test, stated first

After this plan lands, cast the same prompt through the local studio UI with no flags:

> Why do heavy and light objects fall at the same time

and the film must clear ALL of these, measured, not eyeballed:

1. **Board**: one card per beat, wiped between beats. No frame ever shows more than one
   beat's ink. The recap redraws its 3 summary items large — it never zooms out. (Check:
   no scene with `zoom < 2`; `fillcheck` mean ≥ 45%.)
2. **Pen**: at no instant are two elements mid-draw. (Check: new `pencheck` assertion in
   the plan rows — see Phase 1.4.)
3. **Dwell**: every scene has ≥ 1.5s between its last element finishing and the wipe;
   no element _starts_ after 88% of the scene. (Check: extend the `dwell` QC check and
   make it a gate, not an advisory.)
4. **Draw time**: element draw duration scales with ink length (a two-stroke arrow ≈
   0.5s, a full drawing 2–3.5s), not a flat 0.8s.
5. **Titles**: no card title is a mid-phrase truncation ("Falling is a tug of war
   between bigger pull" must be impossible). Titles come from an authored field, not
   `shorten(idea, 9)`.
6. **Voice**: ElevenLabs `eleven_multilingual_v2`, sentence-split, delivered pace within
   ±5% of the constant the planner budgeted with, and the _actually spoken_ voice id in
   `pipeline.json` (post-substitution, not the requested one).
7. **Figures**: at least 2 beats carry a generated figure/underlay (the hook's
   drop-experiment, the feather/hammer tubes are the obvious candidates); `lanecheck`
   shows the split. Zero beats where a recognisable object is drawn as a bare ellipse
   with a label doing all the work.
8. **Runtime**: 60–90s. The misconception beat SURVIVES trimming (it is the pedagogical
   payload of this exact topic; QC `stages` flagged its cut as the film's worst wound).
9. **Reliability**: the run works identically in a freshly restarted `next dev` process
   — keyvault hydration must not depend on the settings page having been visited.

If any gate fails, the plan is not done. Do not ship "improved"; ship "passes".

---

## Evidence from the dissection (what is actually wrong, ranked)

### E1. The attention firehose — the "unsettling" feeling, quantified

- 158 ink objects over 131s = one new object every **0.83s for the whole film**, no rests.
- Scene s2: 18 elements enter at fractions 0.066→0.889; six of them begin within 0.9s of
  each other. `enter.duration` defaults to a flat **0.8s** (`core/src/storyboard.ts:172`,
  `planner/src/elements.ts:261`) so 3–4 items are half-drawn simultaneously while one pen
  sprite hops between them. This is exactly "half-done drawings everywhere".
- Realized dwell after the last element enters, per scene (seconds):
  s0 1.0 · s1 1.9 · s2 1.4 · s3 4.4 · s4 2.7 · s5 2.7 · s6 8.2 · **s7 0.35** · s8 4.1 ·
  s9 1.1. Six of ten scenes give the finished board < 2.8s; s7's last element _enters_ at
  97% of the scene. QC's `dwell` check saw one case (`b7_term0`, 0.2s) and advised;
  structurally it is nearly every scene.
- Golpo (Quantum Computing, 511s): fresh board per chapter, a handful of items per board,
  one drawn at a time, multi-second draws, boards that sit mostly empty. Their pause
  cadence: 144 pauses ≥ 0.35s (one per ~3.5s of speech) vs our 21 in 131s.

### E2. The mega-canvas board — a whole defect class with one cause

`standard` = `board: 'accumulate'`: one 4448×2908 canvas, camera pans cell to cell at
zoom 4.44, recap zooms to 1.21 showing all ten panels as unreadable thumbnails (QC
frame-vision flagged five sub-10px label groups at 129.5s). Cross-scene ink collisions
(s3's box under s9's labels) are only possible on a shared canvas — an earlier run of
this very project _failed strict_ on eight of them (`meta.json` still carries that
error). The repo already measured the fix: `wipe` mode took fill 55.5%→62.3% and
regions 4→1 (`presets.ts`, explainer entry). **The studio can't reach it**: `explainer`
is applied only under `INKCAST_HOSTED` (`hostedFormat()`), the local default is
`standard`, and `GenerateFields` has no preset field.

### E3. The voice — it WAS ElevenLabs, and it still sounds wrong. Both facts matter.

Dissection correction the whole team should absorb: `storyboard.meta.voice: "af_heart"`
does **not** mean Kokoro spoke. The sidecars (`audio/scene-*.timing.json`) carry
provider-native word timings with no `alignFraction` — only the ElevenLabs adapter
produces those. This film was narrated by ElevenLabs `eleven_flash_v2_5`. The user's
"ElevenLabs was never getting caught" is a _reporting/legibility_ failure plus a real
fragility, not (in this project) a routing failure:

- **The record is ambiguous by design.** `pipeline.json` says `provider: elevenlabs,
observed: false, chars: {}` — this run spoke nothing (all clips cache-fresh from an
  earlier keyed run) and the cost lines show no voice line, so it _looks_ like ElevenLabs
  never ran. And `voiceId` records Rachel (`21m00Tcm4TlvDq8ikWAM`), the _requested_
  resolution — if the free-plan 402 substitution to a premade voice fired, the actually
  spoken voice id is recorded nowhere (the `planSwap` map is in-process memory,
  `providers/elevenlabs.ts:351`).
- **Init rejections are silent.** `openVoiceChain.advance()` catches a provider that
  fails to initialise and pushes it to `rejected` (`skipped()`, logged at _debug_), not
  to `fallbacks()` — so `ResolvedVoice.problems` and `pipeline.json` say nothing when the
  keyed provider is skipped at startup. A run that lands on Kokoro this way is exactly
  "11labs never getting caught", invisibly.
- **The web generate path never hydrates the vault.** `POST /api/generate` →
  `startJob` → `cast()` with no `hydrateEnv()` anywhere (`apps/web/app/api/generate/
route.ts`). Keys reach `process.env` only because `/api/providers` (settings/studio
  status fetch) happens to hydrate as a side effect. A fresh server process + a direct
  generate = no `ELEVENLABS_API_KEY` = Kokoro, silently. Same exposure for
  `ANTHROPIC_API_KEY` (→ heuristic lesson) and `FAL_KEY` (→ no figures).
- **Why it still sounds bad even on ElevenLabs**: (a) `eleven_flash_v2_5` — the
  latency-optimised engine chosen to halve cost, with a standing note that "no tool in
  this repo can hear the difference, so a person has to" — the person has now heard it;
  (b) **clause-level splitting**: ElevenLabs declares no `preferredSplit`, so every scene
  is synthesised as 4–10 separate clause generations, edge-trimmed, and concatenated
  with modelled gaps. `previous_text`/`next_text` help but flash's prosody across
  fragments is choppy — this is the "no proper cadence"; (c) speed manipulation:
  `ELEVENLABS_BASELINE_WPM = 185` → target 150 wpm → `voice_settings.speed ≈ 0.81` on
  every phrase, which audibly drags; (d) stability 0.55 / style 0 is a flat-affect
  setting.

### E4. The pace constant is measured for the wrong engine

`DELIVERED_LPS = 9.65` (`planner/src/presets.ts`) was pooled over four films spoken by
**the default local voice**. This ElevenLabs film delivered **10.87 lps (+13%)** and QC's
`pace-calibration` said precisely that. Every scene is therefore ~13% shorter than the
planner budgeted — the whole film is compressed beyond plan before any other defect acts.

### E5. The lesson author never asks for a picture (fourth failure of persuasion)

The lesson has 9 `draw` intents + 1 `plot`, zero underlays, zero figures — for a topic
full of recognisable objects (bowling ball, apple, feather, hammer, balance scale,
vacuum tubes). The bowling ball is an 80-unit ellipse; the apple a 40-unit ellipse with
an 8-unit stem; nothing is recognisable without its text label. `STAGE_CODE_VERSION`
records lesson 10, 11, and 12 as three successive attempts to make the author ask for
underlays _via the brief_, and this film is the fourth data point that briefing does not
route. PLAN-FIGURE-LANE item 6 ("the router") is right about the test and wrong about
the mechanism: a rule stated in a brief is a suggestion; a router must be a pass.

### E6. Titles truncate mid-phrase

`captionFor()` = `shorten(idea, preset.captionWords)` (`planner/src/compile.ts:1297-1303`)
chops at a word count: "Falling is a tug of war between bigger pull", "Air is what makes
a feather lose". QC frame-vision flagged it. A cap that cuts meaning is worse than a
shorter authored title.

### E7. The trimmer cut the film's best beat

The misconception beat ("gravity doesn't pull equally — it pulls harder, and that's the
whole point") was cut to fit the 150s budget, and QC `stages` warned that the film
"never names the wrong belief it creates". The trimmer optimises seconds; it has no
notion of pedagogical priority.

### E8. QC sees almost everything and changes nothing

`dwell`, `pace-calibration`, `stages`, `frame-vision`, `ocr-diff` all fired — as
advisories on a strict-clean run. The loop from measurement back into planning is open.
(Also: `ocr-diff` compares the whole persisted board's words against a frame taken at
panel zoom — under `accumulate` it flags words that are legitimately outside the camera.
Scope it to the camera's view; under `wipe` it mostly moots.)

---

## The work, in phases. Order matters: each phase is independently shippable and the

acceptance test is run after Phase 5.

### Phase 0 — honesty and reachability (small diffs, do first, ~half a day)

**0.1 Hydrate the vault on every money path.**
In `apps/web/app/api/generate/route.ts` (and the rerender route), before `startJob`'s
runner calls `cast()`: `const { hydrateEnv } = await import('../keys/_store.js'); await
hydrateEnv();`. Also call it inside the job runner itself (the runner can execute
minutes later, after a settings change). Verify the CLI path: `inkcast cast` must
hydrate before `providers()` is consulted — if it does not, add the same call to the CLI
entry. Add a test: a vault with a stored key + an empty env + a direct generate ⇒
`voiceProvider().name === 'elevenlabs'` inside the job.

**0.2 Make provider init-rejection loud.**
In `openVoiceChain.advance()` (`voice/src/providers/index.ts`): when a provider that the
chain _preferred_ (first link) is rejected — `available()` false or init throw — record
it in a `rejections: {id, reason}[]` surfaced beside `fallbacks()`, and have `narrate()`
fold it into `ResolvedVoice.problems` ("elevenlabs was skipped at startup: <reason> —
this film is narrated by kokoro"). The web UI already shows `problems`; that sentence is
the user's missing signal. `log.warn`, not debug.

**0.3 Record the voice that actually spoke.**
When the 402 plan-substitution fires (`elevenlabs.ts synthesize`), report the substitute
id/name on the `SynthesisResult` → `ActiveProvider.voice` → `ResolvedVoice.voice`, so
`pipeline.json.voice.voiceId` is the spoken voice, with a problem line "plan cannot use
Rachel via API — spoke with Sarah". Persist the swap into the project (e.g.
`pipeline.json.voice.substitutedFrom`) so a human can see it after the run. (In-stage
cache keys already key on the _requested_ id; leave that — but the record must not.)

**0.4 Fix the stale `meta.json`.**
`projects/deb81002b073/meta.json` says `status: failed` from the 20:58 attempt while
out.mp4 is the 22:00 success. Find why the success path did not overwrite
`status`/`durationSec`/`scenes` (likely the web `upsertProject` only runs on the job
that created it) and make the pipeline's own completion write win.

### Phase 1 — the attention engine: one pen, real draw times, real dwell (~2 days)

This is the largest felt improvement per line of code. All changes are in
`packages/render/src/compile.ts` (scheduling), `packages/core` (defaults), and
`packages/voice/src/narrate.ts` (dwell), with `STAGE_CODE_VERSION.render` and `voice`
bumps as the cache discipline in `pipeline/src/keys.ts` demands.

**1.1 Ink-proportional draw durations.**
Kill the flat 0.8s at the point where prims exist and path length is measurable —
`itemsFor` in `render/src/compile.ts` (the `mathDuration` precedent at
`planner/src/drawing.ts:148-168` already argues this). Replace `el.enter.duration` as
the authoritative number with `durationFor(prims)`: total stroke length / a per-style
ink speed (add to the style pack JSON, e.g. `marker: 900 canvas-units/s`), clamped to
[0.5s, 3.5s]; `write` items by character count (~12 chars/s, existing handwriting pace).
Keep `enter.duration` as an override when the author set one explicitly ≠ default.

**1.2 Single-writer scheduling.**
After items are computed for a scene, run `serializePen(items)`: sort by start; each
item's start = max(its cue-resolved start, previous item's end − 15% overlap allowance).
The _dominant_ visual of a beat keeps its cue anchor (never delayed by more than 0.5s —
if serialization would push it further, _compress the durations of the decorations
before it_ instead). Decorations and labels yield. If the schedule cannot fit inside the
scene, drop enters to a "settle" batch that appears during the scene's hold — never
overlap draws. Add the `pencheck` assertion (a plan-rows invariant test in
`render/src/planrows.ts` / `plan.test`): for every pair of draw items in a scene,
`start_b ≥ end_a − 0.15 × dur_a`.

**1.3 Reading dwell owned by the voice stage.**
The voice stage owns clip length, so it owns dwell. After cue resolution in `narrate()`
(it has every element's realized `enter.at`), compute the scene's last-finish time
(using 1.1's duration model exported from render — put `durationFor` in core so both
sides read one function) and extend `scene.hold` (appending real silence to the clip) so
that `sceneLength ≥ lastFinish + readTime`, where `readTime = max(1.5s, 0.35s × words
visible in the last two elements)`. Also fix the known one-liner QC keeps naming:
`holdFor` in `planner/src/compile.ts` must apply `Math.min(paced.hold, preset.maxHold ??
Infinity)` (the half-applied cap documented in `presets.ts`).

**1.4 Promote `dwell` from advisory to gate** in `render/src/check.ts` once 1.3 lands
(strict fails if any scene's last element finishes with < 1.0s left). Gates that cannot
fire before the fix exists are noise; land them in this order.

**1.5 Element-count ceiling per beat.**
In the compiler: a beat may schedule at most 10 enter events (title + rule + drawing
gesture groups + terms). The drawing lane already groups strokes into gestures
(storyboard 9); count gestures, not strokes. Beats over the ceiling merge their smallest
labels into the drawing's own gesture. This is the direct fix for "158 objects in 131s".

### Phase 2 — the voice: prosody over pennies (~1 day)

**2.1 Default the engine to `eleven_multilingual_v2`.**
Flip `elevenLabsModel()`'s default (`voice/src/providers/elevenlabs.ts:60-62`);
`ELEVENLABS_MODEL_ID` remains the override, `pipeline/src/providers.ts`'s mirrored
constant and `test/voice-key.test.ts` move with it. Cost consequence, stated so nobody
re-litigates: ~1300 chars × 1 credit × $0.00022 ≈ **$0.29/film** vs $0.14 — the film is
the product; $0.15 is not. The flash choice carried a listening-note debt; the note has
come back negative.

**2.2 Sentence split for ElevenLabs.**
Give the adapter `preferredSplit: () => 'sentence'`. Clause-level was chosen for cue
precision, but word timings come back from the API regardless of split — cue resolution
keeps word-exactness while prosody gets whole sentences. Keep `previous_text`/
`next_text`. Bump `STAGE_CODE_VERSION.voice` (different audio, same words).

**2.3 Stop dragging the speed.**
Re-measure `ELEVENLABS_BASELINE_WPM` under multilingual+sentence (the 185 was measured
under flash+clause). If the measured baseline lands within the teaching band, the speed
knob should sit at 1.0 — clamp the correction to [0.9, 1.1] so the engine's natural
prosody is never stretched more than 10%. Emphasis handling (0.92 slowdown + 0.18s gap)
stays — that one is human-shaped.

**2.4 Per-provider pace calibration.**
`DELIVERED_LPS` becomes `DELIVERED_LPS_BY_PROVIDER: {kokoro: 9.65, elevenlabs:
<measure>}` in `presets.ts`; `lessonSeconds`/word budgets/`teachingBrief` read the value
for the provider the run will use (`voiceProvider()` is already consulted in `cast.ts`
before the lesson stage — thread it through). QC `pace-calibration` compares against the
same per-provider constant. Re-measure after 2.1–2.3 land (they change the number); the
film in `projects/deb81002b073` gives the current flash figure, 10.87.

**2.5 Free-plan mood pins.**
The `calm` mood pins Rachel, which a free plan 402s. Keep the pin (paid accounts should
get Rachel) but pre-resolve: on the first 402 the substitution (0.3) is now recorded; ALSO
teach `resolveVoice` to check the account's own `/voices` list for the pinned id and
substitute _before_ the first paid round-trip when it is absent. One fewer billed
generation, one consistent voice from phrase 0.

### Phase 3 — the board: one card, one idea, titles that are titles (~2 days)

**3.1 Make `wipe` the shape of every studio film.**
Change the local studio default from `standard` to `explainer` (`apps/web/app/api/
generate/route.ts`: apply the format unconditionally, not just under `isHosted`), and
add a "Length" control to the create form (`components/studio/options.ts` + `create-form
.tsx`): "Explainer · ~75s" (default) and "Deep dive · ~150s". Deep dive maps to a NEW
preset `deepdive` = standard's budget with `board: 'wipe'`, `maxHold: 1.2`, `holdBonus:
0` — do NOT edit `standard` itself: both shipped lessons pin byte-identical compiles to
it (see `presets.ts` explainer note; a changed default moves pinned hashes and every
cached project). The CLI keeps `standard`. `GenerateFields` gains the enum field,
`.strict()` extended deliberately; hosted continues to pin `explainer` server-side.

**3.2 The recap redraws; the camera never pulls back.**
Under `wipe` this is already true (no board behind the card). Verify with the corpus
that recap scenes at `wipe` redraw their `recall` items at card scale (the planner's
`b9_recall*` assets suggest it does); delete/guard the accumulate-only 1.3s pull-back so
no studio film can ever produce the all-panels thumbnail frame.

**3.3 Authored titles.**
Add `title` (≤ 6 words, imperative to be a _name_, not a sentence fragment) to the
lesson beat schema (`core/src/lesson.ts`), brief the author to write it, and make
`captionFor()` prefer `step.title`, falling back to `shorten()` ONLY at a sentence/
clause boundary (cut at the last comma/`—`/preposition boundary before the cap, and if
nothing fits, use the first clause whole). `STAGE_CODE_VERSION.lesson` bumps (brief +
schema), `storyboard` bumps (different captions for the same lesson).

**3.4 Title treatment** (parity item 5, still open): heading role two steps heavier is
in (storyboard 13); add the accent-coloured hand-drawn double underline and let the
title's key noun take the accent tone. Small, `render`/`storyboard` gated, do last.

### Phase 4 — figures by routing, not persuasion (~2 days)

The lane exists end-to-end (visuals 9, figure kind, `figuresheet.mts` proof at 17.2%
ink). What is missing is a _mechanical_ router. Stop editing the brief — add a pass.

**4.1 The art-director pass.**
After the lesson is authored and trimmed, run one cheap model call per lesson (not per
beat) in `packages/planner` — input: each beat's `idea` + `visuals[].describe`; output:
per beat, `route: figure | form | marks` plus, for `figure`, the full teaching-figure
prompt in the PLAN-FIGURE-LANE item-2 style ("the beat's whole figure: view, internal
structures, state, arrows — no text, no lettering"). The router applies the one test
that generalises: _does the thing have a form a learner recognises, and does the form
carry meaning?_ The pass then **writes the `underlay`/figure intent into the lesson
JSON itself** — the author's consent is not required. Beats routed `marks` are left
alone. Budget: ≤ 4 figures per film (cost ~$0.16 at $0.04 each), hook and worked
example first.
Cache: the pass is part of the lesson stage's output → `STAGE_CODE_VERSION.lesson`
bump; the call is keyed with the lesson hash so a re-render is free.

**4.2 Close the two known finish defects** from PLAN-FIGURE-LANE item 2 before judging:
the raster letterboxed in its box, and the white-card-on-warm-paper seam (generate on
the paper colour, or key the white out). Add the masked reveal only if time allows —
fade-in is acceptable for this milestone, the seam is not.

**4.3 For THIS topic**, the router should produce: hook → figure ("a person holding a
bowling ball and an apple at shoulder height, both about to drop, hand-drawn marker
style"), feather/hammer beat → figure (two vacuum tubes), scale/bricks/boxes beats →
marks (relations — the ink lane's genuine territory). If the router disagrees, that is
the review conversation, in `lanecheck` output.

### Phase 5 — trimming with priorities, and closing the QC loop (~1 day)

**5.1 Pedagogical priority in the trimmer.**
`droppableIds`/trim order in the planner must treat `misconception` as the LAST
droppable beat when `misconception.from === 'derived'` from the worked example (i.e. it
is the payload), preferring: shorten narration per beat → drop a redundant step → drop
`anchor` → drop `worked` → only then `misconception`. QC `stages` upgrade: cutting the
misconception at `strict` is a failure, not an advisory.

**5.2 Scope `ocr-diff` to the camera.** Only expect words whose elements intersect the
scene's camera rect. Removes five false advisories per accumulate film; harmless under
wipe.

**5.3 Re-measure and pin.** After Phases 1–4: re-run the QC corpus (`auditcheck`),
re-measure `DELIVERED_LPS_BY_PROVIDER.elevenlabs`, re-run `fillcheck`/`inkstat` on the
acceptance film, and record the acceptance-test results in `STATUS.md` with the frame
grabs. Update `docs/HANDOFF-PARITY.md` item statuses (1 → done via 3.1/3.2; 2 →
done via 4.1; 4 → done via 3.1 preset + 5.1).

---

## Cost per film after this plan (local studio, keyed)

lesson (Opus) ~$0.15 · art-director pass ~$0.02 · figures ~$0.16 · voice (multilingual,
~165 words ≈ 900 chars) ~$0.20 · frame-vision QC ~$0.16 ⇒ **≈ $0.70/film**, unchanged
from today's budget envelope, with the money moved from length to quality.

## Traps, so the next session does not re-derive them

- `why-do-heavy-and-light-objects-fall-at-the.mp4` in Downloads is a degenerate stub in
  our own visual style — never benchmark against it. Use the day/night and Quantum
  Computing files.
- `meta.voice: af_heart` does NOT mean Kokoro spoke. Check the sidecars: provider word
  timings with no `alignFraction` = ElevenLabs. `pipeline.json` `observed: false` means
  "cached run", not "never used".
- Do not edit the `standard` preset in place — shipped lessons pin byte-identical
  compiles to it. New behaviour arrives as a new preset (`deepdive`) or a new default
  _selection_, exactly as `explainer` did.
- Every brief or schema change to the lesson stage is invisible without a
  `STAGE_CODE_VERSION.lesson` bump — the brief is not in the cache key. Same discipline
  for voice (audio changes), storyboard (board changes), render (schedule changes).
  Read the header of `pipeline/src/keys.ts` before every bump.
- The two camera systems must move together under any wipe/recap change
  (`resolveFraming` overwrites intent — PLAN-FIGURE-LANE item 4's note).
- `render/src/page.test.ts:371` asserts the board never wipes on the accumulate path —
  update deliberately if touched.
- The voice stage's whole-film failover and cache re-keying in `narrate()` is subtle and
  correct; 2.2's split change lands via `preferredSplit`, NOT by touching the failover.
