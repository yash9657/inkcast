# Lane doc — chemical structure

_Written 2026-08-24 for plan item 6.3, which requires this page before any code. Status:
**not built, and not yet justified by demand.** Ranked first of the three unserved lanes._

## What is missing

Skeletal formulas. A ring with its bonds, an `OH` hanging off it, a double bond drawn as
two parallel lines — the notation a chemistry teacher draws on a board, and the one thing
on that board a learner cannot reinterpret charitably. `core/src/lanes.ts` calls this
`chemical structure notation` and fires on it; nothing draws it.

## What happens instead, measured

`projects/qc61-aspirin` is the only lesson in the corpus that asks. Three beats ask for
structures and the illustration lane answers all three. Frames at t=12 and t=30:

| the beat asked for                                      | the board drew                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------ |
| the skeletal formula of salicylic acid, drawn large     | the hand-lettered words **"Salicylic acid"**, and nothing else     |
| a benzene ring with its hydroxyl group circled in red   | a starburst captioned _hydroxyl_ containing the formula **"B₄H₂"** |
| the structural formula of aspirin beside salicylic acid | the word **"Aspirin"** next to a box containing **"H₃"**           |

The audit's phrasing for this class is "plausible, decorative, and chemically false". The
frames are worse than that. Hydroxyl is OH; B₄H₂ is a boron hydride and not a stable one.
The failure is not a wrong _picture_ — it is a wrong **formula, written in letters**,
which a viewer reads as a fact the way they read a mangled equation (audit D1). The one
beat that came out honest is the one where the image lane gave up and lettered a card.

## The dependency choice

The lane wants **coordinates, not a picture**. Every other lane here is geometry the board
redraws in its own ink; a library that hands back a finished SVG drawing would put a
second renderer in the tree with its own line weights, its own type, and its own idea of
the palette — the defect plan item 2.2 spent a phase deleting. So the question is not
which library draws the best molecule. It is which one will hand over atom positions and a
bond list and let this repo draw them.

| package         | licence      | unpacked | shape                                                                             |
| --------------- | ------------ | -------- | --------------------------------------------------------------------------------- |
| `openchemlib`   | BSD-3-Clause | 6.1 MB   | pure JS; parses SMILES, generates 2D coordinates, exposes atoms and bonds as data |
| `smiles-drawer` | MIT          | 6.9 MB   | pure JS; computes coordinates but is built to draw to a canvas                    |
| `@rdkit/rdkit`  | BSD-3-Clause | 14.1 MB  | WASM; authoritative chemistry, but the drawing API is its SVG writer              |
| `kekule`        | unstated     | 42.5 MB  | out — an unstated licence is disqualifying in an AGPL repo                        |

**Start with `openchemlib`.** It is the only one whose coordinate generation is reachable
as data rather than as a side effect of drawing, it is pure JS (so it imports lazily in
Node like MathJax and Shiki do), and BSD-3 is compatible. `@rdkit/rdkit` is the right
answer if correctness at the edges ever matters more than weight — aromaticity
perception, stereochemistry, tautomers — and switching is a lane-internal change, which
is the point of asking for coordinates.

Note that `UNSERVED.chemistry` named `rdkit` until 6.3 corrected it. That string could
never have matched a manifest; the package is `@rdkit/rdkit`.

## How it plugs in

`visuals/src/code.ts` (plan 6.2) is the worked example and its four load-bearing
properties are inherited from `equation.ts`. Three of them hold here; one does not.

1. **The parser runs in pure Node, imported lazily.** Same trade as MathJax and Shiki: a
   storyboard with no molecule in it pays nothing.
2. **The output surface is small and asserted.** Atoms carry a position, an element, a
   charge and an implicit-hydrogen count; bonds carry two ends, an order and a stereo
   flag. Anything else the library offers is not read.
3. **Marks are emitted in a drawing order, so ordering them is the animation** — ring
   first, then substituents, then labels, exactly as a hand would.
4. **`ink: 'crisp'` does _not_ apply**, and this is the lane's own decision. A wobbled
   integral sign is a different integral sign and a wobbled `l` is a `1`, but a wobbled
   C–C bond is the same bond: skeletal formulas are line art, and a hand-drawn one is what
   the subject actually looks like on a real board. **Bonds draw in `sketch`; atom labels
   are type and go through the same glyph path the code lane uses.** The exception inside
   the exception is bond _multiplicity_ — the gap between the two lines of a double bond
   is meaning, not decoration, so it is geometry the lane computes and floors, not a
   number roughness is allowed to close.

The IR shape follows `code` exactly, and for the same reason: a listing paraphrased from a
`describe` is a listing that does not run, and a structure paraphrased from a `describe` is
a different molecule. So the author writes the notation, not a description of it —
`VisualIntent.kind: 'structure'` with an authored `smiles: string`, and a
`StructureElement` beside `CodeElement` in the IR. 6.1 already detects SMILES in prose
(`looksLikeSmiles`), which is the evidence that authors reach for it unprompted.

## What it must refuse

The vertical preset gives a visual a **567×117** cell. A benzene ring with legible atom
labels does not fit there, and the code lane's defect — `hash-map` cannot render at
`short` at all — is the warning. This lane sizes its ring to the cell, checks the label
against `MIN_GLYPH_PX`, and **refuses with a message naming the beat** rather than drawing
a structure nobody can read. Handwriting is never the fallback: an unreadable formula is
the defect, not a degraded version of the feature.

## What would start it

Two lessons somebody actually wanted, asking for structures — `npx tsx
packages/pipeline/src/lanedemand.mts`, the `demand` column, not the `fixture` one. Today
that column reads **0**. The three findings on record are `qc61-aspirin`, which was written
to prove the guard fires.

## Done bar

A cast of a real chemistry lesson draws benzene as a hexagon with alternating bonds and
its substituents labelled; the same lesson at `short` either fits or refuses by name; the
`UNSERVED.chemistry` entry is deleted in the same commit (`auditcheck` fails until it is);
and `openchemlib` appearing in a manifest is what forces that deletion.
