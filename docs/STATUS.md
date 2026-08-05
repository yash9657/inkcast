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
