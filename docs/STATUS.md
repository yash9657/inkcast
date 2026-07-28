# Inkcast status

Written by the verification agent on 2026-07-28. Every claim below is backed by a
command that was actually run on this machine, with its output quoted. Where
something is broken or unfinished it says so.

**Machine:** Apple M3, 8 cores, 16 GB RAM, macOS 15.6, Node v22.17.0,
ffmpeg 8.1.2, Playwright Chromium. **No API keys were set for any of this** —
`ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `REPLICATE_API_TOKEN` and `FAL_KEY`
were all unset, which `inkcast providers` confirms and every run reports as
`cost $0.00`.

---

## 1. What verifiably works

### The documented smoke test produces a watchable video

```
$ pnpm cast examples/gradient-descent.md          # cold: projects/ deleted first

✔ Gradient descent · 2:44 · 326.0s
  video      projects/5b5566b87593/out.mp4 (1920×1080, 30fps, 6.6 MB)
  storyboard projects/5b5566b87593/storyboard.json (24 scenes, 9 assets)
  stages     ingest 0.1s · plan 0.1s · voice 209.3s · visuals 0.2s · render 116.2s
  providers  plan heuristic · voice kokoro · art builtin
  cost       $0.00 — nothing left this machine

pnpm cast examples/gradient-descent.md  5:27.97 total     # exit 0
```

Run three times from a deleted `projects/` directory; exit 0 every time.

### The artefact is a real, correct mp4

```
$ ffprobe -v error -show_format -show_streams projects/5b5566b87593/out.mp4
duration 163.700000   size 6944029   bit_rate 339576
video  h264 High  1920x1080  yuv420p  nb_frames=4911  fps=30/1
audio  aac LC     24000 Hz   mono     nb_frames=3838

storyboard totalDuration = 163.675 s        → mp4 is 163.700 s, Δ 25 ms
$ ffmpeg -i out.mp4 -af volumedetect -f null -
mean_volume: -23.3 dB   max_volume: -1.4 dB   → real narration, not silence
```

Video stream at the expected dimensions, audio stream present, duration matches
the storyboard to 25 ms, 6.9 MB for 2:44.

### The frames look like a hand-drawn whiteboard explainer

Frames were extracted at 11 s, 45 s, 80 s, 100 s and 162 s and inspected
directly. They show: hand-lettered ShantellSans text on off-white paper with a
faint dot grid, a roughened hand-drawn underline under each heading, roughened
`lucide` icons (a downward-trending arrow, a brain, a database cylinder, a
percent sign) drawn stroke by stroke, boxed diagram nodes, and a marker sprite
that rides the ink as it is laid down. Text is legible, does not overlap, and
stays inside the frame; the camera frames each region with even margins; the
board builds up within a beat rather than popping in.

This was **not** true when verification started. Eight real defects were found
and fixed — see §3.

### The renderer works without the planner

```
$ cp examples/storyboard-handwritten.json projects/handwritten/storyboard.json
$ pnpm cast rerender handwritten

✔ Why caches make code fast · 0:46 · 85.0s     # voice 47.4s · visuals 0.6s · render ~36s
pnpm cast rerender handwritten  1:26.84 total  # exit 0

$ ffprobe projects/handwritten/out.mp4
duration 45.967   size 2110429   h264 1920x1080   aac
storyboard totalDuration = 45.950 s            → Δ 17 ms
```

The final frame of this one is the best evidence that the persistent-canvas
design pays off: a title with a blue hand-drawn rule, a CPU icon, a memory chip,
a labelled cache box, a three-node flow diagram with three edge captions, and a
closing caption — all accumulated on one board, all legible, nothing clipped.

### Caching and resumability

```
$ pnpm cast examples/gradient-descent.md        # immediately after the run above
✔ Gradient descent · 2:44 · 0.0s
  stages  ingest cached · plan cached · voice cached · visuals cached · render cached
pnpm cast examples/gradient-descent.md  1.931s total
```

All five stages hit `cache.json`; 1.9 s instead of 5.5 minutes.

### Typecheck and tests

```
$ pnpm -r typecheck      # 8/8 packages, 0 errors
$ pnpm -r test
packages/planner  31 tests, 31 pass, 0 fail
packages/visuals 104 tests, 104 pass, 0 fail
packages/render   23 tests, 23 pass, 0 fail
packages/voice    22 tests, 22 pass, 0 fail
                 180 total, 180 pass
```

Six of those tests are new regressions written during verification, one per
defect in §3 that could be pinned in a unit test.

### The studio

```
$ pnpm dev
▲ Next.js 16.2.12 (webpack)   ✓ Ready in 655ms
```

Exercised entirely with `curl`, no browser:

| Request                                                     | Result                                                                                                                           |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `GET /`                                                     | 200, 145 KB, contains `pnpm cast examples/gradient-descent.md`                                                                   |
| `GET /studio`                                               | 200, 43 KB                                                                                                                       |
| `GET /library`                                              | 200, 28 KB                                                                                                                       |
| `GET /project/<id>`                                         | 200, 26 KB                                                                                                                       |
| `GET /share/<id>`                                           | 200, 20 KB                                                                                                                       |
| `GET /api/providers`                                        | 200, `"local": true`, every stage local with its reason                                                                          |
| `POST /api/generate`                                        | 202, `{"projectId":"…","streamUrl":"…"}`                                                                                         |
| `GET /api/generate/<id>/stream`                             | 200, 336 SSE events across `ingest → plan → voice → visuals → render`, terminated by `{"done":true,…,"videoUrl":"/api/media/…"}` |
| `GET /api/projects`                                         | 200, all three projects on disk, with status and cost                                                                            |
| `GET /api/projects/<id>`                                    | 200, 3.6 KB                                                                                                                      |
| `HEAD /api/media/<id>/out.mp4`                              | 200, `accept-ranges: bytes`, `content-type: video/mp4`                                                                           |
| `GET` with `Range: bytes=0-2047`                            | **206**, `content-range: bytes 0-2047/601610`                                                                                    |
| `GET /api/media/<id>/nope.mp4`                              | 404                                                                                                                              |
| `POST /api/projects/<id>/edit` `{"instruction":"title: …"}` | 200, patched storyboard returned — **no API key involved**                                                                       |
| `POST /api/projects/<id>/rerender`                          | 202, stream ran to `done`, new title in place                                                                                    |

The whole pipeline ran **in-process** inside the Next server: planner → Kokoro
ONNX → visuals → Playwright → ffmpeg. The dev log contains no errors or
unexpected warnings across 600 lines. Server killed afterwards.

### Cost and wall-clock, per finished minute

Marginal cost is **$0.00** — nothing leaves the machine. Wall clock, measured:

| Film                         | Length | Wall clock  | Per finished minute |
| ---------------------------- | ------ | ----------- | ------------------- |
| gradient-descent (24 scenes) | 2:44   | 3:41 – 5:28 | **81 – 120 s**      |
| handwritten (4 scenes)       | 0:46   | 1:27        | **113 s**           |

So **roughly 1.5–2 minutes of compute per finished minute of video, at zero
marginal cost.** The split is voice 25–77 s/min and render 43–63 s/min; ingest,
plan and visuals together are under a second for a 24-scene film.

The voice figure is the honest weak spot: three cold runs of the _same_ 24
scenes took 68.2 s, 204.8 s and 209.3 s. The 68 s run was the first thing this
session did; the slow ones came after 40 minutes of sustained rendering, so
thermal throttling is the likely cause, but that is a hypothesis and not a
measurement. Kokoro is the whole cost either way.

---

## 2. What is partially working

- **The board does not accumulate across scenes.** The IR's headline idea is one
  persistent canvas the camera tours. The planner gives every scene its own
  1600×900 region and the camera frames exactly one region, so although it _is_
  one canvas and elements _do_ persist, you never see two beats at once. Only
  annotation-only scenes reuse a region. The result reads as a tidy slideshow,
  not as a board being built — which is the specific failure mode the contract
  names as "the single biggest quality failure of competing tools".
- **Sparse frames.** A beat with a heading, one line of body and an icon leaves
  35–40% of the frame empty. The layout centres content in its region and never
  scales up to fill it. A one-node `stack` diagram also draws a box around a
  single sentence, which no person would do.
- **Heuristic copy quality.** Headings and diagram node labels are cut out of
  running prose, so some are mid-clause fragments — `"under you gets gentler"`,
  `"falls. People call this…"`, `"divergence; on a graph it looks like a
curve…"` — and several end in a `…` truncation. Grammatical, spoken narration
  is good; the _on-board_ text is the weak half. A leading-comma bug here was
  fixed (§3.9) but the underlying "cut a sentence at the subject" approach still
  produces fragments.
- **`@inkcast/visuals` is 90% dead weight.** It resolves every element into
  `projects/<id>/assets/el-*.svg` plus an `assets/visuals.json` manifest with
  measured stroke geometry — 74 files for the sample film — and **nothing reads
  any of it.** `grep` for `visuals.json` and `loadVisualManifest` outside that
  package returns nothing; the renderer re-derives all its own geometry in
  `packages/render/src/compile.ts` and consumes only `storyboard.assets[].svg`.
  So there are two independent ink engines, one of which is unused. It is fast
  (0.2–0.6 s) so it costs little time, but it is a duplicate that will drift —
  and it already carries its own copy of the bug fixed in §3.1
  (`roleFontSize(role, canvasHeight)` in `packages/visuals/src/style.ts` scales
  type by canvas height, which is wrong for the same reason).
- **`buildPreviewHtml` is not wired up.** The instant-preview page (the real
  animation with a clock, no Chromium, no ffmpeg) is exported from
  `@inkcast/render` and covered by `page.test.ts`, but neither `inkcast preview`
  nor the studio serves it — both play the finished mp4. Verified:
  `grep buildPreviewHtml apps/` finds nothing, and `inkcast preview <id>` serves
  an mp4 player page (200, plus `storyboard.json` and `audio/narration.wav`).
- **`pnpm lint` fails.** 55 files carry pre-existing Prettier drift. The 8 files
  this agent changed are clean (`prettier --check` on them passes); the rest were
  left alone deliberately so the substantive diff stays readable.

## 3. Defects found and fixed during verification

All eight were real, all eight were silent — nothing crashed, nothing logged a
warning. The first two made the MVP unwatchable.

1. **Type and ink were ~6× too large; the film was illegible.**
   `compilePlan` derived its unit scale from `min(canvas.w/1920, canvas.h/1080)`.
   The planner packs 24 scenes onto a 9440×5940 canvas and then zooms 5.4× into
   each region, so a canvas unit is ≈1 px, not ≈5. A 96 px title was emitted as
   472 canvas units. Frames at 3 s and 8 s showed `ient / desc / ent` — the title
   wrapped to fragments, overflowing the frame, with the next element drawn on
   top of it. Replaced with `unitsPerPixel()`, which inverts
   `baseScale × median(zoom)` — the renderer's own camera maths.
   _(`packages/render/src/compile.ts`; test: "the unit scale follows the camera,
   not the canvas size")_
2. **Every `asset` element drew nothing at all.**
   `@inkcast/visuals` writes the _path_ `assets/brain.svg` into
   `Asset.svg`; `compile.ts` treated that string as markup, so the page's
   `DOMParser` failed and returned an empty `<g>`. Fourteen icons in the sample
   film were invisible, with no warning. `assetMarkup()` now accepts either
   inline markup or a project-relative file, which is what the contract's
   "stages store relative paths" rule implies.
   _(test: "an asset resolves from inline markup or from a project-relative file")_
3. **Four of nine icons were the wrong icon.**
   `resolveAsset` matched on `asset.prompt` (prose for the cloud image adapters)
   instead of `asset.id` (which the planner guarantees is a real lucide slug), so
   the fuzzy/tag tiers answered: `trending-down` → `log-in`, `mountain` →
   `zodiac-capricorn`, `briefcase` → `spell-check`, `sliders-horizontal` →
   `cog`, and in the hand-authored example `cpu` → `map-pin`, `ram` → `cpu`. The
   id is now matched first and trusted when the match is exact.
   _(`packages/visuals/src/resolve.ts`; test: "an asset id that names an icon
   wins over its prose prompt")_
4. **`stack` diagrams were laid out as a horizontal row.**
   An edgeless stack — what the planner emits for every bullet list and for the
   closing recap — ranked all nodes 0, and a single rank on the cross axis became
   a single _row_. Five recap items shared one row of a 406-unit-wide box: 61×38
   unit nodes with 16-unit labels spilling out of them. A stack is now a column
   by construction; an edgeless `flow` is now a row.
   _(`packages/render/src/layout.ts`; test: "a stack is a column, edges or no
   edges")_
5. **The planner's camera framing used the wrong model.**
   It computed the viewport as `canvas / zoom`, assuming the canvas fits the
   frame on both axes. The renderer fits it (`min` of the two ratios), so only
   the binding axis matches. Two 16:9 scenes make a 3920×1380 canvas against a
   1.78 frame: zoom came out 1.33 where 2.12 was right, the viewport was
   2954×1662 for a 1600×900 region, the horizontal clamp pinned _both_ cameras to
   the canvas centre, and the first scene was rendered half off-screen. Now
   derived from `frameSpan()`, which uses core's own `frameSize`.
   _(`packages/planner/src/layout.ts`; test: "the camera frames one region,
   whatever the canvas aspect ratio")_
6. **Prose was squeezed to its heading's width.**
   A child element attached with `below:` was capped at the head's width, so
   `Osmosis` plus a 90-character sentence became a 254-unit column of one-word
   lines. Decorations (rules, brackets) still match their head; text and diagrams
   now get the full span and are re-measured down.
   _(test: "prose attached under a short heading keeps its measure")_
7. **Arrow and diagram-edge labels were struck through by their own ink.**
   A label placed a fixed distance "above the midpoint" is crossed by any sloped
   or strongly bowed shaft; three labels in one frame of the hand-authored film
   were illegible. `labelOffset()` now clears the bow and steps sideways on a
   steep line, and a caption on a short inter-node edge is lifted clear of the
   node row (with there-and-back pairs stacked).
8. **The plan cache never invalidated on a planner change.**
   The key was `'plan@1'` + source hash, with no code version — so fixes 5 and 6
   would have been invisible on every existing project, which reads exactly like
   "the fix did not work". Bumped to `'plan@2'`, with a comment explaining the
   lever, mirroring the renderer's `RENDER_VERSION`.
   _(`packages/pipeline/src/cast.ts`)_
9. Minor: a contrast panel's second line began with the punctuation it was cut
   at — `", and the loss climbs"`. Leading punctuation and dangling conjunctions
   are now stripped. _(`packages/planner/src/beats.ts`)_

## 4. Not implemented / not verified

- **Every cloud adapter is untested.** Anthropic planning, ElevenLabs voice,
  Replicate/fal images. They are wired behind env vars and the zero-key fallback
  path is proven, but with no keys available none of the upgrade paths has ever
  executed. `@neplex/vectorizer` (the opt-in image lane's vectoriser) has an
  unmet `@emnapi/runtime` peer for its wasm fallback.
- **`9:16` and `1:1` output.** The planner has region sizes and a unit test for
  vertical layout, and the renderer has frame sizes, but no vertical or square
  video was rendered end to end.
- **No CI.** Nothing runs `pnpm -r test` automatically. Given how quiet all eight
  defects above were, a check that renders a short film and asserts on the frames
  would have caught most of them.
- **`inkcast edit` with a model.** The zero-key pattern-matched path was
  exercised over HTTP and works; the Claude tool-call path was not.
- **Determinism across machines.** `page.test.ts` asserts two seeks of the same
  frame are byte-identical in one browser; nothing checks that two machines, or
  two Chromium versions, agree.
- Nothing was committed. The working tree carries the verification fixes across
  8 files; a commit made by the repo owner mid-session already contains fixes 1–6
  and 9, so `git diff` shows only 7 and 8 plus their tests.

## 5. What to do next, in order

1. **Make the board accumulate.** Group consecutive beats of the same section
   into one region and frame the camera on the union of what has been drawn so
   far, instead of one scene per region. This is the product thesis and it is the
   one thing the output does not yet deliver; it also fixes the sparse frames,
   because a region with three beats in it is full.
2. **Resolve the two ink engines.** Either the renderer consumes
   `assets/visuals.json` (and `@inkcast/visuals` becomes the single geometry
   authority), or the element lane is deleted and the package keeps only the icon
   and image lanes it actually contributes. Leaving both is how the `roleFontSize`
   copy of defect 1 survives.
3. **Fix on-board copy.** Stop cutting headings and diagram labels mid-clause:
   prefer a whole short sentence, or a noun phrase, over a truncated fragment
   ending in `…`. This is the most visible remaining quality gap to a viewer.
4. **Add CI, and format once.** `pnpm format` (55 files), then a workflow running
   `pnpm -r typecheck && pnpm -r test && pnpm lint` plus a 15-second render whose
   frames are checked for ink coverage and text-inside-frame. Every defect in §3
   was silent; only a pixel-level assertion catches that class.
5. **Prove one cloud adapter and one vertical render.** An `ELEVENLABS_API_KEY`
   run and a `--aspect 9:16` run, so the two biggest untested branches stop being
   theoretical.
