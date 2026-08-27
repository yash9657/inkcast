# Handoff — the three gates still open, and the one chain that links them

Written 2026-08-27 for a session starting with no context. Self-contained: read this, then
`docs/PLAN-WATCHABILITY.md`'s acceptance test (the nine gates) if you want the wording of a
gate, and `docs/STATUS.md`'s last two sections for the arithmetic behind a number.

`docs/HANDOFF-GATE-ONE.md` is **done** — all three of its tasks were executed 2026-08-27
and two of them came back negative. Do not re-run them; the results are below.

## Where things are

Branch `visuals-morph-density`, HEAD `b9ecc82`, tree clean, `pnpm -r test` **1,243 tests, 0
failures**, `pnpm -r typecheck` and `pnpm lint` clean.

Five commits landed:

```
eb71d4b  a figure is not ink; the repair may not push a name off the canvas
8cb712f  routecheck opens the vault; the routing lever measured away
83c21f0  export the Underlay a public caller now has to pass
b33daca  one ignorable null was costing a film its whole figure lane
b9ecc82  STAGE_CODE_VERSION.lesson 14 -> 15
```

### The films on disk, and which one is which

- **`projects/df62ce29a563`** — the current measurement film. `explainer` + `wipe`, 8
  scenes, cast 2026-08-27 with everything above in. **It has no `out.mp4`**: it is blocked
  at the `check` stage on `misconception-cut`, which is gate 8 failing, correctly. The
  `storyboard.json` is written _before_ the check stage, so every measurement below is real.
- **`projects/f3ac9c760194`** — the 2026-08-25 acceptance film, 78.65s, strict-clean. Still
  the only one with a rendered `out.mp4`, but its marks are pre-`eb71d4b` drawings.
- **`projects/f6978912f741`** — a mis-cast (CLI defaults, so `standard` + `accumulate`).
  Useless for gate 1. Kept only because it is the end-to-end proof of `eb71d4b`.

## The nine gates as of now

| #   | gate                                    | status               | measured                          |
| --- | --------------------------------------- | -------------------- | --------------------------------- |
| 1   | fill ≥ 35% mean, no scene under 14%     | **FAIL** on the mean | mean **30.8%**, min 15%, max 66%  |
| 2   | pen: never two elements mid-draw        | PASS                 | unchanged since 2026-08-25        |
| 3   | dwell                                   | PASS                 | unchanged                         |
| 4   | draw time scales with ink               | PASS                 | unchanged                         |
| 5   | no card title truncated mid-phrase      | PASS                 | unchanged                         |
| 6   | delivered pace within ±5%               | **PASS — verified**  | **12.08** and **12.33** vs 12.16  |
| 7   | ≥ 2 beats carry a generated figure      | **FAIL**             | 2 routed, **1 survived the trim** |
| 8   | 60–90s, misconception survives          | **FAIL**             | est. **123s** vs 75s; it was cut  |
| 9   | works in a freshly restarted `next dev` | PASS                 | unchanged                         |

**Gate 6 is closed and it was the last genuinely unknown thing in the plan.** Two different
lessons of the same prompt were measured this session — 12.33 delivered letters a second
(+1.4%) and 12.08 (−0.7%) — both inside the ±5% band around the re-pinned 12.16. It is no
longer true-by-construction on one film. To re-measure it, there is no harness; it is ten
lines against `audio/scene-*.timing.json`: sum `narrationSec`, count `\p{L}` over each
sidecar's `phrases[].text`, divide.

## The one thing to understand: 8 causes 7, and both drag 1

The lesson author overruns the `explainer` word budget, every time. The brief budgets **165
words across 8 beats** (`STAGE_CODE_VERSION.lesson` 12 states it as its own block). Three
casts of the identical prompt came in at **266, 294 and 337** narration words over 9–10
beats — 60% to 100% over. The trimmer is therefore always asked to remove roughly a third
of the film, and it reaches beats it should never reach.

Phase 5.1 was supposed to stop it reaching the misconception, and the protection is real:

```ts
// planner/src/presets.ts
export function misconceptionIsPayload(lesson: Lesson): boolean {
  const m = lesson.misconception;
  return !!m && m.from === 'derived' && m.derivedFrom.includes('worked') && !!lesson.worked;
}
```

**Its trigger is authored, and the author is not consistent about it.** Across three casts
of one prompt the misconception declared:

| film           | `derivedFrom`         | protected |
| -------------- | --------------------- | --------- |
| `f3ac9c760194` | `['step3', 'worked']` | yes       |
| `f6978912f741` | `['worked']`          | yes       |
| `df62ce29a563` | `['step4']`           | **no**    |

So gate 8 is a coin flip across casts of the same prompt, and the acceptance film passed it
by luck. When it loses, the beat goes — **and the generated figure routed to that beat goes
with it**, which is the whole of gate 7's failure: 2 figures routed into `lesson.json`, 1
asset element in `storyboard.json`.

Read the `## Why it is not simply from === 'derived'` block above that function before
touching it. The narrow reading is **deliberate**, for two stated reasons: it distinguishes
a caveat that follows from step 1 from the correction to the error the worked example just
invited, and widening it reorders the trim on the three shipped example lessons — all of
which cite steps and none of which cites `worked` — which moves the four pinned storyboard
hashes for lessons nobody has looked at frames of. That bar is real; see
`packages/planner/test/pinned-hashes.test.ts`.

## Task A — gate 8, which also fixes gate 7 (the keystone)

Two independent levers. They are not alternatives; the first is the cause and the second is
the seatbelt.

**A1. Make the word budget bind.** If the lesson fit 75s, nothing would be dropped and both
gates pass without touching the trimmer. Today it overruns by 60–100% on every cast. The
budget is already stated as its own block in the brief and already reads the preset, so a
fourth restatement is not the move — measure first _where_ the words go. All three casts
spread 25–34 words per beat across 9–10 beats when the budget implies ~20 across 8. The
beat **count** is as over as the word count, and `maxBeats` is a preset field the trimmer
enforces after the fact rather than something the author is held to up front.

**A2. Make the protection fire regardless of what the author cited.** The pedagogical
distinction in `misconceptionIsPayload` is sound; what is fragile is that it depends on a
free-text field. Options, cheapest first: derive payload-ness from the lesson rather than
from the citation; or keep the citation but have the _author's_ brief say that a
misconception corrected by the worked example must cite it; or widen the condition and pay
the pinned-hash re-pin properly (look at frames, per that test file's header).

**Cost to test either: one cast, ~$0.70.** See the recipe and its traps below.

## Task B — gate 1, and the lever that is already dead

The mean is **30.8%** against a bar of 35%. The per-scene floor passes (min 15% ≥ 14%).

```
 0 s0  hook   fill 45%  held 50%  cover 90%   <- the one surviving figure
 1 s1  anchor fill 23%  held 73%  cover 31%
 2 s2  step   fill 29%  held 70%  cover 41%
 3 s3  step   fill 15%  held 52%  cover 29%
 4 s4  step   fill 29%  held 74%  cover 39%
 5 s5  step   fill 16%  held 50%  cover 33%
 6 s6  worked fill 66%  held 75%  cover 88%   <- the plot lane
 7 s7  recap  fill 24%  held 71%  cover 34%
```

**Do not spend a session routing more beats to pictures.** `HANDOFF-GATE-ONE.md`'s task 1
proposed exactly that and it was measured and killed on 2026-08-27 (`8cb712f`). The router
answers 3 figure / 5 marks on this topic and it is right on all five: the anchor is two
labelled pull arrows, step1 two motion arrows, step2 two opposing arrows on one ball, step3
the same arrows drawn twice as long beside an equals sign, the recap a chain of boxes. Every
one is a relation whose meaning lives in the arrows. A sharpened brief rule was written,
measured against the old rule on two lessons — this film and `deb81002b073`, the
six-recognisable-objects lesson — produced identical counts and identical beats both times,
and was **not** landed. An unmeasured brief edit is the persuasion that pass replaced.

Restoring the cut misconception does not close this either: it was a 36%-fill scene on the
old film, and adding one to eight scenes averaging 30.8% gives ~31.4%.

**The gap is `cover` and `shape` on relation beats.** s3 and s5 sit at 15–16% with `held`
~50%, meaning both factors are down at once. `thin-card` already tells the author exactly
this and **must not be allowed to open the critic's gate** — the first eight measured
correction calls it would have paid for improved nothing and made two drawings worse.
`INKCAST_DRAW_FIX=all` is how to test a `FIX_BRIEF` that claims to earn them.

## Task C — a hazard of the same shape as `b33daca`, deliberately not fixed

`b33daca` fixed this in the art director: `prompt` and `why` were `z.string().optional()`,
which accepts `undefined` and **rejects `null`**, and the parse is all-or-nothing — so one
`null` in a field `applyRoutes` goes on to ignore threw away every verdict in the answer and
returned the lesson untouched. Zero figures where the same prompt had produced three, and
the only trace was one `warn` in a 300-line log.

`core/src/lesson.ts`'s `Mark` has ten-odd `.optional()` fields (`x`, `y`, `w`, `h`,
`points`, `text`, `tex`…) and `repairElements` in `draw-anthropic.ts` only mends a lost
opening quote — it does not strip nulls. A `"w": null` from the drawing author would lose a
whole drawing the same way. **It has not been observed**, which is why it was left alone,
and it is less severe because `drawOne` has a re-ask loop where `routeFigures` had no retry.
If you fix it, fix it at the model boundary: making `Mark` itself nullish is wrong, because
the same schema validates every `lesson.json` on disk.

## Task D — two documents that will mislead you (free, do first)

- **`docs/STATUS.md` closes by asserting the dead lever.** Its final paragraph
  (~line 2616) says "the lever for a film like this one is **not** the drawing lane … A beat
  that is two objects being compared is a beat that should be routed to a picture … it is
  the next thing worth measuring." It was measured. It is not the lever. A new section for
  2026-08-27 needs to record: gate 6 closed, the routing lever killed, the null bug, and the
  8→7→1 chain.
- **`docs/HANDOFF-GATE-ONE.md` is complete** and its task 1 will send you down the dead end
  if read cold. It has a pointer at the top now; keep it or delete the file.

## What `eb71d4b` changed, in case you touch the audit

The audit was billing the critic to undo two briefs. `underlayInk` was written for the
traced lane and reasons from `UNDERLAY_BRIEF` ("NAMES GO IN THE CLEAR SPACE … to the left
and to the right of it"). The figure lane arrived later with the opposite instruction —
`FIGURE_BRIEF`: "the flanks are not where the names live … find the PALE PAPER inside the
picture" — and nobody reconciled them. A figure is **never traced**, so its box is not a
measurement: it is the constant `figureBox()`, 84% of the canvas, handed out before the
picture exists. Calling that solid did not make the check strict, it made it unfalsifiable.

So a figure is now `fill` (near and inside, never crossed) and a traced form keeps `solid`.
The lane is carried in `Underlay { box, traced }`; `isTraced` owns the defaulting, because
getting it backwards declares every pre-figure-lane form drawing unmeasured.

Removing the obstacle exposed a second contradiction of the same shape: `repairLabels`
allowed a name 40 units off-canvas against the audit's 8, so it filled seats the audit then
billed to empty. The rule is now _do not leave a name further out than you found it_.

Measured over the 238 cached drawings — kept defect score 676 → 589, `label-on-ink` 86 → 75,
`off-canvas` 76 → 56 (of which the repair's own doing 35 → 5). On `df62ce29a563` both figure
beats are clean and the three surviving `label-on-ink` are on blank-board beats, which is
correct.

## The tools, and what each costs

```
npx tsx packages/planner/src/markcheck.mts cache            # 238 drawings, cover/shape/fill, free
npx tsx packages/planner/src/markcheck.mts <lesson.json>    # per beat, underlay passed through
npx tsx packages/render/src/fillcheck.mts <dir>/storyboard.json    # fill = held x cover, per scene
npx tsx packages/planner/src/routecheck.mts <lesson.json>         # ~$0.02, the art director's routes
npx tsx packages/pipeline/src/sbjson.mts <lesson> <dir> explainer  # compile a board, free
npx tsx packages/pipeline/src/drawsheet.mts <dir> "<instruction>"  # ~$0.02/drawing, before/after PNGs
npx tsx packages/render/src/frames.mts <dir> /tmp/frames           # frames, once there is an out.mp4
```

`routecheck` hydrates the keyvault as of `8cb712f`. Before that it printed "the router did
not run — no key, or nothing routable in this lesson", which reads like a verdict about the
lesson and is not.

## The cast recipe, and the four traps in it

```
npx tsx apps/cli/src/index.ts teach "Why do heavy and light objects fall at the same time" \
  --preset explainer > /tmp/cast.log 2>&1
```

1. **`--preset explainer` is not optional.** The CLI with no flags is `standard` +
   `accumulate` — a 4448×2908 canvas. The studio is `explainer` + `wipe` — 1280×895. Gate
   1's whole arithmetic ("under `wipe` the camera is fitted to the ink") is wipe-specific,
   so a measurement taken at `accumulate` answers nothing. This cost one wasted cast
   (~$0.70) on 2026-08-27. The CLI flag is a faithful reproduction of the studio path, not
   an approximation: `/api/generate` applies `...studioFormat(fields.preset)`, which returns
   `{ preset: 'explainer' }` and nothing else.
2. **The same prompt resumes the same project id, and the lesson stage is cached.** A code
   change to anything the lesson stage does — the art director included — is invisible
   without a `STAGE_CODE_VERSION.lesson` bump, and the run will quietly serve you the old
   lesson. That is what `b9ecc82` is. Read the header of `pipeline/src/keys.ts` first: the
   test is whether the stage yields a different artefact _for identical inputs_.
3. **Do not pipe the cast through `| tail -N`.** It buffers everything until the process
   exits, so there is no progress and no way to see which stage is running. Redirect to a
   file and `grep` it.
4. **Expect it to block at `check`.** Today it blocks on `misconception-cut` (gate 8). The
   storyboard is written before that stage, so `fillcheck` and `markcheck` still work.
   `--degrade` renders anyway and records the defect instead of blocking — use it when you
   want frames, never when you want to know whether the gate passes.

## Traps carried forward from the last handoff, all still live

- **`BRIEF_VERSION` is hashed for all three drawing lanes at once** (`drawKey`). Do not bump
  it for a change to one brief — the brief's own text is in the key. Both halves are pinned
  in `packages/planner/test/draw-anthropic.test.ts`.
- **`thin-card` must not open the critic's gate.** Told, never bought. See Task B.
- **The four pinned storyboard hashes** (`packages/planner/test/pinned-hashes.test.ts`) must
  not move for a brief change. If one moves, read that file's header before re-pinning — it
  involves looking at frames. Task A2 is the one change here likely to move them.
- **Do not edit the `standard` preset in place.** New behaviour arrives as a new preset or a
  new default selection.
- **`fillcheck`'s `cover` is a union of bounding boxes**, so a long diagonal line counts as
  a full box of content. Anything that raises the mean without a frame to show for it should
  be assumed to be gaming the metric.
- **`AUDIT_VERSION` is at `audit/v5`** and gates only the _correction_ cache, not the
  drawing cache.
