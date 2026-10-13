# Plan — Golpo parity: from `cardiac8` to a film you would send to someone

This plan sequences and extends **`docs/PLAN-FIGURE-LANE.md`**. That document's items 0–2.5
are built; its items 4 and 7 become Phases 2 and 3 here. Nothing in it is contradicted.
Read it before Phase 1 and do not re-derive what it already measured.

Every number below was measured on 2026-08-08 against `/tmp/golpo-cardiac.mp4` (a copy is
committed at `docs/research/figure-lane/golpo-cardiac.mp4`) and
`projects/cardiac8/out.mp4`, with ffmpeg and the repo's own tools. Nothing is estimated
from memory.

## The evidence base — do not re-measure, do not trust prose over it

|                          | Golpo                              | ours (`cardiac8`)                     |
| ------------------------ | ---------------------------------- | ------------------------------------- |
| runtime                  | **59.5s**                          | 174.1s                                |
| words spoken             | ~145 (estimated from rate)         | **348** (counted)                     |
| total silence ≥0.35s     | **3.2s (5.4%)**, 7 pauses          | **26.8s (15.4%)**, 39 pauses          |
| longest pause            | 0.55s                              | 2.6s, plus ~1s at every scene         |
| mean ink (`inkstat.mts`) | **14.4%** (min 9.6, max 24.6)      | 5.0%                                  |
| hues                     | **6**                              | 1 (210° blue)                         |
| board                    | wipes; one centred card per idea   | accumulates an 11-cell grid           |
| anatomy card             | diffusion cutaway, red/blue/orange | six-stroke silhouette + stick figures |
| voice                    | continuous, natural, paid          | **kokoro**, recorded as ElevenLabs    |

Facts a session will be tempted to re-litigate, settled:

- **Golpo's labels and titles are NOT from the image model.** Frame at 9s catches a title
  mid-write, letter by letter (`PA( A R`). Labels (`ATRIA`, `AV NODE`, `PAUSE`) are a
  hand-lettered text layer with leader lines, appearing one at a time. Their division of
  labour is exactly our figure lane's: image carries the form, text layer carries names.
- **Golpo's density is 14.4%, not ~50%.** Our single figure-lane test card already
  measures 17.2% (`STATUS.md` 2026-08-06). The gap is that only a minority of our cards
  are figures, and that the board dilutes them into a grid.
- **`cardiac8`'s voice was kokoro.** `af_heart` is a kokoro voice id, the scene WAVs are
  24 kHz PCM, and the ElevenLabs quota was exhausted the day before — yet `pipeline.json`
  records `elevenlabs/af_heart` and books $0.43 for it. The fallback was silent and the
  cost record is false. (Known defect — "records the requested voice id" — now with a
  dollar amount attached.)
- **Our sync machinery is not the gap.** `tandemcheck` on `projects/try`: 6% lead, 73%
  span, 97% distinct moments. Golpo's "speak only what is being annotated" is the same
  cue-per-mark idea we already run. Do not spend here.
- **Our cardiac8 script was good and everything downstream let it down.** "Picture two
  bags of water stacked…" is a better hook than theirs. The lesson stage needs economy,
  not a rewrite.

## The target, stated as numbers a tool can check

A keyed `cast` of the cardiac prompt (verbatim from `projects/cardiac8/pipeline.json`
`source.ref`) that produces a film with **all** of:

1. runtime 60–90s at the explainer preset
2. `inkstat.mts` mean ink ≥ 12%, ≥ 4 hues
3. total silence (`silencedetect noise=-35dB:d=0.35`) ≤ 8% of runtime
4. `lanecheck.mts`: every anatomy beat carries a `figure`, distinct asset ids, zero collisions
5. every scene boundary is a wipe to one centred card; the recap is a drawn summary card,
   not a zoom-out (checked by opening frames — no number exists for this)
6. `pipeline.json` `providers.voice` records the **resolved** provider, and it is
   ElevenLabs at flash pricing
7. no clipped word, no label through a label, in any sampled frame

Phases are ordered by value and each is independently shippable. **Do not start a phase
until the previous phase's gate has been looked at as frames.** Budget: ~$5–8 of API
across the whole plan if the cheap checks are run before every render.

---

## Phase 0 — preflight (free, ~15 minutes)

1. The working tree on `visuals-morph-density` carries the figure-lane work uncommitted.
   Run `pnpm lint && pnpm -r typecheck`, sum tests with
   `pnpm -r test 2>&1 | awk '/# pass [0-9]+$/ {p+=$NF} END {print p}'` (expect ≥ 654),
   and **commit before touching anything**. `git stash -u` eats untracked tools; a dirty
   tree makes every stash-diff measurement a lie.
2. `node apps/cli/bin/inkcast.mjs keys validate` — anthropic, fal **and elevenlabs**
   must pass. The ElevenLabs key was replaced on 2026-08-08 (vault mask `sk_79…7960`,
   free tier, 10,000 characters unused — verified live). The vault keeps one item per
   provider and overwrites in place (`keychain.write` uses `-U`), so the old exhausted
   key cannot resolve from anywhere in this repo. If the user mentions the old key
   again, the only thing left to do with it is revoke it in the ElevenLabs dashboard —
   nothing on this machine still holds it.
3. The ten-second chain check that would have caught every one of the four figure-lane
   breaks: re-resolve `cardiac8`'s own storyboard —
   `npx tsx packages/pipeline/src/drawcheck.mts projects/cardiac8` — and confirm
   `lane: figure ×3` (the `asset/v5` fix). If it says `library`, stop: the substitution
   bug is back, fix it before anything else.

## Phase 1 — the figure film (the render that proves the chain) — ~$1.20

Everything is built; no film has ever contained a figure. Four separate silent breaks in
this exact chain are on record (`STATUS.md` 2026-08-06 "four for four"), so the phase is
a verification ritual, not a code change.

1. **Lesson only** — call `designLesson` from `@inkcast/pipeline` (~$0.06) on the cardiac
   prompt. Then `npx tsx packages/planner/src/lanecheck.mts <lesson.json>`:
   expect `figure` on the beats that need to see inside the heart (the AV-delay beat and
   the Purkinje beat at minimum), `draw` on the timing chart, distinct prompts over
   distinct ids. **If the author chose zero figures**, iterate the brief only — three
   variants of `UNDERLAY_ADVICE` cost less than one render — and remember the recorded
   recipe: lead with `figure`, make `form` the exception, state a rule ("a lesson about a
   real object carries at least one figure on the beat where the learner first sees
   inside it"), never end on cost. Bump `STAGE_CODE_VERSION.lesson` in
   `packages/pipeline/src/keys.ts` with any brief edit — the brief is not in the cache key.
2. **Compile and count** — compile the lesson, count `Asset.kind === 'figure'`; resolve
   visuals with `drawcheck.mts` and count `lane: figure` with distinct ids. Both counts
   must match step 1's expectation **before** voice or render runs.
3. **Render** — full `cast`, then:
   `npx tsx packages/render/src/inkstat.mts projects/<p>/out.mp4` (expect ≥ 10%, ≥ 3 hues)
   and **open the frames at each figure beat** (`frames.mts`, ~76 ms/frame; copy
   `storyboard.resolved.json` over `storyboard.json` first). Check: the reveal is the
   roughened sweep, not a fade; no white card seam (multiply blend); no letterbox; labels
   sit in the clear margin with leaders reaching the parts they name.
4. **Aim check, by eye** — the audit still cannot see a mark that misses the thing it
   names (`HANDOFF.md`'s blind spot). For every figure card, ask of the frame: does each
   leader end on the structure it names? Record the answer in `STATUS.md` either way.

_Gate to Phase 2:_ a committed contact sheet of the figure beats beside the Golpo frames,
and `inkstat` ≥ 10%. If the model tier disappoints, `INKCAST_FIGURE_MODEL` swaps the
endpoint without a code change (`flux/dev` default; `nano-banana` for marker style).

## Phase 2 — wipe the board: one idea, one card (free until the final render)

`PLAN-FIGURE-LANE.md` item 4, now unblocked because the card being framed is worth
framing. Golpo wipes to an empty board between every card (their frame at 41s is blank)
and the subject then owns ~60% of the frame. Ours accumulates all 179 elements and pulls
the camera back until the recap is postage stamps.

1. **A preset knob, not a new default.** `board: 'wipe' | 'accumulate'` on the preset,
   default `accumulate`. The two shipped lessons must stay **byte-identical at both
   presets** (`sbhash.mts` stash-diff, the exact ritual in `HANDOFF.md`) — that is the
   regression gate for this whole phase.
2. Under `wipe`: elements default `persist: false` (mechanism exists —
   `page/runtime.js:891-895` gives a 0.2–0.55s fade); the fade starts **before**
   `Scene.hold`, not after, so the pause reads as "look at the finished card" rather than
   "watch it die"; `regions.ts` stops building a grid when nothing accumulates — one
   cell, framed to the card's ink.
3. **Both camera systems move together or nothing moves.** `resolveFraming`
   (`core/src/camera.ts`) re-derives every camera from accumulated region ink and
   overwrites the planner's zoom (`PLAN-FIGURE-LANE.md` §7). Under `wipe`,
   `persistingBounds` must exclude faded elements, or the frame will keep widening for
   ink that is no longer there.
4. **The recap redraws its summary.** Under `wipe` there is nothing to zoom out over, so
   the recap must be a beat that draws its own card — the compiler's `findReuse` path is
   the shape of it. Golpo's recap is one whimsical full-colour card, not a survey.
5. `render/src/page.test.ts:371` asserts the board never wipes. Change it deliberately —
   split into "an accumulating board never wipes" and a new wipe-mode assertion.

_Gate to Phase 3:_ frames at three scene boundaries (empty → new card), the recap frame
readable at 1×, and `inkstat` on a wipe-mode render of the Phase 1 lesson ≥ 12%. Pinned
lessons byte-identical.

## Phase 3 — script economy: say it in 60–90 seconds (~$0.25 in lesson calls)

Same content: they spend ~145 words, we spent 348 plus 26.8s of silence. The delivered
in-speech rate was fine (142 wpm); the film is slow because it says too much and stalls
between scenes.

1. **An `explainer` preset** (or retune `short`): word budget stated **in words** in the
   brief (~160, the estimator already counts words — `STATUS.md` 2026-08-05), ≤ 8 beats,
   and hold ceilings 0.5–0.8s except after the payoff beat. The brief rule that already
   works: one beat, one assertion. `derivedFrom` is binding in `adaptLesson`, so the
   budget must be met by the **author writing less**, not by the trimmer cutting — verify
   `lessonProblems` is empty, not that the duration merely came out right.
2. **Titles are assertions.** Each beat carries a ≤ 6-word claim ("THE DELIBERATE AV
   DELAY", not "AV node"), written as the card's heading. This is a lesson-brief change
   plus the existing caption machinery; the typography is Phase 5's job.
3. **Boundary silence.** The ~1s wall at every scene change is hold + camera transition
   stacked. Under `wipe` the transition is a fade, so cap the sum: boundary dead air
   ≤ 0.7s. Do not slow speech to compensate — `phrase.ts` records that pushing rate below
   the 140–160 band made things worse, and Golpo's own pauses are 0.36–0.55s, graduated.
4. Bump `STAGE_CODE_VERSION.lesson` (brief change, again). Verify cheaply:
   `designLesson` ×2 topics → word count and beat count; `sbjson.mts` → storyboard;
   render once with kokoro (free) → `silencedetect` total ≤ 8%.

_Gate to Phase 4:_ a kokoro render of the cardiac prompt at 60–90s with ≤ 8% silence,
`tandemcheck` lead ≤ 8% and span ≥ 70% (i.e. economy did not break sync).

## Phase 4 — the voice: honest, paid, and continuous (~$0.15, unblocked)

The comparison everyone has been making was against our **free local** voice. The
ElevenLabs continuity work (`previous_text`/`next_text`, pinned `stability: 0.55`,
`DELIVERY_SIGNATURE` in the scene key) has never been heard in a finished film.

1. **Record the truth.** The voice adapter must return the provider and model it
   _resolved to_; `pipeline.json` writes that, and the cost line prices the actual
   provider (kokoro = $0.00). Unit-test with a stubbed provider that fails over: the
   manifest must say kokoro and bill zero. This is the defect that booked $0.43 for
   audio that cost nothing.
2. **Fallback is loud.** Quota exhaustion mid-run degrades to kokoro today with nothing
   in the summary. It must land in stderr **and** in `pipeline.json`'s problems, in the
   exact shape of the existing `lessonProblems`: `voice fell back to kokoro (elevenlabs:
quota_exceeded)`.
3. **Flash model.** `eleven_flash_v2_5` — the model id is a constant in
   `voice/src/providers/elevenlabs.ts` — halves the per-minute price at similar quality;
   voice was 86% of the last full bill and the README's $0.20/min target is currently
   missed at $0.21/min on turbo pricing alone.
4. **Credits are live, and they are a budget.** The user replaced the exhausted key on
   2026-08-08; the vault key (`sk_79…7960`, verified against `GET /v1/user/subscription`)
   is a **free-tier account with 10,000 characters remaining, 0 used**. The `cardiac8`
   script was 1,948 characters, so that is ~5 full voicings at v2 pricing — roughly
   double that once item 3 lands, since flash bills 0.5 credits/character. Spend them on
   acceptance renders, not iteration: every timing and pacing question is answerable on
   kokoro first, and re-checking the balance is one call to `/v1/user/subscription`
   before each keyed voicing.
5. Re-voice the Phase 3 lesson (`rerender` reuses everything else),
   listen to one scene boundary and one long sentence for splice seams, and check
   `voice`'s stage version — the effective phrase-split mode is already in the clip key
   (`voice@7`), so nothing needs a bump for cached kokoro clips to be replaced.

_Gate to Phase 5:_ `pipeline.json` shows resolved `elevenlabs/eleven_flash_v2_5`, voice
cost ≈ $0.11/min, and a listening note in `STATUS.md` (there is no tool for prosody;
say what you heard).

## Phase 5 — the craft layer: titles, colour type, and the two-scales bug (free)

What makes their frames read "professional" at a glance is typography, not anatomy.

1. **Kill defect 0 first** (`HANDOFF.md` known defects): the planner sizes text from
   `FONT` in `planner/src/elements.ts` and the renderer draws it 18% bigger from
   `TYPE_SCALE` in `core/src/camera.ts` — two catalogues of one number; `empty stack`
   rendered as `empty stac`. Make one import the other. This is the cheapest real fix in
   the repo and it precedes any new type role, or the new role inherits the bug.
2. **A `title` role**: ~1.6× caption scale, drawn first on the card, with a hand-drawn
   underline stroke (a `line` prim, not a text decoration). The letter-by-letter write-on
   already exists — text is revealed as it is spoken today.
3. **Keyword colour**: the lesson author marks 1–2 terms in a title; the compiler splits
   the title into segments, each its own text element with `tone: accent | contrast`
   (`Tone` exists on `ElementBase`; `toneInk()` maps it). Segment layout uses
   `measureText` — remember the trap: it is an estimate good to ±3% of canvas, so keep
   the 1.5× slack and never butt segments tight.
4. **The label-through-label frame** (`cardiac8` at ~20s: "spark spreads…" typed through
   "spark starts here"): reproduce it with `frames.mts` first, then find why
   `repairLabels` did not see it (different beats? underlay-margin labels exempt?). Fix
   with a test that pins the pair. Do not guess at the cause in the plan; look first.
5. Bump `STAGE_CODE_VERSION.storyboard`. Pinned lessons carry no `title` field, so they
   must stay byte-identical — that is the phase's regression gate, same ritual as ever.

_Gate to Phase 6:_ one rendered card whose title has a coloured keyword and an underline,
no clipped strings anywhere on the twelve-subject `drawsheet` run, pinned lessons
byte-identical.

## Phase 6 — stretch, only after all gates: the mascot and the finale card

Golpo uses a recurring character exactly three times — hook ("This is your heart's
natural PACEMAKER", speech bubble), payoff (thumbs-up with a stopwatch beside "AV DELAY:
ventricles filling with blood"), finale ("One perfect electrical dance"). It is an
emotional anchor, not decoration, and it is why the film feels authored.

- The rig exists (`characters/explorer`, five poses, pose-per-beat proven in the
  longitude lesson). What is missing is a **speech-bubble intent** (ellipse + tail +
  text, compiled like any drawing) and a brief line offering the pattern: hook, payoff,
  finale, never more.
- The finale is a `figure` card by construction — one warm full-colour image with a
  banner title. That is already just Phase 1 + Phase 5 machinery pointed at the recap.
- Do not attempt their outline-then-colour two-stage reveal. The raster sweep already
  reads as drawing, and generating two consistent renderings of one subject is a
  research problem, not a phase.

## Traps, inherited and new — read before every phase

- **A capability is shipped when the stage that has to ask for it actually asks.** Four
  for four on the figure chain. Compile-and-count before every render; the check is ten
  seconds and free.
- **`pipeline.json` lies about the voice today** (requested, not resolved). Until Phase 4
  lands, confirm the provider from the artefacts: kokoro writes 24 kHz PCM scene WAVs.
- **Do not trust `fillcheck` for density** (21.6% where pixels say 4.7%). `inkstat.mts`
  or nothing.
- **A measurement a fix can game will be gamed.** Before believing any number moved,
  open the frame. Every defect worth fixing in six sessions was found in a PNG.
- **The brief is not in the lesson cache key.** Every brief edit needs
  `STAGE_CODE_VERSION.lesson` bumped or the change silently never happens.
- **Both camera systems or neither** (Phase 2). `resolveFraming` overwrites authored
  zooms; changing the planner's half alone changes nothing.
- **`pnpm lint` is `prettier --check .` and it gates `docs/*.md` too** — including this
  file.
- **`git stash -u` takes untracked tools with it.** Commit measurement tools before
  using them in a stash-diff.
- **Keep the pinned lessons byte-identical through every phase.** They are the only
  proof a presentation change did not silently rewrite every existing video.

## The one thing to hold on to

Golpo is four ordinary decisions executed together: a strong image model, one wiped card
per idea, a 60-second script, and a continuous paid voice. This repo has now built or
diagnosed all four — **and no render has ever had them switched on at once.** `cardiac8`
had none of them. The job is not to invent anything; it is to connect what exists and
verify at every seam, because the record says the seams are where this pipeline fails
silently.
