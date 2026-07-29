# @inkcast/visuals

Resolves every element of a Storyboard into hand-drawn SVG the renderer can
reveal stroke by stroke. Works with **zero API keys and zero network**.

```ts
import { resolveVisuals } from '@inkcast/visuals';

const sb = await resolveVisuals(storyboard, 'projects/abc123');
```

## What it writes

| Path                                               | Contents                                                                                                                   |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `<dir>/assets/<assetId>.svg`                       | One reusable entity per `storyboard.assets[]` entry, in **local** space. The relative path is written back to `asset.svg`. |
| `<dir>/assets/el-<elementId>.svg`                  | One SVG per element, in **canvas** space (absolute storyboard coordinates).                                                |
| `<dir>/assets/visuals.json`                        | The geometry manifest — see below.                                                                                         |
| `<dir>/assets/fonts/<face>.ttf`                    | A copy of the handwriting font, so the project is portable.                                                                |
| `<dir>/assets/illustrations/<id>-<promptHash>.png` | Only when the illustration lane ran: the cached raster it traced, keyed so an id is generated **once ever**.               |

Everything is cached through `@inkcast/core`'s `isFresh`/`markFresh` under
`visuals:asset:<id>` and `visuals:element:<scene>:<id>`. The key covers the id,
the prompt, the seed, the ink style and the font, so switching `meta.style`
redraws everything and editing one scene redraws one scene.

## The geometry manifest (`assets/visuals.json`)

The Storyboard IR is frozen and has nowhere to put per-element geometry, so the
derived data lives in a sidecar next to the SVGs it describes:

```ts
import { loadVisualManifest } from '@inkcast/visuals';

const manifest = await loadVisualManifest(dir);
const el = manifest.elements['scene-1-title'];

el.strokes; // [{ d, length, stroke, strokeWidth, fill, opacity, order, group }]
el.texts; // handwriting blocks: per-line masks + per-word progress windows
el.diagram; // laid-out node/edge boxes, when the element is a diagram
el.plot; // frame, domains, one part per axis/curve/overlay, curve traces, marks
el.path; // the smooth un-roughened `d` a motion can follow
el.motion; // arc-length-even positions plus centre-relative offsets
```

`strokes[].length` is measured, so a draw-on is just
`stroke-dasharray: L L; stroke-dashoffset: L → 0` — no `getTotalLength()` call
and no layout pass. `order` is the element's whole draw sequence and
**interleaves strokes with text blocks**: a diagram draws a box, writes its
label, then draws the next box.

## Writing text, not fading it in

Glyph outlines are never traced. Each line is real `<text>` in the vendored OFL
handwriting face, wrapped with genuine advance widths parsed from the font's
`hmtx`/`cmap` tables, and clipped by a named rectangle:

```
<clipPath id="ink-<el>-t0-clip-0"><rect id="ink-<el>-t0-mask-0" …/></clipPath>
```

To write at the pace of the narration, grow those rects left to right:

```ts
import { revealMaskAt } from '@inkcast/visuals';

for (const rect of revealMaskAt(layout, progress)) {
  // set width on `#ink-<el>-t<i>-mask-<line>`
}
```

`line.words[]` carries `{ text, x, w, startFrac, endFrac }` if you would rather
snap to word boundaries. Every `<text>` also declares `textLength`, so if the
font ever fails to load the fallback is fitted to the same run instead of
overflowing its mask.

If `assets/fonts` is empty the stage logs one info line and falls back to a
calibrated width table — layout still works, it is just not the vendored face.
Fetch the four OFL faces named in `docs/research/design-stack.md` §3 to get the
real thing (`marker` → Shantell Sans, `pencil` → Caveat, `chalk` → Gaegu,
`ink` → Patrick Hand).

## Lanes

1. **Plot** — the highest-leverage element in the package. Hand-drawn cartesian
   frames, curves from points or from nine named functions, and the overlays that
   do the teaching: points, tangents, droplines, shading, annotations and
   stepping sequences. Local, free, deterministic. See below.
2. **Path** — freeform strokes from waypoints (smoothed through a **centripetal**
   Catmull-Rom, never a polyline) or raw SVG `d`, honouring `closed`, `fill` and
   `weight`. The escape hatch for a hillside, a bowl, a container, a gesture.
3. **Geometry** — roughjs via `rough.generator()` with no DOM. Shapes, curved
   arrows with real arrowheads, and the emphasis marks. Every call passes
   `{ seed, randomizer: undefined }`, because roughjs otherwise memoises its RNG
   onto the options object and `Asset.seed` silently stops working.
4. **Icon** — `lucide-static` read off disk and roughened. ~1060 keywords covering
   maths, physics, biology, economics, pedagogy and everyday anchors as well as
   software, with fuzzy matching over lucide's own `tags.json`. Offline, free,
   the default. Assets match on **id first, then prompt** (`matchAsset`).
5. **Diagram** — dagre for `flow`/`tree`/`graph`; deterministic hand-rolled
   layouts for `sequence`/`stack`/`grid`. Always scaled to fit the element box.
6. **Handwriting** — see above.
7. **Illustration** — a real lane, on wherever a key exists: flux-schnell →
   `@neplex/vectorizer` → roughened strokes, generated **once per asset id** and
   cached on disk by id + prompt hash. Adapters are chosen by env in order:
   `REPLICATE_API_TOKEN`, then `FAL_KEY`, then none. Absent a key it logs one
   info line and uses the icon lane; it never fails the pipeline. Set
   `INKCAST_IMAGES=off` (or `{ images: 'off' }`) to disable it even with a key.

**Motion** is not a lane but a layer over all of them: `resolveMotion` resamples a
path to constant arc length so a ball descending a curve moves at one speed
instead of sprinting across the long segments. `motionAt(mp, t)` gives position,
unit tangent and distance; `ease()` implements the IR's five easings against the
CSS control points.

## Plots

`Curve.fn.params` is positional and its meaning is the contract the planner writes
against. `CURVE_FUNCTIONS` exposes the table as data and
`describeCurveFunctions()` renders it for a prompt:

| name         | params                     | formula                               |
| ------------ | -------------------------- | ------------------------------------- |
| `parabola`   | a=1, h=0, k=0              | `a*(x-h)^2 + k` — vertex at (h, k)    |
| `line`       | m=1, c=0                   | `m*x + c`                             |
| `sigmoid`    | k=1, x0=0, L=1             | `L / (1 + exp(-k*(x-x0)))`            |
| `gaussian`   | mu=0, sigma=1, A=1         | `A*exp(-(x-mu)^2 / (2*sigma^2))`      |
| `sine`       | A=1, f=1, phase=0          | `A*sin(2*pi*f*x + phase)`             |
| `exp`        | A=1, k=1, c=0              | `A*exp(k*x) + c`                      |
| `log`        | A=1, x0=0, base=e          | `A*log_base(x-x0)`, undefined at x≤x0 |
| `doubleWell` | a=1, b=1, tilt=0.35, k=0.4 | `a*((x/b)^2-1)^2 + tilt*(x/b) + k`    |
| `step`       | x0=0, lo=0, hi=1           | `x < x0 ? lo : hi`                    |

`doubleWell` exists to show **local versus global** minima, so its default `tilt`
is deliberately non-zero: the wells near `x = ±b` sit at different heights with
the left one lower. `tilt = 0` makes them equal and destroys the point.

Three things are load-bearing:

- Curves are **sampled, clipped, simplified, smoothed, then roughened**, in that
  order. Dense sampling makes a parabola look like a parabola; simplifying before
  roughening is what makes it look hand-drawn rather than fuzzy.
- A tangent's slope is **computed from the curve** — a fourth-order central
  difference for named functions, the analytic derivative of the drawn spline for
  point curves. It is checked against real derivatives in the tests, because a
  tangent at the wrong angle teaches the wrong thing.
- `plot.parts[]` maps contiguous draw-sequence indices to a `kind`, a `group` and
  an **`at` fraction**, so the renderer reveals the frame with the element and
  lands each overlay on the words that introduce it.

Dashes are real geometry, not `stroke-dasharray`: roughjs drops `strokeLineDash`
in `toPaths()`, and the renderer already owns the dash attributes for its
stroke-by-stroke reveal.

## Environment

| Variable                          | Effect                               |
| --------------------------------- | ------------------------------------ |
| `INKCAST_FONT`                    | Explicit handwriting font file.      |
| `INKCAST_FONT_DIR`                | Extra directory to search for fonts. |
| `INKCAST_IMAGES=off`              | Disable the illustration lane.       |
| `REPLICATE_API_TOKEN` / `FAL_KEY` | Enable the illustration lane.        |

## Tests

```bash
pnpm --filter @inkcast/visuals test
```

Covers: tangent slopes checked against analytic derivatives, curves staying
inside their box across every domain and named function, `doubleWell` having two
minima at different heights, paths producing well-formed SVG data, arc-length
resampling being genuinely even, every keyword in the icon table resolving to an
installed icon, the illustration cache generating an id once, roughjs producing
valid path data with no DOM, seed reproducibility, diagram layouts keeping nodes
inside the element box, measured line wrapping and reveal masks, and a full
`resolveVisuals` run over a plot/path/motion storyboard including cache
invalidation.
