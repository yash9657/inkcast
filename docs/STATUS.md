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

## 2026-08-08, later — the first film with a figure in it, and what it cost to find out

Phases 0, 1, 4 and 5a of `PLAN-GOLPO-PARITY.md`. Frames committed under
`docs/research/golpo-parity/`; the film is `projects/cardiac8f`.

### Phase 1: the chain works, the gate does not pass

**The plan books ~$1.20 for this phase and it cost $0.00.** `projects/cardiac8/lesson.json`
already carried 3 `figure` underlays and every one of its images was already in the
machine-wide cache (`~/.inkcast/cache/illustrations/`), so
`cast --lesson projects/cardiac8/lesson.json --project cardiac8f --voice kokoro:af_heart`
produced the first film ever to contain a figure without a single API call. **Pin the voice
or it is not free**: `PINNED_LOCAL` matches a provider _prefix_, and the default `af_heart`
names a voice, so an unpinned run reaches for the paid provider.

|                | `cardiac8` (before)            | `cardiac8f` (this film)          | Golpo |
| -------------- | ------------------------------ | -------------------------------- | ----- |
| runtime        | 174.1s                         | 176.3s                           | 59.5s |
| mean ink       | 5.0%                           | **5.7%**                         | 14.4% |
| hues           | 1                              | **4**                            | 6     |
| silence ≥0.35s | 26.8s (15.4%)                  | 27.3s (15.5%)                    | 3.2s  |
| voice recorded | `elevenlabs/af_heart`, $0.4286 | `kokoro/…Kokoro-82M…`, **$0.00** | —     |

So: **hues 1 → 4 and the gate's ≥3 is met; ink 5.7% against a ≥10% gate is missed.** The
figure lane is not the reason. The renderer says why in its own warning — _"mean content fill
25% of frame across 10 scenes"_ — and the two frames say it better than any number:

- `figure-film-one-card-113s.png` — one centred colour cutaway, a title, names in the clear
  margin with leaders, and the blue conduction pathway drawn **over** the form. This is the
  best card this repository has produced and it is the same class of thing as theirs.
- `figure-film-two-cards-26s.png` — the same lane, two cards sharing the frame, each subject
  about 40% of its half. Nothing is wrong with the picture; the board is diluting it.

The difference between those two frames is Phase 2. Density was never Phase 1's to win.

### Three defects the frames show, that no number did

1. **The white card seam is still there.** The figure sits on a visibly lighter rectangle
   against `#fcfbf9` paper. `PLAN-FIGURE-LANE.md` item 2 recorded it; `mix-blend-mode:multiply`
   was supposed to be the answer and is not sufficient.
2. **`AV nod` is clipped** in `figure-film-one-card-113s.png`. That is defect 0 — the planner
   sizing text from `FONT` while the renderer draws it from `TYPE_SCALE` — caught in a frame
   rather than in a list. It is Phase 5's first item and the frame is now the evidence.
3. **Marks for a figure are composed blind.** `underlayFor` short-circuits on
   `kind === 'figure'` and returns `undefined`, so the author never sees the picture it is
   annotating. At 26.2s that produces black enclosure loops drawn across the anatomy. The
   brief tells the author to draw very little on a figure; nothing enforces it.

### A square picture in a 3:2 box

Every figure draws at **66.7% of the box reserved for it** — measured on all three:
`567x378 -> 378x378`, `509.96x339.97 -> 340x340`, `491.73x327.82 -> 328x328`. `FIGURE_AREA`
is 3:2, every generated PNG is 1024x1024, and the renderer fits uniformly and centres. A
third of the area the figure lane fought for is blank paper, and it is invisible to every
existing check. This is the largest single move available on `inkstat` and it is not in the
plan.

### Two corrections to the plan's own evidence base

**`cardiac8`'s voice was not simply kokoro — it was a mixed run.**
`audio/scene-000.timing.json` splits on commas, which is the clause default ElevenLabs takes;
every later scene splits on sentences, which is Kokoro's preference. ElevenLabs spoke scene 0,
the balance died, and the rest is local. That matters for more than the record: reporting
whoever _finished_ would have booked $0.00 for characters that really were charged, which is
the same defect as the $0.4286 pointing the other way. `resolvedVoiceChoice` and
`billedVoiceChoice` are now allowed to disagree.

**`lanecheck` could not see a figure.** It printed `draw+underlay` for a figure and a form
alike — it read `VisualIntent.kind`, which is always `draw`, and never `underlay.kind`. The
Phase 1 gate could have been run, passed, and proved nothing. Fourth instance of one failure
mode. It now prints `draw+figure` / `draw+form` and names the figure beats.

### The Anthropic account is out of credits

`keys validate` passes — the key is valid — but every lesson call returns
`400 "Your credit balance is too low to access the Anthropic API"` and the stage falls back to
the local derivation **silently**, reporting `author: 'anthropic'` because `cast.ts` sets
`author = adapter` before the call. Same defect as the voice one, one stage over, and
unfixable inside `cast.ts` alone: `teachLesson` returns a bare `Lesson` and swallows the
failure, so nothing downstream can know. Phase 3's verification is blocked until credits are
topped up. Phases 2, 4, 5 are not — none of them needs a model.

## 2026-08-09 — Phases 2 and 4 land; defect 0's premise turns out to be false

Seven commits on `visuals-morph-density`, from `b8f6291` to `45d4ff9`. **699 tests**
(654 at the start), lint and typecheck clean, and the four pinned hashes —
`b6ed04d68aaa` / `4aa467530110` / `a9b5b8960ed0` / `c0f2ccc5024c` — unmoved at every
single commit.

| Phase            | State                                                                     |
| ---------------- | ------------------------------------------------------------------------- |
| 0 preflight      | done — the figure lane was uncommitted and is now committed               |
| 1 figure film    | rendered for **$0.00**; hues 1 → 4; ink 5.7% against a 10% gate           |
| 2 wipe the board | done, and reachable: `cast … --board wipe`                                |
| 3 script economy | **not started** — blocked, see below                                      |
| 4 the voice      | done — records who spoke, prices per credit, flash                        |
| 5 craft layer    | 5a (labels) done; **defect 0 attempted and reverted**; titles not started |
| 6 mascot         | not started                                                               |

### Defect 0 is not what the plan says it is, and the fix was reverted

The plan (Phase 5 item 1) says the planner's `FONT` and the renderer's `TYPE_SCALE` are
"two catalogues of one number" and that the renderer draws 18% bigger. **They are not two
quotes of one number: `FONT` is in canvas units and `TYPE_SCALE` is in output pixels**,
which `camera.ts:276` already said and which nothing had reconciled. Making them equal is
a units conflation, not a unification.

The attempt was made and is reverted at `45d4ff9`. It left three render tests red
(`text roles map onto the type scale`, `text is wrapped, measured, and revealed word by
word`, `a ball riding a plot lands on the curve`) and it shrank type by ~21% in every
film — against the only calibration evidence in the repo, `compile.test.ts:147`, which
reasons explicitly in pixel space: _"A 96 px title therefore lands as ~72.7 canvas units —
which is what fits the 150-unit box the author drew."_

Two things the attempt did establish, which are worth more than the fix would have been:

- **There is a third catalogue.** `ROLE_SCALE` in `visuals/src/style.ts` sizes every
  diagram node, term card heading and arrow label through `roleFontSize`, unconditionally
  and with no `typeSizes` — so a board already writes text elements from one table and
  diagram labels from another.
- **On the shipped boards nothing clips the way the plan describes.** Standard 16:9 draws
  body at 17.4 and 33.5 canvas units into a 34-unit box — _smaller_ than reserved. The
  `AV nod` clipping in `docs/research/golpo-parity/figure-film-one-card-113s.png` is real,
  but the plan's stated cause is not it, and the next attempt should start from the frame
  rather than from the two constants.

The honest fix is a fixed-point pass — measure at `FONT`, resolve framing, re-measure at
`boardMetrics().type`, re-resolve — and **it will move all four pinned hashes**, so it is
a decision for a person, not something to slip into a phase.

### What blocks the rest

**Anthropic is out of credits.** `keys validate` passes because the key is valid, but
every lesson call returns `400 "Your credit balance is too low"` and the stage falls back
to the local derivation silently. Phase 3 is a lesson-brief change whose entire
verification is `designLesson` ×2, so it cannot be started honestly until this is topped
up. Nothing else in the plan needs a model.

**ElevenLabs: about 8,864 of 10,000 characters left.** 1,136 were spent by an agent that
ran a real `cast` as end-to-end proof of the `--board` flag, believing the run was local
because it found no provider keys in `env` — the CLI's `hydrateKeys()` copies vault keys
into `process.env` before any stage runs. The isolation that actually works is what
`apps/cli/test/cli.test.ts` does: `INKCAST_HOME` + `INKCAST_KEYVAULT_BACKEND` +
`INKCAST_PROJECTS` at a sandbox. Anything running a real `cast` for a non-voice reason
must pin `--voice kokoro:af_heart` as well.

### Where the density actually is

Three measurements, so nobody re-derives them:

- **Wiping is not a density fix.** The same beat renders 2.73% ink wiped against 2.59%
  accumulated. What wiping buys is that the camera stops touring whitespace and stale
  cards stop sharing the frame: mean content fill 55.5% → 62.3%, regions 4 → 1, canvas
  4448x2908 → 1280x895. Do not read a wipe render's ink as this phase's verdict.
- **A camera transition costs zero wall clock.** `sceneLength` has no transition term and
  the ease runs inside the next scene's own duration. Phase 3's ≤0.7s boundary budget has
  to come out of `hold`; there is nothing to reclaim from transitions.
- **The figure was drawing at 66.7% of its own box** until `5090421`. That is fixed at the
  request rather than at the fit, and it is the largest single move left on `inkstat` — but
  it is unmeasured, because seeing it needs a re-render with regenerated rasters at the new
  aspect. **That is the first thing the next session should do**, and it costs about $0.10.

## 2026-08-22 — the integration pass: the tree is green, and three of the plan's premises were wrong

Eight agents finished across the web app, the pipeline and the deploy artifacts, all on top
of `089d3e3` ("Save the launch build where the agents left it"). This entry is the gate over
all of it. Every number below is followed by the command that produced it.

### The gates

| gate          | command                                                               | result                      |
| ------------- | --------------------------------------------------------------------- | --------------------------- |
| typecheck     | `pnpm -r typecheck`                                                   | **9/9 projects Done**       |
| tests         | per-package `pnpm --filter … test`                                    | **847 pass, 0 fail**        |
| lint          | `pnpm lint`                                                           | **All matched files clean** |
| studio build  | `pnpm --filter @inkcast/web build`                                    | **passes**, 23 routes       |
| pinned hashes | `npx tsx packages/pipeline/src/sbhash.mts gradient-descent longitude` | 3 unmoved, **1 re-pinned**  |

Per package: keyvault 56, planner 209, visuals 232, voice 71, render 92, pipeline 77, web
87, cli 23.

**`pnpm -r typecheck` was NOT green at `089d3e3`, and the commit message says it was.** Six
of the eight agents independently reported this and each was right. Two errors, both
committed, both in `packages/planner/src/compile.ts`:
`src/compile.ts(279,17): error TS2304: Cannot find name 'referTo'` and
`src/compile.ts(319,33): error TS2353: … 'pictures' does not exist in type 'BoardMemory'`.
The planner suite was 138/147 with 9 failures, and no pinned hash could be checked at all
because `compileLesson` threw for every storyboard. Anything that commit claims about test
counts or hashes was measured before the last edit reached disk.

Both are fixed. `referTo` existed and exported from `refer.ts`; only the import at
`compile.ts:73` was missing it — one word. The `memory` initialiser's `pictures` and `names`
were dropped rather than added to `BoardMemory`, because the identity they were going to
track is already tracked one layer down: `registry().mint` keys on the content-derived slug,
so two beats asking for one subject resolve to one `Asset` and the generator is paid once.
Adding two members nothing reads would have been the written-and-never-read pattern again.

### One hash re-pinned: longitude/short, `c0f2ccc5024c` → `882002cbf24c`

Not taken on trust. `packages/planner/src/text.ts` was unmodified in the working tree, so
`git show HEAD~1:packages/planner/src/text.ts` is exactly the trimmer that produced the old
hash. Compiling longitude/short under each and diffing the pretty-printed storyboards gives
**four lines of `diff` output** — one changed `label`:

```
"label": "Longitude is a difference between"   ->   "Longitude is a difference"
```

`between` is one of the words `text.ts`'s `DANGLING` list learned for defect 0b. The other
three pins were byte-identical under both versions, which is the cross-check that says this
is a string and not geometry: the type-scale attempt reverted in `45d4ff9` moved all four
and rewrote 330 geometric values. Re-pinned in `test/pinned-hashes.test.ts` and in the
`COMPILER_VERSION` comment, with the reasoning and the reproduction recorded in both.

### Three of the plan's stated premises are false

**A6 is NOT dead code.** The brief handed down to this pass asserts that `sketchWritten`,
`sketchUnderline`, `TITLE_UNDERLINE`, `brandMark` and `BRAND_MARK` have zero call sites
outside `sketch.ts`. Measured: `packages/render/src/compile.ts:508` calls `brandPlateItem`,
which calls `sketchBrandMark` at `:780` and uses `BRAND_MARK.stroke` at `:794` and `:797`;
`sketchUnderline` is called at `:1332` via `titleUnderlinePrims`, itself called at `:1346`.
`sketchWritten` does not exist anywhere in the repo and never did — the grep in the brief
named a symbol that was never written. The A6 grep predates `089d3e3`. A6 shipped as dead
code and was then wired; the finding is stale, not wrong about history.

**A4.3's fill clamp is arithmetically impossible and A1's ink gate cannot pass.** Unchanged
from the previous entry and re-affirmed: fill is the product of how much frame the camera
holds — capped by the 76.5% safe area — and how much of that the ink covers, measured at
30–76% across the corpus, so a 55% clamp needs a coverage the corpus never reaches.
Enlarging figures moved mean ink by less than reporting precision and cost a hue. **The real
density lever is killing the pale white card behind each generated figure**, which is free
and is in the render lane. No keyed run should be spent on the clamp.

**`explainer` was unreachable from every entry point.** One list, written down four times,
and no two checked against each other. `packages/planner/src/presets.ts:28` defines it;
`packages/pipeline/src/stages.ts:41` mirrored `'standard' | 'short' | 'square'`, so
`CastInput.preset` could not _hold_ the value; `apps/cli/src/main.ts:25` validated against
the same three, so `readFlags({ preset: 'explainer' })` threw
`--preset must be one of standard | short | square, got "explainer"`; and
`apps/cli/src/usage.ts` advertised the same three in prose. So the studio's whole hosted
format cap — `hostedFormat()` and `HOSTED_PRESET`, exported and unit-tested for a day —
could not be handed to `cast()` at all, and no CLI user could ask for the preset either.

`pnpm --filter @inkcast/web typecheck` is what finally said so, and only because this pass
wired `hostedFormat()` into the route. Nobody had tried to pass the value. All four copies
now agree, and the two that a compiler cannot check are guarded by tests:
`packages/pipeline/test/preset-mirror.test.ts` asserts the mirror equals `Object.keys(PRESETS)`
in both directions, and `apps/cli/test/flags.test.ts` asserts every accepted preset also
appears in the `--preset` help line — the user-visible half of the list was exactly the half
nothing was checking.

### The launch surface did not exist in git

`.gitignore` line 9 was `projects/` — no leading slash, trailing slash — which git matches at
every depth. `git check-ignore -v apps/web/app/api/projects/route.ts` printed
`.gitignore:9:projects/`. **Five files were untracked**: the library listing, the project
GET/DELETE, `/edit`, `/rerender`, and the route that flips `shared: true` — the whole of
D3's ownership enforcement surface. A fresh clone had none of it. `.prettierignore` carried
the identical unanchored pattern, so those same five files were also excused from
`prettier --check .` and the lint gate had been reporting green over a hole.

Both are anchored now (`/projects/`, `/renders/`, `/.inkcast/`), plus `/.screens/` for the
screenshot gate's ~70 PNGs. `git check-ignore` on the route files now exits 1, and the three
working dirs at the repo root are still ignored.

### Security: `/api/keys` was live on a hosted box

`grep -rn isHosted apps/web/app/api/keys/` returned nothing. `/settings` correctly stops
rendering the BYOK panel when `INKCAST_HOSTED=1`, but the four handlers behind it — GET,
POST and DELETE on `/api/keys`, POST on `/api/keys/validate` — were unguarded, and they
read, write and delete entries in the **operator's** vault: the credentials paying for every
visitor's film. Hiding a panel is not closing a door, and an unlinked endpoint is not a
private one.

All four now open with `offOnHostedBox('the key vault')` (new, `_lib/http.ts`), which returns
404 rather than 403 so a hosted deployment does not advertise that a vault exists. The guard
sits above the vault call and above `readJson`, so a hosted box never parses a key out of a
request body.

### The queue told every client it had started

`apps/web/app/api/generate/route.ts` wrote `status: 'running' as const` into its 202 while
`startJob` was returning a snapshot whose status is `'queued'` whenever both render slots
are busy. So under exactly the load the queue exists for, the response lied — silently, and
self-repairingly, because a queued job does eventually run. `jobs.ts`'s own docstring says
that response is where a client learns where it stands. It now forwards `snapshot.status`
and the whole `snapshot.queue` object (position, running-ahead, eta, message), so the 202 and
the SSE stream cannot describe one wait two ways.

### Cost: half the phantom is dead, and the other half is worse than reported

The cached-lesson phantom is fixed. `cast.ts` now passes
`lessonAuthored: design.author === 'anthropic' && !run.skipped.includes('lesson')`.
Measured across the 22 recorded projects in `projects/`, by reading each `pipeline.json`:
**`projects/cardiac` is the only one with `lesson` in its own `skipped` array and a lesson
cost line** — $0.2567 of a recorded $0.627, 41% of that project's total. Every other project
carrying a lesson line has `lesson` absent from `skipped`, so the predicate zeroes exactly
that one case and touches none of the other 21.

`packages/pipeline/src/spend.ts` is now exported from the package index. It was complete,
tested to 13 cases including 8 separate OS processes appending concurrently, and reachable
from nowhere. **It is still not called**: `decide()` runs before no generation and `book()`
after none, so `INKCAST_DAILY_USD` does nothing today. Exact call sites are listed in
`docs/KEYED-GATES.md` Gate 6.

### Provenance is still set before the call — reproduced, with evidence, for $0.00

Trap #3 in `docs/PLAN-LAUNCH.md`, and the 2026-08-09 entry above already named it for the
lesson stage. It is still live, and this pass reproduced it by accident while checking a CLI
flag. A run with `ANTHROPIC_API_KEY=disabled-no-spend` produced a `pipeline.json` recording

```
providers.lesson: "anthropic/claude-opus-5"
cost.lines: [{ stage: "lesson", usd: 0.0178, basis: "~2000 in + ~313 out tokens …" }]
lesson.problems: []
```

All three false. The lesson's `objective` was
`"explain in your own words how --version works, and why each step of it is needed"`, which
is the template literal at `packages/planner/src/lesson-derive.ts:464` — the **local
heuristic** author. No model was called, $0.0178 was booked, and `problems` was empty so
nothing reported the demotion. `cast.ts:485` is `author = adapter`, decided from which env
vars are set; `packages/planner/src/lesson.ts:86-90` falls back with a bare `log.warn` and
returns a plain `Lesson`, so nothing downstream can learn what happened.

This matters for reading the fix above: `lessonAuthored` keys off `design.author`, and here
`design.author` is itself the lie. The two bugs share a symptom, have different causes, and
only one is fixed.

The **voice** lane, by contrast, is correct: `voiceRecordOf` (`cast.ts:1215`) takes a
`ResolvedVoice` carrying `spoke`, `charsByProvider` and `problems` observed inside the stage,
and deliberately inherits rather than re-deriving. The **figure** lane has no observation
point at all — `providers.images` is the configured head of the chain, and `Asset`
(`packages/core/src/storyboard.ts:72`) has a `source` enum but no field naming which provider
drew it. The billed _count_ is honest (`generatedAssets` is diffed against the assets present
before the stage ran); the attribution is not.

Not fixed here, deliberately: it is a cross-package signature change through the stage
contract, it moves storyboard content for any project with generated assets, and proving a
fallback is _reported_ requires making one happen — a funded key and a deliberately broken
one. Filed as a keyed gate.

### Smaller things, each with its evidence

- **The launch favicon was the placeholder.** `app/icon.svg`, `favicon.ico`,
  `apple-icon.png`, `opengraph-image.png` and `.alt.txt` all existed, but `layout.tsx` still
  carried a `metadata.icons` block whose own comment said C4 "replaces this whole block" —
  and an explicit `metadata.icons` overrides Next's file convention. Deleted. The build now
  lists `/icon.svg`, `/apple-icon.png` and `/opengraph-image.png` as routes and
  `.next/server/app/favicon.ico` exists.
- **`pnpm cast --` silently eats flags.** `pnpm --filter @inkcast/cli exec node -e '…' -- --preset explainer`
  forwards `['explainer']`: the flag name is gone. `pnpm cast -- <file> --preset explainer`
  therefore rendered at `standard` and reported success — which is why the `explainer` bug
  survived, since the obvious way to test it cannot test it. Worse, `pnpm cast -- --version`
  dropped `--version` and the CLI read the leftover token as a **topic**, authoring and
  rendering a full four-beat lesson about "--version". Both accidental renders were removed;
  `projects/` is back to its 22 recorded projects. Use
  `npx tsx apps/cli/src/index.ts …` instead. Documented in `docs/KEYED-GATES.md`.
- **`docs/KEYED-GATES.md` is new**: every gate needing a funded key or a deployed box, with
  the exact command, the pass criterion, and the measured cost. A full keyed cast is
  **$0.45–$0.77** (from `projects/cardiac8`: lesson $0.279, voice $0.4286, visuals $0.003).
  Voice is 60% of that, so a gate that only needs pictures should use `drawcheck.mts` at
  ~$0.003 instead of a $0.70 film.

### UNPROVEN — nothing below was verified, by me or by anyone

- **No film was rendered and no frame was looked at in this pass.** Every pixel claim in the
  eight agent reports — the brand plate's 92px tile at bottom-right, the accent underlines,
  the `InkUnderline` and storyboard-thumbnail fixes, the 24%-full outro with text over
  pictures — is inherited, not re-measured. The outro collision defect is free to reproduce
  (`frames.mts`) and is still open.
- **Nothing has ever been deployed.** `docker build` completing, the healthcheck, the p95
  admission gate, the janitor, and the `/api/keys` 404 I just added are all unverified
  against a real box. The 404 guard is unit-testable and is not yet unit-tested.
- **The hosted preset cap is proven only by the compiler.** `hostedFormat()` now reaches
  `castInput` and typechecks end to end, which is strictly more than yesterday, but no
  hosted POST was made and no 75-second film was produced.
- **`INKCAST_DAILY_USD` does nothing.** The ledger is exported and untested against a real
  run because it is called from nowhere.
- **`cancelJob()` still has no production call site**, so nothing can vacate a queued run
  from outside the test suite.
- **`DRAW_BRIEF` has no `math` mark**, so `drawing.ts`'s `math` builder and
  `equation.ts`'s `texError` guard remain unreachable — typeset mathematics is still drawn
  in a handwriting font. Deliberately not landed: the bullet requires bumping
  `STAGE_CODE_VERSION.draw`, which invalidates every cached lesson in the corpus and bills
  the owner for re-authoring each on its next keyed run. That is their call, not an agent's.
  Exact bullet text is in the agent report; pass criterion is in `docs/KEYED-GATES.md` 3a.
- **`apps/web/components/site-header.tsx`** is 201 unreferenced lines. Four comments in other
  files point at it by name, so deleting it means rewriting those four; left in place as
  lower value than the docs, and named here so it is not forgotten.
- **`.env.example` is stale**: no `INKCAST_HOSTED`, `INKCAST_SESSION_SECRET` (which the app
  refuses to boot without when hosted), `INKCAST_BYPASS_TOKEN`, `INKCAST_PUBLIC_URL` or
  `INKCAST_ACME_EMAIL`, while both `docker-compose.yml` and `docs/DEPLOY.md` say
  `cp .env.example .env`. It does document `INKCAST_RENDER_WORKERS`, which
  `grep -rn INKCAST_RENDER_WORKERS packages/ apps/` shows is read by no code anywhere.
- **`apps/web/next-env.d.ts`** shows as modified, is Next-generated, and is in
  `.prettierignore`. Somebody should decide whether it is committed or reverted.
- **Client-side caps and share surface**: the routes return `generationsLeftToday` /
  `operationsLeftToday` and a 429 body with `limit` and `retryAfterSec`; nothing reads them,
  so a user still meets the cap as a bare error. Plan B2's share surface (captions `<track>`,
  a "Made with Inkcast" plate, a Remix CTA) is unbuilt, and the project DTO carries no
  `thumbnailPath`, so `/library` posters fall back to downloading the mp4.

---

# The PLAN-WATCHABILITY acceptance test, run 2026-08-25

`docs/PLAN-WATCHABILITY.md` states its acceptance test before anything else and says "do
not ship 'improved'; ship 'passes'". This is that run, and **it does not pass: seven of
nine gates clear and two do not.** The film is `projects/f3ac9c760194`, contact sheet at
`renders/acceptance-f3ac9c760194/contact-sheet.png`.

## How it was cast

Through the local studio, no flags, the way the plan specifies:

```
POST http://localhost:3000/api/generate
{"text":"Why do heavy and light objects fall at the same time"}
```

against a **`next dev` process started seconds earlier**, whose settings page had never
been opened in any browser — which is gate 9's whole point. All three keys came from the
macOS keychain. Clerk was unset for the run so the request could be made without a browser
sign-in; nothing else about the path differs, and identity is not what any gate is about.

Result: `ready`, **78.65s, 8 scenes**, `qc.json` `ok: true` at `gates: strict`.

## The nine gates

| #   | gate                                                              | result           | measured                                |
| --- | ----------------------------------------------------------------- | ---------------- | --------------------------------------- |
| 1   | board: one card per beat, wiped; recap redraws; `fillcheck` ≥ 45% | **FAIL**         | board and recap correct; **fill 27.8%** |
| 2   | pen: never two elements mid-draw                                  | **PASS**         | `pen` check, 0 findings                 |
| 3   | dwell: ≥ 1.5s after the last element; nothing starts after 88%    | **PASS**         | `dwell` gate, 0 findings                |
| 4   | draw time scales with ink, not a flat 0.8s                        | **PASS**         | see below                               |
| 5   | no card title is a mid-phrase truncation                          | **PASS**         | 8 authored titles, 0 shortened          |
| 6   | multilingual v2, sentence split, spoken voice recorded, pace ±5%  | **FAIL as cast** | +12% — see below                        |
| 7   | ≥ 2 beats carry a generated figure                                | **PASS**         | 3 figures                               |
| 8   | 60–90s, misconception survives                                    | **PASS**         | 78.65s; misconception kept, `step4` cut |
| 9   | works in a freshly restarted `next dev`                           | **PASS**         | `elevenlabs` on a virgin process        |

## Gate 1, which is the real finding

The board half is right and is a visible change: `board: wipe`, a 1280×895 canvas, one card
per beat, every scene at zoom 1.37, and a recap that redraws its chain at card scale
instead of pulling back to show eleven thumbnails. Nothing in this film resembles the
mega-canvas frame `docs/HANDOFF-PARITY.md` calls indefensible.

`fillcheck` reads **27.8% (min 14%, max 65%)** against a 45% bar. Split by lane it stops
being one number and becomes a diagnosis:

| beats                                                                   | mean fill |
| ----------------------------------------------------------------------- | --------- |
| the 3 figure/plot beats (s0 44.0%, s5 64.9%, s6 35.8%)                  | **48.2%** |
| the 5 mark-composed beats (s1 14.6, s2 19.0, s3 13.6, s4 14.6, s7 15.6) | **15.5%** |

**The figure lane clears the bar and the mark lane is a third of it.** Frame-vision agrees
independently — "at 13.6s (scene s1), a vision pass reports a mostly empty board" — and so
does the contact sheet: "A tug of war" is one hatched circle and two arrows on an otherwise
blank card. The generated pictures fill about half the frame each, which is what
`FIGURE_AREA` was widened for and it worked; composed marks do not fill the card they were
given.

**And 45% is a bar the corpus does not meet either.** Compiling the three shipped lessons
at `explainer` (free, no keys) gives the comparison nobody had made:

| lesson           | `standard` | `explainer` (wipe) |
| ---------------- | ---------- | ------------------ |
| gradient-descent | 51.4%      | **60.9%**          |
| longitude        | 20.3%      | 35.8%              |
| hash-map         | 22.1%      | 38.0%              |
| this film        | —          | 27.8%              |

Two things follow, and they are different things. Wipe really does buy fill — +9.5, +15.5
and +15.9 points on the three lessons — so `presets.ts`'s "55.5% → 62.3%" claim is sound.
But **that pair of numbers is gradient-descent alone**, the densest lesson we ship, and 45%
was drawn from it. Two of three shipped lessons miss it under the very preset the plan
mandates. So gate 1 is failing for two reasons at once: this film is genuinely sparser than
the corpus (27.8% against 35.8 and 38.0), _and_ the threshold was set from a sample of one.

Untangling those is the next piece of work and it is not a threshold edit. The mark lane
composing to 15% of the card it is handed is the defect; moving the bar to fit it would
just stop measuring it.

## Gate 6, and what was re-pinned (5.3)

Everything except the pace clears outright: `pipeline.json` records
`model: eleven_multilingual_v2`, the sidecars carry whole sentences with
`endsSentence: true` (sentence split, live), and the **spoken** voice is recorded rather
than the requested one —

```
"voiceId": "EXAVITQu4vr4xnSDxMaL",          <- Sarah, who actually spoke
"substitutedFrom": "21m00Tcm4TlvDq8ikWAM",  <- Rachel, who was asked for
```

with a problem line saying the plan cannot use Rachel via the API. That is plan 0.3 working
end to end on a real 402, and it is the fact the dissection said was recorded nowhere.

The pace failed: **12.16 delivered spoken letters a second against the 10.87 the planner
budgeted with, +12%**, so every scene was shorter than planned. 10.87 was one film under
`eleven_flash_v2_5` at clause split; this repo now speaks multilingual in sentences.
`DELIVERED_LPS_BY_PROVIDER.elevenlabs` is re-pinned to **12.16** — measured over 54.6s of
narration, 158 words at 2.89 words a second and 4.20 letters a word.

`ELEVENLABS_BASELINE_WPM` moves 185 → **193**, and it is worth knowing that this changes no
audio. The film delivered 173.6 wpm at `speed 0.9`; 173.6 / 0.9 = 192.9. But the ±10% clamp
binds either way — 150/185 and 150/193 both floor to 0.9 — so the constant only starts
affecting what is spoken when it comes within 10% of the target rate. It is a
truth-in-reporting fix. A clean measurement wants a run with `speed` pinned to 1.0, which
nothing currently asks for.

**Gate 6 is not re-verified.** The constant now equals this film's own rate, which makes
the gate true for this film by construction; whether a _second_ film lands within ±5% of
12.16 is the real question and needs another keyed cast.

## Gates that pass, briefly

- **4 (draw time)** — `pen` and `dwell` both clear as gates, which they could not before
  1.2 and 1.3. Durations are ink-proportional via `durationFor`; the flat 0.8s is gone.
- **5 (titles)** — every one of the eight cards carries an authored `LessonStep.title`:
  "The drop test", "The pull", "The stubbornness", "A tug of war", "Growing together",
  "Ten each second", "The feather", "The whole chain". None is a shortened `idea`.
- **7 (figures)** — `art direction: 8 beats routed · 3 figure, 5 marks`. The router put
  figures on the hook (the drop), the bricks step and the misconception (feather vs
  hammer). The plan's §4.3 predicted the feather beat would be a figure and it is; it
  predicted vacuum tubes, and this lesson wrote the beat as a misconception instead.
- **8 (misconception survives)** — the lesson authored 9 beats and `explainer` caps at 8, so
  one had to go. The trimmer cut **`step4`** ("Two bricks glued together must fall like one
  brick") and kept the misconception, whose `derivedFrom` is `['step3','worked']`. Before
  plan 5.1 the misconception was the first thing it reached for. `misconception-cut`, the
  new blocking check, reports 0 findings.
- **9 (reliability)** — the run that proves it: a `next dev` started seconds before, no
  settings page ever loaded, and the voice stage reported `elevenlabs` on scene 1. That is
  the silent Kokoro fallback of §E3 fixed.

## The figure seam met a real provider for the first time

`docs/HANDOFF-WATCHABILITY.md` flagged `drawFigure` as wired, typechecking, tested, and
never once run against an image provider — with a silent failure mode: if the seam and the
compiler disagree on any cache input, the film pays for a _second_ picture and the marks
are aimed at the first.

They agree. `no figure board for` appears **zero** times in the run log, so the seam fired
for all three figures, and `assets/illustrations/` holds **exactly three** rasters, one per
prompt. The visuals stage resolved the seam's own pictures out of cache rather than
generating alternates.

## Standing advisories on this film

Strict-clean, so these are advisories and not failures, and the sparseness ones corroborate
gate 1: four `drawing` label-on-ink defects (marks written across a figure's own ink — the
composed layer still crowds the picture it was shown), six `frame-vision` findings
including one "mostly empty board" and two clipped labels, and one `lesson` note that the
untrimmed lesson estimated 112s against a 75s target.

# 2026-08-26 — gate 1, taken apart: the mark lane is not the defect, the beat is

The session after the acceptance test, working the two pieces of work its handoff named:
make the mark lane fill its card, and then re-derive the bar from more than one lesson.
Both are answered below, and the answer to the first is not the one the handoff expected.

## Fill is a product of three things, and only two of them are anybody's choice

Under `wipe` the camera is fitted to the ink — `fitDrawing` is a content fit and
`resolveFraming` frames the union of what is on the board — so what a card carries reduces
exactly to

    fill = safe area (76.5%) x shape match x cover

where **shape match** is how close the drawing's own bounding box is to 16:9 and **cover**
is how much of that box the marks' boxes fill. The size a drawing is authored at cannot
appear in that product: scale everything up and the camera pulls back by the same ratio.
That is why every previous attempt to "make the drawings bigger" would have moved nothing,
and it is the sentence the correction brief now carries.

Two consequences worth stating plainly. A card of line art on a 16:9 board **cannot** reach
45% by drawing the same parts larger; it gets there only by having more parts, or by being a
picture. And the whole calculation is available from the marks, before a pixel is drawn —
`cardFill` in `packages/planner/src/draw-geom.ts`, reported per drawing by `markcheck.mts`
and as the `thin-card` defect in the audit. Predicted against the board on this film's own
eight beats it runs about two points pessimistic (it does not know about the caption the
board writes above the card).

## What the corpus says, now that it can be measured

The 217 drawings in the machine-wide cache, at 50ms and no key: **cover median 44%, p25 32%,
p75 62%; predicted fill median 26%**, with the good end of the corpus reaching 50–67%. So
the lane can compose a full card. 79 of the 217 predict under 22% of the frame, which is the
`thin-card` threshold — chosen to sit between `reportFill`'s two existing statements of the
same standard (a film under 25% is "mostly whitespace", a scene under 14% is empty).

## The finding: a thin card is a thin _beat_

`hash-map` is the second lesson whose beats are hand-placed marks, and it is the comparison
that was missing. Its six drawings, authored 2026-08-26 (`drawsheet.mts`, ~$0.12) and
compiled at `explainer`:

| lesson                     | mean fill | its mark beats          |
| -------------------------- | --------- | ----------------------- |
| gradient-descent (plots)   | 60.9%     | — (plot lane)           |
| **hash-map (real marks)**  | **43.2%** | **39.3%** (30.6 – 49.5) |
| longitude (asset boxes)    | 35.8%     | — (illustration lane)   |
| this film (marks + 2 figs) | 29.5%     | 18.2% (13.4 – 22.7)     |

The mark lane draws a full card for a beat that has structure in it — a grid of
pigeonholes, two tables of buckets, three keys converging on one slot — and a fifth of a
card for a beat that is two objects side by side, which is what every mark beat of the
falling film is. 5 of hash-map's 6 drawings measure clean and **not one is a thin card**.

That also corrects a number this file published yesterday. Compiling `hash-map` without keys
gives 38.0%, and that figure is an artifact: its six `draw` intents have no marks on disk, so
the compiler falls back to an `asset` box per beat and measures the illustration lane's
geometry. Cast for real it is 43.2%. `longitude`'s 35.8% is _not_ an artifact — its beats
really are illustration intents — but neither number was ever a measurement of the mark lane,
which is what "this film is sparser than the corpus" was comparing it against.

## What the brief change bought, measured on the same beats

`DRAW_BRIEF` gained two lines: use the whole canvas _shape_, and draw every part big — with
the note that the ratio is what counts because the board scales the drawing either way. The
five failing beats, re-authored under it (`drawsheet.mts`, ~$0.15) and spliced back into the
film's own lesson:

| beat           | old fill  | new fill  | what moved                  |
| -------------- | --------- | --------- | --------------------------- |
| anchor (hands) | 14.6%     | 13.4%     | shape 70→94%, cover 24→21%  |
| trolleys       | 19.0%     | 18.2%     | shape 49→73%, cover 36→24%  |
| tug of war     | 13.6%     | 17.2%     | cover 27→42%, shape 72→49%  |
| bricks         | 14.6%     | 22.7%     | cover 16→36%, and now clean |
| recap chain    | 15.6%     | 19.3%     | cover 26→31%, and now clean |
| **the film**   | **27.8%** | **29.5%** |                             |

**+2.7 points on the mark lane, +1.7 on the film**, two drawings that were dirty now clean,
and three control subjects redrawn under the same lines came back at 27 / 21 / 13% predicted
fill against 22 / 22 / 14% before (binary search better, knee joint and neuron unchanged), so
the lines do not cost the drawings that were already full. It is a real
improvement and it is a small one: the ceiling on those beats is the beats.

## The correction pass cannot fix a thin card, and no longer pays to try

`FIX_BRIEF` gained a paragraph telling the model that a thin card is the one case where it
should change the picture — grow the parts where they stand, not the drawing. Measured over
eight subjects: **zero improved**. Two calls that existed only because `thin-card` had opened
the gate came back worse and were vetoed (the knee joint 2 → 8, the neuron 2 → 4). So the
gate is now explicit: a thin card is told, never bought. It rides along on a call some other
defect has already paid for, and the veto lets a fuller card through, but it never opens the
gate itself. `INKCAST_DRAW_FIX=all` is how to find out whether a future brief earns those
calls.

## So: the bar, re-derived

Measured at `explainer` + `wipe` on everything the repo can cast, gate 1's 45% is met by one
lesson of four, and the four sit at 60.9 / 43.2 / 35.8 / 29.5 — a mean of 42.4%. **45% is
the plot lane's number.** Two things replace it in `docs/PLAN-WATCHABILITY.md`:

- **≥ 35% mean**, which the plot lane, the mark lane on a structural lesson and the
  illustration lane all clear, and which this film still fails — as it should, because its
  cards really are thin.
- **no scene under 14%**, which is `reportFill`'s own definition of an empty frame and is
  the check that catches the failure a mean can hide.

And the lever for a film like this one is **not** the drawing lane. Its two figure beats
carry 44% and 36% of the frame against its mark beats' 18%, and `MAX_FIGURES` is 4 with 3
used. A beat that is two objects being compared is a beat that should be routed to a
picture; that is a change to `artdirect.ts`'s brief, it costs one image per beat, and it is
the next thing worth measuring.

# 2026-08-27 — gates 7 and 8 closed, and the last paragraph above is wrong

The paragraph that closes the section above names the next thing worth measuring: route a
beat that compares two objects to a picture. **It was measured, and it is not the lever.**
That is recorded first because it is the one claim in this file that will send a reader
down a dead end.

## The routing lever, killed (`8cb712f`)

`routecheck.mts` was pointed at two lessons — `projects/df62ce29a563` (the falling-objects
film) and `projects/deb81002b073` (the six-recognisable-objects lesson) — with a sharpened
`artdirect.ts` brief rule beside the old one. **Identical counts and identical beats, both
times.** The router already answers 3 figures / 5 marks on this topic and it is right on
all five marks: the anchor is two labelled pull arrows, step1 two motion arrows, step2 two
opposing arrows on one ball, step3 the same arrows drawn twice as long beside an equals
sign, the recap a chain of boxes. Every one is a _relation_ whose meaning lives in the
arrows, and a picture of two balls would carry less of it, not more. The brief edit was not
landed; an unmeasured brief edit is the persuasion the measured pass replaced.

`routecheck` also hydrates the keyvault now. Before `8cb712f` it printed "the router did
not run — no key, or nothing routable in this lesson", which reads like a verdict about the
lesson and was actually a missing key.

## Gate 6 closed: the pace estimator is no longer true-by-construction

Two different lessons of the same prompt, measured off `audio/scene-*.timing.json`:
**12.33** delivered letters a second (+1.4%) and **12.08** (−0.7%), against the re-pinned
`DELIVERED_LPS` of 12.16. Both inside the ±5% band, on two films rather than the one the
constant was pinned from. There is no harness; it is ten lines — sum `narrationSec`, count
`\p{L}` over each sidecar's `phrases[].text`, divide.

This matters beyond its own gate: it is what makes `lessonSeconds` a number other decisions
can be taken against, and the two below are taken against it.

## Gates 8 and 7: the cause was the beat count, not the word budget

Both gates were failing, and the previous handoff attributed it to the lesson author
overrunning the word budget by 60–100% every cast. The overrun is real — three casts of one
prompt authored **266, 294 and 337** narration words against a 171-word budget — but it is
**not the cause of anything**, because `clampNarration` already absorbs all of it. After the
clamp those three casts say **147, 151 and 158 words**. The budget binds.

What did not fit was the **beat count**: **9, 9 and 10** authored beats against
`explainer`'s `maxBeats: 8`. So every cast entered `adaptLesson` needing a beat deleted, and
the beat it reached was the misconception — with the generated figure routed to that beat
going with it, which was the whole of gate 7's failure. `misconceptionIsPayload` only
protects that beat when the author happens to cite `worked`, and across the three casts
`derivedFrom` came in as `['step3','worked']`, `['worked']` and `['step4']` — so the
protection held twice by luck.

`overBudget` ORs its two rules, which is why neither relaxes alone: at `maxBeats: 99` the
seconds rule still cut a beat, and at `maxSeconds: 999` the beat rule still did. Measured on
all three casts, only the pair moves the outcome.

The pair that works is the preset's own derivation re-run at nine beats. Nine beats are
7 + 2×1.6 = **10.2 shares**, and 171 ÷ 10.2 = 16.8 words a share, so **18** is the
backstop-not-scissors ceiling exactly as 20 was at eight beats. The extra beat costs seconds
and the tighter clamp pays for it:

| cast           | authored      | as it now compiles      | misconception |
| -------------- | ------------- | ----------------------- | ------------- |
| `f3ac9c760194` | 9 beats 266w  | 8 beats, 67.5s          | survives      |
| `f6978912f741` | 10 beats 337w | 9 beats, 69.3s          | survives      |
| `df62ce29a563` | 9 beats 294w  | 9 beats, **68.6s** 145w | survives      |

**`maxSeconds` is untouched, and that is the point.** It is what `teachingBrief` derives its
word budget from, so raising it to buy trim headroom would have silently asked the author
for a longer film — the failure mode `presets.test.ts` already warns about ("change
`maxSeconds` and the brief silently starts asking for something else"). The 184-word ceiling
and the 171-word budget both come out byte-identical to what eight-and-twenty gave.

Verified on `df62ce29a563` without spending a cast, since the trim runs downstream of the
lesson stage: `sbjson.mts` compiles **9 scenes**, the misconception among them, zero problems
on the channel the blocking check reads, and **two figure assets** where one survived before
— the hook's two open hands and the misconception's two glass tubes. Gate 8 closed, gate 7
closed.

The pinned hashes do not move: `explainer` is deliberately unpinned, and no shared code path
changed. One thing did have to be fixed to keep that true — the ceiling assertion in
`presets.test.ts` had the beat count written as a literal `6`, so it would have gone on
measuring an eight-beat film through exactly the change that moved it.

## Gate 1, with the new scene in

**32.4% mean, min 15%**, against a bar of 35% mean and no scene under 14%. Still failing on
the mean; the floor passes. The restored misconception came in at **46%** fill, better than
the 36% the old film's version measured, and it moves the mean 30.8% → 32.4%.

```
 0 s0  hook          fill 45%  held 50%  cover 90%   <- figure
 1 s1  anchor        fill 23%  held 73%  cover 31%
 2 s2  step          fill 29%  held 70%  cover 41%
 3 s3  step          fill 15%  held 52%  cover 29%
 4 s4  step          fill 29%  held 74%  cover 39%
 5 s5  step          fill 16%  held 50%  cover 33%
 6 s6  worked        fill 66%  held 75%  cover 88%   <- plot lane
 7 s7  misconception fill 46%  held 50%  cover 92%   <- figure, restored
 8 s8  recap         fill 24%  held 71%  cover 34%
```

### Which scenes have to move, and by how much

Only two. Raising **s3 and s5 alone to 30%** takes the mean to 35.8% and closes the gate;
nothing else needs to touch. At 25% it reaches 34.7% and does not. This is the whole of
gate 1's remaining arithmetic.

### And it is `cover`, not `shape` — the previous handoff had this backwards

`markcheck` on the same lesson, per beat (`b3` is s3, `b5` is s5):

```
b1 anchor  cover 44%  shape 68%  fill 23%
b2 step1   cover 45%  shape 64%  fill 22%
b3 step2   cover 24%  shape 86%  fill 16%   thin-card
b4 step3   cover 35%  shape 75%  fill 20%   thin-card
b5 step4   cover 29%  shape 93%  fill 20%   thin-card
b8 recap   cover 30%  shape 97%  fill 22%
```

`docs/HANDOFF-THREE-GATES.md` says these beats have "both factors down at once". They do
not. **`shape` is the healthiest number on the two worst beats** — 86% and 93%, against 64%
and 68% on the two beats that pass. The drawing already spans nearly the whole board. What
is missing is ink _inside_ that span: `cover` 24% and 29%, against 44–45% on the beats that
clear the bar.

So the two are inversely related here, and that is the finding: these beats spread wider
and got thinner doing it. The lever is **not** more canvas — they already have it — and it
is not a bigger drawing either. `markcheck`'s own `thin-card` line says the right thing and
says it precisely: "draw every part bigger where it stands until the ink fills the space
between the parts — scaling the whole drawing up changes nothing, because the board fits it
to the card either way."

Sizing the target: at `shape` 86%, b3 needs `cover` ≈ 35% to reach 30% fill, from 24% now.
The beats that pass sit at 44%, so the number being asked for is one the same author already
produces on other beats of the same film — which is the strongest available evidence that
this is reachable rather than a bar the lane cannot meet.

`thin-card` must still not be allowed to open the critic's gate — see the section above,
where the first eight measured correction calls it would have paid for improved nothing and
made two drawings worse. `INKCAST_DRAW_FIX=all` is how to test a `FIX_BRIEF` that claims to
earn them, and the two beats above are the ones to measure it on.

## Two bugs of the same shape, one fixed and one still open

**`b33daca`, fixed.** In the art director, `prompt` and `why` were `z.string().optional()`,
which accepts `undefined` and **rejects `null`** — and the parse is all-or-nothing, so one
`null` in a field `applyRoutes` goes on to ignore threw away every verdict in the answer and
returned the lesson untouched. Zero figures where the same prompt had produced three, with
one `warn` in a 300-line log as the only trace.

**`core/src/lesson.ts`'s `Mark`, still open.** Ten-odd `.optional()` fields (`x`, `y`, `w`,
`h`, `points`, `text`, `tex`…) and `repairElements` in `draw-anthropic.ts` only mends a lost
opening quote — it does not strip nulls, so a `"w": null` from the drawing author would lose
a whole drawing the same way. It has **not been observed**, which is why it is left alone,
and it is less severe because `drawOne` has a re-ask loop where `routeFigures` had no retry.
If it is fixed, it must be fixed at the model boundary: making `Mark` itself nullish is
wrong, because the same schema validates every `lesson.json` on disk.

## The drop canary was crying wolf (`461e3db`)

`remapDerivations` keeps a canary for the failure that shipped an unfollowable video — a
beat something derives from is cut, the splice rewires the survivor, the wreckage validates.
It was firing on a **legal** cut: `droppableIds` builds `needed` from every surviving beat
_except_ the recap, on its own documented grounds that a recap retraces the whole chain and
honouring its references would leave nothing droppable. So on `f6978912f741`, whose recap is
the only beat citing step5, the trimmer reported "nothing surviving derives from it" and the
canary simultaneously reported that something did. Same reference; only one of them was
counting the recap. The canary now skips the recap and nothing else, and fires zero times
across the three casts and the three shipped lessons at three presets.

## Gate 1, looked at rather than computed — and the second lever is dead too

The two beats the arithmetic above blames were rendered and opened. `sbjson.mts` compiles the
board, `frames.mts` draws it, and because the marks are already authored only the generated
figures degrade to placeholders — so the mark beats render for real, free.

**s5 ("The perfect trade", the balance scale) is a good card.** It spans the full frame, it
is balanced, every part is legible, and it teaches the beat. It scores `cover` 29%, fill
19–20%, and `markcheck` flags it `thin-card` with "draw every part bigger where it stands".
Looking at it, that advice is wrong: there is no part of that drawing which wants to be
bigger, and the white in it is composed rather than left over.

**Why the number disagrees with the frame.** `cover` is a union of **bounding boxes**, and
the lane's own docs already record the diagonal-line weakness. The axis-aligned case is the
same artifact from the other side and it is worse:

```
balance-beam   560x1 units   = 0.2% of the span
balance-post     1x80        = 0.0%
pull-arrow       1x65        = 0.0%
```

Those are among the most visually prominent strokes on the card and they measure nothing. Of
s5's 29% `cover`, **18 points are labels** — two thirds of the measured content is
handwriting, not drawing. On s3 it is 12 points of 24. A drawing whose subject is a
_relation_ is drawn in lines and arrows, and those are exactly the marks with degenerate
boxes.

**What the corpus says.** `markcheck cache` over 269 drawings: mean fill **27%**, median
**25%**, and `thin-card` is the single commonest defect at **108 of 269**. So this is the
lane's dominant systematic reading, not this film's accident. It is also not a ceiling —
drawings in the same cache reach `cover` 95% and 100% — but the ones that do are the ones
built from area marks (`hatch`, `dots`, filled forms), not from arrows.

**So the drawing-lane lever is dead as well, and for a reason worth writing down.**
`DRAW_BRIEF` already contains the definitive statement of exactly this instruction —
"cards whose marks span the whole board and cover a fifth of it, which read as an empty
board with specks on it… It is the _ratio_ that matters and not the size you draw at" — and
the correction pass built on it was measured over eight subjects and improved nothing while
making two drawings worse. A fifth restatement of a paragraph the brief already has in its
strongest form is the persuasion the measured pass replaced.

**What is actually true of the two beats, separately:**

- **s5 is fine and its score is an artifact.** Pushing it fuller would trade a good card for
  two points of a metric.
- **s3 ("Weight is the pull") is genuinely the weaker card.** It is a two-panel comparison
  whose panels are unbalanced — the left panel carries a stick figure, a ball, three labels
  and two arrows, and the right panel carries a hand, an apple and its labels in
  significantly less ink. There is real room in it, and it is the one beat where
  `thin-card`'s advice would be taken honestly.

s3 alone does not close the gate: at 30% the mean reaches 34.2%. s3 to 30% **and** s5 to 25%
reaches 35.2% and passes. So on the current bar, closing gate 1 requires improving a card
that does not need improving.

### One claim withdrawn

A first pass at this read the no-audio render as showing s3's right panel never finishing
before the wipe, which would have been a far worse defect than low fill. It is not true. With
the real per-scene timings from `audio/scene-*.timing.json` — s3's beat is **2.97s** — the
last element enters at 62% of the scene and completes at 2.75s of 2.97s. The ink fits. The
unfinished panel was an artifact of a storyboard compiled with no voice stage, where 12 enter
cues fall back to `enter.at`; those frames cannot be used to judge timing, only composition.

# 2026-08-27 (later) — half the film is blank paper, and the estimator never saw it

A fresh cast on a competitor's own topic — "How does day and night happen in your town",
`projects/c5caa09eb153`, the same prompt as their 89.5s film — was rendered and measured
against theirs. It is the first end-to-end render since 2026-08-25 and it invalidates a
claim made earlier the same day.

## The number

**52% of the film is blank paper.** 48 frames sampled evenly across 96.9s; 25 of them carry
under 0.5% ink. Content coverage mean 1.9%, **median 0.0%**. Against the same measurement on
their film: **5.7%** mean, no blank runs.

## The cause, and it is arithmetic rather than art

|                              | seconds  |
| ---------------------------- | -------- |
| speech (10 scenes, measured) | 44.3     |
| **hold**                     | **51.6** |
| outro                        | 1.0      |
| **total**                    | **96.9** |

The silence is larger than the film's speech. Individual holds run 1.89, 4.56, 3.80, 5.42,
6.78, 3.87, **10.50**, 5.32, 4.53, 4.92 — on a preset whose `maxHold` is **0.8**.

`explainer.maxHold` is not broken; it is **overwritten**. `holdFor` caps the compiled hold
correctly and a fresh `sbjson.mts` compile of this same lesson gives holds summing to
**6.3s**. Then `narrate.ts:1193` does `scene.hold = round3(timing.holdSec)`, the voice
stage's reading-time arithmetic (plan item 1.3, "lengthens a beat so its finished board can
be read before it is wiped"), derived from `boardMetrics` + `inkPaceFor` — the ink drawing
pace. A card with much ink and short narration therefore gets a very long hold.

So `Preset.maxHold`'s own comment — "a cap applied to the estimate but not to the film is a
cap that only makes the estimate wrong" — describes the state of the code again. It fixed
the planner's half; a later stage re-broke it from the other side. Whatever the fix is, the
two mechanisms have to be reconciled rather than each left correct in isolation.

Worth checking before fixing: whether that silence lands _before_ the wipe (a finished card
held, which is what 1.3 intends) or _after_ it (blank paper held, which is what the frame
sampling looks like). The timeline of per-frame coverage runs in long zero stretches, which
suggests the latter.

## What this invalidates

**Gate 8 was verified against `lessonSeconds`, and `lessonSeconds` does not model this
silence.** It estimated **62.7s** for this film; the render is **96.9s**, 55% over. Every
"60–90s" reading taken on 2026-08-27 — including the ones recorded above as closing gate 8 —
was taken on that estimate. The band is a claim about the _film_, so it is unverified on
anything but `f3ac9c760194`, and this film **fails** it at 96.9s.

Gate 6 is not affected and is the reason this is diagnosable: delivered rate measured 11.27
to 14.00 letters a second across the ten scenes, averaging ~12.2 against the 12.16 pin. The
speech arithmetic is right. It is the non-speech arithmetic that is not, and `lessonSeconds`
sums `step.hold` — the _authored_ hold, capped — so it cannot see what the voice stage will
later write there.

The lesson: an estimator is not a measurement, and no gate about runtime should be reported
closed without an `out.mp4`.

## What the same cast got right

Not everything. The lesson is real teaching — card titles came back "One turn, one day",
"Quarter turns", "The ball spins", "The whole chain" — and the misconception survived the
trim, which is what `e60b9bf` was for. The film's length is in the same class as theirs
(96.9s against 89.5s). The defect is entirely in what the viewer looks at during it.

## Ink density, separately from the blankness

Excluding the blank frames does not close the gap: ours reads ~4% on its best frames against
their 5.7% mean and a 10% ceiling. Their explainer films are **line art too** — thin
white/cyan strokes on dark navy, not colour illustration — so the earlier reading of the
parity doc ("a different purpose-drawn figure per beat") does not describe these samples.
What their frames have that ours do not is a **dark ground**, several inks at once, and a
textured rather than flat paper. Sparse line art reads as luminous on navy and as empty on
white.

They also select a visual template per topic — navy blueprint, neon-on-black accumulating
board, painterly colour, flat vector — across the four samples in `~/Downloads`. We have one
look on every topic. That is a larger gap than any single metric on this page.

# 2026-08-27 (later still) — the blank paper is gone, and the key ran dry

`docs/PLAN-GOLPO-CLOSE.md` Phase 1, executed and measured. The film that was 52% blank
paper is 4% blank paper, and all four of that phase's blocking acceptance criteria pass.
One advisory number falls short and is named below rather than rounded up.

## The measurement, both films, one instrument

Same lesson, same preset, same `inkstat.mts` at one sample a second over the finished
`out.mp4`. The "before" row re-measures `projects/c5caa09eb153` from disk and reproduces
the numbers recorded above it exactly, which is what makes the pair worth reading.

|                          | before (`c5caa09eb153`) | after (`gclose1-repro`) | bar     |
| ------------------------ | ----------------------- | ----------------------- | ------- |
| film                     | 96.9s                   | **68.6s**               | 60–90s  |
| speech                   | 44.3s                   | 46.4s                   | —       |
| hold                     | **51.6s**               | **21.1s**               | —       |
| authored hold (compiled) | 6.3s                    | 6.3s                    | —       |
| frames under 0.5% ink    | 50 of 97 (**52%**)      | **3 of 69 (4%)**        | —       |
| longest blank run        | **11s**                 | **1s**                  | none≥2s |
| median frame ink         | 0.40%                   | **2.70%**               | >1.5%   |
| mean frame ink           | 1.81%                   | **3.72%**               | ≥4%     |
| strict QC                | —                       | **25/25 ok**            | passes  |

Per-scene holds went from `1.89 4.56 3.80 5.42 6.78 3.87 10.50 5.32 4.53 4.92` to
`1.97 2.30 2.00 2.00 2.00 2.00 2.25 2.30 2.30 2.02`. They are still over the preset's
`maxHold: 0.8`, deliberately — `allowReadingTime` buys about 1.4s a beat of reading time
— but the board is now **up** for all of it, which is what that silence was always for.

**The three surviving blank frames are the fades, and they were checked rather than
assumed.** They land at 11s, 16s and 37s against scene boundaries at 11.54s, 16.43s and
37.53s: −0.54s, −0.43s, −0.53s, all inside the 0.2–0.55s fade window. That is the rule
working, not a residue of the defect.

**Gate 8 is re-verified on a rendered film**, which is what the section above withdrew it
for: 68.6s is inside the band, and the misconception survives — s8 narrates "the spin
gives you day and night, and nothing else", card titled "Not the seasons".

## The one number that misses, and why it is not this phase's lever

**Mean frame ink is 3.72% against the plan's 4%.** It is not a rounding matter and it is
not being waived: what Phase 1 changed is _when_ there is ink on the board, not how much,
and doubling the mean (1.81% → 3.72%) is the whole of what removing 30 seconds of blank
paper can buy. The density levers are Phase 2 (`accumulate`, which puts more than one
beat on screen) and Phase 3 (fat ink). Measured against the competitor's 5.7% on this
same topic we are now two thirds of the way rather than a third.

Note the three instruments disagree, as they are meant to: sampled at each beat's
_fullest_ the same film reads **4.60%** (`ink-floor`), sampled evenly it reads 3.55–3.72%,
and `contentFill` reads 34.4%. The even sample is the honest one for "what is the viewer
looking at", and it is the one quoted above.

## Two things the plan did not know

**1. `lastFinish` is not idempotent where `wanted` was, and the plan's 1.2 would have
regressed a pinned test.** `PenSchedule.wanted` is computed from authored boxes and is
independent of the beat's length; `lastFinish` and `readingTail` both grow with the length
they are handed. So a second run that measures an already-extended beat finds it wanting
again and extends it again — measured on the pinned fixture, a 0.65s authored hold went
2.15s on run one and **3.65s** on run two. The arithmetic now derives a _target_ length
from `SceneTiming.authoredHold` and appends only the difference, so run two appends
nothing. The append-only trap the plan names is real; this is a second one behind it.

**2. `PlanItem.fadeAt` is the second the fade _completes_, not the second it starts.**
The plan's 1.1 prose ("the fade lands on the beat's end") and its literal formula
(`max(start + speech, start + dur - span)`) describe different schedules under those
semantics, and the literal one makes its own `max` dead code and starts a fade before the
narration ends whenever `span <= hold < 2*span` — which fails `page.test.ts`'s
"nothing dies mid-sentence" assertion. The prose was implemented:
`max(anchor.start + anchor.speech + span, anchor.start + anchor.dur)`. Consequence worth
knowing: on an item anchored to its own scene `fadeAt` now equals `sceneEnd`, so a wiping
board's fade timing is identical to an accumulating one's. The field is still written,
because `sampleTimes` needs it to know a wiping beat's fullest moment is before the fade.

## `blank-run`, and what it costs

Advisory, tier 2, in `qc.json` on every cast from here. It samples **evenly along the
clock** — the exact opposite of `sampleTimes`, which looks where each beat is fullest and
is therefore structurally incapable of finding blank paper. `c5caa09eb153` passed
`ink-floor` on every one of its samples while half the film was empty. One frame a second,
capped at 150, skipping the first second and the outro; a run is consecutive samples under
0.5% ink and the ceiling is 2.0s. It costs about **2s** of extra gate time on a 24s film
and about 9s on a 69s one, which is a second Chromium page on the browser the gate has
already launched.

## The Anthropic key ran out of credit mid-phase

`400 invalid_request_error: Your credit balance is too low to access the Anthropic API`.
The first attempt at this phase's verification cast — `projects/gclose1-daynight`, a fresh
`teach` on the competitor's prompt — therefore ran on a **heuristically derived** lesson
(4 beats, no misconception, 23.9s) and is worthless as a measurement. It is kept only as
the end-to-end smoke test that `blank-run` runs on a real cast, and must not be read as a
film. `docs/PLAN-GOLPO-CLOSE.md` budgets 5–7 keyed casts; none of them can be run until
the account is funded.

What that does **not** block: this phase's verification, which was done the better way
anyway — `--lesson projects/c5caa09eb153/lesson.json` re-casts the repro's _exact_ lesson
with no model call, so the before/after difference is the code change and nothing else.
The lesson author, the Tier-2 vision pass and `ocr-diff` are the only keyed lanes;
ElevenLabs and fal both still work. Phases 2 and 3 can be measured the same way. Phase 4.2
(the lesson routes a style pack) and Phase 6.4 (the head-to-head) genuinely need the key.

## One audit check was stale, and is now honest

`auditcheck` was **110/111**, not the 111/111 the plan expects, and has been since
2026-08-25. `S4-e` greps `render/src/compile.ts` for the literal `fillMean < 0.18`; that
number became `MIN_MEAN_FILL` in `21538fe`, alongside `MIN_SCENE_FILL`. The gate never
moved. Split into two greps — the constant is still 0.18, and the comparison still reads
it — rather than relaxed, because either half alone is weaker than what was there before.

# 2026-08-27 (Phase 2) — the board tour is the default again, and it is denser

`docs/PLAN-GOLPO-CLOSE.md` Phase 2. `explainer` goes back to `board: 'accumulate'`, the
contract clause is re-amended, and the phase's central claim — that accumulation is
_denser_ than wiping, not sparser — is measured and holds. Two blockers the plan did not
anticipate turned up on the way, both real, both fixed with the owner's decision.

## The A/B, same lesson, same day, same instrument

`--lesson projects/c5caa09eb153/lesson.json --preset explainer` into fresh ids, so the
lesson is held exactly constant and the only variable is the board mode.

|                            | wipe (`gclose1-repro`) | accumulate (`gclose3-accum`) | bar        |
| -------------------------- | ---------------------- | ---------------------------- | ---------- |
| distinct cameras           | **1**                  | **10**                       | ≥ 3        |
| regions                    | **1**                  | **5**                        | ≥ 2        |
| canvas                     | 1280×895               | **6572×2908**                | > frame    |
| blank runs                 | 0                      | **0**                        | none       |
| frames under 0.5% ink      | 3 of 69                | **0 of 66**                  | —          |
| mean frame ink             | 3.72%                  | **4.43%**                    | ≥ the wipe |
| median frame ink           | 2.70%                  | **4.10%**                    | —          |
| `ink-floor` (beat-fullest) | 4.60%                  | 4.39%                        | —          |
| film                       | 68.6s                  | **66.1s**                    | 60–90s     |
| strict QC                  | 25/25 ok               | **25/25 ok**                 | passes     |

Contact sheets: `renders/golpo-close-gclose1-repro/contact-sheet.png` and
`renders/golpo-close-gclose3-accum/contact-sheet.png`. The wipe sheet is eight single
cards; the accumulate sheet is a board with three or four cards in frame at once and the
camera moved between them. **Every acceptance criterion in plan 2.5 passes.**

Against the competitor's 5.7% mean on this same topic we are at 4.43% — 78% of the way,
from 32% where Phase 1 started. Phase 3 (fat ink) is the remaining lever.

## What `fillcheck` says, recorded and not chased (plan 2.4)

Under accumulate the bounding-box metric _falls_ on all five lessons measured:

| lesson           | wipe mean | acc mean | wipe min | acc min | cameras w/a | regions w/a |
| ---------------- | --------- | -------- | -------- | ------- | ----------- | ----------- |
| gradient-descent | 61.3%     | 51.1%    | 42%      | 31%     | 1 / 7       | 1 / 4       |
| hash-map         | 36.4%     | 23.8%    | 26%      | 12%     | 1 / 9       | 1 / 5       |
| longitude        | 36.0%     | 20.6%    | 29%      | 14%     | 1 / 8       | 1 / 4       |
| f3ac9c760194     | 28.0%     | 25.5%    | 14%      | 9%      | 1 / 8       | 1 / 3       |
| c5caa09eb153     | 34.4%     | 28.0%    | 21%      | 15%     | 1 / 9       | 1 / 5       |

That is the artifact, in one table: the metric that _falls_ is the one measuring boxes,
and the metric that _rises_ is the one measuring pixels. Gate 1's 35% bar stays suspended
per plan 2.4; re-deriving it waits for Phase 3, because fat ink moves it and deriving it
twice is waste.

`sbjson.mts` grew the `[board]` argument it never had. Handed `--board` it ignored it
silently, so the first pass of the table above came back with both halves identical —
which read as a finding rather than as a tool with no such flag.

## Blocker A — flipping the board re-armed the scissors

`adaptLesson`'s `countBinds` was `preset.board !== 'wipe'`. `e60b9bf`, landed one day
earlier, disarmed the beat count as scissors **only under wipe**; the flip re-armed it,
and the 10-beat day/night lesson lost its misconception — the exact case that commit's own
comment names. Strict QC blocked on `misconception-cut`.

Measured before deciding, because the comment's reason for binding under accumulate is a
claim about geometry and geometry is measurable:

| c5caa09eb153, accumulate | scenes | canvas    | sparsest scene | zoom range | misconception |
| ------------------------ | ------ | --------- | -------------- | ---------- | ------------- |
| `maxBeats` 9             | 9      | 6572×2908 | 15%            | 1.04–5.64  | **cut**       |
| `maxBeats` 10            | 10     | 6572×2908 | 15%            | 1.04–5.64  | kept          |

Identical canvas, identical zoom range, identical floor. "An extra beat shrinks every cell
and lengthens the tour" is not true here — the board already had the room. The extra beat
cost **1.3 points of `fillcheck`'s mean**, which is the metric this very phase reverses a
decision made with. The cut cost the misconception.

So `countBinds` is now a preset field, defaulting to the board-mode rule, and `explainer`
sets it `false`. `standard`, `short` and `square` set nothing and take the branch they
always took, which is what keeps the four pinned storyboard hashes still — asserted in
`trim-priority.test.ts` rather than argued. Of the five lessons measured, only this one
authors ten beats; the other four are unaffected either way.

## Blocker B — the strict gate could be got through by re-running

**`misconception-cut` reported `pass` on any resumed project, on a film that had the cut.**
It read `stageProblems`, an in-memory array the storyboard stage pushes to while it runs;
on a resumed run the stage is served from cache, `adaptLesson` is never called, nothing is
pushed, and the check finds nothing to report. Reproduced on `projects/gclose2-accum` with
the identical command twice:

```
$ … --project gclose2-accum          # StageError: 1 quality problem (misconception-cut)
$ … --project gclose2-accum          # ok: true, misconception-cut: pass
```

Nothing about the film changed. The cache warmed. This was **not** a `--degrade` problem —
`--degrade` was a red herring; the second run above is strict.

Fixed the way the neighbouring `drawing` check already was, and its comment says why:
_read it back off the artefacts rather than remember what the lane said while it ran._
`misconceptionCutInBoard(lesson, scenes, preset)` asks the two files — the lesson declares
a misconception, and no scene carries `role: 'misconception'`. It returns nothing when the
board claims no roles at all (a hand-authored board, where `role` is optional), because a
check that cannot see must not report that it looked. The channel's line still wins when
there is one: it is the trimmer's own account, taken when the decision was made.

**Worth carrying forward:** any blocking check whose evidence is a side effect of a stage
goes quiet exactly when that stage is cached. `drawing` was fixed for it, this one was not,
and nothing tests the class. `duration`, `lane-coverage` and `stages` all read the same
channel — unaudited as of this writing.

## Where the two evidence films stand

- **`projects/gclose3-accum`** — the Phase 2 measurement film. Accumulate, strict-clean,
  10 beats, misconception intact.
- **`projects/gclose1-repro`** — the Phase 1 measurement film and the wipe half of the
  pair above. Do not re-cast either.
- **`projects/gclose2-accum`** — the blocked intermediate that produced Blocker B's repro.
  Its `qc.json` is the laundered one and is kept as the evidence; it is a 9-beat film with
  no misconception and must not be read as a measurement.

Tests 1248 → 1249. `pnpm typecheck`, `pnpm lint`, auditcheck 111/111 all clean.

# 2026-08-27 (Phase 3, partial) — the fill path was dead, and reviving it buys 0.03 points

`docs/PLAN-GOLPO-CLOSE.md` Phase 3 is **partly blocked and partly answered**. 3.1 cannot
be attempted at all; 3.2 and 3.3 were both investigated to their stated bounds and both
came back with a measured negative. Recorded here so nobody re-derives them.

## 3.1 is blocked, and it is the phase's real lever

Editing `DRAW_BRIEF` changes `BRIEF_VERSION`'s hash input, so every drawing decaches and
`drawsheet.mts` has to re-author them — which needs the Anthropic key, and the key is out
of credit (section above). The brief edit is written and unlanded. Nothing else in Phase 3
substitutes for it: 3.2 below measures precisely how little the alternatives buy.

## 3.2 — `fill` was never set on a shape, ever

`makeShape` defaults `fill: false` and `buildMark` never passed anything else, so **every
`rect`/`ellipse` the drawing lane has ever produced is an empty outline**, and
`hachurePolygon` — which `render/src/sketch.ts:719` documents as "used for `fill: true`
shapes" — has been dead code for that lane since it was written.

The plan made the wiring conditional on the body-vs-frame ambiguity being reducible. It is:
the call site holds the whole mark list, and "is anything drawn inside this" answers it —
measured by whether another mark's _centre_ falls in the shape's box. A container gets its
label's centre and stays an outline; a circle the author already shaded with `hatch` gets
that hatch's centre and is left alone so the two fills cannot fight; an arrow pointing at a
body keeps its centre outside and does not suppress it. Figure beats are excluded outright,
because `FIGURE_BRIEF`'s NEVER SHADE rule is a measured defect fix and a filled shape is
shading by another name.

**So it is wired. It buys 0.03 percentage points.** Measured in isolation — the same board
compiled both ways, rendered by `frames.mts`, eight frames each, so the fill is the only
variable:

|                   | frames | mean ink  |
| ----------------- | ------ | --------- |
| fill on           | 8      | **3.77%** |
| fill off (before) | 8      | 3.74%     |

Per-frame the two never differ by more than 0.1 points. Seven of fourteen shapes on the
day/night board fill, and the reason the number does not move is visible in the frames:
they are a stick figure's head, three small suns, a travelling dot and two small circles.
**The large regions on these boards are `stroke` and `path` marks and `hatch`, none of
which `fill` touches.** The pack is not the constraint either — `marker`'s `rough.fill` is
already hachure at weight 2.4, gap 9.

Kept rather than reverted, because the plan's fallback was conditioned on the ambiguity
being irreducible and it was not, and because a sun drawn as a ring is wrong whatever the
pixel count says. But nobody should expect density from it. **`hatch` — that is, 3.1 — is
the fill path**, and this is the measurement that says so rather than the assumption.

## 3.3 — tone has two assignment sites, and neither can be widened from here

Measured on the Phase-2 film (`projects/gclose3-accum`): `ink` 121 elements, `accent` 28,
`muted` 3, **`contrast` zero**. Three tones film-wide but only **3 of 10 scenes** carry
three, against the plan's bar of half.

The planner assigns `tone` in exactly two places:

- `compile.ts:866` — `titleRule` paints the underline under each card title `accent`. One
  per scene, which is where nearly all 28 come from.
- `drawing.ts:859` — passes through whatever the _drawing author_ chose.

So tone is starved at the model, not at a rule that could be widened. And it is starved
**deliberately**: `DRAW_BRIEF` states "if the drawing reads correctly in one ink, use one
ink" and names "a box drawn in `accent` because it looked plain" as the failure it guards.
That is the same brief 3.1 needs and the same key.

The plan's own mapping — titles/headings → `accent` — was checked and **not** applied, for
two measured reasons:

- `palette.ts:31` states the design position in the file: "Exactly one accent for the whole
  film… the accent only ever marks things up." Painting every heading `accent` would make
  it the most common ink on the board, which is that position reversed, not widened.
- The shipped light accent `#2f6fed` is **4.40:1 on paper**, under the 4.5:1 the repo picked
  as its own readability bar. Nothing currently checks it: `MIN_INK_CONTRAST` in
  `stylepack.ts` guards `ink` against `paper` and **nothing else in the palette**. Worth
  knowing before Phase 4.1 writes a new pack — its `inkSoft` and `accent` will be unchecked
  too, so they have to be computed by hand.

## Provider state moved again

**ElevenLabs' free-tier quota is now exhausted as well.** The cast at 15:45 hit
`quota_exceeded` and re-narrated the whole film with Kokoro, which is the adapter behaving
correctly. It also makes runtimes non-comparable across that boundary: the same lesson
measured 43.9s of speech on ElevenLabs and **59.6s** on Kokoro, so `gclose4-fatink` is 81.2s
against `gclose3-accum`'s 66.1s with holds unchanged at 21.2s and 20.6s. Compare films cast
on the same engine, or compare per-frame ink rather than runtime.

# 2026-08-27 (Phase 5) — figures stop being stickers on light boards

`docs/PLAN-GOLPO-CLOSE.md` Phase 5, landed and looked at. Every board now keys its
generated figures to real alpha; `multiply` survives only as the fallback for when keying
abstains.

**The defect, before:** `renders/acceptance-f3ac9c760194/contact-sheet.png`, the drop-test
and feather panels — each picture sits in a visible grey-white rectangle on warm paper.
Plan 9.2 held light boards on `multiply` deliberately, on the argument that these rasters
are drawn on white and multiplying by white is the identity. The argument is right and its
premise is not: the generators return warm greys, so the identity never applied and the
card back was there the whole time.

**After:** `renders/golpo-close-gclose6-keyed/contact-sheet.png`, same lesson, fresh id.
No rectangle behind either figure — the stick figure and the falling feather sit on the
paper. Both figure elements now carry `mix-blend-mode:normal` against
`projects/f3ac9c760194`'s `mix-blend-mode:multiply`; strict QC 25/25, `blank-run` clean,
0 blank frames.

Three things worth having written down:

- **Dark boards are provably untouched.** The branch was
  `surface && isDark(paper) ? surface : undefined` and is now `surface`; for a dark surface
  those are the same value, so the `qc92-chalk` path is byte-identical and needed no cast
  to confirm.
- **`keyFigureToSurface` needed no light-surface path**, which was the open question in the
  plan. An achromatic pixel comes out as `surface.ink` at `density` alpha; on light paper
  that ink is near-black, so a mid-grey keys to near-black at ~50% alpha over near-white,
  which is the mid-grey it started as. Chromatic pixels differ by being drawn at their own
  hue rather than that hue multiplied into the paper.
- **No cache bump was needed and none was made.** The keyed copy is derived from the cached
  raster at composite time and written beside it, named for the surface it was keyed
  against, so no provider call is involved and the raster tiers stay style-blind. A fresh
  project id is enough to pick it up. `isDarkSurface` stays load-bearing in `image.ts` — it
  now chooses what the _fallback_ costs, and the problem note says which of the two it is.

# 2026-08-27 (Phase 4) — the blueprint pack is written and parked on one asset decision

`docs/PLAN-GOLPO-CLOSE.md` 4.1 was authored, validated against the pack schema, and then
**not landed**, because it collides with a pinned invariant the plan did not know about.
Everything below is finished work; what is missing is one file nobody may fetch unasked.

## The blocker: five packs, four faces

`packages/core/test/fontmetrics.test.ts:30`, "every ink style asks for its own handwriting
face", asserts over **every pack in `styles/`** that no two letter in the same family —
"a fifth style that letters in the marker's face is a fifth style nobody can tell from the
marker". It is written to hold for a pack it has never heard of, which is exactly this one.

The plan's DECIDED font choice is to reuse a vendored hand face, `Gaegu` unless another
fits better. There is no other: `assets/fonts/hand/` holds exactly four — Gaegu,
PatrickHand, Caveat, ShantellSans — and the four shipped packs claim one each. So the
decision as written fails that test on the first run, which is what it did.

The obvious substitute does not work either. JetBrains Mono **is** vendored and a technical
mono is what this board wants, but it lives in `assets/fonts/code/`, and `codeFontDirs()`
is documented as "where the code lane's monospace face lives, **and nothing else**" —
`defaultFontDirs()` deliberately does not reach it. Crossing that boundary to dress a
hand-drawn board in a machine face is two mistakes, not one.

**What it actually needs is a fifth vendored OFL hand face.** That is cheaper than the plan
assumed — `findFontFile` already recognises `kalam`, `indie`, `architects`, `handlee` and
`gloria` as known stems, and `handMetricsFor` parses whatever TTF it finds, so no
`fontmetrics.ts` work is involved. It is a file: download the TTF and its `OFL-*.txt` from
`google/fonts`, commit both, add the row to `assets/fonts/README.md`. Not done here because
committing a licensed binary to someone's repo, against the plan's own stated scope, is
theirs to say yes to.

## Everything else about the pack is finished and measured

The palette clears the contrast bar on all four inks — computed, not eyeballed, and note
that **only `ink` is actually checked** by anything: `MIN_INK_CONTRAST` in `stylepack.ts`
guards `ink` against `paper` and nothing else in the palette, so these three were hand-run.
`inkSoft`, which the plan flagged as the tight one, has 2 points of headroom.

| against `paper` `#14304a` | ratio | bar   |
| ------------------------- | ----- | ----- |
| `ink` `#eef4f8`           | 12.20 | 4.5:1 |
| `inkSoft` `#9db8cc`       | 6.55  | 4.5:1 |
| `accent` `#53c8e8`        | 6.96  | 4.5:1 |
| `contrast` `#ff8a3d`      | 5.77  | 4.5:1 |

Paper luminance is 0.028, far under the 0.5 that routes a figure to `keyFigureToSurface` —
though as of Phase 5 every board takes that path anyway, so the dark-board figure lane
engages here without needing the switch.

The pack itself, schema-valid at 380 of 400 description characters, ready to drop into
`styles/blueprint.json` the moment a face is chosen (replace `hand` with the new family):

```json
{
  "id": "blueprint",
  "name": "Blueprint",
  "description": "Drafting-table navy: white ink on deep blue, cyan for the thing being explained and warm orange for the thing it must not be confused with. The cleanest line of the five — a blueprint is drawn against a straight edge. The hand is Gaegu, borrowed from chalk and a placeholder: this board wants a technical mono, and vendoring one means new metrics. See docs/PLAN-GOLPO-CLOSE.md §5.",
  "hand": {
    "fontFamily": "Gaegu",
    "fontFiles": ["gaegu"],
    "tracking": 0.018,
    "textOpacity": 0.94
  },
  "pen": {
    "width": 4.0,
    "weight": 1.15,
    "inkSpeed": 2000,
    "art": {
      "unit": 84,
      "baseAngle": 154,
      "follow": 0.35,
      "parts": [
        {
          "d": "M -10 0 L 10 -2 L 11 -78 Q 11 -82 7 -82 L -7 -82 Q -11 -82 -11 -78 Z",
          "fill": "#f7f5f0",
          "stroke": "#c9c6bf",
          "strokeWidth": 2
        },
        { "d": "M -5 -8 L -1 -8 L -1 -76 L -5 -76 Z", "fill": "rgba(255,255,255,0.75)" }
      ]
    }
  },
  "rough": {
    "roughness": 1.15,
    "bowing": 1.1,
    "multiStroke": true,
    "curveFitting": 0.96,
    "maxRandomnessOffset": 2.2,
    "strokeOpacity": 0.94,
    "lineCap": "round",
    "lineJoin": "round",
    "fill": { "style": "hachure", "weight": 2.0, "hachureAngle": -30, "hachureGap": 10 }
  },
  "sketch": { "roughness": 1.1, "bowing": 1.0, "passes": 2, "cap": "round", "opacity": 0.92 },
  "palette": {
    "paper": "#14304a",
    "ink": "#eef4f8",
    "inkSoft": "#9db8cc",
    "grid": "rgba(255,255,255,0.06)",
    "accent": "#53c8e8",
    "contrast": "#ff8a3d",
    "highlight": "rgba(83,200,232,0.18)"
  }
}
```

## 4.2 and 4.3 are untouched

4.2 (the lesson stage emits a `style` field and routes topics to packs) needs a keyed cast
to verify the router picked `blueprint` without a flag, and the key is dry. It also needs
4.1 landed to have anything to route to. 4.3 was already out of scope and stays there:
painterly/parchment packs, textured grounds, new pen sprites.

One thing 4.2 will need that is worth knowing now: `apps/web/components/studio/options.ts`
says `INK_STYLES` is only the offline fallback, so a new pack has to appear in whatever
serves `/api/providers`' `caps.styles` or the studio will not offer it. Not chased here.

# 2026-08-27 — where PLAN-GOLPO-CLOSE stands

| phase                              | state                      |
| ---------------------------------- | -------------------------- |
| 1 — stop the blank paper           | **done, measured**         |
| 2 — accumulate by default          | **done, measured**         |
| 3.1 — fat-ink brief rule           | blocked: Anthropic key     |
| 3.2 — shapes that can fill, fill   | **done**; buys 0.03 points |
| 3.3 — tone distribution            | measured; lever is 3.1     |
| 4.1 — the blueprint pack           | written, parked on a font  |
| 4.2 — the lesson picks a pack      | blocked: key, and on 4.1   |
| 5 — figures keyed on every board   | **done, measured**         |
| 6 — re-derive the gates, close out | blocked: needs 3.1 and 4.2 |

Phase 6's head-to-head is the one that answers "are we there yet", and it cannot run: it
wants the competitor's own topic cast with everything on — accumulate (have it), blueprint
routed by the lesson (blocked twice), keyed figures (have them) — and measured against
their 5.7% mean. What can be said today is that the same topic went **1.81% → 4.43%** mean
frame ink across Phases 1 and 2, with blank paper at 52% → 0%.
