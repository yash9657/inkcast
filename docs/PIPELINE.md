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
text}`, plus `character` for a member of the lesson's `cast` — and ties each element to
the narration with `Enter.cue`. Word-level sync is
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

## Root cause 2 — the abstraction is asserted, not mapped ✅ FIXED (step 6)

The lesson schema records an `anchor` — a concrete everyday situation — as prose. What
it does not record is _what maps onto what_: that the hill's height is the loss, the
walker's position is the parameter, the slope underfoot is the gradient. Without that
table the compiler cannot know which beat is the one where the abstraction arrives, so
it currently guesses with a regex over the narration.

That guess works on the shipped lesson and is fragile everywhere else. An explicit
mapping makes the same moment derivable instead of detected, and makes it checkable:
an analogy whose parts do not each map to something is an analogy that will not land.

**Done.** `analogy.maps` is in the schema, `BECOMES_A_PLOT` is deleted, and the
storyboard for the shipped lesson is byte-identical either side of the change — same
morph, `b2_v0 <- b0_v0`, in both aspects. One consequence to know about: the no-key
author does not emit an analogy, because inferring a mapping table from prose is the
guessing that was just removed, so **a keyed run morphs and a no-key run does not.**
That divergence is deliberate and deterministic. It replaces the old behaviour, where
the no-key path morphed whenever a document happened to put a becoming-verb near the
word "curve" — luck dressed as pedagogy.

## Root cause 3 — nothing compounds

Assets resolve into `<project>/assets/<id>.svg`. There is no shared library, no
versioning and no cross-video reuse, so the tenth video is drawn by the same machinery
as the first with none of the benefit. There is also no character rig, so the cast of
every narrative topic is stick figures.

_Equation typesetting was the third item here and is done — see step 3. **The library is
done — see step 4:** curated assets resolve by path and pinned version, and the
generated-raster cache is machine-wide rather than per project. **Rigs are half done — see
step 5:** `characters/explorer` holds identity across four poses with no key, so a character
can now be *the same character* standing and walking. What remains is the pose composition
cannot describe, which needs a provider and the identity check that goes with it. **And the
pedagogy can now reach both — see step 5b:** a lesson declares a `cast` and names a pose per
beat, so the library is addressable rather than merely reachable through an alias table._

## The stage contracts

Each stage takes the previous stage's document and adds one thing. The schemas below
are additive to what exists; field names in `code` already exist unless marked NEW.

### 1. Lesson (pedagogy)

**Shipped.** This is the schema as it exists in `packages/core/src/lesson.ts`; the
zod there is the source of truth, and `jargonBudget`, `hold` and `VisualIntent.cue`
are real fields this sketch still omits.

```ts
type Lesson = {
  version: 1; // unchanged by schema v2: every new field is defaulted, so saved
  // lesson.json files still parse. The cache invalidates via
  // STAGE_CODE_VERSION instead.
  topic: string;
  audience?: string;
  objective?: string;

  /** Chooses the whole downstream strategy, so it is decided once, explicitly. */
  kind: 'stem' | 'process' | 'narrative' | 'historical' | 'abstract';
  /** For `stem`, reason from first principles before reaching for an analogy. */
  strategy: 'first-principles' | 'analogy' | 'story-driven';
  /** The one sentence the video exists to land. Everything serves this. */
  coreInsight: string;

  /**
   * The analogy as a *mapping*, not a description.
   *
   * This is what makes the abstraction's arrival derivable rather than guessed, and it
   * is also the check that the analogy is sound — a part with no counterpart is a part
   * the learner will not be able to carry across.
   *
   * How the compiler actually reads it (`findReuse`, planner/src/compile.ts): a lesson
   * that declares `maps` has said structurally that the concrete thing stands for the
   * abstract one, so the first `step` drawing a `plot` after the anchor drew something
   * is where the abstraction arrives, and it grows out of that drawing. Deliberately
   * **no text matching, including against the map's own terms** — the benchmark keeps
   * `loss`, `gradient` and `parameter` in its `jargonBudget` and never says them at
   * that beat, so matching `to` terms against the narration finds nothing.
   */
  analogy?: {
    concrete: string; // "walking downhill in thick fog"
    // The `to` side is written in the plain words the narration uses, not the jargon
    // being avoided: "the height of the hill" -> "how wrong the machine is right now".
    maps: { from: string; to: string }[];
  };

  /**
   * Narrative and historical topics. Resolved once into a character sheet. ✅ SHIPPED.
   *
   * Defaulted to `[]` rather than required, so every `lesson.json` written before it
   * existed still parses and the schema stays at version 1. `critiqueLesson` rejects a
   * `narrative` lesson that declares no cast, and a `VisualIntent.character` naming an
   * id that is not here — which is the first rule anywhere that branches on `kind`.
   */
  cast: { id: string; name: string; look: string }[];

  hook: LessonStep;
  anchor: LessonStep;
  steps: LessonStep[];
  worked?: LessonStep;
  misconception?: LessonStep;
  recap: LessonStep;
};

type LessonStep = {
  idea: string;
  /** The justification. Named `because`, not `why` — earlier drafts of this document
   *  said `why`, which never existed in the code. */
  because: string;
  narration: string;
  visuals: VisualIntent[];
  hold: number;

  /**
   * Where this step's claim comes from.
   *
   * The rule that makes "reason from first principles" checkable rather than
   * aspirational: when `strategy` is `first-principles`, no beat may be `asserted`,
   * and a `derived` beat must name the beats it follows from. A validator can fail
   * that; a style instruction in a prompt cannot. `critiqueLesson` enforces it, and
   * the repair prompt feeds each failure back with how to fix it.
   */
  from: 'given' | 'derived' | 'asserted';
  /**
   * Ids of the beats this one follows from, and they must come *earlier* — a forward
   * reference is reported as an ordering bug rather than a bad id.
   *
   * Ids are positional, not authored: `hook`, `anchor`, `step1`…`stepN` in the order
   * `steps` is written, then `worked`, `misconception`, `recap`. `LessonStep` has no id
   * field, so nothing has to mint one or keep it unique, and an old lesson gains ids
   * without being rewritten. `lessonBeats()` is where they come from. The trade: ids
   * are only stable for a given lesson, because `adaptLesson` drops steps to fit a
   * budget and therefore renumbers them.
   */
  derivedFrom: string[];
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

**Shipped** (step 7), on `LessonStep` rather than in a stage of its own — see step 7 in
"Order of work" for why, and for the numbers. `text` stayed as `LessonStep.narration`;
`targetSec` was not built, because `adaptLesson` already fits a lesson to a preset's
budget and a per-beat target would be a second opinion about the same thing.

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

**Shipped** (step 4). `packages/core/src/storyboard.ts` is the source of truth; two fields
ended up optional for reasons the zod there explains at length.

```ts
type AssetRef = {
  /** Library path, e.g. 'figures/walking' or 'symbols/physics/force-vector'. */
  path: string;
  /**
   * Optional in, pinned out: absent resolves to the newest version the library has,
   * and the visuals stage writes back the number it used. So improving an asset
   * never silently changes a finished video, without every author having to know
   * which version they are on.
   */
  version?: number;
  /** Pose for a character, state for a symbol. Step 5 reads it. */
  variant?: string;
  /**
   * Which ink mode draws it, overriding the library's own declaration. Normally
   * absent, because the asset knows its nature better than the caller: an equation
   * is exact because a wobbled integral sign is a different integral sign, and a
   * hillside is roughened because that is the whole look. `library.json` states it
   * per asset; this field is for drawing the same symbol the other way.
   */
  ink?: 'crisp' | 'sketch';
};
```

An `Asset` carries one as `Asset.ref`. The elements still reference an entity by
`assetId` rather than embedding a `source`, so "resolve once, reuse by id" is unchanged —
the reference says _which curated drawing this entity is_.

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

**As built** (step 2): the mode is `DrawContext.ink` on the visuals geometry contract,
defaulting to `sketch`, and it is applied in exactly one place — `baseOptions` in
`geometry.ts`, which zeroes roughjs's perturbation and pins its seed. So every lane
that draws through that contract is crisp-capable without knowing the mode exists.

**Corrected in step 3:** "used verbatim" was only nearly true. roughjs at zero roughness
keeps every control point but re-emits the result one subpath _per segment_, inserting a
`moveto` before each curve and dropping the `Z` that closed the contour. On a stroked
line that is invisible — each `moveto` lands where the last segment ended. On a _filled_
one it is fatal: a glyph outline becomes forty open curves with no contour left to fill,
and the letter renders hollow, which is exactly how the equation lane first came out. So
`roughenPathData` now bypasses roughjs entirely when the mode is crisp and takes our own
precision round-trip instead, which preserves subpaths and closes. Crisp plot curves got
shorter as a side effect — one subpath of 240 segments where there were 240 subpaths of
one.

**Wired in step 4:** `AssetRef.ink` is now real and threads through to `DrawContext.ink`,
with `library.json` supplying the default per asset. The shipped cast exercises both in one
frame — the figures are `sketch`, `symbols/physics/*` are `crisp`.

Two things are deliberately still open. `resolvePlot` decides the mode for plots itself:
a plot is not a library asset, so there is no reference to read it from, and the
caller-supplied mode still wins where given. And the renderer's own freehand lane
(`sketchAlong`, for `path` elements and frames) is untouched and therefore implicitly
`sketch`; it has no crisp form and does not want one, since nothing quantitative is drawn
through it.

## The asset library

Curated primitives live in the repo and are reviewed like code. Generated variants are
cached per machine and never committed.

**A version is a filename**, `<path>.v<N>.svg`, and `library.json` registers only which
one is newest. A pinned version that is not on disk is not a pin, so the files are the
truth; the manifest carries what the geometry cannot say about itself. `✅` marks what
step 4 shipped.

```
assets/library/
  library.json                    # register: path -> { version, ink, license, provenance, match }  ✅
  README.md                       # the authoring rules, in the directory they apply to  ✅
  figures/                        # the no-key cast  ✅
    standing.v1.svg  walking.v1.svg  pointing.v1.svg  sitting.v1.svg
  symbols/
    physics/  force-vector.v1.svg  mass.v1.svg  ✅   ray.v1.svg
    circuit/  resistor.v1.svg  capacitor.v1.svg  battery.v1.svg
    math/     brace.v1.svg  axis-arrow.v1.svg
  characters/                     # step 5, not step 4
    odysseus/
      character.json              # the rig
      base.svg
      poses/
        standing.svg  walking.svg  pointing.svg
  icons/                          # curated overrides only
```

`lucide-static` stays where it is — a ~2000-icon _fallback provider_, not the library.
The library is the things we chose; lucide is the things we settle for.

`packages/visuals/src/library.ts` carries the authoring rules in full. The one with
teeth: **document order is draw order**, because the writer reveals items in the order it
receives them, so a figure is authored the way a person draws one. That ordering is most of
why a curated asset reads better than a traced one, and it is invisible in a static SVG.

**Shipped** (step 5, composed half). `packages/visuals/src/character.ts` is the source of
truth. Filed as `characters/<id>.v<N>.json` rather than `characters/<id>/character.json`,
which keeps the library's one version rule (`<path>.v<N>.<ext>`) and drops a directory: the
parts _are_ path data, so the rig file is the geometry and a companion `base.svg` would be a
second source of truth for the same drawing.

```ts
/** characters/<id>.v<N>.json */
type CharacterRig = {
  id: string;
  version: number;
  /** Locked, so a regenerated variant is pixel-identical. Overrides the asset's seed. */
  seed: number;
  /** The canonical description every variant is conditioned on. */
  look: string;
  /** NEW, and load-bearing: fixed for every pose, or the character changes size. */
  viewBox: [number, number, number, number];
  /**
   * Named parts with pivots.
   *
   * Poses are *composed* from these where the pose is a limb rotation, and only
   * generated when it is not. Composition is free, instant and exactly consistent;
   * generation is none of those, so it is the fallback rather than the mechanism.
   *
   * `parent` is NEW: a chain is what lets a knee bend, which is what puts a seated pose
   * inside composition's reach instead of outside it.
   */
  parts: {
    id: string;
    d: string;
    pivot: [number, number];
    parent?: string;
    fill?: string;
    weight?: StrokeWeight;
  }[];
  poses: Record<
    string,
    {
      compose?: Record<string, number>; // part id -> degrees clockwise
      hide?: string[]; // NEW. The far leg, in a pose where it would read as tangle.
      generated?: boolean;
      /** NEW. The composed pose to draw when generation is unavailable or rejected. */
      fallback?: string;
    }
  >;
};
```

**Identity across poses** is the gate. A generated variant is conditioned on the
base _raster_ (image-to-image, not prompt repetition, which does not work), cached
under `~/.inkcast/cache/characters/<id>/<pose>-<seed>.svg`, and accepted only if an embedding
similarity check against the base passes. A failed check retries once and then falls
back to a composed pose. Silently shipping a character with a different face is worse
than shipping a stiffer one.

**As built** (step 5): the cache, the one retry and the fallback are real and tested; the
_embedding_ check is not, and `plausibilityGate` stands in for it as an explicitly-named
floor. The cache stores **geometry, not a rendering**, so the ink style, palette and stroke
weight can all change afterwards without paying a provider again — what was expensive was
deciding what the pose looks like. Only an accepted candidate is ever written, which is what
makes the cache-hit branch safe to trust without re-running the gate.

One consequence of caching per machine while pinning per storyboard: a project resolved
against a cold cache draws the composed fallback and keeps drawing it, because its asset key
does not depend on machine state — and deliberately should not. Re-resolving is the deliberate
act that picks up a warmed cache, exactly as it is for a bumped asset version.

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

**2. Two ink modes.** ✅ **DONE.** `ink: 'crisp' | 'sketch'` on the geometry contract;
plots become crisp. _Done when:_ a crisp plot's `d` contains no perturbation and a
sketch path is byte-identical to today. Both verified by resolving the visuals lane over
`projects/final-169` and `projects/handwritten` either side of a stash and hashing each
element's path data: all 8 plots moved, and all 45 non-plot elements — 19 paths, 16
texts, 3 arrows, 2 diagrams, 2 assets, 2 emphasis marks, 1 shape — came back
byte-identical. "No perturbation" is pinned in tests as _exactness_ (a crisp axis is dead
straight, a crisp path returns verbatim) plus _seed-independence_, which is the property
a wobble cannot fake.

**3. The equation lane.** ✅ **DONE.** New `equation` element; TeX -> SVG -> glyph path
extraction -> crisp reveal. _Done when:_ `w \leftarrow 3 - 0.1 \times 4 = 2.6` renders as
real glyphs and reveals left to right — verified in a frame grab of the benchmark's
worked beat, where it is now the update line above the plot. _Replaces:_
arithmetic-as-text: `updateLine` emits TeX and the compiler emits an `equation`, so the
benchmark has **zero** remaining Unicode-arithmetic text elements.

**The typesetter is MathJax, not KaTeX** — a deliberate departure. KaTeX has no SVG
output: it emits `<span>`s positioned by CSS, so extracting geometry from it means
running a CSS engine or reimplementing KaTeX's layout against its internal tree. MathJax
emits glyph outlines already placed, in pure Node, with no browser and no font files. The
goal here was real glyphs as exact vector; the engine was a means.

Two things fell out of it. Glyphs are _filled_ outlines, so the reveal is one prim per
glyph in left-to-right order rather than one per stroke — the page already gives each
part of an item a slice of the timeline in order, so the ordering _is_ the animation and
the renderer needed no new capability. And this is the **first geometry the renderer
reads from `visuals.json`** rather than recomputing: an equation has no camera-dependent
unit (unlike a plot, whose caption size is its unit of measurement), and typesetting is
an async import that `compilePlan` could not perform anyway.

**4. Library skeleton.** ✅ **DONE.** `library.json`, `AssetRef`, the resolution order
(library -> cache -> generate -> lucide), and the hand-authored `figures/` cast —
standing, walking, pointing, sitting, plus `symbols/physics/{force-vector,mass}` to prove
the path namespace goes deeper than one folder. _Done when:_ an asset resolves by path and
version with no network — `an asset resolves by path and version with no network` in
`visuals/test/library.test.ts`, which forces `images: 'off'` and asserts the _library_
lane won rather than that something was drawn.

Three decisions inside it are worth knowing before extending it.

**A version is a filename, not a manifest field.** `figures/standing.v1.svg`, and
`library.json` records only which version is newest. The point of `AssetRef.version` is
that improving an asset cannot change a finished video, and a version that is not on disk
cannot be pinned — so the files are the truth and the manifest is a _register_ (ink mode,
licence, provenance, and the nouns that should resolve to each path). This deviates from
the directory sketch above, which showed unversioned filenames; the sketch was written
before the pinning requirement had anywhere to live.

**A reference arrives unpinned and leaves pinned.** `AssetRef.version` is optional going
in: absent, it resolves to the newest the library has, and the visuals stage writes back
the number it used. So authoring stays easy while a resolved storyboard is exact, and
re-resolving to a newer asset becomes a deliberate act rather than a side effect of the
library moving on. `AssetRef.ink` is optional for the same kind of reason — the asset
knows its own nature (a force vector is `crisp`, a figure is `sketch`), so the manifest
states it once and a reference only says so to override.

**The no-key character gap closes through _matching_, not through references.** The
planner mints `hiker` with a prompt and no idea the library exists, so an unreferenced
entity is looked up by id and then by whole prompt tokens against each entry's `match`
list. Narrow lists on purpose: an over-reaching alias hijacks an entity that had a better
lane, and a confidently wrong figure is worse than the generic icon it replaced — which is
why `the library does not hijack entities the icon lane draws better` pins `cpu`, `ram`,
`database`, `brain` and friends to lucide.

Two smaller things fell out. The illustration lane's raster cache became machine-wide
(`~/.inkcast/cache/illustrations/`, checked after the project's own copy), which is what
turns "one generation per film" into "one per subject" and is the half of _nothing
compounds_ that the library alone does not fix. And the sketch and crisp modes take a fill
by different routes: crisp output _is_ the authored contour so a fill can be set on it
afterwards, while roughjs returns the wobbly stroke it drew, so it has to be asked for the
fill up front and hachure the region itself. Setting a fill on sketch output post hoc fills
the outline of a pen line — the first render of the cast came out with ringed heads and
nothing inside them.

**5. Character rigs.** 🟡 **THE COMPOSED HALF IS DONE; THE GENERATED HALF IS NOT.**
`character.json`, composed poses, generated-variant cache, similarity gate. _Done when:_ the
same character across three beats is pixel-identical where composed and above threshold
where generated.

**The first half of that bar is met and pinned.** `the same character composes identically
across poses` (`visuals/test/character.test.ts`) draws standing, walking and pointing and
asserts the head and torso are the _same bytes_ in all three — not similar, identical — while
also asserting the poses genuinely differ, so it cannot pass by drawing one picture three
times. `assets/library/characters/explorer.v1.json` is the rig: ten parts, four composed
poses, one generated one.

**The second half cannot be verified on this machine and is not claimed.** See "What is left
of step 5" below.

Three things identity turned out to depend on, none of them obvious, all of them silent when
wrong:

1. **The rig declares its own `viewBox` and every pose is fitted through it.** Measure the
   source box from the composed parts instead and a raised arm widens it, so every pose lands
   on a different `fitMatrix` and the head comes out a slightly different size in each beat.
   Nothing looks broken; the character just stops being the same size. `loadRig` refuses a rig
   without one.
2. **A part's ink seed is a function of the rig and the part id, and of nothing else.** Not
   its index, which is what a loop hands you: a pose that hides the far leg shifts every later
   part by one and the whole body re-wobbles. Per-part seeds mean a pose can hide, add or
   reorder parts and everything it did not touch is byte-identical.
3. **The rig's `seed` overrides the asset's.** One character in three beats is three `Asset`
   entries, because resolution is per id — so seeding from the asset id gives the same face
   three different wobbles, which is exactly the failure this document calls worse than
   shipping a stiffer character.

Two design choices worth knowing before extending it.

**Parts form a chain, so composition reaches further than expected.** `RigPart.parent` means
rotating a thigh carries its shin and foot, and the shin's angle is relative to the thigh. That
is fifteen lines and it moves a _seated_ pose from "impossible to compose" to "four numbers",
which matters because it keeps generation as the fallback rather than the mechanism — the
property this document says composition has and generation lacks.

**Rigs are authored in profile, facing right.** A 2D rig can only rotate about pivots, and
limb rotation is only meaningful in the view where limbs swing; front-on, the same rotations
give arm gestures and nothing else. `AssetElement.flipX` already exists to face left.

### What is left of step 5

**No image-to-image adapter ships.** `PoseGenerator` is the seam and it is injected, so the
cache, the gate, the retry and the fallback are all real and tested against a stub — but
nothing in the repo calls a provider for a pose. The reason is the standard `image.ts` already
sets for itself: its request shapes were checked against the live provider schemas rather than
recalled, and with no key on this machine an i2i request shape would be a guess shipped as
fact.

**The identity gate is a floor, not the gate.** `plausibilityGate` compares how much ink there
is and how the whole thing is proportioned, both scale-free. It rejects a vectoriser that
returned mush; it will happily accept a different person's face. The embedding similarity this
document specifies needs a model this package cannot run offline, and `PoseGate` is where it
arrives. Until it does, a generated pose is not trustworthy enough to be worth a key, which is
why the shipped rig composes all four of its useful poses and marks only `thinking` as
generated — a pose that falls back to `standing` and says so in the manifest.

So the honest state: **a character can hold identity across poses today, with no key, and
cannot yet be posed in a way composition cannot describe.**

### 5b. The pedagogy can address the library ✅ **DONE**

Steps 4 and 5 built a library and a rig that nothing upstream could ask for. Three findings,
each measured against the compiler rather than argued:

**The planner held a second, earlier copy of the asset router, and it won.** `buildAsset`
called `matchIcons` and minted the asset with the **lucide slug as its id and lucide's prompt
as its prompt**, throwing away what the beat described. The visuals stage's lane order then ran
against evidence already destroyed. Measured, before the fix:

    describe                                    planner minted    library then saw
    "a hiker walking downhill in thick fog"     (description)     figures/walking
    "a lone explorer crossing a desert"         (description)     characters/explorer
    "a person standing at the edge of a cliff"  icon: id=user     figures/standing  (by luck)
    "Odysseus tied to the mast of his ship"     icon: id=rocket   NOTHING

The last row shipped as **Odysseus draws a rocket**. The `user` row only worked because
lucide's substitute prompt happened to contain the word "person". After the fix all four keep
their description; the first three route to the right drawing on the library lane by real
match, and Odysseus reaches the generator with its own prompt intact.

**The fix is to delete the pre-resolution, not to patch the matcher.** `resolveAsset` is a
superset of what was here — its lane 3 runs the same lucide match on the id and the prompt — so
nothing that used to resolve stopped resolving; it just stops jumping the queue in front of the
library. Same shape as step 1's dead plot solver, and the third instance of root cause 1's
pattern. `heuristic.ts` still calls `matchIcons` and should: it decorates a _document_ beat
where there is no described subject to preserve, and lucide picking something apt is the whole
intent.

**No pose could be requested, so step 5 bought nothing in a real run.** `VisualIntent` gained
`character?: { id, pose? }`, `Lesson` gained `cast`, and the compiler mints
`ref: { path: 'characters/<id>', variant: pose }` — unpinned, because resolution pins on the
way out. The pose is explicit or absent, never inferred from the beat's verb: that is the guess
step 6 removed for the analogy and it fails the same way.

**`kind: 'narrative'` was accepted, prompted for, and read by nothing.** It now has two
consequences in `critiqueLesson`: a narrative lesson with no cast is rejected, and a
`character.id` that names nobody in the cast is rejected — the same class as a `derivedFrom`
naming no beat.

_Done when:_ a narrative lesson renders one character across three beats in three different
poses, with no key. `examples/lessons/longitude.lesson.json` is that lesson; it draws the
explorer standing, walking, pointing and sitting, all four `how: 'composed'`, and renders end
to end through `cast` at `cost $0.00`. Pinned by `pipeline/test/cast.test.ts`, which asserts on
what the board would draw rather than on a unit — including that the four poses are _different
geometry_, since the failure mode being fixed was four identical `standing` figures that looked
entirely deliberate.

**One duplication was introduced deliberately, and pinned.** The model has to be told which
poses exist, and `@inkcast/planner` cannot read the library — it does not depend on
`@inkcast/visuals` and should not start. So `CAST_POSES` in `lesson-anthropic.ts` is a copy of
what the rigs declare. Two catalogues of one fact is the shape that already went wrong for
`doubleWell`, so a test in `pipeline` — the package that sees both — fails if they disagree.

**6. Lesson schema v2.** ✅ **DONE.** `kind`, `strategy`, `coreInsight`, `analogy.maps`,
`from`/`derivedFrom` with the no-`asserted` validator for first-principles. The morph is
derived from `analogy.maps` and `BECOMES_A_PLOT` is deleted. _Done when:_ the shipped
lesson still morphs — verified byte-identical storyboards, both aspects — and a lesson
with the same mapping but different wording also morphs, which is
`the same mapping in different words still morphs` in `planner/test/compile.test.ts`.

**7. The script stage.** ✅ **DONE**, as fields on the lesson beat rather than as a
seventh pipeline stage. `cadence` drives both the TTS rate and `hold`; `emphasis` drives
voice and board weight. _Done when:_ a punchy beat is measurably faster and holds shorter
than a slow_deliberate one — measured on real Kokoro audio over identical words:
**160.7 / 151.7 / 142.0 wpm** for punchy / building_energy / slow_deliberate, a 1.13x
spread, with holds capped at 0.8s / 1.6s / 3.0s respectively.

**Why not a separate stage.** The sketch above splits `script` out of `lesson` so that
"rewriting the words is the most common edit and should not require re-planning the
pedagogy". That rationale is already served: `editLesson` handles pacing, silence, dropped
beats and reordering mechanically with no key, and the keyed path patches the lesson under
its original teaching brief. Moving `narration` into a new artefact would migrate every
saved `lesson.json`, the model prompt, `critiqueLesson`, `adaptLesson` and the presets, to
buy an editing property the repository already has. The _valuable_ half of step 7 is not
the stage boundary — it is that pacing stops being two decisions.

And it was two. An author set `hold` freely in the lesson; the voice stage spoke the whole
video at one global `targetWpm`. Nothing connected them and nothing could notice they were
fighting, so a beat written as a quick aside could be followed by two seconds of silence.
`cadence` is now the single source: it sets the speech rate _and_ supplies the baseline and
the **ceiling** for the silence. The ceiling is what makes it a guarantee rather than a
convention — a `punchy` beat asking for three seconds gets 0.8.

Three things worth knowing before extending it.

**`CADENCE` lives in `@inkcast/core`, and must.** `@inkcast/planner` reads it for `hold` and
`@inkcast/voice` reads it for the rate; both depend on core and neither may own a copy. This
is the same fact read by two stages, which is exactly the case the `doubleWell` split is the
counterexample to.

**Every cadence stays inside the 140–160 wpm teaching band.** The three rates are 0.933, 1.0
and 1.067 against the 150 target, landing on 140/150/160. A first cut used 0.88–1.12 and put
the _body_ of a lesson at 168 wpm — the pacing feature quietly breaking the pacing rule the
repository set when it moved off the MVP's 193.

**Cadence is derived when absent, not defaulted.** `cadenceFor` reads it off the beat: a
question is `slow_deliberate` because the silence afterwards is the point, a worked example
and a misconception are slow because both have to be followed, a hook is `punchy`, a beat
under sixteen words is an aside, everything else builds. A flat default would have left the
field dead weight on every existing lesson and on the whole no-key path. One rule was tried
and removed: _short sentences are punchy_ fired on nearly every beat of both shipped lessons,
because 5–9 words a sentence is simply what good spoken teaching looks like — it measured
whether the narration was well written, not how the beat should be delivered.

**Emphasis is time, not volume.** No local voice this pipeline runs accepts SSML — Kokoro
takes a speed and nothing else — so a phrase carrying emphasis is slowed slightly and given a
longer beat after it, which is what a person actually does. On the board the same words are
drawn one step up the type scale, and only where they actually appear: emphasis names phrases
of the _narration_, most of which is never written down.

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
