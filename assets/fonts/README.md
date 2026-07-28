# Vendored fonts

All files here are **OFL 1.1** — free for commercial use and redistributable.
The licence for each family sits next to it as `OFL-<family>.txt`; keep those
files with the fonts and the obligation is met (there is no attribution
requirement beyond that).

They are committed to the repo rather than downloaded on demand because
`docs/CONTRACT.md` requires the project to work with **zero network**. A build
that phones fonts.gstatic.com is a build that fails on a plane.

## `ui/` — chrome (the web app)

Latin-subset `woff2`, byte-identical to what Google Fonts serves. Loaded by
`apps/web/lib/fonts.ts` through `next/font/local`.

| File | Family | Role | Size |
| --- | --- | --- | --- |
| `Geist-Variable.woff2` | Geist, wght 100–900 | all UI text (`font-sans`) | 29 KB |
| `GeistMono-Variable.woff2` | Geist Mono, wght 100–900 | figures, timecodes, IDs (`font-mono`) | 23 KB |
| `InstrumentSerif-Regular.woff2` | Instrument Serif 400 | display headlines ≥48px (`font-display`) | 15 KB |
| `InstrumentSerif-Italic.woff2` | Instrument Serif 400 italic | display emphasis | 16 KB |
| `hand/ShantellSans-Variable.woff2` | Shantell Sans, wght 300–800 | ink accents in chrome (`font-hand`) | 79 KB |

## `hand/` — content (inside the rendered video)

Full `.ttf` files, not subsetted, because the renderer draws arbitrary text and
needs every glyph plus the custom variation axes. These are for
`@inkcast/visuals` / `@inkcast/render` to load into the Playwright page or embed
in generated SVG — **not** for `next/font`.

`Storyboard.meta.style` maps to a file one-to-one. This mapping comes from
`docs/research/design-stack.md` §3 and is not a matter of taste:

| `meta.style` | File | Why |
| --- | --- | --- |
| `marker` (default) | `ShantellSans-Variable.ttf` | Drawn by an actual whiteboard artist. Variable axes `wght`, `BNCE` (bounce), `INFM` (ink flow), `SPAC` — vary `BNCE` per element for organic marker strokes. |
| `pencil` | `Caveat-Variable.ttf` | Thin cursive script; reads as pencil, not marker. Axis: `wght`. |
| `chalk` | `Gaegu-Regular.ttf` | Soft, rounded, slightly irregular. Static. |
| `ink` | `PatrickHand-Regular.ttf` | Uniform stroke width, felt-tip clean. Static. |

The `.woff2` copy of Shantell Sans exists only so the web app can show an ink
accent without shipping the 1.2 MB `.ttf` to a browser. Do not use the `.woff2`
for rendering — it is latin-subset and has no `BNCE` axis.

## Adding a font

Don't, unless a new `meta.style` value lands in the Storyboard IR. If it does:
pull the `.ttf` from `github.com/google/fonts/ofl/<family>/`, pull its `OFL.txt`
alongside, add a row to the table above, and confirm the first four bytes are
`00 01 00 00` (or `OTTO`) — the interactive `fonts.google.com/download` flow
returns an HTML page when fetched non-interactively, and an HTML file with a
`.ttf` extension fails in a way that looks like a renderer bug.
