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
