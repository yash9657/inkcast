/**
 * Cache keys, and the code versions baked into them.
 *
 * ## Why a code version is part of every key
 *
 * A stage's artefact is a function of its inputs *and of the code that produced
 * it*. The MVP only hashed the inputs, and it bit us exactly as you would expect:
 * a planner fix landed, every existing project's `storyboard.json` was still
 * "fresh" against an unchanged document, so the cache kept serving the output of
 * the old code and the fix looked like it had not worked. Nobody suspects the
 * cache; everybody re-reads the diff.
 *
 * So every key here starts with `pipeline@N` plus a per-stage version. Bump the
 * stage version whenever that stage would produce a *different* artefact for
 * identical inputs. It costs one recompute for existing projects, which is
 * strictly better than shipping a fix nobody can see.
 *
 * Where a stage package publishes its own version constant (`LESSON_VERSION`,
 * `COMPILER_VERSION`, `PLANNER_VERSION`, and the renderer's internal
 * `RENDER_VERSION`) that number is mixed in too, so a change inside the package
 * invalidates projects without anyone having to remember to edit this file.
 */

import { hash, styleKey } from '@inkcast/core';
import type { BoardMode, Element, Scene, Storyboard, StoryboardMeta } from '@inkcast/core';
import type { StageName } from './progress.js';

/**
 * Orchestration version. Bump when the *shape* of the run changes — a new stage,
 * a different order, a different artefact layout — which invalidates everything.
 *
 * 2: `ingest -> lesson -> storyboard -> voice -> visuals -> render`, with the
 *    lesson persisted as `lesson.json` and voice moved ahead of visuals so cues
 *    resolve before anything is drawn.
 */
export const PIPELINE_VERSION = 2;

/**
 * Per-stage code version. Bump the one stage you changed.
 *
 * - ingest 1: original.
 * - lesson 2: schema v2 — `kind`, `strategy`, `coreInsight`, `analogy.maps` and
 *   per-beat `from`/`derivedFrom`, so the same topic yields a different lesson.
 * - lesson 3: every beat names the vocabulary it introduces (`terms`). The derived
 *   author fills it from the narration and the model is briefed to, so the same document
 *   yields a lesson with words on it that the previous one only said out loud. The
 *   derived author also stopped captioning several beats with one section heading, so its
 *   `idea` fields moved as well.
 * - lesson 6: the teaching brief describes the `illustration` lane, and only when an image
 *   provider is configured. It listed the kinds "the compiler recognises" and omitted the
 *   one that calls a generator, so a keyed render asked for an `icon` for every concrete
 *   object — and the icon lane never generates anything. The same document therefore yields
 *   a different lesson depending on whether a key is present, which is the point.
 * - voice 5: the pause after a sentence is graduated by the length of the sentence — five
 *   lengths where there was one — so any narration is assembled differently. Measured on
 *   the same lesson it spends 8.4s of silence across five lengths where the flat 0.24s rule
 *   spent 8.8s across one.
 * - storyboard 9 / voice 4: one picture is one gesture. Every stroke of a visual intent
 *   carries the intent's own cue unless it claimed a word of its own, and the voice stage
 *   spreads strokes that resolved to the same instant by a tenth of a second in drawing
 *   order — so a hillside, its fog and the figure on it arrive as one action on the words
 *   that name them, instead of nine strokes scattered across the beat by a guessed cue.
 *   Both move because the timing is decided by the pair: the compiler says which strokes
 *   belong together, the voice stage says when.
 * - lesson 5 / storyboard 8: `derivedFrom` is binding. The trimmer may only drop a beat no
 *   surviving beat derives from, so a lesson is never rewired to make an incoherent cut
 *   validate; the length estimate is calibrated to what a render actually delivers (2.2
 *   words a second, not the 2.5 target) and counts the outro; and the standard target rises
 *   to 150s, which is what both shipped lessons honestly need. `lesson` moves with it
 *   because the teaching brief now states the budget in *words* — a number the model can
 *   count — so the same document yields a different lesson.
 * - lesson 4 / storyboard 7: a plot has to be about a quantity that varies, not about a
 *   passage that happened to contain a shape keyword — so the derived author stops asking
 *   for axes where there is nothing to measure, and the compiler stops drawing the
 *   fallback parabola for an intent that describes no plot. Both stages move because the
 *   decision is made twice, once per side of the seam: the author choosing whether to ask
 *   for a plot, and the compiler deciding what to do when it is asked for one anyway.
 *   Both shipped lessons compile byte-identically (`sbhash`, both presets) — every plot
 *   they ask for names its own curve.
 * - storyboard 2: where the abstraction arrives is derived from `analogy.maps` rather
 *   than matched in the narration, so the same lesson can compile to a different board.
 * - voice 2: cue resolution, modelled silence, `Scene.hold` in the clip.
 * - voice 3: initialisms are spoken as letters ("ay tee pee", not "ATP"), so any
 *   narration containing one is a different clip. Heard rather than deduced: the
 *   narrator mumbled ATP as a syllable and, because the board never writes the letters
 *   either, a listener had no way to recover the word.
 * - visuals 3: a descent is recorded as one sub-part per hop, labels are charged for
 *   the ink they would lie across, and a curve named after its own axis is no longer
 *   captioned twice.
 * - render 3: plot geometry comes from the visuals stage rather than a second
 *   implementation inside the renderer, so every plot's gutters, ticks, sampling and
 *   label placement change.
 * - visuals 4 / render 4: plots draw in the `crisp` ink mode, so every stroke in
 *   every plot — axes, ticks, curves, overlays — has different path data. Both
 *   stages move together because both resolve plot geometry: the sidecar the visuals
 *   stage writes and the geometry the renderer asks `resolvePlot` for are the same
 *   drawing, and a project holding one at v3 and the other at v4 would be
 *   inconsistent about which it believed.
 * - storyboard 3: a worked example's update line is an `equation` element carrying TeX
 *   instead of a `text` element carrying Unicode, so the same lesson compiles to a
 *   different board.
 * - visuals 5 / render 5: the equation lane typesets that TeX to glyph outlines, and
 *   crisp path data is now genuinely verbatim rather than re-emitted one subpath per
 *   segment — which changes every crisp plot's path data as well as adding equations.
 *   Together they are the first geometry the renderer reads from the sidecar rather
 *   than recomputing, so again the two stages have to move as one.
 * - visuals 6: the curated asset library resolves ahead of the illustration and icon
 *   lanes, so an entity whose id or prompt matches a library path is a different
 *   drawing than it was — a figure instead of a lucide glyph or a lettered card.
 *   Render is *not* bumped with it: the renderer inlines an asset's SVG file rather
 *   than re-deriving its geometry, so nothing in `render/` changed behaviour.
 * - visuals 7: plot geometry is resolved at the size the *renderer* draws it — the
 *   board's pen weight and type sizes from `boardMetrics` — rather than at a fraction
 *   of the whole canvas. Every plot's recorded path data therefore moved. This is the
 *   change that let the renderer stop resolving plots a second time, so `render` is
 *   again not bumped: it produces byte-identical output from a freshly resolved
 *   sidecar (verified on `projects/final-169`, all 39 items unchanged), and it is
 *   invalidated anyway because `renderFingerprint` now folds in `visualsFingerprint`.
 *   That fold is load-bearing rather than belt-and-braces: the sidecar became a real
 *   input to the render here, and an input outside the key is this file's whole
 *   cautionary tale.
 *
 * - lesson 7 / storyboard 10: the `path` lane tells the truth about itself, on both sides
 *   of the seam. The brief now states that freeform ink can draw exactly six shapes and
 *   nothing else, so a keyed lesson asks for an `illustration` where it used to ask for
 *   ink; and the compiler stops answering every unmatched instruction with a hillside,
 *   routing it to the lane that can draw the thing instead. Both move because both sides
 *   of one decision moved: what an author is told the lane can do, and what the lane does
 *   when asked for something else. `gradient-descent` compiles byte-identically at both
 *   presets — every path intent it has really is one of the six — and `longitude`'s ship
 *   stops being a hillside.
 *
 * - lesson 8 / storyboard 11: the drawing lane. A `draw` intent carries the picture itself
 *   — every mark, placed by the drawing author — so a keyed lesson is a different file for
 *   the same document, and the compiler turns those marks into ordinary elements, which is
 *   a different board for the same lesson. The text zone above a drawn picture also
 *   shrinks from 40% of the cell to 26%, because a drawing that labels its own parts needs
 *   less caption above it. Neither shipped lesson has a `draw` intent, so both compile
 *   byte-identically at both presets.
 *
 * - lesson 9 / storyboard 14 / visuals 8: the hybrid drawing lane. A `draw` intent may
 *   carry an `underlay` — a generated picture of a real object — and its marks are then
 *   composed by an author that has *looked at* that picture, so the same document yields a
 *   different lesson and a different set of marks. The compiler emits the picture as an
 *   asset element ahead of the marks and fits both through one transform instead of fitting
 *   the marks by their own content bounds, so a beat carrying an underlay is a different
 *   board. `visuals` moves for two reasons of its own, and either alone would justify it:
 *   a traced illustration's paths now honour the `transform="translate(...)"` the
 *   vectoriser writes on each one — they were all being stacked at a shared origin, which
 *   put the small interior details of every generated picture in a smudge — and an asset
 *   may ask to meet its box exactly rather than with the usual 4% of breathing room.
 *   Neither shipped lesson has a `draw` intent, let alone an underlay, so both still
 *   compile byte-identically; every project with a generated illustration in it re-resolves,
 *   which is the point of the bump.
 *
 * Character rigs (step 5) deliberately did **not** bump anything, and the reasoning is
 * worth keeping because the rule above looks like it demands one. The test is whether the
 * stage produces a different artefact *for identical inputs*, and it does not: no existing
 * asset's geometry moved (the `projects/handwritten` geometry hashes are byte-identical
 * across the change), and an asset that newly resolves to a rig is one whose
 * `libraryFingerprint` went from empty to a real path — so it invalidates itself, precisely,
 * without dragging every other project through a recompute. A global bump is for when you
 * cannot tell which assets moved. Here you can.
 */
export const STAGE_CODE_VERSION: Record<StageName, number> = {
  ingest: 1,
  // 10: the underlay advice moved into the `draw` bullet, where the lane is actually
  // chosen, and leads with the case rather than with the exclusions. At 9 it sat after the
  // lane list and ended "if you are unsure, leave it out", and a keyed render of the
  // cardiac conduction system — the lesson the lane was built for, image key configured —
  // came back with twelve `draw` intents and not one underlay.
  // 11: `underlay` now carries a `kind`, and the brief makes the author choose between
  // `form` (the object's shape, traced, with marks carrying the mechanism) and `figure`
  // (the whole teaching diagram in colour, shown as a raster and never traced). The brief
  // is not in this stage's cache key, so without this bump the new advice is invisible and
  // every cached lesson keeps the old one-lane answer.
  // 12: script economy, and the third attempt at making the author ask for a picture.
  // Two changes to the brief, and both of them move the lesson for identical inputs.
  //   The budget is now three numbers instead of one: the total in words, the beat count,
  //   and what the trimmer does with the overflow — stated as its own block rather than as
  //   one clause inside the narration list. The measurement it answers is the whole of
  //   PLAN-GOLPO-PARITY Phase 3: on the same lesson, 348 words against a competitor's
  //   ~145, a 174s film against 59.5s, at a speaking rate that was never wrong (142-151
  //   wpm). A budget stated once, in the middle of a long brief, read as a limit nobody
  //   was near. It also reads the preset now, so a run at `explainer` is briefed for 165
  //   words across 8 beats where `standard` is briefed for 330 across 14 — the same brief
  //   could not say both, and one number for every format is how a 60s cut got written to
  //   a 150s budget.
  //   The underlay advice moved *within* the `draw` bullet, from its end to its opening.
  //   Read the note above `UNDERLAY_LEAD` for why position was the defect: at 10 the block
  //   was already inside the bullet, but the bullet opens by promising "it can draw
  //   anything: a battery cut open, a chloroplast…", so the brief made the claim and then
  //   took it back sixty words later. The first answer is the one a model keeps. The fork
  //   is now the first sentence of the bullet and the promise is narrowed to what marks can
  //   honestly do, which is a different edit from either previous attempt rather than the
  //   same one said louder — those are recorded at 10 and 11 above precisely so this one
  //   had to be different.
  // Also: the `explainer` preset exists (`planner/src/presets.ts`), and its `maxHold`
  // caps what a beat may ask for in `trimStep`. That alone would not need a bump — a new
  // preset key invalidates only the runs that ask for it, and `presetShape.name` is
  // already inside this stage's key in `cast.ts` — but the brief edits above do, and they
  // are the same change arriving from the other end.
  lesson: 12,
  // 4: the planner stopped pre-resolving assets against lucide, so an entity's id is
  // now a slug of what the beat described rather than an icon slug — every asset id in
  // every storyboard moved, and the visuals keyed to them with it.
  // 5: every scene carries `cadence` and `emphasis`, and `hold` is now clamped by the
  // cadence rather than only by a global 3s cap. Most holds are unchanged; the ones
  // that move are beats whose cadence forbids the silence they used to get.
  // 6: a beat's `terms` are written on the board as a row along the foot of its cell,
  // which adds elements and takes that row's height off the figure area. A lesson that
  // names no terms compiles byte-identically — verified on `gradient-descent`, both
  // presets — so this bump only recomputes projects that gained ink.
  // 10: an instruction the `path` lane cannot draw is no longer approximated by terrain
  // — it goes to the illustration lane, or to a diagram when it names short parts. A
  // lesson whose path intents are all within the six shapes compiles byte-identically.
  // 11: marks compile to elements, and a beat carrying a drawing gives its words less of
  // the cell. A lesson with no marks is unaffected, both shipped ones included.
  // 12: every mark of a drawing claims the words that name it, instead of the whole
  // drawing sharing the intent's one cue — so a beat's elements carry different cues and
  // different fallback fractions. Marks may also carry a `tone`. A lesson with no marks
  // compiles byte-identically; both shipped ones verified with `sbhash`, both presets.
  // 13: a beat is a card. Its `idea` is written as a heading two steps heavier than the
  // caption it replaces, at `at: 0` before any ink, with a hand-drawn rule under it — and
  // the camera holds that one cell instead of the union of every cell drawn so far in the
  // region, so a beat four of four is no longer shown at a quarter size. Every scene's
  // camera moves and every scene gains an element, both shipped lessons included.
  // 14: a drawing may be composed on top of a generated picture. The picture is emitted
  // as an asset element before the marks, and a beat that has one fits its marks by the
  // whole authoring canvas rather than by their own bounds — one transform, or the marks
  // and the thing they annotate do not line up. A lesson with no underlay is unaffected.
  // 15: the preset carries a board mode. Under `wipe` the planner lays one
  // frame-shaped cell for every beat instead of a grid, marks every element
  // `persist: false` with an explicit `persistUntil` for the cards several beats draw
  // together, and takes the recap's 1.3s pull-back away because there is no board
  // behind its card to reveal. Core expires that ink out of the framing history to
  // match, so the camera stops widening for marks that are no longer on screen —
  // without it the planner's half changes nothing. A lesson compiled at the default
  // `accumulate` is byte-identical — both shipped lessons verified with `sbhash`, both
  // presets. `render` below is deliberately not bumped: every renderer-side change is
  // gated on `meta.board`, and `renderFingerprint` hashes the whole storyboard, so a
  // wiping board invalidates its own renders and no other project's.
  // 16: the gesture ceiling (`Preset.maxGestures`, plan item 1.5). A beat's reveals
  // are coalesced onto shared cues until it has at most ten *starts*, so a
  // twenty-six-mark diagram arrives as ten movements of the hand instead of
  // twenty-six separate decisions to begin. Only `explainer` sets a ceiling, so a
  // lesson compiled at `accumulate` is byte-identical and both shipped lessons still
  // pin (`planner/test/pinned-hashes.test.ts` runs on every `pnpm -r test`). Bumped
  // anyway, because the field is read at compile time and a cached storyboard
  // compiled before it existed carries the old fractions with nothing to say so.
  storyboard: 16,
  // 6: a clause is synthesised with the narration either side of it handed to the engine
  // as context, and the delivery settings are pinned per request rather than inherited
  // from whatever the voice has stored. Both change the audio for narration that never
  // moved. Also the first release in which the cloud provider declares a speaking rate,
  // so the stage's "140-160 wpm" correction applies to it at all — a measured render came
  // out at 185 wpm with the correction silently skipped.
  // 7: the engine chooses its own phrase split. Kokoro has no context window, so it was
  // being handed four-word clauses and rendering each one cold — hard onset, terminal fall,
  // its own pitch range — and a scene was ten of those concatenated. That is the abrupt
  // local delivery everyone had attributed to the model. Every cached clip is different
  // audio for the same words, so they all have to go.
  // 8: the clip is delivered by `eleven_flash_v2_5`, the effective model id lives
  // inside the adapter's per-scene delivery signature, and `voiceFingerprint` below
  // finally carries an engine of its own. The bump alone was not enough and it is
  // worth saying why: it moves every existing project off the old engine exactly once,
  // but a *version* cannot see `ELEVENLABS_MODEL_ID`. With the engine outside this
  // file's key, changing that variable left every scene fresh, `cast()` skipped the
  // stage on an empty stale set, and the override was ignored with nothing said. The
  // engine is now a hashed input, so the knob invalidates precisely what it changes.
  // The delivery signature is also taken from the active provider rather than imported
  // from ElevenLabs, so a local clip is no longer keyed on a cloud adapter's constant;
  // that invalidates the cached kokoro clips too, exactly once.
  // 9: the voice stage lengthens a beat so its finished board can be read before it
  // is wiped (plan item 1.3). Every clip whose scene draws anything is longer by real
  // silence, `Scene.hold` comes back changed, and the sidecar carries a new
  // `authoredHold` — which is what keeps a *second* run from re-synthesising the film
  // it just paid for, and is therefore the field this bump exists to introduce rather
  // than merely to invalidate.
  voice: 9,
  // 8: a traced illustration's paths are placed where the vectoriser said they go, and an
  // asset may ask for its box to be met exactly. See the note above.
  // 9: the figure lane. An asset of kind `figure` resolves to an `<image>` wrapper rather
  // than traced ink, and the illustration cache key now carries the image kind so a form
  // and a figure of one subject cannot serve each other's picture.
  visuals: 9,
  // The quality gate (plan 3.1) — and the one stage whose arrival deliberately did
  // *not* bump `PIPELINE_VERSION` above, though that constant's own docs say a new
  // stage invalidates everything. The test that rule states is whether a stage
  // produces a different artefact for identical inputs, and `check` produces no
  // artefact anything downstream reads: `qc.json` is a record of a verdict, the render
  // does not consume it, and no other stage's output moved by a byte. Bumping would
  // have re-run ingest, lesson, storyboard, voice, visuals and render for all 26
  // corpus projects to add a file none of them depend on. The rigs note at the foot of
  // the comment above is the same reasoning: a global bump is for when you cannot tell
  // which artefacts moved, and here nothing did.
  // 2: two board assertions became gates — `pen` (one mark drawn at a time, plan 1.2)
  // and `dwell` (a second of stillness before the wipe, plan 1.4) — and the per-text
  // dwell advisory moved to its own id, `dwell-text`. `qc.json` from an older run
  // describes a different set of checks under the same names.
  check: 2,
  // 6: the schedule. Entrance length follows the ink (`core/src/inktime.ts`) instead
  // of a flat 0.8s, and a beat's marks are given to one hand in turn
  // (`serializePen`), with reading time reserved at the end of every beat. Every item
  // in every plan has a different `start` and `dur`; nothing about *what* is drawn
  // moved. `renderFingerprint` hashes the plan, so this bump and that hash agree.
  render: 6,
};

/** The version prefix every one of a stage's cache keys carries. */
export function stageVersion(stage: StageName): string {
  return `pipeline@${PIPELINE_VERSION}/${stage}@${STAGE_CODE_VERSION[stage]}`;
}

/** `cache.json` key for a stage, optionally scoped to one item (a scene, an asset). */
export function cacheSlot(stage: StageName, item?: string): string {
  return item ? `pipeline.${stage}.${item}` : `pipeline.${stage}`;
}

/** Hash of a stage's inputs, always prefixed with that stage's code version. */
export function cacheKey(stage: StageName, ...parts: unknown[]): string {
  return hash(stageVersion(stage), ...parts);
}

/* ------------------------------------------------------- stage fingerprints */

/**
 * What the storyboard stage's output depends on.
 *
 * Here rather than inline in `cast.ts` because of `board`, which is the case this
 * file's header is about with a new name. The mode is not part of the lesson, not
 * part of `meta` and not part of the preset — it is a request the caller makes of
 * the compiler — so a key built from the lesson, the meta overrides and
 * `{preset, seconds, title}` is byte-identical for `--board wipe` and for the run
 * without it. The second command finds the first one's storyboard fresh and serves
 * it, and the flag looks like it does nothing at all.
 *
 * `board` sits *inside* the format object rather than beside it so that the default
 * key does not move: `JSON.stringify` drops an undefined value, so an `accumulate`
 * run hashes the exact bytes it hashed before this field existed and no project on
 * disk is invalidated. Only a run that asks for a mode gets a key of its own.
 */
export function storyboardKey(input: {
  /** `COMPILER_VERSION` and `PLANNER_VERSION`, already through `versionOf`. */
  compiler: number;
  planner: number;
  route: 'lesson' | 'document';
  /** The lesson's hash, or the document's on the route with no lesson. */
  source: string;
  meta: Partial<StoryboardMeta>;
  preset: string;
  seconds: number;
  title: string;
  board?: BoardMode;
  /** Who writes the storyboard on the `document` route — name and model. */
  documentPlanner?: readonly [string, string];
}): string {
  return cacheKey(
    'storyboard',
    input.compiler,
    input.planner,
    input.route,
    input.source,
    input.meta,
    { preset: input.preset, seconds: input.seconds, title: input.title, board: input.board },
    input.documentPlanner ?? '',
  );
}

/**
 * The part of a storyboard the **compiler** wrote, with every later stage's
 * in-place enrichment removed (plan item 5.5; audit A-1).
 *
 * This exists to answer one question: has `storyboard.json` been edited by hand since
 * the compiler produced it? The two-altitude IR is a deliberate trade — `lesson.json`
 * is the teaching and `storyboard.json` is the board, both persisted and both editable
 * — and the cost of it is that a lesson re-cast overwrites a storyboard edit. That is
 * allowed; being silent about it is not, which is the whole of A-1's second
 * remediation.
 *
 * A plain hash of the file cannot answer it, because three stages legitimately write
 * into the board after the compiler has gone: voice measures `durationSec`, `words` and
 * `audioPath` and resolves each cue into `enter.at`; visuals fills `Asset.svg` and pins
 * `ref.version`; `applyOverrides` stamps the run's `--title` and `--meta`. All of those
 * are excluded here, so what remains is exactly what a deterministic recompile of the
 * same lesson must reproduce byte for byte — and a difference in it is a human edit,
 * not a stage doing its job.
 *
 * Title and meta are deliberately out for the same reason: they are the caller's flags
 * on this run, not something anyone edited into the file.
 *
 * Straight `hash` rather than `cacheKey`: this is a content digest compared against
 * another digest taken in the same process, and nothing is cached on it — folding a
 * stage version in would only make two equal boards look equal for a second reason.
 */
export function compiledFingerprint(sb: Storyboard): string {
  return hash(
    'compiled-board',
    sb.canvas,
    sb.scenes.map((s) => {
      const { audioPath: _a, durationSec: _d, words: _w, elements, ...scene } = s;
      return {
        ...scene,
        elements: elements.map((el) => {
          // `enter.at` only: `duration`, `style`, `cue` and `cueWord` are all the
          // compiler's, and a hand edit to any of them is a divergence worth naming.
          const { at: _at, ...enter } = el.enter;
          return { ...el, enter };
        }),
      };
    }),
    sb.assets.map((a) => {
      const { svg: _svg, ref, ...asset } = a;
      if (!ref) return asset;
      const { version: _v, ...pinned } = ref;
      return { ...asset, ref: pinned };
    }),
  );
}

/**
 * What the voice stage's output for one scene depends on.
 *
 * `hold` is in here because the stage renders it as real silence inside the
 * clip: a beat whose pause changed from 0.4s to 1.2s has a different audio file,
 * even though not one word of narration moved.
 *
 * `engine` is in here because of the seam that decides. The clip *the stage makes* is
 * keyed on the adapter's own delivery signature, engine and all — but this key is what
 * `cast()` compares to decide whether to run the stage at all, and it could not see an
 * engine. So `ELEVENLABS_MODEL_ID` changed the recording and changed nothing the
 * pipeline looks at: every scene stayed fresh, the stale set came back empty, the
 * stage was skipped and the override was silently ignored. A knob that changes the
 * audio has to change the key that decides whether to re-record it. See `voiceEngine()`
 * in `providers.ts` for where the string comes from, and `staleVoiceScenes()` in
 * `cast.ts` for the decision itself.
 */
export function voiceFingerprint(
  scene: Pick<Scene, 'narration' | 'hold'>,
  meta: { voice: string; language: string },
  provider: string,
  engine: string,
): string {
  return cacheKey(
    'voice',
    scene.narration,
    scene.hold,
    meta.voice,
    meta.language,
    provider,
    engine,
  );
}

/**
 * What one asset's artwork depends on.
 *
 * `ref` is in here because it *chooses the lane*: a reference resolves to a curated
 * drawing and its absence resolves to a generated or matched one, so two assets
 * identical in every other field are different pictures. The pinned version matters
 * for the same reason in reverse — re-pointing a storyboard from v1 to v2 changes
 * nothing else about it, and if that did not invalidate, the improvement would never
 * appear.
 */
export function assetFingerprint(
  asset: {
    kind: string;
    prompt?: string;
    seed?: number;
    ref?: { path: string; version?: number; variant?: string; ink?: string };
    fit?: string;
  },
  meta: { style: string; palette: string },
  provider: string,
): string {
  return cacheKey(
    'visuals',
    asset.kind,
    asset.prompt ?? '',
    asset.seed ?? 0,
    asset.ref ?? '',
    // `fit` decides where inside its box the artwork lands, so two assets identical in
    // every other field are two different drawings on the board.
    asset.fit ?? '',
    meta.style,
    meta.palette,
    provider,
  );
}

/**
 * The geometry-bearing part of an element.
 *
 * Timing is deliberately excluded. The voice stage rewrites `enter.at` on every
 * scene it re-narrates, and if that were part of the fingerprint then changing
 * one word of narration would redraw every stroke in the video for no visual
 * difference. `enter.style` stays, because `draw` and `write` are resolved
 * differently.
 */
export function elementFingerprint(el: Element): unknown {
  const { enter, ...rest } = el as Element & { enter?: { style?: string } };
  return { ...rest, revealStyle: enter?.style ?? 'draw' };
}

/**
 * What the visuals stage's output depends on: every element's geometry, the
 * asset library, and the ink style.
 *
 * The MVP hashed only `diagram` elements, which was already too narrow and is
 * badly wrong now that a `plot` or a `path` carries the entire explanation — an
 * edited curve would have kept its old drawing forever.
 */
export function visualsFingerprint(sb: Storyboard): string {
  return cacheKey(
    'visuals',
    sb.scenes.map((s) => s.elements.map(elementFingerprint)),
    // `ref` for the reason `assetFingerprint` explains: it decides which lane draws
    // the entity, and which version of the curated drawing that lane uses.
    sb.assets.map((a) => [a.id, a.kind, a.prompt ?? '', a.seed ?? 0, a.ref ?? '', a.fit ?? '']),
    // `styleKey`, not `meta.style` (plan 7.3): the name identified the ink only while the
    // numbers behind it were compiled in. A style is a JSON file now, so the key carries
    // the name *and* the digest of what the name currently means — an edited
    // `styles/marker.json` re-resolves the geometry instead of serving yesterday's ink.
    styleKey(sb.meta.style),
    sb.meta.palette,
    sb.meta.aspect,
    sb.canvas,
  );
}

/** The render depends on the finished storyboard, timings and all. */
export function renderFingerprint(sb: Storyboard): string {
  // The visuals fingerprint is folded in because the renderer now *reads* plot and
  // equation geometry from `assets/visuals.json` rather than deriving it. That makes
  // the sidecar a real input to the render, and an input that does not appear in the
  // key is exactly the failure this file's header is about: a visuals change that
  // leaves the storyboard untouched would otherwise keep serving the old video.
  //
  // It carries the visuals *stage version* too, so bumping that invalidates renders as
  // well — which is what makes "bump the stage you changed" remain sufficient advice.
  return cacheKey('render', sb, visualsFingerprint(sb));
}
