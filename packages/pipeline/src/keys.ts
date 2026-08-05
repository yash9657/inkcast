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

import { hash } from '@inkcast/core';
import type { Element, Scene, Storyboard } from '@inkcast/core';
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
  lesson: 8,
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
  storyboard: 11,
  voice: 5,
  visuals: 7,
  render: 5,
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
 * What the voice stage's output for one scene depends on.
 *
 * `hold` is in here because the stage renders it as real silence inside the
 * clip: a beat whose pause changed from 0.4s to 1.2s has a different audio file,
 * even though not one word of narration moved.
 */
export function voiceFingerprint(
  scene: Pick<Scene, 'narration' | 'hold'>,
  meta: { voice: string; language: string },
  provider: string,
): string {
  return cacheKey('voice', scene.narration, scene.hold, meta.voice, meta.language, provider);
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
    sb.assets.map((a) => [a.id, a.kind, a.prompt ?? '', a.seed ?? 0, a.ref ?? '']),
    sb.meta.style,
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
