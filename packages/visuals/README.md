# @inkcast/visuals

Resolves every element of a Storyboard into hand-drawn SVG the renderer can
reveal stroke by stroke. Works with **zero API keys and zero network**.

```ts
import { resolveVisuals } from '@inkcast/visuals';

const sb = await resolveVisuals(storyboard, 'projects/abc123');
```

## What it writes

| Path                              | Contents                                                                                                                   |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `<dir>/assets/<assetId>.svg`      | One reusable entity per `storyboard.assets[]` entry, in **local** space. The relative path is written back to `asset.svg`. |
| `<dir>/assets/el-<elementId>.svg` | One SVG per element, in **canvas** space (absolute storyboard coordinates).                                                |
| `<dir>/assets/visuals.json`       | The geometry manifest — see below.                                                                                         |
| `<dir>/assets/fonts/<face>.ttf`   | A copy of the handwriting font, so the project is portable.                                                                |
| `<dir>/assets/<assetId>.src.png`  | Only when the opt-in image lane ran: the raster it traced.                                                                 |

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

1. **Geometry** — roughjs via `rough.generator()` with no DOM. Shapes, curved
   arrows with real arrowheads, and the emphasis marks. Every call passes
   `{ seed, randomizer: undefined }`, because roughjs otherwise memoises its RNG
   onto the options object and `Asset.seed` silently stops working.
2. **Icon** — `lucide-static` read off disk and roughened. ~600 keywords with
   fuzzy matching over lucide's own `tags.json`. Offline, free, the default.
3. **Diagram** — dagre for `flow`/`tree`/`graph`; deterministic hand-rolled
   layouts for `sequence`/`stack`/`grid`. Always scaled to fit the element box.
4. **Handwriting** — see above.
5. **Text-to-image** — opt-in, only when `REPLICATE_API_TOKEN` or `FAL_KEY` is
   set: flux-schnell → `@neplex/vectorizer` → roughened strokes, once per asset
   id. Absent a key it logs one info line and uses the icon lane. Set
   `INKCAST_IMAGES=off` (or `{ images: 'off' }`) to disable it even with a key.

## Environment

| Variable                          | Effect                               |
| --------------------------------- | ------------------------------------ |
| `INKCAST_FONT`                    | Explicit handwriting font file.      |
| `INKCAST_FONT_DIR`                | Extra directory to search for fonts. |
| `INKCAST_IMAGES=off`              | Disable the cloud image lane.        |
| `REPLICATE_API_TOKEN` / `FAL_KEY` | Enable the cloud image lane.         |

## Tests

```bash
pnpm --filter @inkcast/visuals test
```

Covers: roughjs producing valid path data with no DOM, seed reproducibility,
icon lookup over ~115 real explainer nouns, diagram layouts keeping nodes inside
the element box, measured line wrapping and reveal masks, and a full
`resolveVisuals` run including cache invalidation.
