# Audit findings — inkcast vs the explainer-pipeline reference spec

> **This file is the 2026-08-22 run and stays that way.** It is the evidence base, and its
> §5 remains the authority on the waivers. The **re-audit (plan item 8.1) is
> `docs/AUDIT-REAUDIT.md`**, run 2026-08-24 at `2abd28d`: 58 PASS, 7 waived, 4 PARTIAL, and
> three new findings. Where the two disagree about a verdict, the re-audit is current. Do
> not edit the verdicts below to match it — a report rewritten to agree with its successor
> stops being evidence of anything.

Run 2026-08-22 at `5f83bc4` (branch `visuals-morph-density`, clean tree), against the
"Explainer Video Pipeline — Architecture Audit Spec" (reference measurements from four
Golpo AI videos). Seven parallel audit passes, every verdict backed by file:line evidence;
no code was modified. Verdicts follow the spec's rubric: a check without evidence is
`UNKNOWN`, an assertion that logs-and-continues counts as absent.

**Headline.** The repo is closer to the spec's reference architecture than the spec
assumes an implementation will be: determinism, caching/invalidation, IR discipline, and
failure-mode honesty are at or above spec. The systematic divergence is the enforcement
posture — quality guarantees are by-construction, offline tools, and test pins, almost
never blocking at render time. One CRITICAL: no glyph-coverage check exists anywhere, so
the spec's D1 defect (math/Unicode mangled through the text path) is reachable and silent,
and two LLM-facing prompts actively steer math toward that path.

## Verdict table

| Check                    | Verdict | Severity | One line                                                       |
| ------------------------ | ------- | -------- | -------------------------------------------------------------- |
| A-1 single IR            | PARTIAL | MINOR    | Two authored IRs by editing altitude; derived artifacts honest |
| A-2 no model coordinates | PARTIAL | MINOR    | Lesson route clean; legacy document route still asks           |
| A-3 solver-owned layout  | PASS    |          | No model determines final position on the product route        |
| A-4 measured text        | PARTIAL | MAJOR    | Final placement measured; every reservation is chars×k         |
| A-5 determinism          | PASS    |          | Architectural, pinned by byte-identity tests                   |
| A-6 narration anchors    | PARTIAL | MINOR    | Fractional+cue anchors resync on re-voice; cue miss only warns |
| A-7 QC patches IR        | PASS    |          | Draw-critic patches marks in lesson.json, re-derives           |
| A-8 append-only          | PARTIAL | INFO     | Wipe preset + morph-retire are measured, camera-consistent     |
| S0-a grounding           | MISSING | MAJOR    | No retrieval; bare topics are parametric-only                  |
| S0-b source refs         | FAIL    | MAJOR    | Sources discarded after lesson generation                      |
| S0-c duration budget     | PARTIAL | MINOR    | Enforced pre-render; no post-synthesis comparison              |
| S1-a plan artifact       | PASS    |          | lesson.json persisted, validated, cache-keyed, editable        |
| S1-b prerequisite DAG    | PARTIAL | MINOR    | DAG as data, validated; ordering authored, not derived         |
| S1-c misconceptions      | PARTIAL | MINOR    | Singular, optional, first trim victim                          |
| S1-d concrete→abstract   | PARTIAL | MINOR    | Mechanized for analogy+plot; prompt-only elsewhere             |
| S1-x thesis/beat time    | PARTIAL | INFO     | One coreInsight with consumers; per-beat time deliberate no    |
| S2-a narration order     | PARTIAL | MINOR    | Co-generated with verbatim-substring constraints               |
| S2-b word budget         | PASS    |          | Checked and enforced at three points                           |
| S2-c TTS normalizer      | PARTIAL | MINOR    | Strong; gaps: ₂-digits, bra-ket, LaTeX leakage                 |
| S3-a schema enforced     | PASS    |          | Forced tool schema + zod reject at every seam                  |
| S3-b IR coordinates      | PARTIAL | MINOR    | Semantic lesson IR / geometric compiler-authored storyboard    |
| S3-c reference graphs    | PARTIAL | MINOR    | Lesson graph gated; storyboard graph warn-only                 |
| S3-d validation failure  | PASS    |          | Bounded retry with errors fed back, honest fallback            |
| S3-e IR persisted/keyed  | PASS    |          | Per-project, diffable, fine-grained invalidation               |
| S4-a distinct solver     | PASS    |          | Code solves, Chromium paints                                   |
| S4-b glyph coverage      | MISSING | CRITICAL | cmap miss → space advance; TeX fallback → handwriting          |
| S4-c collision assert    | PARTIAL | MAJOR    | By construction + corpus tests; no render-time check           |
| S4-d revealed-in-frame   | PARTIAL | MINOR    | True by construction for derived cameras; authored unchecked   |
| S4-e fill gate           | FAIL    | MAJOR    | Advisory warn at <25%; 17% board rendered                      |
| S4-f min glyph height    | FAIL    | MAJOR    | Unchecked; worst case ~10.4px caption on 16:9                  |
| S4-g blocking posture    | FAIL    | MAJOR    | Quality assertions are logs, tests, or manual tools            |
| S4-x canvas extent       | PASS    |          | Computed closed-form from the region grid                      |
| S5-a renderer coverage   | PARTIAL | MAJOR    | Chemistry, circuits, geography, code unserved                  |
| S5-b math path           | PARTIAL | MAJOR    | Engine right; prompts steer math to the text path              |
| S5-c style centralized   | PARTIAL | MAJOR    | Two style systems; accents disagree (#d7263d vs #2f6fed)       |
| S5-d asset caching       | PARTIAL | MINOR    | Exemplary keys; figure raster key lacks style/model            |
| S5-e failure modes       | PARTIAL | MINOR    | All loud; illustrations lack the pose lane's gate              |
| S5.1 routing purity      | PASS    |          | Fixed precedence, no model dispatch; pre-resolution deleted    |
| S5.6 raster alpha        | FAIL    | MINOR    | Multiply-blend substitute; unchecked assumptions               |
| S6-a word timestamps     | PARTIAL | MINOR    | Real per-word timings; cues still fuzzy phrase search          |
| S6-b alignment honesty   | PARTIAL | MAJOR    | Zero-match alignment yields plausible fake timings             |
| S6-c normalizer test     | PARTIAL | MINOR    | Ran live; strong with named gaps                               |
| S6-d duration drift      | PARTIAL | MINOR    | One-time calibration, not per-run measurement                  |
| S6-x audio cache/cloud   | PASS    |          | Key beyond spec; ElevenLabs timestamps native                  |
| D8 fake timings          | PARTIAL | MAJOR    | Count check vacuous on the Whisper path                        |
| S7-a timeline artifact   | PARTIAL | MINOR    | Pure in-memory plan; hash tools instead of persistence         |
| S7-b velocity/zoom caps  | PARTIAL | MINOR    | Zoom clamped to median-relative band; no pan-speed cap         |
| S7-c dwell assertion     | PARTIAL | MAJOR    | Cadence holds, no per-element guarantee; D4 leak paths         |
| S8-a determinism test    | PASS    |          | (= A-5)                                                        |
| S8-b fonts awaited       | PASS    |          | Data-URI embed + document.fonts.ready await                    |
| S8-c per-element seeds   | PASS    |          | FNV(id, kind); morphs hold one seed; no boiling possible       |
| S8-d sharding            | PARTIAL | MINOR    | Parallel frame segments; not independently retryable/cached    |
| S8-e motion blur         | MISSING | INFO     | Single-sample frames, defensibly                               |
| S8-x encoder/idempotency | PASS    |          | Pinned settings; re-run is a state-checked no-op               |
| S9-a QC stage            | PARTIAL | MAJOR    | Gates inside authoring stages; nothing after compile           |
| S9-b tier coverage       | PARTIAL | MAJOR    | Tier 1 ~60%, Tier 2 ~30% (drawings only), Tier 3 0%            |
| S9-c blocking behavior   | PARTIAL | MINOR    | Integrity blocks; quality logs — principled split              |
| S9-d OCR round-trip      | MISSING | MINOR    | Absent; largely unrepresentable defect classes here            |
| S9-e failure granularity | PARTIAL | MINOR    | IR-patching half real; no post-render QC to feed shards        |
| S10-a regen granularity  | PARTIAL | MINOR    | Per-stage/scene/asset incremental; render monolithic           |
| S10-b diff→frame range   | FAIL    | MINOR    | Any change re-renders every frame                              |
| S10-c model-free edits   | PASS    |          | Typed ops + hand-editable JSON, needs-model reported           |
| X-a determinism          | PASS    |          | (= A-5)                                                        |
| X-b cache layers         | PASS    |          | Strongest subsystem audited                                    |
| X-c cost attribution     | PARTIAL | MINOR    | Per-stage lines; drawing/critic calls unbilled                 |
| X-d observability        | PARTIAL | MINOR    | Frames reconstructible; draw-QC reports evaporate              |
| X-e silent defaults      | PARTIAL | MINOR    | Rare and mostly named; two genuinely silent spots              |
| X-f style packs          | PARTIAL | MINOR    | Adding one touches 4+ files across 3 packages                  |
| X-g idempotency          | PASS    |          | Verified end to end with an explicit force escape              |

---

## Invariants

### [A-1] Intermediate representations between LLM output and pixels

Verdict: PARTIAL
Severity: MINOR
Evidence: The verified data-flow graph: `lesson.json` (`core/src/lesson.ts:457-517`,
persisted by `pipeline/src/lesson.ts:39-43`) is authored by LLM or heuristic and carries
model-authored `Mark[]` coordinates for the draw lane plus stage-measured
`underlay.inkBox`, both mutated in place by `drawLesson`
(`planner/src/draw-anthropic.ts:757-795`). `storyboard.json` (`core/src/storyboard.ts:635-646`)
is derived deterministically by `compileLesson` (pinned byte-identical in
`planner/test/pinned-hashes.test.ts`), cache-keyed on `lessonHash`
(`pipeline/src/keys.ts:309-334`), then enriched in place by voice (`durationSec`,
`words`, cue→`enter.at`; `pipeline/src/cast.ts:719-739`) and visuals (`Asset.svg`,
pinned `ref.version`; `cast.ts:789-806`). `assets/visuals.json`
(`visuals/src/manifest.ts:26-151`) is derived, keyed by `visualsFingerprint`; the
renderer reads only geometry from it (`render/src/visuals.ts:158-179`). The render plan
is in-memory only and pure (`render/src/compile.ts:1-7`).
Divergence: Not exactly one IR. Three drift-capable duplications: (1) `lesson.json` and
`storyboard.json` are both persisted and both independently editable, so a storyboard
edit followed by a lesson edit + re-cast silently clobbers the storyboard edit — dual
authority by design; (2) `visuals.json` copies `enterAt`/`enterDuration`/`persist` from
the storyboard (`visuals/src/resolve.ts:911`, `manifest.ts:91-94`) while
`visualsFingerprint` deliberately excludes timing (`keys.ts:415-423`) — stale after a
re-voice, currently unread by anything; (3) `hold`/`cadence` copies are derived by one
shared function (`holdForCadence`), the sanctioned pattern.
Assessment: "One authored IR per editing altitude" (lesson = teaching, storyboard =
board) is a deliberate trade for cheap re-render and hand-editability, documented in
`cast.ts:940-948`. The stale timing copies in `visuals.json` are pure liability:
duplicated state nothing reads — the "accepted and unread field" defect class the
codebase itself names (`lesson.ts:141-144`).
Remediation: Drop `enterAt`/`enterDuration`/`persist` from `ElementVisual`, and have a
lesson re-cast refuse (or warn on) a storyboard that diverged from its cached compile
hash.

### [A-2] Prompts requesting numeric coordinate emission

Verdict: PARTIAL
Severity: MINOR
Evidence: Coordinate-requesting prompts: (1) `planner/src/anthropic.ts:111-112`
(document route): "Give every element an `at` box in canvas units…", camera x/y —
explicit layout-coordinate emission; (2) `anthropic.ts:277-283` (`anthropicEdit`) re-emits
the complete storyboard including `at` boxes; (3) `draw-anthropic.ts:73-116`
(`DRAW_BRIEF`): full numeric geometry for one composed 1000×560 figure;
(4) `UNDERLAY_BRIEF`/`FIGURE_BRIEF` read coordinates off an attached image;
(5) `draw-critic.ts:66-84` keeps coordinates during fixes; (6) `pipeline/src/edit.ts:81-92`
offers a `set-camera` op with numeric x/y/zoom applied verbatim. The lesson brief
(`lesson-anthropic.ts:126-247`) requests no coordinates — placement is relational.
Divergence: (1) is genuine coordinate-emission-for-layout, confined to the
`via: 'document'` fixture route and mostly neutralised by `layoutStoryboard` re-layout —
except arrow `from`/`to`, path `points`, and `motion.path` waypoints, which re-layout
never rewrites. (3)-(5) are drawing-authoring inside one figure, deterministically fitted
into a compiler-chosen box (`fitDrawing`/`fitCanvas`, `drawing.ts:94-128`) — a different
contract from inter-element layout.
Assessment: The drawing lane is a considered, fenced exception (deterministic
repair/audit/veto around it) and the spec's ban should not apply to it. The document
route's residual leak is real but lives on a route the code itself calls "not a route to
a watchable video" (`plan.ts:14-16`).
Remediation: Make `layoutStoryboard` re-anchor document-route arrow endpoints and
path/motion waypoints; constrain the `set-camera` op to scene-relative presets.

### [A-3] Final canvas position: solver vs model

Verdict: PASS
Evidence: End-to-end trace of a term label on the lesson route: model emits only the
string (`terms: ["ATP"]`, `core/src/lesson.ts:446`); `compileLeason`→`planBoard`
assigns a disjoint frame-shaped cell by arithmetic (`planner/src/regions.ts:185-289`),
`makeText` measures and writes the `at` box (`compile.ts:846-877`,
`elements.ts:150-196`); voice overwrites timing only, never position
(`voice/src/cue.ts:1-32`); visuals lays glyph strokes inside `at`; the renderer maps
canvas box → pixels through `resolveFraming`/`viewRect` (`core/src/camera.ts:224-360`) —
all arithmetic. Exceptions: draw-lane marks (intra-figure, by design, affine-fitted into
a compiler-chosen box) and the document-route arrows noted in A-2.
Divergence: None on the product route beyond the drawing lane's intended intra-figure
authorship.
Assessment: "Non-overlap is a property of the construction" (`compile.ts:22-25`) is
stronger than a repair pass.
Remediation: None beyond A-2's document-route fix.

### [A-4] Text metrics: measured vs estimated

Verdict: PARTIAL
Severity: MAJOR
Evidence: Two parallel stacks. MEASURED: `visuals/src/fontmetrics.ts:275-348` (real sfnt
parsing — head/hhea/hmtx/cmap, true per-codepoint advances); `visuals/src/text.ts:113-205`
(wrap/shrink via `font.measure`); `visuals/src/plot.ts:829` and `diagram.ts:95-190`;
`render/src/page/runtime.js:345-491` (in-browser `getSubStringLength`, wrap + binary-search
shrink that "never truncates"). ESTIMATED (every site found):
`planner/src/elements.ts:148-184` (`ADVANCE = 0.52`, character-count wrapping — the box
every text element is reserved at); `elements.ts:242,264-274` (equation boxes);
`elements.ts:388-389` (`longest.label.length * 13 + 48`); `draw-geom.ts:61-74,157-165`
(`labelBox`/`labelFootprint`); `drawing.ts:161,240` (`MATH_ADVANCE = 0.75`);
`draw-audit.ts:196-204` (the defect check itself is chars×k);
`render/src/compile.ts:1540,1638` (arrow/edge labels ×0.6/0.62); `render/src/prims.ts:82`
(×0.58); `fontmetrics.ts:189-238` (`builtinAdvance` silent fallback when no font file).
The repo documents the disagreement itself: `render/src/sketch.ts:372-377` — "two
disagreeing estimators for the same number".
Divergence: Final glyph placement is measured; every planner-side reservation — text
boxes, equation boxes, diagram nodes, drawing labels — and the renderer's arrow/plot
labels are chars×k.
Assessment: The defense is real: the runtime re-wraps and shrink-fits inside the reserved
box by true measurement, so estimate error costs whitespace or type size, not clipped
words. But the defense fails where the spec predicts: `draw-geom.ts:136-146` documents
shipped defect cardiac8 (labels overlapped 103×29 units, estimate off by 2.09–2.48×),
and `elements.ts` records "AV nod"/"empty stac" clipping. `docs/HANDOFF.md` defect #0
(FONT vs TYPE_SCALE, 18% apart) is the same two-catalogue pathology. Estimation plus a
measured shrink pass converts truncation into dead whitespace (see S4-e) or silently
shrunken type (see S4-f).
Remediation: Replace planner-side chars×k with calls into `visuals/fontmetrics.ts`
(already dependency-free and deterministic); make the missing-font builtin fallback a
hard failure.

### [A-5 / S8-a / X-a] Determinism: frame = f(inputs, frame_index)

Verdict: PASS
Evidence: `render/src/page/runtime.js:1-17` ("nothing in this file may read a clock,
call requestAnimationFrame, use Math.random"); the capture loop seeks a stepped clock
`i / fps` per frame via CDP (`render.ts:209`, `browser.ts:170-175`). All stochastic
geometry is compiled once in Node from seeded mulberry32 (`sketch.ts:29-69`,
FNV-1a `seedOf(element id, kind)`). CSS animation killed twice, `reducedMotion`,
srgb, no LCD text (`browser.ts:33-61`). Repo-wide grep finds `Math.random`/`Date.now`
only outside the frame path. Rough.js force-seeded with the `seed: 0 → 1` guard
(`visuals/src/geometry.ts:19-26,168-172`). Pinned by executable tests:
`page.test.ts:75` (seek is pure in t), `page.test.ts:97` (byte-equal PNGs across browser
contexts — exactly what a second shard is), `compile.test.ts:38` (byte-identical plan),
`planner/test/pinned-hashes.test.ts` (four storyboard hashes on every `pnpm -r test`).
Divergence: None material; cross-machine pixel identity depends on the pinned Playwright
Chromium build.
Assessment: Determinism is the architecture, not an accident — the plan bakes all
randomness, motion, and morph frames in Node; the browser is a pure lookup.
Remediation: Optionally fold the Chromium build id into the render cache key.

### [A-6 / S7.1 / S7-d] Reveal times: narration anchors vs wall clock

Verdict: PARTIAL
Severity: MINOR
Evidence: Reveal times are `enter.at` — a fraction of the scene's measured narration
(`render/src/compile.ts:816`) — plus `enter.cue`, a verbatim narration phrase resolved
against word timings or measured phrase boundaries and written back
(`voice/src/cue.ts:12-27`, `narrate.ts:836-843`). Re-narration re-syncs twice over:
fractions rescale to the new `durationSec`, cues re-resolve to new timings.
Divergence: An unresolvable cue is NOT a hard error: voice warns and keeps the authored
`at` (`cue.ts:25-27`); the renderer warns only when there is no measured audio at all
(`compile.ts:232-245`). Planner-authored fallbacks are heuristics like `at: 0.08`
(`figures.ts:56`, `plots.ts:169`) — effectively beat start. `docs/PIPELINE.md` step 8
(`entersAtWord`, "no fallback warnings") is confirmed unshipped; the fallback branches
are live and tested (`compile.test.ts:501,537`).
Assessment: The narration-anchored fractional model is the right shape — nothing in the
plan is absolute wall-clock — and "warn, never invent a time" is a deliberate, documented
choice. But a warning can be scrolled past; a missed cue on a beat's dominant visual is
the D5 defect one log line away from shipping.
Remediation: Implement step 8 (word indices end to end), or promote an unresolved cue on
a dominant visual from log warning to a structured `problems[]` entry.

### [A-7] QC patches the IR, never pixels or timeline

Verdict: PASS
Evidence: The draw-critic patches `Mark[]`, and marks are IR: they live in
`VisualIntent.marks` inside `lesson.json` (`core/lesson.ts:187`), written back by
`drawLesson` (`draw-anthropic.ts:778-780` — "the marks belong _in_ lesson.json"), and
the board re-derives via `compileLesson` with the lesson hash in the storyboard cache
key — propagation by invalidation, not downstream mutation. Voice writes resolved
fractions into `enter.at` as its declared output contract, not a fix-up. Nothing touches
rendered pixels or the encoded timeline; the corrected-drawing cache stores marks, not
pictures, and pose cache stores geometry, not renderings (`character.ts:461-466`).
Divergence: `editStoryboard` patches an artifact downstream of `lesson.json`; a later
re-cast recompiles over those edits — a documented two-IR trade (`cast.ts:945-948`).
Assessment: The architecture consistently patches the most-upstream artifact that owns
the fact and re-derives.
Remediation: Warn on `cast --force` over a project whose storyboard has edits newer than
its lesson compile.

### [A-8] Append-only canvas

Verdict: PARTIAL
Severity: INFO
Evidence: The DOM is built once; all exits are opacity writes (`runtime.js:296-341`).
Under the default `accumulate` board, `persist` ink stays up forever. Two sanctioned
removals: `meta.board: 'wipe'` fades each card on its last word (`compile.ts:596-614`),
and morph `retire` fades the source over the first 60% of the morph
(`runtime.js:815-821`).
Divergence: Strict append-only holds for the default board only.
Assessment: Morph is the camera-safe equivalent, not a violation: the in-flight shape is
a baked, seeded interpolation, and camera framing history (`core/src/camera.ts:336-354`)
knows nothing of retire, so removal never causes a reframe. Under `wipe`, framing history
expires in lockstep via `persistUntil` (`camera.ts:342-353`). Both tested
(`morph.test.ts:282`, `camera.test.ts:217`). The wipe preset is backed by a measurement
(fill 55.5%→62.3% at ≤90s, `docs/CONTRACT.md`) — see Spec-is-wrong #1.
Remediation: None; document "accumulate is append-only; wipe and retire are authored,
camera-consistent exceptions".

---

## S0 — Intake and grounding

### [S0-a] Grounding / retrieval at intake

Verdict: MISSING
Severity: MAJOR
Evidence: `planner/src/ingest.ts:25-81` — `ingest()` accepts only `{text, filePath, url}`
(one document); no retrieval, search, or citation fetching anywhere. For a bare topic,
`lesson-anthropic.ts:253-256` sends "There is no source document. Teach it from first
principles, from what you know to be true." `pipeline/src/cast.ts:483` confirms the
two-mode design. Extras: no topic disambiguation exists; `audience` is free text
(`core/src/lesson.ts:461`) read only by prompt interpolation — nothing downstream
branches on it.
Divergence: Spec expects retrieved sources grounding factual claims; here grounding is
one user document or nothing.
Assessment: Deliberate and internally honest — the critique gate polices pedagogy, not
facts, and single-document ingest keeps the zero-dependency path working. Scope note:
post-cutoff or niche bare-topic claims are unsupported and undetectable.
Remediation: Optional retrieval populating `SourceDoc` for bare topics, or at minimum
flag bare-topic lessons as ungrounded in the project record.

### [S0-b] Sources carried downstream

Verdict: FAIL
Severity: MAJOR
Evidence: The ingested doc persists as `source.json` (`cast.ts:404`) but after lesson
generation is used only as a cache fingerprint (`cast.ts:638`). `Lesson` has no
source-reference field; `StepGrounding` (`lesson.ts:335`) records pedagogical provenance
(which earlier beat), never document provenance. No QC script can trace a claim to the
source.
Divergence: Spec expects source refs on claims so factual QC is possible; the link is
severed at the lesson boundary.
Assessment: `from`/`derivedFrom` is good _within-lesson_ provenance, and the brief says
"take the facts and the numbers from it" (`lesson-anthropic.ts:269`) — but that is
prompt-side only. A per-beat `sourceRef` fits the existing checkable-data philosophy.
Remediation: Optional `sourceRef` on `LessonStep`, populated when a `SourceDoc` exists,
verified by `critiqueLesson` against `source.json` sections.

### [S0-c] Duration budget enforcement

Verdict: PARTIAL
Severity: MINOR
Evidence: Three pre-render layers: `critiqueLesson` rejects estimates over
`maxSeconds × 1.25` (`core/src/lesson.ts:823-829`); `adaptLesson`
(`planner/src/presets.ts:604-680`) clamps narration at sentence boundaries, caps holds,
and drops beats constrained by the DAG (`droppableIds`) until the estimate fits, else
logs "runs long" and deliberately stops; the brief states the budget in words. The
estimate uses `DELIVERED_WPS = 2.2` (`presets.ts:118`), measured once from a real render.
Divergence: Synthesized audio length is never compared back against `maxSeconds`;
`narrate.ts:883-931` checks A/V sync and the WPM band (advisory), not the budget. The
2.2 calibration is a constant whose re-measurement is a comment, not a mechanism.
Assessment: Enforcing before render is where cuts are cheap; the gap is that a
voice/provider change silently invalidates the constant.
Remediation: After synthesis, compare measured track duration against the target and
record breaches in project state.

---

## S1 — Lesson plan

### [S1-a] Distinct planning stage with persisted artifact

Verdict: PASS
Evidence: `lesson.json` written on every run (`pipeline/src/lesson.ts:22,39-47`;
`cast.ts:480,530`), zod-validated on read, hashed into the storyboard cache key so
hand-editing recompiles; `tandemcheck.mts:41` recompiles from a project's own
`lesson.json`. Users can supply `*.lesson.json` and skip the stage.
Divergence: None — exceeds spec: the plan is the designated edit surface and
cache-invalidation unit.
Assessment: Fully realized.
Remediation: None.

### [S1-b] Prerequisite structure as checkable data

Verdict: PARTIAL
Severity: MINOR
Evidence: `from`/`derivedFrom` are schema data (`core/src/lesson.ts:396-403`);
`critiqueLesson` rejects forward references and dangling ids (`lesson.ts:762-776`),
`derived` with empty `derivedFrom`, and `asserted` in first-principles lessons. Second
real consumer: `droppableIds` (`presets.ts:576-592`) forbids cutting a beat any survivor
derives from. No topological sort exists; `lessonBeats` returns authored order.
Divergence: Spec wants ordering derived from the DAG; here it is authored and validated.
Assessment: Validate-don't-derive is defensible — pedagogical order carries information a
toposort destroys, and the DAG has teeth where it matters (trimming). Residual risk: a
valid but pedagogically wrong order among undeclared (`given`) dependencies.
Remediation: Optionally warn when a linearization materially disagrees with authored
order.

### [S1-c] Misconceptions explicit and addressed

Verdict: PARTIAL
Severity: MINOR
Evidence: `misconception?: LessonStep` — singular, optional (`lesson.ts:514`). It _is_ a
beat, so "addressed by a beat" holds by construction when present. Nothing requires it,
and `adaptLesson` trims it first (`presets.ts:625-627`).
Divergence: Spec wants plural misconceptions each provably addressed.
Assessment: The singular design is sharper than a checklist: "the wrong belief this
specific explanation _creates_" (`lesson-anthropic.ts:168-169`) is the right dose for a
75–150s film. Genuine gaps: optionality, and budget pressure silently deleting the
refutation.
Remediation: Require it for `stem`/`first-principles` in critique, or warn when trimming
drops it.

### [S1-d] Concrete-before-abstract enforcement

Verdict: PARTIAL
Severity: MINOR
Evidence: (1) `analogy.maps` is checkable data (`lesson.ts:314-325`), critique rejects
empty maps; (2) `findReuse` (`planner/src/compile.ts:643-670`) derives the abstraction's
arrival structurally — the first plot after the anchor's path morphs out of the concrete
drawing, no text matching; (3) the jargon-budget check rejects budgeted jargon in the
hook; the brief mandates "CONCRETE BEFORE ABSTRACT, always".
Divergence: Coverage is narrow — one strategy (analogy), one visual pattern (path→plot);
first-principles lessons rely on prompt + hook-jargon check. Sampled-plan ratio: UNKNOWN
(no LLM generations run in this pass).
Assessment: What exists is better than the spec imagines — the mapping table makes the
relationship data, and the compiler stages the transition visually. It just covers one
lane.
Remediation: Critique flag for a plot/math-heavy beat preceding any concrete beat in
non-analogy lessons.

### [S1-x] One thesis and per-beat duration

Verdict: PARTIAL
Severity: INFO
Evidence: `coreInsight` is one required string with real consumers (`stepScores`,
`insightArrival` — the beat the trimmer may never cut; `presets.ts:464-539`). No per-beat
`targetSec`; `lessonSeconds` sums word counts at 2.2 w/s + holds against the preset.
`docs/PIPELINE.md:255-266` argues a per-beat target is "a second opinion about the same
thing".
Divergence: Per-beat time estimation exists only as derived whole-lesson arithmetic.
Assessment: The reasoning is sound and backed by this repo's history of duplicated-fact
bugs; `maxWordsPerBeat` is a per-beat budget denominated in the unit the model can
actually control.
Remediation: None; per-beat drift is measurable after the fact from `timing.json` if ever
needed.

---

## S2 — Narration

### [S2-a] Narration vs visual-plan ordering

Verdict: PARTIAL
Severity: MINOR
Evidence: Co-generated in one forced tool call: `LessonStep` carries both `narration`
and `visuals` (`lesson.ts:404-406`); one `emit_lesson` call
(`lesson-anthropic.ts:311-317`). Afterwards visuals follow narration: `cue`/`terms`/
`emphasis` must be verbatim substrings (critique rejects otherwise, `lesson.ts:721-727`).
Divergence: Spec wants narration written against a prior visual plan; here neither is
first.
Assessment: Co-generation prevents the desync the spec's ordering guards against —
structurally, via verbatim-substring rules and every-beat-has-a-visual — where two calls
would reintroduce cross-referencing drift and double the cost.
Remediation: None structural; optionally a critique rule that narration references its
visual's subject.

### [S2-b] Word budget checked post-generation

Verdict: PASS
Evidence: `critiqueLesson` flags beats over 60 words (`lesson.ts:709-711`) and rejects
over-estimate lessons (`:823-829`), feeding the revision pass; `adaptLesson`/`trimStep`
hard-clamp to `maxWordsPerBeat` at sentence boundaries (`presets.ts:314-379`); post-TTS
the 140–160 WPM band is measured (advisory, `narrate.ts:923-931`).
Divergence: Post-synthesis check is advisory (see S0-c).
Assessment: The binding checks are at the layer where cutting is cheap.
Remediation: None beyond S0-c.

### [S2-c] TTS pre-processing

Verdict: PARTIAL
Severity: MINOR
Evidence: `voice/src/text.ts` — six-stage deterministic normalizer applied per scene and
folded into the cache key: markdown stripping, abbreviations, initialisms
letter-by-letter with exception list, numbers (scientific notation, currency, %, units,
ranges, years…), symbols (Greek, operators, arrows). Run live:
`α|0⟩` → "Alpha, zero ⟩." (ket bracket survives raw); `1.5e-9` → "One point five times
ten to the power of minus nine."; `H₂O` → "H₂O." (subscript digits defeat the initialism
regex — never spelled); `O(n log n)` → unchanged; `Fig. 3` → "Figure three.";
`~40%` → "About forty percent."; `\frac{1}{2} of $x^2$` → "\frac one two of $x squared$"
(LaTeX leaks to the engine). Stage directions: brackets stripped, parentheses spoken.
Divergence: Gaps — LaTeX, Unicode sub/superscripts, bra-ket glyphs.
Assessment: Unusually thorough for its domain, correctly ordered, deliberately
conservative; the `tex` field existing separately from narration is the real defense —
notation is drawn, not spoken.
Remediation: Add Unicode sub/superscript folding, `⟨⟩` handling, and a LaTeX strip.

---

## S3 — Scene IR

### [S3-a] Formal schema enforced on model output

Verdict: PASS
Evidence: zod schemas for Lesson, Storyboard, Mark; every LLM path doubly constrained —
forced tool call with zod-derived JSON Schema (`planner/src/schema.ts:85-113`,
`tool_choice: {type:'tool'}`), then zod parse-and-reject (`lesson-anthropic.ts:325`,
`anthropic.ts:243,301`, `draw-anthropic.ts:545`). The pipeline re-validates at every
stage boundary and on every disk load. Stage-owned fields are pruned from tool schemas
so models cannot author them (`STAGE_OWNED`, `schema.ts:38`).
Divergence: One pruning gap: `VisualIntent.marks` is not in `STAGE_OWNED`, and
`drawable()` skips intents that already have marks — a lesson model emitting marks would
bypass the dedicated drawing stage. Theoretical (the brief never asks for marks) but the
exact leak class the `inkBox` pruning exists to prevent.
Assessment: Thorough and layered.
Remediation: Prune `marks` from the lesson tool schema.

### [S3-b] Coordinate fields in model-authored IR

Verdict: PARTIAL
Severity: MINOR
Evidence: Lesson IR: `Mark.x/y/w/h/…` are model-authored but scoped to one figure's
normalized canvas; everything else relational. Storyboard IR: `Element.at`, arrow
endpoints, camera x/y — coordinate-bearing by design ("Coordinates live on ONE persistent
canvas", `storyboard.ts:10-13`), authored on the product route by the deterministic
compiler, by a model only on the document route and full-storyboard edits.
Divergence: The spec's "relational placement only" holds for the lesson IR; the
storyboard achieves the intent by having code author the coordinates.
Assessment: The semantic-upstream / geometric-downstream split satisfies the invariant's
purpose; see Spec-is-wrong #3.
Remediation: Same as A-2.

### [S3-c] Reference-graph validation

Verdict: PARTIAL
Severity: MINOR
Evidence: Lesson graph properly gated in `critiqueLesson` (`lesson.ts:695-831`):
forward-reference ban (makes cycles impossible), dangling `derivedFrom`, `character.id`
vs cast, emphasis/terms/initialism coverage, analogy maps, duplicate captions. Storyboard
graphs have no parse-time validation — consumers warn-and-degrade: dangling
`morph.fromId` → warn, skipped (`render/src/compile.ts:934-944`); dangling
`emphasis.targetId` → warn (`:1709-1711`); unknown `assetId` (model route) silently
auto-minted (`ensureAssets`, `anthropic.ts:357-379`). Compiler-generated references are
correct by construction.
Divergence: A hand- or model-edited storyboard with dangling ids renders with only log
lines; no `critiqueStoryboard` equivalent exists.
Assessment: Adequate for compiler-authored storyboards; the edit paths make hand-patched
storyboards first-class, and those get no gate.
Remediation: A `critiqueStoryboard` (dangling ids, `persistUntil` validity) after edits.

### [S3-d] Behavior on validation failure

Verdict: PASS
Evidence: Retry-with-errors-fed-back universally, bounded: plan 2 attempts then heuristic
fallback (`anthropic.ts:233-259`, `plan.ts:140-142`); lesson 3 schema attempts + one
critique revision, then best draft accepted with problems logged and persisted
(`lesson-anthropic.ts:326-399`, `state.ts:28-34`); drawings 2 attempts
(`draw-anthropic.ts:529-561`) with two narrow, logged, commented coercions. The draw
critic revises only measured defects and vetoes regressions by re-audit.
Divergence: `ensureAssets` is the one true silent default-fill (invents an illustration
for an undeclared assetId, at debug level).
Assessment: The spec-ideal shape — and accepted-with-problems is defensible because the
problems are persisted, not swallowed.
Remediation: Log `ensureAssets` at warn.

### [S3-e] IR persisted, keyed, diffable

Verdict: PASS
Evidence: `projects/<id>/{lesson.json, storyboard.json, assets/visuals.json + SVGs,
audio/, cache.json, pipeline.json, out.mp4}`; all JSON pretty-printed (diffable).
`cache.json` slots keyed `pipeline@2/<stage>@N` (`STAGE_CODE_VERSION`,
`keys.ts:165-279`) with artifact-existence guards. Partial re-render at fine grain:
per-scene voice keys (`staleVoiceScenes`, `cast.ts:1331-1352`), per-asset visuals keys,
board-geometry key excluding timing. Hand edits are first-class and invalidate precisely.
Divergence: One mutable IR copy per project — no per-render snapshots; the render plan is
never persisted.
Assessment: Delivers everything the requirement is _for_ without history's storage cost;
git is the implicit history.
Remediation: Snapshot `{lesson,storyboard}.json` before overwrite only if
rollback/compare becomes a product feature.

---

## S4 — Layout solver

### [S4-a] Distinct deterministic solver vs DOM-emergent layout

Verdict: PASS
Evidence: Layout is solved before Chromium runs: disjoint frame-shaped cells per beat
(`compile.ts:22-25`, `regions.ts:158-344`), legacy shelf-packer with collision repair for
the heuristic/edit path (`layout.ts:154-418`), cameras by pure arithmetic
(`core/src/camera.ts:360-483`), all baked into a pure `RenderPlan`. The page paints
pre-solved geometry (`runtime.js:1-17`); its only DOM measurements are text wrap and path
lengths, deterministic per font.
Divergence: Line wrap and shrink-to-fit happen in-browser inside pre-solved boxes, and no
assertion runs against the realized layout — the browser's measurements never flow back
to any check.
Assessment: Exactly the spec's shape; the gap is the feedback loop, not the model.
Remediation: A post-layout assertion pass in the capture page reporting realized text
bounds.

### [S4-b] Glyph-coverage assertion

Verdict: MISSING
Severity: CRITICAL
Evidence: No code asserts codepoint coverage. The one cmap consultation does the
opposite of failing: a missing codepoint silently returns the space glyph's advance
(`visuals/src/fontmetrics.ts:323-328`). In the browser, every text run has a fallback
stack ending in `cursive` (`render/src/font.ts:31-32,169`) — silent substitution or tofu,
no warning. An equation with no typeset geometry (stale sidecar, unloadable engine, any
macro outside MathJax's `base`) is drawn as raw TeX in the handwriting font with a
`log.warn` (`render/src/compile.ts:1267-1277`). A plain text element containing `α|0⟩` is
checked by nothing at any stage.
Divergence: Spec: hard fail on any uncovered codepoint. Nothing exists; both mechanisms
that touch the problem degrade silently.
Assessment: The math half of D1 is well engineered (`texError` guard, "a wrong equation
is worse than a missing one"), and "the pipeline must never fail for a missing font"
(`fontmetrics.ts:14`) is a considered robustness rule — but it is precisely the rule the
spec rejects, and it makes the D1 defect reachable and silent.
Remediation: In `resolveVisuals` (the cmap is already parsed there), iterate every
text/label/term string and hard-fail on any codepoint absent from the resolved font;
make a missing-equation-geometry a compile error rather than a text fallback.

### [S4-c] Collision assertion

Verdict: PARTIAL
Severity: MAJOR
Evidence: By construction (disjoint cells, `compile.ts:22-25,877-954`;
`regions.ts:217-253`); a repair pass on the legacy path (`layout.ts:385-418`); corpus
tests (`compile.test.ts:93-160` pairwise overlap including cross-beat;
`layout.test.ts:41-63,251`); drawing-lane label overlap measured as audit defects
(`draw-audit.ts:160-189`). No runtime assertion on any storyboard actually rendered; no
CI (`.github/` absent) — even the tests are a local discipline.
Divergence: Spec wants a blocking pairwise check on every layout; novel LLM lessons,
`edit.ts` patches, and hand-authored storyboards are never checked at render time.
Assessment: The construction argument is strong for the modern path, and cardiac8 shows
overlaps still ship _inside_ composed drawings where construction doesn't reach. An
O(n²) AABB sweep per scene costs microseconds.
Remediation: Pairwise `overlaps()` sweep over non-nested persistent elements per scene in
`compilePlan`, throwing on hit.

### [S4-d] "Everything revealed this beat is in frame"

Verdict: PARTIAL
Severity: MINOR
Evidence: True by construction for derived cameras: `resolveFraming` targets the union of
the scene's own ink plus surviving history; the file's first rule — "Only ever pull
wider… ink can never be cropped" (`camera.ts:14-16`); `elementBounds` covers arrows,
paths, emphasis targets, and motion's swept corridor. Tests pin it
(`camera.test.ts:159-215`). Morphs happen inside the host beat's cell, so both endpoints
are framed. Hole: a scene with no `region` keeps its authored camera untouched with no
containment check (`camera.ts:32-34`) — the hand-authored/older-planner path.
Divergence: A guarantee-by-construction plus tests, not an assertion; nothing guards
authored cameras.
Assessment: The strongest construction case in the audit — the camera is _defined as_ the
fit of what is visible. The assertion would be nearly free and would cover exactly the
unguaranteed path.
Remediation: `rectContains(viewRect(cam), elementBounds(el))` per revealed element in
`compilePlan`, error on authored cameras.

### [S4-e] Fill-ratio check

Verdict: FAIL
Severity: MAJOR
Evidence: `render/src/fillcheck.mts` is a manual tool. In-pipeline, `compile.ts:514-515`
computes `contentFill` and `reportFill` warns below 25% mean (`camera.ts:611-632`) —
advisory; the render continues. Measured live this pass: `final-169` 47.6% mean,
`cardiac8f` 24.3%, `integ-doc` 43.3%; the 17% photosynthesis case is confirmed in
`docs/PIPELINE.md:852-860` — that board rendered. One fixture test asserts fill >0.25 /
mean >0.4 for one grouped fixture.
Divergence: Spec: 55–85% blocking band, <35% = parked on empty canvas. Reality: advisory
warn at <25%, and the shipped corpus lives at 24–48% — the spec band would fail every
board including the benchmark.
Assessment: The repo mounts a serious measured argument against the spec's number
(`camera.ts:36-61`: derived shots are already within 3% of the tightest fit; safe insets
cap fill at 76.5%; bounding boxes overstate ink — `inkstat.mts`: fillcheck 21.6% where
real ink is 4.7% — and the metric can be gamed). What the argument does not excuse is the
gate's absence: even the design's own honest floor blocks nothing.
Remediation: Promote the ~25%-mean / any-scene-<14% warn into a compile error with an
explicit override; keep 55–85% out of code until the metric measures ink.

### [S4-f] Minimum on-screen glyph height post-zoom

Verdict: FAIL
Severity: MAJOR
Evidence: Not checked pre- or post-zoom. The design's mechanism: `TYPE_SCALE` (caption
26px, label 32px at 1080p) is quoted at the _median_ framing (`camera.ts:315-319,
667-673, 747-767`), and per-scene zoom is bounded relative to the median (`PULL_OUT` 2.5×
on 16:9, `MAX_CLOSEUP` 1.9). Worst case is quoted-size ÷ pull-out: caption ≈ 10.4px,
label 12.8px — below the spec's ~18px, and the floor is reached by design (that is when
the camera starts walking). Two shrink-to-fit passes can go lower (`runtime.js:400`
floors at max(9, 0.42×size) canvas units; `visuals/text.ts:160` minScale 0.5). No
assertion compares realized px anywhere.
Divergence: Spec: ≥ ~18px asserted post-zoom. Reality: a soft median-relative bound with
worst cases at 10–13px, invisible to the shrink passes.
Assessment: The `PULL_OUT`/`MAX_CLOSEUP` machinery exists precisely for legibility and
deserves credit — but it bounds the ratio, not the pixels.
Remediation: Assert per scene that `type[role] / (zoom_scene/zoom_median)` ≥ threshold
output px for every role used, folding in the runtime's chosen shrink size.

### [S4-g] Blocking vs advisory, per assertion

Verdict: FAIL
Severity: MAJOR
Evidence: Glyph coverage: absent (silent space-width substitute; TeX-as-text warn).
Missing font: log + builtin estimate / system fallback. Collision: construction + silent
repair + tests no CI runs. In-frame: construction + tests. Fill: `log.warn`. Min glyph
height: absent. The only blocking render-path failures are infrastructure (missing
Chromium, missing runtime.js, zod shape) — and zod's `Box` is bare `z.number()`s (no
finiteness). The one blocking quality gate (`texError`/unknown-transform mark-drop)
blocks by falling through to the advisory text path.
Divergence: Spec rule: advisory == absent. The render path has effectively zero quality
gates; the shipped defects the repo documents (17% board, cardiac8 overlap, "AV nod")
all rode through warnings.
Assessment: The robustness-first posture ("a degraded video beats no video") is
defensible for a creator tool, and the offline verification culture (pinned hashes, 917
tests, committed check tools) is unusually strong — but under the spec's definition it
does not change output.
Remediation: A strict mode (default-on for pipeline runs) promoting the existing warn
sites — fill floor, equation fallback, missing font, cue misses — to errors, with current
behavior behind an explicit degrade flag (`pipeline/src/degrade.ts` already exists).

### [S4-x] Canvas extent

Verdict: PASS
Evidence: Computed closed-form from the cell grid (`regions.ts:302-307`,
`layout.ts:83-99`; wipe path fixes one cell + border); `fitCamera` clamps zoom to
[0.02, 60] with zero-size guards.
Divergence: Trivial: `Box` lacks `.finite()`/positivity, so a hand-authored storyboard
could carry `Infinity` through parse.
Assessment: True by construction for everything the pipeline produces.
Remediation: `.finite()` and positive w/h on the `Box`/`Point` zod.

---

## S5 — Asset router

### [S5-a] Implemented renderers vs the routing table

Verdict: PARTIAL
Severity: MAJOR
Evidence: Lanes implemented (`visuals/src/resolve.ts:441-573,675-872`): inline SVG →
curated library → figure raster → illustration generate → lucide icon → letter card;
elements: text, equation (MathJax), shape, arrow, diagram (dagre for flow/tree/graph;
sequence/stack/grid hand-rolled), plot (homegrown 1,714-line solver), path, emphasis,
asset. Grep for shiki/rdkit/schemdraw/wavedrom/topojson/d3-geo/vega/elkjs/katex: nothing
(except the KaTeX→MathJax comment).
Divergence: Four topic classes wholly unserved: **chemistry** (no SMILES — a molecule
degrades to the image lane or a letter card), **circuits/timing diagrams**, **geography**
(no correct map possible), **code** (would be set in a handwriting font — worse than
absent). Present beyond the table: character rigs, morphs, motion lane, underlay+marks
hybrid, emphasis, letter-card last resort.
Assessment: A deliberate quality wager argued in code comments: a curated, versioned
library plus a few lanes with hard quality floors, all funnelled through one ink pipeline
and one seeded RNG, beats nine loosely-integrated renderers that cannot share the board's
ink or determinism contract. The cost is real: the fallback for the four gaps is
confidently wrong pictures (a hallucinated benzene ring) rather than a refusal.
Remediation: Document the four gaps as explicit routing limits and add a planner-side
guard that warns when a lesson's subject names one.

### [S5-b] The math path

Verdict: PARTIAL
Severity: MAJOR
Evidence: Happy path is genuinely typeset glyph outlines: TeX enters at
`compile.ts:1143-1159` (`updateLine` → `makeEquation`) and `drawing.ts:732-752` (the
`math` mark); `equation.ts:310-411` runs MathJax SVG, composes transforms, sorts marks
left-to-right for reveal, inks crisp; the `merror` censor-bar defect is gated
(`texError`, `equation.ts:248-259`). Leak: **no math detection exists on the text path**
(grep: nothing), and two prompts invite the leak — `lesson-anthropic.ts:230` says
"**text** — an equation or a phrase that must be written out verbatim" (routed to
`makeText` handwriting, `compile.ts:806-863`), and the drawing brief says "THE MARKS, and
there are only these eight" (`draw-anthropic.ts:77-84,152-161`), **omitting the ninth
mark, `math`**, which exists in the schema (`core/src/lesson.ts:71`) — a model needing
`α|0⟩` in a drawing has only `label`.
Divergence: The engineered lanes satisfy the spec; the LLM-authored surfaces can carry
Unicode math into `layoutText` with zero detection — the exact reference defect, as a
prompt/routing bug rather than an engine bug.
Assessment: The equation lane is the strongest single module audited, and the
MathJax-over-KaTeX deviation is correctly argued. Routing to it depends entirely on the
author choosing it, and the prompts steer authors away in two places.
Remediation: Advertise the `math` mark in both drawing prompts; fix
`lesson-anthropic.ts:230`; add a Unicode-math/TeX sniffer on `makeText` input that warns
or promotes to `makeEquation`.

### [S5-c] Style centralization

Verdict: PARTIAL
Severity: MAJOR
Evidence: Within visuals, centralized: `style.ts:66-171` defines the packs; all ink goes
through `baseOptions`/`roughenPathData` (`geometry.ts:166-261`). But render holds a
second style system: `render/src/palette.ts:44-115` (own palettes, own per-style ink
table) and `render/src/sketch.ts` (second hand-drawn engine, mulberry32). The two
disagree on colors: visuals `marker` paper `#fdfdfb`/ink `#1c1f26`/accent `#d7263d`
vs render paper `#fcfbf9`/ink `#1b232e`/accent `#2f6fed` — red accent in sidecar-drawn
strokes vs blue in renderer chrome on the same board.
Divergence: Post-filter within visuals, duplicated across packages; `docs/STYLES.md`
itself concedes "That is not a style system".
Assessment: The duplication has a defensible origin (the renderer owns chrome, camera,
pen sprite), and the team already killed one such duplicate via `boardMetrics` — but the
accent mismatch is exactly the drift class `styleFingerprint` exists to prevent, and
nothing compares the two tables. This is `docs/PIPELINE.md` step 10's other half.
Remediation: Move the color/ink tables into `@inkcast/core` (the `boardMetrics` move,
repeated); pursue STYLES.md's StylePack when styles must grow.

### [S5-d] Asset caching and keys

Verdict: PARTIAL
Severity: MINOR
Evidence: Three tiers. Project assets keyed on id, kind, prompt, fit, aspect, seed,
inline SVG, `libraryFingerprint` (path+version+aliases), styleFP, fontFP, provider, with
explicit `asset/v6` version tokens (`resolve.ts:160-191`); elements hash full element
JSON + asset hash + canvas + styleFP + fontFP — an edited project regenerates only what
changed. Machine-wide: `~/.inkcast/cache/illustrations/<id>-<hash(kind,prompt,shape)>.png`
(`image.ts:458-467`) and `characters/<id>/<pose>-<rigSeed>.svg` as style-free geometry
(`character.ts:364-366,443-490`). Version pin write-back real on both fresh and cached
branches (`resolve.ts:197-242`).
Divergence: The raster machine-cache key contains no seed, style, or model id —
deliberate for re-traced `form` rasters, but a `figure` raster is shown as-is
(STYLES.md §6 wants per-(style,prompt) caching), and an `INKCAST_FIGURE_MODEL` switch
silently serves the old model's raster.
Assessment: Exemplary key-versioning discipline (v3–v6 comments explaining each
invalidation).
Remediation: Fold style or figure-model id into `illustrationKey` for `kind:'figure'`
only.

### [S5-e] Failure modes per renderer

Verdict: PARTIAL
Severity: MINOR
Evidence: All loud; no silent-empty path found. Equation failure → TeX drawn as
handwriting with a warning (`resolve.ts:701-724`). Illustration failure → warn → lucide →
letter card (`resolve.ts:512-573`); no-key is a logged downgrade (`image.ts:186-197`).
Lucide no-match → letter card. Figure/underlay failure → draws nothing, deliberately and
loudly (`resolve.ts:478-507`) — substituting a different picture under measured leader
arrows is the argued-against defect. Characters: cache → generate, one retry,
`plausibilityGate` (threshold 0.5), composed fallback; only accepted candidates cached
(`character.ts:495-561`).
Divergence: Illustrations get no plausibility gate and no retry — a garbage-but-traceable
generation ships; `plausibilityGate` is explicitly not the specified identity check
("will accept a different person's face", `character.ts:410-423`).
Assessment: Coherent and honest; the gaps are acknowledged in-code as awaiting an
embedding gate — quality ceilings, not silent failures.
Remediation: Extend retry-once + gate to `illustrationPaths`.

### [S5.1] Routing purity

Verdict: PASS
Evidence: Fixed precedence at both layers: `buildIntent` (`compile.ts:1215-1332`) —
character > authored marks > kind switch, with deterministic capability regexes; visuals
lane order fixed in code. The planner's pre-resolution duplicate router is confirmed
deleted: `matchIcons` appears nowhere in `compile.ts`, only in `heuristic.ts:212` for
document beats, exactly as PIPELINE.md §5b prescribes.
Divergence: None — LLMs author intent, never dispatch; the lane order itself is versioned
into cache keys.
Assessment: The invariant is actively defended, not accidental.
Remediation: Optional regression test that `compile.ts` never imports `matchIcons`.

### [S5.6] Raster alpha

Verdict: FAIL
Severity: MINOR
Evidence: No raster carries or verifies alpha. Form rasters are binarised and traced;
figure rasters are embedded opaque with `mix-blend-mode: multiply` and a prompt demanding
a plain white background (`image.ts:238-246,857-864`). No background removal, no alpha
check, no fringe detection (grep: nothing).
Divergence: Spec requires alpha. The multiply-by-white substitute works on the current
light papers only.
Assessment: A legitimate cheaper design for the all-light-paper present that dodges matte
fringing entirely — but load-bearing on two unchecked assumptions (white grounds from the
model, light paper from the renderer), and STYLES.md's chalkboard packs would break it.
Remediation: Corner/edge whiteness check on figure rasters now; real alpha before any
dark-surface style ships.

---

## S6 — TTS and forced alignment

### [S6-a] Word timestamps and cue resolution

Verdict: PARTIAL
Severity: MINOR
Evidence: The aligner outputs genuine per-word `{word, start, end}`
(`voice/src/align.ts:98,185-221`); ElevenLabs character alignment folds into the same
shape (`providers/elevenlabs.ts:197-227`). Cue resolution is a phrase string search:
`findCueSpan` (`cue.ts:130-145`) — exact, then prefix, then in-order fuzzy with
`MIN_CUE_SCORE = 0.6`. `entersAtWord` appears nowhere in code (docs step 8, not done).
Match failure keeps the authored `at` with a named warning (`cue.ts:387-403`).
Divergence: The docs' own architecture calls for word indices ("an index cannot [fail to
match or match twice]"); fuzzy-0.6 and 50%-prefix matches can land on the wrong
occurrence with only a "matched loosely" warning.
Assessment: Internally honest — the docs never claim step 8 shipped, failures are loud
and never invent a time, and two-tier precision (word timings, else measured-phrase
interpolation) bounds error to one clause.
Remediation: Implement step 8; keep phrase search as legacy fallback.

### [S6-b] Alignment verification and fallback honesty

Verdict: PARTIAL
Severity: MAJOR
Evidence: No per-word confidence exists (`core/src/storyboard.ts:588`). The
aligned-count check (`cue.ts:378`) is vacuous for the Whisper path: `mapToExpected`
(`align.ts:137-222`) always emits exactly one timing per expected token by construction,
filling unmatched tokens by interpolation between anchors with **no minimum-match-fraction
threshold** — a transcript that paired zero tokens yields a uniform spread between the
hypothesis's endpoints, returned as valid, cached in the timing sidecar, and logged as
"word-exact" (`narrate.ts:936-939`).
Divergence: The code cannot distinguish a word-exact placement from a fully-interpolated
one; `source: 'words'` is claimed even at 0% match.
Assessment: The honest paths are genuinely honest — model-load failure, empty hypothesis,
and per-clip exceptions all return `[]` and fall back to measured phrase boundaries
(real arithmetic, not fake timings; `align.ts:333-385`). Interpolation between matched
anchors is also correct treatment for Whisper's merge quirks. The gap is only the
degenerate end: an alignment that matched almost nothing is indistinguishable from one
that matched everything.
Remediation: Return the match fraction from `mapToExpected`; below ~50%, return `[]` so
the honest phrase fallback engages; record the fraction in the sidecar.

### [S6-c] Normalizer live test

Verdict: PARTIAL
Severity: MINOR
Evidence: See S2-c — run live this pass; results identical across both agents that tested
it (`α|0⟩`→"Alpha, zero ⟩.", `H₂O` unhandled, LaTeX leaks, the rest correct; also
`ATP`→"Ay tee pee", `mRNA`→"em are en ay").
Divergence/Assessment/Remediation: as S2-c.

### [S6-d] Duration drift

Verdict: PARTIAL
Severity: MINOR
Evidence: Per-render measurements exist (delivered WPM vs teaching band, clip-vs-sidecar
rescale, track-vs-timeline to 0.05s — `narrate.ts:809-931`), but the planned estimate is
never compared per render: `DELIVERED_WPS = 2.2` is a one-time calibration whose
re-measurement is a comment, not a mechanism.
Divergence: A cadence-rate or gap-table change silently invalidates the constant.
Assessment: The architecture defuses most of the risk — `scene.durationSec` is a
measurement, so sync reflows from reality; the estimate only budgets length.
Remediation: Warn when a run's own delivered w/s diverges from `DELIVERED_WPS` by >~10%.

### [S6-x] Audio caching and cloud alignment

Verdict: PASS
Evidence: Per-scene cache key = hash(normalized text, provider, voice, speed, sceneWpm,
padSec, hold, split mode, alignMode, phrase count, emphasis, CLIP_SIGNATURE, delivery
incl. engine/model) (`narrate.ts:654-682`; `elevenlabs.ts:140-142`), re-taken against the
provider that actually spoke; timing sidecars cached so cue resolution works on hits.
ElevenLabs returns timestamps natively (`/with-timestamps`, `elevenlabs.ts:419-439`);
Whisper runs only when provider timings are absent. Kokoro-first unkeyed,
ElevenLabs-first keyed (`providers/index.ts:53-80`).
Divergence: None material — the key exceeds the spec's formula.
Remediation: None.

### [D8] Fake word timings

Verdict: PARTIAL
Severity: MAJOR
Evidence: The count assertion exists (`cue.ts:377-378`) and does real work for provider
timings; for Whisper it is satisfied by construction (see S6-b) — the one path that can
produce fake timings is exactly the path the check cannot catch.
Assessment: Blast radius bounded: Whisper transcribes this pipeline's own clean TTS
output; a wrong `words[]` degrades element placement within a scene, never A/V sync.
The missing guard is one threshold, not a redesign.
Remediation: As S6-b.

---

## S7/S8 — Timeline and render

### [S7-a] Distinct timeline artifact

Verdict: PARTIAL
Severity: MINOR
Evidence: A genuine compiled timeline exists — `RenderPlan` (`render/src/types.ts:202`,
`compile.ts:396-538`) with per-item start/dur, baked motion/morph tracks, per-scene
cameras — pure and unit-testable, but in-memory only; its hash enters `cache.json`.
Diffability on demand via `planhash.mts` (deliberately excluding timing) plus
`sbhash.mts`/`geomhash.mts`.
Divergence: Not persisted.
Assessment: Strong case: the plan is a pure function of `storyboard.json`; persisting it
would create a drift-capable derived copy — the spec's own A1 argues against its S7
artifact (see Spec-is-wrong #4). Note `planhash` excludes timing, so a timing regression
is only visible via storyboard diff or frames.
Remediation: Optional `--emit-plan` or a timing-inclusive planhash mode.

### [S7-b] Camera velocity and zoom caps

Verdict: PARTIAL
Severity: MINOR
Evidence: Zoom caps exist and are principled: `MAX_CLOSEUP` 1.9× the film's median
framing (`camera.ts:139,450-457`), pull-out floor median/2.5 on 16:9 — past it the
camera walks instead of zooming (`camera.ts:132,282-291`); hard clamp [0.02, 60]. No
translation velocity cap anywhere; transitions are eased with duration floors (0.45s /
1.1s recap, `camera.ts:466-480`) — floors on time, not ceilings on units/sec.
Divergence: A long pan in the 0.45s minimum is fast and legal. Actual pan-speed maxima in
shipped films: UNKNOWN (not sampled this pass).
Assessment: The design argues legibility, not velocity, is the invariant — both clamps
are stated in letters-on-screen. Worst-case zoom ratio ≈ 4.75 (within the spec's ≤8×).
Remediation: Derive transition duration from pan distance
(`max(0.45, dist / maxUnitsPerSec)`).

### [S7-c] Dwell assertion

Verdict: PARTIAL
Severity: MAJOR
Evidence: No per-element dwell guarantee exists. Scene-level substitutes: `CADENCE`
floors/ceilings trailing silence 0.25–3s (`core/lesson.ts:374-381,625-636`); non-persist
ink stays through `sceneEnd` including the hold. Reveal-vs-span: draw duration is clamped
to fit the scene (`compile.ts:816-819`), but the 0.14s floor lets a cue landing in a
beat's last ~0.1s spill past `sceneEnd` into the next camera transition — the D4 shape —
and any element cued at fraction 0 draws during the incoming transition (transitions
occupy the first ≤0.7×dur of a scene).
Divergence: Spec wants max(1.2s, words×0.25s) asserted; cadence holds don't scale with
what was revealed, and two leak paths exist.
Assessment: On an accumulating board the camera only moves at beat boundaries and only
pulls wider, so elements are not driven out of frame — the common case is covered; the
guarantee is not.
Remediation: In `compilePlan`, warn when `start + dur > sceneEnd` or when a text item's
post-completion residence falls below a word-count floor.

### [S8-b] Fonts awaited

Verdict: PASS
Evidence: Handwriting font embedded as a base64 data URI with `font-display: block`
(`font.ts:155-167`), and the runtime still awaits `document.fonts.load` +
`document.fonts.ready` before `layoutAll()`/`seek(0)`/`__INKCAST_READY__`
(`runtime.js:1212-1229`; `browser.ts:75-82`). Measurement happens once, post-font.
Divergence: None. The system-stack fallback is the only cross-machine metrics risk —
logged, and mooted by the S4-b remediation.
Remediation: None.

### [S8-c] Sketch seeding

Verdict: PASS
Evidence: Seeds from stable identity, never call order or time: `new
Rng(seedOf(el.id, el.type))` (`compile.ts:1221`); morphs hold one seed across all baked
frames (`compile.ts:961-970`); raster sweeps seed from `data-ink-id`
(`runtime.js:527-537`); visuals uses per-mark seed bumps and the `seed: 0 → 1` guard
(`geometry.ts:19-26,168-187`). Boiling is structurally impossible: geometry is compiled
once; the browser re-rolls nothing. Tested (`sketch.test.ts:72,175`, `morph.test.ts:172`,
`compile.test.ts:46`).
Divergence: None. (Per-part rig seeds also pin identity across poses,
`character.test.ts`.)
Remediation: None.

### [S8-d] Sharding

Verdict: PARTIAL
Severity: MINOR
Evidence: Frames split across up to min(4, cores−1) workers, ≥24 frames/segment
(`render.ts:50-53,94-105`), each with its own browser context and piped ffmpeg segment
encoder; segments concatenated `-c:v copy` (`ffmpeg.ts:243-255`); seamless concat tested
(`render.test.ts:77-90`). Not independently retryable: one `Promise.all`, any failure
kills the render; the freshness cache is all-or-nothing. Documented wall-clock: ~76–133
ms/frame at 1080p; ~110s full encode for the benchmark; a 60s film ~40s.
Divergence: Shards are parallelisation workers, not cached, retryable units.
Assessment: Right trade for a single-machine CLI at current film lengths; determinism is
what makes the split safe, and would make per-scene shard caching safe too.
Remediation: Keep `seg-*.mp4` on failure and skip complete segments on retry if long
films become common.

### [S8-e] Motion blur

Verdict: MISSING
Severity: INFO
Evidence: Single instantaneous sample per frame (`render.ts:209-211`); no subframe
accumulation, no `tmix`/`minterpolate`.
Assessment: Defensible — crisp ink is the product; eased, short camera moves at 30fps.
If pans ever strobe, shutter accumulation (k seeks averaged) preserves determinism at ×k
capture cost.
Remediation: None now.

### [S8-x] Encoder pinning and idempotency

Verdict: PASS
Evidence: Explicit pinned settings — libx264, preset, crf 18, yuv420p, framerate from
plan, bounded threads (`ffmpeg.ts:135-162`), `-c:v copy` concat, aac 160k, exact `-t`,
`+faststart`; asserted in `render.test.ts:66-69`. Idempotency: render keyed on
hash(RENDER_VERSION, plan, frames, encoder params, audio+font signatures)
(`render.ts:135-145`), artifact-existence checked, second run a no-op, `force` explicit —
asserted (`render.test.ts:102-115`).
Divergence: None material.
Remediation: None.

---

## S9 — QC gate

### [S9-a] QC stage in the pipeline

Verdict: PARTIAL
Severity: MAJOR
Evidence: Blocking-in-pipeline: lesson schema retry loop + one critique revision inside
`teachLesson` (`lesson-anthropic.ts:311-373`); draw-audit → vision-critic → re-audit with
regression veto (`draw-anthropic.ts:435-489`, `draw-critic.ts:223-240`);
`plausibilityGate`; zod gates at every seam; voice/render output assertions
(`cast.ts:728-734,831-837`). Logged-and-continue: `critiqueLesson` at the `cast()` level
(`cast.ts:536-544`) — warns, records `problems` into `pipeline.json`, never stops the
run. Offline tools someone must run: `drawcheck/synccheck/tandemcheck/vocabcheck/sbhash`
(pipeline), `fillcheck/planhash/inkstat/frames` (render), `lanecheck/markcheck` (planner)
— nothing in `cast()` calls any `.mts`. Test pins: pinned-hashes, preset-mirror,
voice-key.
Divergence: No QC stage after compile; a lesson that fails critique still renders;
nothing inspects the compiled board or final frames before encode.
Assessment: Coherent design — cheap deterministic gates run where the artifact is
authored (the only place repair is cheap); judgement-shaped checks are offline tools with
test pins. Rendering a flawed-but-parseable lesson with problems persisted is a
defensible product choice ("render it, watch it, then edit the lesson"). The absence is
everything post-compile.
Remediation: A post-storyboard structural gate (the S4/S7 assertions above — they are
checks over data already in memory), and `problems` surfaced as a first-class verdict.

### [S9-b] Tier coverage

Verdict: PARTIAL
Severity: MAJOR
Evidence: Tier 1 — overlap: by construction + drawing-lane audit defects; contrast: true
by construction (fixed single-ink palette + colour-blind-safe pair, `palette.ts:44-62`);
dwell: cadence clamps, not asserted; elements-per-board cap: ABSENT (mark count is prompt
guidance, schema max 40; critique enforces a minimum, no maximum); beat duration: partial
(>60-word beats rejected; per-beat time deliberately not built). Tier 2 — `draw-critic`
shows the model its own drawing rendered by the real renderer (genuine pixels,
`draw-preview.ts`) — but only draw-lane pictures, only when the audit found defects, and
pre-compile; no final-frame sampling; OCR: none anywhere (grep). Tier 3 — absent
entirely; "take the facts from the document" is prompt-side only.
Divergence: Tier 1 ~60%, Tier 2 ~30%, Tier 3 0%.
Assessment: The by-construction substitutions are strictly better than detection where
they exist — a fixed palette cannot fail contrast. The assembled frame, where plot,
caption, terms row and camera interact, is verified only by humans running `frames.mts`.
Remediation: A sampled-frame vision pass with fixed questions, cache-keyed; a
claims-vs-source check on the document route.

### [S9-c] Blocking vs logged

Verdict: PARTIAL
Severity: MINOR
Evidence: Blocking: schema parses, voice/render output assertions, draw correction,
plausibilityGate, missing binaries. Logged: `critiqueLesson` at cast level, cue no-match,
missing emphasis/terms, silent-film render, failed drawing degrading lanes, and the
critic revising blind at **debug** level when no preview exists (`draw-critic.ts:163-167`).
Divergence: Most quality (vs integrity) checks log and continue.
Assessment: A principled split — integrity blocks, quality degrades with the reason
recorded ("the difference between degrading and lying", `lesson-edit.ts:237`). The
debug-level blind critic undermines the mechanism's whole justification and is nearly
invisible.
Remediation: Promote the blind-critic and cue-no-match paths into persisted `problems`.

### [S9-d] OCR round-trip

Verdict: MISSING
Severity: MINOR
Evidence: No OCR anywhere (grep over packages+docs: zero relevant hits).
Divergence: The spec calls this its highest value-per-line check.
Assessment: The design's case is unusually strong: board text is real vector text drawn
from IR strings ("the board can spell"); the image lane is forbidden words; narration
cuts happen at sentence boundaries; renderer text fits by binary search instead of
overflowing; the one real wrap defect class is caught arithmetically pre-render
(`draw-audit.ts:192-207`). What OCR would still uniquely catch — font-fallback failures,
renderer regressions — shrinks to near zero once the S4-b glyph assertion exists.
Remediation: A cheap OCR diff if a Tier-2 frame pass is built; low urgency.

### [S9-e] Failure granularity

Verdict: PARTIAL
Severity: MINOR
Evidence: Lesson critique failure → whole-lesson re-emit, once, told to keep good beats
verbatim. Draw defect → exactly one drawing corrected, marks written into `lesson.json`,
downstream re-derives by invalidation. No post-render QC exists to trigger partial frame
re-render.
Assessment: Granularity matches where QC lives; the gap is S9-b's, not this mechanism's.
Remediation: Frame-level QC patches should land in the IR (the existing pattern) once
per-scene segment caching exists.

---

## S10 — Edit and regenerate

### [S10-a] Regeneration granularity

Verdict: PARTIAL
Severity: MINOR
Evidence: Fully stage-incremental (`isFresh`/`markFresh` with `STAGE_CODE_VERSION`
keys); voice per-scene (`staleVoiceScenes`), visuals per-asset plus a board key that
excludes timing (re-voicing does not redraw). A one-beat text edit re-runs: storyboard
compile (local arithmetic), one scene of voice, visuals only if geometry moved, and a
full render.
Divergence: Render is monolithic — one cache key over the whole storyboard.
Assessment: Every expensive unit (model calls, TTS, generations) is incremental to the
smallest billable unit; the render is unpaid CPU at ~76 ms/frame. Rational and
cost-weighted.
Remediation: Per-scene segment caching if long films arrive.

### [S10-b] IR-diff → frame-range mapping

Verdict: FAIL
Severity: MINOR
Evidence: `renderFingerprint` hashes the entire storyboard (`keys.ts:443-453`); one
all-or-nothing check (`render.ts:135-154`); segment files deleted, never cached.
Divergence: Absent.
Assessment: The precondition (frame determinism) is already built and load-bearing.
Honest caveat: under `accumulate`, an edit to beat 2 legitimately changes every later
frame, so the true affected range is edit-point→end — a full re-render is only ~2× that
on average.
Remediation: Cache encoded segments keyed on (scene slice + prior-board-state hash).

### [S10-c] Model-free edits

Verdict: PASS
Evidence: Nine typed storyboard ops via a no-key regex parser or Claude, one validated
`applyOps` (`ops.ts:26-45`, `edit.ts:57-77`); lesson-level no-key edits for pacing,
trims, drops, swaps, refits (`lesson-edit.ts:75-223`); prose-needing edits matched by
`NEEDS_MODEL` and reported as `needsKey`, never silently ignored. Hand-editing either
JSON is a supported surface; edits invalidate exactly what they touch.
Divergence: No friendly asset-swap op (mechanically reachable via JSON).
Assessment: The spec's "IR as edit surface" done properly, at two altitudes.
Remediation: A `set-asset` op.

---

## Cross-cutting

### [X-b] Cache layers and keys

Verdict: PASS
Evidence: Layer 1 per-project `cache.json`: ingest (source ref + size:mtime), lesson
(LESSON_VERSION, adapter, provider/model, input, brief, preset…), storyboard (compiler
versions, route, `lessonHash`, meta…), per-scene voice, per-asset + board visuals,
render (whole storyboard + visualsFingerprint) — all prefixed
`pipeline@2/<stage>@<STAGE_CODE_VERSION>` (`keys.ts:165-289`) with artifact-existence
guards. Layer 2 machine-wide: illustrations, characters, drawings (brief + instruction +
underlay hash, corrected variants keyed separately). Layer 3: in-process memos. Net paid
cost of a one-beat edit: one scene of TTS, or $0 local — verified from the key inputs.
Assessment: The strongest subsystem in the audit; the voice cache keyed under the
provider that actually spoke shows real invalidation discipline.
Remediation: Document the layer map in PIPELINE.md.

### [X-c] Cost attribution

Verdict: PARTIAL
Severity: MINOR
Evidence: Per-stage `CostLine[]` from observed quantities (`cost.ts:119-186`), cached
lessons billed $0 (a documented phantom-cost bug fixed), mid-run voice demotion billed
correctly, $0.00 exact for local runs, per-day NDJSON spend ledger with ceilings and
explicit degradation (`spend.ts:252-367`), persisted per project.
Divergence: The drawing lane's 5–10 Sonnet calls, the critic's vision calls, and
lesson-stage underlay generations are not priced as lines — undercounting, not
fabrication.
Remediation: Emit cost lines from those call sites.

### [X-d] Observability

Verdict: PARTIAL
Severity: MINOR
Evidence: Verified on `projects/cardiac10`: a frame is reconstructible from stored
artifacts alone (storyboard → element+camera at t; visuals.json → exact path data;
timing.json → why it entered then; pipeline.json → providers, cost, problems, skipped,
timings). Gap: draw-audit defect lists and critic before/after scores live only in logs.
Remediation: A `qc.json` (or `pipeline.json` extension) with per-drawing audit outcomes.

### [X-e] Silent defaults

Verdict: PARTIAL
Severity: MINOR
Evidence: Mostly deliberate and spoken: heuristic planner downgrade (named `major` in
`degrade.ts:50-61`, logged with the fix command, recorded), voice demotion (recorded,
billed), cue no-match (warned, on purpose), TeX failure → TeX-as-text (logged),
missing narration → silent film (warned), budget-exceeded degradation (the anti-silent
exemplar: banner iff degraded). Genuinely silent: (1) `fallbackMatch` returns a score-0
generic icon for any unmatched query (`icons.ts:1420-1422`) with only a `how: 'fallback'`
field nothing surfaces — the most silent quality loss found; (2) the critic revising
without a preview, at debug level.
Remediation: Surface both into `Degradation`/`problems`.

### [X-f] Style packs

Verdict: PARTIAL
Severity: MINOR
Evidence: Four ink styles hardcoded; adding one touches the core enum
(`storyboard.ts:617`), `visuals/style.ts`, `render/palette.ts`, `render/types.ts:18`,
`render/font.ts:22-24` plus font files — 4+ files, 3 packages. `docs/STYLES.md`
specifies the declarative StylePack and admits the current state "is not a style system".
Assessment: Four coordinated personalities beat a half-built plugin system; hardcoding
keeps the fixed-accent discipline enforceable.
Remediation: The STYLES.md loader when demand exists; meanwhile a type-level pin tying
the three unions.

### [X-g] Idempotency

Verdict: PASS
Evidence: Every stage `isFresh` + `run.skip('cached')` end to end (`cast.ts:387-822`);
the renderer double-checks (`render.ts:146-154`); `rerender()` forces by name, which is
semantics, not a defect. `skipped[]` and `timings` make the no-op auditable.
Remediation: None.

---

# Closing sections

## 1. Invariant violations (A1–A8)

No invariant is cleanly violated in spirit; two are violated in letter with material
consequences:

- **A4 (measured text metrics) — the real violation.** Final placement is measured, but
  every planner-side reservation is chars×k, two estimators disagree with each other
  (0.52 vs 0.58) and a third catalogue disagrees with the renderer's type scale by 18%
  (`docs/HANDOFF.md` defect #0). This is the direct cause of the repo's own shipped
  D2-class defects ("empty stac", cardiac8 overlap at 2.1–2.5× estimate error).
- **A2/A3 (no model coordinates) — violated only on the legacy document route**, where
  the prompt requests `at` boxes and re-layout fails to rewrite arrow endpoints and
  path/motion waypoints. The product route is clean; the drawing lane is a fenced,
  argued exception.
- A1, A6, A8 diverge in letter but each divergence is a documented design with a better
  argument than the spec's (two-altitude IR; warn-don't-invent cue fallback; measured
  wipe preset) — see Spec-is-wrong.
- A5, A7 hold outright, with tests.

The single highest-value finding overall is not an A-invariant but its enforcement
shadow: **S4-b — no glyph-coverage check** (CRITICAL), which combined with the
math-prompt routing bug (S5-b) makes the reference product's worst defect (D1) reachable
and silent in this pipeline too.

## 2. Missing stages / capabilities, and what each absence exposes

| Missing                                    | Exposes                                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Grounding/retrieval (S0); source refs      | Bare-topic factual errors undetectable; Tier-3 QC impossible; post-cutoff/niche topics unsupported            |
| Post-compile QC gate (Tier 1 as blocking)  | Every documented shipped defect (17% board, cardiac8, "AV nod") rode through warnings                         |
| Tier-2 frame sampling / OCR                | Assembled-frame interactions (plot+caption+camera+terms) verified only by humans opening PNGs                 |
| Chemistry / circuits / geography / code    | Four topic classes degrade to confidently wrong pictures (image lane) or handwriting-font code, not a refusal |
| `entersAtWord` (PIPELINE step 8)           | Fuzzy phrase cues can mis-anchor reveals with only a "matched loosely" warning (D5 adjacent)                  |
| Alignment match-rate floor                 | Zero-match Whisper alignment ships plausible fake word timings labeled word-exact (D8)                        |
| Glyph coverage + math-path detection       | D1: Unicode math through the handwriting text path, silently                                                  |
| Per-element dwell / min-glyph-height check | D4: late-cued reveals mid-draw as the camera departs; 10.4px captions at the pull-out floor                   |
| IR-diff → frame-range render cache         | One-word edits re-encode whole videos (cost only; correctness unaffected)                                     |

## 3. Spec-is-wrong list

Places where the implementation is better than the document, or the document's number is
miscalibrated:

1. **A8 append-only is wrong at short lengths.** The spec derived it from four videos of
   89–511s. This repo measured it at ≤90s: `--board wipe` moved mean fill 55.5%→62.3%
   and regions 4→1 (`docs/CONTRACT.md`). The `explainer` preset's wipe keeps the single
   canvas, fractional timing, and entity library, expiring ink by `persistUntil` with
   camera framing history in lockstep. A per-preset, measured wipe is the better design;
   the spec's own §8 out-of-scopes removal while §2 bans it.
2. **The 55–85% fill band is calibrated for a metric this repo shows is misleading.**
   Bounding boxes overstate ink (`inkstat.mts`: fillcheck says 21.6% where real ink is
   4.7%); safe insets cap the theoretical max at 76.5%; derived shots are already within
   3% of the tightest fit; and the metric can be gamed by inflating boxes
   (`docs/PIPELINE.md` says exactly this). The benchmark itself (47.6%) would fail the
   spec's floor. Keep the check, recalibrate the number to the metric — or measure ink.
3. **"No x/y anywhere in the IR" (S3.1) is too blunt.** The two-altitude split — a
   semantic lesson IR the model authors, a geometric storyboard IR the compiler authors —
   satisfies the invariant's purpose (models never do coordinate math for layout) while
   making hand-editing, hashing, and byte-identical pins possible. A coordinate-free IR
   would push geometry into an unpersisted layer and lose all three.
4. **A persisted timeline artifact (S3.7/S7.7) contradicts the spec's own A1.** The
   render plan is a pure function of `storyboard.json`; persisting it creates a
   drift-capable derived copy. The repo resolves the tension in favor of A1 and provides
   diffability on demand (`planhash.mts`).
5. **Narration-after-visual-plan ordering (S2.1) is not the only fix for desync.**
   Co-generation with verbatim-substring constraints (cue/terms/emphasis must appear in
   the narration character-for-character; every beat must have a visual, enforced by
   critique) prevents the drift structurally, at half the calls.
6. **KaTeX (S5 routing table) is the wrong engine for this job.** KaTeX has no SVG
   output; MathJax emits placed glyph outlines in pure Node with no browser and no font
   files. The repo's deviation is simply correct.
7. **Per-beat `est_duration_s` (S1.5) would be a second opinion about one fact.** Word
   budgets are the unit an LLM can control and count; `adaptLesson` fits the whole
   lesson; this repo's worst historical bugs are exactly two catalogues of one number.
8. **Motion blur (S8.4) is not worth its cost here.** Crisp ink is the product; camera
   moves are eased and short; single-sample frames keep frame = f(t) trivially pure.
9. **OCR round-trip as "highest value-per-line" (S9.7) is overstated for this
   architecture.** Board text is deterministic vector from IR strings; truncation is
   prevented by binary-search fit; the image lane is forbidden words. Its residual value
   (font-fallback failures) collapses once the glyph-coverage assertion exists — which is
   the cheaper, earlier check.
10. **Topological beat ordering (S1.2) destroys information.** Pedagogical order carries
    intent a toposort's arbitrary tie-breaks discard; validate-don't-derive, with the DAG
    gating trimming (`droppableIds`), is the stronger use of the same data.
11. **The camera-velocity concern (S7.3) is better expressed in letters than in
    frame-widths.** The repo pins type size to the median framing and clamps zoom as a
    ratio to it — bounding what the viewer can read rather than how fast pixels move.
    (The one genuine gap — pan distance over a minimum-duration transition — survives and
    is in the backlog.)

## 4. Ranked remediation backlog (severity × effort; nothing implemented in this pass)

| #   | Fix                                                                                                                                                                 | Severity                  | Effort | Closes                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------ | ----------------------------- |
| 1   | Glyph-coverage assertion in `resolveVisuals` (cmap already parsed); missing equation geometry = error, not TeX-as-handwriting                                       | CRITICAL                  | S      | D1, S4-b                      |
| 2   | Advertise the `math` mark in `DRAW_BRIEF`/`FIX_BRIEF`; fix `lesson-anthropic.ts:230`; Unicode-math sniffer on `makeText` promoting to `makeEquation`                | MAJOR (CRITICAL-adjacent) | XS     | D1, S5-b                      |
| 3   | Match-fraction floor in `mapToExpected` (<~50% paired → `[]` → honest phrase fallback); record the fraction in the timing sidecar                                   | MAJOR                     | XS     | D8, S6-b                      |
| 4   | Strict mode promoting existing warn sites to errors (fill floor, equation fallback, missing font, cue miss on dominant visual), current behavior behind `--degrade` | MAJOR                     | S      | S4-g, S4-e, A-6               |
| 5   | One text-metrics stack: planner imports `visuals/fontmetrics`; delete `ADVANCE`/`MATH_ADVANCE`/0.58/0.6/0.62 estimators; unify FONT with TYPE_SCALE                 | MAJOR                     | M      | A4, D2, HANDOFF defect #0     |
| 6   | Three cheap `compilePlan` assertions: pairwise AABB per scene; revealed-element in-frame (authored cameras); dwell floor + reveal-past-sceneEnd warning             | MAJOR                     | S      | S4-c, S4-d, S7-c, D4          |
| 7   | Min on-screen glyph height post-zoom asserted per scene                                                                                                             | MAJOR                     | S      | S4-f                          |
| 8   | Merge the two style tables into `@inkcast/core` (the `boardMetrics` move, repeated); fixes the #d7263d/#2f6fed accent split                                         | MAJOR                     | S      | S5-c, PIPELINE step 10 (half) |
| 9   | Sampled-frame Tier-2 vision pass (N frames, fixed questions, cache-keyed); optional OCR diff                                                                        | MAJOR                     | M      | S9-b, D2/D3 detection         |
| 10  | Optional `sourceRef` on `LessonStep` for the document route; critique verifies against `source.json`                                                                | MAJOR (scope)             | M      | S0-b, Tier 3 enablement       |
| 11  | PIPELINE step 8: `entersAtWord` word indices end to end                                                                                                             | MINOR→MAJOR               | M      | S6-a, A-6, D5                 |
| 12  | Transition duration derived from pan distance (`max(0.45, dist/maxUnitsPerSec)`)                                                                                    | MINOR                     | XS     | S7-b                          |
| 13  | Surface the two genuinely silent defaults (score-0 icon fallback, blind critic) into `problems`/`Degradation`                                                       | MINOR                     | XS     | X-e                           |
| 14  | Figure-raster cache key gains style/model id; corner-whiteness check on figure rasters                                                                              | MINOR                     | XS     | S5-d, S5.6                    |
| 15  | Bill the drawing-author, critic, and underlay generations as cost lines                                                                                             | MINOR                     | XS     | X-c                           |

Items 1–4 are small, high-severity, and all of the "silently wrong output that looks
correct" class — worth doing before the launch work in `docs/HANDOFF-LAUNCH.md` invites
strangers to generate videos. Nothing in this report touches the launch blockers
themselves (Clerk production instance, first sign-in, key backup), which remain exactly
as HANDOFF-LAUNCH states them.

## 5. Closed by waiver

Added 2026-08-22 per `docs/PLAN-AUDIT-CLOSE.md` Phase 0.2. A waiver is a check this
repo deliberately does not implement, with the measured argument written where the
next auditor will find it. Each one rests on evidence in the tree; if the evidence
moves, the waiver is void and the check reopens.

**W1 — A-8 / S8-x, strict append-only.** Waived for the two authored exceptions.
`accumulate` (the default) is append-only end to end (`render/src/page/runtime.js:296-341`
— exits are opacity writes only). `--board wipe` and morph-`retire` are
camera-consistent by construction: framing history expires in lockstep via
`persistUntil` (`core/src/camera.ts:342-353`) and a retire never causes a reframe,
both pinned (`render/src/morph.test.ts:282`, `render/src/camera.test.ts:217`). The
wipe preset is backed by measurement, not taste: at ≤90s it moved mean fill 55.5% →
62.3% and regions 4 → 1 (`docs/CONTRACT.md:35`). The spec derived append-only from
89–511s films; at this repo's lengths the exceptions are the better design.

**W2 — S4-e's 55–85% number.** The _check_ is implemented (the fill gate, plan item
2.6); the spec's band is waived because it is calibrated for a metric this repo
measured as misleading: bounding boxes overstate ink by ~4.6× (`render/src/inkstat.mts:10`
— fillcheck 21.6% where real ink is 4.7%), safe insets cap the theoretical maximum at
76.5% (`core/src/camera.ts:36-61`), and the benchmark film (47.6%) would fail the
spec's own floor. The gate blocks at recalibrated numbers — re-recalibrated
2026-08-23, after plan 2.1 replaced the chars×0.52 estimate with real advances and
every reserved box tightened: the shipped longitude lesson re-measured at mean 20.3% /
min-scene 13.8%, and the photosynthesis board the plan named as the must-fail case
re-measured at 21.8% / 13.2% — within 1.5 points of a shipped film on every statistic,
which is bbox fill declaring itself unable to tell those two apart. So the floor sits
at **mean < 18% or any scene < 11%**: it blocks the unmistakably vacant class (the
MVP's lone caption in a void, Golpo's blank beats) and leaves "sparse but composed"
vs "sparse and empty" to the ink-pixel Tier-2 check (plan 3.3), where frames exist
anyway. The plan's original 25%/14% would have blocked a shipped lesson to fail a
board it cannot distinguish from it; the per-scene numbers are in the gate message,
and an override under `--degrade` is recorded in `pipeline.json` (`render.problems`).
**Amended 2026-08-25: the per-scene half is now 8%, not 11%** — measured across all 60
boards in `projects/`, where the 11% floor failed four scenes, every one of them in a
composed board, and caught nothing the mean floor did not already block. The argument
is the same one this paragraph makes, applied per scene instead of per board; it is
written up under W2 in `docs/HANDOFF-WAIVERS.md` and beside `MIN_SCENE_FILL` in
`render/src/compile.ts`.

**W3 — S3-b, "no x/y anywhere in the IR".** Waived for the storyboard. The
two-altitude split — a semantic lesson IR the model authors, a geometric storyboard IR
the _compiler_ authors (`core/src/storyboard.ts:10-13`, `planner/src/compile.ts:22-25`)
— satisfies the invariant's purpose (a model never does coordinate math for layout,
A-3 PASS) while keeping hand-editing, hashing and byte-identical pins
(`planner/test/pinned-hashes.test.ts`) possible. Coordinates in a compiler-authored
artifact are not a defect. The document route's genuine leak is tracked as plan 5.6,
not waived.

**W4 — S8-e, motion blur.** Waived. Frames are single instantaneous samples
(`render/src/render.ts:209-211`) and that is the product: crisp ink, eased short
camera moves, and frame = f(t) trivially pure. Revisit only if a pan ever visibly
strobes in review; shutter accumulation (k seeks averaged) preserves determinism at
×k capture cost if it does.

**W5 — S1-x, per-beat `targetSec`.** Waived. Word budgets are the enforced unit at
every layer — `maxWordsPerBeat` clamped at sentence boundaries
(`planner/src/presets.ts:314-379`), whole-lesson fit by `adaptLesson`
(`presets.ts:604-680`), the estimate at `DELIVERED_WPS` (`presets.ts:118`) — and a
per-beat seconds field would be a second opinion about the same fact, the duplicated-
number defect class this repo keeps finding (`docs/PIPELINE.md:255-266`). Per-beat
drift stays measurable after the fact from `timing.json`.

**W6 — S2-a, narration-after-visual-plan ordering.** Waived. Co-generation in one
forced tool call with verbatim-substring constraints — `cue`/`terms`/`emphasis` must
appear in the narration character-for-character, rejected otherwise
(`core/src/lesson.ts:721-727`), every beat must carry a visual
(`planner/src/lesson-anthropic.ts:311-317`) — prevents the desync the spec's ordering
guards against, structurally, at half the model calls. Ordering is not adopted.

**W7 — S0-a, retrieval at intake.** Added 2026-08-24, with plan item 5.1. **Half of this
finding is closed by code and half by a written deferral, and the split is the point.**
The honesty ships: a run records `grounding: 'document' | 'parametric' | 'supplied'` in
`pipeline.json` (`pipeline/src/state.ts`), derived from what actually reached the lesson
author rather than from `source.kind`, and it is said out loud by the CLI's `grounded` row
and the studio's `GroundingNote`. That is the audit's own stated minimum — "or at minimum
flag bare-topic lessons as ungrounded in the project record".

The retrieval lane itself is deferred, and the decision is argued in full in
`docs/PLAN-RETRIEVAL.md`: **not** the `SEARCH_API_KEY` lane the plan's letter proposed
(which would put retrieval _policy_ — how many results, which to fetch, when to stop — in
the planner, the enumeration mistake `Mark`'s own docstring is about, and add a fifth key
to a four-lane degradation story) but the server-side web-search tool on the lesson call
the pipeline already makes. Three reasons it is not built yet, in order of weight: the
load-bearing half has shipped; **nothing in this repo measures factual accuracy**, so
"retrieval makes the films better" is currently a belief and Tier 3 — the instrument — cannot
exist before a source does; and Phase 6.1's honest guard for the four undrawable topic
classes is a larger class of visible defect on the same week. The trigger for building it
is written down: one film whose facts are wrong in a way retrieval would have caught, now
findable because every film on disk says which kind it is. If that arrives, the waiver is
void and `docs/PLAN-RETRIEVAL.md` §2 is the implementation.

**W8 — S5-a, the three unserved lanes.** Added 2026-08-24, with plan item 6.3. **The
honesty ships and the lanes do not, and unlike W7 the deferral is a measurement rather
than a judgement.** 6.1's guard names every picture a lesson asks for that no renderer
here can draw, reports it into `qc.json` as a warning, and says what will be drawn
instead — which converts the audit's finding, "the fallback is a confidently wrong
picture and nothing says so", into an honest limit.

6.3's rule for what to build next is that lessons choose it: "the lanes get built in the
order real lessons ask for them, and the frequency of these findings is how that is
measured". That rule was unrunnable until 6.3 shipped `pipeline/src/lanedemand.mts`, which
runs the guard over every lesson on disk. Its answer today, over **54 lessons and 13
distinct topics**, is that **no lesson anybody wanted a film of asks for any of the three
lanes**. The only findings on record are the three in `projects/qc61-aspirin`, which was
authored into a scratch directory to prove the guard fires — counting a fixture as demand
is a vote for building something nobody asked for, which is the failure 6.1's own
precision-over-recall note warns about, so the instrument reports fixtures in a separate
column.

Building on a zero signal would be the taste-driven decision the plan wrote the rule to
prevent. So what 6.3 ships instead is everything a lane needs except the lane: a one-page
doc apiece with the dependency argued against real package data
(`docs/LANE-CHEMISTRY.md`, `docs/LANE-GEOGRAPHY.md`, `docs/LANE-CIRCUITS.md`), a corrected
ranking, and a repaired tripwire. **The plan's own ordering is overturned in writing**:
"circuits first; closest, curated `symbols/circuit/*` already exist" rests on symbols that
have never existed in this repo — the library holds seven assets and none is a circuit —
and on `schemdraw`, which is a Python library and can never be a dependency here.
Chemistry ranks first instead, on the only evidence anyone has: a rendered film in which a
beat asking for a hydroxyl group put the formula **B₄H₂** on the board, captioned, in ink.

The trigger is written down and is a number rather than an opinion: **two lessons somebody
wanted, in the `demand` column of `lanedemand.mts`.** If that arrives, this waiver is void
and the lane doc for whichever lane it is becomes the implementation. Two other things
void it, both of which `auditcheck` now enforces rather than trusting to memory: any of
`openchemlib` / `smiles-drawer` / `@rdkit/rdkit` / `topojson-client` / `d3-geo` /
`world-atlas` appearing in a manifest, or `symbols/circuit/` appearing in the asset
library.
