# Handoff — what is left: 8.2, and one row that needs a funded key

**Forward-looking only.** This is the file to open when the question is "what do I do next,
and where do I start it". Its sibling `docs/HANDOFF-AUDIT-CLOSE.md` records what has already
landed and why, and stays the authority on that. The plan itself — `docs/PLAN-AUDIT-CLOSE.md`
— remains the authority on scope, done-bars and the coverage table; every item below quotes
its bar rather than restating it, and where this file disagrees with the plan it says so out
loud.

Written 2026-08-24 on branch `visuals-morph-density`, just after 6.1 landed, and rewritten
the same day as each of 6.2, 6.4, 6.5, 7.2, the three gating findings (2, 3 and 4), 7.1, 7.3,
6.3 and **8.1** landed and their sections came out — then again on 2026-08-25 when **all of
Phase 9** landed and its section came out with it. **A section is deleted from this file the
moment its work lands** — see the closing note; what a landed item bought is in
`HANDOFF-AUDIT-CLOSE.md`, not here.

## Where execution stands, in one paragraph

**Phases 0 through 9 are landed and tested.** 8.1's artefact is `docs/AUDIT-REAUDIT.md`, run
at `2abd28d`, which read **58 PASS, 7 waived, 4 PARTIAL, 0 FAIL, 0 MISSING** from the
original 20/0/39/6/4 and left four rows open. Phase 9 closed all four on 2026-08-25 — see
that file's addendum and the plan's progress block — so the standing verdict is **61 PASS,
7 waived, 1 PARTIAL**. Baseline now: **1172 tests green** (3 pre-existing keyvault skips,
1175 total), **auditcheck 111/111**, lint and typecheck clean, and the shipped lessons
casting strict-clean end to end at `standard` — **21** QC checks apiece since 9.3 added
`thin-fill`, zero problems, one advisory on longitude (that check, doing its job).

**One row is left, and no session without money can close it: S9-b.** Tier 2's keyed half —
the vision pass and the OCR diff — has still never run against a live model. **What is left:
8.2, and S9-b, and both want the same funded key.**

## The order to knock these out

**1. 8.2 — the bake-off.** The only remaining plan item. Blocked twice over: it needs ~$3 of
credit on a key that currently refuses, and it needs a harness nobody has written (see its
section — the plan's "score both with the same tools" quietly assumes an instrument that does
not exist). Do not start it by writing the harness on spec; the credit is the binding
constraint and the harness is cheap once you can run the thing it feeds. **9.1 is done, so
the bake-off will no longer be scoring films whose reveals are systematically late** — which
was the reason it had to wait.

**2. S9-b, in the same keyed session.** One cast with a funded key, reading `qc.json`'s
`frame-vision` findings against the frames by eye. That false-positive count is what decides
whether the check is promoted from advisory to blocking (plan 3.3).

**Two open defects have no owner and are not in any phase**, because each is a real design
choice rather than a repair: `hash-map` cannot render at the `short` preset (gating item 2
below), and nothing in this repo measures whether a beat's picture says something its caption
does not — 8.1's closing note, and the most obvious thing wrong with the longitude film.

---

# 8.2 The bake-off

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
and the OCR diff at `render/src/tier2.ts:286`. **`ocrDiff` compares read-back text against
_the IR's_ text**, so it cannot be pointed at a film we did not compile. Scoring G2 on
Golpo's two files therefore needs a small harness that extracts frames from an arbitrary mp4
and runs the vision pass over them with the questions from `pipeline/src/frame-vision.ts` —
budget for it, because the plan's "score both with the same tools" quietly assumes it exists.

**And it needs credit.** ~$3 of renders plus the vision passes, on a key that currently
refuses.

**9.1 is done, which unblocks the half of this that was not about money.** This section used
to open with "do 9.1 first": a bake-off scored on films whose reveals are systematically late
is a bake-off measuring the wrong thing, and G5 (sync) is one of the five bars. Our films now
place every word-anchored reveal on its own word, so the only thing left in the way is the
credit and the harness.

---

# How to verify anything you land

```
pnpm -r typecheck && pnpm -r test && pnpm lint
npx tsx packages/pipeline/src/auditcheck.mts
node --import tsx apps/cli/src/index.ts --lesson examples/lessons/longitude.lesson.json --project <scratch-id>
```

The last line is the strict end-to-end proof (strict is the default; no key needed — a
voice-provider fallback in the output is a provider event, not a gate failure). The three
shipped lessons are `examples/lessons/*.lesson.json`; **cast `hash-map` too when you touch
the compiler**, because it is the only board in the corpus with a listing on it.

**Cast the same project twice, and compare the two runs.** This is where 8.1's real finding
came from: a second cast of an unchanged lesson should be a no-op, and it was not. Since 9.1
it is — the second cast prints `render 100% cached` — so this is now a _regression check_
rather than a reproduction, and it is the cheapest one in the repo. Keep running it.

**Disposable evidence projects follow the `qc<phase>-<lesson>` convention.** The ones worth
knowing: `qc0-doc` and `qc0-hashmap` (what an honest cost report looks like), `qcf2-gd` /
`qcf2-longitude` / `qcf2-hashmap-short` (the pace calibration measured across the corpus),
`qc71-longitude` (the segment cache, 32 segments on disk), `qc73-longitude` (the strict cast
that proved 7.3 changed no pixel — its `geomhash` is line-for-line `qc71-longitude`'s),
`qc81-longitude` / `qc81-gd` / `qc81-hashmap` (8.1's three strict casts; **the first is the
preserved reproduction of 9.1 and should not be re-cast** — its scene 0 still carries the
13.595s clip under a 16.125s sidecar that the fix repairs, and `qc91-heal` is the copy that
proves it does), `qc91-longitude` (9.1's proof: cast twice, `render 100% cached`),
`qc92-chalk` (9.2's proof: three keyed figures on a slate board, `--degrade` because the
cardiac lesson has its own ink-on-ink and overrun problems) and `qc61-aspirin` (the only film
in the corpus that asks for an unserved lane, and the one whose frames rank chemistry first —
a beat asking for a hydroxyl group put **B₄H₂** on the board).

**A cost report is evidence.** Since the cost-honesty findings landed, `pipeline.json`'s
`cost.lines` are built only from calls a stage reported making, so an unexpected line is a
bug rather than noise. A run that drew nothing prints nothing.

**The render is incremental, which changes how you read a timing.** `<dir>/frames` is a
segment cache, not scratch (7.1). A `render 1.4s` line means every segment was reused; a full
encode of a 2:14 film is ~57s. If you are timing a change, look at the `reused N of M
segments` line at `INKCAST_LOG=info` rather than at the wall clock, and remember that
anything touching `plan.style`, `fontFamily`, the palette or the frame size is in **every**
segment's key and so re-encodes the whole film. That is correct, not a bug — and since 7.3 it
includes **editing a file in `styles/`**, because a pack's digest is part of every key the
style's name used to carry (`styleKey()`). A changed narration length used to do it too, on
a lesson nobody had edited, and that was N-2; since 9.1 it does not.

Five instruments, all cheap:

- `npx tsx packages/visuals/src/geomhash.mts <project>` hashes every element's resolved
  geometry, one line each — ideal across a `git stash`.
- `npx tsx packages/render/src/frames.mts <projectDir> <outDir> [t...]` grabs single frames
  with no encode. Run it twice into two directories and `cmp` for a real determinism check;
  run it either side of a `git stash` for a real equivalence check, which is how 7.3 proved
  it had changed no pixel — and how 8.1 re-proved A-5.
- `--emit-plan` on any cast or rerender writes `<project>/plan.json`, the compiled timeline
  (written for reading; nothing reads it back).
- `npx tsx packages/render/src/planhash.mts --timing <project>` turns a _schedule_ change
  into a diff the way the default mode does for geometry.
- `npx tsx packages/pipeline/src/lanedemand.mts` runs 6.1's guard over every lesson on disk
  and counts, per unserved lane, how many films asked — fixtures in a column of their own. It
  is what 6.3's "build lanes in the order lessons ask for them" is measured with, and what
  voids waiver W8 when the `demand` column reaches two. Re-run at 8.1: **57 lessons, 13
  topics, demand 0 / 0 / 0.**

**If you touch the illustration lane, measure against the cache before choosing a number.**
6.4's three thresholds were each set by tracing all 42 rasters in
`~/.inkcast/cache/illustrations` and then _opening them_ — the numbers are in the constants'
own comments in `visuals/src/image.ts`. 6.5 used the same corpus for a different question (8
of those 42 are colour figures, 34 are form line art), which is what decided that a built-in
model contributes nothing to a cache key. That cache is the only corpus of real provider
output this repo has, it costs nothing to read, and a threshold — or an invalidation —
argued without it is one nobody can defend at the next audit.

**And if you touch a cache key, cast a project that already exists.** Four tiers sit between
a storyboard and a raster, and the visual manifest's freshness record is asked first: a key
that is honest at the raster tier is never reached on a re-cast. That is the half of 6.5's
done-bar the plan's wording did not have — and 8.1's N-2 is the same lesson learned again one
layer down, in the voice stage's own freshness record.

# Two things that gate the work

1. **There is no API credit.** Anthropic answers `400 … credit balance is too low` and
   ElevenLabs `402 Payment Required`, which is why `qc.json` records `frame-vision: skip` on
   every recent cast and why every film on disk is narrated by the local fallback. Three
   consequences: **8.2 cannot run at all**; Tier 2's vision pass has still never been
   exercised against a live model, every one of its code paths being tested with a stub (this
   is S9-b, the row 8.1 could not close); and the lesson author's "Anthropic really did write
   it" direction is pinned only against a local stand-in for the Messages API. The first
   session with credit should spend one keyed cast reading `qc.json`'s `frame-vision`
   findings against the frames by eye — that false-positive count is what decides whether the
   check is promoted from advisory to blocking (plan 3.3) — and should re-check the keyed
   author path in the same run.

2. **`hash-map` cannot render at the `short` preset at all.** Its Python listing wants 25.82
   canvas units to fit the 567×117 cell the vertical preset gives it, against the 32.78
   `MIN_GLYPH_PX` floor, so a strict cast dies in the visuals stage — the message names
   `b3_v0` and says the listing could not be set. Pre-existing since the code lane landed in
   6.2 and **verified rather than assumed**: the box is byte-identical before and after the
   pacing change that surfaced it, and a cast from that change's parent commit fails with the
   same message. Nothing had ever tried it, because `hash-map`'s pins are _compile_ hashes and
   the shipped cast is at `standard`. Three defensible fixes and the choice is a real one —
   give the vertical preset a taller code cell, let `codeBox` reserve a cell that fits the
   listing it was handed, or shorten the lesson's listing. Unowned; `--degrade` renders it
   meanwhile (`projects/qcf2-hashmap-short`).

# Rules that still apply

- **Pinned hashes moving is the change working, not breaking.** Re-pin with the diff in front
  of you and the reason in `pinned-hashes.test.ts`'s header. Never re-pin blind. A purely
  additive storyboard diff is its own coverage proof and is cheaper than frames (4.1's re-pin
  is the template); a diff that moves geometry needs frames, and the `hash-map`/short re-pin
  is the worked example of doing that honestly — including verifying that the defect the
  render exposed was not yours.
- **New checks go in the gate stage.** `check()` in `render/src/check.ts` assembles
  `QcCheck`s; adding one is a `qcCheck(id, findings, {severity})` in that list plus, if it
  needs a number, a pure function beside the others in `boardcheck.ts` or `tier2.ts`.
  `severity: 'warn'` for a judgement, the default `fail` for a fact.
- **A stage reports what it degraded through `onProblem`**, never through a log line alone;
  the run collects it into `qc.json`. `onSpend` is the same rail for billable calls, and the
  rule there is that a cost line is built from observed quantities. `onAuthor` is the third of
  the family: a stage says what it turned out to do, not what it intended. **Two sites still
  break this rule and 8.1 found them both**; 9.3 fixed both, and the lesson is the rule.
- **A number written into a handoff is not evidence.** 8.1's smallest find: this file said the
  audit's table had "61 rows, 17 PASS, 34 PARTIAL". It has 69 rows, 20 PASS, 39 PARTIAL —
  eight rows that a worklist built from that sentence would have skipped. Cite the artefact,
  or re-count it.
- **Anything added to `PipelineState` must answer "does a re-render erase this?"** Fields
  describing the _film_ (not the run) have to be inherited in `rerender()`, which rebuilds the
  file from scratch. `grounding` was silently lost this way until 6.1, and `lesson.author` is
  the newest field that had to answer it.
- **Corpus-derived constants are named recalibrations, not spec values.** `MIN_GLYPH_PX` (10
  output px), the fill floor (mean 18% / scene 8% — the scene half re-measured 2026-08-25,
  see `MIN_SCENE_FILL` in `render/src/compile.ts`), `MIN_INK_SHARE` (1.0%),
  `MAX_REVEALS_PER_SCENE` (9), 6.4's `MIN_TRACED_INK` (3.0), `MAX_INK_ASPECT` (4.0) and
  `MIN_GROUND_WHITE` (0.9), and the pacing pair `DELIVERED_LPS` (9.65 spoken letters a second)
  and `LETTERS_PER_WORD` (4.23) were each measured against the corpus and argued in the
  constant's own comment. Nine of them, and 8.1 treated them all as such. 7.3's
  `MIN_PAPER_LUMA` (0.5) is deliberately **not** among them: its own comment says it is a
  rail rather than a measurement, and since 9.2 it routes the two figure composites rather
  than refusing a dark board. 9.2 did add two that _are_ corpus-derived, from a sweep of all
  42 cached rasters: `GROUND_FLOOR` (0.06) and `CHROMA_FLOOR` (64), the second placed in an
  empty band between 31 line-art files topping out at 46 and 11 colour files starting at 183.
  `MIN_INK_CONTRAST` (4.5:1) is a third rail, not a measurement — it is the WCAG AA bar.
- **A style is a JSON file, and five packages read it rather than keeping a table** (7.3). If
  you find yourself writing `if (style === ...)` anywhere, the field belongs in `styles/*.json`
  and its schema in `core/src/stylepack.ts`. `styles/README.md` is what a pack author reads.
- **A tripwire nobody can trip is worse than none** (6.3). Three lanes each named the library
  whose installation would force its `UNSERVED` row out, `auditcheck` grepped the manifests
  for it, and not one of the three names could ever have matched. If you add a guard of that
  shape, test it against the case it is actually for — not the easiest one.
- **Do not let a gate become a re-prompt loop.** Structural failures stop and name the beat;
  the bounded repair loops live upstream where repair is cheap.
- **`--degrade` exists so a demo is never blocked while you fix the real thing.**

---

## If you are picking this up cold

Read in this order: `docs/PLAN-AUDIT-CLOSE.md` (the authority — its progress block is current
through Phase 9, and 8.2 is what is left), then `docs/AUDIT-REAUDIT.md` (the verdict on every
check, its 2026-08-25 addendum, and the three findings Phase 9 was made of), then
`docs/HANDOFF-AUDIT-CLOSE.md` (what landed, the argued deviations, and the traps earned per
phase — its trap list is worth reading even for items it does not cover), then this file.
`docs/AUDIT-FINDINGS.md` is the 2026-08-22 evidence base behind all of them and stays the
authority on the waivers in its §5; `docs/PLAN-RETRIEVAL.md` is 5.1(b)'s written deferral, and
`docs/LANE-{CHEMISTRY,CIRCUITS,GEOGRAPHY}.md` are 6.3's.

Keep the plan's progress block and `HANDOFF-AUDIT-CLOSE.md` current as items land, and
**delete each item's section from this file when it does** — a remainder file that still
lists finished work is how a handoff stops being trusted. When 8.2 is in,
this file has nothing left to say and should be deleted rather than left as a monument; what
the audit close bought will live in `HANDOFF-AUDIT-CLOSE.md`, in `docs/AUDIT-REAUDIT.md`, and
in `docs/STATUS.md`'s scorecard.
