# Inkcast status

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
