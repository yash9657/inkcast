/**
 * The lines `planhash.mts` prints — one per plan item, plus a board line — in two modes.
 *
 * A module rather than eighty lines inside the `.mts` tool for one reason: the claim
 * both modes rest on ("a timing change shows here and not there") is a property worth a
 * test, and a tool that only exists as a shell invocation can only be tested by running
 * it. The tool stays the thin part: argv in, these rows out.
 *
 * **Default mode hashes what is drawn and nothing about when** — that is the older half
 * of this file and its rule has not moved. `enter.at` is rewritten by the voice stage on
 * every re-narration, so a tool that reported a diff for that would cry wolf on every run
 * and be useless for the geometry questions it exists to answer.
 *
 * **`--timing` is the opt-in second mode** (plan 7.2; audit S7-a). Same rows, plus the
 * numbers the default mode drops: the film's own length, each scene's start, speech and
 * hold, and each item's start, duration and a hash of everything else about its schedule.
 * A `hold` that moved is then a diff instead of a frame-by-frame comparison — which is
 * how it was found before this existed.
 *
 * Two details that look like fussiness and are not:
 *
 * - **The timing hash is over exact numbers; the printed columns are rounded to
 *   milliseconds.** Rounding what is hashed would hide a sub-millisecond move, and this
 *   mode exists to answer "did anything move at all". Rounding what is *printed* keeps
 *   the diff readable — `0.39844999999999997` is not a number anybody needs to read.
 * - **Timing columns are appended, never substituted.** Both modes emit the same first
 *   five columns, so a `before.txt` captured in one mode still diffs line-for-line
 *   against an `after.txt` captured in the other; only the extra columns are new.
 */
import { createHash } from 'node:crypto';
import type { PlanItem, PlanPrim, RenderPlan } from './types.js';

export type PlanRowOptions = {
  /** Add the columns and rows that describe *when* things happen. */
  timing?: boolean;
};

const sha = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 12);

/** Milliseconds, for a column a human reads. Never for a column a hash consumes. */
const ms = (v: number): string => v.toFixed(3);

/** Everything about a prim that decides what lands on screen, and nothing about when. */
export function drawn(p: PlanPrim): unknown {
  const any = p as unknown as Record<string, unknown>;
  const keep: Record<string, unknown> = { kind: any.kind };
  for (const k of [
    'd',
    'text',
    'svg',
    'x',
    'y',
    'w',
    'h',
    'size',
    'color',
    'stroke',
    'fill',
    'width',
    'align',
    'baseline',
    'opacity',
    'flipX',
    'box',
  ]) {
    if (any[k] !== undefined) keep[k] = any[k];
  }
  return keep;
}

/**
 * Everything about an item that decides *when* it lands, and nothing about what.
 *
 * `start`/`dur` are printed in their own column, so what this adds is the rest of the
 * schedule: when the item leaves, and the two baked tracks whose sample counts are a
 * function of how long they run. `trailAt` is here rather than in `drawn` because a
 * trail's positions are geometry the default mode already covers through its prims —
 * what `trailAt` decides is the order they appear in.
 */
export function timed(item: PlanItem): unknown {
  return {
    start: item.start,
    dur: item.dur,
    sceneEnd: item.sceneEnd,
    ...(item.fadeAt === undefined ? {} : { fadeAt: item.fadeAt }),
    ...(item.motion
      ? { motion: [item.motion.start, item.motion.end, item.motion.samples.length] }
      : {}),
    ...(item.morph ? { morph: [item.morph.start, item.morph.end, item.morph.frames.length] } : {}),
    ...(item.trailAt ? { trailAt: item.trailAt } : {}),
  };
}

/**
 * One project's rows, tab-separated and already in draw order.
 *
 * `plan.items` is flat, carries its scene index and is ordered the way it is drawn, so it
 * is diffable line for line as it stands.
 */
export function planRows(name: string, plan: RenderPlan, opts: PlanRowOptions = {}): string[] {
  const rows: string[] = [];

  // Board-level numbers first: `scale` and `typeScale` are what every pixel-quoted
  // constant is multiplied by, so a change there moves every stroke at once and is
  // worth seeing on its own line rather than inferring from 39 changed hashes.
  rows.push([name, '-', '(board)', 'scale', `${plan.scale}/${plan.typeScale}`, ''].join('\t'));

  if (opts.timing) {
    // The film's own length, which is what a `hold` change moves first.
    rows.push([name, '-', '(board)', 'when', `${ms(plan.duration)}s`, `${plan.fps}fps`].join('\t'));
    for (const scene of plan.scenes) {
      rows.push(
        [
          name,
          scene.id,
          '(scene)',
          'when',
          `${ms(scene.start)}+${ms(scene.dur)}`,
          `speech ${ms(scene.speech)} hold ${ms(scene.hold)} cam ${ms(scene.camera.transition)}`,
        ].join('\t'),
      );
    }
  }

  for (const item of plan.items) {
    const scene = plan.scenes[item.scene]?.id ?? String(item.scene);
    const geom = sha(JSON.stringify(item.prims.map(drawn)));
    const cols = [name, scene, item.id, item.style, geom, String(item.prims.length)];
    if (opts.timing) {
      cols.push(`${ms(item.start)}+${ms(item.dur)}`, sha(JSON.stringify(timed(item))));
    }
    rows.push(cols.join('\t'));
  }

  return rows;
}
