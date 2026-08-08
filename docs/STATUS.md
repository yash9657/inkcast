# Inkcast status

> **Partly superseded — see the three sections appended at the end: the re-verification
> (2026-07-29), the asset library (2026-07-29, later) and character rigs (later still).**
> The 07-28 report below is left unedited on purpose: it is a dated record of what was
> measured, not a live checklist. Six of its claims no longer hold. Read the appendix
> before acting on anything here.

Written by the verification agent, 2026-07-28, against the working tree at
`9d138b3` (nothing committed). Every claim is backed by a command run on this
machine. Where something is broken it says so, and the gaps section is longer
than the wins.

**Machine:** macOS 15.6 (Darwin 24.6), Node v22.17.0, ffmpeg 8.1.2, Playwright
Chromium. **Zero API keys** for every render below; `providers` reports
`planner heuristic · voice kokoro · images builtin` and every run ends
`cost $0.00 — nothing left this machine`.

## Verifiably working

`pnpm lint` clean · `pnpm -r typecheck` 0 errors across 9 projects ·
`pnpm -r test` **486 pass, 0 fail, 3 skipped** (keychain tests opt-in) ·
`apps/web` 24 pass · `pnpm --filter @inkcast/web build` 0 warnings.

**The benchmark renders from the shipped hand-authored lesson with no key, in
both formats, first try.** No fix was needed to _get_ an mp4 — every fix below
was for what the mp4 showed.

|                            | 16:9                              | 9:16 `--short`                |
| -------------------------- | --------------------------------- | ----------------------------- |
| output                     | 1920x1080 h264 + 24 kHz aac mono  | 1080x1920 h264 + aac          |
| ffprobe duration           | 104.667 s                         | 61.500 s                      |
| storyboard `totalDuration` | 104.635 s (delta 32 ms = 1 frame) | 61.470 s (delta 30 ms)        |
| scenes                     | 9                                 | 6 (compiler cut 3 for budget) |
| audio                      | mean -23.3 dB, peak -2.8 dB       | mean -23.1 dB, peak -3.6 dB   |
| narration pace             | 151 wpm (target 140-160)          | 151 wpm                       |
| wall clock                 | 110.5 s                           | 58.3 s                        |

Audio is present and non-silent in both. `silencedetect=noise=-45dB:d=1.5` finds
only the authored `hold` gaps and the outro, not dead air.

**Measured cost and speed per finished minute** (this machine, no keys): 16:9
**63 s wall / $0.00**; 9:16 **57 s / $0.00**; cached `rerender` with voice reused
**26 s / $0.00**; studio SSE run **53 s / $0.00**. Roughly 1x realtime cold, 4x
warm. Marginal cost is genuinely zero against a $0.20/min target.

**BYOK, proven with a deliberately invalid key.** `keys set anthropic` stored it
in the macOS keychain; `keys list` showed only `sk-ant-api03-ZZ…AAAA`;
`keys validate` exited 1 with
`✘ anthropic: key rejected (from keychain) — {"type":"error",…"API key is invalid."}`.
A full `teach` run with that key hydrated hit a real 401, warned, and degraded to
the derived lesson. `grep` for a 47-character interior slice of the key found
**zero** hits across the repo, `projects/`, `~/.inkcast`, all three render logs,
the Next server log, the 351-event SSE stream, and `/api/{projects,providers,keys}`.
Only the keychain held it; `keyvault-meta.json` held only the mask. `keys delete`
removed the keychain item and emptied the meta.

**Studio end to end.** `next start` after `rm -rf .next`: `/settings` 200
(25.9 kB, no `sk-ant` substring), `/api/providers` and `/api/keys` return masked
status only, `POST /api/generate` returned 202 plus a `streamUrl`, the SSE stream
ran 351 events through ingest → lesson → storyboard → voice → visuals → render to
`{"done":true,…"durationSec":36.07}`, and `/api/media/…/out.mp4` served a valid
1920x1080 h264+aac file. Server killed afterwards.

## Frame-by-frame assessment (the real acceptance test)

I extracted about 60 frames across both timelines and read them. On the first
pass, before any fix, the verdict was **no** — it failed nearly every question.

**Is there a real drawn loss curve with hand-drawn axes?** Yes, and it is the
best thing in the video: roughened axes with arrowheads, a real parabola revealed
left to right, `height` / `where you stand` / `loss` in handwriting. Six
independent plots across the film. A genuine capability the MVP did not have.

**Is the tangent at the right slope?** Yes, and correct by construction rather
than by eye. `deriveBowl` fits `(w-1)²` so the slope at w = 3 really is +4; the
drawn tangent is `m.y(y ± slope·span)` through the same mapping as the curve; the
board's `w ← 3 − 0.1 × 4 = 2.6` is _computed_ from those numbers; and the steps
3 → 2.6 → 2.28 → 2.024 are a real descent run on the drawn curve. A learner who
checks the arithmetic is rewarded.

**Does the ball actually MOVE down the curve?** Now yes — it was two bugs. (1)
The voice stage rewrote `enter.at` from the cue and left `motion` behind, so the
ball popped in at 90% of the beat already 91% along its path: it teleported to the
bottom. (2) The planner maps data space across the plot's whole `at` box while the
renderer insets that box for axis gutters, so the ball was drawn _off the curve_,
sitting on the x-axis while the staircase stepped down the curve correctly a few
dozen units away — two disagreeing pictures of the same descent. Both fixed;
consecutive frames at 72.5 / 73.5 / 74.5 / 75.5 s now show it on the curve at
w ≈ 3.0, 2.7, 2.5, 2.15. The ease-out makes the final ~2 s look static.

**Does the board ACCUMULATE?** Yes within a region, and it is real: by 66 s the
frame holds four plots drawn across four separate beats, and the 95 s recap pulls
back over two hillsides, six plots and the recap chain — visibly far more ink late
than early. But it was **badly broken between regions**, and this was the worst
defect found. The shipped lesson cues six of its figures on the _closing clause_
of their beat ("so draw it as a curve"), the resolver honoured that faithfully,
and the camera cut to a fresh region — so twice the video showed **eight seconds
of a caption alone in an empty frame**. Fixed by capping a beat's dominant
_figure_ at 15% of the narration; text is exempt, because a line written as it is
spoken is the feature. Residual: 2-3 s of caption-only at each region change. Mean
content fill is **48% (16:9) / 53% (9:16)** — better than the MVP's ~20%, still
not "full".

**Does content fill the frame?** Mostly. Single-plot beats are excellent (t = 27 s
and t = 71 s genuinely fill the frame). Beats with one figure in a two-cell region
leave a visibly empty half (t = 33 s, t = 83 s), and the hook wastes the lower
right.

**Is all text legible, wrapped, never truncated, never overlapping?** Now largely
yes; it was bad. Five ellipsised captions, including
`"How big a step is the one knob you…"` and — worse — inside the recap chain,
where the board is meant to _be_ the summary. `shorten()` now drops dangling
function words instead of ellipsising. Overlaps were systemic, because each plot
label site is chosen from local geometry by phases that never see one another:
`"the bottom"` printed through the y-axis, `"how wrong we are here"` across the
curve, `"too small"` / `"too large"` through each other, and `"loss"` printed
twice on four plots (axis name _and_ curve name). Added a deterministic
de-confliction pass over the finished plot phases, plus a redundant-label rule.
Remaining: the `downhill` arrow label still clips the tangent label (arrows are
separate elements, outside the pass), and captions silently lose words — "The
slope tells you which way" drops "is down".

**Is the 9:16 deliberately vertical?** Yes: a 1640x9560 canvas the camera walks
down, two hillsides stacked, heavier ink and larger type. Not a crop. But its
recap was the worst frame in either film — `role: 'recap'` was exempt from the
pull-out limit, so it fitted a 1:5.8 board into a 1:1.78 frame and rendered the
entire lesson as a ~90-pixel-wide ribbon of illegible marks. The recap now obeys
the same legibility floor as every other beat: readable, but it no longer shows
the whole board, which at this canvas aspect is geometrically unavoidable.

## Fixed during verification

- `packages/voice/src/cue.ts` — a cue no longer strands `motion`; a mover's cue
  anchors the _movement_ with `MIN_TRAVEL` guaranteed; a beat's dominant figure is
  capped at `MAX_DOMINANT_AT`.
- `packages/render/src/compile.ts` — `rebaseOntoPlot` carries plot-relative
  coordinates through the renderer's own axis gutters.
- `packages/render/src/plot.ts` — label de-confliction; a curve label equal to the
  axis name is suppressed.
- `packages/render/src/camera.ts` — the recap obeys the pull-out limit.
- `packages/planner/src/text.ts` — `shorten()` never ellipsises.
- `packages/planner/src/plots.ts` — `\bspeed|rate\b` matched "learning rate 0.1"
  and labelled the worked example's loss axis **"rate"**: loose alternation fixed
  and the step-size sense vetoed. Duplicated learning-rate panel labels removed.
- `packages/planner/src/lesson-derive.ts` — stopped telling users with a _rejected_
  key that they have no key; fixed a run-together sentence.
- `apps/cli/src/commands/keys.ts` — hard-coded column widths printed
  `sk-ant-api03-ZZ…AAAAkeychain`, welding the mask to the next column in the one
  view whose job is to prove a key is masked. Widths now measured from content.

Eight regression tests added (voice x2, render x3, planner x3). The camera test
was verified to fail against the old code before being kept.

## Partial

- **Accumulation is per-region, not per-board.** Each new region opens empty and
  costs 2-3 s of caption-only screen.
- **The anchor draws a second hillside** instead of annotating the first, so the
  board shows two hills side by side. The brief's key move — the hill _morphing_
  into the plot — does not happen at all; the plot simply appears elsewhere.
- **The recap is a new flowchart** in an empty corner rather than the accumulated
  board annotated. The camera does pull back over everything on 16:9.
- **The "ball" is a small dark wedge**, not a recognisable ball, and it is black
  while its own trail is blue.
- **Voice** is intelligible, correctly paced and word-aligned (39/39 elements
  placed word-exactly) but flat. Root cause 4 of `LESSON-ENGINE.md` — "default to
  a genuinely good voice" — is not met without an ElevenLabs key.
- **Topic-only lessons degenerate.** `teach "compound interest"` with no key
  produced a 1-step, 20-second lesson. Confirms integration's report.

## Missing or broken

- **Two vaults.** The studio writes `<repo>/.inkcast/keys.json`; the CLI writes
  the keychain. With a key in the keychain, `/api/keys` still reported
  `"configured": false`. A key set in one place is unusable from the other. Not
  fixed here: that route is the most security-sensitive file in the repo and needs
  new `keyvault` public API, not a caller patch.
- **`visuals.json` and 40 per-element SVGs are written and never read.** The
  renderer re-derives all geometry from `packages/render/src/plot.ts`, so
  `packages/visuals/src/plot.ts` — which already contains a _richer_
  label-placement solver than the one I had to add to the renderer — is inert in
  the render path. Two plot implementations that must agree by hand. This is the
  largest structural problem in the codebase and it is invisible from outside.
- **`illustration` never resolves without a key**, and the "hand-authored SVG cast
  of archetypes" the brief asks for does not exist. Characters are stick figures.
- **`next build` over a dirty `.next`** leaves a 0-byte `prerender-manifest.json`
  and `next start` dies on the first request. `rm -rf apps/web/.next` first.
- **`/api/generate` rejects unknown `meta` keys** with a 400 instead of ignoring
  them; `seconds` is accepted by the CLI but not by the API.
- `keys validate` surfaces the provider's raw JSON body rather than a curated hint.

## Verdict: does the gradient-descent video now teach?

**Partly — enough that the answer moved from "no" to "yes on the one question
that matters", but not enough to call it good.**

Could someone who does not know calculus explain why the update has a minus sign
after watching? I think yes, and that is a real change. The chain is now genuinely
_shown_: you are on a foggy hill; the hill becomes a curve with drawn axes; a
straight edge laid on the curve tilts up to the right; the words "uphill is right,
so step left" sit under a tangent that really has slope +4; and a ball then rolls
left down the curve while `w ← 3 − 0.1 × 4 = 2.6` is written above it. Nothing is
asserted that is not drawn, and the arithmetic on the board is computed from the
drawn curve, so it survives a sceptical learner checking it.

What still stops it being a video I would send to someone: the abstraction never
_earns_ its keep visually. The hill and the graph are two separate drawings, so
the single most important moment in the lesson — that they are the same thing — is
carried entirely by narration. Half the frame is often empty. Every region change
opens on a caption in a void. And the narrator is a robot. Those are quality
failures rather than capability failures, which is the honest good news: the IR
can now express the picture, and the remaining work is craft in the compiler
rather than another rebuild.

---

# Re-verification, 2026-07-29

Written after four changes landed on top of the report above — lesson schema v2, the
morph, two ink modes, and the equation lane (`PIPELINE.md` steps 6, 1, 2, 3). Measured
against the working tree at `6606edb` plus the cache-gate fix, on the same machine and
with the same **zero API keys**: `providers` reports
`planner heuristic · voice kokoro · images builtin`, and both runs end `cost $0.00`.

The 07-28 report is not edited. This appendix says which of its claims have moved and
what the numbers are now.

## Which claims above no longer hold

| Claim in the 07-28 report                             | Now                                                                                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Two vaults** (Missing or broken)                    | Fixed. One vault, shared by the CLI and the studio.                                                                                  |
| **The anchor draws a second hillside** (Partial)      | Fixed. The hill morphs into the plot in place, derived from `analogy.maps`.                                                          |
| **Mean content fill 48% / 53%**                       | Re-measured: **52.2% / 55.9%**.                                                                                                      |
| **`visuals.json` … written and never read**           | Half true. Plots are resolved through the visuals stage's own resolver; equations are read from the sidecar. Everything else is not. |
| **`w ← 3 − 0.1 × 4 = 2.6` is on the board** (as text) | Still on the board, now as **typeset mathematics** — a real minus and a real arrow, not font substitutes.                            |
| **486 pass**                                          | **528 pass, 0 fail, 3 skipped.**                                                                                                     |

Everything else in the report stands, including `illustration` never resolving without a
key, the flat local voice, topic-only lessons degenerating, and the caption-in-a-void at
each region change.

## Gates

`pnpm lint` clean · `pnpm -r typecheck` 0 errors across 9 projects ·
`pnpm -r test` **528 pass, 0 fail** across all eight test-bearing packages
(`keyvault` reports 58 tests / 55 passes — three keychain tests are opt-in).

## The benchmark, both formats, from the shipped hand-authored lesson

Rendered with `cast … --force`, no keys, first try in both formats.

|                        | 16:9                    | 9:16 `--short`                |
| ---------------------- | ----------------------- | ----------------------------- |
| output                 | 1920x1080 h264 + aac    | 1080x1920 h264 + aac          |
| ffprobe duration       | 104.667 s               | 61.500 s                      |
| video frames           | 3140                    | —                             |
| reported `durationSec` | 104.64 s                | 61.47 s                       |
| scenes                 | 9                       | 6 (compiler cut 3 for budget) |
| mean content fill      | 52.2% (min 32, max 100) | 55.9% (min 37, max 100)       |
| voice stage            | 55.7 s                  | 34.7 s                        |
| visuals stage          | 0.29 s                  | 0.26 s                        |
| render stage           | 41.2 s                  | 30.1 s                        |
| sum of stage timings   | 97.1 s                  | 65.0 s                        |
| `lessonProblems`       | none                    | `estimated 101s exceeds 60s`  |

The duration is unchanged from 07-28 to the millisecond, which is the expected result:
none of these four changes touched narration, and duration is set by the audio.

**The render stage is 41.2 s where the 07-28 report measured 110.5 s of wall clock for
the whole run.** Those are different quantities — that figure was end-to-end and this is
one stage — so treat 41.2 s as the first measurement of the render stage alone rather
than as a speed-up anyone has demonstrated.

## What the frames show that they did not

Read at the plot-dense and worked beats in both aspects.

**Plots are `crisp`.** Axes are exact straight lines with clean single-stroke arrowheads,
and curves are smooth sampled parabolas rather than roughened polylines. The handwriting
is untouched, so the board still reads hand-drawn — a hand-drawn board carrying an
accurate graph, which is the whole point of having two ink modes.

**The worked example's update line is real mathematics.** `w ← 3 − 0.1 × 4 = 2.6` is set
from TeX as glyph outlines: an italic `w`, a true `←`, a proper minus distinct from a
hyphen, `×` and `=`. It reveals left to right with the pen tracking the write position.
Verified in both aspects — 16:9 at t≈78.5 s, 9:16 at t≈52.2 s.

**Timing note, not a defect.** The equation's cue resolves to 82% of the worked beat, so
it arrives _after_ the descent has been drawn and after the "steps shrink as it flattens"
annotation. For a worked example the arithmetic arguably wants to land with the descent
rather than behind it. That is cue resolution doing exactly what it was asked to; whether
the cue is the right one is a pedagogy question for the beat, not a rendering bug.

**Scale differs between aspects.** In 16:9 the equation is about twice the caption's
height; in 9:16 it is slightly smaller than the caption. Vertical output applies a 1.42x
type gain to _text_, and an equation is geometry fitted to a planner-measured box, so it
does not grow with it. Legible in both, but the emphasis is inverted on the format where
the line matters most.

## Fixed while re-verifying

- `packages/pipeline/src/cast.ts` — `rerender()` gated the visuals stage on a board hash
  and **named no artefacts**, so a project whose `assets/` had been deleted or truncated
  read as fresh and skipped the stage. `cast()` had been tightened for this and
  `rerender()` had not. The cost of that grew with step 3: a missing manifest used to mean
  the renderer re-resolved plots in-process, wasteful but correct, whereas an equation
  cannot be typeset in the renderer at all and degrades to raw TeX on the board. Both
  entry points now take the artefact list from one exported function, `visualsArtefacts`,
  because writing it twice is what let them drift. Four tests pin it.

## Verdict

The 07-28 verdict — "partly; the answer moved from no to yes on the one question that
matters" — still reads correctly, and two of the three things it named as blocking are
now addressed. The abstraction does earn its keep visually: the hill morphs into the
plot in place rather than the graph appearing beside it. The numbers on the board are now
notation rather than an approximation of notation.

What it named that is still true: half the frame is often empty, every region change opens
on a caption in a void, and the narrator is a robot without a key. Those remain quality
failures rather than capability failures.

# The asset library, 2026-07-29 (later)

`PIPELINE.md` step 4. Appended rather than folded into the appendix above, because it is a
separate measurement on a later tree and the two should stay distinguishable.

**The benchmark is unchanged, and that is the expected result.** It contains **zero
assets**, so it cannot exercise the library at all; it was re-rendered to confirm the
`visuals@6` bump and the new lane broke nothing on the way past.

| Benchmark, both formats | 16:9                    | 9:16                    | vs the appendix above |
| ----------------------- | ----------------------- | ----------------------- | --------------------- |
| ffprobe duration        | 104.667 s               | 61.500 s                | identical             |
| video frames            | 3140                    | —                       | identical             |
| scenes                  | 9                       | 6                       | identical             |
| mean content fill       | 52.2% (min 32, max 100) | 55.9% (min 37, max 100) | identical             |
| visuals stage           | 0.26 s                  | 0.27 s                  | ~same                 |
| render stage            | 38.8 s                  | 23.4 s                  | 41.2 s / 30.1 s       |
| cost                    | `$0.00`                 | `$0.00`                 | identical             |

Read the two render-stage figures as **machine variance, not a speed-up**: nothing in this
change touches the renderer, and a single unrepeated run either side cannot tell those
apart. Content fill was computed with the new `render/src/fillcheck.mts` rather than copied
forward — the number happens to be identical to two significant figures, which is what an
unchanged storyboard should produce.

## Which earlier claims no longer hold

| Claim                                                      | Now                                                                                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **`illustration` never resolves without a key** (07-29)    | Half fixed. A **character** resolves without a key, from the curated cast. An arbitrary object still degrades to a lucide icon. |
| **Characters are stick figures or lettered cards**         | Fixed for the four archetypes: standing, walking, pointing, sitting, hand-authored and reviewed like code.                      |
| **No shared library, no versioning, no cross-video reuse** | Fixed. Assets resolve by path and pinned version, and the generated-raster cache is machine-wide rather than per project.       |
| **`LESSON-ENGINE.md` §3 "a dead end for characters"**      | Addressed, and that section is rewritten to say which of its three options was taken.                                           |
| **528 pass**                                               | **539 pass, 0 fail, 3 skipped.**                                                                                                |

## Gates

`pnpm lint` clean · `pnpm -r typecheck` 0 errors across 9 projects ·
`pnpm -r test` **539 pass, 0 fail** across all eight test-bearing packages.

**Control, and it is the load-bearing evidence here.** `projects/handwritten` is the only
project with `asset` elements, and its two — `cpu` and `ram` — must stay on the icon lane.
Per-element geometry hashes are **byte-identical** either side of the change
(`visuals/src/geomhash.mts` across a `git stash -u`), so inserting a lane ahead of the icon
lane moved nothing that was already being drawn. That is the assertion that matters, because
an over-reaching alias list is this change's most likely way to do damage and it would do it
silently.

## What the frames show

Rendered with `visuals/src/libsheet.mts` and one frame at t=18 s. No keys, images forced
off.

**All six read as drawings rather than as glyphs**, at the same weight and with the same
construction, which is what makes them a set. The figures are `sketch` and the two symbols
are `crisp`, side by side in one frame — the clearest demonstration so far that the two ink
modes coexist as PIPELINE claims rather than being a build switch.

**Two defects were found this way and only this way.** The first cast rendered with
**diamond heads**: a `<circle>` converts to two half arcs, which gives the sketch pass four
control points to displace, and at marker roughness that reads as a rhombus. The heads are
now four cubics anchored at the compass points. The second was worse — a **ringed head with
nothing inside it**, because a fill was being set on sketch output after the fact, and
roughjs returns the wobbly _stroke_ it drew rather than the authored contour, so the fill
was filling the outline of a pen line. Sketch fills now go into the rough options so roughjs
hachures the region itself. Neither was visible in the SVG, in the types, or in a test that
only counted paths.

**`figures/sitting` was reworked after looking at it.** The stool line crossed the thigh and
read as a strike-through, and two arms in profile merged into a blob against the torso. It
is now one arm, one leg, and a seat that sits below the thigh rather than across it.

## What is deliberately not done

- **No `characters/`.** A rig is step 5, and the distinction is the point: four poses are
  not a cast, because nothing yet draws _the same person_ standing and then walking.
  (**Superseded by the next section** — `characters/explorer` now does.)
- **The planner never emits an `AssetRef`.** Nothing upstream knows the library exists;
  entities reach it through the alias table or not at all. That is why the alias lists are
  narrow and why `Asset.ref` is written _back_ after resolution.
- **`symbols/` is two files.** `circuit/` and `math/` are step 9, and the two physics
  symbols exist to prove the path namespace nests, not to be a symbol set.

# Character rigs, 2026-07-29 (later still)

`PIPELINE.md` step 5, and **half of it**. The composed half is done and pinned; the generated
half is implemented but cannot be verified on this machine and is not claimed. That split is
the main thing to take from this section.

## The acceptance bar, precisely

> _Done when:_ the same character across three beats is pixel-identical where composed and
> above threshold where generated.

**First clause: met, and pinned as bytes.** `the same character composes identically across
poses` composes `standing`, `walking` and `pointing` from
`assets/library/characters/explorer.v1.json` into one box and asserts the `head` and `torso`
stroke data are _identical strings_ in all three — then asserts the legs and arms are _not_,
so it cannot pass by drawing one picture three times. Confirmed visually too: the five poses
on the contact sheet share one head.

**Second clause: not met, and not attempted dishonestly.** Nothing in the repo generates a
pose. `PoseGenerator` is an injected seam; the cache, the single retry, the gate and the
fallback are real and tested against stubs. What is missing is an image-to-image adapter and
the embedding check — see "The boundary" below.

## Gates

`pnpm lint` clean · `pnpm -r typecheck` 0 errors across 9 projects ·
`pnpm -r test` **557 pass, 0 fail, 3 skipped** across all eight test-bearing packages
(539 → 557; 18 new character tests, two of which pin the variant cache round-trip).

**Control: `projects/handwritten` geometry hashes are byte-identical** to the pre-step-4
baseline, so neither the library lane nor the rig work has moved a single stroke of anything
that was already being drawn. Nothing was bumped in `STAGE_CODE_VERSION` and the file now
explains why: no existing asset's output changed, and an asset that newly resolves to a rig
invalidates itself through `libraryFingerprint` rather than dragging every project through a
recompute.

## What the frames show

`npx tsx packages/visuals/src/libsheet.mts` now expands a rig into one cell per pose, which is
the only way to review the thing that makes it a rig. Eleven cells, one frame at t=20 s, no
keys.

**The five explorer poses read as one person.** Same head, same torso, same weight; `walking`
reads unmistakably as mid-stride, `pointing` as pointing, `sitting` as seated. `thinking` is
identical to `standing`, which is correct — it is the generated pose drawing its fallback.

**Two defects were found by looking, again.** The resting arms were authored _inside_ the
torso outline, so in profile they vanished into it and the figure read as a blob with a head;
they now hang just outside the silhouette either side. And `sitting` drew both legs, which in
profile land on top of each other and read as tangle rather than as legs — the far leg is now
hidden for that pose, the same call `figures/sitting` makes by hand.

**The rig's `viewBox` was measured, not guessed.** It has to contain the widest pose
(`pointing`, reaching to x≈113) while being fitted identically for the narrowest
(`standing`, 46 units wide), so a rigged figure sits in more air than a hand-authored one.
That is the cost of identity and it is visible on the sheet: the explorer cells are smaller
than the `figures/` cells. Tightening the box to the measured union of all five poses
recovered about 10% of it; the rest is inherent.

## The boundary, stated plainly

Two pieces are missing and both are missing for the same reason — they need something this
machine does not have.

**No image-to-image adapter.** `image.ts` sets the standard itself: its request shapes were
checked against the live provider schemas rather than recalled. With no key here, an i2i
request shape would be a guess shipped as fact, so it is not shipped.

**The identity gate is a floor, not the gate.** `plausibilityGate` compares ink quantity and
proportion, both scale-free, and is named for what it does: it rejects a vectoriser that
returned mush and would happily accept a different person's face. The embedding check needs a
model that cannot run offline here. `PoseGate` is the seam it arrives through, and until it
does, a generated pose is not trustworthy enough to be worth a key — which is why the shipped
rig composes all four of its useful poses and marks only `thinking` as generated.

The manifest records `library.pose` as `{ name, how, requested }`, and `name !== requested` is
exactly the case where a generated pose fell back. That is the one place the record admits the
board is showing a different posture than the storyboard asked for.

## Still true from the sections above

The benchmark is untouched by any of this — it has zero assets, and its numbers
(104.667 s / 3140 frames / 52.2%, 61.500 s / 55.9%, `cost $0.00`) were last measured in the
previous section and nothing since could have moved them. The planner still never emits an
`AssetRef` or a variant, so **nothing upstream can ask for a pose yet**: a rig is reachable by
hand and by alias, and not by pedagogy. That is the largest remaining gap in this area and it
is a planner change, not a rig one.

# The pedagogy can address the library, 2026-07-29 (later again)

`PIPELINE.md` step 5b — the unnumbered piece the previous handoff put first. Steps 4 and 5
built a library and a rig that **nothing upstream could ask for**, and this closes that. It
needed no key, and every claim below is measured rather than argued.

## The defect that shipped, reproduced before it was fixed

`buildAsset` matched lucide _before_ the visuals stage got a say and minted the asset with the
lucide slug as its id and lucide's prompt as its prompt. Probing the compiler directly, with
the five descriptions from the previous handoff:

    describe                                    before                     after
    "a hiker walking downhill in thick fog"     hiker-walking-…            unchanged
    "a teacher pointing at a chalkboard"        teacher-pointing-…         unchanged
    "a lone explorer crossing a desert"         lone-explorer-…            unchanged
    "a person standing at the edge of a cliff"  id=user,   "a single …"    person-standing-the-edge
    "Odysseus tied to the mast of his ship"     id=rocket, "a rocket …"    odysseus-tied-the-mast

**Odysseus drew a rocket, and does not any more.** Routing the surviving descriptions through
`matchLibrary` shows what the library now sees, which is the half the earlier probe could not
reach because the evidence was already gone:

    hiker-walking-downhill-thick     -> figures/walking      (alias)
    teacher-pointing-chalkboard      -> figures/pointing     (alias)
    lone-explorer-crossing-desert    -> characters/explorer  (alias)
    person-standing-the-edge         -> figures/standing     (alias)
    odysseus-tied-the-mast           -> no library match, and reaches the generator with its
                                        own prompt instead of "a rocket taking off"

The `person` row is the one worth noting: it resolved correctly _before_ as well, but only
because lucide's substitute prompt happened to contain the word "person". It now resolves by
real match.

## The acceptance bar, precisely

> _Done when:_ a narrative lesson renders one character across three beats in three different
> poses, with no key.

**Met, through the product rather than through a unit.** `examples/lessons/longitude.lesson.json`
is a new hand-authored narrative lesson — a `cast` of one, a pose named per beat. It compiles
to four assets, all carrying `ref: { path: 'characters/explorer', variant: <pose> }`, and the
visuals stage resolves all four on the **library** lane with `how: 'composed'` and
`requested === name` — no fallbacks. Four poses rather than the three the bar asks for, and
`standing` is correctly _shared_ by two beats rather than minted twice.

Rendered end to end through the real CLI with no key at all:

    ✔ How a Clock Solved Longitude · 2:11 · 8 scenes, 4 assets
      providers  lesson supplied · voice kokoro · art builtin
      cost       $0.00 — nothing left this machine

## Gates

`pnpm lint` clean · `pnpm -r typecheck` 0 errors across 9 projects ·
`pnpm -r test` **569 pass, 0 fail** across all eight test-bearing packages (557 → 569; 12 new
tests — 3 on the router, 5 on `cast` and critique, 4 end to end in `pipeline`).

**Two controls, both byte-identical.** The benchmark's compiled storyboard is unchanged in
both presets (it has zero assets, so the router cannot touch it), and `projects/handwritten`
geometry hashes are unchanged — this piece moved nothing that was already being drawn.

`STAGE_CODE_VERSION.storyboard` went 3 → 4. Note honestly that the benchmark's storyboard hash
did _not_ move, so the bump is conservative for that lesson; it is correct in general, because
any lesson with assets now has different asset ids.

## A verification gap, closed

The previous handoff observed that **none of the four verification tools can see a planner
change** — `geomhash.mts` resolves the visuals stage against a storyboard already on disk, so
`projects/handwritten` stays byte-identical whatever `buildAsset` does. That gap is now a
committed tool: `packages/pipeline/src/sbhash.mts`, sibling to `geomhash.mts` and `frames.mts`,
sub-second, hashing the compiled storyboard plus the asset table for both presets.

It is committed rather than kept in scratch for the reason `geomhash.mts`'s own header gives,
and the reason cost a measurement in this session: `git stash -u` takes untracked files **with
it**, so a throwaway version of the tool vanishes at the moment it is needed and the "before"
run silently measures nothing.

## What is deliberately not done

**The lucide lane still picks a poor icon for an unmatched subject.** With the description
preserved, `odysseus-tied-the-mast` now falls to `presentation` rather than `rocket` — better,
in that the id and prompt survive so the generator lane fixes it the moment a key exists, but
still a confidently wrong drawing where a lettered card would be honest. Tightening that
threshold touches every existing project and is its own piece of work.

**Content fill on the narrative lesson is 23%,** against 52% on the benchmark. Each beat is one
figure in its own cell, so the camera holds a mostly-empty frame — the standing complaint that
`PIPELINE.md`'s region grouping exists to answer, showing up more sharply on a lesson whose
beats do not share a drawing. Not caused by this piece, and not hidden by it.

**`CAST_POSES` duplicates what the rigs declare.** `@inkcast/planner` cannot read the library
and should not start depending on `@inkcast/visuals` to. The copy is pinned by a test in
`pipeline`, which is the package that can see both — add a pose to a rig and it fails until the
model is told.

# The script stage, 2026-07-30

`PIPELINE.md` step 7, built as fields on the lesson beat rather than as a seventh pipeline
stage. The reasoning for that choice is in `PIPELINE.md`; this section is the measurement.

## What was actually broken

Pacing was **two decisions that could not see each other**. An author set `hold` per beat in
the lesson; the voice stage spoke the entire video at one global `targetWpm`. So a beat
written as a quick aside could be followed by two seconds of silence, and a worked example
could be raced through at the same words-per-minute as a punchline — and nothing anywhere
could notice the two were fighting. That is the same bug class as the dead plot solver and
the duplicated asset router, in its third and fourth appearance.

## The acceptance bar, precisely

> _Done when:_ a punchy beat is measurably faster and holds shorter than a slow_deliberate one.

**Met, on real Kokoro audio, over identical words.** Three scenes, same 29-word narration,
differing only in cadence:

    punchy            10.825s   160.7 wpm     hold ceiling 0.8s
    building_energy   11.470s   151.7 wpm     hold ceiling 1.6s
    slow_deliberate   12.250s   142.0 wpm     hold ceiling 3.0s

    slow / punchy = 1.132x

The three rates land on the 140/150/160 targets they were designed for, and all three sit
inside the 140–160 wpm teaching band. That band is not decoration — it is the decision that
moved this project off the MVP's 193 wpm — so an early version of this table using 0.88–1.12
was wrong twice over: it put the _body_ of a lesson at 168 wpm, which is the pacing feature
breaking the pacing rule.

Also pinned in the fast tests, through the `silence` provider: the same ratio, the cache key,
and the emphasis timing.

## What the pacing change actually moved

Cadence is derived from the beat when absent, so both shipped lessons are re-paced without
either being edited. Across 29 scenes (two lessons × two presets), **5 holds moved**:

    gradient-descent standard  worked   0.95 -> 1.05    slow_deliberate floor
    gradient-descent short     worked   0.6  -> 1.0     slow_deliberate floor
    longitude        short     worked   0.6  -> 1.0     slow_deliberate floor
    longitude        standard  hook     1.55 -> 0.8     punchy ceiling
    longitude        short     hook     1.3  -> 0.8     punchy ceiling

Every one is the mechanism doing what it says and nothing else: arithmetic gets the pause it
needed and was not getting, and a hook written to be quick stops sitting in a long silence.
The other 24 holds are unchanged, which is the outcome to want — this is a pacing fix, not a
re-timing of everything.

## A real bug this exposed

The `silence` provider applied the rate **twice**: it sized its clip from `req.targetWpm` and
then divided by `req.speed`, which is already `targetWpm / naturalWpm`. Invisible for as long
as every scene shared one global rate — `speed` stayed at 1, so squaring it changed nothing —
and measurable the instant cadence made the rate per-scene: 140 vs 160 wpm came out as 1.31x
instead of 1.14x. Fixed by generating at the declared baseline and letting `speed` carry the
rate, never both.

Worth recording as a pattern rather than a one-off: a constant that is only ever one value
hides every bug in the code that consumes it.

## Gates

`pnpm lint` clean · `pnpm -r typecheck` 0 errors across 9 projects ·
`pnpm -r test` **578 pass, 0 fail** across all eight test-bearing packages (569 → 578).

`STAGE_CODE_VERSION.storyboard` 4 → 5: every scene now carries `cadence` and `emphasis`, and
`hold` is clamped by the cadence rather than only by a global 3s cap. **`voice` is
deliberately not bumped** — a storyboard with no cadence produces byte-identical audio, and a
scene that has one invalidates itself precisely, because the per-scene wpm and the emphasis
list are both in the voice cache key. A global bump is for when you cannot tell which scenes
moved; here you can.

The narrative lesson still renders end to end with no key at `cost $0.00`.

## What is deliberately not done

**No `targetSec` per beat.** The sketch in `PIPELINE.md` has one. `adaptLesson` already fits
a lesson to its preset's second budget, and a per-beat target would be a second opinion about
the same quantity — which is the exact shape this piece exists to remove.

**Emphasis lands on a clause, not a word.** The clip is assembled per clause, so that is the
unit available. A word-level version needs the aligner's output to feed back into synthesis,
which is step 8's machinery, not this one's. The numbers are small on purpose (0.92x speed,
+0.18s gap) because a heavy hand at clause granularity drags a whole sentence.

**The heuristic document planner stays uncadenced.** `heuristic.ts` already declares that
deliberate silence is a teaching decision belonging to the lesson compiler, and holds nothing.
A document beat has no delivery to speak of, so those scenes carry no cadence and the voice
stage uses its global rate — exactly as before.

# Root cause 1, mostly closed, 2026-07-30 (later)

The last architectural piece, and the one whose cost this document has been counting.
Scoped deliberately: the camera moves to `@inkcast/core` and the plot lane starts reading
the sidecar. The sketch duplication is left, sized, and written down rather than
half-done.

## What was actually blocking it

Step 1 already made `resolvePlot` the only plot solver. What remained was that the
renderer had to **call** it rather than read what the stage recorded — because the visuals
stage had no camera. It sized type as a fraction of the whole canvas; the renderer frames
a region and quotes type in output pixels. On the benchmark that is 13.3 canvas units
against the stage's 69.8.

That would be cosmetic if type were only type. In the plot lane the caption size _is_ the
unit of measurement — gutters `caption * 2.1`, a tick `caption * 0.26`, a marked point's
radius `caption * 0.2` — so the recorded geometry had the wrong numbers baked into its
path data and no rescaling afterwards could recover it.

## What was done

`resolveFraming`, `unitsPerPixel`, the type scale, the narrow-frame gain and the per-style
pen weight moved out of `packages/render` into `packages/core/src/camera.ts`, behind one
call: `boardMetrics(sb)` — _given this storyboard, how big is everything going to be?_
The visuals stage calls it and resolves plots at that scale; the renderer calls it and
draws at that scale; `openVisuals` resolves nothing and now only reads.

The rect and path-flattening arithmetic the camera needs moved with it
(`packages/core/src/rect.ts`), re-exported from the renderer's `geom.ts` so there is
visibly one implementation rather than a quiet second one.

## Verification

**The render is byte-identical, and that is the whole proof.** A new committed tool,
`packages/render/src/planhash.mts`, hashes the compiled plan's prims — the path data, the
text, the colours and weights, excluding timing. Across the change:

    projects/final-169    109 plan items    IDENTICAL
    projects/handwritten   (as above)       IDENTICAL

Meanwhile `geomhash.mts` shows the visuals sidecar moving in exactly one place:

    8 elements changed, all of type `plot`   — nothing else in either project moved

That is the signature of a correct fix: the drawing did not change, the file that records
it became true. The benchmark also renders end to end at `cost $0.00`, voice 54.3s /
render 39.7s, with the plots reading correctly in a frame grab.

`pnpm lint` clean · `pnpm -r typecheck` 0 errors across 9 projects ·
`pnpm -r test` **582 pass, 0 fail** across all eight test-bearing packages (578 → 582).

## Two real problems this surfaced

**The renderer's cache key did not cover the sidecar.** `renderFingerprint` hashed only
the storyboard. That was safe while the renderer re-derived plot geometry; the moment it
started _reading_ `visuals.json`, the sidecar became a real input living outside the key —
so a visuals change that left the storyboard untouched would have kept serving the old
video. Exactly the failure `keys.ts`'s own header is a cautionary tale about. Fixed by
folding `visualsFingerprint` into `renderFingerprint`, which also makes "bump the stage
you changed" remain sufficient advice.

**A plot with no sidecar drew nothing at all.** The renderer could always previously
reconstruct one, so this failure mode did not exist before. A missing plot leaves a
caption in a void — the thing this pipeline is least willing to ship — so it now draws the
same honest labelled frame an unresolved asset gets, and says so in the log.

## What this cost elsewhere

Twenty render tests compiled plots against an empty directory and relied on the renderer
resolving them in-process. They now resolve the visuals stage first, through a
`withVisuals`/`planWithVisuals` helper in the render fixtures. That the helper has to
exist is the point rather than an inconvenience: it makes the stage dependency real in the
tests instead of letting the renderer quietly reconstruct what it should be consuming. The
one test that wants the degradation asserts on it directly.

## What is deliberately left

**`render/src/sketch.ts` is still a second implementation.** A hand-rolled mulberry32
sketch engine against the visuals stage's roughjs geometry, for `path`, `shape`, `arrow`,
`diagram`, `emphasis` and `text`. For those types the stage's SVGs are still written and
never read.

This is not the same shape as the plot problem and should not be mistaken for it. Plots
were _one_ implementation invoked twice at different scales, so unifying them was provably
invisible. These are two different hands, and whichever wins redraws about half of every
board — 21 of 39 elements in `final-169`, 6 of 14 in `handwritten`. It is a decision about
what the video looks like, taken with frames in front of you, not a refactor. `PIPELINE.md`
step 10 states the two options and what each one costs.

**`visuals/src/svg.ts` has its own `parsePath`.** A third path parser, serving a different
job (segment rewriting rather than flattening to points). Noted, not touched.

# The board writes what it says, 2026-07-31

The engine was never the problem; the board was. This closes item 1 of the handoff and
one half of item 4, and both were measured before and after with tools that are now
committed rather than typed at a shell.

## The defect, reproduced before it was fixed

`examples/photosynthesis.md` through the no-key authors, then
`packages/pipeline/src/vocabcheck.mts`:

    3 of 22 spoken terms are on the board (0 of 3 initialisms and names)
    213 words spoken, 70 words drawn, across 8 scenes

Every word on that board was a beat heading. Three cells said "The one-line version" and
two more said "Where it happens", so a third of those 70 words was one string repeated —
and the recap, which draws the chain of ideas, listed the same step twice. The shipped
longitude lesson was no better on vocabulary: **0 of 6** of the people and places it
names were ever written, only pronounced.

Zero of three initialisms is the sharp end of it. Since `6b46e14` the voice stage spells
an initialism out letter by letter, so "see oh two" is unrecoverable unless the board
also draws `CO₂`.

## What was done

**`LessonStep.terms`** — the vocabulary a beat introduces, verbatim from its own
narration. The compiler writes each term as a row along the foot of that beat's cell,
one text element per term with the term as its own cue, so the voice stage lands the
writing on the word. `planVocabulary` settles the whole lesson at once, because "written
once" and "not where a caption already says it" are facts about the board rather than
about a beat.

**One definition of a term**, in `packages/core/src/terms.ts`, about the form of the word
and not about a list of subjects: an initialism or formula, a name (paired with the noun
it qualifies only after an article — "the Calvin cycle" yes, `London says` no), and a long
content word that is not everyday English. The third rule is loose on purpose, so callers
rank and cap.

**A gate that can see it.** A spoken initialism or name that no beat writes is a critique
failure, measured across the lesson because the board never wipes. Only those two kinds.

**One cell, one caption.** The derived author reached for `beat.heading` first, so beats
sharing a section shared a caption; the heading is now a preference and a taken one falls
through to a sentence of the beat's own. An identical `idea` on two beats is a critique
failure wherever it comes from.

**A plot belongs where there is a quantity.** `cycle` no longer selects the wave recipe
and a lone `supply` no longer selects a demand curve, and behind that, `worthPlotting`
asks the question the keyword tables were being asked and cannot answer.

## Gates

`pnpm lint` clean · `pnpm -r typecheck` 0 errors across 9 projects ·
`pnpm -r test` **595 pass, 0 fail** across the eight test-bearing packages (586 → 595).

## The numbers, after

    examples/photosynthesis.md   13 of 22 terms  (3 of 3 initialisms)   80 words drawn
      after the caption fix      15 of 22                              100 words drawn
    examples/lessons/longitude   10 of 19 terms  (6 of 6 names)        102 words drawn

`sbhash.mts` over both shipped lessons, at both presets: **`gradient-descent`
byte-identical** across all three commits, `longitude` changed only where it gained
vocabulary. That is the shape of the whole change — it costs nothing where there is
nothing to write, and the benchmark keeps `loss`, `parameter` and `gradient` in its
`jargonBudget` and never says them, so there is no vocabulary to write.

## What is deliberately not done

**The density half of item 4.** Frame fill on the photosynthesis document is 17.1%
against 47.6% on `projects/final-169`, and the cause is not something a constant can fix:
a beat whose only figure is one square asset centred in a frame-shaped cell leaves the
sides empty at any size. The two honest fixes — a two-column cell, or framing the ink
rather than the cell — both change every board, and the second argues with a considered
decision in `regions.ts`. `PIPELINE.md`'s "Still open" states them.

**The loose third term rule.** `findTerms` will offer "Chemists" and "ingredients" on a
derived lesson, because a long content word is the only recall rule available without a
word-frequency corpus. Ranking and the per-beat cap keep them off the board where
anything better exists, and the gate only ever _requires_ the two certain kinds. A
keyed lesson names its own terms and does not need the heuristic at all.

**Nothing here was measured on a model-authored lesson**, because there is still no key
on this machine. Both shipped lessons are hand-authored. The brief and the revision pass
teach the idiom, and that is untested.

# The first keyed render, and what it exposed, 2026-08-05

The first video generated through the studio with real keys, and the first time anything
here was judged as a _video_ rather than as a set of artefacts. It was reported as hard to
follow, oddly paced, and out of sync — "sometimes it draws multiple things really fast".
Every one of those turned out to be mechanical, measurable and wrong in the code rather
than a matter of taste. `projects/f70a4904eb30` is the render; its `pipeline.json` records
what ran.

## Which providers actually ran

    lesson   anthropic/claude-opus-5   $0.0641   ✅ the lesson is good
    voice    kokoro/af_heart           free      ❌ an ElevenLabs key was configured
    images   fal (selected)            $0.00     — never called: zero asset elements

Two of the three were not the user's mistake.

**The ElevenLabs key was never reached.** The voice chain was ordered local-first and
Kokoro is always available, so the paid provider was never tried, and nothing warned. The
old selection rule asked whether the _voice id_ looked local — and the default `af_heart`
does — but an id names a voice, not a provider.

**fal was configured and had nothing to do.** Gradient descent asks for a hillside, fog, a
figure, six plots and one equation, all of which are drawn locally for free. The
storyboard contains **no asset elements at all**, so the illustration lane was never
entered. The topic that needs generated artwork is the one with objects in it; this was
not it. Still unmeasured, therefore, and still item 1 of the handoff.

## The lesson was good; the trimmer destroyed it

Claude wrote ten beats forming a single chain, `anchor → step1 → … → step5`.
`adaptLesson` fitted it to 120s by deleting **step1 and step2** — the beat that turns the
hillside into a graph, and the beat that defines the word _slope_ — because it ranked
beats by word overlap with the objective and those two talk about dials and steepness.
`remapDerivations` then rewired step3 to derive from the anchor, so the result passed
`critiqueLesson`. The rendered video went from a figure standing in fog straight to "if
the slope is positive, subtract it from your dial", introducing neither word.

`derivedFrom` had recorded the dependency all along. It is binding now: `droppableIds`
only offers beats nothing surviving derives from, and when nothing is droppable the video
runs long and says so in a warning. The splice is kept as a canary that warns if it ever
fires again.

The estimate was also flattering itself — 2.5 words a second, the _target speaking rate_,
against 2.2 delivered — so it cut two beats to reach 120s and produced 131s anyway. It is
measured now, counts the outro, and the standard target is 150s, which is what both
shipped lessons honestly need (116s and 134s). The model is briefed in **words**, which it
can count; it had written 341 for a "120 second" brief.

## The drawing was never in sync, and now is

`packages/pipeline/src/vocabcheck.mts` has a sibling: `synccheck.mts` prints every
element against the word being spoken as it appears.

    before   49 elements: 6 land in a silence, 10 land on the same frame as the one before
    after    50 elements: 3 land in a silence,  0

The lesson asked for **one** picture on **one** cue. The compiler exploded it into nine
strokes and invented a cue for each from the rarest words of each sentence, so the fog of
a foggy hillside landed on "Somewhere below there's a valley" and the figure's legs on the
word "down". Now a builder records why a stroke exists — fog exists because the
instruction said fog — so it lands on that word when the narration says it, and anything
without a word of its own inherits the intent's cue. `spreadGesture` then staggers strokes
that resolved to the same instant by 0.1s in storyboard order, which is drawing order:
a shared cue becomes a gesture, and nothing is drawn before what it sits on.

    s0   0.60s hillside -> "on a hillside"    1.42s fog -> "in fog"    2.72s figure -> "thick you"

## The pauses were flat, not excessive

35 pauses in two minutes, one every 3.5 seconds, **all of them 0.24s** — because good
spoken teaching is written in short sentences and every one was treated as a full stop. The
gap is graduated by the length of the sentence that ended: 8.4s of silence across five
lengths, where the flat rule spent 8.8s across one. Less total silence, more shape.

A first cut made every sentence of seven words or more a landing, which put in 19 long
pauses and pushed the delivered rate _below_ the 140–160 band. The fix for a flat rhythm is
not a slower one; that iteration is in the comment on `GAP_BY_WORDS`.

## Gates

`pnpm lint` clean · `pnpm -r typecheck` 0 errors across 9 projects ·
`pnpm -r test` **599 pass, 0 fail** (595 → 599).

`sbhash`: `gradient-descent` at the standard preset is byte-identical through all of it;
at `short` it keeps one more beat than before. `longitude` at standard is byte-identical
and no longer loses a beat to a flattering estimate.

## What is deliberately not done

**The recap still redraws.** The lesson says "return to the foggy hillside" and the
compiler draws a second hillside in a new panel, twelve strokes, while the original is
still on the board. `findReuse` only lets a hook or anchor beat annotate an existing
drawing; extending that to the recap is the next real win for both density and sync.

**Three strokes still land in a silence**, all within 0.1s of the word that cues them —
the gesture stagger pushing the tail of a group just past its word. Visible only in the
measurement, not on screen.

**The `dominant` clamp fires three times** on this lesson: the model cues a beat's main
picture on a late phrase, and the voice stage holds it to 15% of the beat so the frame is
not empty while the idea is spoken. The warning tells the author to cue the figure on an
opening phrase. That is a brief improvement waiting to be made, not a bug.

**Nothing here has been judged as a video since the fix.** The measurements are all on
recompiled artefacts and a locally re-narrated audio track. The next keyed render is the
verification, and it should be a topic with objects in it so the fal lane is finally
exercised.

# The battery render: all three keys live, and the board still cannot draw, 2026-08-05

`projects/1d80720ea373` — "How a Lithium-Ion Battery Charges and Discharges", 110s, with
`anthropic/claude-opus-5`, `elevenlabs` and `fal` all reached for the first time. $0.445,
of which voice was $0.38. Reported as still extremely bad: mostly text on the board, very
little drawing, and what is drawn is poor.

Correct, and the cause is one lane.

## What worked

Sync, measured with `synccheck.mts`: **0 elements land in a silence, 0 land on the same
frame as the one before** (was 6 and 10). The vocabulary strip writes terms as they are
spoken. The trimmer kept all ten beats. Frame fill 31%, up from 17%.

**The lesson is good.** The hook: _"A full phone battery and a dead one weigh exactly the
same. Nothing went in. Nothing came out. So what actually changed inside?"_ The anchor
opens the cell and finds two stacks with a damp gap between them, "like a sponge holds
water". Ten beats, one clean chain, `problems: []`.

## What failed

The lesson asked for **5 `path`, 2 `motion`, 1 `diagram`, 1 `plot`, 1 `illustration`**. The
board received **13 text, 11 path, 1 asset, 1 plot, 1 arrow** — 90 written words against
306 spoken.

Every `path` instruction was specific: _"Cross-section: a left rectangular stack and a
right rectangular stack drawn as hatched blocks, with a damp gap between them"_. The `path`
lane's entire vocabulary is six regexes taken from the gradient-descent lesson — hill,
bowl, container, figure, fog, steps. **`cross-section` is a term in the `BOWL` regex**, so
a battery was drawn as a parabola; everything else fell through to the default hillside.
And `/you\b/` in the _narration_ draws a stick figure, which is why a walker stands in the
misconception beat of a video about lithium ions.

Eleven of eleven path elements on that board are terrain. The text dominates because text
is the only lane that reliably renders what a beat is about.

`illustration` — the lane that can draw anything — ran **once**, for the hook, at $0.003.
The model used `path` for the nine beats of content because the brief advertises `path` as
"freeform ink: a hillside, a figure, fog, three steps, a bowl, a blob". Those read as
examples. They are the complete implementation.

## What this means

The pedagogy stage has not been the bottleneck for two sessions. The drawing lane is. The
next session's first move is item 1 of `HANDOFF.md`: state what `path` can actually do,
route every other concrete drawing to the illustration lane, and then _look at ten
generated drawings_ — one image is not a measurement, and that lane has never been judged
at scale. `docs/research/golpo-ux.md` §2 says the competitor's whole answer to "draw any
topic" is generated images under a style preset, which is the lane we have and have not
used.

# The path lane tells the truth, and the illustration lane is judged at scale, 2026-08-05 (later)

Item 1 of the previous handoff, measured on the same battery lesson
(`projects/1d80720ea373/lesson.json`, recompiled with `sbjson.mts` — no key needed to
compile, so this is a before/after of the _compiler_, not of a new render).

`pnpm lint` clean · `pnpm -r typecheck` 0 errors across 9 projects · `pnpm -r test`
**606 pass / 0 fail** (was 600; six new tests).

## The board, before and after

    before   1 asset · 11 path · 13 text · 1 plot · 1 arrow   ·   90 written words
    after    9 asset ·  2 path · 12 text · 1 plot · 1 arrow   ·   78 written words

The eleven path elements were hills, bowls, fog and a walker in a lesson about lithium
ions. The two that remain are the _movers_ of the two `motion` beats — a chevron with a
trail — and each of those beats now also draws the scene it describes. **Nine of ten beats
carry a drawn object; the tenth is the worked example, which correctly gets a plot.**

Both shipped lessons were re-hashed across the change (`sbhash.mts`, both presets):
`gradient-descent` is **byte-identical** — every path intent it has really is one of the
six shapes — and `longitude`'s hook, _"a ship's outline heading toward jagged rocks"_,
stops being a hillside and mints an illustration.

`fillcheck` moves the other way: **31.0% → 29.7%**. Honest and expected — an asset element
is a square centred in its cell, where a hillside spanned the cell's whole width. The tool
counts bounding boxes, so it is measuring the box, not the drawing. Defect 5 of the
handoff (a single small drawing leaves the frame sparse) is now the binding one.

## Ten drawings, looked at

The lane had produced exactly one image in its life. Eight were generated for this lesson
through fal (`fal-ai/flux/schnell`, 1024², ~$0.003 each, **$0.024 for the set**) and every
one was opened. Honest verdict: **three good, three mediocre, two failures.**

- Good: the hook's two battery cells, one with a level line; the anchor's two hatched
  electrode stacks with a gap between them — which is precisely what the lesson asked for
  and what the old lane drew as a parabola; the wire-and-bulb circuit joining two stacks.
- Mediocre: a donut for "one circle labelled lithium atom"; a stacks-and-bulb recap whose
  parts do not match the described recap.
- Failed: "the two stacks again, a plus dot crossing the gap" came back as a plus sign, a
  sun and a horizontal line.

Two causes are legible in the images and both are now briefed against:

1. **Words inside a picture come out as scribble.** The prompt has said `no text` since the
   lane was written, but the _subject_ said "labelled lithium atom", "marked plus", "one
   drawn with a full bar" — the negative and the subject were fighting, and the subject
   won. Several images carry invented lettering (`+e> --`), and one carries two labels both
   reading "full" where the lesson wanted full and empty.
2. **A picture of a change is a muddled picture.** "The same cross-section drawn twice,
   then an arrow" and "every arrow flipped" both came back as one confused frame.

A third, not yet fixed: this lesson mints **five separate drawings of the same two
stacks**, one per beat, each generated independently and each different. That is exactly
the competitor defect `golpo-ux.md` §5.2 names, and our answer to it — one entity, one
`assetId`, forever — exists in the IR and is unreachable from a lesson, because nothing in
the schema lets a beat say "the picture from beat 2, again".

## Two false plots, fixed on the way past

Found by rendering frames of the new board, not by reading code.

- The worked example — _"a plot of charge remaining against time: a straight line falling
  from 3000 at hour zero to 0 at hour ten, and a steeper straight line rising"_ — was drawn
  as a **parabola with a tangent on it, labelled `loss`**. The tangent recipe matched on
  the bare word `steep`. A comparative is not a request for a tangent; `steep` is gone and
  `how steep` stays.
- Its axes then read `time` and `output`, because the Y table has no rule for charge.
  `axisLabels` now reads an axis the instruction states outright — "a plot of **charge
  remaining** against **time**" — ahead of any keyword table. The board says
  `charge remaining` now.

Both shipped lessons stay byte-identical across both plot changes.

# The drawing lane: marks instead of topics, 2026-08-05 (later still)

`pnpm lint` clean · `pnpm -r typecheck` 0 errors across 9 projects · `pnpm -r test`
**614 pass / 0 fail** (was 606; eight new tests for `drawing.ts`).

Full reasoning in `docs/research/drawing.md`. The numbers:

## The experiment

Four subjects — a battery cross-section, a battery circuit, a ship heading for rocks, a
chloroplast — one `claude-opus-5` call each, forced onto an eight-mark vocabulary, 12–17s
each. **All four legible, two textbook-quality.** The circuit drew the wire through the
bulb, the ion crossing the gap, an ✗ on the electron's path and the words "e- CANNOT
CROSS" — the exact beat the image model had returned as two empty rectangles.

## The lane, measured on the battery lesson

Every picture pointed at the new lane, then compiled, resolved and rendered to frames:

    before (image lane)   1 asset · 11 path (hills, fog, a walker) · 13 text · 90 words
    now   (drawing lane)  43 path · 49 shape · 25 arrow · 63 text · 0 images

**9/9 drawings composed, 0 compiler warnings, 0 image generations**, 25 seconds wall clock
for the set (four in flight), cached machine-wide by instruction hash so a re-render is
free. Both shipped lessons compile byte-identically at both presets — neither has a `draw`
intent.

Frame fill 20.0%, up from 17.2% on the first cut of the lane after two fixes the frames
forced (the canvas is landscape rather than 4:3, and a drawn beat gives its caption 26% of
the cell instead of 40%), still well short of the 48% benchmark. That is now the cell grid
rather than the pictures.

## What the frames showed, and what was fixed from them

- **Dots drew as rings.** A roughjs hachure fill at dot scale is one line across the
  middle. Dots are small and heavily stroked now, and read as solid.
- **A third of every cell was blank.** A drawing authored 4:3 fits a 2.4:1 figure box by
  height. The canvas is 1000×560 and the text zone shrinks for a drawn beat.
- **`elements` comes back as a JSON string** twice in eighteen calls; the retry does not
  fix it, because the model does not recognise it as an error. Parsed rather than rejected.
- **A zod tuple makes the tool schema invalid** — draft-07 `items: [...]` — and every call
  400s. `Mark.points` is `number[][]`.

Still open and visible in the frames: labels crowd each other, and near-duplicate labels
get placed twice. That is the feedback loop the literature says is where the quality is,
and it is item 1 of the handoff.

# Twelve STEM subjects, drawn and looked at, 2026-08-05 (last)

The claim under test was the user's own bar: _maths, physics, complex STEM, human anatomy
— everything should be drawable, by the image model or by ourselves._ So: twelve subjects,
one drawing each, through the real path (`drawOne` → `buildDrawing` → storyboard → visuals
→ frames), every panel opened.

`pnpm lint` clean · `pnpm -r typecheck` 0 errors across 9 projects · `pnpm -r test`
**616 pass / 0 fail**.

## The result

**12/12 drew.** Ranked by how well they teach:

- **Strong** — benzene (hexagonal ring, alternating double bonds, all six hydrogens, C6H6
  written in the middle), the neuron (dendrites, cell body, nucleus, myelin segments, axon
  terminals), the heart (four chambers, septum, tricuspid and mitral valves, blood in and
  out), the titration rig (burette with a numbered scale, stand, dripping tip, conical
  flask), Pythagoras (squares on all three sides, two shaded), the free-body diagram (ramp,
  block, N/W/f arrows and θ), calculus (curve, axes, four hatched rectangles under it),
  binary search (twelve numbered boxes, mid pointer, discarded half bracketed), matrix
  multiplication (three grids, row and column highlighted, `row · column = entry`).
- **Adequate** — magnetic field lines, the double slit (the wavefronts tangle).
- **Weak** — the knee joint. **Irregular organic anatomy is the honest limit of a composed
  drawing**, and the case where the image lane still earns its place.

Maths notation survives as Unicode — `a² + b² = c²` rendered correctly. Fractions,
integrals, roots and matrices would not: a `label` is plain text. `EquationElement` already
typesets TeX, so a ninth `math` mark closes it.

## The one defect that was in every panel

Labels on ink, labels on each other, and four of twelve captioning themselves across the
drawing. Three causes, all found by looking at frames, all fixed:

- **`repairLabels` was repairing nothing.** It treated every mark as an obstacle, so a
  heart outline or a ramp — bounding box covering most of the drawing — made every
  candidate position busy, the search failed, and the label stayed exactly where it was.
  Now: two labels never overlap, ever; ink is avoided only when it is _small_ (under a
  fifth of the drawing), because a name inside the shape it names is normal on a whiteboard
  and a name on top of a valve is not.
- **Drawings titled themselves.** "Matrix Multiplication" across the grids, "Binary Search"
  across the numbers. The beat's own sentence is already written above the cell, so a title
  is a second caption and, being the biggest mark, the one that lands on everything. The
  brief forbids it; `cleanMarks` drops it anyway.
- **Labels broke mid-word** — `Cartilage` as "Cartil / age", `block` as "blo / ck", on
  nearly every panel. `measureText` can only ever return its own estimate, and the renderer
  wraps again against real handwriting metrics, which are wider. Boxes are widened by half
  again after measuring, and capped at a share of the drawing so a sentence-length label
  wraps into tidy lines rather than one line across the picture.

Residual after the fix, visible in the frames and left for the render-and-look loop: the
longest single words still break on the tightest labels, and the double-slit wavefronts
overlap into a scribble.

# The board looks at its own drawing, 2026-08-05 (last)

Item 1 of the previous handoff: render a composed drawing, hand it back to the model that
composed it, ask for corrections, and gate that on a cheap geometric check. Built, measured
and looked at. `docs/research/drawing.md` §5b is the reasoning; this is what was run.

`pnpm lint` clean · `pnpm -r typecheck` 0 errors across 9 projects · `pnpm -r test`
**636 pass / 0 fail** (616 before) · both shipped lessons compile byte-identically at both
presets (`sbhash.mts` stash diff).

## What was measured, with numbers

**The cache, before and after mechanical repair** (`markcheck.mts cache` — no key, no
network, ~50 ms for the machine's whole drawing cache):

| stage                                                    | defect score | drawings still wrong |
| -------------------------------------------------------- | ------------ | -------------------- |
| as composed by the author                                | 713          | 41 of 41             |
| after the repair pass, bounding boxes (previous session) | 48\*         | 20 of 41             |
| after the repair pass, real ink geometry                 | 110          | 20 of 41             |

\*The 48 is not the better number. Every one of those 48 was a label the repair itself had
thrown off the canvas to clear a collision — a fix gaming its own measurement. With
displacement priced properly, 110 is what is honestly left, and none of it is self-inflicted.

**The twelve-subject sheet** (`drawsheet.mts`, which now holds the subject list so the
breadth test is reproducible rather than remembered):

- **12/12 drew. 10/12 measure clean.**
- 4 measured dirty as composed: calculus 2, double-slit 6, heart 4, knee 6.
- The correction pass fixed 2 (calculus 2 → 0, double-slit 6 → 2), tied on the heart
  (4 → 4, kept — see below), and was **rejected on the knee** (6 → 7, the veto working).
- Frames opened: benzene, magnetic field (before and after), heart (before and after), knee
  joint, double slit, titration. Six of twelve, chosen for what the numbers said was
  interesting rather than for a clean sweep.

## The two frames that changed the design

**The bar magnet.** Score 8 → 0, and the picture got worse: `N` and `S` began inside the
hatched poles, which is how anybody draws a magnet, and the correction moved both letters
out of the magnet into the field lines below, where they name nothing. The audit had counted
hatching as ink. Shading is now something a name may be written **on** while still counting
as something to be **near** — so the drawing audits clean as composed and no call is spent.

**The heart.** Demanding a strictly better score threw the correction away on a tie, keeping
an original whose septum was labelled inside the right ventricle and whose blood-flow arrows
swept diagonally across every chamber. The score knows about labels and bounds; the model had
looked at the render. **A tie now goes to the model.** With that rule the septum moves onto a
leader arrow — pointed at the outer wall rather than the dividing line, which no measurement
can see and a viewer can.

## What is honestly not done

- **Not 12/12 clean.** The heart keeps one `label-on-ink` and the knee keeps one plus an
  `off-canvas`; the knee's correction measured worse and was rejected. The handoff's bar for
  item 1 was "no label overlaps ink or another label" on all twelve. 10/12.
- **A clean audit is not a good drawing.** Benzene audits clean with its double bonds drawn
  as chords across the ring's middle. The gate is arithmetic and cannot see it.
  `INKCAST_DRAW_FIX=all` runs the unconditional pass for that experiment.
- **Not judged: a full keyed render.** Everything above is drawings, stills and audits. The
  drawing lane has still never been watched as video.
- **The label-width estimate resolves to about ±3% of the canvas.** Measured against the real
  font: mean advance 0.521 of cap height against the planner's 0.52, so the estimate is
  sound — but two long names 30 units apart render visibly tight without measuring as a
  collision (`incoming plane waves` beside `barrier` on the double slit).

## The keyed render, watched at last (same date)

The drawing lane had never been seen as video. It has now:
`cast "How a lithium-ion battery charges" --project try` → **1:42, 1920×1080, 10 scenes,
$0.57**, stages `lesson 144.8s · storyboard 0.0s · voice 41.1s · visuals 0.1s · render 49.4s`.

**Zero assets.** Every picture in the film came from the drawing lane; the illustration lane
was configured (`art fal`) and was not needed once.

**The drawings hold up on a real lesson.** `markcheck.mts projects/try/lesson.json`: ten
drawings, defect score **66 → 2**, nine of ten clean, the tenth a label 23 units past the
right edge that content-fitting absorbs. The beat that the image generator once rendered as
"two empty rectangles" — two stacks facing each other across a gap, one thing crossing it —
now draws as two hatched electrodes, a gap, an arrow across it and packed lithium dots, every
label clear of ink and of every other label.

**Two defects a viewer notices immediately, both older than this session** (proven: the same
`lesson.json` compiled under `c0775ec` and under this commit differs in **zero** text fields —
only label coordinates moved):

1. **Text is clipped, not wrapped, and the cause is two type scales.** `empty stack` rendered
   as `empty stac`. The planner sizes a text box from `FONT` in `planner/src/elements.ts`
   (caption 22) and the renderer draws it at `TYPE_SCALE` in `core/src/camera.ts`
   (caption 26) — 18% bigger, for all five roles. The 1.5× slack in `drawing.ts` absorbs it
   for most strings and the longest ones lose their last letter. This is the third instance of
   the pathology already listed twice in the handoff (`sketch.ts` versus roughjs, two
   `doubleWell` catalogues): **two catalogues of one number.**
2. **A caption shortened to the preset's word budget lands mid-phrase.** "A charged battery is
   lithium held on the wrong" — nine words, `captionWords: 9`. `shorten()` in `text.ts` exists
   precisely to avoid this and its `DANGLING` list does not catch a trailing adjective. The
   deeper fix is for the lesson author to write a caption that fits rather than for the
   compiler to cut a sentence written for another purpose.

The pulled-back recap frame is the best single argument for the lane: **eight distinct
diagrams for one lesson**, all legible at that zoom, each labelled in the same hand. It also
shows the honest cost of the shading decision above — `electron stuck` and `cathode`, written
inside narrow heavily-hatched strips, are hard to read. That is the price of not moving names
off shading, and the magnet is why the price is worth paying; the fix belongs on the hatching,
not on the label. Item 0a of the handoff.

---

## The drawing keeps up with the sentence — 2026-08-06

Written against the working tree on `visuals-morph-density`. Three complaints, all from
watching the film rather than reading the code: the drawing and the narration do not happen
together, an intricate diagram collapses into itself, and the voice is hard to follow.

**`pnpm lint` clean · `pnpm -r typecheck` 0 errors across 9 projects · `pnpm -r test`
646 pass / 0 fail** (up from 636; ten new in `planner/test/draw-cues.test.ts`). Both shipped
lessons compile byte-identically at both presets — `sbhash.mts` diff is empty. Every cached
drawing audits identically before and after: `markcheck.mts cache` is unchanged at
**1080 raw → 146 kept** across 71 drawings, which is what it should be, because none of this
touches what gets drawn.

### 1. The drawing was arriving on one word of its beat

`synccheck.mts` could not see this and it is worth understanding why. It checks each stroke
against the word being spoken as it lands, and by that measure the shipped film was **perfect
— 209 elements, 0 in a silence**. Every stroke was cued to a phrase of its own narration.
They were cued to the _same_ phrase. In the recap, thirty elements resolved to one cue and
were then stepped 0.1s apart by `spreadGesture`, so the board sat empty for six seconds of a
ten-second beat and then drew the whole cell in the last three.

The cause is one line in `compile.ts`: an intent's cue was handed to every element it made.
That is right for a hillside, its fog and the figure on it — three strokes of one gesture,
and scattering them was a defect fixed two sessions ago — and it is the opposite of right for
a thirty-mark cross-section.

**`planner/src/draw-cues.ts`** is the fix, and it is possible only because `DRAW_BRIEF`
already insists every mark is named after its part. A mark called `damp-gap`, in a beat that
says "across the damp gap", is not a coincidence to score — it is an answer. Named marks
anchor to their own words; the rest are placed _between_ the anchors in proportion to their
position in drawing order, so a hatch one mark behind its box lands one step behind its box.
None of it is cached with the drawing: `drawKey` is the instruction alone so two lessons share
a picture, and a cue is a quotation from one beat.

**`pipeline/src/tandemcheck.mts`** is the new measurement — it recompiles from the project's
own `lesson.json` and resolves cues against the project's _measured_ timings, so a planner
change is re-measured against real speech with no key and no re-render.

| `projects/try`, 10 beats, 198 drawn elements   | before  | after   |
| ---------------------------------------------- | ------- | ------- |
| mean lead (dead board before the first stroke) | **36%** | **6%**  |
| mean span (first stroke to last)               | **38%** | **73%** |
| distinct moments                               | 86%     | **97%** |
| cues that did not resolve                      | 4       | **0**   |

**The tool caught a regression in its own fix, and that is the point of it.** The first
version had an unnamed mark join the gesture in front of it. Beat s1's opening stroke is
`graphite-outline`, the only "graphite" in that beat is two sentences later in "called
graphite", and the forward-only search dragged the first stroke to 61% and took twenty-two
marks with it — the exact defect, reproduced by its fix. `DRIFT` is the answer: a name spoken
more than a quarter of the beat out of step with the mark's turn in the drawing is a different
mention of the same word, not that mark's cue.

### 2. Colour, for the one thing one ink cannot draw

`Tone` — `ink` (default, and absent from the JSON), `accent`, `contrast`, `muted` — on `Mark`
and on `ElementBase`, mapped to inks by `toneInk()` in `render/src/palette.ts`. `contrast` is
`#c2410c` against the accent's `#2f6fed`: warm against cool is the one pair that survives the
common forms of colour blindness, and the two differ in value so it holds in greyscale.

Optional rather than defaulted, deliberately — a default writes `"tone":"ink"` onto every
element of every storyboard and breaks the byte-identical compile of two pinned lessons.

**`pipeline/src/tonesheet.mts` draws the case twice, toned and stripped.** Look at both. Two
flows crossing one space — ions through the liquid, electrons the long way round the wire —
are legible in two inks and are a tangle in one, and no audit can measure that. The brief now
holds the author to a strict test: _if the drawing reads correctly in one ink, use one ink._

`DRAW_BRIEF` also gained a LEGIBILITY section, which is the other half of "everything collapses
into each other": use the whole canvas, nothing overlaps unless it means "inside", a gap that
matters is drawn wide, never write inside hatching, and fewer marks drawn bigger every time.
`BRIEF_VERSION` is `draw/v2`; the brief is in `drawKey` so every drawing re-authors.

**Known defect 0a is fixed, and not by moving anything.** Text is now painted with a paper
halo under the glyphs (`paint-order: stroke fill` in `page/runtime.js`), so a name written
across ink knocks the ink out behind itself. This is the right side of the trade the audit
made: shading stays writable-on — the version that treated it as an obstacle moved `N` and `S`
out of a bar magnet into the field lines — and the legibility that decision cost is paid back
in the renderer. Invisible on blank board, so it is unconditional. No plan or schema change:
the runtime already had `plan.paper`.

### 3. The voice was ten clips of a person, not a person

**Every clause was synthesised as its own generation with no idea what surrounded it.** That
is forced by `phrase.ts` — measuring a phrase is the only way to know when it is spoken
without a forced aligner — but an engine handed four words in isolation reads them as a
complete utterance: fresh onset, terminal fall, its own pitch range. Ten of those concatenated
is the flat, effortful delivery that has to be worked at to follow.

`previous_text`/`next_text` are documented by the provider for exactly this ("improve the
speech's continuity when concatenating together multiple generations"), cost no extra audio
and are never spoken. `narrate.ts` now hands over the neighbouring phrases of the same scene,
whole phrases only and capped at 300 characters a side. Within-scene on purpose: cross-scene
context would make every scene's cache depend on the one before it, and a scene boundary is a
real pause anyway.

Voice settings are also **pinned per request** rather than inherited. Every stock and cloned
voice carries stored settings changeable from a web UI this repo has never seen, so the same
lesson, key and voice id could deliver differently on two machines with no cache key able to
know. `stability: 0.55` matters most: a scene is ten clause-length generations, and an
expressive setting re-rolls its range on each one, so pitch and pace shift between clauses of
one sentence. `DELIVERY_SIGNATURE` is in the scene key, because the stage cannot otherwise
see a delivery decision made inside an adapter.

**A cache test caught a real bug here.** The scene key existed twice — once for the lookup and
once re-taken after a possible provider swap — with a comment warning not to let them drift.
The warning was not enough: `DELIVERY_SIGNATURE` went into one and not the other, and every
clip went stale on every run. Both are now one closure, `sceneKey(id, voice, rate)`, so the
only thing that can differ is the provider, which is the whole reason it is re-taken.

The **pacing was left alone.** `phrase.ts` records that a previous attempt to slow delivery
pushed the rate below the teaching band and made it worse; the naturalness defect was the
stitching, not the tempo.

### 4. Plain language, in the brief

The lesson prompt's NARRATION section gained a block on writing for the ear, with the rule
stated the way round it actually works: **the more difficult the idea, the simpler the language
carrying it must be.** Everyday words, one clause one thing, subject first, under fifteen words
and mostly nearer eight, numbers spelled as spoken, no throat-clearing. This is heard once,
aloud, with nothing to re-read — a listener decoding the sentence has stopped thinking about
the subject, and elaborate phrasing on a hard idea hands over two problems at once.

### What is still true, and what to do next

- **Nothing measures whether a drawing teaches.** Unchanged, and still item 1 of the handoff.
  `tonesheet.mts` and `tandemcheck.mts` are both measurements of _form_.
- **Neither the tone nor the legibility brief has been through a keyed render.** The renderer's
  half is proven end to end by `tonesheet.mts` from hand-authored marks; whether the author
  _uses_ tone well, and uses it sparingly, is unmeasured. Run `drawsheet.mts` over the twelve
  subjects and count how many reach for colour — the brief's strict test says most should not.
- **`tandemcheck.mts` measures one project.** The numbers above are `projects/try`. Any other
  project the voice stage has run over will do; there is only one on this machine.

## The hybrid drawing lane — 2026-08-06, later

Written against `visuals-morph-density` at the commits listed below. An image for a real
object's _form_, composed marks for its _parts and their names_ — the drawing neither lane
can make alone, and the one thing on the Golpo list they could not copy, because their
illustrations carry no addressable parts.

The evidence for the lane was already in `docs/HANDOFF-HYBRID.md` and is not repeated here.
What follows is what building it actually cost, which was mostly not what the handoff
predicted.

**`pnpm lint` clean · `pnpm -r typecheck` 0 errors across 9 projects · `pnpm -r test`
653 pass / 0 fail** (up from 646: six in `planner/test/underlay.test.ts`, one in
`visuals/test/image.test.ts`). Both shipped lessons compile byte-identically at both presets,
every drawing cached before this work audits identically, and `tandemcheck.mts` on
`projects/cardiac` is unchanged line for line.

### What the handoff got right

The mechanism. The author aims well at a picture it is shown, the seam is the same shape as
`drawPreview`, and the compiler branch is where it said it would be. `buildDrawing` fitting
by content bounds really was the thing that would bite: `fitCanvas` is the fix, and the
picture is placed at that same transform's image of the measured ink box, so there is
exactly one transform and nothing for two halves to disagree about.

### What it got wrong, and this is the useful half

**The handoff's alignment plan assumed the image is drawn as an image. It is not.** An
`illustration` asset is vectorised and redrawn in the board's own hand — which is far better
than pasting a raster, and it means the geometry passes through three more transforms than
the plan accounted for. Three of them were wrong, and two were bugs older than this work:

1. **`extractPathData` dropped `transform="translate(...)"`.** vtracer writes each path
   relative to its own origin and carries the real position in an attribute the regex never
   read, so every traced part was stacked at one point. The anatomical heart traces to six
   paths all starting `M0 0`; five are interior details that landed in a smudge on the
   aortic arch. It survived because the one path carrying most of the ink is usually much
   the largest, so the union bounds barely move and the subject still looks roughly like
   itself. The parts inside it do not.
2. **An asset is authored in a nominal _square_ viewBox and then scaled into each element's
   box.** That is right when nothing is aimed at it, and enough on its own to defeat
   exactness: fitting a tall subject inside a square leaves the margin _inside the artwork_,
   and it rides along. Measured: a heart that should have filled a 578-unit box drew 385
   wide, every leader arrow reaching past it into blank board. `Asset.fit: 'exact'` authors
   the artwork in a viewBox of its element's own shape, which makes the scale that follows
   an identity.
3. **The library lane resolves ahead of the illustration lane, and matched.** "A human
   heart, anatomical, external front view" matched _human_ against the character library and
   drew **a stick figure** with "SA node", "Bundle of His" and "Left bundle branch" pointing
   at it. An exact asset may now only come from the lane that made the picture it was
   measured from, and if that lane cannot answer it draws nothing rather than something
   else.

None of the three is visible in the code, in a type, or in any number the repo produces.
All three were found by opening `composite.png`.

### The overrun, and a composite that was not evidence of what it looked like

8 of 22 marks fell outside the canvas in the experiment. The handoff proposed stating the
bound twice, letting the audit fire, and not clamping. Handing the author **the board** —
the traced subject drawn at the box it will really occupy, on a canvas the size it is
composing on — produced a composite with 17 marks, none outside, every one on the organ.
That was written up here as the overrun fixing itself. **It was not.**

Checked afterwards against the cache, which keeps the drawing as composed beside the
drawing as corrected: **as composed, those 17 marks spanned x 790..1680 on a canvas 1000
wide and not one of them was on the organ.** The correction pass pulled them back to
345..702 with 28 of 36 coordinates on the picture. The composite was the critic's work and
the author had not aimed at all.

That rescue is not a mechanism, it is luck, and the failure mode is precise: **the audit
fires on ink leaving the canvas, not on a mark missing the thing it names.** A drawing whose
marks are misaimed but comfortably inside 0..1000 trips nothing, is never sent to the
critic, and ships. Three of the eight hybrid drawings in the first real render did exactly
that — the SA node ripples drawn in clear board beside the heart, at x 600..970 against a
picture at 328..672.

The cause was one number. The board was rendered at `deviceScaleFactor: 2`, so a position
read off the image had to be halved before it could be emitted, and the brief's "read your
coordinates off the picture" was not literally true. At 1 it is: the image is 1000x560, one
pixel is one canvas unit, and there is no conversion left to get wrong. Same subject, same
instruction, **as composed and with no correction at all: 26 of 35 coordinates on the
picture, nothing off canvas** — and the correction pass now measures its own revision as
worse and rejects it.

Two things to keep from this. **A drawing that came out well is not evidence that the stage
you are testing works** — the loop has two model calls in it and the cache will tell you
which one did the work. And **the audit still cannot see aim**, which is the same blind spot
as benzene's chords and is now the most valuable thing left to measure in this lane.

### A name may not be written on the picture

The handoff flagged that `repairLabels` cannot see the underlay and said to decide
deliberately. It is fed in as an obstacle — and feeding it in changed nothing, which is the
part worth recording. At the ordinary rate a collision costs 50 and escaping a picture that
occupies a third of the board costs 200-odd units of displacement, so the arithmetic said
stay put. That is right about an arrow and wrong about an organ: our own shading is
deliberately writable-on, and the bar-magnet frame says that decision should stand, but a
traced organ is interior detail at the density of the thing itself. A solid obstacle is now
priced at eight strokes and only a solid obstacle is; the weights that stop a label being
marooned off the canvas are untouched. Verified in the frame — "Left bundle branch" was
lying across the heart's left border and now sits in clear board with its leader extended.

### Four of eight underlays were lost in silence, and the lane looked fine

Drawings are composed four at a time. `openDrawUnderlay` guarded its browser launch with a
`let opened = true` set _before_ the launch resolved, so every caller but the first got an
unopened browser — `undefined`, which this code cannot tell apart from "no Chromium
installed". They took the non-fatal path and their beats were drawn with no picture at all.
**Four of the first real lesson's eight underlays, gone, with no warning and the other four
perfect.** Memoise the promise, not a flag; `illustrationRaster` does exactly that two files
away and says why in a comment. 8 of 8 after.

The general shape is worth more than the fix: **a lazy singleton behind a boolean is a race
whenever the thing it guards is awaited**, and here it degraded into a documented,
non-fatal, silent fallback — the most expensive kind of bug to have, because the feature
appears to work.

### The lane was finished, correct, and never used

**This is the most useful thing in this section.** With every part of the lane working and a
paid image key configured, a full keyed render of _the cardiac conduction system_ — the
lesson the lane was built for — produced **twelve `draw` intents, zero underlays, zero
assets, and the valentine still in the film.** 2:41, $0.76, nothing broken. The author read
the advice and declined it every time.

The advice sat after the whole lane list, where the choice has already been made, and spent
its last paragraph on exclusions ending "if you are unsure, leave it out". **A caution the
model obeys everywhere is not caution, it is an off switch.** It now sits inside the `draw`
bullet and leads with a question the author can answer about the object — would a learner
recognise this thing if they saw the real one, and does its shape carry meaning — with the
exclusions kept to one sentence. `lesson@10`, because the brief is not in the stage's cache
key and without the bump the change is invisible.

The general form is worth keeping: **a capability is not shipped when it works, it is
shipped when the stage that has to ask for it actually asks.** Nothing between the two is
measured by any tool in the repo, and the only thing that catches it is rendering the film
and reading the lesson.

### What the underlay costs the beat's timing, measured

`tandemcheck.mts`, all four cardiac projects on this machine. `cardiac2` has no underlays
and `cardiac4` has eight; they are different lessons on the same topic by the same author,
so this is a comparison and not a controlled experiment.

| project                      | lead | span | distinct | cues unresolved |
| ---------------------------- | ---- | ---- | -------- | --------------- |
| `cardiac` (before this work) | 5%   | 83%  | 93%      | 1               |
| `cardiac2` (no underlays)    | 6%   | 78%  | 91%      | 0               |
| `cardiac4` (eight underlays) | 13%  | 69%  | 88%      | **8**           |
| `cardiac5` (same, `NO_CUE`)  | 8%   | 74%  | 88%      | **0**           |

Most of that gap was a defect and is fixed — `cardiac5` is the same marks and the same
narration with only the compiler changed. **The generated picture was being handed the
intent's blanket cue** — every element that has not claimed a cue of its own gets one — and
the voice stage then overwrote its `at`, so the heart landed at 0.150 of the beat instead of
0.02, and on one beat at 0.87, _after every mark that annotates it_. A leader arrow arriving
before the thing it points at is the whole reason that element has an early `at`. `NO_CUE`
claims the slot and asks for nothing.

What is left — 8% against 6%, 74% against 78% — is real, and is a property of the lane
rather than a bug. `draw-cues.ts` finds a
mark its own words by looking for the mark's name in the narration, and that works because
`DRAW_BRIEF` insists a mark is named after its part. An annotating drawing names things the
narration does not say — `sa-node-ripple-1`, `fibrous-ring-outline`, `av-node-leader` are
honest ids and none of them is a phrase anybody speaks. So fewer marks anchor, more fall
back to the blanket cue, and the beat draws in fewer distinct moments. **Naming a leader
after the part it reaches rather than after itself is the obvious next move**, and it is a
brief change, not a code change.

### Tools

`pipeline/src/underlaysheet.mts` is no longer a standalone experiment — it drives the real
seam, the real author, the real compiler and the real visuals stage, and writes the
composite the film would draw. One image call and one authoring call. It is the cheapest
thing that can see this lane at all, and every defect above came out of it.

### Stage versions

`lesson@10, storyboard@14, voice@6, visuals@8, render@5`. `visuals` moves for the translate
fix and the exact fit, either of which alone would justify it — every project with a
generated illustration in it re-resolves, which is the point.

# 2026-08-06, later still — the figure lane, and the model nobody had priced

Written against the working tree on branch `visuals-morph-density`. The job was to compare
our cardiac film with Golpo's frame by frame and plan the gap away. The comparison is in
`docs/PLAN-FIGURE-LANE.md`; the frames it rests on are committed under
`docs/research/figure-lane/`, because the previous session's evidence was a signed URL that
expired and could not be checked.

## What was falsified

`HANDOFF-PARITY.md` says to ask the image model for the teaching figure rather than the
object, and closes: _"That is a prompt and a brief, not an architecture."_ **The direction is
right and the cost is wrong.** Seven live image calls, about $0.12:

- `fal-ai/flux/schnell` at 4 steps — the configured provider — returns an external heart for
  a cutaway prompt **however the prompt is written**. Four variants, one variable at a time:
  `docs/research/figure-lane/prompt-probe-schnell.png`. Loosening the negatives buys colour
  and never buys the figure.
- `flux/dev` (28 steps), `flux-pro/v1.1` and `nano-banana` each return the labelled cutaway —
  four chambers, septum, red and blue vessels, orange conduction arrows through both
  ventricles — on the first try: `model-probe.png`. **The competitor's advantage is a model
  tier, not craft.**
- A binary trace of such a figure **erases the orange arrows entirely**:
  `binary-destroys-colour.png`. There is no tracer setting that recovers hue.

## What was measured

- **Real ink coverage is 4.7% of pixels** across the cardiac film (min 2.6%, max 7.5%), where
  `fillcheck` reports 21.6% mean content fill. `fillcheck` unions bounding boxes, so an
  outlined heart scores its whole box. The board is 95% paper. New tool: `inkstat.mts`.
- **Two hues in the whole film**: 210° on every frame, 30° on five of seventeen at 1–7%.
- **Two underlay prompts collided on one asset id.** `underlayAsset` slugged four words, so
  "…external front view, whole organ" and "…external front view, coronal cut-open showing
  both ventricles and the septum" were the same asset. The two beats that most needed to see
  inside the heart annotated the outside of one, silently. The one coronal image that did get
  its own id is used only by the recap, which is the frame nobody can read.
- **`fill: true` does not fill.** It emits hachure at `opacity: 0.26` in `pal.accent`
  whatever `tone` says, and `assetPrims` never calls `toneInk` at all. There is no code path
  that puts a red region on the board.

## What was built, and what it measures

- **`underlayAsset` is total over its prompt** — `underlay-<slug4>-<hash8>`. Tested against
  the two cardiac prompts. `sbhash` on both shipped lessons is byte-identical, so nothing
  that does not use an underlay moved.
- **`inkstat.mts`** (`render`) — pixel ink coverage and a hue census, over a film or a still.
  No new dependency: ffmpeg is already required, and `-f rawvideo -pix_fmt rgb24` is the
  whole mechanism. Cardiac film: `mean ink 4.7%  hues: 210° 21.0%  30° 1.4%`.
- **`lanecheck.mts`** (`planner`) — which lane every beat chose, and whether each picture is
  its own. Exits non-zero on a collision. On `projects/cardiac5/lesson.json`: 8 `draw+underlay`,
  5 `draw`, **3 distinct prompts over 3 asset ids**, no collision.
- **The figure lane** — `figurePrompt()` beside `illustrationPrompt()`, an `ImageKind` of
  `form | figure` carrying its own model and step count (`INKCAST_FIGURE_MODEL` overrides),
  the kind hashed into `illustrationKey` so a form and a figure of one subject cannot alias,
  and `figureRaster()`, which wraps the PNG in an `<image>` SVG **and never traces it**.
- **`figuresheet.mts`** (`pipeline`) — the tool the figure lane is judged with. One image
  call, no authoring call, a `figure.png` through resolve, inline, the browser and the real
  pen.

## The lane works end to end, and here is the number

`figuresheet.mts` on an AV-delay figure rendered a full-colour cutaway on the real board,
colour intact, through every real transform.

|                          | ink   | hues                |
| ------------------------ | ----- | ------------------- |
| figure lane, one card    | 17.2% | 0° 62.7% 210° 20.4% |
| the shipped cardiac card | 5.3%  | 210° 8.2% 30° 1.0%  |

**3.2× the ink, with colour carrying meaning rather than accenting it.** Still short of the
plan's 25% target, and the frame says why: the raster is letterboxed inside its box and sits
on a white card against warm paper, so the figure does not yet own the frame. Both are
finish, not architecture.

## What is NOT done, and it is the important half

**Nothing asks for a figure yet.** The lesson brief still tells the author to write
`underlay.prompt` as "the OBJECT and nothing else", `Asset.kind` has no `figure`, and the
compiler cannot mint one. The lane is reachable only from `figuresheet.mts`. This is exactly
the failure both handoffs name — _a capability is shipped when the stage that has to ask for
it actually asks_ — and it is the next session's first job, together with the reveal mask
(the raster currently fades rather than being drawn) and the white-card background.

Stage versions are unchanged: `lesson@10, storyboard@14, voice@6, visuals@8, render@5`.
**They must move before a keyed render means anything** — `lesson` for any brief change, and
`visuals` for the kind in the illustration key.

## The drawing half — `raster-reveal` is built

`docs/STYLES.md` §1 specified it and nothing had implemented it. It exists now, in
`page/runtime.js`, and `docs/research/figure-lane/raster-reveal-sweep.png` is it at four
points across one reveal.

A figure carries `data-ink-mode="raster-reveal"`, and the part collector turns its `<image>`
into a **`sweep` part** instead of a `fade`: a `clipPath` holding a polygon whose edge runs
top to bottom, tilted, wobbled by two out-of-phase sinusoids, marching left to right as the
item's progress advances. The pen rides that edge, running up and down it four times as it
crosses — the motion of filling something in rather than of ruling a line. The tilt, the
wobble phase and the direction are hashed from the asset id, so two figures in one film do
not sweep identically and the same figure sweeps identically on every re-render, which is
what the file's determinism rule requires.

Three defects found by looking, all fixed, all invisible in the code:

- **A five-minute hang with no error.** `makeSweepPart` inserted its `<defs>` at the front
  of `root` while `collectSvgParts` was iterating `root.children` — a **live** collection —
  so the cursor slid back onto the image, which asked for another clip, forever. The defs is
  appended now and the caller snapshots the list. Worth remembering the shape of it: a live
  HTMLCollection mutated mid-walk hangs rather than throws.
- **The white card.** Every raster is drawn on white and the paper is `#fcfbf9`, so the
  picture arrived on a visible card. `mix-blend-mode: multiply` on the `<image>` fixes it
  exactly — multiplying by white is the identity, so the card disappears and the grid dots
  read through the picture.
- **The letterbox.** `preserveAspectRatio` fitted a square raster inside a 1120×860 box, and
  since both the mask and the pen work from the element's bounding box, the sweep spent a
  fifth of its travel on empty margin and parked the nib off the picture. `figureRaster` now
  reads the PNG's IHDR and emits the `<image>` at exactly the fitted rectangle.

### Wired, but still not asked for

`Asset.kind` takes `figure`; `VisualIntent.underlay.kind` takes `form | figure`; the
compiler's registry mints a figure (no `fit: 'exact'` — a figure is never traced, so there
is no measured ink box to meet); and `resolveAsset` has a figure lane that returns early,
before the ink flow, because `writeElementSvg` would wrap strokes that do not exist.

**The lesson brief still does not offer the choice**, so no film asks for a figure yet. That
is the last link and it is one brief plus two version bumps — `lesson` 10 → 11 and `visuals`
8 → 9. Neither has been made, deliberately: a brief change with no keyed render behind it is
the thing this repo keeps shipping and then discovering nobody used.

## The keyed render — the lane was offered and the author declined it

`projects/cardiac6`, same prompt as `cardiac5`, full keyed run, $0.67.

**The film was made and it does not use the figure lane.** `lanecheck` on its lesson:
`draw+underlay 7 · draw 4 · diagram 1`, and every one of the seven underlays carries
`"kind": "form"`. **Zero figures.** The visuals bill was $0.009 — schnell prices, which is
the arithmetic proof that no figure model was ever called.

|          | cardiac5 (before)     | cardiac6 (after)      |
| -------- | --------------------- | --------------------- |
| runtime  | 2:45                  | **2:56**              |
| mean ink | 4.7%                  | **5.1%**              |
| hues     | 210° 21.0% · 30° 1.4% | 210° 12.5% · 30° 1.9% |
| figures  | —                     | **0 of 7**            |

So this is the third time in this repo's history, and the second time in two sessions, that
a finished lane went through a full keyed render unused. The pattern is now well enough
evidenced to state plainly: **offering a capability in a brief does not cause it to be
used.** `lesson@10`'s own note records the identical failure — "twelve `draw` intents and
not one underlay" — and the fix that time was to move the advice to where the choice is
actually made and lead with the case rather than the exclusions. The same medicine is
needed here and was not applied: the `figure` bullet sits _second_, after `form`, inside an
advice block that already argues hard for `form`, and it ends on its cost. An author reading
it in order has been told to use `form` before it has finished describing `figure`.

What to try next, in order of how much it would tell you:

1. **Lead with `figure` and make `form` the exception**, not the reverse — and cut the cost
   sentence, which reads as a warning and is doing more work than the $0.03 it saves.
2. **Say when, not whether.** "A lesson about a real object should carry at least one
   `figure` on the beat where the learner first has to see inside it" is a rule an author
   can follow. "Choose this when what teaches is the whole picture" is a judgement it will
   resolve conservatively every time.
3. **Measure the brief, not the film.** `designLesson` is ~$0.06 against ~$0.67, and
   `lanecheck` reads its output directly. Three brief variants cost less than one render.

The lane itself is not implicated: `figuresheet.mts` renders it correctly, and nothing in
this run failed. What failed is the sentence that had to ask for it.

Two incidental findings from the run, both real and neither caused by this work: the lesson
author failed schema validation twice before succeeding on the third attempt, and the
ElevenLabs quota is exhausted (4 credits left), so the voice fell back to kokoro mid-run.

## The voice, and the brief that finally asked

**The local voice was choppy because of a default, not a model limit.** `narrate.ts` split
every scene into clauses for _every_ provider — `opts.phraseSplit ?? 'clause'` — and kokoro
has no context window at all: `generate(text, {voice, speed})` is its entire surface. So it
was handed "the A V node." as a complete utterance and rendered it as one: hard onset,
terminal fall, its own pitch range. Five cold starts in a three-sentence beat, spliced
together with silence. That is the abrupt delivery, and no gap tuning could have fixed it.

Measured on one real beat:

    clause:   5 utterances — [The single doorway is the atrioventricular node,] [the A V node.]
                             [It passes the signal on slowly,] [about a tenth of a second.] …
    sentence: 3 utterances — whole sentences, commas rendered as prosody rather than splices

`VoiceProvider.preferredSplit()` now lets the engine say what it needs; kokoro answers
`sentence`; ElevenLabs keeps `clause` because it is _told_ its neighbours via
`previous_text`/`next_text`. An explicit `--phrase-split` still wins. The **effective** mode
is in the clip cache key, not the requested one, or every cached choppy clip would outlive
the fix. `voice` 6 → 7.

## The brief, reordered — and it worked

`cardiac6`'s author chose `form` 7 times and `figure` 0. The bullet order was the cause:
`figure` sat second, after a block already arguing for `form`, and closed on its cost.
Reordered so `figure` leads, `form` is named the exception, and the cost sentence is
replaced by a rule the author can follow. `cardiac7`'s lesson: **2 `figure`, 2 `form`.**

**But it still minted zero figure assets**, and that was a second break in the same chain:
`buildUnderlay` always called `ctx.assets.underlay(...)`, so the author's choice was
discarded one function later in silence. Fixed — the kind now travels from `VisualIntent`
through `buildUnderlay` to the registry.

**One link is still open and it is known**: `buildUnderlay` only runs when `inkBox` is
present, and `inkBox` is written by the drawing stage from a _trace_ of the generated image.
A figure is never traced, so it has no ink box, so a figure intent still falls through. The
figure lane needs its own seam in `draw-anthropic.ts` — generate, do not trace, and record
the box the figure will occupy rather than the box its ink measured to. That is the next
change, and it is the last one between the lane and a film.

### The last link, closed

`underlayFor` gated every underlay on a traced ink box. A figure has no trace, so every
figure the author asked for fell through in silence — the third break in one chain, each
one hidden behind the last. A figure now claims `figureBox()` and returns immediately: the
visuals stage generates it when it resolves the asset, and nothing needs measuring because
nothing is aimed into it.

`FIGURE_AREA` is 840 of 1000 units wide against `UNDERLAY_AREA`'s 620. The split inverts
because the roles do: a form leaves 190 units either side for the names that carry its
mechanism; a figure carries its own, so the picture takes the board.

**Verified end to end without a render**: `compileLesson` on `projects/cardiac7/lesson.json`
— the first lesson whose author chose `figure` — emits **2 figure assets of 3**, with
distinct ids and real teaching-figure prompts. `654 pass / 0 fail`, lint clean.

What has _not_ happened is a film containing one. `cardiac7` was rendered before this fix
and has the new voice and no figures. The next run is the one that would show both, and it
is the first run where the whole chain is connected rather than three-quarters of it.

## The real test — `cardiac8`, and a fourth break in the same chain

The run happened. **3 figures asked for, 3 figures minted, 0 figures drawn**, and the
failure is one this file already documented.

    lane: library   underlay-cutaway-cross-section-human-heart-3d930244
    lane: library   underlay-cutaway-cross-section-human-heart-ff8a7ad4
    lane: library   underlay-cutaway-cross-section-human-heart-e1f9b1d8

All three matched **_human_** in "cutaway cross-section of a human heart" against the
character library and were drawn as stick figures. That is verbatim the failure recorded in
`resolve.ts`'s own comment — the one `fit: 'exact'` exists to prevent — and it happened
because the figure registry deliberately omitted `fit: 'exact'`, with a comment explaining
that a figure has no measured ink box to meet. True, and irrelevant: `exact` is doing two
jobs, and only one of them is about fitting. The other is **may this asset be substituted**,
and the answer for a figure is no, for exactly the reason it is no for an underlay.

Film: $0.71, 5.0% ink, one hue (210°), visuals bill $0.003 — one schnell image, which is the
arithmetic proof no figure was generated.

**Fixed and verified without another render.** `exact` is now
`asset.fit === 'exact' || asset.kind === 'figure'`, the asset cache version is `asset/v5`
because which lane may answer has changed, and re-resolving `cardiac8`'s own storyboard
through `drawcheck.mts` gives:

    lane: figure   ×3, three colour rasters generated, each wrapped as
    <svg data-ink-mode="raster-reveal"><image href="…"/></svg>

`654 pass / 0 fail`, lint clean.

### The pattern, since it is now four for four

Every break was a _different_ link, each hidden behind the last: the brief did not offer the
choice; the brief offered it in an order that lost; `buildUnderlay` dropped the choice;
`underlayFor` gated it on a trace; `resolveAsset` substituted a stick figure for it. Each
was found only after fixing the one before, because each fix was verified at the point of
change rather than along the whole path.

**The cheap check that would have caught every one of them takes ten seconds and costs
nothing**: compile a lesson and count the assets by kind, then resolve the visuals and count
the lanes. Both are one command. Neither needs voice, a render, or a key beyond the image
one. Run them before a `cast`, not after it.

What is still unproven is the only thing that matters: **no film yet contains a figure.**
The next `cast` is the first with the whole chain connected. Given the record, verify it at
the storyboard and the visuals manifest before letting it reach the renderer.

## The Golpo video was on disk the whole time — at `/tmp/golpo-cardiac.mp4`

`HANDOFF-PARITY.md` says the comparison video is "deliberately recorded nowhere". **It was
in `/tmp`**, 59.53s, encoder `Lavf61.1.100`, 1376×768. Two sessions have now reasoned about
this film from a prose description while the file sat one `ls` away. It is copied into
`docs/research/figure-lane/golpo-cardiac.mp4` with a contact sheet beside it, and that
sentence in the handoff should be struck.

The lesson is not "search harder". It is that **the doc asserted a fact about the world and
was believed without a check that would have cost one command** — the same failure as
`golpo-video-craft.md`'s "they do not attempt labelled diagrams", which was also false and
also shaped a whole strategy.

### Measured, both sides, for the first time

|                      | Golpo                                                                 | ours (`cardiac8`) |
| -------------------- | --------------------------------------------------------------------- | ----------------- |
| runtime              | **59.5s**                                                             | 2:54              |
| mean ink (`inkstat`) | **14.4%** (min 9.6%, max 24.6%)                                       | 5.0%              |
| hues                 | **6** — 0° 29.7%, 210° 9.4%, 30° 8.9%, 180° 4.0%, 60° 3.6%, 330° 1.0% | 1 — 210° 12.5%    |

**The density target was wrong.** `HANDOFF-PARITY.md` estimated their fill at "visibly ~50%+"
and set 45% as the goal. The real figure is **14.4%**, and our own figure-lane card measures
**17.2%** — already above their mean. The gap that remains is not density per card; it is
that only a minority of our cards are figures, and that we take three times as long to say
the same thing.

### What the frames show that the write-up did not

- A **"Golpo" watermark** sits on most frames.
- Titles are a **text layer animated letter by letter** over the picture, not part of it —
  visible mid-write as `E   R   F` in the opening card. So their labels spell for the same
  reason ours do: they are not generated by the image model either.
- In-figure labels (`ATRIA`, `AV NODE`, `BUNDLE OF HIS`) are **hand-lettered text with leader
  lines**, exactly the division of labour the figure lane was built for — image carries the
  mechanism, text layer carries the names.
- Their board **does wipe**: every card is one centred subject.
- Their frames are **not uniformly dense**. One is a small heart on an empty board and the
  opener is a title with almost nothing under it. The 14.4% is a mean over sparse and dense
  alike, which is why a single well-filled card of ours can beat it.
