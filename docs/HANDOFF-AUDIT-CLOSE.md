# Handoff — continuing PLAN-AUDIT-CLOSE from Phase 2.4

Written 2026-08-22, at `693ce46`, branch `visuals-morph-density`; updated 2026-08-23
after 2.1 landed. **The plan being executed is `docs/PLAN-AUDIT-CLOSE.md`** — read it
first; it is the work list, the coverage proof, and the exit criteria. This file only
says where execution stands, what a new session needs to know that the plan cannot, and
where the bodies are buried. The evidence base behind both is `docs/AUDIT-FINDINGS.md`
(the audit, run at `5f83bc4`, plus the W1–W6 waivers now written into its §5).

## Where things stand

**Phases 0, 1, 2.1–2.3, 2.5, and 2.6 are landed, tested, and committed:**

- `e515179` — the audit report, the plan, and the waivers (docs only).
- `693ce46` — all Phase 0/1 code. Whole repo typechecks, `pnpm -r test` green
  (~500 tests), `pnpm lint` clean.
- 2026-08-23 — **2.1, the one text-metrics stack** (the plan's progress block has the
  full inventory). `fontmetrics.ts` + `HAND_FONTS` now live in `@inkcast/core`; the
  planner measures with the real advance table (`handMeasure`, `setPlannerHand` called
  by `compileLesson`/`heuristicPlan`, default marker elsewhere); every
  chars-times-a-constant estimator is deleted (`ADVANCE`, `LABEL_SLACK`, `texAsGlyphs`,
  chars×13, ×0.6/×0.62, ×0.58); `texBox` is the one TeX estimator; render `Ctx` carries
  `hand`/`tracking`. All four pinned hashes re-pinned WITH frames rendered and compared
  (the reasoning lives in `pinned-hashes.test.ts`'s header — longitude's latitude
  headline lettering on one line instead of "…latitude / for free" is the visible win).
  Two fixtures were recalibrated because honest footprints changed the weights'
  arithmetic — `repair-log.test.ts` (label footprint 179→136 units made the escape
  affordable) and `draw-critic.test.ts` (the repair now genuinely fixes stacked labels,
  so "worse" is a broken-word defect instead). `auditcheck.mts` gained four A-4 lines
  and its S4-b line follows the moved file.
- 2026-08-23 — **2.2, one style table.** Colours live in `core/src/palette.ts`
  (`Palette`/`paletteFor`/`toneInk`, plus `highlight`); `render/palette.ts` re-exports
  and keeps pen personality; `visuals/style.ts` keeps per-style personality and
  composes colours from `paletteFor` — its four per-style colour sets are deleted. The
  blue accent `#2f6fed` won on frame evidence (the plot-role remap in
  `render/plot.ts` meant visuals' red `#d7263d` never reached a shipped pixel; the
  red is deleted, not aliased). The visuals mono accent→ink collapse died too — the
  film's mono accent was always `#39434f`. Mirror test:
  `pipeline/test/styles.test.ts`; S5-c line in `auditcheck.mts`. Dark-chalk-style
  colour packs are deliberately deferred to 7.3's StylePack loader.
- 2026-08-23 — **2.3, the board assertions.** `render/src/boardcheck.ts` (ink-on-ink
  sweep, off-frame check, overrun + advisory dwell), run by `compilePlan` on every
  plan through `gate(...)`; the cue-at-fraction-0 settle clamp in `itemsFor`;
  `.finite()`/positive extents on `Box`/`Point`. The scoping decisions (persistent
  solid ink only; one drawing's parts exempt — the `_v<n>_` id convention; plots and
  transients never settle-clamped) are argued in the module header and were learned
  from the wipe fixture's failures, not guessed. Red tests in
  `render/src/boardcheck.test.ts`; nine projects compile strict-clean.
- 2026-08-23 — **2.6, the fill gate — at a re-derived floor (mean < 18% / any scene
  < 11%), not the plan's 25%/14%.** After 2.1, shipped longitude re-measures 20.3%/
  13.8% and photosynthesis 21.8%/13.2% — bbox fill cannot separate them, so the
  plan's numbers would block a shipped lesson. Argued in W2 (updated) and the plan's
  progress block. `--degrade` overrides now persist: `plan.problems` →
  `RenderResult.problems` → `pipeline.json` `render.problems` (inherited on cached
  renders). This plumbing is also what 3.4 will ride.
- 2026-08-23 — **2.5, pan speed.** `resolveFraming` pass 3:
  `transition = max(floor, dist / viewWidth / MAX_VIEWS_PER_SEC)` (2.4 views/s at the
  incoming zoom — just above the corpus's fastest walk, so nothing reviewed slows),
  capped at 2.5s. Pinned in `camera.test.ts`; S7-b auditcheck line.

The plan's own header carries a progress block saying the same thing; keep that block
current as phases land. Per-phase detail also lives in Claude's project memory
(`audit-close-progress`), but this file and the plan header are the durable record.

**Verified end to end:** a strict no-key cast of the shipped longitude lesson renders
clean — `projects/audit-strict-longitude/pipeline.json` records `"gates": "strict"`
with no gate problems. That project directory is disposable evidence, not a fixture.

## What Phase 0/1 built (the parts Phase 2+ will touch)

- **The gate.** `packages/core/src/gates.ts` — `GateMode = 'strict' | 'degrade'` and
  the `gate(mode, message, warn)` helper: throws under `strict` (message names the
  `--degrade` escape), warns otherwise. **`cast()`/`rerender()` default to strict;
  stages called directly default to degrade** (`undefined` mode = today's behaviour).
  Threaded: `CastOptions.gates` → `narrate`/`resolveVisuals`/`render` opts →
  `CompileOptions.gates` in the renderer. CLI flag `--degrade`
  (`apps/cli/src/main.ts`). The posture is recorded in `pipeline.json` as `gates`.
  **Every new Phase 2 assertion should block through `gate(...)`, not a bare throw**,
  so degrade stays an escape and the message format stays uniform.
- **The harness.** `packages/pipeline/src/auditcheck.mts`
  (`npx tsx packages/pipeline/src/auditcheck.mts`) — grep-level pins of the audit's
  re-checkable facts, currently 17, all green. **The plan (item 0.3) says each Phase
  1–2 item adds its line here as it closes.** 2.1's four A-4 lines are in.
- **The glyph gate.** `packages/visuals/src/glyphgate.ts` + `FontMetrics.covers()`
  (real cmap) in `packages/core/src/fontmetrics.ts` (moved there in 2.1); wired at the top of
  `resolveVisuals`. Tests in `packages/visuals/test/glyphgate.test.ts`.
- **Math routing.** `sniffMath` + promotion in `packages/planner/src/elements.ts`
  (`makeText` now returns `TextElement | EquationElement`); briefs advertise the
  ninth mark in `draw-anthropic.ts`; `'marks'` is in `STAGE_OWNED`
  (`planner/src/schema.ts`). The draw-key pins in
  `planner/test/draw-anthropic.test.ts` were deliberately re-pinned
  (`9a1f337a8ecd8a07` / `3d94a24a9cc2b943`) because the brief text is the cache key.
- **Alignment honesty.** `mapToExpected` returns `{words, fraction}`;
  `MIN_ALIGN_FRACTION = 0.5` floor in `packages/voice/src/align.ts`; fraction in the
  timing sidecar (`alignFraction`) and in voice problems.
- **Cue misses.** `ResolveCuesResult.dominantMisses` in `packages/voice/src/cue.ts`,
  gated in `narrate.ts`; decorations still only warn.
- **The critic.** `reviseDrawing` skips-with-warning when no preview renders
  (`planner/src/draw-critic.ts`); it never revises blind.

**Deliberate deviations from the plan's letter** (argued in the plan's progress block):

1. `makeText` promotes math with a warn in _both_ modes — no strict error. The
   promotion is the fix; a promoted string that fails to typeset still hits the strict
   equation gate downstream.
2. The missing-font gate has no direct both-behaviours test — the font search paths
   (`defaultFontDirs`/`fontSearchPaths`) always find the repo's vendored fonts and
   cannot be isolated in-tree. The gate call is trivial; it fires in real degraded
   environments.
3. Drawing-lane problems (the critic's skip, audit defect lists) reach persisted
   `problems[]`/`qc.json` only in Phase 3 (plan item 3.4); today the skip is a
   `log.warn`.

## Next: Phases 2.4 and 2.7 (which close Phase 2), then 3 → 4 → 5 → 6 → 7 → 8

The plan is authoritative on scope and done-bars; what follows is session-found
context per item, so the next session does not re-derive it. (2.2 landed 2026-08-23,
same session as 2.1: colours live in `core/src/palette.ts`, the blue accent won —
the plot-role remap in `render/plot.ts` meant visuals' red never reached a shipped
pixel — and `pipeline/test/styles.test.ts` is the mirror. The plan's progress block
has the inventory; 2.3 landed the same day — `boardcheck.ts`, see above.)

- **2.4 Min glyph height post-zoom** — measure the corpus first, pick the number that
  fails the illegible and passes the shipped (~14px, not the spec's 18), write the
  reasoning down. Needs 2.7's realized-layout report for the runtime shrink half.
- **2.7 Realized-layout report** — the capture page (`render/src/page/runtime.js`,
  shrink floor at `:400`) reports realized boxes back through CDP
  (`render/src/browser.ts`) before frame 0; re-run 2.3's sweeps against them.

## How to verify any phase as it lands

```
pnpm -r typecheck && pnpm -r test && pnpm lint
npx tsx packages/pipeline/src/auditcheck.mts
node --import tsx apps/cli/src/index.ts --lesson examples/lessons/longitude.lesson.json --project <scratch-id>
```

The last line is the strict end-to-end proof (strict is the default; no key needed —
a voice-provider fallback in the output is a provider event, not a gate failure).
Both shipped lessons are `examples/lessons/*.lesson.json`.

## Traps (the plan's own list, plus one earned this session)

All five traps at the foot of `docs/PLAN-AUDIT-CLOSE.md` stand — pinned hashes moving
is the change working; gameable metrics get gamed; no re-prompt loops at gates;
strict surfaces latent corpus defects (budget triage time; `--degrade` exists);
6.1 before 6.2/6.3. Earned this session: **verify coverage claims against the actual
cmap before asserting them in tests** — Shantell Sans genuinely covers bra-ket
brackets (U+27E8/9) and subscript digits but no Greek, the opposite of what you'd
guess.
