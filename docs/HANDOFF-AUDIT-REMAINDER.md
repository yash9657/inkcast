# Handoff — the remaining items of PLAN-AUDIT-CLOSE

Written 2026-08-24, branch `visuals-morph-density`, immediately after item 6.1 landed;
updated the same day when 6.2 (the code lane, committed with 6.1 as `dcd0394`) and then
6.4 (the raster trust gate, `e9487e7`) landed and their sections were deleted from this
file.
**Forward-looking only.** Its sibling `docs/HANDOFF-AUDIT-CLOSE.md` records
what has already landed and why, and stays the authority on that; this file is the one to
open when the question is "what do I do next, and where do I start it". The plan itself —
`docs/PLAN-AUDIT-CLOSE.md` — remains the authority on scope, done-bars and the coverage
table; every item below quotes its bar rather than restating it, and where this file
disagrees with the plan it says so out loud.

## Where execution stands, in one paragraph

Phases 0–5 are landed and tested, and so are 6.1 (the honest guard for the three remaining
unserved topic classes), 6.2 (the code lane — the fourth class is served now) and 6.4 (the
raster trust gate). The tree is committed through 6.4. At that point: **1121 tests green** (3
pre-existing keyvault skips), **auditcheck 82/82**, lint and typecheck clean, and three
shipped lessons casting strict-clean end to end (`hash-map` is the newest, and the corpus's
only board with a listing on it). Seven items remain — 6.3, 6.5, 7.1, 7.2, 7.3, 8.1, 8.2 —
and none of 6.3–7.3 blocks another, so they can be reordered freely by whoever picks them
up. Phase 8 needs all of them plus a funded API key.

**Which to pick, if nobody has said.** 6.3's own rule is that the next lane is chosen from
6.1's findings rather than from taste, and **there are still no findings** — the guard has
fired on nothing in the corpus, so no lane has earned itself. That makes 6.3 the wrong item
to start cold. **6.5 is the natural next one**: it is the smallest in the phase, and it is
in the file 6.4 just worked in (`illustrationKey` and the new trust gate are both in
`visuals/src/image.ts`). 7.3 is also unblocked now — its dark-surface pack was sequenced
after 6.4 deliberately, and 6.4 has landed. The four gating findings
below are unowned and each is an hour or two; items 3 and 4 both make cost reports wrong on
runs that are now the common case.

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
evidence projects follow the `qc<phase>-<lesson>` convention (`projects/qc64-hashmap`,
`qc64-longitude` and `qc64-gd` are the newest — the whole shipped corpus at 6.4). Two more
instruments worth knowing, both used to prove 6.2's and 6.4's done-bars and both cheap:
`npx tsx packages/visuals/src/geomhash.mts <project>` hashes every element's
resolved geometry (one line each, ideal across a `git stash`), and
`npx tsx packages/render/src/frames.mts <projectDir> <outDir> [t...]` grabs single frames
without an encode — run it twice into two directories and `cmp` them for a real
determinism check.

**If you touch the illustration lane, measure against the cache before choosing a number.**
6.4's three thresholds were each set by tracing all 42 rasters in
`~/.inkcast/cache/illustrations` and then _opening them_ — the numbers are in the constants'
own comments in `visuals/src/image.ts`. That cache is the only corpus of real provider
output this repo has, it costs nothing to read, and a threshold argued without it is a
threshold nobody can defend at the re-audit.

## Four things that gate the work

1. **There is no API credit.** Both providers answer `402 Payment Required`, which is why
   `qc.json` records `frame-vision: skip` on every recent cast. Two consequences: **8.2
   cannot run at all**, and Tier 2's vision pass has still never been exercised against a
   live model — every one of its code paths is tested with a stub. The first session with
   credit should spend one keyed cast reading `qc.json`'s `frame-vision` findings against
   the frames by eye, because that false-positive count is what decides whether the check
   is promoted from advisory to blocking (plan 3.3).
2. **`DELIVERED_WPS = 2.2` fits one shipped film and not the other** — longitude delivers
   2.23 w/s, gradient-descent 2.50 (+14%). Every run says so through the
   `pace-calibration` advisory. Nothing has been changed because a new number moves
   `adaptLesson`'s trimming and therefore the four pinned hashes. Somebody has to choose
   between a re-measured constant, a per-cadence rate (the two films differ in how many
   beats are `punchy`) and accepting the spread, and argue it in `presets.ts` beside the
   constant. **The re-audit will read that advisory**, so it is an 8.1 conversation at the
   latest.
3. **`deriveLesson` lies about who wrote the lesson.** On a run whose key has no credit
   the CLI reports `providers lesson anthropic` and a ~$0.04 lesson cost while the
   heuristic author actually wrote it (`projects/qc53-doc`). `resolveLessonAdapter`
   answers "which adapter _would_ run" and `teachLesson` falls back inside the stage, so
   `design.author` never learns. Same shape as the phantom-cost bug 3.5's `lessonAuthored`
   flag closed for a cached lesson, and the same fix: the stage reports the author it
   turned out to be. Small, unowned, and it makes every cost report on a degraded run
   wrong — which is now the common case.
4. **The image cost line is billed from intent, not from what happened.** `generatedAssets`
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

# Phase 6 — the rest of topic coverage and asset trust

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

## 6.5 The figure cache key tells the truth

**The bar (plan):** `illustrationKey` folds in the figure model id (and style, for
`kind:'figure'` only), preserving the existing `form` cache. _Done when_ switching
`INKCAST_FIGURE_MODEL` misses the figure cache and says why.

**Where the code is.** `illustrationKey` at `visuals/src/image.ts:460`, hashing
`illustration/v2` with kind, prompt and shape. **Read its header before touching it** —
it already documents why a square request contributes nothing to the hash (every raster in
every machine cache was generated when both providers were hard-coded square, so the token
has to stay absent or a few dollars of images invalidate for bytes that would be
identical). The same reasoning is why the model id goes in for `figure` only: a `form`
raster is binarised and re-traced, so the model that drew it does not survive into the
board, and invalidating those would be paying twice for the same ink.

**One thing 6.4 changed under this item.** Every cache hit is now run past the trust gate
before it is served (`judge()` in `illustrationRaster`), so an invalidation no longer just
costs a generation — a key change that starts missing on rasters the gate would have
rejected anyway is doing you a favour, and the `qc.json` note will say which ones. Worth
casting `hash-map` before and after so the delta is a diff and not a surprise.

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
`concatAndMux` in `render/src/ffmpeg.ts`, the segment loop at `render.ts:236`, and
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

## 7.2 The plan becomes inspectable on demand

**The bar (plan):** `--emit-plan` writes `plan.json`; `planhash.mts` gains a `--timing`
mode so a timing regression is a diff. _Done when_ both exist and a `hold` change shows up
in `--timing` and not in default mode.

**Where the code is.** `--emit-plan` does not exist anywhere yet (grep is clean).
`planhash.mts` is `packages/render/src/planhash.mts`, and **its header already states the
constraint**: timing is deliberately excluded from the hash, because `enter.at` is
rewritten by the voice stage on every re-narration and a tool that reported a diff for
that would cry wolf on every run. So `--timing` is an opt-in second mode, never a change
to the default — which is also exactly what the done-bar's two halves are testing.

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
`core/src/storyboard.ts:645`.

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
than against the request, and cached rasters gated rather than trusted); and 5.1(b)'s
written deferral of retrieval (`docs/PLAN-RETRIEVAL.md`, waiver W7).
`npx tsx packages/pipeline/src/auditcheck.mts` re-derives the mechanical subset in
under a second and should be run first — 82 checks as of 6.4, and each one is a fact some
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
current through 6.4, and the coverage table plus 8.1 are the exit), then
`docs/HANDOFF-AUDIT-CLOSE.md` (what landed, the argued deviations, and the traps earned
per phase — its trap list is worth reading even for items it does not cover), then this
file for the item you are about to start. `docs/AUDIT-FINDINGS.md` is the evidence base
behind all three, and `docs/PLAN-RETRIEVAL.md` is item 5.1(b)'s written deferral.

Keep the plan's progress block and `HANDOFF-AUDIT-CLOSE.md` current as items land, and
**delete each item's section from this file when it does** — a remainder file that still
lists finished work is how a handoff stops being trusted.
