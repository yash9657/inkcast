# Vendored fonts

All files here are **OFL 1.1** — free for commercial use and redistributable.
The licence for each family sits next to it as `OFL-<family>.txt`; keep those
files with the fonts and the obligation is met (there is no attribution
requirement beyond that).

They are committed to the repo rather than downloaded on demand because
`docs/CONTRACT.md` requires the project to work with **zero network**. A build
that phones fonts.gstatic.com is a build that fails on a plane.

Three roles, three directories: `ui/` is the studio's chrome, `hand/` is the handwriting
inside the video, and `code/` is the monospace the code lane sets listings in.

## `ui/` — chrome (the web app)

Latin-subset variable `woff2`, byte-identical to what Google Fonts serves.
Loaded by `apps/web/lib/fonts.ts` through `next/font/local`.

| File                               | Family                       | Role                                  | Size  |
| ---------------------------------- | ---------------------------- | ------------------------------------- | ----- |
| `Inter-Variable.woff2`             | Inter, wght 100–900          | all UI text (`font-sans`)             | 47 KB |
| `JetBrainsMono-Variable.woff2`     | JetBrains Mono, wght 100–800 | figures, timecodes, IDs (`font-mono`) | 39 KB |
| `SpaceGrotesk-Variable.woff2`      | Space Grotesk, wght 300–700  | headings and display (`font-display`) | 22 KB |
| `hand/ShantellSans-Variable.woff2` | Shantell Sans, wght 300–800  | ink accents in chrome (`font-hand`)   | 79 KB |

### Re-vendoring the three UI faces

They were pulled out of `@fontsource-variable`, which is why those three
packages sit in `apps/web` devDependencies without anything importing them.
Nothing in the build reads `node_modules` for a font — the committed `woff2`
files are the only source — but the packages mean re-vendoring is a `cp` rather
than a hunt:

```sh
pnpm add -D @fontsource-variable/inter @fontsource-variable/jetbrains-mono \
            @fontsource-variable/space-grotesk --filter @inkcast/web
cd apps/web/node_modules/@fontsource-variable
cp inter/files/inter-latin-wght-normal.woff2                   ../../../../assets/fonts/ui/Inter-Variable.woff2
cp jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2 ../../../../assets/fonts/ui/JetBrainsMono-Variable.woff2
cp space-grotesk/files/space-grotesk-latin-wght-normal.woff2   ../../../../assets/fonts/ui/SpaceGrotesk-Variable.woff2
```

Take the `-wght-` cut, not the `-standard-` or `-opsz-` one: `standard` is a
static instance and `opsz` carries an optical-size axis this design never
varies. Each package's `LICENSE` is the OFL text and becomes `OFL-<family>.txt`.

### Retired 2026-08-21 (plan item C2)

Geist, Geist Mono and Instrument Serif were deleted, not deprecated. Geist and
Geist Mono lost to Inter and JetBrains Mono on x-height at 14px and on
glyph disambiguation (`0`/`O`, `1`/`l`) in ID-heavy mono text. Instrument Serif
lost for a structural reason rather than a taste one: it was usable only at
48px and up, which forced every heading between 20px and 38px into the body
face and left the system without a real heading voice. `git show
13c7fe8:assets/fonts/ui/` has the files if any of that turns out to be wrong.

## `hand/` — content (inside the rendered video)

Full `.ttf` files, not subsetted, because the renderer draws arbitrary text and
needs every glyph plus the custom variation axes. These are for
`@inkcast/visuals` / `@inkcast/render` to load into the Playwright page or embed
in generated SVG — **not** for `next/font`.

`Storyboard.meta.style` maps to a file one-to-one. This mapping comes from
`docs/research/design-stack.md` §3 and is not a matter of taste:

| `meta.style`       | File                        | Why                                                                                                                                                          |
| ------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `marker` (default) | `ShantellSans-Variable.ttf` | Drawn by an actual whiteboard artist. Variable axes `wght`, `BNCE` (bounce), `INFM` (ink flow), `SPAC` — vary `BNCE` per element for organic marker strokes. |
| `pencil`           | `Caveat-Variable.ttf`       | Thin cursive script; reads as pencil, not marker. Axis: `wght`.                                                                                              |
| `chalk`            | `Gaegu-Regular.ttf`         | Soft, rounded, slightly irregular. Static.                                                                                                                   |
| `ink`              | `PatrickHand-Regular.ttf`   | Uniform stroke width, felt-tip clean. Static.                                                                                                                |

The `.woff2` copy of Shantell Sans exists only so the web app can show an ink
accent without shipping the 1.2 MB `.ttf` to a browser. Do not use the `.woff2`
for rendering — it is latin-subset and has no `BNCE` axis.

## `code/` — the code lane (inside the rendered video)

| File                         | Family                       | Role                                 | Size   |
| ---------------------------- | ---------------------------- | ------------------------------------ | ------ |
| `JetBrainsMono-Variable.ttf` | JetBrains Mono, wght 100–800 | every `code` element, in every style | 183 KB |

**One face, not one per `meta.style`**, which is the opposite of `hand/` and deliberate.
Handwriting is the board's voice, so it changes with the style; a listing is a _quotation
of a file_, and setting one in Shantell Sans is a misquotation — proportional advances
destroy the indentation that carries the program's structure. So a chalk film's code is the
same monospace as a marker film's, and the style shows up in the ink colour and the pen
weight around it (`core/src/fontmetrics.ts`, `MONO_FONT`).

JetBrains Mono because the decision was already made and argued one section down: it beat
Geist Mono on `0`/`O` and `1`/`l` disambiguation, which is exactly the property a listing
needs. This is a second copy of that choice, not a new one.

**`.ttf`, and it has to be.** `ui/` ships the latin-subset `woff2` for a browser; this file
is read in Node, and the code lane needs its `glyf` outlines, not just its metrics — the
lane draws each character as an exact filled outline rather than as text, for the reason
`visuals/src/code.ts` gives (a glyph the browser substituted is a different glyph, and in
source code a different glyph is a different program). The sfnt reader in
`core/src/fontmetrics.ts` cannot read `woff2`, and would not be asked to.

Re-vendor with:

```sh
curl -L -o assets/fonts/code/JetBrainsMono-Variable.ttf \
  'https://raw.githubusercontent.com/google/fonts/main/ofl/jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf'
curl -L -o assets/fonts/code/OFL-jetbrainsmono.txt \
  'https://raw.githubusercontent.com/google/fonts/main/ofl/jetbrainsmono/OFL.txt'
```

`codeFontDirs()` searches this directory and nothing else, and `defaultFontDirs()`
deliberately does not include it — `findFontFile`'s last resort is "any font at all", so a
shared search path would mean a tree with its handwriting faces missing letters the whole
board in JetBrains Mono with no warning. Two roles, two search paths.

Only the default instance is used. A variable font's `glyf` holds its default named
instance (Regular here, which is the weight a listing wants) and the axes live in `gvar` as
deltas that nothing reads.

## Adding a font

Don't, unless a new `meta.style` value lands in the Storyboard IR. If it does:
pull the `.ttf` from `github.com/google/fonts/ofl/<family>/`, pull its `OFL.txt`
alongside, add a row to the table above, and confirm the first four bytes are
`00 01 00 00` (or `OTTO`) — the interactive `fonts.google.com/download` flow
returns an HTML page when fetched non-interactively, and an HTML file with a
`.ttf` extension fails in a way that looks like a renderer bug.
