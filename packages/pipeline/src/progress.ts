/**
 * One progress number for the whole run.
 *
 * Every stage reports 0–100 of its own work; the pipeline squashes those into a
 * single monotonic 0–100 so a CLI bar or an SSE stream never goes backwards.
 *
 * Weights are rough measured shares of wall-clock on a local, zero-key run.
 * Render dominates because it captures and encodes every frame — a 90 second
 * video is ~2700 frames through a headless browser, and nothing else in the
 * pipeline is in that league. The two stages that replaced the MVP's single
 * `plan` step are deliberately weighted differently: `lesson` is one LLM round
 * trip plus a revision pass when a key is present (seconds, not minutes) and
 * pure local computation when it is not, while `storyboard` is arithmetic —
 * regions, plots, cues and camera — and is over almost before the bar moves.
 */

import type { OnProgress, Progress } from '@inkcast/core';

/**
 * Stage order, and it is load-bearing: **voice runs before visuals and render**.
 *
 * The voice stage is what turns `Enter.cue` ("a verbatim phrase from this
 * narration") into a real fraction of a measured clip and writes
 * `scene.durationSec`. Visuals sizes reveal geometry against those elements and
 * the renderer needs the durations to build its timeline, so both must see a
 * storyboard the voice stage has already resolved. Running visuals first would
 * silently reintroduce the drift the cue mechanism exists to remove.
 */
export const STAGES = ['ingest', 'lesson', 'storyboard', 'voice', 'visuals', 'render'] as const;
export type StageName = (typeof STAGES)[number];

export const STAGE_WEIGHT: Record<StageName, number> = {
  ingest: 3,
  lesson: 10,
  storyboard: 5,
  voice: 22,
  visuals: 12,
  render: 48,
};

export const STAGE_LABEL: Record<StageName, string> = {
  ingest: 'reading source',
  lesson: 'designing the lesson',
  storyboard: 'building the board',
  voice: 'narrating',
  visuals: 'drawing',
  render: 'rendering video',
};

/** One line each, for a UI that wants to explain what is happening and why. */
export const STAGE_BLURB: Record<StageName, string> = {
  ingest: 'read the document, URL or text into normalised markdown',
  lesson: 'decide what to teach: hook, anchor, one idea per step, worked example, misconception',
  storyboard: 'turn the lesson into plots, drawn ink, regions and a camera tour',
  voice: 'synthesise narration, measure it, and resolve every cue to a real timestamp',
  visuals: 'resolve assets and every element into hand-drawn vector strokes',
  render: 'capture frames in Chromium and mux with ffmpeg',
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
    // The stage name is forced by the band, not taken from the child's report:
    // stage packages predate this split and some of them still say `plan`.
    child: (stage) => (p) => emit(stage, p.pct, p.note),
    elapsedMs: () => Date.now() - started,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}
