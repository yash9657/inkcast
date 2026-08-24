# Handoff — the remaining items of PLAN-AUDIT-CLOSE

Written 2026-08-24, branch `visuals-morph-density`, immediately after item 6.1 landed;
updated the same day when 6.2 (the code lane, committed with 6.1 as `dcd0394`), then 6.4
(the raster trust gate, `e9487e7`), then 6.5 (the figure cache key, `b9cec6d`) and then
7.2 (the inspectable plan) landed and their sections were deleted from this file.
Updated again the same day, after 7.2, with **an ordered plan** ("The order to knock these
out", below) and with gating findings 3 and 4 promoted into **item 0**, a real work item
with verified anchors.
**Forward-looking only.** Its sibling `docs/HANDOFF-AUDIT-CLOSE.md` records
what has already landed and why, and stays the authority on that; this file is the one to
open when the question is "what do I do next, and where do I start it". The plan itself —
`docs/PLAN-AUDIT-CLOSE.md` — remains the authority on scope, done-bars and the coverage
table; every item below quotes its bar rather than restating it, and where this file
disagrees with the plan it says so out loud.

## Where execution stands, in one paragraph

Phases 0–5 are landed and tested, and so are 6.1 (the honest guard for the three remaining
unserved topic classes), 6.2 (the code lane — the fourth class is served now), 6.4 (the
raster trust gate), 6.5 (the figure cache key names the model that drew it) and 7.2 (the
plan is inspectable on demand). The tree is committed through 7.2. At that point: **1128
tests green** (3 pre-existing keyvault skips, 1131 total), **auditcheck 92/92**, lint and
typecheck clean, and three shipped lessons casting strict-clean end to end (`hash-map` is
the newest, and the corpus's only board with a listing on it). Five items remain — 6.3,
7.1, 7.3, 8.1, 8.2 — and none of 6.3, 7.1 and 7.3 blocks another, so they can be reordered
freely by whoever picks them up. Phase 8 needs all of them plus a funded API key.

## The order to knock these out

Five plan items and three loose findings remain. This is the order they are best done in
and the reason for each; only two of the reasons are real dependencies, and they say so.

**1. Item 0 below — "the run reports what it did, not what it intended"** (gating findings
3 and 4, promoted to a work item with anchors). Half a day, no key needed, and it is first
because every cost line and every `providers lesson …` line printed between now and 8.1 is
wrong without it — on runs that are now the common case. It is also the smallest possible
warm-up in the two files the next three items all touch.

**2. Gating finding 2 — decide `DELIVERED_WPS`.** A measurement and an argument, not a
feature. First real dependency: **do it before 7.1**. A new pacing constant moves
`adaptLesson`'s trimming and therefore the four pinned hashes, and 7.1's done-bar is a
_byte-identical_ comparison — settling the hashes first keeps "the splice is exact" and
"the film got shorter" from being argued in the same diff.

**3. 7.1 — partial re-encode.** The only **FAIL** left in the audit's table (S10-b); every
other open item is a PARTIAL. It is the biggest item in the plan and wants a session of its
own, and its first piece is a design decision (segments are worker slices today, not
scenes) rather than typing. 7.2 just handed it two instruments — see that section.

**4. 7.3 — style packs go declarative.** Unblocked but not free: read its section before
believing 6.4 unblocked it. The honest reading is that a dark pack needs the real-alpha
work S5.6 deferred, so budget for that or scope the pack to light surfaces and say which
in writing — either is defensible, silence is not.

**5. 6.3 — circuits, chemistry, geography.** Last on purpose. Its own rule is that the next
lane is chosen from 6.1's findings, and the guard has still fired on nothing, so the honest
output of this item today is a **written decision plus the two lane docs**, not a lane. Do
it once the corpus has had a few more films through it — which items 1–4 will produce.

**6. 8.1, then 8.2.** 8.1 needs 6.3–7.3 landed or waived in writing and re-reads everything
below. 8.2 additionally needs ~$3 of credit and a small harness that does not exist yet
(see its section). Neither is startable today.

## How to verify anything you land

```
pnpm -r typecheck && pnpm -r test && pnpm lint
npx tsx packages/pipeline/src/auditcheck.mts
node --import tsx apps/cli/src/index.ts --lesson examples/lessons/longitude.lesson.json --project <scratch-id>
```

The last line is the strict end-to-end proof (strict is the default; no key needed — a
voice-provider fallback in the output is a provider event, not a gate failure). The three
shipped lessons are `examples/lessons/*.lesson.json`; cast `hash-map` too when you touch
the compiler, because it is the only board in the corpus with a listing on it. Disposable
evidence projects follow the `qc<phase>-<lesson>` convention (`projects/qc65-longitude` is
the newest; `qc64-hashmap`, `qc64-longitude` and `qc64-gd` are the whole shipped corpus at
6.4). Two more instruments worth knowing, both used to prove 6.2's and 6.4's done-bars and
both cheap:
`npx tsx packages/visuals/src/geomhash.mts <project>` hashes every element's
resolved geometry (one line each, ideal across a `git stash`), and
`npx tsx packages/render/src/frames.mts <projectDir> <outDir> [t...]` grabs single frames
without an encode — run it twice into two directories and `cmp` them for a real
determinism check. 7.2 added two more: `--emit-plan` on any cast or rerender writes
`<project>/plan.json` (the compiled timeline, written for reading and never read back), and
`npx tsx packages/render/src/planhash.mts --timing <project>` turns a _schedule_ change into
a diff the way the default mode does for geometry.

**If you touch the illustration lane, measure against the cache before choosing a number.**
6.4's three thresholds were each set by tracing all 42 rasters in
`~/.inkcast/cache/illustrations` and then _opening them_ — the numbers are in the constants'
own comments in `visuals/src/image.ts`. 6.5 used the same corpus for a different question
(8 of those 42 are colour figures, 34 are form line art), which is what decided that a
built-in model contributes nothing to a cache key. That cache is the only corpus of real
provider output this repo has, it costs nothing to read, and a threshold — or an
invalidation — argued without it is one nobody can defend at the re-audit.

**And if you touch a cache key, cast a project that already exists.** Four tiers sit between
a storyboard and a raster, and the visual manifest's freshness record is asked first: a key
that is honest at the raster tier is never reached on a re-cast. That is the half of 6.5's
done-bar the plan's wording did not have.

## Four things that gate the work

1. **There is no API credit.** Both providers answer `402 Payment Required`, which is why
   `qc.json` records `frame-vision: skip` on every recent cast. Two consequences: **8.2
   cannot run at all**, and Tier 2's vision pass has still never been exercised against a
   live model — every one of its code paths is tested with a stub. The first session with
   credit should spend one keyed cast reading `qc.json`'s `frame-vision` findings against
   the frames by eye, because that false-positive count is what decides whether the check
   is promoted from advisory to blocking (plan 3.3).
2. **`DELIVERED_WPS = 2.2` fits one shipped film and not the other** — _second in the
   order above, and before 7.1._ — longitude delivers
   2.23 w/s, gradient-descent 2.50 (+14%). Every run says so through the
   `pace-calibration` advisory. Nothing has been changed because a new number moves
   `adaptLesson`'s trimming and therefore the four pinned hashes. Somebody has to choose
   between a re-measured constant, a per-cadence rate (the two films differ in how many
   beats are `punchy`) and accepting the spread, and argue it in `presets.ts` beside the
   constant. **The re-audit will read that advisory**, so it is an 8.1 conversation at the
   latest.
3. **`deriveLesson` lies about who wrote the lesson.** _(Owned by item 0 below, which
   carries the verified anchors and the shape of the fix.)_ On a run whose key has no credit
   the CLI reports `providers lesson anthropic` and a ~$0.04 lesson cost while the
   heuristic author actually wrote it (`projects/qc53-doc`). `resolveLessonAdapter`
   answers "which adapter _would_ run" and `teachLesson` falls back inside the stage, so
   `design.author` never learns. Same shape as the phantom-cost bug 3.5's `lessonAuthored`
   flag closed for a cached lesson, and the same fix: the stage reports the author it
   turned out to be. Small, unowned, and it makes every cost report on a degraded run
   wrong — which is now the common case.
4. **The image cost line is billed from intent, not from what happened.** _(Owned by item
   0 below.)_ `generatedAssets`
   at `cast.ts:989` counts every asset whose `source` is `generated`, whether or not a
   provider was called, so a run served entirely from the machine cache still reports
   `visuals fal $0.0120` (measured on `projects/qc64-hashmap`: four "generated" assets, zero
   provider calls, the cache unchanged at 42 files afterwards). Same family as item 3 and as
   the phantom-cost bug 3.5 closed, and **the lane already knows the answer** — 6.4 left
   `IllustrationRaster.from` reading `project`, `cache` or `provider` on every resolve, so
   this is a counting change, not an investigation.

## Rules that apply to every item below

- **Pinned hashes moving is the change working, not breaking.** Re-pin with the diff in
  front of you and the reason in `pinned-hashes.test.ts`'s header. Never re-pin blind. A
  purely additive storyboard diff is its own coverage proof and is cheaper than frames
  (4.1's re-pin is the template); a diff that moves geometry needs frames.
- **New checks go in the gate stage.** `check()` in `render/src/check.ts` assembles
  `QcCheck`s; adding one is a `qcCheck(id, findings, {severity})` in that list plus, if it
  needs a number, a pure function beside the others in `boardcheck.ts` or `tier2.ts`.
  `severity: 'warn'` for a judgement, the default `fail` for a fact.
- **A stage reports what it degraded through `onProblem`**, never through a log line
  alone; the run collects it into `qc.json`. `onSpend` is the same rail for billable
  calls, and the rule there is that a cost line is built from observed quantities.
- **Anything added to `PipelineState` must answer "does a re-render erase this?"** Fields
  describing the _film_ (not the run) have to be inherited in `rerender()`, which
  rebuilds the file from scratch. `grounding` was silently lost this way until 6.1.
- **Corpus-derived constants are named recalibrations, not spec values.** `MIN_GLYPH_PX`
  (10 output px), the fill floor (mean 18% / scene 11%), `MIN_INK_SHARE` (1.0%),
  `MAX_REVEALS_PER_SCENE` (9), and 6.4's `MIN_TRACED_INK` (3.0), `MAX_INK_ASPECT` (4.0) and
  `MIN_GROUND_WHITE` (0.9) were each measured against the corpus and argued in the
  constant's own comment. 8.1 must treat them as such.
- **Do not let a gate become a re-prompt loop.** Structural failures stop and name the
  beat; the bounded repair loops live upstream where repair is cheap.
- **`--degrade` exists so a demo is never blocked while you fix the real thing.**

---

# Item 0 — the run reports what it did, not what it intended

**Not a numbered plan item.** It is gating findings 3 and 4 promoted to work, because they
are one bug wearing two hats and the rails to fix them both already exist (plan 3.4's
`onProblem`, plan 3.5's `onSpend`; audit X-c, X-e). 8.1 will read a cost report, so this is
an 8.1 conversation at the latest — better to have it now, when it is half a day.

**The bar (this file's, argued rather than quoted).** Every line the run prints about what
it spent and who wrote the lesson is built from what it _observed_. _Done when:_ a
creditless cast of a shipped lesson reports `lesson heuristic` and a `$0` lesson line, and a
cast whose rasters all came from the machine cache reports no image cost while still drawing
the same film. Both are reproducible today, for free — that is the point.

**Where the code is** (line numbers verified 2026-08-24, after 7.2 — they moved twice
already, so re-grep rather than trusting them):

- `author = adapter` at `cast.ts:615`, taken from `resolveLessonAdapter`, which answers
  "which adapter _would_ run".
- The fallback that makes it a lie is inside the stage: `planner/src/lesson.ts:86-90` —
  `anthropicLesson` returns `undefined` on a 402 and `deriveLesson` writes the lesson
  instead. `teachLesson` returns a bare `Lesson`, so nothing upstream can learn what
  happened.
- `generatedAssets` at `cast.ts:1008` counts assets whose `source` is `generated` and that
  are new this run; `cost.ts:235-240` turns that count into the image line.
- **The visuals package reports no spend at all** — `grep -rn onSpend packages/visuals/src`
  is empty, and `cast.ts:988` passes `onProblem` but not `onSpend`. That is _why_ the image
  line is built from intent: there is currently nothing else to build it from.
- The rail exists and is already used one lane over: `draw-underlay.ts` notes
  `{ lane: 'underlay', images: 1 }` only when `!raster.cached`, and `cost.ts:195` already
  groups `ModelSpend`s by lane and provider.
- 6.4 left `IllustrationRaster.from` reading `project | cache | provider` on every resolve,
  so the lane already knows which tier answered. This is a counting change, not an
  investigation.

**The shape of both fixes is one sentence: the stage reports what it turned out to do.**

- _The lesson._ `teachLesson` reports the author it actually used (an `onAuthor`-shaped
  callback beside `onProblem`/`onSpend` keeps the return type alone and matches the idiom;
  returning `{ lesson, author }` is the other defensible choice and costs every caller).
  **Then record it** — and this is the half that is easy to miss: neither `lesson.json` nor
  `pipeline.json`'s `lesson` block (`cast.ts:1246`) carries an author, so a _cached_ lesson
  cannot answer the question at all. `state.lesson` is inherited on a cached run
  (`state.ts:266`), so recording the author there is what makes the second run as honest as
  the first. 3.5's `lessonAuthored` flag is the precedent for the cost half.
- _The images._ Thread `onSpend` into `resolveVisuals`, report one image per real provider
  call (`cached === false`, or `from === 'provider'` for the finer story), and let `cost.ts`
  group them. `generatedAssets` then stops being a cost input.

**Traps.**

- **Do not double-bill the underlay.** It is generated in the _lesson_ stage and reappears
  in the visuals stage as a project-cache hit, so a spend keyed on `cached === false` counts
  it exactly once — verify that on a keyed run rather than assuming it.
- **A cached stage must not re-report a spend it did not make this run.** That is the whole
  content of the phantom-cost bug 3.5 closed; the same trap is one line away here.
- **Fixing the author must not turn a supplied lesson into a heuristic one.** `supplied` and
  `none` are authors too, and `costProviders` overrides `providers.planner` for `supplied`
  (`cast.ts:1154`). The CLI prints this on the `providers` line, so a regression here is
  visible in the summary of every run.
- **The creditless path is the one that is wrong, so the bug is free to reproduce**
  (`projects/qc53-doc`); the keyed path — "anthropic really did write it" — stays untested
  until there is credit, and the commit should say so rather than implying both were
  exercised.

# Phase 6 — what is left of topic coverage (6.3, and only 6.3)

## 6.3 Circuits, chemistry, geography — by demand, not speculatively

**The bar (plan):** circuits first; chemistry (SMILES via a pure-JS renderer) and
geography (topojson + d3-geo) each get a one-page lane doc before any code, and only start
when a real lesson wants them. The demand signal is 6.1's `problems[]` frequency.

**Where the code is, and one correction to the plan.** The plan says circuits are
"closest: curated `symbols/circuit/*` already exist". **They do not.** `assets/library/`
holds exactly two symbols, `symbols/physics/force-vector` and `symbols/physics/mass`
(`assets/library/library.json`), plus four figures and one character rig. Circuits may
still be the right lane to build first — `@dagrejs/dagre` is already a dependency, so
wiring a netlist is graph layout that exists — but the symbol set is work, not inventory.
The library's `match` alias arrays in `library.json` are how a symbol gets found.

**Traps.**

- **6.1 is the demand signal, so read it before choosing.** The whole point of shipping
  the guard first is that the next lane is chosen from findings rather than from taste.
  Two films asking for circuits beats one engineer's intuition about chemistry.
- **A lane doc before code, for chemistry and geography.** That is the plan's rule and it
  exists because both lanes are a dependency choice as much as a feature.
- **Deleting the `UNSERVED` entry is part of shipping the lane**, not a follow-up. It is
  also not left to memory: `auditcheck` fails once the library named in a lane's
  `renderer` field appears in any `package.json`, which is exactly how `code` came out
  when 6.2 installed `shiki`. Expect that failure and treat it as the reminder it is.
- **6.2 is the worked example for a new lane** and is worth reading before starting one:
  `visuals/src/code.ts` (the lane), `render/src/compile.ts`'s `codePrims` (ten lines,
  because the geometry is read from the sidecar rather than recomputed),
  `core/src/codegrid.ts` (the one measurement both stages share), and the `code` cases in
  `visuals/src/resolve.ts` and `planner/src/compile.ts`. The shape it followed is
  `equation.ts`'s contract, stated in that file's header.

## Phase 7 — scale and cost

## 7.1 Partial re-encode (the big one)

**The bar (plan):** a per-scene segment cache keyed on (scene's plan slice + hash of
accumulated prior board state), so a tail edit re-encodes the tail — the honest mapping
under accumulate — and a wipe-mode edit re-encodes one scene. Keep `seg-*.mp4` on failure;
skip complete segments on retry. _Done when_ a last-beat narration edit re-encodes only
the final segment and the output is **byte-identical** to a full re-render.

**What you need to know before starting, and it is not in the plan.** **Segments today are
worker slices, not scenes.** `planSegments(frames, workers, posterFrame)` at
`render/src/render.ts:95` divides the whole frame range into `min(workers, ceil(frames/24))`
equal spans; the scene boundaries are nowhere in it. So the first piece of 7.1 is
re-cutting segments on scene boundaries (or on a boundary set that is a superset of them)
while keeping the parallelism that makes a render take one minute instead of four —
those two goals pull against each other on a film with eight uneven scenes, and that
trade is the actual design work of this item.

The rest of the machinery is in place: `openSegmentEncoder`, `writeConcatList` and
`concatAndMux` in `render/src/ffmpeg.ts`, the segment loop at `render.ts:237`, and
`keepSegments` (`types.ts:253`) already exists as a debugging flag — the plan wants that
behaviour on failure, which is `render.ts:276`, where `segDir` is currently removed
unconditionally unless the flag is set.

**Traps.**

- **Byte-identical is the test, and it is only reachable because A-5 holds** (frame =
  f(inputs, frame_index), pinned in `auditcheck`). Anything that breaks determinism breaks
  this item's done-bar, not just its performance.
- **Under `accumulate` a scene's pixels depend on every scene before it**, which is why
  the key includes the prior board state and not just the scene. Under `wipe` it does not.
  Getting this backwards produces a cache that is correct in testing and wrong on the
  first real edit.
- **Encoder settings are part of the key** (crf, preset, threads, fps, frame size). A
  segment encoded by a differently-configured worker will concat without complaint and
  will not be byte-identical.
- **7.2 left two instruments pointed at exactly this item.** `--emit-plan` writes the
  compiled timeline without rendering anything, and `planhash --timing` turns a schedule
  into a diff — between them, "which scenes does this edit actually move?" is answerable
  before a single frame is encoded, which is the question the segment key exists to answer.
  Note the caution in `emitplan.ts`: the file is written for reading and nothing reads it
  back, so a segment cache must key off the plan it compiled, never off `plan.json`.

## 7.3 Style packs go declarative

**The bar (plan):** implement `docs/STYLES.md`'s StylePack loader (the shape is at
STYLES.md §2, line 45; the ordering note at line 177). A new style becomes a JSON file in
`styles/`, consumed by the single core table from 2.2. The four shipped personalities
become the first four packs and the type-unions collapse to the loader's output. _Done
when_ adding a fifth style touches zero TypeScript.

**Where the code is.** The colour table is already one table —
`packages/core/src/palette.ts`, whose header says in so many words that per-ink-style
colour packs (chalk on dark slate) are this item's decision and not a second table there.
Per-style _personality_ (stroke, roughness, face) lives in `visuals/src/style.ts`; the
renderer keeps pen personality in `render/palette.ts` and re-exports the colours. The
union to collapse is `z.enum(['marker', 'pencil', 'chalk', 'ink'])` at
`core/src/storyboard.ts:688`.

**Trap, and it is a sequencing one — now satisfied, but read it before you rely on that.**
A dark-surface pack is where every raster's opaque white ground becomes visible: the S5.6
real-alpha work the audit deferred. The plan sequences 7.3 after 6.4 for that reason, and
**6.4 has landed**, so this item is unblocked.

What 6.4 actually bought you here is narrower than "solved", and the difference matters on
a dark board. `groundWhiteness` (`visuals/src/png.ts`) will tell you a figure's ground is
white, and `figureGround` rejects one that is not — so a dark pack can _detect_ the card.
It cannot remove it: every raster in every cache is still opaque white behind the subject,
and against a slate board that is a white rectangle, not a subtle one. Real alpha — asking
for it, or keying it out on the way in — is still unwritten, and the honest reading is that
a dark pack needs it rather than that 6.4 supplied it. The gate's threshold (0.9) was set
against 42 rasters that are all ≥0.954, so it has never been exercised on a real
non-white ground either.

## Phase 8 — the exit

## 8.1 Re-run the audit

**The bar (plan):** same spec, same seven-pass method, against the tree with Phases 1–7
landed. **Exit: every check PASS or named waiver** (W1–W7 in `AUDIT-FINDINGS.md` §5, plus
any new waiver argued in writing). A new PARTIAL is a Phase-9 backlog item with an owner,
not a silent regression.

**What the re-audit must be handed so it does not re-litigate settled decisions:** the
seven corpus-derived constants listed above (they are recalibrations, argued in their own
comments, not regressions); the deliberate deviations listed in
`HANDOFF-AUDIT-CLOSE.md`'s "Deliberate deviations" section; 6.1's warn-not-suppress
decision; 6.4's two measured departures from its own bar (aspect scored absolutely rather
than against the request, and cached rasters gated rather than trusted); 6.5's one (style
stays out of the figure key until a style pack can change a pixel, which is 7.3, and it
keys itself through the model then); and 5.1(b)'s
written deferral of retrieval (`docs/PLAN-RETRIEVAL.md`, waiver W7).
`npx tsx packages/pipeline/src/auditcheck.mts` re-derives the mechanical subset in
under a second and should be run first — 92 checks as of 7.2, and each one is a fact some
pass of the original audit established.

## 8.2 The bake-off

**The bar (plan):** render "quantum computing" and "how day and night happen in your town"
through the **keyed** pipeline at the explainer preset; score our two films and Golpo's
two reference files with the same instruments; publish the scorecard in `docs/STATUS.md`.
_Done when_ ours hit G1–G5 and the scorecard shows Golpo's files failing the defects the
audit measured them shipping. **Watch both of ours end to end first** — no number replaces
that, per this repo's own law.

**The reference files are still on disk**, both dated 2026-08-22:
`~/Downloads/Quantum Computing_720p.mp4` (15.6 MB) and
`~/Downloads/How does day and night happen in your town_720p.mp4` (3.0 MB).

**The instruments, and the one that does not exist yet.** `inkstat.mts` (ink pixels,
reads a finished mp4 — the one instrument that already works on somebody else's film),
`fillcheck.mts` (bbox fill, ours only), `synccheck.mts` and `tandemcheck.mts` (ours only,
and unscoreable on theirs — which is G5's point), and the OCR diff at
`render/src/tier2.ts:286`. **`ocrDiff` compares read-back text against _the IR's_ text**,
so it cannot be pointed at a film we did not compile. Scoring G2 on Golpo's two files
therefore needs a small harness that extracts frames from an arbitrary mp4 and runs the
vision pass over them with the questions from `pipeline/src/frame-vision.ts` — budget for
it, because the plan's "score both with the same tools" quietly assumes it exists.

**And it needs credit.** ~$3 of renders plus the vision passes, on a key that currently
returns 402.

---

## If you are picking this up cold

Read in this order: `docs/PLAN-AUDIT-CLOSE.md` (the authority — its progress block is
current through 7.2, and the coverage table plus 8.1 are the exit), then
`docs/HANDOFF-AUDIT-CLOSE.md` (what landed, the argued deviations, and the traps earned
per phase — its trap list is worth reading even for items it does not cover), then this
file for the item you are about to start. `docs/AUDIT-FINDINGS.md` is the evidence base
behind all three, and `docs/PLAN-RETRIEVAL.md` is item 5.1(b)'s written deferral.

Keep the plan's progress block and `HANDOFF-AUDIT-CLOSE.md` current as items land, and
**delete each item's section from this file when it does** — a remainder file that still
lists finished work is how a handoff stops being trusted. That applies to item 0 and to the
gating findings as much as to the numbered items: a finding that has been fixed comes out of
the list, and the ordered plan above gets re-cut rather than annotated.
