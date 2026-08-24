# Handoff — continuing PLAN-AUDIT-CLOSE from Phase 5

Written 2026-08-22, at `693ce46`, branch `visuals-morph-density`; updated 2026-08-23
after all of Phase 2 landed (`182a342`), again after all of Phase 3 (`ae18d4b`), and
again 2026-08-24 after all of Phase 4 (`3566ac0`).
**The plan being executed is `docs/PLAN-AUDIT-CLOSE.md`** — read it
first; it is the work list, the coverage proof, and the exit criteria. This file only
says where execution stands, what a new session needs to know that the plan cannot, and
where the bodies are buried. The evidence base behind both is `docs/AUDIT-FINDINGS.md`
(the audit, run at `5f83bc4`, plus the W1–W6 waivers now written into its §5).

## Where things stand

**Phases 0, 1, 2, 3 and 4 are landed, tested, and committed:**

- `e515179` — the audit report, the plan, and the waivers (docs only).
- `693ce46` — all Phase 0/1 code. Whole repo typechecks, `pnpm -r test` green
  (~500 tests), `pnpm lint` clean.
- 2026-08-23 — **2.1, the one text-metrics stack** (the plan's progress block has the
  full inventory). `fontmetrics.ts` + `HAND_FONTS` now live in `@inkcast/core`; the
  planner measures with the real advance table (`handMeasure`, `setPlannerHand` called
  by `compileLesson`/`heuristicPlan`, default marker elsewhere); every
  chars-times-a-constant estimator is deleted (`ADVANCE`, `LABEL_SLACK`, `texAsGlyphs`,
  chars×13, ×0.6/×0.62, ×0.58); `texBox` is the one TeX estimator; render `Ctx` carries
  `hand`/`tracking`. All four pinned hashes re-pinned WITH frames rendered and compared
  (the reasoning lives in `pinned-hashes.test.ts`'s header — longitude's latitude
  headline lettering on one line instead of "…latitude / for free" is the visible win).
  Two fixtures were recalibrated because honest footprints changed the weights'
  arithmetic — `repair-log.test.ts` (label footprint 179→136 units made the escape
  affordable) and `draw-critic.test.ts` (the repair now genuinely fixes stacked labels,
  so "worse" is a broken-word defect instead). `auditcheck.mts` gained four A-4 lines
  and its S4-b line follows the moved file.
- 2026-08-23 — **2.2, one style table.** Colours live in `core/src/palette.ts`
  (`Palette`/`paletteFor`/`toneInk`, plus `highlight`); `render/palette.ts` re-exports
  and keeps pen personality; `visuals/style.ts` keeps per-style personality and
  composes colours from `paletteFor` — its four per-style colour sets are deleted. The
  blue accent `#2f6fed` won on frame evidence (the plot-role remap in
  `render/plot.ts` meant visuals' red `#d7263d` never reached a shipped pixel; the
  red is deleted, not aliased). The visuals mono accent→ink collapse died too — the
  film's mono accent was always `#39434f`. Mirror test:
  `pipeline/test/styles.test.ts`; S5-c line in `auditcheck.mts`. Dark-chalk-style
  colour packs are deliberately deferred to 7.3's StylePack loader.
- 2026-08-23 — **2.3, the board assertions.** `render/src/boardcheck.ts` (ink-on-ink
  sweep, off-frame check, overrun + advisory dwell), run by `compilePlan` on every
  plan through `gate(...)`; the cue-at-fraction-0 settle clamp in `itemsFor`;
  `.finite()`/positive extents on `Box`/`Point`. The scoping decisions (persistent
  solid ink only; one drawing's parts exempt — the `_v<n>_` id convention; plots and
  transients never settle-clamped) are argued in the module header and were learned
  from the wipe fixture's failures, not guessed. Red tests in
  `render/src/boardcheck.test.ts`; nine projects compile strict-clean.
- 2026-08-23 — **2.6, the fill gate — at a re-derived floor (mean < 18% / any scene
  < 11%), not the plan's 25%/14%.** After 2.1, shipped longitude re-measures 20.3%/
  13.8% and photosynthesis 21.8%/13.2% — bbox fill cannot separate them, so the
  plan's numbers would block a shipped lesson. Argued in W2 (updated) and the plan's
  progress block. `--degrade` overrides now persist: `plan.problems` →
  `RenderResult.problems` → `pipeline.json` `render.problems` (inherited on cached
  renders). This plumbing is also what 3.4 will ride.
- 2026-08-23 — **2.5, pan speed.** `resolveFraming` pass 3:
  `transition = max(floor, dist / viewWidth / MAX_VIEWS_PER_SEC)` (2.4 views/s at the
  incoming zoom — just above the corpus's fastest walk, so nothing reviewed slows),
  capped at 2.5s. Pinned in `camera.test.ts`; S7-b auditcheck line.
- 2026-08-23 — **2.4 + 2.7, which close Phase 2.** The legibility floor is
  `MIN_GLYPH_PX = 10` output px — corpus-derived (shipped minimum 10.9px on recap
  reveals; the plan's provisional 14 fails three reviewed reveals) — swept statically
  per scene/role by `compilePlan` (`glyphFloorViolations`) and against reality by the
  realized-layout report: `runtime.js` `layoutText` records post-shrink size/lines/
  fits per text item, `FrameCapturer.realizedLayout()` reads it over CDP, and
  `render()` sweeps it (`realizedTextViolations`) before frame 0 — strict blocks,
  degrade records into `problems`. The done-bar browser test (`page.test.ts`) builds
  a narrowed box that passes every compile check and fails from the realized report
  alone.
- 2026-08-23 — **all of Phase 3 (`ae18d4b`): QC is a stage.** The plan's progress block
  has the item-by-item inventory; the shape is a seventh stage `check` between visuals
  and render (`render/src/check.ts`) that writes `qc.json` (contract in
  `core/src/qc.ts`), re-runs the Phase 2 sweeps from the new `compileBoard`, runs
  `critiqueStoryboard` (`core/storyboard.ts`), and looks at eight sampled frames
  (`render/src/tier2.ts`) — all in one Chromium launch, blocking through `gate(...)`.
  Two new `StageOptions` channels carry what stages used to only log: `onProblem`
  (degradations → `qc.json`) and `onSpend` (billable calls → real, non-estimated cost
  lines). The Tier-2 vision pass and OCR diff are injected from
  `pipeline/src/frame-vision.ts`, advisory for one release, and skip with the real
  reason when there is no key or the key has no credit.
- 2026-08-23 — **the recap chain became a column** (`55b1147`), which is Phase-2 work
  that Phase 3's gate found: see the trap list at the foot of this file. All four
  pinned hashes re-pinned, with the diff and the frames in
  `pinned-hashes.test.ts`'s header.
- 2026-08-24 — **all of Phase 4** (`d18c67a`, `653bee8`, `ff4a712`, `3566ac0`): sync
  is exact and drift is measured. The plan's progress block has the item-by-item
  inventory; the shape is four things.
  1. **The narration normaliser lives in `@inkcast/core`** (`speech.ts`, was
     `voice/src/text.ts`) — the third instance of the 2.1/2.2 move, because
     `Enter.cueWord` is an index into its token stream and the _planner_ writes it.
     The tokeniser and the exact locator came with it; `voice/src/cue.ts` keeps
     placement, `voice/src/index.ts` re-exports the same names. Its tests moved to
     `core/test/speech.test.ts`.
  2. **4.4**: `foldScripts` + `stripLatex`, running _before_ `stripMarkdown` (markdown
     eats the underscores of `a_{1} + b_{2}`), plus Dirac notation and stage
     directions in `SYMBOLS`. The audit's six probes are pinned as exact strings.
     **This moved the voice cache key** — cached audio re-synthesises — and no
     storyboard, so the pinned hashes did not move here.
  3. **4.1 + 4.2**: `Enter.cueWord` end to end, written by `assignTiming`, read as a
     lookup, verified against the cue phrase beside it (in `critiqueStoryboard` and
     again in the voice stage). All four pinned hashes moved **purely additively** —
     30/23/47/38 `"cueWord"` lines, zero other changed lines, which is also the
     coverage proof. `COMPILER_VERSION` 3 → 4.
  4. **4.3**: `core/src/drift.ts`, called from `cast.ts`; numbers to `pipeline.json`
     (`drift`), findings to `qc.json` (`duration` blocking at `critiqueLesson`'s own
     1.25×, `pace-calibration` advisory at ±10%).

The plan's own header carries a progress block saying the same thing; keep that block
current as phases land. Per-phase detail also lives in Claude's project memory
(`audit-close-progress`), but this file and the plan header are the durable record.

**Verified end to end, after Phase 4:** strict no-key casts of _both_ shipped lessons
render clean with every Phase 2, 3 and 4 gate live — `projects/qc43-longitude/` and
`projects/qc43-gd/` record `"gates": "strict"`, `qc.ok: true`, no problems, and a
`drift` block. The Phase-3 pair (`projects/qc33-*`) said the same thing one phase
earlier, and `projects/qc41-*` are the Phase-4.1 pair the cue-index numbers were read
off. Those project directories are disposable evidence, not fixtures; the older
`audit-2p*` ones describe the tree as it was.

**The step-8 done-bar, measured on those casts:** 30/30 and 47/47 reveals placed "by
authored word index" with no fallback, and `synccheck.mts` reports 0 strokes landing on
the same frame as the one before — identical to the pre-4.1 baseline, because an index
resolves to the word the exact search was already finding. What changed is that
placement no longer depends on a tolerant search finding it. The way to re-check this
is not the render log (its info lines are suppressed at default level): call `narrate()`
over a cast project's cached audio and read the `placed N elements … M/N by authored
word index` line, which is what the numbers above came from.

**The corpus is not clean, and that is the point.** Running the gate over all 27 boards
in `projects/` (in `degrade`, so it reports rather than stops) on 2026-08-23:

| what fails                | where                                                     |
| ------------------------- | --------------------------------------------------------- |
| `ink-floor` (Tier 2, new) | `5b5566b87593`, `f70a4904eb30`, `integ-doc/-final/-teach` |
| `vacant` (bbox fill, 2.6) | `5b5566b87593`, `cardiac`, `cardiac7`                     |
| `ink-on-ink` (2.3)        | `cardiac2`, `cardiac6`                                    |
| `realized-layout` (2.7)   | `cardiac7`, `try`, and the pre-fix longitude projects     |

Every one of those is a board compiled by an older tree, and the ink-floor set is
exactly the document-route slideshow plus the four-scene smoke tests — the class that
floor was drawn to name. Nothing there needs fixing before Phase 5; it is listed so
that a future session does not read a red corpus as a regression it caused. **Phase 4
adds two more ways an old project can read red, both benign**: a storyboard compiled
before `enter.cueWord` reports its reveals as phrase-searched (recompile it — the
`problems[]` line says so), and `duration`/`pace-calibration` now appear in every fresh
`qc.json`.

## What Phase 0/1 built (the parts Phase 2+ will touch)

- **The gate.** `packages/core/src/gates.ts` — `GateMode = 'strict' | 'degrade'` and
  the `gate(mode, message, warn)` helper: throws under `strict` (message names the
  `--degrade` escape), warns otherwise. **`cast()`/`rerender()` default to strict;
  stages called directly default to degrade** (`undefined` mode = today's behaviour).
  Threaded: `CastOptions.gates` → `narrate`/`resolveVisuals`/`render` opts →
  `CompileOptions.gates` in the renderer. CLI flag `--degrade`
  (`apps/cli/src/main.ts`). The posture is recorded in `pipeline.json` as `gates`.
  **Every new Phase 2 assertion should block through `gate(...)`, not a bare throw**,
  so degrade stays an escape and the message format stays uniform.
- **The harness.** `packages/pipeline/src/auditcheck.mts`
  (`npx tsx packages/pipeline/src/auditcheck.mts`) — grep-level pins of the audit's
  re-checkable facts, currently **50**, all green. **The plan (item 0.3) says each item
  adds its line here as it closes.** Every Phase 1–4 item's lines are in.
- **The glyph gate.** `packages/visuals/src/glyphgate.ts` + `FontMetrics.covers()`
  (real cmap) in `packages/core/src/fontmetrics.ts` (moved there in 2.1); wired at the top of
  `resolveVisuals`. Tests in `packages/visuals/test/glyphgate.test.ts`.
- **Math routing.** `sniffMath` + promotion in `packages/planner/src/elements.ts`
  (`makeText` now returns `TextElement | EquationElement`); briefs advertise the
  ninth mark in `draw-anthropic.ts`; `'marks'` is in `STAGE_OWNED`
  (`planner/src/schema.ts`). The draw-key pins in
  `planner/test/draw-anthropic.test.ts` were deliberately re-pinned
  (`9a1f337a8ecd8a07` / `3d94a24a9cc2b943`) because the brief text is the cache key.
- **Alignment honesty.** `mapToExpected` returns `{words, fraction}`;
  `MIN_ALIGN_FRACTION = 0.5` floor in `packages/voice/src/align.ts`; fraction in the
  timing sidecar (`alignFraction`) and in voice problems.
- **Cue misses.** `ResolveCuesResult.dominantMisses` in `packages/voice/src/cue.ts`,
  gated in `narrate.ts`; decorations still only warn.
- **The critic.** `reviseDrawing` skips-with-warning when no preview renders
  (`planner/src/draw-critic.ts`); it never revises blind.

**Deliberate deviations from the plan's letter** (argued in the plan's progress block):

1. `makeText` promotes math with a warn in _both_ modes — no strict error. The
   promotion is the fix; a promoted string that fails to typeset still hits the strict
   equation gate downstream.
2. The missing-font gate has no direct both-behaviours test — the font search paths
   (`defaultFontDirs`/`fontSearchPaths`) always find the repo's vendored fonts and
   cannot be isolated in-tree. The gate call is trivial; it fires in real degraded
   environments.
3. Drawing-lane problems (the critic's skip, audit defect lists) reach persisted
   `problems[]`/`qc.json` only in Phase 3 (plan item 3.4); today the skip is a
   `log.warn`.
4. **The fill floor is mean < 18% / any scene < 11%**, not the plan's 25%/14% — after
   2.1's honest boxes, bbox fill cannot separate shipped longitude (20.3%/13.8%) from
   the named must-fail photosynthesis board (21.8%/13.2%). Measured and argued in W2.
5. **The legibility floor is 10 output px**, not the plan's provisional 14 or the
   spec's 18 — the corpus's shipped minimum is 10.9px on reviewed recap reveals, and
   14 would fail three of them. Measured and argued in `boardcheck.ts`'s
   `MIN_GLYPH_PX` comment and the plan's progress block. The Phase 8 re-audit must
   treat both floors as named recalibrations, not regressions.

## What remains to close the audit: Phases 5 → 6 → 7 → 8

**The audit is not closed.** Phases 0–4 are landed; Phases 5–8 of
`docs/PLAN-AUDIT-CLOSE.md` are open, and that plan stays the authority on scope,
done-bars, and the coverage table that maps every non-PASS audit finding to exactly
one item or waiver. Read the plan's Phase 5–8 sections in full before starting; the
summary below exists only so a clean-context session knows the shape of the road,
and the bullets after it are session-found context the plan cannot know.

- **Phase 5 — grounding, pedagogy, IR hygiene** (~1 week). 5.1 bare topics record
  `grounding: 'parametric'` (honesty ships first; retrieval is a decision doc);
  5.2 `LessonStep.sourceRef` verified against the source doc; 5.3 the pedagogy
  critiques (misconception beat, budget-drop problem, concrete-before-abstract);
  5.4 advisory DAG second opinion; 5.5 drop stale `ElementVisual` fields + warn on
  `cast --force` clobber; 5.6 the document route stops leaking model coordinates
  (re-anchor arrows/paths after re-layout; `set-camera` becomes presets).
- **Phase 6 — topic coverage and asset trust** (~2 weeks, staged). 6.1 the honest
  guard for the four unserved classes (chemistry, circuits, maps, code) — ALWAYS
  before 6.2/6.3; 6.2 the code lane (Shiki → crisp ink); 6.3 circuits/chemistry/
  geography by demand, lane docs first; 6.4 illustrations get the pose lane's
  retry + plausibility gates; 6.5 `illustrationKey` folds in the figure model id.
- **Phase 7 — scale and cost** (~1 week, after everything above). 7.1 per-scene
  segment cache / partial re-encode (byte-identical splice is the test); 7.2
  `--emit-plan` + `planhash --timing`; 7.3 declarative StylePacks (depends on 2.2;
  where a dark-chalk pack would force 6.4's real-alpha work).
- **Phase 8 — the exit** (~2 days + ~$3). 8.1 re-run the audit: every check PASS
  or named-waiver (W1–W6 plus the two Phase-2 recalibrations argued in W2 and the
  plan's progress block). 8.2 the bake-off: render Golpo's two reference topics,
  score both films and Golpo's with the same instruments, publish the scorecard in
  `docs/STATUS.md` — and watch both films end to end first.

Ordering per the plan: 5 is next and unblocked; 6.2+ any time after 6.1; 7 after everything; 8 is the exit. API cost is negligible until 8.2 (3.3's
Tier 2 is keyed and cached, ~a few cents a film, and skips itself with no key).

Session-found context for Phase 5 and after (so the next session does not re-derive it):

- **The gate stage is where new checks go.** `check()` in `render/src/check.ts`
  assembles `QcCheck`s; adding one is a `qcCheck(id, findings, {severity})` in that
  list plus, if it needs a number, a pure function beside the others in
  `boardcheck.ts` or `tier2.ts`. `severity: 'warn'` for a judgement, the default
  `fail` for a fact — the split is argued in `core/src/qc.ts`'s header and it is what
  keeps the gate switched on.
- **4.2 and 4.3 have their rails already.** A voice-stage problem reaches `qc.json`
  through `StageOptions.onProblem` — `cast()` collects it into the `stages` check —
  and `narrate` already takes `StageOpts`, so 4.3's drift numbers can travel the same
  way without a new artefact. 4.1's unresolvable-index hard error should go through
  `gate(...)` like everything else.
- **Tier 2 is where a "does the sync look right" check would live**, if 4.x ever wants
  one: the frames are already captured and the vision seam already takes them.
- **3.3's vision pass is unexercised against a live model.** Every code path is
  tested with a stub, and the one keyed attempt in this session got
  `402 Payment Required` from both providers — which is itself the degradation path
  working (the report records the real reason and the film still rendered). The first
  session with credit should run one keyed cast and read `qc.json`'s `frame-vision`
  findings against the frames by eye: that false-positive count is what decides
  whether the check is promoted from advisory to blocking, per the plan.
- **`MIN_INK_SHARE` and `MAX_REVEALS_PER_SCENE` are corpus numbers, not spec numbers**,
  like `MIN_GLYPH_PX` and the fill floor before them. The Phase 8 re-audit must treat
  all four as named recalibrations. The measurement scripts were throwaway; the tables
  and the reasoning are in the constants' own comments.
- **`DELIVERED_WPS = 2.2` is now known not to fit both shipped films** (4.3, measured):
  longitude delivers 2.23 w/s, gradient-descent 2.50. Every run says so — the
  `pace-calibration` advisory in `qc.json` — and nothing was changed, because a new
  number moves `adaptLesson`'s trimming and therefore the pinned hashes. Whoever picks
  this up should decide between a re-measured constant, a per-cadence rate (the two
  films differ in how many beats are `punchy`), and accepting the spread, and should
  argue it in `presets.ts` beside the constant. It is a Phase 8 conversation at the
  latest: the re-audit will read the advisory.
- **The normaliser is `core/src/speech.ts` now, not `voice/src/text.ts`** (4.1), and it
  is the tokeniser of record: `narrationTokens` is what `enter.cueWord` indexes into.
  Anything that changes what the normaliser _says_ therefore changes what the indices
  _mean_ — so a normaliser change and a compiler change must land in that order, or the
  pinned hashes move twice. That is why 4.4 landed before 4.1.
- **A cue index is verified, never trusted.** Two places check it (`critiqueStoryboard`
  before any audio; `resolveSceneCues` against the measured phrases), and both compare
  the word at the index against the cue phrase's own first word. If a future item
  deletes `enter.cue` — the plan's 4.1 says the phrase search "then dies" — delete the
  _search_, not the phrase: the phrase is the only thing that can detect a stale index,
  and without it a wrong number is undetectable by construction.

## How to verify any phase as it lands

```
pnpm -r typecheck && pnpm -r test && pnpm lint
npx tsx packages/pipeline/src/auditcheck.mts
node --import tsx apps/cli/src/index.ts --lesson examples/lessons/longitude.lesson.json --project <scratch-id>
```

The last line is the strict end-to-end proof (strict is the default; no key needed —
a voice-provider fallback in the output is a provider event, not a gate failure).
Both shipped lessons are `examples/lessons/*.lesson.json`.

## Traps (the plan's own list, plus the ones earned since)

All five traps at the foot of `docs/PLAN-AUDIT-CLOSE.md` stand — pinned hashes moving
is the change working; gameable metrics get gamed; no re-prompt loops at gates;
strict surfaces latent corpus defects (budget triage time; `--degrade` exists);
6.1 before 6.2/6.3.

Earned in the Phase 1–2 sessions: **verify coverage claims against the actual cmap
before asserting them in tests** — Shantell Sans genuinely covers bra-ket brackets
(U+27E8/9) and subscript digits but no Greek, the opposite of what you'd guess.

Earned in the Phase 3 session, and the more expensive lesson of the two:

- **"The corpus passes" is a claim about the projects you actually re-cast.** Phase 2
  was recorded as complete with both shipped lessons verified strict-clean. They were
  not: `projects/audit-2p3-longitude` was cast 32 minutes _before_ 2.7's realized-layout
  check landed, so longitude had never met it — and when it did, it failed, on a defect
  a viewer sees immediately (its recap chain lettered at 7.2 output pixels; the frame is
  four boxes of grey mush). Gradient-descent had been re-cast after 2.7 and did pass,
  which is exactly how the wrong conclusion got drawn from a half-run experiment. Before
  writing "verified end to end", check the timestamps: `pipeline.json`'s `updatedAt`
  against `git log` for the commit whose gate you are claiming it passed.
- **A check that only measures intent will bless a board that fails in reality.** The
  static glyph floor (2.4) passed that longitude recap, because the _asked_ size was
  legible; only the browser knew it had shrunk the type to fit. Any future check with
  an estimate on one side of it should ask what its realized equivalent would say.
- **Where you sample decides what you measure.** Tier 2's first sampler took each frame
  a quarter second before the beat's end, which on a wiping board is after the card has
  gone: two reviewed films measured 0.00% ink. It reads the fade schedule now. The
  general form — a measurement taken at the wrong instant is not a weak measurement, it
  is a confident wrong one — is worth carrying into 4.3's drift numbers.

Earned in the Phase 4 session:

- **Order a phase by what moves the pinned hashes, not by item number.** 4.4 changes
  what the normaliser says; 4.1 writes indices counted _through_ the normaliser. Done
  in plan order the four hashes would have moved twice, and the second diff would have
  been unreadable against the first. Ask of every phase: which item changes the input
  of which other item?
- **A purely additive storyboard diff is its own coverage proof, and cheaper than
  frames.** 4.1's re-pin was justified by compiling each board on both sides and
  counting: 30/23/47/38 added `"cueWord"` lines and zero other changed lines — which
  simultaneously says "nothing regressed" and "every cue got an index", because those
  counts are the number of cues in each board. Rendering frames would have shown
  nothing, since `enter.at` did not move. The header of `pinned-hashes.test.ts` already
  allowed for this (the 2026-08-22 re-pin); it is worth reaching for deliberately.
- **The default log level hides the line you are about to quote.** The voice stage's
  "N/N by authored word index" is `log.info`, and the CLI prints warnings only, so the
  end-to-end numbers came from calling `narrate()` over the cast project's cached audio
  afterwards. Cheap (every clip is a cache hit) and repeatable — but if you plan to
  claim a number from a stage's own log, check that the log level shows it before
  spending the render.
- **A new measurement's first job is to be believed, so check it against a number
  somebody already wrote down.** 4.3's first real run re-derived the very measurement
  `DELIVERED_WPS` was calibrated from (272 words over ~122s of longitude) to within
  1.2%. That agreement is what makes its _disagreement_ on gradient-descent (+14%)
  worth acting on rather than debugging.
