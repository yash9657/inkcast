# Brand — the inkcast mark

Everything in here is derived from `geometry.json` by `make-brand-assets.mjs`. Nothing in here
was drawn by hand in an editor, and nothing should be.

```
node assets/brand/make-brand-assets.mjs [--proof <dir>]
```

| File                                     | What it is                                                             |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `geometry.json`                          | The record: the mark as numbers, plus the OKLCH values of its tokens.  |
| `make-brand-assets.mjs`                  | The only path from those numbers to bytes.                             |
| `mark.svg` / `mark-dark.svg`             | The full mark, one theme each, shadow included. For decks and READMEs. |
| `mark-icon.svg`                          | Tile only, no shadow, theme-aware, crisp edges. The favicon source.    |
| `../../apps/web/app/icon.svg`            | A copy of `mark-icon.svg`, where Next's file convention wants it.      |
| `../../apps/web/app/favicon.ico`         | 16 / 32 / 48 px, PNG-compressed entries.                               |
| `../../apps/web/app/apple-icon.png`      | 180 px, opaque paper.                                                  |
| `../../apps/web/app/opengraph-image.png` | 1200×630: dot grid, lockup, the landing page's own headline.           |

`--proof <dir>` writes the legibility renders (16 / 32 / 64 / 512 px, plus the lockup at nav and
share-card sizes). They are not committed. Look at them after any change to a number; the whole
difficulty of this mark is that it has to survive 16 px and 512 px, and that is not a thing you
can reason your way to.

## What the shapes mean

A square ink-bordered tile — the whiteboard — with one confident marker stroke rising across it,
ending in a solid triangular nib. The nib is the chisel tip of the pen that drew the stroke, and
it is a play triangle, because what the product makes is a film of that board being drawn.
"cast" is the stroke.

The tile is **not** filled with the accent. The board is paper, the ink is dark, and the marker is
the only saturated thing in the frame — true of every frame the renderer produces, so true of the
mark. The offset accent block behind the tile is `--elevation-pop` at mark scale (`4px 4px 0` when
the mark is drawn at 32 px), drawn inside the SVG rather than as a `box-shadow` so that one file is
the whole mark.

## Colour

The mark uses four tokens and no others: `--card` (tile fill), `--border` (tile edge, ink on paper
and paper on ink), `--primary` (stroke, nib, shadow block) and — in the lockup only —
`--highlighter` for the hand stroke under the `k`. In the app it reads them as Tailwind utilities,
so it inverts with the theme and contains no `dark:` variant.

The standalone files cannot: a favicon has no token layer. So `geometry.json` records the OKLCH
values from `apps/web/app/globals.css` and the generator converts them to sRGB itself. **If a token
moves in `globals.css`, move it in `geometry.json` and re-run the generator.** Nobody types a hex.

## The wordmark

`inkcast`, lowercase, Space Grotesk 700, −0.03 em, in `--foreground`, with a Shantell-shaped hand
stroke under the `k` in `--highlighter`. Prose still writes "Inkcast" — the lockup is a drawn
object, the noun in a sentence is a word. The lockup itself is not shipped as an SVG on purpose:
it is live text in `apps/web/components/marketing/logo.tsx`, so it uses the same vendored variable
font the rest of the page does and stays selectable. The only rasterised lockup is the one baked
into the OG card.

## The video brand plate (A6) — the same mark, drawn in the film

The plate in the last ~1.2 s of every film must be **this** mark, not a lookalike. Everything it
needs is in `geometry.json`, in a 32-unit box, and the four shapes in paint order are:

```
1. shadow  rect  x=5    y=5   w=26  h=26            fill   accent
2. tile    rect  x=2    y=2   w=24  h=24  stroke=2  fill   paper/card, stroke ink
3. cast    path  M6.2 22.9Q9.6 17.2 19.4 10.7       stroke accent, width 3.3, linecap round
4. nib     path  M24.3 10.5 18.05 15.83 16.35 6.37Z fill   accent
```

Scale by `plateSize / 32`; stroke widths scale with it. In the ratio form
`packages/render/src/sketch.ts`'s `BRAND_MARK` uses — fractions of the 24-unit tile, measured
from the tile's own top-left corner at `(2, 2)` — that is:

```
borderWeight   2    / 24        castWeight   3.3  / 24
from           4.2  / 24, 20.9 / 24   (stroke start, y down)
to (nib tip)   22.3 / 24,  8.5 / 24
nibAim         0.996, -0.084   (4.8° above horizontal, i.e. very nearly due right)
nibLength      7.13 / 24       nibHalfWidth  4.8 / 24   (2.9x castWeight)
bow            the stroke is a quadratic with its control point at 7.6/24, 15.2/24
```

Three notes for a renderer rather than a browser:

- The cast path **ends inside the nib triangle**, 2.2 units past its base edge, which is more than
  the 1.65-unit cap radius. That is deliberate: the round cap is meant to be overpainted so the
  join has no notch. Draw the nib after the stroke, in the same colour, and do not shorten the
  stroke to "meet" the triangle.
- `nibHalfWidth / castWeight` is the number that decides whether the triangle reads as a play
  button or an arrowhead, and `sketch.ts` reached that conclusion independently from a captured
  plate frame. 2.9× is what this mark ships; below ~2.3× it goes arrow.
- The renderer's own palette (`packages/render/src/palette.ts`) has no violet in it — its two
  marker colours are a blue (`#2f6fed`) and a burnt orange (`#c2410c`). A plate drawn in the
  renderer's `accent` will therefore be blue, not cast violet, and will not match the site. Either
  pass the brand violet in explicitly (`#4f46e5`, the sRGB form of `oklch(0.51 0.23 277)`) or add
  it to that palette — see `docs/DESIGN.md` §2 "Where this document used to overclaim" and plan
  item A4.4. Do not silently accept blue; a brand plate that is the wrong colour is worse than no
  plate.
