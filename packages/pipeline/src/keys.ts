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
 * - storyboard 2: where the abstraction arrives is derived from `analogy.maps` rather
 *   than matched in the narration, so the same lesson can compile to a different board.
 * - voice 2: cue resolution, modelled silence, `Scene.hold` in the clip.
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
 */
export const STAGE_CODE_VERSION: Record<StageName, number> = {
  ingest: 1,
  lesson: 2,
  storyboard: 3,
  voice: 2,
  visuals: 6,
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
  return cacheKey('render', sb);
}
