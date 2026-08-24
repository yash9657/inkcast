# Handoff — continuing PLAN-AUDIT-CLOSE from Phase 6.3

Written 2026-08-22, at `693ce46`, branch `visuals-morph-density`; updated 2026-08-23
after all of Phase 2 landed (`182a342`), again after all of Phase 3 (`ae18d4b`), and
five times on 2026-08-24 — after all of Phase 4 (`3566ac0`), after all of Phase 5
(`af524b7`, `1a1d58a`), after 6.1, after 6.2 (the code lane), and after 6.4 (the raster
trust gate).
**The plan being executed is `docs/PLAN-AUDIT-CLOSE.md`** — read it
first; it is the work list, the coverage proof, and the exit criteria. This file only
says where execution stands, what a new session needs to know that the plan cannot, and
where the bodies are buried. The evidence base behind both is `docs/AUDIT-FINDINGS.md`
(the audit, run at `5f83bc4`, plus the W1–W7 waivers now written into its §5 — W7 is
Phase 5's, and it closes half of S0-a by code and half by `docs/PLAN-RETRIEVAL.md`).

## Where things stand

**Phases 0 through 5 are landed and tested, and so are 6.1, 6.2 and 6.4:**

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

- 2026-08-24 — **all of Phase 5** (`af524b7`, `1a1d58a`): grounding honesty, `sourceRef`, the pedagogy
  critiques, IR hygiene, and the document route's leaked coordinates. The plan's progress
  block has the item-by-item inventory; six things a next session needs from this file.
  1. **No pinned hash moved, and it was checked.** `sourceRef` is optional with no
     default, so `lessonHash` of every existing `lesson.json` is unchanged; the four
     pinned compiles are byte-identical (`sbhash`, both presets). The
     `layoutStoryboard` rewrite is reachable only from the document route and
     `edit.ts`, and the heuristic document planner emits no arrows, paths or motion —
     verified by hashing `heuristicPlan` over all three `examples/*.md` × two aspects
     before and after the change: **identical, all six**. That is the regression proof
     for 5.6, because the corpus cannot supply one.
  2. **`grounding` is three values, not two.** `document` | `parametric` | `supplied`
     in `pipeline.json`, derived from what reached the author rather than from
     `source.kind` (`topic` and `text` are both typed by a person; one grounds
     nothing). Read by the CLI's `grounded` row and the studio's `GroundingNote`, which
     renders **nothing** when the field is absent — an older film has no answer and
     `parametric` is not the honest default for it. A retrieval lane would add a fourth
     value, `retrieved`; see `docs/PLAN-RETRIEVAL.md`.
  3. **`sourceRef` is a section heading, verbatim, and the no-key author fills it.**
     That is what makes the done-bar measurable with no key: `deriveLesson` lifts
     sentences out of a document, so the section is a fact it holds rather than one it
     infers. **6 of 7 citable beats on all three example documents (86%).** The recap is
     excluded from "citable" because it retraces beats already said and the brief tells
     every author to leave its ref out; the one miss per document is a passage from the
     lead paragraphs _before the first heading_, where there is no section to name.
     `critiqueLesson`'s `sections` option is how it is checked, and **absent means
     "cannot check", never "nothing is valid"** — `lesson-edit` and `critiqueFor` hold a
     lesson and no document.
  4. **Two new critique rules fire on lessons that were previously silent, on purpose.**
     A `stem`/`first-principles` lesson with no `misconception` is reported, and so is a
     `plot` beat before any `path`/`draw` beat outside the analogy lane. Consequences,
     both intended and both now asserted in tests rather than worked around: **shipped
     gradient-descent at `short`/`explainer`/`square`** carries one advisory (the budget
     really does cut its refutation, and `adaptLesson` says so separately through
     `onProblem`); and **every `deriveLesson` lesson** carries the misconception line,
     which is the same thing that author's own warning has always said out loud. Four
     tests in `planner/test/lesson.test.ts` were changed from "clean" to "clean except
     the named things this author provably cannot do".
  5. **5.4 is not in `critiqueLesson`, and must not be moved into it.**
     `lessonOrderAdvisories` (core) → the `lesson-order` warn check. Critique output is
     fed back to the lesson author as failures to fix; authored order carries
     information a toposort destroys. `auditcheck` pins the separation.
  6. **The `--force` clobber warn needed a new function.** `cache.json` records a
     stage's _inputs_, so it cannot answer "has this file been edited by hand".
     `compiledFingerprint` (`pipeline/src/keys.ts`) hashes the board with every later
     stage's in-place enrichment stripped — `durationSec`/`words`/`audioPath`,
     `enter.at`, `Asset.svg`, `ref.version`, title and meta — so on `via: 'lesson'`,
     where the compile is pure and pinned, any remaining difference _is_ a hand edit.
     Scoped to that route: on the document route a difference is the model.

- 2026-08-24 — **6.1, the guard before the lanes.** `unservedLanes` in
  `core/src/lanes.ts` reads every `describe` and `underlay.prompt` (and the lesson's own
  subject, only when no picture in that lane already fired) and names the four classes
  nothing here can draw. Five things a next session needs from this file rather than from
  the plan's progress block.
  1. **It is in core, not in the planner, and that was argued rather than assumed.**
     `sniffMath` is in the planner because it makes a routing decision inside the
     compiler; this makes none — it is a judgement about a `Lesson`, like
     `critiqueLesson` and `lessonOrderAdvisories`, and it is read by the pipeline, the
     studio and (one day) the lesson brief. Core is the only package all three can
     depend on. The pipeline could not have reached it in the planner without extending
     the `stages.ts` mirror, which is the shape of the argument in code.
  2. **The rule is "detect the notation, not the topic", and the corpus is the proof.**
     Swept over all 38 lessons on disk — 79 distinct pictures, underlay prompts included
     — it fires **zero** times. That is not luck: the corpus is full of chemistry- and
     electronics-shaped films whose pictures this pipeline draws correctly, and every
     one of them (`a lithium atom…`, `a wire looping through a small bulb`, `water
molecules… hydrogen bonds`, `a globe with meridian lines`, `a bowl-shaped loss
function`, `a map of the analogy`) is in the QUIET list in
     `core/test/lanes.test.ts`. If a future signal is added, add it to that list first.
  3. **It warns; it does not suppress the picture.** A deliberate deviation from the
     item's done-bar ("not a wrong picture"), argued in the plan's progress block and
     pinned by `auditcheck` (`lanes.ts` contains no `gate(` and no `throw`). Suppression
     trades a wrong picture for a missing one and belongs with the lane that replaces the
     fallback.
  4. **Four surfaces:** `log.warn`, the `lane-coverage` **warn** check in `qc.json`
     (per-beat findings), `lanes.unserved` in `pipeline.json` (names only), a CLI block,
     and `LaneNote` in the studio. Not on `/share/<id>` — `publicView` is an allow-list,
     so that took no code, and the reader who can act on it is the one casting.
  5. **The table expires mechanically.** Each lane names the library that would end it,
     and `auditcheck` fails if that library ever appears in a `package.json` while its
     lane is still declared unserved. **It has already fired once**: installing `shiki`
     for 6.2 failed that check, which is how `code` came out of `UNSERVED` in the same
     commit as the lane rather than in a follow-up nobody wrote.

- 2026-08-24 — **6.2, the code lane** — the first new lane, and the four things a next
  session needs from this file rather than from the plan's progress block.
  1. **It is `equation.ts`'s contract, and that is not a family resemblance — it is the
     design.** `visuals/src/code.ts` resolves a listing into ordered glyph geometry and
     records it in the sidecar; `codePrims` in `render/src/compile.ts` reads it and emits
     one prim per glyph. Both are the equation lane's shape because both answer the same
     question the same way: typesetting is an async import of a large module and
     `compilePlan` is synchronous, so the sidecar is not a convenience but the only
     mechanism. The one addition is `CodeLayout.parts` — ink runs as index ranges into the
     draw sequence, the same shared numbering `PlotLayout.parts` uses.
  2. **The tone travels; the colour does not.** Shiki is asked about scopes through a
     four-entry TextMate theme whose colours are sentinels (`#000002` = the accent), and
     the renderer maps the tone through `toneInk`. That is not a stylistic choice about
     highlighting, it is 2.2's rule: a colour written by the visuals stage has reached no
     pixel since the plot-role remap, so a lane that recorded real hex would silently draw
     in the film's ink anyway and the highlighting would vanish. If you add a scope, add it
     to `TONE_THEME` and to the tone assertions in `visuals/test/code.test.ts`, which read
     the ink back off `parts` by line and column.
  3. **The glyph outlines are in core's sfnt reader, not a dependency.**
     `FontMetrics.outline(cp)` parses `glyf`/`loca` beside the `cmap`/`hmtx` parse already
     there. `opentype.js` would have been a second font parser, which is the exact
     pathology A-4 named. Consequences worth knowing: **a CFF/OTF face returns `undefined`**
     (no charstring interpreter, and no such face is vendored), so does `builtinMetrics`,
     and only the variable font's **default instance** is read — `gvar` deltas are not, so
     asking for bold code would need an interpolator and nothing asks. `H` is all lines and
     `o` is all curves, which is the sharpest test of the on/off-curve flags there is and is
     asserted in `core/test/codegrid.test.ts`.
  4. **One face for every ink style**, unlike `HAND_FONTS`, and on its own search path.
     `codeFontDirs()` sees `assets/fonts/code/` and `defaultFontDirs()` deliberately cannot
     — `findFontFile`'s last resort is "any font at all", so one shared path would letter a
     whole board in JetBrains Mono, `source: 'file'`, no warning, in a tree whose
     handwriting faces had gone missing.

  **Found on the way past, and it was the larger half of the document route.**
  `parseBlocks` normalised the whole document with `normalizeWhitespace` before splitting
  it into lines, so `[ \t]+ → ' '` deleted every fenced block's indentation before any lane
  could see it — and `beats.ts` then trimmed each line, dropped any starting `//` or `#`
  (a Python comment, a shebang, a C directive), cut each to twelve words, and
  `heuristic.ts` drew the result as a `stack` diagram of handwritten boxes. The parser now
  keeps two views of its lines — prose collapsed, a fence verbatim — and the two halves of
  that are `normalizeChars` and `collapseSpaces` in `planner/src/text.ts`. **If you touch
  either, the test that catches a regression is `planner/test/code-lane.test.ts`'s "keeps a
  fence verbatim and still collapses prose".**

- 2026-08-24 — **6.4, the raster trust gate** — five things a next session needs from this
  file rather than from the plan's progress block.
  1. **Every threshold came off the cache, and the cache was opened.** All 42 rasters in
     `~/.inkcast/cache/illustrations` were traced, measured and then _looked at_ one by one.
     That is the only corpus of real provider output this repo owns, it costs nothing to
     read, and the three constants in `visuals/src/image.ts` each carry their measurement in
     their own comment. **5 of 42 rejected, all five failures by eye, zero false positives.**
     Do the same before moving any of them; a number argued without the corpus will not
     survive 8.1.
  2. **The aspect half of the plan's bar could not be taken verbatim, and the measurement is
     why.** `plausibilityGate` scores a pose against a composed pose of the same character,
     so aspect means "is this the same subject". An illustration has no base — the shape we
     ask for is the shape of the _box_. Scoring illustration aspect against the request that
     way rejected a ship on a horizon (2.90:1) and a cross-section (3.15:1), both good. What
     shipped is an absolute ceiling on how strip-like a subject may be (4:1), which catches
     the two rasters where the model wrote words instead of drawing (4.57:1, 4.81:1).
  3. **Cached rasters are gated, which the pose lane does not do to its cache.** That cache
     only ever held accepted poses; these two predate the gate and hold the audit's own
     evidence. It is not a theoretical difference: the one real rejection on a full cast came
     from the machine cache, not from a generation. A rejected _cache hit_ is reported and
     the caller degrades — it is never regenerated, because silently re-billing for a subject
     the cache already answered would break "one generation per id, ever". The note names the
     file so a human can delete it.
  4. **The gate abstains when it cannot see, and that is load-bearing.** A missing native
     tracer, an unreadable PNG, an interlaced one — all return `ok` with no reason. The
     tracer is an `optionalDependency`; a gate that condemned what it could not measure would
     turn a platform without a prebuild into a lane that draws nothing. `TraceResult` names
     `unavailable`/`unreadable`/`empty` precisely so `empty` — the tracer ran and found
     nothing — can still be a rejection.
  5. **A PNG reader went into `visuals/src/png.ts`, not into `package.json`** — 6.2's `glyf`
     reasoning, one lane over. It reads 8- and 16-bit, non-interlaced, colour types 0/2/3/4/6
     (every PNG either provider has returned) and abstains on the rest. `test/pngfixture.ts`
     encodes fixtures so the reader is tested against bytes this repo produced from a known
     image, all five filter types included, rather than against a checked-in blob.

  **What it does not do, and the commit should not be read as saying otherwise.** It is a
  floor, exactly as `plausibilityGate` is. The hallucinated benzene ring the audit's S5-a is
  named after — a red circle containing `"B,H,"` with eight arrows into it — scores 0.91 and
  passes; so does the structural-formula page at 0.75. Catching a confident drawing of the
  wrong thing needs a model that can look at a picture, which is Tier 2's vision pass and is
  still unexercised against a live model. `auditcheck` pins the header sentence that says so.

  **Found on the way past, not fixed:** `generatedAssets` (`pipeline/src/cast.ts:989`) counts
  assets whose `source` is `generated` whether or not a provider was called, so a run served
  entirely from cache still bills for images. It is finding 4 in the remainder handoff, and
  6.4 left the answer sitting there — `IllustrationRaster.from` is `project`, `cache` or
  `provider` on every resolve.

The plan's own header carries a progress block saying the same thing; keep that block
current as phases land. Per-phase detail also lives in Claude's project memory
(`audit-close-progress`), but this file and the plan header are the durable record.

**Verified end to end, after 6.2:** `projects/qc62-hashmap` is a strict no-key cast of
`examples/lessons/hash-map.lesson.json` — a new third shipped example, and the corpus's only
board with a listing on it. Its two `code` beats type themselves on line by line
(frames at 34.6 / 36.3 / 38.0s: at 35.9 the pen is mid-way through `def get(sel`, at 36.3
lines one and two are complete and line three is starting). Both halves of the done-bar were
measured rather than argued: `frames.mts` over **two independent renders of the same
project** returns byte-identical PNGs at five timestamps including two mid-reveal, and
`geomhash.mts` reports `s3/b3_v0` (63 strokes) and `s5/b5_v0` (114) identically across two
runs of the visuals stage. **The same cast is also 6.4's evidence**: its six `draw` beats have
no drawing author (no Anthropic credit) and fall through to the illustration lane, where
`fal` — which does have credit — returned tiny illegible scribbles for "a name, an arrow into
a rule box, an arrow out to a highlighted pigeonhole". Same class as the aspirin page below,
in one command.

**Verified end to end, after 6.1:** `projects/qc61-longitude` is a strict no-key cast of a
shipped lesson — clean, `lane-coverage: pass`, and **no `lanes` key in `pipeline.json`**,
which is the half of the guard that has to stay silent. `projects/qc61-aspirin` is the
other half: a hand-authored lesson (the fixture is in this session's scratchpad, not in
`examples/` — the test there asserts every shipped lesson is clean) asking for three
chemical structures. All three are reported, the film still renders, `qc.ok` stays true,
and `pipeline.json` records `lanes: {"unserved": ["chemistry"]}`. **Open the two pictures
it generated before deciding this guard is pedantic**:
`~/.inkcast/cache/illustrations/the-skeletal-formula-salicylic-5413f1e9f2.png` is a blank
page with _"Salèylic acisH."_ handwritten across it, and `benzene-ring-with-its-147c73c1e1.png`
is a red circle containing _"B,H,"_ with eight arrows pointing at it. Neither is a molecule
and both would have shipped without a word.

**Verified end to end, after Phase 5:** strict no-key casts of both shipped lessons
(`projects/qc53-longitude`, `projects/qc53-gd`) are clean with every Phase 2–5 gate live,
and record `grounding: "supplied"`. `projects/qc53-doc` is a document through the _lesson_
route — `grounding: "document"`, `sourceRef` on 6 of its 8 beats, `qc.ok: true`, and the one
advisory is the misconception the no-key author cannot invent. `projects/qc53-viadoc` is
`--via document`, and it **fails the strict gate** on `vacant`, `duration` and `ink-floor`
— all Phase 2/3 gates, all pre-existing, and exactly the class the corpus table below
already names: that route is the renderer fixture path and `plan.ts` says in its own header
that it is "not a route to a watchable video". It reached the gate, which is the regression
check that mattered: layout, voice, visuals and check all ran over a 24-scene
model-shaped board.

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
  re-checkable facts, currently **65**, all green. **The plan (item 0.3) says each item
  adds its line here as it closes.** Every Phase 1–5 item's lines are in.
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

## What remains to close the audit: 6.3 → 7 → 8

**The seven remaining items have their own handoff: `docs/HANDOFF-AUDIT-REMAINDER.md`.** It
carries, per item, the plan's bar, the verified file anchors to start from, the decisions
already made that constrain it, and the traps — plus the four things that gate the work
(no API credit, the `DELIVERED_WPS` disagreement, the `deriveLesson` author bug, and the
image cost line billed from intent). Open it
when the question is "what next"; this file stays the record of what landed and why. The
summary below is the shape of the road only.

**The audit is not closed.** Phases 0–5 and items 6.1, 6.2 and 6.4 are landed; the rest of
Phases 6–8 of `docs/PLAN-AUDIT-CLOSE.md` are open, and that plan stays the authority on
scope, done-bars, and the coverage table that maps every non-PASS audit finding to exactly
one item or waiver.

- **Phase 6 — topic coverage and asset trust** (~2 weeks, staged). 6.1, 6.2 and 6.4 are
  done. Left: 6.3 circuits/chemistry/geography by demand, lane docs first; 6.5
  `illustrationKey` folds in the figure model id.
  **When a lane lands, delete its entry from `UNSERVED` in `core/src/lanes.ts`** — the
  auditcheck line will say so, but the studio would otherwise go on apologising for a
  lane that exists.
- **Phase 7 — scale and cost** (~1 week, after everything above). 7.1 per-scene
  segment cache / partial re-encode (byte-identical splice is the test); 7.2
  `--emit-plan` + `planhash --timing`; 7.3 declarative StylePacks (depends on 2.2, and
  sequenced after 6.4, which has landed — but see the remainder handoff's 7.3 section:
  6.4 gave a dark pack a way to _detect_ an opaque white ground, not a way to remove it).
- **Phase 8 — the exit** (~2 days + ~$3). 8.1 re-run the audit: every check PASS
  or named-waiver (W1–W7 plus the two Phase-2 recalibrations argued in W2 and the
  plan's progress block). 8.2 the bake-off: render Golpo's two reference topics,
  score both films and Golpo's with the same instruments, publish the scorecard in
  `docs/STATUS.md` — and watch both films end to end first.

Ordering per the plan: **6.1, 6.2 and 6.4 are in, and nothing among 6.3, 6.5 and 7.1–7.3
blocks another**; 8 is the exit. 6.3 is still the wrong item to start cold — its demand
signal is 6.1's findings and the guard has fired on nothing in the corpus. API cost is
negligible until 8.2 (3.3's Tier 2 is keyed and cached, ~a few cents a film, and skips
itself with no key).

Session-found context for Phase 6 and after (so the next session does not re-derive it):

- **The plan's 6.3 is wrong about the circuit symbols, and it matters for sequencing.**
  It says circuits are "closest: curated `symbols/circuit/*` already exist". They do not:
  `assets/library/` holds `symbols/physics/force-vector` and `symbols/physics/mass`, and
  nothing else under `symbols/`. Circuits may still be the closest lane — dagre is already
  a dependency and the wiring is a graph — but the symbol set is work, not inventory.
- **`rerender()` drops most of `pipeline.json`'s film-level fields.** 6.1 fixed
  `grounding` and `lanes` (both inherited now); `drift` and `qc` are recomputed there, and
  `source` and `lesson` were already inherited. Anything added to `PipelineState` from now
  on has to answer "does a re-render erase this?" — the answer for anything describing the
  **film** rather than the **run** is that it must be inherited on that path.

- **The `deriveLesson` fallback lies about who wrote the lesson, and Phase 5 made it
  visible.** On a document run with a key that has no credit, the CLI reports
  `providers lesson anthropic` and a ~$0.04 lesson cost while the _heuristic_ author
  actually wrote it (`projects/qc53-doc` — its `sourceRef` pattern is `deriveLesson`'s,
  not a model's). `resolveLessonAdapter` answers "which adapter would run" and
  `teachLesson` falls back inside the stage, so `design.author` never learns. Same shape
  as the phantom-cost bug 3.5's `lessonAuthored` flag closed for a _cached_ lesson, and
  the same fix: the stage has to report the author it turned out to be. Small, and it
  makes every cost report on a degraded run wrong.
- **The document route cannot verify 5.6, and the unit tests are the proof instead.**
  `layoutStoryboard`'s re-anchoring only fires on arrows, `path.points` and
  `motion.path`, and the _heuristic_ document planner emits none of the three — so
  casting `examples/*.md --via document` exercises the code path and never its subject.
  Three tests in `planner/test/layout.test.ts` build a model-shaped board (absolute
  boxes far from where the packer will put them, an arrow by coordinate, a path, a
  motion) and assert the endpoints land on the solved boxes. The regression proof that
  nothing _else_ moved is the hash comparison described above. If a keyed session ever
  runs `--via document` with the Anthropic planner, that is the first real end-to-end
  exercise of 5.6 and worth reading the frames of.
- **`--via document` fails the strict gate, and that is not a Phase 5 regression.**
  `projects/qc53-viadoc` blocks on `vacant` (7.9% mean fill), `duration` (145% of
  target) and `ink-floor` — the Phase 2/3 gates doing exactly what the corpus table
  above says they do to that route. `plan.ts`'s own header calls it "not a route to a
  watchable video". Use `--degrade` when you need it to render.
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

Earned in the Phase 5 session:

- **A new rule that fires on a shipped artefact is a finding, not a test to soften.**
  5.3's misconception rule fires on shipped gradient-descent at `short` — the budget
  really does cut its refutation — and on every `deriveLesson` lesson, which provably
  cannot invent one. The temptation was to scope the rule until both went quiet. What
  the tests assert instead is the _named_ exception, in each case with the reason: the
  budget cut it (and `adaptLesson` says so separately), or the author cannot invent it
  (and its own warning has always said so). A rule scoped to keep the corpus green is a
  rule that has stopped measuring anything.
- **Two reports of one absence are not duplication when they answer different
  questions.** "This film names no misconception" (critique → `lesson.problems`) and
  "the 60s budget cut it" (`adaptLesson` → `stages`) look like the same line twice, and
  neither can be derived from the other: the first is about the film, the second about
  the run, and a reader of `qc.json` needs both to know whether to fix the lesson or
  cast it longer. The rule for telling this from real duplication: if one line would
  still be true with the other's cause removed, they are two facts.
- **Recover the intent, do not transform the numbers.** 5.6's first shape was an affine
  remap of every arrow endpoint through the scene's bounds — which moves the ink and
  still leaves it pointing at nothing, because an arrow does not mean "these two
  coordinates", it means "from this thing to that thing". Matching each endpoint back
  to an authored box and then handing the arrow to the `fromId`/`toId` anchoring that
  already worked is both smaller and correct, and it fixed a second defect nobody had
  named: an un-hinted arrow was being _packed into the shelf_, reserving a row slot
  while its ink was drawn somewhere else entirely.
- **The cache cannot answer "was this edited by hand".** It records a stage's inputs, so
  a fresh entry says the inputs are unchanged and nothing about the file. Answering it
  needed `compiledFingerprint` — the board with every later stage's in-place enrichment
  stripped — and the list of what to strip is the real content of the function:
  `durationSec`/`words`/`audioPath` and `enter.at` (voice), `Asset.svg` and
  `ref.version` (visuals), title and meta (the run's own flags). Get that list wrong in
  either direction and the warning is either noise on every narrated project or silent
  on the edit it exists to announce.
- **A `sourceRef` measurement is only honest once you say which beats _can_ carry one.**
  The plan's bar is "≥80% of `given` beats"; the raw number is 75%, and the two misses
  per document are the recap (which cites nothing by design, in every author) and a
  passage lifted from the lead paragraphs before the first heading (where there is no
  section to name). Reported as 86% of citable beats **with both exclusions named**,
  because "75%, below the bar" and "86%, and here is exactly what the other 14% is" are
  the same measurement and only one of them is useful. The fix that would have hit 80%
  on the raw number — citing the nearest heading — is the untestable citation the field
  exists to prevent.

Earned in the 6.1 session:

- **A detector that is also a demand signal must be tuned for precision, not recall.**
  6.3 decides which lane to build from how often 6.1 fires, so a false positive is a vote
  for building a renderer nobody needs — a different and worse failure than a miss, which
  costs one wrong picture that ships today anyway. This inverted the usual instinct: the
  chemistry rule was cut back until "molecule", "hydrogen bond" and "atom" no longer fired
  at all, because the corpus draws all three correctly. The QUIET list in
  `core/test/lanes.test.ts` is the artefact of that, and it is the list to extend first
  when a new signal is proposed.
- **A detector over English needs a corpus sweep before it needs tests.** The first
  chemistry rule fired on the shipped lithium-ion film (which draws an atom, correctly);
  the first SMILES rule matched `cocoons` and `spoons`, because a molecule and an English
  word are spelled from the same letters — what separates them is a bracket or a ring
  digit, not the alphabet. Both were found by running the thing over all 38 lessons on
  disk in ten seconds, and neither would have been found by writing tests from
  imagination first.
- **"Not a wrong picture" was worth reading twice.** The done-bar can be read as "suppress
  the picture", which is a quality decision with no frames behind it and a much larger
  blast radius than the item's own "cheap, ships first". Written down as a deviation with
  the argument, and pinned by `auditcheck` so the smaller thing cannot silently become the
  larger one.

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

Earned in the 6.4 session:

- **Measure the corpus, then _open_ it — the numbers and the eye disagree about which
  failure is which.** The metric that looked obviously right for catching a blank page
  (how much of the raster the ink covers) turned out to be nearly useless, because
  `vectoriseToInk` scales the traced ink box to fill its element: a subject drawn tiny in
  the corner of a page is not drawn tiny on the board. Only opening the images showed
  that. Conversely a metric that looked crude — total stroke length over the ink box's own
  diagonal — separated three real failures from every real drawing with a 2.4× gap.
- **A threshold's honesty is the false positives you looked for and did not find.** Every
  candidate rule here was run over all 42 cached rasters and its rejections opened one by
  one. That is what killed the aspect-against-the-request rule (it rejected a ship and a
  cross-section) and what makes the shipped 4:1 ceiling defensible at the re-audit. It cost
  about twenty minutes.
- **A check that cannot see must abstain, and the failure modes have to be named to let
  it.** `traceImage` used to collapse "the optional native tracer is missing", "these bytes
  are not an image" and "the tracer ran and found nothing" into one `undefined`. A gate
  built on that would have turned a platform without a vtracer prebuild into a lane that
  draws nothing. Splitting them was three lines and is the difference between a gate and an
  outage.
- **"Verbatim" in a plan's bar is a hypothesis about transferability, not an instruction.**
  `plausibilityGate` works because it has a base to compare against. Half of it does not
  transfer to a lane with no base, and the corpus said so in minutes. Copy the _shape_ —
  retry-once, an injectable seam, cache only what passed — and re-derive the _thresholds_.
- **Point tests at a throwaway `INKCAST_HOME`.** These were the first tests to generate
  rasters, and the first run wrote `rover-c6875525a1.png` into the real machine-wide cache —
  the tier whose whole job is making two films agree about what the rover looks like.
  `cacheDir()` reads the environment on every call, so one line at the top of the test file
  fixes it; without it a test suite quietly poisons a shared cache.
