# Re-audit — plan item 8.1

> **Addendum, 2026-08-25 — Phase 9 landed, and all four of the rows below closed.**
> This file stays as written: it is the 2026-08-24 reading, and a report edited to agree
> with what happened next is not evidence of anything. What changed since:
>
> | Row      | Then     | Now      | Closed by                                               |
> | -------- | -------- | -------- | ------------------------------------------------------- |
> | **S5.6** | PARTIAL  | **PASS** | 9.2 — `keyFigureToSurface`; `chalk` is a slate board    |
> | **X-d**  | PARTIAL  | **PASS** | 9.3 — both diagnostics on `onProblem`; 21 checks        |
> | **X-g**  | PARTIAL  | **PASS** | 9.1 — N-1 and N-2; a re-cast is `render 100% cached`    |
> | **X-f**  | PASS·gap | **PASS** | 9.4 — the studio asks `/api/providers` for the packs    |
> | **S9-b** | PARTIAL  | PARTIAL  | still blocked on credit — unchanged, and not repairable |
>
> So **61 PASS, 7 waived, 1 PARTIAL, 0 FAIL, 0 MISSING**. The exit bar — "every check PASS
> or named waiver" — is met for everything a session without a funded API key can reach, and
> S9-b is the single row left. N-1, N-2 and N-3 are all fixed; the numbers below are the
> before, and `PLAN-AUDIT-CLOSE.md`'s 2026-08-25 progress block is the after.
>
> One thing in this file was **not** in scope and is still true: the closing note on the
> longitude board holding a caption and the same sentence again in smaller type. Nothing
> measures whether a beat's picture says something its caption does not.

Run 2026-08-24 at `2abd28d` (branch `visuals-morph-density`, clean tree), against the same
"Explainer Video Pipeline — Architecture Audit Spec" and the same seven-pass method as
`docs/AUDIT-FINDINGS.md` (2026-08-22, `5f83bc4`). That file stays the evidence base and the
authority on the original verdicts and on the waivers in its §5; this file is the second
reading, and where the two differ this one is current.

**Baseline, re-measured rather than quoted.** 1163 tests pass, 0 fail, 3 skipped (the
pre-existing keyvault skips), `auditcheck` 108/108, `pnpm -r typecheck` and `pnpm lint`
clean. All three shipped lessons cast strict-clean end to end at `standard`
(`projects/qc81-longitude`, `qc81-gd`, `qc81-hashmap`) — 20 QC checks each, `ok: true`,
zero problems and zero advisories, with only the two keyed Tier-2 checks skipped and the
real reason recorded.

## Headline

**Phases 0–7 did what they said.** Of the 49 non-PASS rows in the original table, 39 are
now PASS on re-derived evidence and 7 are closed by a waiver whose evidence I re-checked
and which still holds. Nothing that was closed has come undone: the pinned hashes are in
place, the gates block, the corpus casts clean, and two independent frame extractions of the
same film are byte-identical.

**Three rows do not reach PASS, and one row that was PASS no longer is.** The interesting
output is the last of those. Re-running the audit's own instruction — cast the shipped
lessons, then cast one of them again — surfaced a defect no gate in this repo can see:

> **The voice stage's clip/sidecar repair rescales phrase timings and leaves word timings
> on the old scale.** A scene whose audio is re-synthesised shorter than its cached timing
> keeps its original word stream, so `enter.at` is computed as _unrescaled word start ÷
> rescaled duration_, and every reveal in that scene fires late by the ratio between them.
> Measured on the longitude film rendered for this re-audit: scene `s0`'s clip is 13.595s
> against a sidecar claiming 15.325s, five of its 35 words are timed past the end of its own
> audio, and its reveals land **0.57s and 1.06s after** the words that cue them. The run was
> strict and passed all 20 checks.

It is **pre-existing and not a regression**, verified rather than assumed: the rescale block
at `5f83bc4:packages/voice/src/narrate.ts` is byte-identical to today's, and the call that
hands unrescaled `words` to cue resolution is identical too. The original audit missed it
because all seven passes examined the _aligner_ (S6-b, D8) and none examined the
reconciliation between a clip on disk and the sidecar that describes it.

## The exit bar

The plan's bar is "every check PASS or named waiver; a new PARTIAL is a Phase-9 backlog item
with an owner, not a silent regression."

**The bar is not met, and the honest reading is that it is close.** 58 PASS, 7 waived,
4 PARTIAL. The four are written up below as Phase 9 items with the work named. **None of
them has an owner** — that is the one part of 8.1 the re-audit cannot do for itself, and it
is the decision this report hands back.

| Verdict          | Original (`5f83bc4`) | Now (`2abd28d`) |
| ---------------- | -------------------- | --------------- |
| PASS             | 20                   | **58**          |
| Closed by waiver | — (0 written)        | **7**           |
| PARTIAL          | 39                   | **4**           |
| FAIL             | 6                    | **0**           |
| MISSING          | 4                    | **0**           |
| **Rows**         | **69**               | **69**          |

**A correction to the remainder handoff, which the worklist rested on.**
`docs/HANDOFF-AUDIT-REMAINDER.md` described the artefact as "a **61-row** verdict table" at
"**17 PASS, 34 PARTIAL, 6 FAIL, 4 MISSING**". The table in `AUDIT-FINDINGS.md` has **69**
rows at **20 PASS, 39 PARTIAL, 6 FAIL, 4 MISSING**. Those numbers appear nowhere in the audit
itself; they were written into the handoff and never checked against the table they
describe. Eight rows were therefore missing from the worklist a re-auditor would have built
from that sentence.

---

## Verdict table

`Δ` is the move since `5f83bc4`. "Closed by" names the plan item or waiver whose evidence I
re-derived; a row with no entry was PASS and stayed PASS.

| Check                    | Now     | Δ          | Closed by / note                                               |
| ------------------------ | ------- | ---------- | -------------------------------------------------------------- |
| A-1 single IR            | PASS    | ← PARTIAL  | 5.5 — stale copies gone, `compiledFingerprint` warns           |
| A-2 no model coordinates | PASS    | ← PARTIAL  | 5.6 — re-anchoring; `set-camera` takes intents                 |
| A-3 solver-owned layout  | PASS    | —          | re-derived; unchanged                                          |
| A-4 measured text        | PASS    | ← PARTIAL  | 2.1 — one advance table in the repo                            |
| A-5 determinism          | PASS    | —          | re-proved: two frame extractions byte-identical                |
| A-6 narration anchors    | PASS    | ← PARTIAL  | 4.1/4.2 — `cueWord`, gated (but see **N-1**)                   |
| A-7 QC patches IR        | PASS    | —          | re-derived; unchanged                                          |
| A-8 append-only          | WAIVED  | ← PARTIAL  | **W1**, evidence re-checked                                    |
| S0-a grounding           | WAIVED  | ← MISSING  | **W7**, evidence re-checked                                    |
| S0-b source refs         | PASS    | ← FAIL     | 5.2 — `sourceRef` verified against headings                    |
| S0-c duration budget     | PASS    | ← PARTIAL  | 4.3 — `core/src/drift.ts`, measured every run                  |
| S1-a plan artifact       | PASS    | —          | unchanged                                                      |
| S1-b prerequisite DAG    | PASS    | ← PARTIAL  | 5.4 — `lessonOrderAdvisories`, validate-don't-derive           |
| S1-c misconceptions      | PASS    | ← PARTIAL  | 5.3(a) — critique problem                                      |
| S1-d concrete→abstract   | PASS    | ← PARTIAL  | 5.3(c) — reported, axes as the honest signal                   |
| S1-x thesis/beat time    | WAIVED  | ← PARTIAL  | **W5**                                                         |
| S2-a narration order     | WAIVED  | ← PARTIAL  | **W6**                                                         |
| S2-b word budget         | PASS    | —          | unchanged                                                      |
| S2-c TTS normalizer      | PASS    | ← PARTIAL  | 4.4 — `foldScripts`/`stripLatex` before `stripMarkdown`        |
| S3-a schema enforced     | PASS    | —          | unchanged                                                      |
| S3-b IR coordinates      | WAIVED  | ← PARTIAL  | **W3**                                                         |
| S3-c reference graphs    | PASS    | ← PARTIAL  | 3.2 — `critiqueStoryboard`, gated                              |
| S3-d validation failure  | PASS    | —          | unchanged                                                      |
| S3-e IR persisted/keyed  | PASS    | —          | unchanged; `MANIFEST_VERSION` 4, `COMPILER_VERSION` 4          |
| S4-a distinct solver     | PASS    | —          | unchanged; 2.7's realized sweep added                          |
| S4-b glyph coverage      | PASS    | ← MISSING  | 1.1 — `covers()` + equation-fallback gates                     |
| S4-c collision assert    | PASS    | ← PARTIAL  | 2.3 — `inkOnInkViolations`, blocking                           |
| S4-d revealed-in-frame   | PASS    | ← PARTIAL  | 2.3 — authored blocks, derived warns (argued)                  |
| S4-e fill gate           | PASS    | ← FAIL     | 2.6 + **W2**; floor re-measured on this run at 20.3% / 13.8%   |
| S4-f min glyph height    | PASS    | ← FAIL     | 2.4 — `MIN_GLYPH_PX = 10`, corpus-derived                      |
| S4-g blocking posture    | PASS    | ← FAIL     | 0.1 — `GateMode`, strict by default, `--degrade` recorded      |
| S4-x canvas extent       | PASS    | —          | unchanged                                                      |
| S5-a renderer coverage   | WAIVED  | ← PARTIAL  | **W8**; `lanedemand` re-run — 57 lessons, demand still 0       |
| S5-b math path           | PASS    | ← PARTIAL  | 1.2 — ninth mark advertised, `sniffMath` promotion             |
| S5-c style centralized   | PASS    | ← PARTIAL  | 2.2 + 7.3 — one palette, styles are files                      |
| S5-d asset caching       | PASS    | ← PARTIAL  | 6.5 — `figureModelToken`; style out, argued                    |
| S5-e failure modes       | PASS    | ← PARTIAL  | 6.4 — the raster trust gate                                    |
| S5.1 routing purity      | PASS    | —          | unchanged                                                      |
| **S5.6 raster alpha**    | PARTIAL | ← FAIL     | 6.4 detects; it still cannot key out — **Phase 9 #1**          |
| S6-a word timestamps     | PASS    | ← PARTIAL  | 4.1 — indices end to end                                       |
| S6-b alignment honesty   | PASS    | ← PARTIAL  | 1.3 — `MIN_ALIGN_FRACTION = 0.5` (but see **N-1**)             |
| S6-c normalizer test     | PASS    | ← PARTIAL  | 4.4 — the audit's six probes are the test                      |
| S6-d duration drift      | PASS    | ← PARTIAL  | 4.3 — measured per run, in `pipeline.json`                     |
| S6-x audio cache/cloud   | PASS    | —          | unchanged                                                      |
| D8 fake timings          | PASS    | ← PARTIAL  | 1.3 for the audited hole; **N-1** is a different one           |
| S7-a timeline artifact   | PASS    | ← PARTIAL  | 7.2 — `--emit-plan`, `planhash --timing`                       |
| S7-b velocity/zoom caps  | PASS    | ← PARTIAL  | 2.5 — `MAX_VIEWS_PER_SEC = 2.4`                                |
| S7-c dwell assertion     | PASS    | ← PARTIAL  | 2.3 — `overrun` blocks, `dwell` advisory (argued)              |
| S8-a determinism test    | PASS    | —          | = A-5                                                          |
| S8-b fonts awaited       | PASS    | —          | unchanged                                                      |
| S8-c per-element seeds   | PASS    | —          | unchanged                                                      |
| S8-d sharding            | PASS    | ← PARTIAL  | 7.1 — segments keyed, retryable, cached                        |
| S8-e motion blur         | WAIVED  | ← MISSING  | **W4**                                                         |
| S8-x encoder/idempotency | PASS    | —          | encoder half holds; the idempotency half is X-g                |
| S9-a QC stage            | PASS    | ← PARTIAL  | 3.1 — the seventh stage, 20 checks on this run                 |
| **S9-b tier coverage**   | PARTIAL | =          | Tier 2 keyed half unexercised, Tier 3 blocked — **Phase 9 #2** |
| S9-c blocking behavior   | PASS    | ← PARTIAL  | 1.4 + 3.4 — severity is a field, not a habit                   |
| S9-d OCR round-trip      | PASS    | ← MISSING  | 3.3 — `ocrDiff`, advisory                                      |
| S9-e failure granularity | PASS    | ← PARTIAL  | 3.1 + 7.1 — per-beat findings, per-segment re-encode           |
| S10-a regen granularity  | PASS    | ← PARTIAL  | 7.1                                                            |
| S10-b diff→frame range   | PASS    | ← FAIL     | 7.1 — the last FAIL in the table                               |
| S10-c model-free edits   | PASS    | —          | unchanged                                                      |
| X-a determinism          | PASS    | —          | = A-5                                                          |
| X-b cache layers         | PASS    | —          | unchanged; `styleKey` folded in by 7.3                         |
| X-c cost attribution     | PASS    | ← PARTIAL  | 3.5 + the two cost-honesty findings                            |
| **X-d observability**    | PARTIAL | =          | two diagnostics still evaporate — **N-3**, **Phase 9 #3**      |
| X-e silent defaults      | PASS    | ← PARTIAL  | 3.4                                                            |
| X-f style packs          | PASS    | ← PARTIAL  | 7.3; the studio picker gap is Phase 9 #4                       |
| X-g idempotency          | PARTIAL | **← PASS** | **N-2** — a re-cast is not a no-op — **Phase 9 #1 (with N-1)** |

---

## New findings

Three, none of them in the original table. **N-1** and **N-2** share a mechanism and should
be fixed together; **N-3** is what let both of them ship quietly.

### N-1 — the clip/sidecar rescale drops the word stream (MAJOR)

**What.** `narrate.ts:849-868` verifies the clip on disk against the timing that describes
it, and on a mismatch "trusts the file and rescales". The rescale rewrites `narrationSec`
and every entry in `phrases`, and passes `words` through untouched. Eleven lines later
(`narrate.ts:872`) the _unrescaled_ words are written onto the scene, and
`resolveSceneCues` (`narrate.ts:888-896`) is handed `words: timing.words` beside
`narrationSec: timing.narrationSec` — one on the old scale, one on the new.

**The consequence, measured.** `enter.at` comes out as _unrescaled word start ÷ rescaled
duration_, so every reveal in the scene fires late by exactly the ratio between the two.
On `projects/qc81-longitude`, scene `s0`:

| element    | cue word  | word start | `enter.at` | fires at | audio says |
| ---------- | --------- | ---------- | ---------- | -------- | ---------- |
| `b0_rule`  | "British" | 3.44s      | 0.269      | 3.44s    | **2.87s**  |
| `b0_term0` | "British" | 3.44s      | 0.277      | 3.54s    | **2.87s**  |
| `b0_term1` | "Scilly"  | 6.34s      | 0.496      | 6.35s    | **5.29s**  |

The scale factor is 12.795 / 15.325 = 0.835, so the reveals land 0.57s and 1.06s after
their own words. That is the D5 defect, produced by the repair pass that exists to prevent
desync.

**Blast radius, swept.** Across the 55 projects on disk that have a storyboard, **7 scenes
carry word timings that run past the end of their own audio** — always scene 0, across 3
distinct lessons:

```
project                  scene  durSec    wav lastWord  over/n
qc0-doc                  s0      22.02  22.82    27.22    10/58
qc31-longitude           s0      12.79  13.60    15.14     5/35
qc62-hashmap             s0       8.26   9.06    10.18     3/25
qc65-longitude           s0      12.79  13.60    15.14     5/35
qc71-longitude           s0      12.79  13.60    15.14     5/35
qc81-longitude           s0      12.79  13.60    15.14     5/35
qcf2-hashmap-short       s0       8.26   9.06    10.18     3/25
```

`qc0-doc` is the worst: ten words timed as much as 4.4s past the end of the clip.

**Why nothing caught it.** `overrunViolations` (`boardcheck.ts:340`) checks
`start + dur > sceneEnd` on _plan items_, which are derived from the very `enter.at`
fractions the defect corrupts — the fraction is in range, so the item is in range.
`MIN_ALIGN_FRACTION` guards the aligner's honesty about a transcript, not the sidecar's
honesty about a file. No check compares `scene.words` to the duration of the clip it
describes.

**Pre-existing, verified.** `git show 5f83bc4:packages/voice/src/narrate.ts` carries the
identical rescale block and the identical `words: timing.words` call. Phases 0–7 neither
caused nor worsened it.

**The fix, named.** Rescale `words` in the same block that rescales `phrases`, and write the
rescaled timing back to the sidecar so the mismatch is repaired on disk rather than
re-repaired in memory on every run. A red test is cheap: a sidecar and a clip that disagree,
asserting that no word ends after the clip does.

### N-2 — a re-cast is not a no-op, because an abandoned attempt overwrites a cached clip (MAJOR)

**What.** When a cloud voice provider fails mid-film the stage abandons the attempt and
restarts the whole film on the fallback (`narrate.ts:768-816`). Its comment is right about
the clip it just wrote — not marked fresh, so the restart re-synthesises it — but wrong
about the clip it _overwrote_: a scene that already held a valid cached clip under the
fallback provider's own key now has that file replaced, while its sidecar and its
freshness marker still describe the old one. The restart pass then finds the cache fresh
(`narrate.ts:745`), reads the stale sidecar, and hands N-1 the mismatch to mis-repair.

**The consequence, measured.** Casting `examples/lessons/longitude.lesson.json` into the
same project three times produced three runs that re-synthesised scene 0 every time
(`scene-000.wav` rewritten at 23:01, 23:05 and 23:09 while `scene-000.timing.json` was
written once, at 23:01, and never again) and two different film lengths — 133.17s, then
130.67s, then 130.64s. Because the
timeline moved, 7.1's segment cache reused **nothing**: the second render took 176.0s where
the first took 67.0s.

The same lesson cast into six fresh projects across sessions gives three different lengths,
in two exact clusters — 133.17s (`qc53`, `qc61`, `qc73`), 130.64s (`qc65`, `qc81`), and
134.94s (`qc71`) — which is a path difference, not floating-point noise.

**Scope of the original PASS.** X-g's evidence was a re-run that was a state-checked no-op,
which is true whenever the voice stage's cache hits. It does not hit when the configured
cloud provider is present-but-failing, which is this machine's standing condition and the
condition every recent project on disk was cast under. The verdict was not wrong about what
it measured; it measured the easy case.

**The fix, named.** Either do not write a clip for a scene whose cache entry is still valid
under another provider's key, or invalidate the cache entry when the file under it is
overwritten. The second is smaller and is the one the freshness record already has the shape
for.

### N-3 — the two most diagnostic warnings in a run reach nothing but the terminal (MINOR)

By the audit's own rubric — "an assertion that logs-and-continues counts as absent" — these
are absent, and they are the reason N-1 and N-2 were invisible for two days of clean runs:

- **`reportFill`** (`core/src/camera.ts:641-662`) returns `void` and logs. It fires on films
  that _pass_ the fill gate, which is exactly when it is the only signal there is, and it
  carries the one thing the gate's message does not: which of the two factors is low. On
  `qc81-longitude` it said "mean content fill 20% … 8 of 8 scenes are already grouped — so
  the deficit is the drawing, not the shot". Nothing in `qc.json` or `pipeline.json` records
  it. Its caller (`render/src/compile.ts:660`) sits three lines above the gated `vacancy`
  block that _is_ recorded.
- **The clip/sidecar mismatch warning** (`narrate.ts:853`) is the only thing that ever says
  N-1 happened, and it is a `log.warn` with no `onProblem` beside it.

Everything else in the tree learned this lesson in 3.4. These two were missed.

**The fix, named.** `onProblem` on both, on the rail 3.4 built. `reportFill` takes
`StageOptions`; the mismatch warning is already inside a stage that has one.

---

## Phase 9 — the backlog this produced

Four items, in the order I would do them. **No item has an owner**; assigning them is the
decision this report hands back, and the plan's rule is that an unowned PARTIAL is exactly
what a re-audit is supposed to prevent.

**#1 — N-1 and N-2 together (X-g, and the S6 family). ~half a day, $0.**
The rescale drops `words`; the abandoned attempt overwrites a cached clip. One is three
lines and a test, the other is one invalidation. Doing them apart means fixing the symptom
without the trigger. _Done when:_ no scene on disk has a word timed past its own clip, and
casting a shipped lesson twice into one project re-encodes zero segments.

**#2 — S5.6, the raster alpha (MINOR, but it blocks a dark style pack). ~2 days, $0.**
6.4's `MIN_GROUND_WHITE` (`visuals/src/image.ts:1115`) _detects_ a non-white ground; it
cannot key one out, and a figure composites with `mix-blend-mode: multiply`, so on a slate
board the picture's own ink multiplies into a surface already darker than itself and
disappears. 7.3's `MIN_PAPER_LUMA` (`core/src/stylepack.ts:142-148`) refuses a dark pack for
precisely this reason and says so in the error. _Done when:_ a chalk-surface pack renders a
figure legibly.

**#3 — N-3, the two evaporating diagnostics (X-d). ~an hour, $0.**
Cheapest item on the list and the one that would have shortened this re-audit.

**#4 — the studio style picker (X-f's one gap). ~an hour, $0.**
`apps/web/components/studio/options.ts` lists the four shipped ids as a literal, because the
pack loader reads the filesystem and cannot be bundled for a browser. A user-added pack works
through the CLI and the API and does not appear in the web picker. The file says so where the
list is; the close is `styleIds()` served from a route.

**Blocked, not backlogged: S9-b.** Tier 2's keyed half — the vision pass and the OCR diff —
has still never run against a live model; both skipped on all three casts with
`400 … credit balance is too low`. Tier 3 does not exist and cannot until a source does,
which is W7's own argument. Neither is work somebody can pick up today; both are gating item
1 in the remainder handoff, and the first session with credit closes the first of them.

---

## Waivers — evidence re-checked

A waiver whose evidence moved is void (§5's own preamble). All eight hold:

- **W1** (append-only) — `runtime.js` exits are still opacity writes; `persistUntil` still
  expires framing history in lockstep (`core/src/camera.ts:350`); both pins present.
- **W2** (the 55–85% fill band) — re-measured on this run: longitude is mean **20.3%** /
  sparsest **13.8%**, the exact pair W2 records, against a floor of 18% / 11%.
- **W3** (no x/y in the IR) — the two-altitude split is unchanged; 5.6 closed the document
  route's leak, which W3 explicitly did not cover.
- **W4** (motion blur) — unchanged.
- **W5** (per-beat `targetSec`) — unchanged; 4.3 now measures the drift W5 said would stay
  measurable after the fact.
- **W6** (narration ordering) — unchanged.
- **W7** (retrieval) — `grounding` is recorded and surfaced; all three casts printed
  "grounded — the supplied lesson". The trigger (one film wrong in a way retrieval would have
  caught) has not arrived.
- **W8** (the three lanes) — `lanedemand.mts` re-run: **57 lessons, 13 topics, demand 0 / 0 /
  0**, fixtures 3 / 0 / 0. The corpus grew by three films since 6.3 and the number did not
  move. The trigger is two in the `demand` column.

## What I re-derived, and how

1. `auditcheck` (108 checks, sub-second) — green. That is the mechanical subset.
2. Every row the coverage table says moved, against the plan's own progress entry for the
   item that moved it, in the tree rather than in the prose.
3. The 20 rows that were already PASS — where the regression would be. One moved (X-g), and
   it moved because the original verdict measured the easy case, not because a phase broke it.
4. Three strict casts end to end, and frames opened. That is where N-1 came from: nothing in
   any report says a reveal is late, and the numbers in `qc.json` are all green.

**A note for the next reader on what a frame is worth.** At t=100s the longitude board holds
a caption — "Five seconds of error is about a mile" — and, under it, the same sentence again
in smaller type: "five seconds of error against one nautical mile". Three-quarters of the
frame is empty. Both fill instruments pass it (bbox 20.3% against an 18% floor; ink 2.95%
against a 1.0% floor), and both are right to: the class W2 handed to Tier 2 was _vacancy_,
and this board is not vacant, it is redundant. Nothing in this repo measures whether a beat's
picture says something its caption does not. That is not a defect against any row in the
table, and it is the most obvious thing wrong with the film.
