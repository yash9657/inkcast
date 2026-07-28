/**
 * One progress number for the whole run.
 *
 * Every stage reports 0–100 of its own work; the pipeline squashes those into a
 * single monotonic 0–100 so a CLI bar or an SSE stream never goes backwards.
 * Weights are rough measured shares of wall-clock on a local, zero-key run —
 * render dominates because it captures and encodes every frame.
 */

import type { OnProgress, Progress } from '@inkcast/core';

export const STAGES = ['ingest', 'plan', 'voice', 'visuals', 'render'] as const;
export type StageName = (typeof STAGES)[number];

export const STAGE_WEIGHT: Record<StageName, number> = {
  ingest: 4,
  plan: 12,
  voice: 24,
  visuals: 15,
  render: 45,
};

export const STAGE_LABEL: Record<StageName, string> = {
  ingest: 'reading source',
  plan: 'planning storyboard',
  voice: 'narrating',
  visuals: 'drawing assets',
  render: 'rendering video',
};

/** Where a stage's band starts on the overall 0–100 scale. */
export function stageBase(stage: StageName): number {
  let base = 0;
  for (const s of STAGES) {
    if (s === stage) break;
    base += STAGE_WEIGHT[s];
  }
  return base;
}

/** Progress with the stage-local number kept alongside the normalised one. */
export type PipelineProgress = Progress & {
  stage: StageName;
  /** 0–100 within this stage. */
  stagePct: number;
  /** Milliseconds since the run started. */
  elapsedMs: number;
};

export type ProgressBus = {
  /** Report stage-local progress; forwards a normalised overall pct. */
  stage(stage: StageName, stagePct: number, note?: string): void;
  /** Mark a stage finished (fills its band completely). */
  done(stage: StageName, note?: string): void;
  /** A stage-shaped `onProgress` to hand down to a stage package. */
  child(stage: StageName): OnProgress;
  elapsedMs(): number;
};

export function progressBus(onProgress?: OnProgress): ProgressBus {
  const started = Date.now();
  let last = 0;
  const emit = (stage: StageName, stagePct: number, note?: string) => {
    const local = clamp(stagePct, 0, 100);
    const overall = stageBase(stage) + (local / 100) * STAGE_WEIGHT[stage];
    // Monotonic: a resumed run can skip ahead but must never rewind.
    last = Math.max(last, overall);
    const p: PipelineProgress = {
      stage,
      pct: Math.round(clamp(last, 0, 100)),
      stagePct: Math.round(local),
      elapsedMs: Date.now() - started,
      ...(note === undefined ? {} : { note }),
    };
    onProgress?.(p);
  };
  return {
    stage: emit,
    done: (stage, note) => emit(stage, 100, note),
    child: (stage) => (p) => emit(stage, p.pct, p.note),
    elapsedMs: () => Date.now() - started,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}
