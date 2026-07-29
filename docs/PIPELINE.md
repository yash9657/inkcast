# The staged pipeline — architecture after the visual review

The lesson engine landed and the videos still do not teach as well as they should.
This document is the diagnosis and the plan for the half that `LESSON-ENGINE.md` did
not cover: how a beat becomes ink, and why that path currently throws away its own
best work.

It assumes four decisions, taken deliberately:

1. **Two ink modes.** Equations and plotted data are exact vector; everything else
   stays roughened marker. Correctness where it reads as sloppiness, warmth where it
   reads as warmth.
2. **`@inkcast/visuals` is authoritative for geometry.** The renderer consumes it
   instead of re-deriving it.
3. **Keyed operation is the product.** The no-key path is a CI fixture that renders
   and says so, not a second product held to the same visual bar.
4. **The asset library is curated in-repo, cached per machine.** Quality compounds
   through review, not accumulation.

## Read this first: the pipeline is not missing its planning stages

A natural reading of the current output is that it goes from prompt to drawing with
nothing in between. It does not. Six stages exist:

    ingest -> lesson -> storyboard -> voice -> visuals -> render

`lesson` is a real pedagogy stage with a real schema (`packages/core/src/lesson.ts`:
hook, anchor, `steps[]` each carrying idea + why + visual, worked, misconception,
recap), an LLM path (`lesson-anthropic.ts`) and a heuristic fallback
(`lesson-derive.ts`). `storyboard` classifies every beat into a visual primitive
already — `VisualIntent{kind: plot | path | diagram | icon | illustration | motion |
text}` — and ties each element to the narration with `Enter.cue`. Word-level sync is
not a gap either: `packages/voice/src/align.ts` runs forced alignment against a local
ONNX Whisper with cross-attention DTW, offline, no Python, 0.45 s for a 9.4 s clip,
and the last verification placed 39 of 39 elements word-exactly.

Planning is not the bottleneck. Two other things are.

## Root cause 1 — the visuals stage is inert (blocking, fix first)

`packages/visuals` resolves every element to an SVG, measures its reveal geometry and
writes `assets/visuals.json`. **The renderer reads none of it.**
`packages/render/src/plot.ts` re-derives all plot geometry from the IR itself, and
`packages/visuals/src/plot.ts` — which contains the _richer_ label-placement solver of
the two — never runs in the render path.

So there are two implementations of the same geometry that must agree by hand, and the
better one is dead. Every fix has to be made twice or it silently does not apply. This
is invisible from outside the codebase and it is the reason a "visual asset router" has
nowhere to land today: anything it produced would be ignored.

Everything else in this document is blocked on fixing it, which is why it is PR 1.

## Root cause 2 — the abstraction is asserted, not mapped

The lesson schema records an `anchor` — a concrete everyday situation — as prose. What
it does not record is _what maps onto what_: that the hill's height is the loss, the
walker's position is the parameter, the slope underfoot is the gradient. Without that
table the compiler cannot know which beat is the one where the abstraction arrives, so
it currently guesses with a regex over the narration.

That guess works on the shipped lesson and is fragile everywhere else. An explicit
mapping makes the same moment derivable instead of detected, and makes it checkable:
an analogy whose parts do not each map to something is an analogy that will not land.

## Root cause 3 — nothing compounds

Assets resolve into `<project>/assets/<id>.svg`. There is no shared library, no
versioning and no cross-video reuse, so the tenth video is drawn by the same machinery
as the first with none of the benefit. There is also no equation typesetting anywhere
in the repo — arithmetic on the board is plain text — and no character rig, so the cast
of every narrative topic is stick figures.

## The stage contracts

Each stage takes the previous stage's document and adds one thing. The schemas below
are additive to what exists; field names in `code` already exist unless marked NEW.

### 1. Lesson (pedagogy)

```ts
type Lesson = {
  topic: string;
  audience?: string;
  objective?: string;

  /** NEW. Chooses the whole downstream strategy, so it is decided once, explicitly. */
  kind: 'stem' | 'process' | 'narrative' | 'historical' | 'abstract';
  /** NEW. For `stem`, `first-principles` is required — see the rule below. */
  strategy: 'first-principles' | 'analogy' | 'story';
  /** NEW. The one sentence the video exists to land. Everything serves this. */
  coreInsight: string;

  /**
   * NEW. The analogy as a *mapping*, not a description.
   *
   * This is what makes the abstraction's arrival derivable rather than guessed: the
   * beat that introduces `abstract` for the first time is the beat where the concrete
   * thing becomes it, and the compiler can morph one into the other without reading
   * the narration. It is also the check that the analogy is sound — a part with no
   * counterpart is a part the learner will not be able to carry across.
   */
  analogy?: {
    concrete: string; // "a foggy hillside"
    maps: { from: string; to: string }[]; // height->loss, position->parameter, slope->gradient
  };

  /** NEW. Narrative and historical topics. Resolved once into a character sheet. */
  cast?: { id: string; name: string; look: string }[];

  hook: LessonStep;
  anchor: LessonStep;
  steps: LessonStep[];
  worked?: LessonStep;
  misconception?: LessonStep;
  recap: LessonStep;
};

type LessonStep = {
  idea: string;
  why: string;
  narration: string;
  visuals: VisualIntent[];
  hold: number;

  /**
   * NEW. Where this step's claim comes from.
   *
   * The rule that makes "reason from first principles" checkable rather than
   * aspirational: when `strategy` is `first-principles`, no step may be `asserted`,
   * and a `derived` step must name the steps it follows from. A validator can fail
   * that; a style instruction in a prompt cannot.
   */
  from: 'given' | 'derived' | 'asserted';
  derivedFrom?: string[];
};
```

### 2. Script (cadence and emphasis)

Split out of the lesson stage, because rewriting the words is the most common edit and
should not require re-planning the pedagogy.

```ts
type Beat = {
  id: string;
  stepId: string;
  role: 'hook' | 'ground' | 'build' | 'example' | 'payoff' | 'misconception' | 'recap';
  /** One idea per sentence. Rhetorical question for a hook. Never textbook prose. */
  text: string;
  /** Drives TTS prosody *and* `Scene.hold` — pacing is one decision, not two. */
  cadence: 'slow_deliberate' | 'building_energy' | 'punchy';
  /** Verbatim substrings of `text`. Emphasised in the voice and on the board. */
  emphasis: string[];
  targetSec: [number, number]; // 5-15
};
```

`cadence` is the single source of pacing: it sets the provider's rate and the trailing
`hold`, so a punchy beat cannot end up with a two-second silence after it because two
stages disagreed.

### 3. Storyboard (primitive and layout)

```ts
type BeatVisual = {
  beatId: string;
  primitive:
    'equation' | 'graph' | 'diagram' | 'character_scene' | 'icon_sequence' | 'process_flow';
  layout: 'single' | 'split' | 'stack' | 'grid' | 'annotate';
  elements: {
    /** A library asset, or an inline spec for generated geometry. */
    source: AssetRef | InlineSpec;
    /**
     * Word *index* into the beat's tokenised text, not a phrase to search for.
     *
     * A phrase has to be found again by the aligner and can fail to match or match
     * twice; an index cannot. The aligner maps index -> timestamp, so the contract
     * between planning and timing carries no ambiguity to resolve later.
     */
    entersAtWord: number;
    role: 'subject' | 'annotation' | 'label';
    /** Reshaped out of an element already on the board. */
    morphFrom?: string;
  }[];
};
```

### 4. Asset reference

```ts
type AssetRef = {
  /** Library path, e.g. 'characters/odysseus' or 'symbols/physics/force-vector'. */
  path: string;
  /** Pinned, so improving an asset never silently changes a finished video. */
  version: number;
  /** Pose for a character, state for a symbol. */
  variant?: string;
  /**
   * Which ink mode draws it. The hybrid decision, made per asset rather than
   * globally: an equation is exact because a wobbled integral sign is a different
   * integral sign, and a hillside is roughened because that is the whole look.
   */
  ink: 'crisp' | 'sketch';
};
```

## Which stages are models, and which are code

The instinct to make every stage an agent is the expensive version of this
architecture and it is also the less accurate one. Geometry and timing are arithmetic;
a model doing arithmetic is a model getting arithmetic wrong non-reproducibly.

| Stage           | Implementation                                                                                                          | Output mode                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1. Lesson       | **LLM**, one call                                                                                                       | Structured (tool schema). Prose fields free-form inside a fixed envelope. |
| 2. Script       | **LLM**, separate call                                                                                                  | Structured. Separate so a rewrite does not re-plan the pedagogy.          |
| 3. Storyboard   | **Deterministic**, with an LLM classifier only for the primitive when the intent is ambiguous                           | Structured for the classifier; the layout is code.                        |
| 4. Asset router | **Deterministic** routing table. The LLM appears only _inside_ the illustration lane, writing a character-sheet prompt. | n/a                                                                       |
| 5. Timing       | **Deterministic** — the aligner already exists                                                                          | n/a                                                                       |
| 6. Compositor   | **Deterministic**                                                                                                       | n/a                                                                       |

Two LLM calls, one optional classifier, four deterministic stages. Everything a test
can pin is code; the model is used only where taste and language are the product.

## The two ink modes

`crisp` and `sketch` are properties of an asset, not of a build. They coexist in one
frame and both animate the same way — a stroke revealed along its own length, so the
difference is the path, never the motion.

- **`crisp`** — the path is used verbatim. Equations (KaTeX glyph outlines), plotted
  curves (sampled from the real function), auto-laid-out graph edges. No perturbation,
  because the perturbation is what makes a minus sign ambiguous and a data point a
  lie.
- **`sketch`** — the path goes through `sketchAlong` as it does today. Hillsides,
  characters, arrows, labels, containers, annotations.

The rule that keeps this coherent: **anything a learner might read a number or a
symbol off is `crisp`; anything they read a feeling off is `sketch`.**

## The asset library

Curated primitives live in the repo and are reviewed like code. Generated variants are
cached per machine and never committed.

```
assets/library/
  library.json                    # manifest: path -> { version, ink, license, provenance }
  characters/
    odysseus/
      character.json              # the rig
      base.svg
      poses/
        standing.svg  walking.svg  pointing.svg
  symbols/
    physics/  force-vector.svg  ray.svg  mass.svg
    circuit/  resistor.svg  capacitor.svg  battery.svg
    math/     brace.svg  axis-arrow.svg
  figures/                        # the no-key cast: standing, walking, pointing, sitting
  icons/                          # curated overrides only
```

`lucide-static` stays where it is — a ~2000-icon _fallback provider_, not the library.
The library is the things we chose; lucide is the things we settle for.

```ts
/** characters/<id>/character.json */
type CharacterRig = {
  id: string;
  version: number;
  /** Locked, so a regenerated variant is pixel-identical. */
  seed: number;
  /** The canonical description every variant is conditioned on. */
  look: string;
  /**
   * Named parts with pivots.
   *
   * Poses are *composed* from these where the pose is a limb rotation, and only
   * generated when it is not. Composition is free, instant and exactly consistent;
   * generation is none of those, so it is the fallback rather than the mechanism.
   */
  parts: { id: string; d: string; pivot: [number, number] }[];
  poses: Record<string, { compose?: Record<string, number>; generated?: boolean }>;
};
```

**Identity across poses** is the gate. A generated variant is conditioned on the
base _raster_ (image-to-image, not prompt repetition, which does not work), cached
under `~/.inkcast/cache/<id>/<pose>-<seed>.svg`, and accepted only if an embedding
similarity check against the base passes. A failed check retries once and then falls
back to a composed pose. Silently shipping a character with a different face is worse
than shipping a stiffer one.

**Versioning is what makes it compound.** A storyboard pins `AssetRef.version`, so
improving `characters/odysseus` to v3 leaves every existing video rendering v2 until
someone re-resolves it. Quality accumulates without old renders changing under you.

## Order of work

The sequence below is a dependency order, not a schedule. Step 1 genuinely blocks the
rest; after that the ordering is by leverage rather than by stage number, because the
quality complaint is bottlenecked on stages 3 and 4 and not on stage 1.

Each step names how to tell it worked. That matters more than its size: several of
these are small diffs whose effect is only visible in a rendered frame, so "it
typechecks" is not evidence.

**1. `visuals` becomes authoritative for plots.** Renderer consumes plot geometry from
`visuals.json`; delete the duplicate in `render/src/plot.ts`; keep the richer label
solver. _Done when:_ the test suite passes and a benchmark render is no worse
frame-for-frame. _Unblocks:_ everything below.

**2. Two ink modes.** `ink: 'crisp' | 'sketch'` on the geometry contract; plots become
crisp. _Done when:_ a crisp plot's `d` contains no perturbation and a sketch path is
byte-identical to today.

**3. The equation lane.** New `equation` element; KaTeX -> SVG -> glyph path extraction
-> crisp stroke reveal. _Done when:_ `w \leftarrow 3 - 0.1 \times 4 = 2.6` renders as
real glyphs and reveals left to right. _Replaces:_ arithmetic-as-text.

**4. Library skeleton.** `library.json`, `AssetRef`, resolution order
(library -> cache -> generate -> lucide), and the hand-authored `figures/` cast. Closes
the no-key character gap as a side effect. _Done when:_ an asset resolves by path and
version with no network.

**5. Character rigs.** `character.json`, composed poses, generated-variant cache,
similarity gate. _Done when:_ the same character across three beats is pixel-identical
where composed and above threshold where generated.

**6. Lesson schema v2.** `kind`, `strategy`, `coreInsight`, `analogy.maps`,
`from`/`derivedFrom` with the no-`asserted` validator for first-principles. Derive the
morph from `analogy.maps` and **delete the `BECOMES_A_PLOT` regex** in
`planner/src/compile.ts`, which is a deliberate stopgap. _Done when:_ the shipped lesson
still morphs, and a lesson with the same mapping but different wording also morphs.

**7. The script stage.** Split from `lesson`; `cadence` drives both TTS rate and `hold`;
`emphasis` drives voice and board weight. _Done when:_ a punchy beat is measurably
faster and holds shorter than a slow_deliberate one.

**8. `entersAtWord`.** Replace phrase cues with word indices end to end. _Done when:_
every element resolves to a timestamp with no fallback warnings in the render log.

**9. Symbol libraries and process flow.** `symbols/physics`, `symbols/circuit`,
node-and-edge auto-layout revealed in traversal order.

## Still open

- **Music and SFX** are named in the brief and absent from the compositor. A separate
  piece of work, not a design problem.
- **The cost target.** `$0.20/min` was set when zero-key was the headline. With keyed
  operation as the product — LLM lesson, LLM script, cloud voice, generated
  characters — that number needs restating rather than quietly breaking.
- **9:16 and equations.** A typeset equation has a fixed aspect and a vertical frame
  has no width. Either equations get their own layout rule for `9:16` or they are
  broken across lines, and that is a decision to take before PR 3, not during it.
