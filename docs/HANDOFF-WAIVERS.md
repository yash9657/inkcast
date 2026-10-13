# Handoff — reopening W8, W7 and W2 (and probably W1)

**Written 2026-08-25, branch `visuals-morph-density`, after Phase 9 landed.** This file
exists because the product owner read the waiver list and rejected three of them. That is a
scope decision, not a bug report, and it reverses arguments that are written down in
`docs/AUDIT-FINDINGS.md` §5 and were correct on the evidence available when they were made.
**Do not open this file and start coding.** Each item below has a decision to make first, and
for two of them the decision is bigger than the implementation.

The standing verdict before this file: **61 PASS, 7 waived, 1 PARTIAL** over the audit's 69
rows (`docs/AUDIT-REAUDIT.md`, plus its 2026-08-25 addendum). Reopening these moves three
rows out of "waived" and back into "open", and the honest way to record that is to say the
verdict is now **61 PASS, 4 waived, 4 open** the moment this work starts.

---

## The decision, as given

Quoting the intent rather than the words:

1. **W8 is rejected outright.** "Our promise is that we can draw anything the user asks us to
   draw. Not being able to draw chemistry structures, circuit diagrams and maps is not
   acceptable. We literally need to be able to draw anything. That is how powerful our
   pipeline should be."
2. **W7 is rejected on its face.** "Why on earth would we not look anything up? How else would
   we create an accurate lesson plan?"
3. **W2's floor is too low.** "At least get to the middle somewhere, then test a video and
   check whether 55–85% is right or our threshold is." 18% / 11% is judged too permissive.
4. **W1 is a maybe.** "There must be some sense in the audit asking that ink never be
   removed. Maybe we need to respect that as well."

The five waivers **not** reopened are W3 (coordinates in the compiler-authored IR), W4
(motion blur), W5 (per-beat `targetSec`), W6 (narration/visual co-generation) — and W1 only
until item 4 below is decided.

---

## W8 — "draw anything"

### The decision to make before any code

"Draw anything" and "build the three missing lanes" are **not the same project**, and the
difference is most of the cost.

- **Reading A — build the three named lanes.** Chemistry, circuits, geography. Bounded,
  estimable, and it closes the audit row (S5-a) exactly as written. It does not deliver the
  promise: the fourth thing a user asks for that we cannot draw puts us back here.
- **Reading B — a general mechanism.** Something that can draw a class of picture nobody
  enumerated in advance. This is the promise as stated, and it is a different engineering
  problem: it means either a much stronger generative-image lane that is _trusted_ (which
  6.4's raster gate exists precisely because it is not), or a diagram DSL the model can emit
  and the renderer can draw, or both with a routing decision between them.

**My read:** the promise argues for B, but B with no A underneath it is how you get the
confidently-wrong picture the whole figure lane was built to prevent — `qc61-aspirin` asked
for a hydroxyl group and got **B₄H₂** on the board in ink. The defensible shape is A as three
worked examples that teach you what the general mechanism has to do, then B. Say which you
are doing in the plan before you write any of it.

### What exists today

- `packages/core/src/lanes.ts` — the honest guard. `UNSERVED` (line 104) is the table of the
  three lanes and what each needs; `unservedLanes(lesson)` (line 271) detects when a lesson
  asks for one; `laneGapLines()` renders the warning. Called from
  `packages/pipeline/src/cast.ts:711`, reported into `qc.json`.
- `packages/pipeline/src/lanedemand.mts` — runs that guard over every lesson on disk and
  counts demand per lane, fixtures in a separate column. **This is the instrument the waiver
  rested on**, and its answer is still 0 / 0 / 0 over 57 lessons.
- `docs/LANE-CHEMISTRY.md`, `docs/LANE-CIRCUITS.md`, `docs/LANE-GEOGRAPHY.md` — 6.3's three
  design docs. **Read these first.** They are the most valuable thing in this item: each one
  names the library, the failure modes, and what the lane has to draw. 6.3 ranked chemistry
  first, and the ranking did not come from the demand table (all zeros) — it came from
  rendering `qc61-aspirin` and looking at the frames.

### The trap that will bite you

6.3's own recorded lesson: **a tripwire nobody can trip is worse than none.** Each of the
three lanes named the library whose installation would force its `UNSERVED` row out, and
`auditcheck` grepped the manifests for it — and not one of the three strings could ever have
matched. If you add a guard, test it against the case it is actually for.

The second trap is that the demand signal now argues _against_ this work. Do not delete
`lanedemand.mts` to make that go away. The honest move is to record in the plan that the
lanes are being built on a **product promise** rather than on measured demand, which is a
legitimate reason and a different one from the reason 6.3 wrote down.

### Done when

A lesson asking for each of the three renders a picture a domain reader would accept, and
`unservedLanes()` no longer fires for it. Under reading B, additionally: a picture class
nobody enumerated renders, or is refused honestly rather than substituted.

---

## W7 — look things up

### Why this one is the least controversial to reopen

The owner's objection is correct on its own terms and the waiver never disputed it. Read
W7's text carefully: **half of it already shipped.** A run records
`grounding: 'document' | 'parametric' | 'supplied'` and says so out loud. What was deferred
is the retrieval lane itself, and the reasons given were (a) the honest half was the
load-bearing half, (b) nothing here measures factual accuracy so "retrieval helps" was a
belief, and (c) 6.1's undrawable-topic guard was a bigger visible defect that week.

Reason (c) has expired — 6.1 shipped. Reason (a) is a reason to sequence, not to skip.
**Reason (b) is the one that survives, and it is the real work in this item.**

### The design is already written — do not redo it

`docs/PLAN-RETRIEVAL.md` is the deferral document and §2 is the implementation. Its central
decision, which took the argument and should be kept: **not** a `SEARCH_API_KEY` lane with
retrieval policy in the planner (how many results, which to fetch, when to stop — the
enumeration mistake, plus a fifth key on a four-lane degradation story), **but** the
server-side web-search tool on the lesson call the pipeline already makes. Read §1 ("Which
retrieval") before proposing anything else; it has already rejected the obvious alternative.

### The part nobody has built

**There is no instrument that measures whether a film's facts are right.** That is Tier 3 in
the QC stage's own tiering, it does not exist, and it cannot exist before a source does —
which is W7's circularity and the reason the waiver is shaped the way it is. Building
retrieval without it means you will not be able to answer "did this help?" with anything but
an opinion.

So this item is really two:

- **7a — the retrieval lane.** `PLAN-RETRIEVAL.md` §2. Bounded.
- **7b — Tier 3, the accuracy check.** The thing that makes 7a measurable. Design it
  alongside 7a, because a retrieved source is exactly what it needs as its ground truth: a
  claim in the narration, the passage it came from, and a check that the two agree.

Doing 7a without 7b is allowed. Doing it and _claiming_ it improved accuracy without 7b is
not.

### Cost, honestly

This one spends money per film, every film, for ever. Server-side web search is billed per
call on top of the lesson generation. Put the number in the plan before turning it on by
default, and check it lands in `pipeline.json`'s `cost.lines` — the rule since the
cost-honesty findings is that a cost line is built from observed quantities, so an unexpected
line is a bug rather than noise.

---

## W2 — the fill floor

### Take the instruction, but know what the numbers mean

The instruction is to raise the floor toward the middle of the audit's 55–85% band and then
test a real film. That is a reasonable experiment and it should be run. Two facts have to be
in front of whoever runs it, or the experiment produces a number that means nothing:

**Fact 1 — 55–85% and 18% are almost certainly not the same scale.** The gate measures the
union of element _bounding boxes_ over the view. An outlined heart scores its whole box; a
diagonal line scores a rectangle. Measured on `projects/cardiac5/out.mp4`
(`packages/render/src/inkstat.mts:10`), bbox fill reports **21.6%** where real ink is
**4.7% of pixels** — a factor of 4.6. So "get to 45%" on the bbox scale is not "get to the
middle of the audit's band"; it is a much harsher requirement than the audit wrote, applied
to a different quantity.

**Fact 2 — the bbox scale has a low ceiling.** Safe insets cap the theoretical maximum at
**76.5%** of the frame (`core/src/camera.ts:36-61`), before any question of what the beat
draws. A shipped film everyone is happy with measures **20.3% mean / 13.8% sparsest**.

### The experiment to run, in order

1. **Cast three or four films the owner will judge by eye** — including at least one they
   consider _correctly full_ and one they consider _too empty_. This is the missing input:
   every number in W2 was derived from films nobody had ranked.
2. **Measure each on both scales.** `npx tsx packages/render/src/fillcheck.mts <project>` for
   bbox fill, `npx tsx packages/render/src/inkstat.mts <project>/out.mp4` for real ink
   pixels. Since 9.3 the per-scene bbox numbers are also in `qc.json` under the `vacant`
   check's note, and the `thin-fill` check says _which of the two factors_ is thin — how much
   of the frame the camera holds, versus how much of that the ink covers. That second number
   is what a fill target is really asking about.
3. **Decide which scale the gate should live on.** The honest candidate nobody has tried is
   moving the blocking floor onto the **ink-pixel** measure, where the audit's band is at
   least dimensionally meaningful, and demoting bbox fill to the layout regression check its
   own header says it is. `MIN_INK_SHARE` (`render/src/tier2.ts:79`) is already 1.0% and
   already advisory — that is the seam.
4. **Then set the number**, and re-record it in W2 with the ranked films as the evidence.

### What moved under this file, 2026-08-25 — and it moved _down_

`PLAN-RECALL-FIX` Task 4 sent someone to measure the **per-scene** half of the floor, which
was the one number in this gate the corpus had never been asked about, and the measurement
came back against it. Recorded here because it runs opposite to the instruction above and
whoever takes W2 must not re-derive it by accident:

- The per-scene floor only ever decides a board that **already passed** the 18% mean floor.
  In that population — 58 of the 60 boards in `projects/`, 487 scenes — the lowest scene
  fill in the whole corpus is **10.0%**, and the next four are 10.7%, 10.8%, 10.9%, 11.6%.
  The 11% floor was therefore failing exactly four scenes, all four in composed boards
  (means 21.2–30.5%). `projects/cardiac`'s s8 at 10.0% is the **only** entry in its entire
  `qc.json`.
- Pool the two vacant boards back in and no floor near 11% can work at all: their scenes run
  2.0–14.1% and interleave with the composed ones right through the 10–12% band
  (`5b5566b87593` alone has scenes at 10.6%, 11.6% and 12.3%). This is Fact 1 above showing
  up per-scene rather than per-board.
- So the floor was pinned to the one independent measurement of a blank beat that exists —
  the Tier-2 ink share, whose three confirmed-blank frames measure 6.4%, 4.7% and 2.8% on
  the bbox scale — and set to **8%**: `MIN_SCENE_FILL`, `render/src/compile.ts`.

None of that touches the **mean** floor or the scale question, which is where the
instruction above actually bites. If W2's experiment moves the gate onto the ink-pixel
measure (step 3 above), this constant goes away with the rest of the bbox blocking path.

### The trap

W2's floor was not chosen to be permissive. It was chosen because at the spec's number **a
shipped film fails, and the board specifically named as the must-fail case measures within
1.5 points of it** — 20.3%/13.8% against 21.8%/13.2%. If a raised floor still cannot separate
those two, the floor is not the problem and raising it just blocks good films. Check that
separation explicitly before shipping a new number; it is the whole reason the old one is
where it is.

---

## W1 — append-only (decide before you build)

Flagged as a maybe, so this is a decision item rather than a work item.

**What is actually waived:** the default board (`accumulate`) _is_ append-only end to end.
Two authored exceptions remove ink — `--board wipe`, and morph-`retire`. Both are
camera-consistent by construction (`persistUntil`, `core/src/camera.ts:350`) and both are
pinned by tests.

**Why it exists:** the `explainer` preset defaults to `board: 'wipe'` at ≤90s, and that was a
measurement, not taste. On the same lesson, wiping moved mean content fill from **55.5% to
62.3%** and regions from **4 to 1** (`docs/CONTRACT.md:35`) — at eight beats in a four-cell
region, a beat is framed at a quarter of the screen and nobody re-reads beat four at that
size. The audit derived append-only from 89–511s films; the exception is for short ones.

**⚠ W1 and W2 pull in opposite directions, and whoever takes these must know it.** Wiping
_raises_ fill, because it lets the camera stay tight on fewer things. Restoring strict
append-only therefore **lowers** fill on short films — at the same time as W2 raises the
floor those films have to clear. Do W1's decision and W2's number **together**, or you will
set a floor against films that a later change makes unable to reach it.

Also note those two percentages predate plan 2.1, which replaced a chars×0.52 text estimate
with real font advances and tightened every reserved box. **Re-measure before quoting them.**

---

## How to verify anything you land here

```
pnpm -r typecheck && pnpm -r test && pnpm lint
npx tsx packages/pipeline/src/auditcheck.mts
node --import tsx apps/cli/src/index.ts --lesson examples/lessons/longitude.lesson.json --project <scratch-id>
```

`docs/HANDOFF-AUDIT-REMAINDER.md` has the full instrument list and the standing rules — read
its "Rules that still apply" section, all of which survive this file. The three that matter
most here:

- **Corpus-derived constants are named recalibrations, not spec values**, and each is argued
  in its own comment. If you move one, move the argument with it.
- **A number written into a handoff is not evidence.** Cite the artefact or re-measure. Every
  figure in this file names where it came from; two of them (W1's fill pair) are explicitly
  marked stale.
- **Look at the output.** Three sessions running, the real defects were found by rendering
  the thing and opening the frame, not by any check.

## Order, and what it costs

1. **W2 + W1 together** — the experiment is cheap, needs no keys, and its answer constrains
   nothing else. Do it first so the fill target is settled before anything changes what the
   board holds. ~2 days including the ranked casts.
2. **W7** — 7a is bounded and the design is written; 7b is the open one. Needs a funded
   Anthropic key, and it adds a recurring per-film cost.
3. **W8** — largest by a distance, and the only one whose _scope_ is undecided. Reading A is
   ~1 week per lane on the 6.3 docs' own estimates; reading B is a research question with a
   plan attached, not a plan.

**Nothing here is blocked on the two things that block 8.2** (a funded key and a scoring
harness) except W7. W2, W1 and W8 can all start today.
