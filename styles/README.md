# Style packs

One JSON file, one ink personality. Drop a file in here and `--style <its id>` works —
no TypeScript, no rebuild, nothing to register. That is the whole contract.

The four files beside this one are the styles Inkcast ships (`marker`, `pencil`, `chalk`,
`ink`). They are ordinary packs: nothing in the code knows their names except
`DEFAULT_STYLE`, which is `marker` because a storyboard that does not name a style has to
get one.

The schema is `StylePack` in `packages/core/src/stylepack.ts`, and it is the authority —
every field is documented there, next to the code that reads it. This file is the map.

## Adding one

```jsonc
{
  "id": "brush", // must equal the filename: brush.json
  "name": "Brush pen",
  "description": "What a viewer would call this look.",

  "hand": {
    // The face the board letters in. `fontFiles` are filename stems looked for in
    // assets/fonts/hand — a face that is not vendored falls back to a system stack,
    // which is a hard failure under the default strict gate.
    "fontFamily": "Caveat",
    "fontFiles": ["caveat"],
    "tracking": 0.01, // extra letter spacing, em
    "textOpacity": 0.95,
  },

  "pen": {
    "width": 8.0, // the visuals stage's base stroke, in canvas units
    "weight": 1.8, // the renderer's multiplier on its 6-output-px base
    "art": {
      // The sprite that rides the stroke tip: tip at the origin, body up the −y axis,
      // in its own units. `fill`/`stroke` take any CSS colour, plus the one token
      // "accent", which resolves to the film's accent colour.
      "unit": 120,
      "baseAngle": 150,
      "follow": 0.4,
      "parts": [
        { "d": "M 0 0 L 6 -26 L -6 -26 Z", "fill": "#1b232e" },
        { "d": "M -10 -26 L 10 -26 L 10 -104 L -10 -104 Z", "fill": "accent" },
      ],
    },
  },

  // The visuals stage's hand (rough.js), which resolves the recorded geometry.
  "rough": { "roughness": 2.6, "bowing": 2.2, "multiStroke": false, "strokeOpacity": 0.98 },

  // The renderer's own sketch engine, which bakes the stroke paths.
  "sketch": { "roughness": 2.4, "bowing": 2.0, "passes": 1, "cap": "round", "opacity": 0.95 },
}
```

Only `id`, `name`, `hand` and `pen` are required; everything else defaults to the
marker's value. `INKCAST_STYLE_DIR` points the loader somewhere else first, which is how
you try a pack out — or override a shipped one — without editing the repo.

**Two roughnesses is not a typo.** Two engines draw this board and they take the same
kind of parameter on different scales; today's four styles set them to numbers that are
not derivable from one another. A pack states both. `stylepack.ts`'s header has the
argument.

## What the loader will refuse

A pack is validated on load and a bad one is an error, not a warning — the alternative is
a film that renders in the wrong hand and never says so.

- **An unknown field.** The schema is strict, so `"roughnes": 2` is an error rather than
  a line that quietly did nothing.
- **A filename that disagrees with the id.** The file is how a reader finds the pack a
  film names.
- **More than one accent.** The palette block, if you write one, takes a single `accent`
  and a single `contrast`, and refuses an accent equal to either the ink or the contrast.
  One ink carries the structure and one accent marks things up; no rainbow boards. This
  is a deliberate departure from `docs/STYLES.md` §2, which models the field as a list.
- **A dark board.** A pack's `paper` has to be light (relative luminance ≥ 0.5). Generated
  figures composite with `mix-blend-mode: multiply`, which can only darken: on a slate
  board a black-ink raster multiplies into the slate and vanishes, and no gate catches it
  because the raster itself is fine. A chalkboard pack needs the real-alpha work the
  audit deferred (S5.6) — the guard is there so that lands before the look does, and its
  message says so.

## What a pack cannot say yet

`docs/STYLES.md` §2 also sketches surface textures (chalk dust, paper grain), a vignette,
and a `generation` block handed to the image provider. None of those has anything reading
it in this tree, so the schema does not accept them: a field that parses and is dropped is
a promise the renderer does not keep. They arrive with the code that draws them.

## After you change one

A pack's contents are part of every cache key that used to carry the style's name
(`styleKey()` = `id@digest`), so editing a file re-resolves the geometry and re-encodes
the film. That is correct — a style pack that did not invalidate the segments would serve
yesterday's ink.
