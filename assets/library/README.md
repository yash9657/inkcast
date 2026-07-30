# The asset library

Drawings we chose, reviewed like code. Every other asset lane re-derives its output
per project — a provider call, a lucide match, a lettered card — so none of them get
better over time. This directory is the one that compounds.

`packages/visuals/src/library.ts` is the authority on how these files are read and
carries the full authoring rules. The short version:

- **A version is a filename.** `figures/standing.v1.svg`. Improving an asset means
  adding `standing.v2.svg` and bumping `version` in `library.json` — never editing a
  file that storyboards have already pinned, because the point of
  `AssetRef.version` is that a finished video keeps rendering what it rendered.
- **Document order is draw order.** The reveal follows it, so author a figure the way
  a person draws one.
- **Do not hardcode ink.** No `fill` means stroked in the board's ink;
  `fill="currentColor"` fills with the same ink. A literal colour is honoured
  verbatim, so only write one when you mean it.
- **Flat lists of primitives.** No groups, no transforms — flatten into path data.
- `data-weight="hairline|light|normal|bold"` and `data-group="…"` are the two hints a
  child can carry.

`match` in the manifest lists the nouns that should resolve to an asset when nothing
pinned a path. Keep those lists narrow: an over-reaching alias hijacks an entity that
had a better lane, and a confidently wrong drawing is worse than a generic one.

## Licensing

The code here is AGPL-3.0-only; these drawings are **CC0-1.0**. That split is
deliberate — artwork is what ends up inside a rendered video, and a video's imagery
should not carry the licence obligations of the tool that drew it.

New assets need a `license` and a `provenance` in `library.json`, and anything not
hand-authored here needs provenance specific enough to check.
