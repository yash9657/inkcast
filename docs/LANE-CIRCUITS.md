# Lane doc — circuits

_Written 2026-08-24 for plan item 6.3. The plan does not ask for this page — it puts
circuits **first** and treats it as ready to build. That premise is wrong on both of its
factual legs, so the demotion is written down here rather than done quietly. Status: **not
built, no demand, ranked last of the three.**_

## What the plan says, and why it does not hold

> circuits first; ... **closest: curated `symbols/circuit/*` already exist**

They do not. `assets/library/library.json` holds exactly seven entries: two physics
symbols (`symbols/physics/force-vector`, `symbols/physics/mass`), four figures
(`figures/standing|walking|pointing|sitting`) and one character rig
(`characters/explorer`). There has never been a circuit symbol in this repo. The previous
session verified this and recorded it in the remainder handoff; this page is where it
stops being a footnote.

The second leg is `UNSERVED.circuits.renderer: 'schemdraw'`. **Schemdraw is a Python
library.** It cannot be a dependency of this workspace, which means the tripwire that was
supposed to force the `UNSERVED` row out on the day the lane shipped could never fire —
and neither could chemistry's (`rdkit`, where the package is `@rdkit/rdkit`) or
geography's (`topojson`, where a map lane installs `topojson-client`). All three are fixed
in 6.3; see `UNSERVED`'s comment in `core/src/lanes.ts`. Circuits now names no package at
all, because there is none to name, and its tripwire is the asset library instead.

## What the lane actually needs

Three pieces, in rising order of cost:

1. **Layout.** `@dagrejs/dagre` is already a dependency (the diagram lane), and a netlist
   is a graph. This part is nearly free, and it is the part the plan was thinking of when
   it called circuits "closest".
2. **Orthogonal wire routing.** Dagre gives node positions and spline edges; a schematic
   wants right-angled wires with junction dots, and nets that join rather than cross. This
   is real work and it is not what a graph layout library does.
3. **A symbol set, drawn.** Resistor, capacitor, inductor, battery, cell, lamp, switch,
   diode, LED, transistor (two), ground, junction, ammeter, voltmeter, op-amp — about
   fifteen to cover school-level circuits, each hand-authored to this board's own hand and
   versioned the way `figures/*` are. **This is the item.** A schematic drawn from
   somebody else's symbol library would look like a different product pasted onto the
   board, which is the argument `core/src/palette.ts` and the style packs already make
   about colour and ink.

The IR shape is the `code` shape once more: `VisualIntent.kind: 'circuit'` with an
authored netlist rather than a description, because a circuit paraphrased from a
`describe` is a different circuit. Timing diagrams — which `lanes.ts` counts as part of
this gap — are a plot, not a schematic, and are a separate and much smaller job that could
land first if a lesson ever asks for one.

## Why it is now ranked last

Chemistry has three findings on record and a rendered film showing a false formula on the
board. Geography has none, and neither does this. With demand equal at zero, the tiebreak
is cost, and circuits is the only one of the three whose main cost is _curated drawing
work_ rather than a dependency and a resolver — the one thing a session cannot do quickly
or verify mechanically.

## What would start it

Two lessons somebody wanted, asking for a schematic — the `demand` column of `npx tsx
packages/pipeline/src/lanedemand.mts`. Today it reads **0**. Electronics, signal
processing and most of undergraduate physics would produce it; a lesson about a battery,
a wire and a bulb would not, and should not — the shipped lithium-ion film draws exactly
that and draws it correctly.

## Done bar

A cast draws a two-resistor circuit with right-angled wires, junction dots where nets
meet, and the symbols a physics teacher would recognise; the symbol set is in
`assets/library/` with licences and provenance like every other curated asset; the
`UNSERVED.circuits` entry is deleted in the same commit, which `auditcheck` forces once
`symbols/circuit/` appears in the library manifest.
