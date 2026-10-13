# PLAN-GOLPO-CLOSE — turn the built machinery back on, stop the blank paper, and ship density

**Status: NOT STARTED. This document is the order of work.**

**Audience:** an executing agent (Opus-class) with repo access. Every implementation
dilemma this plan touches has already been decided; decisions are marked **DECIDED**
with their rationale. Do not re-open them, do not re-measure what is already measured,
and do not substitute your own judgment on marked decisions. Where a step says
_investigate_, the scope of the investigation is stated and bounded.

**Written 2026-08-27**, after a frame-by-frame dissection of four Golpo reference
videos (two 720p, two 1536×864) against this repo at `bdf9251` on
`visuals-morph-density`. The dissection evidence is summarised in §1 so you do not
need the videos.

---

## 0. Read this first, in this order

1. This file, all of it, before touching anything.
2. `docs/STATUS.md` — the **last two sections** (gate-1 dissection, and the Aug 27
   "half the film is blank paper" finding). This plan builds directly on both.
3. `docs/HANDOFF-GATE-ONE.md` (the fill arithmetic — "the one mechanical fact").
4. `docs/HANDOFF-THREE-GATES.md` (current gate standings).
5. `docs/CONTRACT.md` §"boards" (lines ~44–88): the original no-wipe clause and its
   amendment. This plan re-amends it; you must know both versions.
6. `docs/PIPELINE.md` §CLI before running any cast.

**Baseline before any edit** (record the output in your working notes):

```
pnpm -r build && pnpm -r test && pnpm typecheck && pnpm lint
pnpm --filter @inkcast/pipeline exec tsx src/auditcheck.mts
```

Expected: ~1172 tests green (3 keyvault skips), auditcheck 111/111. If baseline is
not green, stop and report — do not fix unrelated breakage inside this plan.

**Evidence projects you must never re-cast, mutate, or delete:**
`projects/c5caa09eb153` (the blank-paper repro — this plan's Phase 1 exists because
of it), `projects/f3ac9c760194` (acceptance film), `projects/qc81-longitude`,
`projects/qc91-heal`, `projects/qc91-longitude`, `projects/qc92-chalk`. When a phase
needs a re-cast, cast into a **new** project id.

**Cost envelope:** casts with keyed providers run ≈ $0.70 each (Anthropic key is
funded; ElevenLabs is free-tier — premade voices only, the adapter substitutes
automatically). Drawing-lane probes (`drawsheet.mts`) ≈ $0.02 each. This plan needs
roughly 5–7 keyed casts end to end. Do not run casts in a loop.

**Docs hygiene:** run `pnpm exec prettier --write` on every doc you touch. Commit per
phase, message style matching `git log` (plain descriptive sentence, no conventional-
commit prefixes).

---

## 1. Why this plan exists — what the dissection established

Measured from the four reference videos (frame extraction at 1/9–1/45 fps, consecutive
bursts at 3 fps, frame-pair luma diffs):

- **Zero hard cuts in any video.** One persistent canvas; content only accumulates.
  Scene changes are camera pans/zooms over the canvas. Mid-pan frames show labels
  clipped at the viewport edge because they physically exist off-frame.
- **Camera is near-frozen while ink appears**: frame pairs 2s apart during dwell
  differ by mean luma 0.14–0.39 (out of 255). Also proves strokes are seeded once —
  no re-roll "boiling".
- **Reveals are word-synced and literal**: text types in letter-by-letter mid-word
  ("Basi…", "RSA L…", "Edge of Su…" → completes to "Sunlight" three frames later —
  the external audit's "truncated label D2" was a mid-typewriter sample, not a bug).
- **A style pack per topic**: navy blueprint (day/night), neon-on-black chalkboard
  (quantum), painterly parchment with diffusion-raster portraits revealed
  blur-to-sharp (mythology), red-ink whiteboard (Schliemann). Common DNA: dark or
  textured ground, 4–6 inks, hachure-filled shapes, huge underlined titles,
  illustration-grade assets. Their ink is **fat** — filled regions, not outlines.
- **Never a blank held frame.** Something is always drawing, or the camera is already
  moving.

Against this, the repo's state (all verified in code, not from docs):

- The persistent canvas, pan/zoom camera (`resolveFraming`,
  `packages/core/src/camera.ts:369`), stroke-dashoffset reveal
  (`packages/render/src/page/runtime.js:678`), and word-index cue anchoring
  (`packages/voice/src/cue.ts:19`) **all exist and are tested**. An older
  `accumulate` project (`projects/qc64-gd`) has a 4448×2908 canvas and 7 distinct
  cameras.
- The studio-default `explainer` preset sets `board: 'wipe'`
  (`packages/planner/src/presets.ts:389`), which collapses layout to one card per
  beat (`packages/planner/src/regions.ts:283` → `oneCardBoard`), marks every element
  non-persistent (`packages/planner/src/compile.ts:575` `applyBoardMode`), and
  freezes the film to **one** camera. The two newest films each have exactly 1
  distinct camera across 8–10 scenes.
- `packages/voice/src/narrate.ts:1193` overwrites the preset-capped hold with a
  reading-time extension of up to `MAX_READING_EXTRA = 5` s **per scene**
  (`narrate.ts:574`), while `wipeFadeAt` (`packages/render/src/compile.ts:857`)
  fades all ink out **the instant narration stops**. Together: the board blanks, then
  the film sits on empty paper for the whole extension. `projects/c5caa09eb153`:
  96.9s film, 44.3s speech, 51.6s hold, 25 of 48 sampled frames under 0.5% ink,
  median frame coverage 0.0%.
- We ship one light-paper look, ~1 hue, spindly outline ink (parity doc: our 5.0% ink
  and 1 hue vs their 14.4% and 6 on the same topic).

**The verdict this plan implements:** the gap is not missing machinery. It is (a) one
live bug at the voice/render seam, (b) a default preset that amputates the
architecture the contract itself calls load-bearing, (c) thin ink that made the fill
metric prefer the amputation, and (d) absent art direction. Fix in that order.

---

## 2. Phase 1 — stop the blank paper

Highest priority. Independent of every aesthetic choice below; do it even if the rest
of the plan is abandoned. Two coupled edits plus a detector plus re-verification.

### 1.1 Ink stays up through the hold (render)

**File:** `packages/render/src/compile.ts`, function `wipeFadeAt` (~line 857).

Current final return:

```ts
return anchor.start + anchor.speech + span;
```

**Change to** (fade _ends_ at the anchor scene's end instead of _starting_ at speech
end; never begins before the narration has finished):

```ts
return Math.max(anchor.start + anchor.speech, anchor.start + anchor.dur - span);
```

Keep the short-hold fallback branch (`anchor.hold < span`) exactly as is. Rewrite the
function's doc comment: the rule is now "a wiping board's ink goes out so that the
fade **lands on the beat's end** — the hold is reading time for the finished board,
and the paper is blank only for the fade itself." Preserve the existing paragraph
about `persistUntil` anchors verbatim; it is still true.

**Trap:** the comment above `fadeSpan` (~line 830) says the span formula is
duplicated in `packages/render/src/page/runtime.js` (~lines 1080–1087, the
`!item.persist` branch). You are changing the fade **start**, not the span. Verify
the runtime consumes `item.fadeAt` when present and only derives its own window when
`fadeAt` is absent. If the runtime independently derives the start from scene speech
anywhere, change it to honour `fadeAt`; the span formula itself must stay identical
in both places.

**DECIDED** — why fade-at-end and not "keep fade at speech end and kill the hold":
the reading-time extension's purpose (let the viewer read the finished board) is
correct; it was incoherent only because the board vanished first. A short beat of
blank paper as punctuation survives via the fade span itself (0.2–0.55s).

### 1.2 The extension only buys reading time, never estimated pen time (voice)

**File:** `packages/voice/src/narrate.ts`, function `allowReadingTime` (~line 607).

Current:

```ts
const need = serializePen(slots, { length, speech: timing.narrationSec }).wanted + tail;
```

**Change to:**

```ts
const need = serializePen(slots, { length, speech: timing.narrationSec }).lastFinish + tail;
```

`lastFinish` and `wanted` are both fields of `PenSchedule`
(`packages/core/src/inktime.ts:437` and `:446`). Leave `MAX_READING_EXTRA = 5` as the
outer bound. Update the function's doc comment and the `PenSchedule.wanted` comment
in `inktime.ts` (which currently argues the voice stage should use `wanted`) to
record the reversal and cite this plan.

**DECIDED** — why `lastFinish`, not `wanted`, and not deleting the function:

- `wanted` is uncompressed pen time computed from `estimateInkCost` over **authored
  boxes** — an estimator that has never been validated against the renderer's real
  pace, and which measured 45s of demanded silence on a film whose compile authored
  6.3s. Policy must not stand on an unvalidated estimator.
- `lastFinish` is bounded by the scene's own length, so estimator error cannot blow
  the film budget. The only extension left is `tail` = `readingTail(words, length)`
  (`inktime.ts:408`), which is derived from exact word counts and already capped at
  `MAX_READ_SHARE` (0.45) of scene length.
- The "uncompressed pen" goal `wanted` served is met differently now: 1.1 makes held
  time show the finished board, and Phase 2's accumulate removes the wipe deadline
  entirely. The reference product's pen is visibly fast (compressed) and it reads
  fine.
- Do not delete the function: the reading tail it guarantees is exactly the dwell
  the gate-1 dissection found missing on six of ten scenes.

**Trap (cache):** `allowReadingTime` is append-only on the clip — a re-run finds the
beat "already that long" and appends nothing. It never trims. So a project whose
clips already carry the old 5s extensions will keep them under the new formula.
Never try to heal an existing project in place; Phase 1 verification casts fresh ids.
`authoredHold` in the sidecar (`narrate.ts:293`) keeps cache keys stable — do not
touch it.

### 1.3 A blank-paper detector in QC

**File:** `packages/render/src/check.ts` (blocking checks enumerated ~lines 153–196).

Add an **advisory** check `blank-run` (advisory now, promoted in Phase 6): fail when
any run of ≥ 2.0 s of consecutive sampled frames has ink coverage < 0.5%, excluding
the first 1.0 s of the film and the outro (`meta.outroSec`). Reuse whatever frame
source the existing `vacant` check reads; `packages/render/src/inkstat.mts` is the
reference for how frame ink coverage is measured (the repo explicitly distrusts
`fillcheck` for density — see the traps section of `docs/PLAN-GOLPO-PARITY.md`).
Report the worst run's start time and length in the QC report. Add a unit test with
a synthetic timeline (a held scene whose items all faded) proving it fires, and one
proving the outro exclusion.

### 1.4 Re-verify on the repro topic

Cast the **same lesson** as `projects/c5caa09eb153` (day and night — read its
`lesson.json` for the exact topic string) into a fresh project id with the default
`explainer` preset, keys on. Acceptance for Phase 1, all measured, none eyeballed:

- Film duration within 60–90 s (gate 8's band; c5caa09eb153 was 96.9 s).
- `blank-run` reports zero runs.
- Frame ink coverage (via `inkstat.mts` over a `frames/` dump): **median > 1.5%**
  (was 0.0%), mean ≥ 4% (was 1.9%; competitor mean on this topic is 5.7%).
- All 21 strict QC checks still pass (`qc.json` ok).
- `pnpm -r test` green.

Record before/after numbers in `docs/STATUS.md` (new dated section, matching the
style of the existing ones). Note in the same section that gate 8's earlier closure
is re-verified (STATUS's Aug 27 section withdrew it).

---

## 3. Phase 2 — the persistent board becomes the default again

### 2.1 Flip the preset

**File:** `packages/planner/src/presets.ts`, the `explainer` preset (~line 373).

Change `board: 'wipe'` → `board: 'accumulate'`. Leave every other field of
`explainer` untouched — including `maxPerRegion: 3` (real again under accumulate),
`maxHold: 0.8`, `captionRole`/`captionWords` (the type-role warning in the preset
comment still stands; type scale is Phase 3's problem and only barely).

Rewrite the preset's `board` comment paragraph (the "A3" paragraph, ~lines 356–366).
The new text must record, in the file, why the amendment is reversed:

- The 55.5% → 62.3% fill measurement that justified `wipe` was made with a metric
  whose `cover` term is a bounding-box union blind to lines, arrows, and label-heavy
  cards (`docs/HANDOFF-GATE-ONE.md`); it rewarded exactly the wrong thing.
- The reference product's strongest film (89.5 s, its shortest) **is** a board tour;
  "at 90 seconds or less there is no board tour worth taking" is contradicted by the
  best available evidence.
- `wipe` + the reading-time extension produced the blank-paper film
  (`projects/c5caa09eb153`, `docs/STATUS.md` Aug 27) — under `wipe`, every second
  bought for reading is a second of empty board risk; under `accumulate` it is free.

`deepdive` (~line 422) stays `wipe` for now — **DECIDED:** flip it only in Phase 6,
after the explainer bars hold, as a one-line follow-up. `--board wipe` must keep
working as an override (`resolvePreset` already supports it; do not remove).

### 2.2 Re-amend the contract

**File:** `docs/CONTRACT.md`, the amended board clause (~lines 54–79). Restore the
original no-wipe position as the default posture, keep `wipe` documented as an
opt-in mode, and record the date and the two-sentence reason (metric artifact +
blank-paper film). Do not delete the amendment's text — supersede it the way the
file already handles superseded clauses (read how it records its own history first;
follow that convention).

### 2.3 What comes back for free — verify, don't build

Under `accumulate`: `planBoard` lays real regions again, `resolveFraming` walks the
board (`walkWindow`, `packages/core/src/camera.ts:291`, pan-speed cap
`MAX_VIEWS_PER_SEC` at `:518`), and the recall/back-reference machinery re-arms
itself (`packages/planner/src/refer.ts:236` gates it off only under `wipe` — the
recall work from PLAN-RECALL-FIX has been dormant under the default preset since it
landed). Nothing to implement here; your job is to confirm each on the Phase 2 cast:
storyboard has > 1 region, > 1 distinct camera, and at least one recall/emphasis
element when the lesson's structure warrants one (`sbjson.mts <lesson> <dir>
explainer` shows all three).

### 2.4 Gate-1's fill bar is suspended under accumulate

**DECIDED:** the 35%-mean / 14%-min bar was derived under `wipe` and its arithmetic
(`fill = safe area 76.5% × shape match × cover`, `whyThin` at
`packages/core/src/camera.ts:577`) is a per-card decomposition that does not
describe a toured board. Do **not** chase 35% under accumulate, and do not "fix"
drawings to satisfy it. Instead: measure fill on the four lessons named in
`docs/HANDOFF-GATE-ONE.md` under accumulate (`sbjson.mts` + `fillcheck.mts`), record
the numbers in STATUS, and leave the bar's re-derivation as an explicit open item
for after Phase 3 lands (fat ink moves it; deriving it twice is waste). The binding
density checks in the meantime are `blank-run` (1.3) and frame ink coverage via
`inkstat.mts`. `reportFill`'s existing warn thresholds
(`packages/core/src/camera.ts:668`) stay as they are — they are advisory.

### 2.5 A/B acceptance

Cast the Phase-1 topic once more, same fresh-lesson inputs, `--board wipe` override,
so you hold a same-day wipe/accumulate pair. Acceptance for Phase 2:

- Accumulate film: ≥ 3 distinct cameras (count distinct `{x,y,zoom}` tuples in
  `storyboard.json`), ≥ 2 regions, zero `blank-run`s, canvas larger than the frame.
- Accumulate mean frame ink coverage ≥ the wipe film's (the whole argument is that
  accumulation is denser; if this fails, stop and report with the numbers — do not
  proceed to Phase 3 on a false premise).
- Duration still inside 60–90 s. Strict QC passes. Contact sheets for both
  (`frames.mts`) saved under `renders/` and referenced from STATUS.

---

## 4. Phase 3 — fat ink

The metric episode (gate 1) happened because our marks are spindly outlines. The
reference's density comes from per-element ink weight: hachure fills, solid shapes,
multi-ink tone. Three bounded edits — **no type-scale changes in this plan** (the
preset comment's warning stands; `TYPE_SCALE` at `packages/core/src/camera.ts:721`
is not touched).

### 3.1 The drawing brief asks for filled solids

**File:** `packages/planner/src/draw-anthropic.ts`, `DRAW_BRIEF` (~line 89).

The `hatch` primitive already exists (`:101`) with a measured don't-write-inside-it
rule (`:122`). Add one rule to the brief, after the existing hatch rule, verbatim:

> - **A THING WITH A BODY GETS A BODY.** A drawing that depicts a solid object — a
>   ball, a block, a planet, a wall, a container, a region of material — shades it
>   with `hatch` or closes it as a filled shape. Outlines are for relations
>   (boxes-and-arrows, axes, flows), not for things. A drawing of objects in which
>   every shape is an empty outline is a wireframe, and a wireframe is a defect.
>   Shade at least the one shape the beat is about. The no-writing-inside-hatching
>   rule above still applies — shade the body, label from clear canvas.

Do **not** copy this into the figure-variant brief (`:239` area) — its `NEVER SHADE`
rule (`:251`) is a measured defect fix for marks drawn **over** raster figures and
must stay.

Verify with the drawing-lane harness, not a cast: pick 3 object-y instructions from
the cached corpus (`markcheck.mts cache` lists drawings with their cover), run
`drawsheet.mts <dir> "<instruction>"` before/after (~$0.02 each), and confirm the
after-drawings carry ≥ 1 hatched/filled region and their `cover` (per `markcheck`)
rose. If a drawing got worse (illegible, hatch under label), report with the PNGs —
do not iterate the brief more than twice; two dead brief-persuasion levers are
already on record (`08b680a`, `8cb712f`), and a third failure means the lever is the
schema (make `hatch` usage a structured requirement), which you should propose, not
build.

### 3.2 Shapes that can fill, fill

**Investigate (bounded):** `packages/render/src/sketch.ts:719` says `hachurePolygon`
is "used for `fill: true` shapes". Find who sets `fill` on `shape` elements
(`storyboard.ts` schema, then grep the planner). If the planner never sets it, wire
it: a `shape` whose role is depicting a closed solid (the planner knows this at
`buildBeat`-time from the mark type: `rect`/`ellipse` marks routed as bodies, not as
frames/containers around text) gets `fill: true`. If ambiguity is irreducible at
that site, the fallback **DECIDED** wiring is: `hatch` marks from 3.1 are the fill
path and shapes stay as they are — 3.1 alone is acceptable, note it and move on.
Style packs already carry the fill texture (`rough.fill` in `styles/marker.json:43`
and `styles/chalk.json`).

### 3.3 Tone distribution measured

**Investigate (bounded):** find where element `tone` is assigned in the planner
(grep `tone` in `packages/planner/src`). Measure hue count on the Phase-2
accumulate film the way `docs/PLAN-GOLPO-PARITY.md`'s evidence table did. If the
film uses < 3 of the pack's tones (`ink`, `inkSoft`, `accent`, `contrast`), assign:
titles/headings → `accent`, the beat's contrast object or counter-example →
`contrast`, annotations/labels → `inkSoft`, body marks → `ink`. If a rule like this
already exists and is simply starved (e.g., only fires on emphasis), widen it there
rather than adding a second assignment site. Acceptance: ≥ 3 tones present on ≥ half
the scenes of a re-cast, `ink-on-ink` QC still passing (contrast rail
`MIN_INK_CONTRAST` 4.5:1 is the guard — it is already blocking).

---

## 5. Phase 4 — a second look, and a router that picks it

### 4.1 `styles/blueprint.json`

Create the pack. Start from a copy of `styles/chalk.json` (the only shipped dark
board; its keying/compositing path is proven — plan 9.2). **DECIDED palette** (all
seven keys required by the pack schema — validate against
`packages/core/src/stylepack.ts:293`):

```json
"palette": {
  "paper": "#14304a",
  "ink": "#eef4f8",
  "inkSoft": "#9db8cc",
  "grid": "rgba(255,255,255,0.06)",
  "accent": "#53c8e8",
  "contrast": "#ff8a3d",
  "highlight": "rgba(83,200,232,0.18)"
}
```

(That is the reference's day/night video: navy ground, white primary ink, cyan
accent, orange contrast.) `rough`: copy marker's, set
`fill: { "style": "hachure", "weight": 2.0, "hachureAngle": -30, "hachureGap": 10 }`,
`roughness` ≤ 1.6 (blueprint lines are cleaner than chalk). `pen.art`: copy chalk's
pen geometry unchanged (drawing a new pen sprite is out of scope). **Font — DECIDED:**
reuse an already-vendored hand font (`Gaegu` unless another vendored face fits
better); adding a new font means vendoring metrics for
`packages/core/src/fontmetrics.ts` and is explicitly out of scope — leave a one-line
note in the pack description that the face is a placeholder for a technical-mono
hand.

Checks: the stylepack test suite must pass; contrast of every palette pair used by
`ink-on-ink` must clear 4.5:1 against `paper` (compute it, don't eyeball —
`inkSoft` on `#14304a` is the tight one; darken `paper` before lightening `inkSoft`
if it misses). Dark-board figure keying engages automatically —
`packages/visuals/src/image.ts:1234` routes composite by paper luma, and #14304a is
well under the 0.5 midpoint. Render one keyed figure on it via `figuresheet.mts` to
confirm (the qc92-chalk pattern).

### 4.2 The lesson picks a pack

**DECIDED shape:** the lesson stage emits an optional `style` field, enum of the
served pack ids, on its existing tool schema (`packages/planner/src/schema.ts` —
note `STAGE_OWNED` pruning and follow the file's conventions; `style` is authored,
not stage-owned). Precedence, implemented wherever `meta.style` is currently
resolved (`packages/pipeline/src/stages.ts:81` area): explicit user choice (CLI
`--style` / studio picker / API) → lesson's `style` → current default. The brief
text for the field, verbatim:

> Pick the board this subject would be taught on. `blueprint` — engineering,
> physics, astronomy, geography, anything with mechanisms, forces, or maps.
> `chalk` — mathematics, computer science, anything derivation-shaped. `marker` —
> processes, comparisons, everyday topics. `pencil` — history, biology, anything
> organic or narrative. When unsure, `marker`.

One cast on a physics-or-geography topic verifies the router picked `blueprint`
without a CLI flag. Also verify the studio still serves packs
(`/api/providers` `caps.styles` — `apps/web/components/studio/options.ts:9` says
`INK_STYLES` is only the offline fallback; the new pack must appear in the served
list, so check what serves it and add `blueprint`).

### 4.3 Out of scope for this plan

Painterly/parchment (diffusion-raster-led) packs, textured paper grounds, new pen
sprites, new fonts. Record them in the STATUS entry as the identified remainder of
the art-direction gap. Do not start them.

---

## 6. Phase 5 — figures stop being stickers on light boards

The acceptance film's raster figures sit in visible grey-white rectangles on the
paper (`renders/acceptance-f3ac9c760194/contact-sheet.png`, drop-test and feather
panels). Dark boards already key figures to real alpha
(`keyFigureToSurface`, `packages/visuals/src/image.ts:1286`); light boards still
`multiply` the whole rectangle in (`:1455–1458`), which only disappears when the
raster's ground is pure white — and the generators return warm greys.

**DECIDED:** route **all** boards through `keyFigureToSurface`; `multiply` remains
only as the fallback when keying returns `undefined` (its existing failure mode).
The "light boards stay byte-identical" preservation from plan 9.2 is hereby spent —
it was a caution, not a contract. Implementation is at the two-composites switch
(`image.ts:1455` area): remove the luma branch for the keying decision, keep it if
the _re-lighting_ step is dark-specific (read `keyFigureToSurface` first; if its
re-lit output assumes a dark surface, add the light-surface path inside it rather
than branching outside).

Cache note: figure fingerprints include style/palette
(`packages/pipeline/src/cast.ts:1018`); if the composite mode is not part of the
fingerprint, keyed re-renders of cached figures will not regenerate — check, and if
stale-cache is possible, bump the relevant fingerprint input rather than calling
`clearFresh` ad hoc (see `docs/HANDOFF-AUDIT-CLOSE.md` on `isFresh`/`clearFresh`).

Acceptance: re-render the acceptance lesson into a fresh id; the two figure panels
show no rectangular ground (compare contact sheets); `qc92-chalk`-style dark-board
figures unchanged; strict QC green.

---

## 7. Phase 6 — re-derive the gates, close out

1. Flip `deepdive` to `accumulate` (one line + comment, per 2.1's rationale).
2. Promote `blank-run` from advisory to blocking in `check.ts` (it has now been
   advisory across every cast in Phases 1–5; if it ever fired on a good film,
   report instead of promoting).
3. Re-derive the gate-1 fill bar under accumulate + fat ink over ≥ 4 lessons
   (the HANDOFF-GATE-ONE four plus the Phase-1 topic); record the derivation the
   way HANDOFF-GATE-ONE does (per-beat decomposition, not just the mean).
4. The head-to-head: cast "how does day and night happen in your town" (the
   competitor's own title) with everything on — accumulate, blueprint routed by the
   lesson, keyed figures. Measure against the reference film's numbers from §1 and
   `docs/PLAN-GOLPO-PARITY.md`'s table. Publish the comparison (numbers + both
   contact sheets) as the closing section of `docs/STATUS.md`. The bar for calling
   this plan done, all measured:
   - 0 hard cuts (trivially true) **and** ≥ 3 distinct cameras.
   - 0 blank-runs; frame ink coverage mean ≥ 5.7% (their measured mean).
   - ≥ 3 tones on screen across the film; duration 60–90 s; strict QC 21/21.
5. Update `docs/HANDOFF-THREE-GATES.md` gate standings, mark the superseded
   sections of `docs/HANDOFF-GATE-ONE.md` as such (do not delete them), and write
   `docs/HANDOFF-GOLPO-CLOSE.md` recording what landed, what was reverted, and the
   trap list you actually hit.

---

## 8. Standing traps — read before every phase

- **`fillcheck` is not a density instrument.** Frame-level density is `inkstat.mts`.
  Fill (`whyThin`) is a camera/framing decomposition. Confusing them caused the
  wipe decision this plan reverses.
- **Never heal a cast in place.** The voice stage's clip extension is append-only;
  stale extensions survive re-runs. Fresh project ids for every verification.
- **`render 100% cached` on an unchanged re-cast is the cheapest regression check
  in the repo** — use it after cache-adjacent edits (Phase 5 especially).
- **Brief persuasion has failed twice** (`8cb712f`). One retry per brief edit,
  measured by harness, then stop and report.
- **Waivers W2 and W8** (`docs/AUDIT-FINDINGS.md` §5, `docs/HANDOFF-WAIVERS.md`)
  are not re-opened by this plan. `MIN_SCENE_FILL` stays at 8%.
- **Do not touch:** `fontmetrics.ts`, the MathJax equation path, the cue-resolution
  chain (`voice/src/cue.ts`), `authoredHold` cache-key semantics, the ONNX aligner.
  None of them are implicated in the gap.
- The external audit spec (`EXPLAINER_PIPELINE_AUDIT.md`, in the owner's Downloads)
  is background reading at most; its D2 defect is disproven (typewriter mid-sample)
  and its architecture is largely already built here. Do not run its checklist.

---

## 9. One-paragraph summary for the executor

Fix the seam where the voice stage buys reading time that the wipe then blanks
(Phase 1: `wipeFadeAt` fades at scene end; `allowReadingTime` extends by
`lastFinish + tail`, not `wanted + tail`; add `blank-run`). Flip the default board
back to `accumulate` and re-amend the contract (Phase 2). Make the ink fat enough
that density metrics and eyes agree (Phase 3). Add the blueprint pack and let the
lesson route topics to packs (Phase 4). Key figures to the surface on every board
(Phase 5). Re-derive the bars and run the head-to-head on the competitor's own topic
(Phase 6). Every phase has measured acceptance; cast into fresh ids; preserve the
evidence projects; report with numbers, not adjectives.
