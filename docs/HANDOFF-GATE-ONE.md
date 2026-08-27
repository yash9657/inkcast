# Handoff — gate 1's tail: three tasks, in order, with what each costs

Written 2026-08-27 for a session starting with no context. It is self-contained: read this,
then `docs/STATUS.md`'s last section (2026-08-26) if you want the arithmetic behind a number.
`docs/HANDOFF-WATCHABILITY.md` is the wider plan's handoff and everything in it still stands.

## Where things are

Branch `visuals-morph-density`, HEAD `08b680a`, tree clean, `pnpm -r test` **1,240 tests, 0
failures**, `pnpm -r typecheck` clean. PLAN-WATCHABILITY phases 0–5 are all landed. Of its
nine acceptance gates, seven pass, gate 6 is pinned-not-verified, and gate 1 is the one this
file is about.

**The acceptance film is `projects/f3ac9c760194`** — 78.65s, 8 scenes, strict-clean QC. It is
still the film cast on 2026-08-25; nothing has re-rendered since, so its `out.mp4` and its
`lesson.json` marks are the _old_ drawings.

## The one mechanical fact to hold on to

Under `wipe` the camera is fitted to the ink, so what a card carries is exactly

    fill = safe area (76.5%) x shape match x cover

— `shape match` is how close the drawing's bounding box is to 16:9, `cover` is how much of
that box the marks' own boxes fill. **The size a drawing is authored at cannot appear in that
product**: scale it up and the camera pulls back by the same ratio. So "draw it bigger" is
never the fix; more parts, or a picture, is. `cardFill` in `packages/planner/src/draw-geom.ts`
computes it from the marks before anything is drawn, and `markcheck.mts` prints it.

The bar is now **≥ 35% mean, no scene under 14%** (`docs/PLAN-WATCHABILITY.md` item 1),
re-derived from four lessons: gradient-descent 60.9%, hash-map 43.2%, longitude 35.8%, this
film 29.5%. The film fails it, and the beats that fail are its five mark cards at 13–23%.

## Task 1 — route a two-object beat to a picture (the actual lever, ~$0.02 to test)

This film's two figure beats carry **44% and 36%** of the frame where its mark beats carry
**18%**, and `MAX_FIGURES` is 4 with 3 used. A beat whose whole content is two things being
compared — a ball and an apple, one brick and two bricks — has nothing for marks to fill a
card with, and is the beat that should get a generated picture.

- Edit the brief in `packages/planner/src/artdirect.ts` (one paragraph; the routing is a
  single forced tool call per lesson, `figure | form | marks` per beat).
- Harness: `npx tsx packages/planner/src/routecheck.mts projects/f3ac9c760194/lesson.json`
  (claude-sonnet-5, ~$0.02). It prints the route per beat.
- **Check the count, not the prose.** This brief has failed four times by reasoning its way
  to a picture in `why` and then writing `marks` anyway — that is why it currently states the
  budget as _at least two and at most four_. Today's split is `3 figure, 5 marks`; the
  anchor (hands/ball/apple), the tug-of-war and the bricks are the candidates to move.
- It costs one image per beat it moves (fal, ~$0.003 each) and it raises the film's mean by
  roughly 4–5 points per beat moved, on this film's own figure-beat numbers.

## Task 2 — settle a contradiction the sheet can now see (free to decide)

Run `npx tsx packages/planner/src/markcheck.mts projects/f3ac9c760194/lesson.json`. The three
figure beats report **ten `label-on-ink` findings** — every name written inside
`figureBox()`, because `underlayInk()` treats the whole figure box as ink end to end.
Meanwhile `FIGURE_BRIEF` in `draw-anthropic.ts` explicitly tells the author to put names in
the picture's clear areas and _not_ in the margin. So the critic is being paid to move marks
the brief asked for.

One of the two is wrong. Nothing regressed here — `lessonDrawingDefects` and the critic have
always passed the underlay, and `STATUS.md` records four of these as standing advisories on
the film — the sheet simply could not see them until markcheck started passing the underlay
through. Before choosing, read the `leader-misses` paragraph in `draw-audit.ts`'s header: it
is the same argument (a box is not ink) about a check that was removed for it, which is a
strong hint that the audit is the over-reporting side.

## Task 3 — cast it again, and look at it (~$0.70)

Everything in the 2026-08-26 write-up came from compiling `lesson.json` and from
`drawsheet.mts`. Nothing has been rendered, so nobody has seen a fuller card _as a film_.

Cast the same prompt through the local studio with no flags:

> Why do heavy and light objects fall at the same time

**Trap: cast fresh, do not re-render `f3ac9c760194`.** A re-render serves the marks in that
project's own `lesson.json`, which are the old drawings; the new ones live in the machine
cache under the new brief's key and only a fresh lesson run reaches them.

That one cast does three jobs: it re-measures gate 1 against 35%, it answers gate 6 —
whether a second film lands within ±5% of the re-pinned 12.16 delivered letters a second,
which is the last genuinely unknown thing about this plan — and it produces frames. Then:

```
npx tsx packages/render/src/fillcheck.mts projects/<id>/storyboard.json   # per-scene table
npx tsx packages/render/src/frames.mts projects/<id> /tmp/frames          # then open them
```

## The tools, and what each costs

```
npx tsx packages/planner/src/markcheck.mts cache            # 217 drawings, cover/shape/fill, 50ms, free
npx tsx packages/planner/src/markcheck.mts <lesson.json>    # per beat, with the underlay passed through
npx tsx packages/pipeline/src/sbjson.mts <lesson> <dir> explainer   # compile the studio's board, free
npx tsx packages/render/src/fillcheck.mts <dir>/storyboard.json     # fill, held and cover per scene
npx tsx packages/pipeline/src/drawsheet.mts <dir> "<instruction>"   # ~$0.02 a drawing, before/after PNGs
npx tsx packages/planner/src/routecheck.mts <lesson.json>           # ~$0.02, the art director's routes
```

`drawsheet` on an instruction the machine has already drawn is free (author and correction
are both cached), so the frames behind the 2026-08-26 numbers can be regenerated for nothing.

To reproduce the 29.5% splice measurement: for each `draw` intent with no `underlay`, read
`~/.inkcast/cache/drawings/<drawKey(intent.describe)>.json` into `intent.marks`, write the
lesson out, then `sbjson … explainer` + `fillcheck`. Ten lines; the throwaway script that did
it was deleted on purpose.

## Traps, all of them paid for once already

- **`BRIEF_VERSION` is hashed for all three drawing lanes at once** (`drawKey`). Do not bump
  it for a change to one brief — the brief's own text is in the key, which is what threw away
  the blank-board drawings on 2026-08-26 while leaving every form drawing cached. Both halves
  are pinned in `packages/planner/test/draw-anthropic.test.ts`.
- **`thin-card` must not open the critic's gate.** It is told, never bought: the first eight
  measured correction calls it would have paid for improved nothing and made two drawings
  worse. `INKCAST_DRAW_FIX=all` is how to test a `FIX_BRIEF` that claims to earn them.
- **The four pinned storyboard hashes** (`packages/planner/test/pinned-hashes.test.ts`) must
  not move for a brief change; they compile without the drawing lane, so they will not unless
  something meant to be additive is not. If one moves, read that file's header before
  re-pinning — it involves looking at frames.
- **`fillcheck`'s `cover` is a union of bounding boxes**, so a long diagonal line counts as a
  full box of content. Anything that raises the mean without a frame to show for it should be
  assumed to be gaming the metric.
