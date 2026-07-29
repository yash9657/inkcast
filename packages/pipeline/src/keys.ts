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
 * - lesson 1: new stage.
 * - storyboard 1: new stage (compiled from a Lesson rather than a document).
 * - voice 2: cue resolution, modelled silence, `Scene.hold` in the clip.
 * - visuals 2: plot / path / motion elements resolve to real ink.
 * - render 2: plots, paths and motion in the frame compiler.
 */
export const STAGE_CODE_VERSION: Record<StageName, number> = {
  ingest: 1,
  lesson: 1,
  storyboard: 1,
  voice: 2,
  visuals: 2,
  render: 2,
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

/** What one asset's artwork depends on. */
export function assetFingerprint(
  asset: { kind: string; prompt?: string; seed?: number },
  meta: { style: string; palette: string },
  provider: string,
): string {
  return cacheKey(
    'visuals',
    asset.kind,
    asset.prompt ?? '',
    asset.seed ?? 0,
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
    sb.assets.map((a) => [a.id, a.kind, a.prompt ?? '', a.seed ?? 0]),
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
