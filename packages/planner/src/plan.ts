/**
 * Stage 2 — plan. `SourceDoc` in, `Storyboard` out.
 *
 * Two adapters, one contract. The heuristic planner is the default and always
 * available; the Anthropic adapter is an opt-in upgrade that degrades back to it
 * on a missing key, a missing SDK, an API error or a schema violation.
 *
 * When `opts.dir` is given the result is cached in that project directory, so
 * re-running the pipeline after an edit downstream costs nothing.
 */
import type { Storyboard } from '@inkcast/core';
import {
  hash,
  isFresh,
  loadStoryboard,
  logger,
  markFresh,
  report,
  saveStoryboard,
} from '@inkcast/core';
import { anthropicAvailable, anthropicPlan, plannerModel } from './anthropic.js';
import { heuristicPlan } from './heuristic.js';
import { layoutStoryboard } from './layout.js';
import type { PlanOptions, PlannerAdapter, SourceDoc } from './types.js';

const log = logger('planner');

/** Bump when planner output changes in a way that should invalidate caches. */
export const PLANNER_VERSION = 1;

const CACHE_KEY = 'plan';
const ARTEFACT = 'storyboard.json';

/** Which adapter a given set of options resolves to, given the environment. */
export function resolveAdapter(opts: PlanOptions = {}): Exclude<PlannerAdapter, 'auto'> {
  const wanted = opts.adapter ?? 'auto';
  if (wanted === 'heuristic') return 'heuristic';
  if (wanted === 'anthropic') {
    if (anthropicAvailable()) return 'anthropic';
    log.warn('ANTHROPIC_API_KEY is not set — using the local heuristic planner');
    return 'heuristic';
  }
  return anthropicAvailable() ? 'anthropic' : 'heuristic';
}

function inputHash(doc: SourceDoc, opts: PlanOptions, adapter: string): string {
  return hash(PLANNER_VERSION, adapter, doc.title, doc.text, {
    aspect: opts.aspect,
    palette: opts.palette,
    style: opts.style,
    voice: opts.voice,
    language: opts.language,
    fps: opts.fps,
    maxScenes: opts.maxScenes,
    wordsPerSecond: opts.wordsPerSecond,
    brief: opts.brief,
    model: adapter === 'anthropic' ? plannerModel(opts) : undefined,
  });
}

/**
 * Compile a `SourceDoc` into a `Storyboard`: beats, narration, visuals, assets,
 * layout and camera. The result is validated against the IR before it is
 * returned, so every later stage can trust its shape.
 */
export async function plan(doc: SourceDoc, opts: PlanOptions = {}): Promise<Storyboard> {
  const adapter = resolveAdapter(opts);
  const key = inputHash(doc, opts, adapter);

  if (opts.dir && !opts.force) {
    if (await isFresh(opts.dir, CACHE_KEY, key, [ARTEFACT])) {
      const cached = await loadStoryboard(opts.dir);
      log.info(`reusing cached plan (${cached.scenes.length} scenes)`);
      report(opts, { stage: 'plan', pct: 100, note: 'cached' });
      return cached;
    }
  }

  report(opts, { stage: 'plan', pct: 2, note: `${adapter} planner` });

  let sb: Storyboard | undefined;
  if (adapter === 'anthropic') {
    sb = await anthropicPlan(doc, opts);
    if (sb && opts.relayout !== false) {
      // The model chooses the content; the layout engine guarantees the geometry.
      sb = layoutStoryboard(sb, { aspect: sb.meta.aspect });
      log.debug('re-laid out the model storyboard for collision-free placement');
    }
    if (!sb) log.warn('falling back to the heuristic planner');
  }
  if (!sb) sb = heuristicPlan(doc, opts);

  if (opts.dir) {
    await saveStoryboard(opts.dir, sb);
    await markFresh(opts.dir, CACHE_KEY, key);
  }

  log.info(`plan ready: "${sb.title}"`, {
    scenes: sb.scenes.length,
    assets: sb.assets.length,
    canvas: `${sb.canvas.w}x${sb.canvas.h}`,
  });
  return sb;
}
