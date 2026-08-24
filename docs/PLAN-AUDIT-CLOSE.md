# Plan — close the audit: every check PASS or waived, and a film that beats Golpo's

Written 2026-08-22 against `docs/AUDIT-FINDINGS.md` (run at `5f83bc4`). That report is
the evidence base; this file is the work. Scope: the 1 CRITICAL, 6 FAIL, 4 MISSING and
~38 PARTIAL findings. Every non-PASS check maps to exactly one numbered item below or to
an explicit waiver — the coverage table at the end is the completeness proof, and the
re-audit in Phase 8 is the exit.

> **Progress (2026-08-22): Phases 0 and 1 are landed.** 0.1 (`GateMode`, strict by
> default in `cast()`/`rerender()`, CLI `--degrade`, posture recorded in
> `pipeline.json`), 0.2 (waivers W1–W6 written into AUDIT-FINDINGS §5), 0.3
> (`pipeline/src/auditcheck.mts`, all green), 1.1 (glyph gate + `covers()` +
> equation-fallback gates in visuals and render), 1.2 (ninth mark advertised — draw
> keys deliberately re-pinned; lesson brief fixed; `sniffMath` promotion in
> `makeText`; `marks` stage-owned), 1.3 (alignment fraction + 0.5 floor + sidecar +
> problems), 1.4 (missing font, dominant cue miss, blind critic → skip). One
> deliberate deviation: `makeText` promotes math with a warn in both modes rather
> than erroring under strict — the promotion is the fix, and a typeset failure
> downstream still hits the strict equation gate. Next: Phase 2.
>
> **Progress (2026-08-23): 2.1 is landed.** `fontmetrics.ts` lives in `@inkcast/core`
> (with `HAND_FONTS`, the style→face assignment, moved beside it); the planner
> measures with the real advance table via `handMeasure`/`measureText` (module hand
> set per compile by `setPlannerHand`); deleted: `ADVANCE = 0.52` + char-count
> wrapping, `texAsGlyphs` (one `texBox` estimator now serves `makeEquation` and
> `withMathBox`), `diagramSize`'s chars × 13, `labelBox`'s chars × size × ADVANCE,
> `LABEL_SLACK` (both sides — the estimate gap it papered over no longer exists),
> `MATH_ADVANCE`'s planner duplicate, the renderer's ×0.6/×0.62 arrow/edge label
> estimates (now `ctx.hand.measure`), and the dead `labelAt` ×0.58. `FONT` is now
> computed as `TYPE_SCALE × TYPE_RATIO` — one catalogue imports the other through
> the stated ratio, per the two reverts. All four pinned hashes re-pinned with
> frames rendered and inspected (reasoning in `pinned-hashes.test.ts`); two test
> fixtures recalibrated because honest footprints made their scenarios true
> (`repair-log.test.ts`, `draw-critic.test.ts`); four A-4 lines added to
> `auditcheck.mts`. Done-bar held: one advance table in the repo; the "empty
> stac"-class defect is structurally closed (the check measures what the renderer
> draws).
>
> **Progress (2026-08-23, same session): 2.2 is landed.** The colour table lives in
> `@inkcast/core` (`palette.ts`: `Palette`, `paletteFor`, `toneInk`, plus the
> `highlight` wash visuals needed); `render/palette.ts` re-exports it and keeps only
> pen personality; `visuals/style.ts` keeps per-style _personality_ (stroke,
> roughness, face) and composes colours from `paletteFor` — its four never-shipped
> per-style colour sets are deleted. The accent decision was made from frames: the
> film paints the renderer's blue `#2f6fed` in every shipped frame (the plot remap in
> `render/plot.ts` meant visuals' red never reached a pixel), so the blue survives
> and `#d7263d` is deleted, not aliased. The visuals mono collapse (accent→ink) also
> dies — the film's mono accent was always the distinct `#39434f`. Mirror test:
> `pipeline/test/styles.test.ts` (the CAST_POSES pattern); S5-c line added to
> `auditcheck.mts`. Fresh visuals manifests now record the film's own colours; a
> per-style colour pack (dark chalk) is deliberately 7.3's StylePack decision, not a
> second table.
>
> **Progress (2026-08-23, same session): 2.3 is landed.** `render/src/boardcheck.ts`
> holds the three assertions; `compilePlan` runs them on every plan, blocking through
> `gate(opts.gates, …)`, advisories aggregated into one warn line. Scoping decisions,
> each argued in the module header: the ink-on-ink sweep covers _persistent solid_
> elements only, and never pairs within one drawing (`<id>_v<n>_` groups — the
> drawing lane polices its own parts against real ink segments, boxes being "the
> wrong obstacle" per its own header); a derived-camera off-frame miss is a warning
> (the walk window and close-up ceiling are the system's own trades), an authored
> one blocks; dwell is advisory and board-text-only, with the fix named as
> `holdForCadence`'s floor. The cue-at-fraction-0 clamp waits for the incoming
> transition but only for persistent non-plot ink, and never past the narration's
> end — a plot's build is cue-paced across the whole narration, and a transient's
> only plateau must not collide with its own fade (both learned from the wipe
> fixture, not guessed). `Box`/`Point` zod gained `.finite()` and positive extents.
> Red tests in `render/src/boardcheck.test.ts`; corpus (both lessons, both shipped
> finals, cardiac8f, try, integ-*, handwritten) compiles strict-clean; two
> auditcheck lines added.
>
> **Progress (2026-08-23, same session): 2.6 is landed — with the floor re-derived,
> not the plan's.** The gate blocks at **mean < 18% or any scene < 11%**, not the
> 25%/14% written below, and the deviation is measured, not argued from taste: after
> 2.1 tightened every reserved box, the shipped longitude lesson re-measures at mean
> 20.3% / min 13.8% and the photosynthesis board this item names as the must-fail
> case at 21.8% / 13.2% — within 1.5 points of a shipped film on every statistic.
> The 25% floor would block a shipped lesson to fail a board bbox fill cannot
> distinguish from it; the 17% artifact the audit measured no longer exists. The
> re-derivation is written into W2 (AUDIT-FINDINGS §5). What holds: the floor blocks
> the unmistakably vacant class; the message carries per-scene numbers; `--degrade`
> records the override — `compilePlan` collects degrade-mode gate messages onto
> `plan.problems`, `render()` returns them, and the pipeline persists them as
> `render.problems` in `pipeline.json` (inherited on cached renders — they describe
> the artifact, not the run). `final-169` (47.6%) passes; photosynthesis (21.8%)
> passes the recalibrated floor and its separation is Tier 2's job (3.3), per W2.
> Red/green tests in `boardcheck.test.ts`; auditcheck line added.
>
> **Progress (2026-08-23, same session): 2.5 is landed.** `resolveFraming` pass 3
> derives a derived camera's transition from its pan distance:
> `max(current floor, dist / viewWidth / MAX_VIEWS_PER_SEC)`, capped at 2.5s (past
> that a move reads better as a cut). The speed is measured in _view-widths per
> second at the incoming zoom_ — raw canvas units would be a different perceptual
> speed on every board, since canvases run 1520–4448 units wide. The ceiling (2.4)
> sits just above the fastest walk in the corpus (2.35 views/s on `projects/try`;
> fastest in a shipped film 1.84 on `cardiac8f`), so no reviewed walk slows down and
> only the degenerate constructed case stretches. Pinned in `camera.test.ts`
> (exact-formula pin plus the cap case); S7-b line in `auditcheck.mts`.
>
> **Progress (2026-08-23, same session): 2.4 and 2.7 are landed — Phase 2 is
> complete.** The legibility floor (`MIN_GLYPH_PX`) is **10 output px**, not the
> plan's provisional 14 or the spec's 18, and the number is the corpus's: seven
> boards letter at ≥26px everywhere except recap pull-backs, whose newly revealed
> labels/captions ship at 10.9–13.9px — reviewed films, readable text. A 14px floor
> fails three shipped, watched reveals; 10 sits just under the shipped minimum,
> where what it fails really is the class with no x-height left. Static half:
> `glyphFloorViolations` in `boardcheck.ts`, swept by `compilePlan` per scene per
> revealed text role (equations excluded — their glyph size is typeset geometry, the
> realized report's job). Runtime half (2.7): `layoutText` in `page/runtime.js`
> records what the browser really laid out (post-shrink size, line count, fits);
> `window.inkcast.realizedLayout` serves it; `FrameCapturer.realizedLayout()` reads
> it over CDP; `render()` sweeps it with `realizedTextViolations` before frame 0 —
> blocking under strict, recorded into `problems` under degrade. Done-bar held: the
> browser test in `page.test.ts` builds a board whose narrowed box passes every
> compile-time check and fails from the realized report alone. Corpus strict-clean;
> S4-f and S4-a lines in `auditcheck.mts` (23 checks). Next: Phase 3.
>
> **Progress (2026-08-23): all of Phase 3 is landed — QC is a stage.** The seventh
> stage `check` sits between visuals and render (`render/src/check.ts`, driven by
> `cast()` and `rerender()`), writes `qc.json` (`core/src/qc.ts` is the contract),
> and blocks through `gate(...)`. Per item:
>
> - **3.2 first, because 3.1 runs it.** `critiqueStoryboard` in `core/storyboard.ts`
>   — the board graph's own critique, beside `critiqueLesson`: dangling `morph.fromId`
>   / `morph.retires` / `emphasis.targetId` / `assetId` / `persistUntil`, forward
>   references (a morph out of ink drawn later), _expired_ references on a wiping
>   board (ink whose `persistUntil` has passed — the failure `persistUntil`'s own
>   docs warn about), cues absent from their scene's narration, plot overlays on
>   curves the plot does not draw, diagram edges to absent nodes, and duplicate
>   element or scene ids. Every rule is a dangling reference or a duplicate — no
>   taste. Run by the gate and by `applyOps`, so a hand edit reports what it broke
>   (`ApplyResult.problems`, surfaced by `editProject`). `ensureAssets`' silent mint
>   is now a warn plus a recorded problem. All 26 corpus boards pass it.
> - **3.1 the gate stage.** Tier 1 re-runs the Phase 2 sweeps from
>   `compileBoard` — a new entry point beside `compilePlan` that returns the plan
>   _and_ its `BoardReport`, so the numbers are computed once where the geometry
>   exists rather than re-derived (the A-4 rule). It also runs the realized-layout
>   sweep (2.7) and Tier 2 in **one** Chromium launch. `--degrade` still records;
>   the density cap is `MAX_REVEALS_PER_SCENE = 9`, counting a drawing as one thing
>   (measured: the busiest of 242 corpus scenes introduces six, the median three;
>   counting raw elements would fire on half the corpus, because one drawing is up
>   to 35 marks). `PIPELINE_VERSION` deliberately **not** bumped — the new stage
>   produces no artefact any other stage reads, and bumping would re-render 26
>   projects to add a file none of them depend on.
> - **3.4 nothing degrades silently.** The score-0 lucide fallback, a failed
>   illustration, a missing underlay, the critic's blind skip, a failed or rejected
>   correction: all `noteProblem` now (`OnProblem` on `StageOptions`, collected by
>   the run, written into `qc.json`). The drawing lane's _standing_ defects are
>   recomputed from `lesson.json` every run by `lessonDrawingDefects` rather than
>   remembered from the keyed run that drew them — measured on `projects/cardiac8f`,
>   5 of its 12 drawings still carry defects, a fact that previously existed for one
>   afternoon.
> - **3.5 every model call is a cost line.** `callTool` reports the API's own
>   `usage`, so the drawing author (`drawing`), the critic (`drawing-fix`), the
>   underlay generator (`underlay`, generations only — a cache hit is free) and the
>   Tier-2 vision pass (`frame-vision`) all reach `costOf` as `ModelSpend`. Those
>   lines are `estimated: false`: the provider counted the tokens. The expensive half
>   of a keyed run — two Opus calls per picture, five to ten pictures a film — was
>   free by construction until this, because every quantity the report could see was
>   one visible from _outside_ the lesson stage.
> - **3.3 Tier 2 — something looks at the pixels.** `render/src/tier2.ts`: 8 frames
>   per film, sampled at each beat's fullest moment. The ink floor is **1.0% of
>   pixels**, corpus-derived by running this sampler over all 27 boards — the
>   populations separate cleanly (keyed drawing films 2.2–4.0%, shipped lessons
>   1.6–2.1%, reviewed lesson films 1.2–1.6%, **floor**, document-route slideshows
>   0.8–1.0%, 4-scene smoke tests 0.8%) and the floor is drawn in the gap. What
>   counts as ink now lives in `render/src/ink.ts`, shared with `inkstat.mts` (which
>   still reproduces its documented 4.7% on `cardiac5`) so the bake-off's instrument
>   and the gate cannot disagree. **The sampler reads the fade schedule, not the
>   scene end**: sampling before the cut photographs the gap after a wiping board's
>   card has gone, and `cardiac9`/`cardiac10` — two reviewed films — both measured a
>   frame at 0.00% ink before that was fixed. The vision pass and OCR diff are
>   injected (`pipeline/src/frame-vision.ts`, five fixed questions, cached on the
>   frames' own bytes) so the renderer never acquires a model provider, and are
>   **advisory for one release** per the plan. No key: the pixel half still runs and
>   the other two skip with the real reason recorded.
>
> Eleven `auditcheck.mts` lines added (34 checks). **Found while verifying, and not
> fixed here: `longitude` fails the strict gate**, on 2.7's realized-layout check —
> its recap chain writes four 7-word sentences into a 4-wide horizontal `flow`
> diagram, so the browser shrinks them to 7.2–9.7 output px against the 10px floor.
> It is a pre-existing Phase-2 gap (that project was last cast 32 minutes before
> 2.7 landed, so the claim that both shipped lessons pass every Phase 2 gate was
> only ever verified for gradient-descent), and it is now caught before the encode
> instead of after it. The corpus sweep in the handoff lists every other
> pre-existing failure.
>
> **Fixed straight after, in `55b1147`, because the gate was right:** `recapChain`
> emits a `stack` (a column) instead of a `flow` (a row), so each idea gets the recap
> cell's full width and its whole clause on one line at the size it asked for — and the
> word budget rises with the width, because at seven words the labels were truncated
> mid-thought. Twelve lines of storyboard diff on longitude, sixteen on
> gradient-descent, one of them `"layout"` and the rest labels that stop being
> fragments; no geometry moved at all. All four pinned hashes re-pinned with the diff
> and the rendered frames in `pinned-hashes.test.ts`'s header, and both shipped lessons
> now cast strict-clean end to end (`projects/qc33-longitude`, `projects/qc33-gd`).
> Next: Phase 4.
>
> **Progress (2026-08-24): ALL OF PHASE 4 is landed** (`d18c67a`, `653bee8`, `ff4a712`,
> `3566ac0`). 1023 tests green, auditcheck 50/50, lint and typecheck clean, both shipped
> lessons re-cast strict-clean (`projects/qc43-longitude`, `projects/qc43-gd`).
>
> The order was chosen so the four pinned hashes move **once**: 4.4 changes what the
> normaliser says, which changes the tokens an index counts, so it had to land before
> 4.1 wrote any indices.
>
> - **The normaliser moved into core first** (`core/src/speech.ts`, was
>   `voice/src/text.ts`), the third instance of the 2.1/2.2 move and for the same
>   reason: `Enter.cueWord` is an index into that module's token stream and the
>   _planner_ writes it, so both ends must count with one function. The tokeniser
>   (`matchTokens`, `cueTokens`) and the exact locator moved out of `voice/src/cue.ts`
>   to sit beside it; `voice` re-exports the same names, and placement — the part that
>   needs measurements — stayed in `cue.ts`. No behaviour moved.
> - **4.4 the normaliser's named gaps.** `foldScripts` (sub/superscripts) and
>   `stripLatex` run _before_ `stripMarkdown`, because markdown reads a pair of
>   underscores as italics and would silently delete the subscripts of `a_{1} + b_{2}`.
>   `H₂O` → "aitch two oh" (attached after a capital, so the initialism speller reads
>   the formula; `x₁` → "x one", an index, becomes its own word); ² and ³ deliberately
>   stay with `SYMBOLS`, which says "squared" and "cubed". `\frac{1}{2} of $x^2$` → "One
>   half of x squared", with `$…$` counting as maths only when what is between the
>   dollars contains LaTeX — so "It costs $5 to $10" stays money. Dirac notation ahead
>   of the `|`-as-pause rule (`α|0⟩` → "Alpha ket zero"); bracketed stage directions
>   dropped. The audit's own six probes are the test, pinned as exact strings.
> - **4.1 `entersAtWord`, shipped as `Enter.cueWord`.** Written by `assignTiming` — the
>   one place holding both the narration and the cue — and read as a lookup. Three
>   decisions the plan's letter did not cover: the cue phrase **stays**, because it is
>   what makes a stale index detectable (checked in `critiqueStoryboard` before any
>   audio, and again in the voice stage against the measured phrases); authoring is
>   **exact-match only** (`cueWordIndex`), since an index from a 0.6 fuzzy window would
>   be a guess wearing the costume of a fact; and a broken index is **gated but not
>   fatal to the frame** — strict stops, degrade records it, and either way the reveal
>   is then placed by search, because a film that refuses to render because a cue moved
>   one word is worse than one that places it and says so. `set-narration` re-takes the
>   indices it invalidates. **All four pinned hashes moved, purely additively**:
>   30/23/47/38 added `"cueWord"` lines and zero other changed lines, which is also the
>   coverage proof (every cue in every board got an index). `COMPILER_VERSION` 3 → 4.
> - **4.2 falls out of 4.1.** A cue with no index is an old storyboard: placed the old
>   way, counted, and carried out of the stage into `problems[]`. The count is what
>   decides when the search can be deleted; a log line cannot be counted after the run.
> - **4.3 drift measured every run.** `core/src/drift.ts`, called from `cast.ts` (which
>   is where the budget is known, and which can compute it from measurements on disk so
>   a cached voice stage still reports length). Runtime vs `maxSeconds` at
>   `critiqueLesson`'s own 1.25× — shared, not re-chosen — blocking; delivered w/s vs
>   the rate the run planned with, ±10%, advisory forever. Numbers in `pipeline.json`
>   (`drift`), findings in `qc.json` (`duration`, `pace-calibration`).
>
> **The step-8 done-bar holds, measured:** 30/30 and 47/47 reveals placed "by authored
> word index", zero fallbacks, and `synccheck.mts` still reports 0 strokes landing on
> the same frame as the one before — identical to the pre-change baseline, because the
> index resolves to the word the exact search was already finding. What changed is that
> placement no longer _depends_ on a tolerant search finding it.
>
> **Found by 4.3 on its first outing, and deliberately not fixed here.** Longitude
> delivers 2.23 w/s, confirming `DELIVERED_WPS = 2.2` to 1.2% (the constant was measured
> from 272 words over 122.5s of this very film; it now re-measures at 272 over 122.1).
> Gradient-descent delivers **2.50 w/s, +14%**, and raises the advisory. One constant
> does not describe both shipped films — they disagree by 12% — so the estimate is
> systematically wrong for one of them, and choosing what to do about it (a new number, a
> per-cadence rate, or accepting the spread) is a `presets.ts` decision with pinned-hash
> consequences, not a number to split the difference on inside 4.3. It is now impossible
> to forget: every run says so. Next: Phase 5.

**Two rules that shape everything here:**

1. **"Pass" does not mean "obey the spec where the spec is wrong."** The audit's
   Spec-is-wrong list (11 entries) survives into this plan as waivers W1–W6. A waiver is
   closed by writing the argument down where the next auditor will find it, not by
   silently ignoring the check. Implementing a requirement the evidence refutes (55%
   fill floor, motion blur, per-beat targetSec) would make the videos worse.
2. **The severity rubric's rule stands: an assertion that logs-and-continues is absent.**
   Most of this plan is not new capability — it is promoting guarantees the code already
   computes (fill, cue misses, font fallbacks, equation fallbacks) from `log.warn` to a
   gate with an explicit override. The pipeline already knows when it is wrong; it just
   doesn't act on it.

**Relationship to the other plans.** `PLAN-GOLPO-PARITY.md` is the craft plan for one
film (wipe cards, script economy, honest voice) and is untouched by this document — its
Phase 5 "two-scales bug" is item 2.1 here; do it once, in whichever plan runs first.
`HANDOFF-LAUNCH.md`'s human-only launch blockers (Clerk production, first sign-in, key
backup) are independent of everything here. **Phase 1 should land before launch** — it is
the "silently wrong output that looks correct" class, and launch invites strangers to
generate videos we don't watch. Phases 2+ can proceed after launch in parallel with it.

## What "surpasses Golpo" means, as numbers

Golpo's four measured defects (audit §1) are the bar to clear, and the audit found the
mechanical detector for each. Surpassing means all of:

| #   | Bar                                                                                                                                                                                                                                | Checked by                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| G1  | D1 impossible: no math or symbol ever travels the handwriting text path; every codepoint proven covered                                                                                                                            | glyph gate (1.1) + math routing (1.2), blocking          |
| G2  | D2 impossible: no truncated or clipped label in any sampled frame                                                                                                                                                                  | one metrics stack (2.1) + Tier-2 OCR diff (3.3)          |
| G3  | D3 gated: no beat below the fill floor ships without an explicit override                                                                                                                                                          | fill gate (2.6), blocking                                |
| G4  | D4 impossible: every reveal completes before its scene ends, with a word-scaled dwell after it                                                                                                                                     | dwell assertion (2.3), blocking                          |
| G5  | Word-exact sync Golpo doesn't attempt: ≥95% of reveals anchored to a verified word timestamp, zero fuzzy-match fallbacks in the render log                                                                                         | entersAtWord (4.1) + alignment floor (1.3), `synccheck`  |
| G6  | The bake-off: re-render Golpo's own two named reference topics (quantum computing; day/night in your town) through our pipeline and score both films with the same tools — ours must hit G1–G5 where theirs measurably fails D1–D4 | Phase 8                                                  |
| G7  | Everything above is deterministic, re-renderable, and IR-editable — properties Golpo cannot offer at any quality level                                                                                                             | already true (A5/A7/S10-c PASS); re-asserted in re-audit |

The reference films are on disk (`~/Downloads/Quantum Computing_720p.mp4`,
`~/Downloads/How does day and night happen in your town_720p.mp4`) for side-by-side
scoring in Phase 8.

---

## Phase 0 — decisions and waivers (free, half a day)

Nothing downstream starts until these are written, because half the audit's FAILs are
posture, not code, and the posture must be decided once, not per-item.

**0.1 The strict-mode decision.** One flag, three consumers. `cast()` gains
`gates: 'strict' | 'degrade'`, default **strict** for pipeline/CLI runs, `degrade`
available as the explicit escape (`pipeline/src/degrade.ts` already exists as the
vocabulary). Strict promotes the named warn sites in Phases 1–2 to errors that stop
before the encode. _Done when:_ the flag exists, threads to render, and one warn site
(any) blocks under it — the rest arrive site-by-site in 1.4 and Phase 2.

**0.2 Write the waivers into `AUDIT-FINDINGS.md`** as a new "Closed by waiver" section,
one paragraph each, citing the measurement:

- **W1 (A-8, S8-x)** — append-only: accumulate is append-only; `wipe` and morph-`retire`
  are authored, camera-consistent exceptions backed by the 55.5%→62.3% fill measurement.
- **W2 (S4-e's number)** — the 55–85% band is miscalibrated for a bbox metric
  (`inkstat`: 21.6% bbox = 4.7% ink); our gate uses the recalibrated floor (2.6), not the
  spec band.
- **W3 (S3-b)** — the two-altitude IR (semantic lesson / compiler-authored geometric
  storyboard) satisfies A2's purpose; coordinates in the storyboard are not a defect.
- **W4 (S8-e)** — motion blur: waived; crisp ink is the product; revisit only if a pan
  ever strobes in review.
- **W5 (S1-x)** — per-beat `targetSec`: waived; word budgets are the enforced unit.
- **W6 (S2-a)** — narration/visual co-generation with verbatim-substring constraints is
  the desync prevention; ordering is not adopted.

_Done when:_ the section exists and each waiver names the evidence file:line it rests on.

**0.3 Pin the audit as a harness.** The seven audit prompts produced verdicts a machine
can re-derive for the mechanical subset. Add `pipeline/src/auditcheck.mts`: greps and
assertions for the cheap re-checkable facts (no `matchIcons` import in `compile.ts`, no
`Math.random`/`Date.now` in the frame path, `marks` pruned from the lesson tool schema
once 1.2 lands, one `ADVANCE` definition once 2.1 lands). _Done when:_ it runs green and
each Phase 1–2 item adds its line here as it closes.

---

## Phase 1 — the silently-wrong-output class (before launch; ~2 days, $0)

Everything here is small, and everything here is a defect a viewer sees and we don't.

**1.1 Glyph coverage becomes a hard gate.** _(S4-b CRITICAL, half of D1)._ In
`resolveVisuals`, where the cmap is already parsed (`visuals/src/fontmetrics.ts`),
iterate every text/label/term/caption string; any codepoint absent from the resolved
font's cmap is an error naming the element, the string, and the codepoint. Kill the two
silent degradations behind it: the space-glyph substitute (`fontmetrics.ts:323-328`)
becomes a throw under strict; a missing-font `builtinAdvance` fallback becomes a throw
under strict; an equation whose typeset geometry is missing at compile
(`render/compile.ts:1267-1277`) is an error, not TeX-as-handwriting. _Done when:_ a
storyboard containing `α|0⟩` in a plain text element fails loudly under strict with the
offending codepoint named, and every existing project still renders (they should — the
corpus is ASCII plus the vocabulary the font covers; if one doesn't, that is a defect
found, not a false positive).

**1.2 Math can no longer be steered into the text path.** _(S5-b MAJOR, other half of
D1)._ Three one-line-scale fixes and one small one: (a) `DRAW_BRIEF`/`FIX_BRIEF`
advertise the ninth mark, `math` — it exists in the schema and the prompts say "only
these eight"; (b) `lesson-anthropic.ts:230` stops calling a text intent "an equation";
(c) `makeText` gains a sniffer — TeX fragments (`\`, `$…$`) or ≥2 Unicode math
codepoints (operators, Greek-adjacent-to-digits, sub/superscripts, bra-ket) promote to
`makeEquation` with a warn, or error under strict; (d) prune `marks` from the lesson
tool schema (`STAGE_OWNED`) so the lesson author cannot bypass the drawing stage
(closes the S3-a gap). _Done when:_ a lesson asking for the Bloch-sphere state renders
`α|0⟩ + β|1⟩` as typeset glyphs on the board — the exact frame Golpo mangles — and
`auditcheck.mts` pins the prompt strings and the pruning.

**1.3 Alignment cannot fake word timings.** _(S6-b/D8 MAJOR)._ `mapToExpected`
(`voice/src/align.ts:137-222`) returns its paired-token fraction; below 0.5 the aligner
returns `[]` so the existing honest measured-phrase fallback engages; the fraction is
recorded in the timing sidecar and surfaced in `pipeline.json` voice problems. The
"word-exact" log line prints the fraction instead of asserting the adjective. _Done
when:_ a deliberately garbled clip (test fixture: align text A against audio of text B)
produces phrase-tier timings and a recorded fraction, not a uniform fake `words[]` —
pinned as a voice test.

**1.4 The strict gate acquires its first residents.** _(S4-g FAIL umbrella, S9-c)._
Promote under strict, keeping today's behavior under `degrade`: missing handwriting font
(render + visuals), equation fallback (1.1), cue no-match **on a beat's dominant
visual** (`voice/src/cue.ts:387-403` — decorations may still warn), and the
blind-no-preview critic path (`draw-critic.ts:163-167` — becomes skip-with-problem, not
revise-blind-at-debug). Every promotion also lands in persisted `problems[]`, which is
what makes `degrade` honest rather than silent. _Done when:_ each site has a test
asserting both behaviors, and a keyed render of the shipped lessons is problem-free
under strict.

---

## Phase 2 — one truth per fact, and the compile-time assertions (~1 week, $0)

The A4 violation and the assertions the spec is right about. All of it is arithmetic
over data `compilePlan` already holds; none of it needs a key.

**2.1 One text-metrics stack.** _(A-4 MAJOR — the audit's real invariant violation; D2;
HANDOFF defect #0)._ `visuals/src/fontmetrics.ts` moves to `@inkcast/core` (the
`boardMetrics` move, repeated — planner cannot depend on visuals). Then delete, in
order, re-rendering the corpus after each: `ADVANCE = 0.52` and char-count wrapping
(`planner/elements.ts:148-184`), equation-box estimation (`elements.ts:242-274`),
`diagramSize` chars×13 (`:388-389`), `labelBox`/`labelFootprint` (`draw-geom.ts`),
`MATH_ADVANCE` (`drawing.ts`), the ×0.6/0.62 arrow labels (`render/compile.ts:1540,1638`)
and ×0.58 `labelAt` (`prims.ts:82`), the chars×k inside `draw-audit.ts:196-204` (the
check must measure what the renderer draws). Unify `FONT` (`elements.ts`) with
`TYPE_SCALE` (`core/camera.ts`) — one catalogue imports the other. **Storyboard hashes
will move; that is the point.** Re-pin them the way `longitude/short` was re-pinned:
with the diff in front of you and the reason in the test header. _Done when:_ grep finds
one advance table in the repo; the cardiac8 label-overlap fixture and "empty stac" /
"AV nod" strings lay out unclipped; pinned hashes re-pinned with reasons.

**2.2 One style table.** _(S5-c MAJOR)._ Colour/ink tables move from
`render/palette.ts` + `visuals/style.ts` into `@inkcast/core`; both packages read it.
The #d7263d-vs-#2f6fed accent split dies here — decide which accent survives by opening
frames of both, then the losing number is deleted, not aliased. A pipeline test (the
package that sees both, same pattern as `CAST_POSES`) fails if renderer and visuals ever
disagree on a style's colours again. _Done when:_ one board shows one accent, and the
mirror test exists. (Full `sketch.ts`-vs-roughjs unification stays PIPELINE step 10 —
out of scope here; this item removes only the colour drift.)

**2.3 The board assertions.** _(S4-c, S4-d, S7-c MAJOR; D4; Box hygiene)._ In
`compilePlan`, per scene: (a) pairwise AABB sweep over non-nested persistent elements —
error on intersection under strict; (b) `rectContains(viewRect(camera),
elementBounds(el))` for every element revealed in the scene — warn on derived cameras
(tautology guard), error on authored ones; (c) dwell — error when `item.start +
item.dur > sceneEnd`, warn when a text item's post-completion residence is under
`max(1.2s, words × 0.25s)` and let the fix be `holdForCadence`'s floor, not a per-item
hack; also clamp cue-at-fraction-0 reveals to start after the incoming camera
transition settles. Add `.finite()` and positive w/h to `Box`/`Point` zod. _Done when:_
all three assertions have red tests (a constructed bad plan fails) and green corpus.

**2.4 Minimum legible glyph height, post-zoom.** _(S4-f FAIL)._ After `resolveFraming`,
assert per scene: `TYPE_SCALE[role] / (zoom_scene / zoom_median) ≥ 14 output px` for
every role the scene draws (14, not the spec's 18, because 9:16 already delivers ~24 and
16:9's floor cases are captions at 10.4px — measure the corpus, pick the number that
fails the illegible and passes the shipped, then write the number and the reasoning
down). The runtime's shrink-to-fit floor (`runtime.js:400`) reports its chosen size into
the same check via the realized-layout pass (2.7). _Done when:_ a beat framed at the
pull-out floor with caption text fails under strict, and both shipped lessons pass.

**2.5 Pan speed is bounded by deriving transition time from distance.** _(S7-b)._
`resolveFraming` pass 3: `transition = max(current floor, panDistance /
MAX_UNITS_PER_SEC)` with the constant chosen by watching the fastest existing walk.
_Done when:_ a constructed two-region long walk gets a longer transition, pinned in
`camera.test.ts`.

**2.6 The fill gate, at the honest number.** _(S4-e FAIL, D3, W2)._ `reportFill`'s
existing thresholds become the gate under strict: mean < 25% or any scene < 14% is an
error with the per-scene numbers in the message and `--degrade` as the override. The
17% photosynthesis board must fail; `final-169` (47.6%) must pass. Separately — because
the audit is right that bbox fill is gameable — `inkstat.mts`'s ink-pixel measure gets a
floor as a Phase 3 Tier-2 check where frames exist anyway. _Done when:_ exactly that:
photosynthesis blocked, benchmark green, override works and is recorded in
`pipeline.json`.

**2.7 The realized-layout report.** _(S4-a's gap; feeds 2.4)._ The capture page already
measures true wrapped text bounds; before frame 0 it reports per-element realized
boxes back through the CDP session, and the render process re-runs the 2.3 sweeps
against them. This closes the "browser wrap is invisible to the solver" seam without
moving layout into the browser. _Done when:_ an artificially narrowed box that forces a
shrink below 2.4's floor fails from the realized report, not just the estimate.

---

## Phase 3 — QC becomes a stage (~1 week; ~$0.10/video for Tier 2 when keyed)

**3.1 The Tier-1 gate stage.** _(S9-a, S9-b MAJOR)._ A seventh stage, `check`, between
visuals and render in `stages.ts` — but it is thin: it re-runs the Phase 2 assertions
plus `critiqueStoryboard` (3.2) against the enriched storyboard + sidecar and writes
`qc.json`. Blocking under strict with bounded behavior: structural failures don't retry
models — they name the beat and stop (the repair loop already lives upstream where
repair is cheap; a gate that re-prompts is the infinite-repair trap S9.10 warns about).
`critiqueLesson` at the `cast()` level stays advisory (the lesson stage already gated
itself), but its problems join `qc.json`. Elements-per-board gets its cap here (≤ 9
distinct reveals per cell, warn; the working-memory bound is taste, so warn not error).
_Done when:_ `cast` on a corpus project emits `qc.json`, `pnpm -r test` covers gate
red/green, and a strict render cannot start with a failing `qc.json`.

**3.2 `critiqueStoryboard`.** _(S3-c)._ The lesson graph's missing sibling: dangling
`morph.fromId`, `emphasis.targetId`, `assetId`, `persistUntil` naming a real scene, cue
phrases present in their scene's narration. Runs in the gate and after every
`applyOps`/hand edit. `ensureAssets`'s silent mint moves to warn + problem. _Done when:_
a hand-broken storyboard is caught at edit time, not as a render log line.

**3.3 Tier 2 — the frames get looked at by a machine.** _(S9-b, S9-d MISSING; G2/G3)._
Keyed and cache-keyed like everything else, N≈8 sampled frames per render: (a) vision
pass with the spec's fixed questions (clipped text? overlap? illegible region? mostly
empty?), answers into `qc.json` — advisory for one release while we learn its false
positive rate, then strict; (b) OCR diff — extracted text vs the IR's text content;
after 1.1+2.1 this should be a tautology, which is exactly why it is cheap insurance
against the failure class we haven't imagined (it is also the tool that scores Golpo's
films in the bake-off); (c) `inkstat` ink-pixel floor per sampled frame. No-key runs
skip Tier 2 and say so in `qc.json` — same posture as every other keyed lane. _Done
when:_ a render's `qc.json` carries per-frame verdicts, and seeding a deliberate defect
(shrink one box by hand) is caught by at least one of the three.

**3.4 Nothing degrades silently.** _(X-e, X-d, S9-c, S3-d)._ The two genuinely silent
spots join `problems[]`/`Degradation`: the score-0 lucide `fallbackMatch`
(`icons.ts:1420`) and the blind critic (already gated in 1.4). Draw-audit defect lists
and critic kept/rejected outcomes are written into `qc.json` per project (today they
evaporate with the logs). _Done when:_ `x-e` grep of the audit's list finds every
degradation either loud or recorded, and a project's `qc.json` shows its drawing-lane
history.

**3.5 Every model call is a cost line.** _(X-c)._ The drawing author, the critic's
vision calls, and lesson-stage underlay/figure generations emit `CostLine`s — the call
sites already know model and payload. _Done when:_ a keyed cardiac render's cost report
sums the drawing lane, and the total moves when a drawing is corrected.

---

## Phase 4 — sync exactness and drift (~4 days, $0)

**4.1 `entersAtWord`, end to end.** _(S6-a, A-6; PIPELINE step 8; G5)._ The planner
emits token indices into the normalized token stream alongside (then instead of) cue
phrases; `voice/cue.ts` resolution becomes an index lookup into `words[]`/phrase spans;
the fuzzy search (`MIN_CUE_SCORE 0.6`, prefix match) survives one release as the
fallback for old storyboards, logging every use, then dies. An unresolvable index is a
hard error — it can only mean the planner and the tokenizer disagree, which is a bug,
exactly as the docs argued. _Done when:_ the step-8 done-bar from PIPELINE.md finally
holds: zero fallback warnings in the render log on both shipped lessons, and
`synccheck.mts` still reports 0 same-frame strokes.

**4.2 A missed anchor is a problem, not a line in a log.** _(A-6 residue)._ During the
fallback release of 4.1: an unresolved cue on a dominant visual is a `problems[]` entry
surfaced by the gate. Dies with the fallback. _Done when:_ covered by 4.1's tests.

**4.3 Drift is measured every run.** _(S0-c, S6-d)._ After synthesis: compare the
narration track duration against the preset budget (record breach beyond critique's
1.25× in `qc.json`) and the run's delivered words/sec against `DELIVERED_WPS = 2.2`
(warn beyond ±10% — the signal to re-measure the constant instead of remembering to).
_Done when:_ both numbers appear in `pipeline.json`/`qc.json` on every keyed render.

**4.4 The normalizer's known gaps.** _(S2-c, S6-c)._ Unicode sub/superscript digit
folding (`H₂O` → "H two O"), bra-ket `⟨⟩` in SYMBOLS, strip `$…$`/`\command{…}` LaTeX
残余 before `speakSymbols`, and single-word bracketed stage directions. The six audit
probes become a voice test. _Done when:_ all six probes produce speakable output,
pinned.

---

## Phase 5 — grounding, pedagogy, IR hygiene (~1 week; retrieval is the one open design)

**5.1 Bare topics stop being silently parametric.** _(S0-a MISSING)._ Two steps, only
the first is committed: (a) honesty — a bare-topic run records `grounding: 'parametric'`
in `pipeline.json` and the studio says so; (b) optional retrieval — a `SEARCH_API_KEY`
lane that populates `SourceDoc` for bare topics, behind the same adapter/degrade
pattern as every other key. (b) is a design decision (which search, what gets stored)
that needs its own short doc before code; do not let it block (a). _Done when:_ (a)
ships; (b) has a decision doc and, if approved, an adapter with the standard no-key
degradation.

**5.2 Claims can point home.** _(S0-b FAIL)._ `LessonStep.sourceRef?: string`
(section id/quote from `source.json`), populated when a document exists, prompted for
in the brief, verified by `critiqueLesson` against the doc's sections (a ref naming no
section = same class as a dangling `derivedFrom`). Tier 3 stays out of scope until 5.1b
exists — verifying claims against a source requires having one. _Done when:_ a document
run's lesson carries refs on ≥80% of `given` beats and a bad ref fails critique.

**5.3 The pedagogy critiques the spec asked about.** _(S1-c, S1-d, S2-a residue)._
Three `critiqueLesson` rules: a `stem`/`first-principles` lesson must carry a
misconception beat; `adaptLesson` records a problem when budget pressure drops it; a
plot/math-heavy beat may not precede every concrete (`path`/`draw`) beat in non-analogy
lessons. _Done when:_ each rule has a failing fixture and both shipped lessons pass.

**5.4 The DAG gets a second opinion, advisory.** _(S1-b)._ Warn when a topological
linearization of `derivedFrom` materially disagrees with authored order (an inversion,
not a tie). Advisory forever — W-adjacent: authored order is the design. _Done when:_
the warn exists with a fixture.

**5.5 IR hygiene.** _(A-1)._ Drop `enterAt`/`enterDuration`/`persist` from
`ElementVisual` (visuals.json's stale, unread copies — bump the sidecar version); warn
on `cast --force` when `storyboard.json` diverged from its cached compile hash (the
two-altitude clobber gets announced). _Done when:_ the fields are gone, sidecar
version bumped, and the divergence warn has a test.

**5.6 The document route stops leaking model coordinates.** _(A-2, S3-b)._
`layoutStoryboard` re-anchors arrow `from`/`to`, path `points`, and `motion.path` to
their elements' solved boxes after re-layout; the `set-camera` edit op constrains to
scene-relative presets (`tighter`/`wider`/`on <element>`), not raw x/y. _Done when:_ a
document-route storyboard's arrows survive a re-layout pointing at the same elements,
pinned.

---

## Phase 6 — topic coverage and asset trust (~2 weeks, staged; the only phase with real new lanes)

**6.1 The guard before the lanes.** _(S5-a MAJOR, honest half)._ The planner detects
the four unserved classes (chemistry notation, circuit/timing diagrams, geographic maps,
source code) by intent keywords + describe text, and says so: warn + `problems[]` +
studio note "this topic needs the X lane, which inkcast doesn't have yet" — instead of a
hallucinated benzene ring from the image lane. Cheap, ships first, and converts
confidently-wrong into honestly-limited. _Done when:_ a SMILES-bearing prompt and a
"draw a map of" prompt each produce the warning, not a wrong picture.

**6.2 The code lane.** _(S5-a, first new lane — chosen because it is the largest topic
class and the current behavior, handwriting-font code, is the worst)._ Shiki → SVG →
crisp ink, typed reveal in document order, routed from a `code` visual intent /
fenced blocks in source docs. Same contract as `equation.ts`: emits into the standard
geometry contract, `ink: 'crisp'`, cached per (code, lang, style). _Done when:_ a
"how does a hash map work" lesson shows highlighted code revealing line by line,
byte-identical across two renders.

**6.3 Circuits, chemistry, geography — by demand, not speculatively.** Circuits first
(closest: curated `symbols/circuit/*` already exist; add a netlist-ish `InlineSpec` +
dagre wiring). Chemistry (SMILES via a pure-JS renderer, crisp) and geography
(topojson + d3-geo, sketch coastlines) each get a one-page lane doc before code, and
only start when a real lesson wants them — the 6.1 guard's telemetry (`problems[]`
frequency) is the demand signal. _Done when:_ circuits render the shipped
resistor/capacitor/battery symbols wired by spec; the other two have lane docs and a
decision.

**6.4 Illustrations earn the pose lane's trust machinery.** _(S5-e, S5.6 FAIL)._
`illustrationPaths` gets retry-once + the existing ink/aspect plausibility gate (the
pattern from `resolveGeneratedPose`, verbatim); figure rasters get the corner/edge
whiteness check (non-white ground = retry, then problem) — real alpha stays deferred
until a dark-surface style pack exists, per the audit's assessment. _Done when:_ a
stubbed garbage generation is rejected and retried in tests; a grey-ground raster is
flagged.

**6.5 The figure cache key tells the truth.** _(S5-d)._ `illustrationKey` folds in the
figure model id (and style, for `kind:'figure'` only), preserving the existing `form`
cache. _Done when:_ switching `INKCAST_FIGURE_MODEL` misses the figure cache and says
why.

---

## Phase 7 — scale and cost (~1 week, after everything above; pure economics)

**7.1 The render learns partial re-encode.** _(S10-b FAIL, S10-a, S8-d)._ Per-scene
segment cache keyed on (scene's plan slice + hash of accumulated prior board state), so
a tail edit re-encodes the tail — the honest mapping under accumulate, per the audit —
and a wipe-mode edit re-encodes one scene. Keep `seg-*.mp4` on failure; skip complete
segments on retry. Determinism (A5, already PASS) is what makes the splice byte-safe.
_Done when:_ a last-beat narration edit re-encodes only the final segment and the
output is byte-identical to a full re-render — that equality is the test.

**7.2 The plan becomes inspectable on demand.** _(S7-a)._ `--emit-plan` writes
`plan.json`; `planhash.mts` gains a `--timing` mode so a timing regression is a diff.
_Done when:_ both exist and a `hold` change shows up in `--timing` and not in default
mode.

**7.3 Style packs go declarative.** _(X-f; depends on 2.2)._ Implement STYLES.md's
StylePack loader: a new style is a JSON file in `styles/` consumed by the single core
table from 2.2. The four shipped personalities become the first four packs; the
type-unions collapse to the loader's output. _Done when:_ adding a fifth style touches
zero TypeScript, and the fixed-accent discipline is enforced by the loader's schema
(this is also where a dark-surface pack would force 6.4's real-alpha work — sequence it
after, deliberately).

---

## Phase 8 — the re-audit and the bake-off (the exit; ~2 days + ~$3 of renders)

**8.1 Re-run the audit.** Same spec, same seven-pass method, against the tree with
Phases 1–7 landed. Exit bar: **every check PASS or named-waiver (W1–W6, plus any new
waiver argued in writing).** Any new PARTIAL is a Phase-9 backlog item with an owner,
not a silent regression.

**8.2 The bake-off.** _(G6)._ Render "quantum computing" and "how day and night happen
in your town" through the keyed pipeline at the explainer preset. Score our two films
and Golpo's two reference files with the same instruments: OCR diff (G2), fill/inkstat
(G3), the D1 frame (does the state equation typeset — G1), dwell/partial-draw sampling
(G4), `tandemcheck`/`synccheck` on ours (G5 — unscoreable on theirs, which is the
point). Publish the scorecard into `docs/STATUS.md`. _Done when:_ our films hit G1–G5
and the scorecard shows Golpo's files failing the defects the audit measured them
shipping. Watch both ours end to end first — no number replaces that, per this repo's
own law that the biggest wins came from opening a PNG.

---

## Coverage table — every non-PASS check, closed by exactly one item

| Check    | Sev      | Closed by       |     | Check    | Sev   | Closed by |
| -------- | -------- | --------------- | --- | -------- | ----- | --------- |
| S4-b     | CRITICAL | 1.1             |     | S6-a     | MINOR | 4.1       |
| A-4      | MAJOR    | 2.1             |     | S6-c     | MINOR | 4.4       |
| S0-a     | MAJOR    | 5.1             |     | S6-d     | MINOR | 4.3       |
| S0-b     | MAJOR    | 5.2             |     | S0-c     | MINOR | 4.3       |
| S4-c     | MAJOR    | 2.3             |     | S1-b     | MINOR | 5.4       |
| S4-e     | MAJOR    | 2.6 + W2        |     | S1-c     | MINOR | 5.3       |
| S4-f     | MAJOR    | 2.4             |     | S1-d     | MINOR | 5.3       |
| S4-g     | MAJOR    | 0.1 + 1.4 + 2.x |     | S2-c     | MINOR | 4.4       |
| S5-a     | MAJOR    | 6.1–6.3         |     | S3-c     | MINOR | 3.2       |
| S5-b     | MAJOR    | 1.2             |     | S5-d     | MINOR | 6.5       |
| S5-c     | MAJOR    | 2.2             |     | S5-e     | MINOR | 6.4       |
| S6-b     | MAJOR    | 1.3             |     | S7-a     | MINOR | 7.2       |
| D8       | MAJOR    | 1.3             |     | S7-b     | MINOR | 2.5       |
| S7-c     | MAJOR    | 2.3             |     | S8-d     | MINOR | 7.1       |
| S9-a     | MAJOR    | 3.1             |     | S9-c     | MINOR | 1.4 + 3.4 |
| S9-b     | MAJOR    | 3.1 + 3.3       |     | S9-e     | MINOR | 3.1 + 7.1 |
| S10-b    | MINOR    | 7.1             |     | S10-a    | MINOR | 7.1       |
| S5.6     | MINOR    | 6.4             |     | X-c      | MINOR | 3.5       |
| S9-d     | MINOR    | 3.3             |     | X-d      | MINOR | 3.4       |
| A-1      | MINOR    | 5.5             |     | X-e      | MINOR | 3.4       |
| A-2      | MINOR    | 5.6             |     | X-f      | MINOR | 7.3       |
| S3-b     | MINOR    | 5.6 + W3        |     | A-6      | MINOR | 4.1 + 4.2 |
| S2-a     | MINOR    | 5.3 + W6        |     | A-8      | INFO  | W1        |
| S8-e     | INFO     | W4              |     | S1-x     | INFO  | W5        |
| S3-a gap | —        | 1.2d            |     | S3-d gap | —     | 3.2       |
| S4-a gap | —        | 2.7             |     | S4-x     | —     | 2.3       |

## Sequencing, cost, and the traps

**Order:** 0 → 1 → (launch may proceed) → 2 → 3 → 4 → 5 → 6 → 7 → 8. Phases 4 and 5 can
run in parallel after 3; Phase 6.2+ can start any time after 6.1. Rough calendar:
Phase 1 in ~~2 days; Phases 2–4 are the month's core; 5–7 the month after; 8 is two days
whenever 1–7 are in. API cost is negligible until Phase 3's Tier 2 (~~$0.10/video) and
Phase 8's bake-off (~$3).

**Traps, learned from this repo's own history:**

- **Pinned hashes will move in 2.1 and possibly 2.2.** That is the change working, not
  breaking. Re-pin with the diff in front of you and the reason in the test header —
  the `longitude/short` re-pin is the template. Never re-pin blind.
- **A measurement a fix can game will be gamed.** The fill gate (2.6) counts boxes;
  do not "fix" a fill failure by inflating a box — Tier 2's inkstat exists to catch
  exactly that, and the two metrics disagreeing is a signal, not noise.
- **Do not let the gate become a re-prompt loop.** Structural failures stop and name
  the beat. The bounded repair loops already live where repair is cheap (lesson author,
  draw critic); adding retries at the gate is the S9.10 infinite-repair trap.
- **Strict-by-default will surface latent defects in old projects.** That is the
  point, but budget a day in Phase 1 for triaging the corpus, and remember `--degrade`
  exists so a demo is never blocked by a gate while you fix the real thing.
- **6.1 before 6.2/6.3, always.** An honest "can't draw this yet" ships value the day
  it lands; a new lane rushed to avoid saying it is how Odysseus drew a rocket.
