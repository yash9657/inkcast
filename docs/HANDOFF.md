# Handoff — 2026-07-29

Session state, not design. `PIPELINE.md` is the durable architecture and `STATUS.md` is
the last verification report; this file exists so a session starting cold knows what
changed underneath both of them, and which traps are waiting.

Delete or rewrite this once the next piece of work lands. It goes stale by design.

## Where the code is

Branch **`visuals-morph-density`**, three commits on top of `e95258b`. Everything is
local; nothing is pushed. In order, by subject:

    Keyvault: one vault, shared by the CLI and the studio
    Morph the anchor into the plot, and make cells frame-shaped
    docs: the staged-pipeline architecture, and a handoff

Each message carries the reasoning for its own change; read them before the diffs.

`pnpm lint` clean, `pnpm -r typecheck` 0 errors across 9 projects, `pnpm -r test`
**500 pass / 0 fail**. The benchmark renders in both aspects at the same durations as
before (104.667 s / 1920x1080, 61.5 s / 1080x1920).

## Read STATUS.md with this correction

`STATUS.md` is dated 2026-07-28 and **three of its listed defects are now fixed.** A
session that trusts it will go hunting for bugs that are gone:

- "**Two vaults**" (line ~168) — fixed. The studio's duplicate AES-GCM implementation is
  deleted; both surfaces use `@inkcast/keyvault`. Verified end to end: a key set with
  `inkcast keys set` is visible at `/api/keys` with `source: "vault"`.
- "**The anchor draws a second hillside**" (line ~153) — fixed. The anchor annotates the
  hook's hill, and the hill now morphs into the plot in place.
- "**Mean content fill 48% / 53%**" (line ~96) — now 52% / 56%, and no scene below 32%
  (two were at 16% mid-change).

Everything else in `STATUS.md` still stands, including the two big ones: `visuals.json`
is written and never read, and `illustration` never resolves without a key.

## Traps

**This repo is `inkcast`, at `~/code/inkcast`.** The previous session was launched with
its working directory set to the sibling `finito` checkout and nearly edited the wrong
project. Check `git remote -v` before believing you are in the right place.

**`teach <topic> --lesson <file>` silently ignores the file.** Passing both a topic and
`--lesson` derives a lesson from the topic instead, and with no Anthropic key that
produces a ~20-second stub. To render the benchmark, use `cast`:

    INKCAST_PROJECTS=/tmp/verify node apps/cli/bin/inkcast.mjs \
      cast examples/lessons/gradient-descent.lesson.json \
      --project bench --force --json

Add `--short` for the 9:16 pass. This is worth fixing: the flag combination should
either honour `--lesson` or refuse.

**`next build` over a dirty `.next` still breaks.** `rm -rf apps/web/.next` first, as
`STATUS.md` says.

**Judge output from a keyed render, not the default.** The last quality review was made
against `providers: planner heuristic`, i.e. the pedagogy was written by
`lesson-derive.ts` rather than by a model. The 104 s benchmark only holds together
because its lesson is hand-authored; a topic-only run with no key degenerates. Set an
Anthropic key before concluding anything about whether the concept lands.

## Deliberate stopgaps

**`BECOMES_A_PLOT`** — `packages/planner/src/compile.ts:230`. A regex over the narration
that decides which beat turns the concrete drawing into a plot. It works on the shipped
lesson and is fragile on anything else. It is meant to be deleted in step 6 of
`PIPELINE.md`, once `analogy.maps` makes that beat derivable instead of detected. Do not
build on it.

**Frame fill is measured as a proxy.** `contentFill` in `render/src/camera.ts` is the
union of element _bounding boxes_ over the view area. A single hand-drawn line has a
large box and little ink, so the number rewards big sparse shapes. It is useful for
catching regressions and misleading as a target — read frames as well.

**One legacy vault may still exist on a machine.** `<repo>/.inkcast/keys.json` from the
pre-unification studio is no longer read. `vaultInfo()` reports it as `legacyPath` and
the settings page says any key saved only there must be pasted again. There is no
migration and deliberately so: reading it would mean keeping ~150 lines of retired
crypto alive.

## What changed, by area

**Keyvault.** Deleted `apps/web/app/api/keys/_vault/` (~1,145 lines duplicating
AES-GCM); the studio now delegates to `@inkcast/keyvault` through
`apps/web/app/api/keys/_store.ts` (stateful: memoised hydration, provenance) and
`_wire.ts` (pure: status mapping, redaction, probe-verdict prose — unit tested without a
vault). New public API on the package: `ProviderStatus` gained `availability`
(`env` / `stored` / `locked` / `unreadable` / `absent`), `envVar`, `length`,
`updatedAt`, `lastValidatedOk`, `shadowedByEnv`; plus `storageInfo()` and
`vaultVerify()`.

One deliberate behaviour change: **`listProviders()` no longer calls a locked or
tampered entry "configured".** It is documented as "true when `getKey()` would return
something", and `getKey()` returns undefined there — so the old answer contradicted its
own contract, and it is what let a stored key look usable while every render silently
ran locally. The test that pinned the old behaviour was updated rather than worked
around.

**Morph.** New `Morph` in the IR (`core/src/storyboard.ts`) with `fromId`, timing,
`retire` and `retires`. Baked per output frame in Node — same pattern as `Motion` — in
`render/src/compile.ts` (`bakeMorph`), applied in `render/src/page/runtime.js`. Two
properties worth not breaking: source and target are resampled **by arc length** so
points travel the short way (index matching makes the hill slide sideways instead of
bending), and **one RNG seed is held across every frame** or the stroke boils.

**Density.** Cells in `planner/src/regions.ts` are now fixed at the frame's aspect and
regions are sized to hold them, rather than a fixed region being divided into cells of
whatever shape fell out. The zoom cap became "never tighter than one cell", which fills
the frame by construction. Beats that share a cell divide its caption zone into bands
reserved up front, so a caption never lands on a drawing a later beat has not written
yet.

The remaining fill ceiling is geometry, not a bug: two frame-shaped panels side by side
make a 2:1 union that letterboxes in a 1.78:1 frame, so mid-region shots dip whatever
the grid is.

**Plot labels.** `render/src/plot.ts` now suppresses a curve label when the plot has a
`yLabel` and exactly one curve — the benchmark was labelling the axis "height" and the
trace "loss" and leaving the learner to guess whether those were the same measurement.
With several curves the labels tell the traces apart and are kept.

## Open questions, unanswered

These were put to the user and are still open. Step 3 of `PIPELINE.md` should not start
before the second one is settled.

1. **The cost target.** `$0.20/min` was set when zero-key was the headline. With keyed
   operation as the product it needs restating rather than quietly breaking.
2. **9:16 and equations.** A typeset equation has a fixed aspect and a vertical frame
   has no width. Either equations get their own layout rule for `9:16` or they break
   across lines.
3. **Which part of Golpo is the target** — its look (crisp vector, character-driven) or
   its coherence (every beat serving one insight)? If mainly coherence, step 6 outranks
   steps 2 and 3 and the order should change.
