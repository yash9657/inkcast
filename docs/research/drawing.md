# How to draw anything — the research, and the experiment that settled it

Researched 2026-08-05, prompted by the right question: _is a folder of hand-written
drawing rules a crude way to build this, given it can never cover every topic a user
asks for?_ Yes. This records why, what the field does instead, and the measured
experiment that chose between the options. Read this before adding another keyword table.

## 1. The problem, stated precisely

Every drawing lane in this repository answers **"which of the things I already know is
this?"**

| lane                      | vocabulary                 | authored from               |
| ------------------------- | -------------------------- | --------------------------- |
| `path` (`buildFreeform`)  | 6 shapes                   | the gradient-descent lesson |
| `plot` (`plots.ts`)       | ~12 named curves           | the gradient-descent lesson |
| `diagram` (`makeDiagram`) | nodes in a flow or a stack | a flowchart                 |
| `icon` (lucide)           | a fixed symbol set         | someone else's symbol set   |

Each is a list, and the failures follow from that with no further explanation needed: a
battery cross-section drawn as a parabola (`cross-section` was a term in the bowl regex),
a ship heading for the rocks drawn as a hillside (nothing matched, so the default fired),
a lithium ion beat drawn with a stick figure (the narration said "you").

Last session's fix made those lanes _honest_ — they now decline what they cannot draw
instead of approximating it. That is not the same as being able to draw it, and no number
of additions would be, because **the axis is wrong**. A topic space cannot be enumerated.
There is no version of this file listing enough shapes.

## 2. The generated-image lane is not the answer either

Fourteen images were generated through `fal-ai/flux/schnell` and every one was opened
(`STATUS.md`, 2026-08-05). The split was not random:

- **Objects come back acceptably.** Two battery cells; two hatched electrode stacks with a
  gap between them.
- **Relations come back wrong.** _"Two parallel sheets with a gap; circles with plus marks
  crossing freely while plain dots stop dead at the edge"_ → **two empty rectangles with a
  couple of x's floating in them.** The relation is the entire idea of that beat.
- **Words come back as scribble.** `+e> --`, and two labels both reading "full" where the
  lesson wanted full and empty. An image model cannot spell.
- **A change comes back as a muddle.** "The same thing drawn twice, before and after" is
  one confused frame.

Three further structural limits, independent of quality: a raster has **no parts** (so
nothing can be cued to a word, highlighted while it is discussed, or animated), **no
reuse** (five separate drawings of the same two stacks in one lesson, all different — the
competitor's own admitted defect, `golpo-ux.md` §5.2), and **no zero-cost path** (it needs
a key and a GPU, against a project whose premise is that everything works free and
offline).

Recraft V4 text-to-vector ($0.08/image on fal, true SVG rather than a trace) fixes the
tracing step and none of the four problems above. Worth revisiting only if the pictorial
lane ever matters more than the structural one.

## 3. What the field actually does

- **Speech-Synchronized Whiteboard Generation via VLM-Driven Structured Drawing
  Representations** (arXiv 2603.25870, March 2026) — the closest published work to this
  product. 24 narrated Excalidraw demonstrations with millisecond per-element timestamps
  across 8 STEM domains; a VLM predicts **Excalidraw's native JSON** — `{id, type, x, y,
width, height, points, text}` — one element at a time. Element mix in real whiteboard
  teaching: **94.9% freehand strokes, 2.6% text, 2.5% geometric primitives**. Their
  ablations are the useful part: removing the canvas-feedback image degrades _geometry_;
  removing the onset token degrades _timing_; one-shot non-autoregressive generation
  "draws plausibly but in the wrong evolving layout". They argue for structured output
  over raster on exactly our grounds — editable, replayable, addressable.
- **VideoSketcher** (arXiv 2602.15819) — LLMs overcome the sketch-data bottleneck because
  they already know what things look like; the model emits stroke-by-stroke drawing
  instructions as SVG-like code, with stroke _ordering_ learned separately from appearance.
- **Chat2SVG**, **StarVector** (SVG-Bench), **SVGenius**, **GeoSVG-RL** — a whole line of
  text-to-vector work. The consistent finding: LLMs compose primitives well and place
  precise coordinates badly, so the wins come from constraining the vocabulary and from
  a geometry-aware repair or feedback step, not from asking for raw SVG.
- **The Excalidraw-skill ecosystem** (several public Claude Code skills) — the pattern that
  works in practice is JSON of typed elements, rendered by a real engine, with the agent
  **looking at its own render** to catch overlapping text and misaligned arrows before
  delivering.

The convergence is unambiguous: **a structured, typed element list, authored by a language
model, rendered by us.** Not a raster, and not raw SVG path data.

## 4. The experiment that settled it

Four subjects spanning what lessons actually need — a battery cross-section (structure), a
battery circuit (structure _and_ relation, the one the image model failed), a ship heading
for rocks (pictorial/organic, where an LLM should be weakest), a chloroplast (biological
structure). One `claude-opus-5` call each, forced onto an eight-mark vocabulary — rect,
ellipse, line, stroke, arrow, label, hatch, dots — on a 1000×750 canvas, rendered through
roughjs. 12–17 seconds each. `scratchpad/drawlang.mts`.

**All four were legible, and two were textbook-quality.** The circuit drew the wire looping
through a bulb, the ion crossing the damp gap, a large ✗ on the electron's path, and the
words "e- CANNOT CROSS" — the exact beat the image model rendered as two empty rectangles.
The chloroplast drew an outer envelope, three grana as stacked ellipses, stroma dots, and
leader arrows to correctly spelled labels. Even the ship was fine: a sailboat, a sea line,
hatched jagged rocks, a "?" over its unknown position.

Failure modes observed, all **mechanical rather than conceptual**: labels landing on ink,
labels stacking on each other, a leader line crossing the whole drawing, hatching not
clipped to the shape it fills. Every one is fixable in code (`repairLabels`) or by showing
the model its own render — which is precisely what the literature says the feedback loop
buys.

## 5. What was built, and what was deliberately kept

`Mark` in `packages/core/src/lesson.ts`, `drawing.ts` (marks → elements, pure), and
`draw-anthropic.ts` (the author) — see the commit `Draw anything: a vocabulary of marks
instead of a list of topics`. The load-bearing design decisions:

1. **A mark compiles to an ordinary `Element`.** A stroke is a `PathElement`, a box a
   `ShapeElement`, a label a `TextElement`. This is why the change is small: roughening,
   cueing, stroke-by-stroke reveal, camera framing and `persist` are all inherited. It
   also means the sync work already done applies to drawings for free — which is the point
   the user made about sync being the easier half, and it is easier _because_ the drawing
   is structured.
2. **Marks live in `lesson.json`.** Re-rendering is then a pure function of the file: no
   key, no network, no model. A human can move a stroke by editing JSON.
3. **Cached machine-wide by the hash of the instruction, brief included.** Entity
   consistency for free; a brief change invalidates every cached drawing, because a
   drawing composed for a canvas that no longer exists is the subtlest way to make a fix
   look like it did nothing.
4. **`plot` is kept.** It derives geometry from the beat's own numbers — a tangent whose
   slope really is +4, descent steps produced by running the algorithm. No composer should
   be guessing at that, and this is the one place a hand-written lane is _better_.
5. **`illustration` is narrowed** to what it is genuinely better at: a living thing, a
   person, a real place — where likeness is the point and structure is not.

## 5b. The feedback loop, built and measured (2026-08-05)

The loop §6 called for is in: `draw-audit.ts` measures, `draw-critic.ts` shows the drawing
back to the model that drew it, `pipeline/src/draw-preview.ts` renders it. What the
literature promised held up, and two things it does not talk about turned out to matter
more than the loop itself.

**Arithmetic first, judgement second.** Before any model is called, the drawing that will
actually be drawn is measured: names on names, names across strokes, words too long for
their line, ink off the canvas, a name too far from any mark to be naming it. Across the 41
drawings then in the machine-wide cache that measurement fell from a defect score of 713 to
110 through mechanical repair alone — no calls, no model — and only the residue is worth a
call. The gate is why the pass costs one extra call on about a third of drawings rather
than one on every drawing.

**Where the win actually came from.** Not from the model. It came from teaching the repair
pass what ink _is_: a rect is four edges, an arrow is its line, and only shading covers an
area (`draw-geom.ts`). The previous pass compared bounding boxes and approximated the
container/part distinction with an area cap, which got every long arrow, gap line and
leader wrong. That change is free, local, and did most of the work.

**Two ways to make the number better and the picture worse**, both caught by looking at
frames, both now recorded in tests:

1. The first scored repair weighted displacement at nearly nothing, so it cleared every
   collision by throwing labels up to 180 units off the canvas. 713 → 48, and all 48 were
   labels the repair had marooned.
2. The audit counted hatching as ink, so `N` and `S` inside a hatched bar magnet measured
   as two defects. The correction moved both letters out of the magnet and into the field
   lines below, where they named nothing, and scored zero for it.

A shaded region is now something you may write **on** and still be **near**. That is the
whole fix, and it is the shape of the general lesson: **a measurement that a fix can game
is a measurement that will be gamed.**

**The gate's blind spot, stated plainly.** The audit is arithmetic, and the paper's ablation
is about _geometry_. A benzene ring whose double bonds are drawn as chords across the middle
audits perfectly clean and is never looked at. `INKCAST_DRAW_FIX=all` runs the unconditional
pass for exactly that experiment; it is not the default because it doubles the lane's cost
on drawings that were already right.

**Result on the twelve-subject sheet** (`pipeline/src/drawsheet.mts`, which now holds the
subjects so the breadth test stops being rebuilt from memory): 12/12 draw, 10/12 measure
clean, 4 were dirty as composed and 2 of those were corrected. The heart's septum moved out
of the wrong ventricle and onto a leader; the knee's correction measured worse and was
rejected, which is the veto doing its job.

## 6. What is still open

- **A correction gets one attempt.** The loop the paper describes is iterative; ours calls
  once, keeps the result only if it does not measure worse, and caches the outcome either
  way. The two subjects still measuring dirty are ones where a second look would plausibly
  land.
- **Nothing measures whether a drawing teaches.** Tangled wavefronts, a septum leader
  pointing at the outer wall, double bonds drawn as chords: all invisible to arithmetic and
  all visible in a frame. A judge pass — a model scoring the render against the instruction
  — is the obvious next lane, and is a different thing from a correction pass.
- **Part-level cueing is unused.** Every mark now has a name on the board, and nothing yet
  cues `damp-gap` to the words "the damp gap", highlights a part while it is discussed, or
  animates one part of a drawing. The IR supports all three (`enter.cue`, `EmphasisElement`,
  `motion`). This is where the drawing starts driving the narration rather than following
  it.
- **Reuse across beats.** Caching makes two _identical instructions_ the same drawing;
  nothing yet lets beat 7 say "the drawing from beat 2, with the arrow reversed".
- **Open weights.** The drawing author is a text model emitting JSON, so this lane is the
  first one that a local model could serve end to end. Untested.

## 7. Sources

- [Speech-Synchronized Whiteboard Generation via VLM-Driven Structured Drawing Representations](https://arxiv.org/abs/2603.25870v1)
- [VideoSketcher: Sequential Sketch Generation Using Video Model Priors](https://arxiv.org/pdf/2602.15819)
- [StarVector: Generating Scalable Vector Graphics Code from Images and Text](https://arxiv.org/html/2312.11556v4)
- [SVGenius: Benchmarking LLMs in SVG Understanding, Editing and Generation](https://arxiv.org/html/2506.03139v1)
- [GeoSVG-RL: Geometry-Aware RL for Layout-Constrained Text-to-SVG Diagram Generation](https://arxiv.org/pdf/2605.25447)
- [Sketch2Diagram (ICLR 2025)](https://openreview.net/pdf/55723a92cc8100b93863d45a8d0485e923c83e7a.pdf)
- [Recraft V4 text-to-vector on fal](https://fal.ai/models/fal-ai/recraft/v4/text-to-vector)
- [An Excalidraw diagram skill for coding agents](https://github.com/coleam00/excalidraw-diagram-skill)
