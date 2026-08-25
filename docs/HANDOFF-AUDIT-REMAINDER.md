# Handoff — the remaining items of PLAN-AUDIT-CLOSE

**Forward-looking only.** This is the file to open when the question is "what do I do next,
and where do I start it". Its sibling `docs/HANDOFF-AUDIT-CLOSE.md` records what has already
landed and why, and stays the authority on that. The plan itself — `docs/PLAN-AUDIT-CLOSE.md`
— remains the authority on scope, done-bars and the coverage table; every item below quotes
its bar rather than restating it, and where this file disagrees with the plan it says so out
loud.

Written 2026-08-24 on branch `visuals-morph-density`, just after 6.1 landed, and rewritten
the same day as each of 6.2, 6.4, 6.5, 7.2, the three gating findings (2, 3 and 4) and 7.1
landed and their sections came out. **A section is deleted from this file the moment its
work lands** — see the closing note; what a landed item bought is in
`HANDOFF-AUDIT-CLOSE.md`, not here.

## Where execution stands, in one paragraph

Phases 0–5 are landed and tested. So are 6.1 (the honest guard for the unserved topic
classes), 6.2 (the code lane), 6.4 (the raster trust gate), 6.5 (the figure cache key names
the model that drew it), 7.2 (the plan is inspectable on demand), 7.1 (the partial
re-encode) and the three findings this file used to carry: a run now reports the lesson
author it really used and the images it really paid for, and the length estimate counts
spoken letters rather than words. **The audit's table has no `FAIL` left in it** — 7.1 was
the last one (S10-b) and every open item is a PARTIAL. At that point: **1151 tests green**
(3 pre-existing keyvault skips, 1154 total), **auditcheck 97/97**, lint and typecheck clean,
and all three shipped lessons casting strict-clean end to end at `standard`. Four items
remain — **7.3, 6.3, 8.1, 8.2** — and neither 7.3 nor 6.3 blocks the other, so they can be
reordered freely. Phase 8 needs both of them plus a funded API key.

## The order to knock these out

**1. 7.3 — style packs go declarative.** Unblocked but not free: read its section before
believing 6.4 unblocked it. The honest reading is that a dark pack needs the real-alpha work
S5.6 deferred, so budget for that or scope the pack to light surfaces and say which in
writing — either is defensible, silence is not. Whoever takes this is also closest to the
second gating item below.

**2. 6.3 — circuits, chemistry, geography.** Second on purpose, and it may not be code at
all. Its own rule is that the next lane is chosen from 6.1's findings, and the guard has
still fired on nothing, so the honest output of this item today is a **written decision plus
the two lane docs**, not a lane. Do it once the corpus has had a few more films through it —
which 7.3 will produce.

**3. 8.1, then 8.2.** 8.1 needs 7.3 and 6.3 landed or waived in writing, and re-reads
everything below. 8.2 additionally needs ~$3 of credit and a small harness that does not
exist yet (see its section). Neither is startable today.

## How to verify anything you land

```
pnpm -r typecheck && pnpm -r test && pnpm lint
npx tsx packages/pipeline/src/auditcheck.mts
node --import tsx apps/cli/src/index.ts --lesson examples/lessons/longitude.lesson.json --project <scratch-id>
```

The last line is the strict end-to-end proof (strict is the default; no key needed — a
voice-provider fallback in the output is a provider event, not a gate failure). The three
shipped lessons are `examples/lessons/*.lesson.json`; **cast `hash-map` too when you touch
the compiler**, because it is the only board in the corpus with a listing on it.

**Disposable evidence projects follow the `qc<phase>-<lesson>` convention.** The ones worth
knowing: `qc0-doc` and `qc0-hashmap` (what an honest cost report looks like — see the note
below), `qcf2-gd` / `qcf2-longitude` / `qcf2-hashmap-short` (the pace calibration measured
across the corpus), and `qc71-longitude` (the segment cache, 32 segments on disk).

**A cost report is evidence again.** Since the cost-honesty findings landed,
`pipeline.json`'s `cost.lines` are built only from calls a stage reported making, so an
unexpected line is a bug rather than noise. A run that drew nothing prints nothing.

**The render is incremental now, which changes how you read a timing.** `<dir>/frames` is a
segment cache, not scratch (7.1). A `render 1.4s` line means every segment was reused; a
full encode of a 2:14 film is ~57s. If you are timing a change, look at the
`reused N of M segments` line at `INKCAST_LOG=info` rather than at the wall clock, and
remember that anything touching `plan.style`, `fontFamily`, the palette or the frame size is
in **every** segment's key and so re-encodes the whole film. That is correct, not a bug.

Four more instruments, all cheap:

- `npx tsx packages/visuals/src/geomhash.mts <project>` hashes every element's resolved
  geometry, one line each — ideal across a `git stash`.
- `npx tsx packages/render/src/frames.mts <projectDir> <outDir> [t...]` grabs single frames
  with no encode. Run it twice into two directories and `cmp` for a real determinism check.
- `--emit-plan` on any cast or rerender writes `<project>/plan.json`, the compiled timeline
  (written for reading; nothing reads it back).
- `npx tsx packages/render/src/planhash.mts --timing <project>` turns a _schedule_ change
  into a diff the way the default mode does for geometry.

**If you touch the illustration lane, measure against the cache before choosing a number.**
6.4's three thresholds were each set by tracing all 42 rasters in
`~/.inkcast/cache/illustrations` and then _opening them_ — the numbers are in the constants'
own comments in `visuals/src/image.ts`. 6.5 used the same corpus for a different question (8
of those 42 are colour figures, 34 are form line art), which is what decided that a built-in
model contributes nothing to a cache key. That cache is the only corpus of real provider
output this repo has, it costs nothing to read, and a threshold — or an invalidation —
argued without it is one nobody can defend at the re-audit.

**And if you touch a cache key, cast a project that already exists.** Four tiers sit between
a storyboard and a raster, and the visual manifest's freshness record is asked first: a key
that is honest at the raster tier is never reached on a re-cast. That is the half of 6.5's
done-bar the plan's wording did not have.

## Two things that gate the work

1. **There is no API credit.** Both providers answer `402 Payment Required`, which is why
   `qc.json` records `frame-vision: skip` on every recent cast. Three consequences: **8.2
   cannot run at all**; Tier 2's vision pass has still never been exercised against a live
   model, every one of its code paths being tested with a stub; and the lesson author's
   "Anthropic really did write it" direction is pinned only against a local stand-in for the
   Messages API. The first session with credit should spend one keyed cast reading
   `qc.json`'s `frame-vision` findings against the frames by eye — that false-positive count
   is what decides whether the check is promoted from advisory to blocking (plan 3.3) — and
   should re-check the keyed author path in the same run.

2. **`hash-map` cannot render at the `short` preset at all.** Its Python listing wants 25.82
   canvas units to fit the 567×117 cell the vertical preset gives it, against the 32.78
   `MIN_GLYPH_PX` floor, so a strict cast dies in the visuals stage — the message names
   `b3_v0` and says the listing could not be set. Pre-existing since the code lane landed in
   6.2 and **verified rather than assumed**: the box is byte-identical before and after the
   pacing change that surfaced it, and a cast from that change's parent commit fails with
   the same message.
   Nothing had ever tried it, because `hash-map`'s pins are _compile_ hashes and the shipped
   cast is at `standard`. Three defensible fixes and the choice is a real one — give the
   vertical preset a taller code cell, let `codeBox` reserve a cell that fits the listing it
   was handed, or shorten the lesson's listing. Whoever takes 7.3 is closest to it;
   `--degrade` renders it meanwhile (`projects/qcf2-hashmap-short`).

## Rules that apply to every item below

- **Pinned hashes moving is the change working, not breaking.** Re-pin with the diff in
  front of you and the reason in `pinned-hashes.test.ts`'s header. Never re-pin blind. A
  purely additive storyboard diff is its own coverage proof and is cheaper than frames
  (4.1's re-pin is the template); a diff that moves geometry needs frames, and the most
  recent re-pin (`hash-map`/short, for the pacing unit) is the worked example of doing that
  honestly — including verifying that the defect the render exposed was not yours.
- **New checks go in the gate stage.** `check()` in `render/src/check.ts` assembles
  `QcCheck`s; adding one is a `qcCheck(id, findings, {severity})` in that list plus, if it
  needs a number, a pure function beside the others in `boardcheck.ts` or `tier2.ts`.
  `severity: 'warn'` for a judgement, the default `fail` for a fact.
- **A stage reports what it degraded through `onProblem`**, never through a log line alone;
  the run collects it into `qc.json`. `onSpend` is the same rail for billable calls, and the
  rule there is that a cost line is built from observed quantities. `onAuthor` is the third
  of the family: a stage says what it turned out to do, not what it intended.
- **Anything added to `PipelineState` must answer "does a re-render erase this?"** Fields
  describing the _film_ (not the run) have to be inherited in `rerender()`, which rebuilds
  the file from scratch. `grounding` was silently lost this way until 6.1, and
  `lesson.author` is the newest field that had to answer it.
- **Corpus-derived constants are named recalibrations, not spec values.** `MIN_GLYPH_PX` (10
  output px), the fill floor (mean 18% / scene 11%), `MIN_INK_SHARE` (1.0%),
  `MAX_REVEALS_PER_SCENE` (9), 6.4's `MIN_TRACED_INK` (3.0), `MAX_INK_ASPECT` (4.0) and
  `MIN_GROUND_WHITE` (0.9), and the pacing pair `DELIVERED_LPS` (9.65 spoken letters a
  second) and `LETTERS_PER_WORD` (4.23) were each measured against the corpus and argued in
  the constant's own comment. Nine of them, and 8.1 must treat them all as such.
- **Do not let a gate become a re-prompt loop.** Structural failures stop and name the beat;
  the bounded repair loops live upstream where repair is cheap.
- **`--degrade` exists so a demo is never blocked while you fix the real thing.**

---

# Phase 7 — what is left of scale and cost (7.3, and only 7.3)

## 7.3 Style packs go declarative

**The bar (plan):** implement `docs/STYLES.md`'s StylePack loader (the shape is at
STYLES.md §2, line 45; the ordering note at line 177). A new style becomes a JSON file in
`styles/`, consumed by the single core table from 2.2. The four shipped personalities become
the first four packs and the type-unions collapse to the loader's output. _Done when_ adding
a fifth style touches zero TypeScript.

**Where the code is** (verified 2026-08-24). The colour table is already one table —
`packages/core/src/palette.ts`, whose header says in so many words that per-ink-style colour
packs (chalk on dark slate) are this item's decision and not a second table there
(`palette.ts:18`). Per-style _personality_ (stroke, roughness, face) lives in
`visuals/src/style.ts`; the renderer keeps pen personality in `render/src/palette.ts` and
re-exports the colours. The union to collapse is
`z.enum(['marker', 'pencil', 'chalk', 'ink'])` at `core/src/storyboard.ts:688`.

**Trap 1 — the sequencing one, now satisfied, but read this before relying on it.** A
dark-surface pack is where every raster's opaque white ground becomes visible: the S5.6
real-alpha work the audit deferred. The plan sequences 7.3 after 6.4 for that reason, and
**6.4 has landed**, so the item is unblocked.

What 6.4 actually bought here is narrower than "solved", and the difference matters on a
dark board. `groundWhiteness` (`visuals/src/png.ts`) will tell you a figure's ground is
white, and `figureGround` rejects one that is not — so a dark pack can _detect_ the card. It
cannot remove it: every raster in every cache is still opaque white behind the subject, and
against a slate board that is a white rectangle, not a subtle one. Real alpha — asking for
it, or keying it out on the way in — is still unwritten, and the honest reading is that a
dark pack needs it rather than that 6.4 supplied it. The gate's threshold (0.9) was set
against 42 rasters that are all ≥0.954, so it has never fired on a real non-white ground
either. **Budget for the alpha work, or scope the first packs to light surfaces and say so
in writing.**

**Trap 2 — 6.5 deferred a decision to this item, and it is now due.** The figure cache key
deliberately leaves style out, on the argument that style cannot change a raster's pixels
until a style pack can pick the image endpoint. The moment a pack does that, the key has to
carry it — through the model token that is already there, which is why 6.5 shaped it that
way. See the key's comment in `visuals/src/image.ts`.

**Trap 3 — a style change re-encodes every segment, and that is correct.** Since 7.1
`plan.style`, `fontFamily` and the palette are in every segment's cache key, so the first
render after a pack change is a full one. Do not "optimise" that: a style pack that did not
invalidate the segments would serve yesterday's ink.

---

# Phase 6 — what is left of topic coverage (6.3, and only 6.3)

## 6.3 Circuits, chemistry, geography — by demand, not speculatively

**The bar (plan):** circuits first; chemistry (SMILES via a pure-JS renderer) and geography
(topojson + d3-geo) each get a one-page lane doc before any code, and only start when a real
lesson wants them. The demand signal is 6.1's `problems[]` frequency.

**Where the code is, and one correction to the plan** (re-verified 2026-08-24). The plan
says circuits are "closest: curated `symbols/circuit/*` already exist". **They do not.**
`assets/library/library.json` holds exactly seven entries: two symbols
(`symbols/physics/force-vector`, `symbols/physics/mass`), four figures
(`figures/standing|walking|pointing|sitting`) and one character rig
(`characters/explorer`). Circuits may still be the right lane to build first —
`@dagrejs/dagre` is already a dependency, so wiring a netlist is graph layout that exists —
but the symbol set is work, not inventory. The library's `match` alias arrays are how a
symbol gets found.

**Traps.**

- **6.1 is the demand signal, so read it before choosing.** The whole point of shipping the
  guard first is that the next lane is chosen from findings rather than from taste. Two
  films asking for circuits beats one engineer's intuition about chemistry. As of today the
  guard has fired on nothing in the corpus, which is why this item's honest output may be a
  written decision rather than a lane.
- **A lane doc before code, for chemistry and geography.** That is the plan's rule and it
  exists because both lanes are a dependency choice as much as a feature.
- **Deleting the `UNSERVED` entry is part of shipping the lane**, not a follow-up. It is
  also not left to memory: `auditcheck` fails once the library named in a lane's `renderer`
  field appears in any `package.json`, which is exactly how `code` came out when 6.2
  installed `shiki`. Expect that failure and treat it as the reminder it is.
- **6.2 is the worked example for a new lane** and is worth reading before starting one:
  `visuals/src/code.ts` (the lane), `render/src/compile.ts`'s `codePrims` (ten lines,
  because the geometry is read from the sidecar rather than recomputed),
  `core/src/codegrid.ts` (the one measurement both stages share), and the `code` cases in
  `visuals/src/resolve.ts` and `planner/src/compile.ts`. The shape it followed is
  `equation.ts`'s contract, stated in that file's header.
- **The code lane also shipped the defect in the gating list above.** A new lane owes the
  vertical preset a thought: `short` gives a visual a 567×117 cell, and a lane that cannot
  say something legible in that box will fail strict there and nowhere else.

---

# Phase 8 — the exit

## 8.1 Re-run the audit

**The bar (plan):** same spec, same seven-pass method, against the tree with Phases 1–7
landed. **Exit: every check PASS or named waiver** (W1–W7 in `AUDIT-FINDINGS.md` §5, plus
any new waiver argued in writing). A new PARTIAL is a Phase-9 backlog item with an owner,
not a silent regression.

**What the re-audit must be handed so it does not re-litigate settled decisions:**

- the **nine corpus-derived constants** listed above — recalibrations argued in their own
  comments, not regressions;
- the deliberate deviations listed in `HANDOFF-AUDIT-CLOSE.md`'s "Deliberate deviations"
  section;
- **6.1's** warn-not-suppress decision;
- **6.4's two** measured departures from its own bar: aspect scored absolutely rather than
  against the request, and cached rasters gated rather than trusted;
- **6.5's one**: style stays out of the figure key until a style pack can change a pixel —
  which is 7.3, and it keys itself through the model then;
- **the cost findings' one**: an image is billed when the provider's bytes arrive, _before_
  the 6.4 gate judges them, because a rejected generation was paid for and never reaches the
  caller;
- **the pacing finding's one**: the length estimate counts spoken letters, not words, and
  `DELIVERED_WPS` is now derived from `DELIVERED_LPS` rather than measured. The corpus
  evidence is in the constant's comment; the refutation of the per-cadence alternative is
  that every beat in the corpus is `building_energy`, so cadence cannot explain a
  between-film spread;
- **7.1's one**: `<dir>/frames` survives a successful render, because a cache only a failed
  render populates is not a cache;
- and **5.1(b)'s** written deferral of retrieval (`docs/PLAN-RETRIEVAL.md`, waiver W7).

`npx tsx packages/pipeline/src/auditcheck.mts` re-derives the mechanical subset in under a
second and should be run first — **97 checks as of 7.1**, each one a fact some pass of the
original audit established.

**And hand it the one thing still open for want of credit:** the lesson author is observed
now, but the "Anthropic really wrote it" direction is pinned against a local stand-in for
the Messages API rather than a real model. See gating item 1.

## 8.2 The bake-off

**The bar (plan):** render "quantum computing" and "how day and night happen in your town"
through the **keyed** pipeline at the explainer preset; score our two films and Golpo's two
reference files with the same instruments; publish the scorecard in `docs/STATUS.md`. _Done
when_ ours hit G1–G5 and the scorecard shows Golpo's files failing the defects the audit
measured them shipping. **Watch both of ours end to end first** — no number replaces that,
per this repo's own law.

**The reference files are still on disk**, both dated 2026-08-22:
`~/Downloads/Quantum Computing_720p.mp4` (15.6 MB) and
`~/Downloads/How does day and night happen in your town_720p.mp4` (3.0 MB).

**The instruments, and the one that does not exist yet.** `render/src/inkstat.mts` (ink
pixels, reads a finished mp4 — the one instrument that already works on somebody else's
film), `render/src/fillcheck.mts` (bbox fill, ours only), `pipeline/src/synccheck.mts` and
`pipeline/src/tandemcheck.mts` (ours only, and unscoreable on theirs — which is G5's point),
and the OCR diff at `render/src/tier2.ts:286`. **`ocrDiff` compares read-back text against _the IR's_ text**, so
it cannot be pointed at a film we did not compile. Scoring G2 on Golpo's two files therefore
needs a small harness that extracts frames from an arbitrary mp4 and runs the vision pass
over them with the questions from `pipeline/src/frame-vision.ts` — budget for it, because
the plan's "score both with the same tools" quietly assumes it exists.

**And it needs credit.** ~$3 of renders plus the vision passes, on a key that currently
returns 402.

---

## If you are picking this up cold

Read in this order: `docs/PLAN-AUDIT-CLOSE.md` (the authority — its progress block is
current through 7.1, and the coverage table plus 8.1 are the exit), then
`docs/HANDOFF-AUDIT-CLOSE.md` (what landed, the argued deviations, and the traps earned per
phase — its trap list is worth reading even for items it does not cover), then this file for
the item you are about to start. `docs/AUDIT-FINDINGS.md` is the evidence base behind all
three, and `docs/PLAN-RETRIEVAL.md` is item 5.1(b)'s written deferral.

Keep the plan's progress block and `HANDOFF-AUDIT-CLOSE.md` current as items land, and
**delete each item's section from this file when it does** — a remainder file that still
lists finished work is how a handoff stops being trusted. That applies to the gating
findings as much as to the numbered items: a finding that has been fixed comes out of the
list, and the order above gets re-cut rather than annotated. The only trace a landed item
leaves here is the one sentence that changes what a later item should do.
