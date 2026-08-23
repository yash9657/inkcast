# Handoff — continuing PLAN-AUDIT-CLOSE from Phase 2

Written 2026-08-22, at `693ce46`, branch `visuals-morph-density`. **The plan being
executed is `docs/PLAN-AUDIT-CLOSE.md`** — read it first; it is the work list, the
coverage proof, and the exit criteria. This file only says where execution stands, what
a new session needs to know that the plan cannot, and where the bodies are buried.
The evidence base behind both is `docs/AUDIT-FINDINGS.md` (the audit, run at `5f83bc4`,
plus the W1–W6 waivers now written into its §5).

## Where things stand

**Phases 0 and 1 are landed, tested, and committed** — two commits:

- `e515179` — the audit report, the plan, and the waivers (docs only).
- `693ce46` — all Phase 0/1 code. Whole repo typechecks, `pnpm -r test` green
  (~500 tests), `pnpm lint` clean.

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
  re-checkable facts, currently 12, all green. **The plan (item 0.3) says each Phase
  1–2 item adds its line here as it closes.** Phase 2.1 owes it "one advance table in
  the repo"; 2.1 also closes the `ADVANCE` line the plan pre-announced.
- **The glyph gate.** `packages/visuals/src/glyphgate.ts` + `FontMetrics.covers()`
  (real cmap) in `packages/visuals/src/fontmetrics.ts`; wired at the top of
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

## Next: Phase 2 (plan items 2.1–2.7), then 3 → 4 → 5 → 6 → 7 → 8

The plan is authoritative on scope and done-bars; what follows is session-found
context per item, so the next session does not re-derive it.

- **2.1 One text-metrics stack** — the big one; do it as its own sitting.
  `visuals/src/fontmetrics.ts` moves to `@inkcast/core` (planner cannot depend on
  visuals; the `boardMetrics` move is the template). Then delete, in order,
  re-rendering the corpus after each: `ADVANCE = 0.52` + char-count wrapping
  (`planner/src/elements.ts:148-184` — note `measureText`/`wrapText`/`charWidth`
  there; `makeEquation`'s `texAsGlyphs` estimate also sits on them), equation-box
  estimation, `diagramSize` chars×13, `labelBox`/`labelFootprint`
  (`planner/src/draw-geom.ts` — read `LABEL_SLACK`'s comment in `elements.ts:130-147`
  first, the re-derived value 1.27 is written there), `MATH_ADVANCE`
  (`planner/src/drawing.ts`), the ×0.6/0.62 arrow labels
  (`render/src/compile.ts:1540,1638`), ×0.58 in `render/src/prims.ts:82`, and the
  chars×k inside `planner/src/draw-audit.ts:196-204`. Unify `FONT` with `TYPE_SCALE`
  — **but read the long comment above `FONT` in `elements.ts` first: making them
  equal was tried twice and reverted (`45d4ff9`); they are different units related by
  `TYPE_RATIO`. "One catalogue imports the other" means the ratio discipline, not
  equality.** `planner/test/pinned-hashes.test.ts` hashes WILL move: re-pin with the
  diff in front of you and the reason in the test header (the draw-key re-pin in
  `draw-anthropic.test.ts` and the `longitude/short` re-pin are the templates —
  never re-pin blind).
- **2.2 One style table** — `render/src/palette.ts` + `visuals/src/style.ts` →
  `@inkcast/core`; kill the `#d7263d` vs `#2f6fed` accent split by _opening frames of
  both_ before deciding; add the mirror test in pipeline (the `CAST_POSES` pattern).
- **2.3 Board assertions** — in `render/src/compile.ts` `compilePlan` (per-scene AABB
  sweep, `rectContains(viewRect(camera), elementBounds(el))`, dwell). Block through
  `gate(ctx.gates, ...)` — the plumbing already exists (`Ctx.gates`). Also add
  `.finite()` and positive w/h to the `Box`/`Point` zod in `core/src/storyboard.ts`.
- **2.4 Min glyph height post-zoom** — measure the corpus first, pick the number that
  fails the illegible and passes the shipped (~14px, not the spec's 18), write the
  reasoning down. Needs 2.7's realized-layout report for the runtime shrink half.
- **2.5 Pan speed** — `resolveFraming` pass 3 in `core/src/camera.ts`; pick
  `MAX_UNITS_PER_SEC` by watching the fastest existing walk; pin in `camera.test.ts`.
- **2.6 Fill gate** — promote `reportFill`'s existing thresholds (`core/src/camera.ts:611-632`,
  computed at `render/src/compile.ts:514-515`) to `gate(...)`: mean < 25% or any
  scene < 14%. The 17% photosynthesis board must fail; `final-169` (47.6%) must pass;
  the override must land in `pipeline.json`. W2 (in AUDIT-FINDINGS §5) is the
  argument for these numbers over the spec's band.
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
