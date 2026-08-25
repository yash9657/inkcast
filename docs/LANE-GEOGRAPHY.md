# Lane doc — geography

_Written 2026-08-24 for plan item 6.3, which requires this page before any code. Status:
**not built, no demand.** Ranked second of the three unserved lanes._

## What is missing

A coastline that is the real coastline. `core/src/lanes.ts` calls this `geographically
accurate maps` and fires on a coastline, a border, a named place after "map of". What it
does not fire on is a globe with meridians, or a schematic world — those are drawable and
the films that draw them are fine. The gap is **positions that are facts**.

## What happens instead

The illustration lane draws a country, and a diffusion model's idea of Norway has the
right number of fjords in none of the right places. Unlike chemistry there is no corpus
frame to point at, because no lesson has asked. The failure mode is inferred from the
same mechanism, and it is the weaker case of the two: a viewer who cannot place a fjord
is not misled about a fact they will be examined on, where a viewer reading `B₄H₂` is.

## The dependency choice

Unusually for this repo, the libraries are not the cost — the **data** is.

| package           | licence | unpacked | what it is                                       |
| ----------------- | ------- | -------- | ------------------------------------------------ |
| `topojson-client` | ISC     | 68 KB    | topology → GeoJSON features                      |
| `d3-geo`          | ISC     | 227 KB   | projections, and `geoPath()` → SVG path data     |
| `world-atlas`     | ISC     | 8.2 MB   | Natural Earth countries/land at 1:110m and 1:50m |

`d3-geo` is the plan's own pick and it is the right one for a reason the plan does not
state: `geoPath()` returns **path data**, which is exactly what `roughenPathData` already
consumes. A coastline comes out of the projection as a path and goes onto the board in the
film's own hand with no new renderer capability — the same relationship the plot lane has
to its curves. This is the cheapest of the three lanes to draw and the most expensive to
_ship_.

**The data is the decision.** `world-atlas` is 8.2 MB of Natural Earth (public domain, so
no licence friction) covering countries and land at two resolutions. What it does not
cover is anything sub-national — US states, UK counties, rivers, cities — each of which is
another dataset and another few megabytes. Vendor 1:110m only to start: at a board's
scale, 1:50m is detail nobody can see, and the repo does not want 8 MB it never draws.
Vendoring goes beside the fonts and the figure library, with the same rule — `assets/` is
copied into the image explicitly and the Dockerfile says why.

## How it plugs in

The `code` lane (6.2) is the shape, with one difference that makes this lane simpler: no
glyph work. `d3-geo` gives path data, `roughenPathData` gives ink, and the existing label
machinery names the places.

- `VisualIntent.kind: 'map'`, with an authored `region` (an ISO 3166 code, or `world`) and
  an optional projection name. Authored rather than described, for the `code` reason: a
  region paraphrased from a `describe` is a different map.
- The projection **must be named in the IR and pinned**, not chosen per render. Two casts
  of one storyboard that projected differently would be two different maps, and the whole
  point of the lane is that the shape is a fact.
- Labels reuse the diagram lane's leader-and-label placement. A map with unlabelled
  countries teaches nothing that a shape does not.

## What it must refuse

Two things, and both are about honesty rather than layout:

- **A projection that misleads at the scale being drawn.** Mercator for anything spanning
  latitudes is a distortion the lesson did not ask for; the lane defaults to an equal-area
  projection and says so when a lesson overrides it.
- **The 567×117 vertical cell.** A world map in a letterbox is a smear. Same rule as every
  other lane: refuse by name, never draw an unreadable one.

## What would start it

Two lessons somebody wanted, asking for real geography — the `demand` column of `npx tsx
packages/pipeline/src/lanedemand.mts`. Today it reads **0**, and unlike chemistry there is
not even a fixture. Plate tectonics, trade winds, the spread of a species and most of
history are the topics that would produce it.

## Done bar

A cast draws a named country's real coastline, projected equal-area, labelled, and
recognisable against an atlas held next to the screen; the same lesson at `short` refuses
by name rather than smearing; `UNSERVED.geography` is deleted in the same commit, which
`auditcheck` forces once `topojson-client`, `d3-geo` or `world-atlas` is a dependency.
