# PLAN-RECALL-FIX — finish the recall feature so strict-gate generation unblocks

**For the implementing agent.** This plan was written after a full diagnosis; the root
cause is settled, do not re-derive it. Every file:line reference was verified on branch
`visuals-morph-density` on 2026-08-25. Read the referenced code before editing it — the
line numbers will drift, the anchors (function names, comments) will not.

## The failure this exists to fix

Project `deb81002b073` ("Why do heavy and light objects fall at the same time", 10 beats,
lesson route, accumulate board, 16:9) fails the strict quality gate at storyboard-compile
time with 8 problems in 3 checks. The full error text is preserved in
`projects/deb81002b073/meta.json` (`error` field). Summary:

- **6 × ink-on-ink**: recap elements `b9_v0_box-pull`, `b9_v0_label-pull-1/2`,
  `b9_v0_box-inertia` written through beat 3's `b3_v0_large-box` and
  `b3_v0_large-box-label`.
- **1 × realized-layout**: `b9_v0_label-pull-2` shrunk 26 → 22 units, 9.8px at the recap
  camera's zoom (1.2124), under the 10px floor (`MIN_GLYPH_PX`,
  `packages/render/src/boardcheck.ts`).
- **1 × vacant**: per-scene bbox fill of s1 at 10.7% against the 11% per-scene floor
  (`packages/render/src/compile.ts`, the vacancy gate ~line 678; mean fill 26.2% passes
  its 18% floor).

## Root cause (settled — do not re-litigate)

The planner's **recall** feature is half-implemented. The _decision_ half works; the
_build_ half was never written.

1. `findRecall` (`packages/planner/src/refer.ts:355`) correctly decided the recap
   (beat 9) repeats ≥3 names the board already carries, and assigned it **beat 3's cell**
   as host. Design intent, per that file's own doc comment: _"the recap does not draw its
   picture at all: it circles the names where they already are"_, under the recap's
   whole-board pull-back camera (`referTo`, refer.ts:325 keeps the recap's own wide shot).
2. `compile.ts:325` puts the recall into the `shares` map, so `board.cellOf(9)` returns
   beat 3's cell. This half works: the bands machinery even reserved a caption band for
   beat 9 in the host cell (verified: `b9_idea` sits exactly at band 1 of beat 3's text
   zone).
3. `compile.ts:396–397` passes the decision to the builder as
   `...{ refers: ... }` / `...{ recalls: ... }` — **but `BeatContext`
   (compile.ts:821) declares neither field, and `buildBeat` never reads them.**
   TypeScript said nothing because excess-property checks do not apply to spread
   properties. So `buildBeat` built the recap exactly as if nothing had changed: full
   drawing, notes, labels — into beat 3's occupied cell.

That one gap explains 7 of the 8 problems directly: the 6 overlaps are the recap's
figures landing in beat 3's figure area, and the 9.8px label exists only because the
recap wrote _new_ cell-sized text that is then judged under its own wide (zoom 1.21)
camera. The vacant s1 is independent (Task 4).

Feature history: the recall/referral code landed wholesale in commit `089d3e3` ("Save the
launch build where the agents left it"); the consuming half never existed in any commit
(`git log --all -S recalls` confirms). The `refers` (picture-referral) sibling on line
396 is dead the same way — see Task 2.

---

## Task 1 — consume `recalls` in `buildBeat` (the core fix)

**File: `packages/planner/src/compile.ts`** (everything in this task is one file, plus a
type import).

### 1a. Declare the fields

Add to `BeatContext` (compile.ts:821):

```ts
/** This recap circles names already on the board instead of drawing its picture. */
recalls?: Recall;
/** This beat's picture is an earlier beat's picture. NOT YET CONSUMED — see Task 2. */
refers?: Referral;
```

Import `Recall` and `Referral` from `./refer.js` (both are exported).

### 1b. Remember what the board has written

The recap needs to map each recalled _name_ to the element id of the label already
carrying it. Extend `BoardMemory` (compile.ts:719):

```ts
/** Every persistent text element any beat has written, in write order: id + normalised name. */
written?: Array<{ id: string; name: string }>;
```

Populate it in `compileLesson`'s `beats.map(...)` loop (compile.ts:382–406), right after
`buildBeat` returns: for each built element with `type === 'text'` and a non-empty
`nameOf(el.text)` (import `nameOf` from `./refer.js`), push `{ id: el.id, name }` onto
`memory.written`. The loop is sequential, so by the time beat 9 builds, beats 0–8 are all
recorded. (Do NOT record inside `buildBeat` for the recall beat itself — record after
build, which naturally excludes it.) Heed the comment at compile.ts:366–379 about
written-and-never-read `BoardMemory` members: this one IS read, by 1c, in the same
change.

### 1c. Build a recall recap as circles, not ink

In `buildBeat` (compile.ts:854), when `ctx.recalls` is set:

- **Keep**: the caption (`eid('idea')`), notes, title rule, vocabulary terms — the bands
  machinery already reserved the recap's band inside the host cell, so these are safe
  (verified against the failing storyboard's geometry; the only thing they touch is the
  host's title rule, a `path`, which the ink-on-ink sweep exempts by type).
- **Skip entirely**: the `figures.forEach(...)` loop — wrap it in
  `if (!ctx.recalls) { ... }`. Note the `recapChain` branch (compile.ts:1061) and the
  "draw the idea big" fallback below it both require `!figures.length`, so with figures
  present-but-skipped they are naturally unreachable — but add `&& !ctx.recalls` to both
  guards anyway, so a recall recap with zero figures cannot fall into them either.
- **Add instead**: one circle per recalled name, in `ctx.recalls.names` order:

```ts
ctx.recalls.names.forEach((name, k) => {
  const hit = (ctx.memory.written ?? []).find((w) => sameName(w.name, name));
  if (!hit) return; // findRecall matched on lesson marks; a miss here is a drift — log it
  const circle = makeEmphasis(eid(`recall${k}`), hit.id, 'circle', {
    enter: { at: Math.min(0.85, 0.2 + k * 0.12) },
  });
  circle.enter.cue = name; // land on the spoken word; `at` above is the fallback
  elements.push(circle);
});
```

Use the existing `makeEmphasis` (`packages/planner/src/elements.ts:624`) — its
placeholder `at` box is correct; the visuals stage resolves the circle around the target
(`packages/visuals/src/resolve.ts:1007`) and the camera resolves its bounds via the
target (`packages/core/src/camera.ts:179`). Import `sameName` from `./refer.js`. Log a
`log.warn` for any name that finds no written element (defensive; `findRecall` guarantees
the names were matched against the lesson's marks, and drawing labels become text
elements, so a miss means the two passes drifted).

Lifetime is already handled: `compile.ts:533` (`needs(el.targetId, i)`) extends emphasis
targets, and under accumulate the targets are `persist: true` anyway. `makeEmphasis`
defaults `persist: false`, which is right — the circle is an annotation, and the recap is
the last scene.

### Why this resolves the gate

- The 6 ink-on-ink violations: gone — emphasis is not in `boardcheck.ts`'s `SOLID` set
  (line 51), and the recap no longer writes solid ink into the host cell's figure area.
- The 9.8px label: gone — the recap writes no new figure labels at all.
- Camera unchanged: `referTo` (refer.ts:325) already keeps the recap's own
  whole-board shot; circles under a pull-back are the designed payoff.

**Checkpoint**: after the fix, re-check s9's per-scene fill in the vacancy gate output.
It was 16% with the (bad) summary strip; without it, the wide view still holds all the
board's ink and should land ~13–15%, above the 11% floor. If it dips below, say so in
your report rather than silently tuning — that would be a real composition question.

---

## Task 2 — stop the identical bug for picture referrals (`refers`)

`compile.ts:329` adds `referrals.pictures` entries to `shares`, moving a picture-reusing
beat into its host's cell — and `buildBeat` ignores `refers` exactly as it ignored
`recalls`, so such a beat **redraws its full picture on top of the host's**. This lesson
never triggers it (no generated pictures — `subjectOf` requires an underlay prompt +
inkBox), and neither pinned lesson can (compile.ts's own comment: _"Neither shipped
lesson asks for a generated picture at all"_), but any cardiac-style lesson will hit the
same ink-on-ink wall.

Implementing true referral drawing (reuse the host's picture, draw only this beat's
added marks) is **out of scope** — it needs design work in the drawing lane. Instead,
make the wiring honest:

- In `compile.ts`, stop adding `referrals.pictures` entries to `shares` (delete the
  `for (const [beat, r] of referrals.pictures) shares.set(beat, r.host)` line), so the
  beat draws in its own cell as it did before the feature landed. Asset-level dedupe is
  unaffected — `registry.mint` keys on content, so the generator is still paid once (the
  comment at compile.ts:366–379 spells this out).
- Change the log line at compile.ts:306 to say the referral was _found but not applied_
  (build support pending), and leave `refers` declared on `BeatContext` with its comment
  pointing here, so the next implementer wires the build half instead of the decision
  half.

This is behavior-neutral for every lesson without generated pictures, including all
pinned hashes.

---

## Task 3 — bump `COMPILER_VERSION` 4 → 5, and run the pinned-hash protocol

- `packages/planner/src/compile.ts` — bump `COMPILER_VERSION` to 5 and add a paragraph
  to its doc comment **in the established style** (read the existing entries): version 5
  = a recall recap now emits emphasis circles instead of redrawing its picture into the
  host cell. Every cached storyboard whose recap triggered recall has ink-on-ink baked
  in; the bump is what lets a re-run recompile it (`storyboardKey`,
  `packages/pipeline/src/cast.ts:815` keys the cache on this constant).
- Run `packages/planner/test/pinned-hashes.test.ts`. Expected: **unchanged** — the fix
  only alters output for a recap that triggers `findRecall`, and if either pinned lesson
  triggered it, today's pins (taken from the launch build, which already contained the
  broken sharing) would reflect the host-cell placement. If a hash DOES move, follow the
  protocol in that test's header to the letter: `sbhash.mts`/`sbjson.mts` to see what
  moved, render the affected lesson, look at the frames, then re-pin recording old value
  and date in both the test and the `COMPILER_VERSION` comment. Do not silently re-pin.

---

## Task 4 — the s1 vacancy (10.7% vs the 11% per-scene floor)

Independent of the recall bug and unaffected by Tasks 1–3: s1 (the anchor beat, two
hanging bags compared) unions to 10.7% of its view. Mechanics: fill =
`contentFill` (`packages/core/src/camera.ts:546`) = union of visible element bboxes /
view area; the gate is at `packages/render/src/compile.ts` ~678 (mean floor 0.18,
per-scene floor 0.11, both hardcoded there).

This is a diagnose-then-choose task. Do them in order and stop at the first that works:

1. **Check the fit clamp.** `fitDrawing` (`packages/planner/src/drawing.ts:92`) caps
   content blow-up at 1.6×, a cap whose own comment says it exists _"so a two-mark
   drawing is not blown up into a poster"_. Instrument (temporarily) the fit for this
   lesson's beat 1 and see whether `s` hit the cap while the box had room. If it did,
   raise the cap for mark-rich drawings (e.g. 2.0 when the drawing has ≥8 marks — pick
   the threshold from what the corpus's drawings actually carry, and say so in the
   comment, repo style). Then re-run pinned hashes (protocol above — this CAN move them
   if a pinned lesson's drawing sits on the cap) and re-measure per-scene fill across
   `projects/*/storyboard.json` with a throwaway script to confirm no board got worse.
2. **If the fit was not clamped** (the drawing already fills its box height — plausible:
   its elements span ~344 of ~354 available units), the drawing is intrinsically airy
   and no uniform scale can help. Then measure before moving anything: script
   per-scene `contentFill` over all ~27 boards in `projects/` and find where the
   corpus's honest per-scene minimum sits. The 18% mean floor is corpus-documented in
   the gate's comment; the 11% per-scene floor is not. If the measurement shows shipped
   or reviewed boards below/near 11% and a real gap below 10.7%, lower the per-scene
   floor to sit in that gap and write the measurement into the comment — exactly the
   discipline `MIN_GLYPH_PX` and `MIN_INK_SHARE` document. If the measurement does NOT
   support it (shipped minimum is 13.2–13.8% per the existing comments), do not move
   the floor.
3. **Last resort**, only if 1 and 2 both fail: report that s1 needs a denser
   composition (a lesson-authoring matter, not a compiler one) and note that
   `--degrade` would render the film with this one marginal defect recorded. Do not
   default to it silently.

---

## Task 5 — tests

1. **Recall build test** (in `packages/planner/test/`): a synthetic lesson whose recap
   repeats ≥3 label names from earlier beats (mirror `findRecall`'s thresholds:
   `RECALL_MIN = 3` and majority). Compile with `compileLesson`, then assert on the
   recap scene:
   - no elements matching `/^b\d+_v\d+_/` with a type in
     `{text, equation, code, asset, diagram, plot, shape}` (i.e. no solid figure ink);
   - ≥3 `emphasis` elements whose `targetId`s resolve to element ids in _earlier_
     scenes;
   - simple rect arithmetic: none of the recap's remaining solid elements (caption,
     notes) intersects any earlier scene's solid element boxes. (Don't import
     `@inkcast/render` into planner tests — reimplement the 10-line intersect check, or
     put an end-to-end strict-gate test in `packages/render/src/boardcheck.test.ts`,
     which already exercises `compilePlan` with strict gates, using a hand-built
     storyboard shaped like this failure.)
2. **Referral gating test**: a lesson with two beats asking for the same generated
   picture (same `subjectOf`) compiles with both beats in their **own** cells and one
   asset minted — asserting the Task 2 stopgap and the asset dedupe it relies on.
3. Run the full suite: `pnpm -r test`. The pinned-hash test is part of it.

## Verification and the re-run (do this, don't just describe it)

1. `pnpm -r test` green, pinned hashes handled per protocol.
2. Recompile the real failing lesson locally before touching the app: load
   `projects/deb81002b073/lesson.json`, run it through `compileLesson` +
   `parseStoryboard` + the render `compilePlan` with `gates: 'strict'` (mirror how
   `packages/pipeline/src/cast.ts` calls them — a scratch `npx tsx` script is fine).
   Expected: no throw; specifically zero `ink-on-ink`, zero `illegible`, and the vacant
   check clean (or, if Task 4 landed on option 3, vacant is the ONLY remaining item and
   the report says so).
3. Re-run the actual generation for `deb81002b073` **through the cast path** (the web
   UI's generate flow on the project page, which calls `cast()`), NOT `inkcast
rerender` — `rerender` explicitly skips the storyboard stage and would rebuild the
   video from the broken saved `storyboard.json` (`packages/pipeline/src/cast.ts:1331`,
   `skipped: ['ingest', 'lesson', 'storyboard']`). The `COMPILER_VERSION` bump
   invalidates the storyboard cache, so the cast recompiles from the saved
   `lesson.json` without re-spending the lesson-authoring call; voice/visual caches
   rekey only where the recap's geometry changed.
4. Confirm `projects/deb81002b073/meta.json` flips from `status: "failed"` and a video
   file lands. Provider note: Anthropic + fal keys are funded and working; ElevenLabs is
   free-tier and the adapter auto-substitutes a premade voice — expected, not a failure.

## Out of scope

- Implementing real picture-referral drawing (`refers` consumption) — Task 2 gates it
  off honestly instead.
- The Tier-2 vision pass, `--degrade` plumbing, and anything in `apps/web` — the failure
  is entirely planner-side.
- Re-tuning any threshold without the corpus measurement its neighbors all carry.
