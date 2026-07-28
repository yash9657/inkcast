'use client';

/**
 * The progress hook: one `EventSource` on `/api/generate/:id/stream`, turned
 * into a state shape the waiting screen can render directly.
 *
 * Two rules it exists to enforce:
 *
 * 1. **Never fabricate a percentage.** `pct` is whatever the server last sent
 *    and `null` before it sends one — an indeterminate bar is honest and looks
 *    it. The pipeline's own `progressBus` already guarantees the number is
 *    monotonic, so nothing here smooths or extrapolates.
 * 2. **A stream that stops is a failure.** If the connection closes without a
 *    terminal `{ done }` or `{ error }` event, that surfaces as an error with a
 *    retry, not as a bar frozen at 84% forever.
 */

import * as React from 'react';

import { streamPath } from '@/lib/api';

export const GENERATION_STAGES = ['ingest', 'plan', 'voice', 'visuals', 'render'] as const;
export type GenerationStage = (typeof GENERATION_STAGES)[number];

/** Stage copy. Verbs, not nouns — see docs/DESIGN.md §9. */
export const STAGE_COPY: Record<GenerationStage, { title: string; idle: string }> = {
  ingest: { title: 'Read the source', idle: 'Pull out headings, lists and formulas' },
  plan: { title: 'Plan the board', idle: 'Lay one canvas out, scene by scene' },
  voice: { title: 'Narrate', idle: 'Speak each beat and measure it' },
  visuals: { title: 'Draw the assets', idle: 'Sketch every entity once, reuse it after' },
  render: { title: 'Ink the frames', idle: 'Draw stroke by stroke and encode' },
};

/** The pipeline names this stage `voice`; the UI copy calls it narrating. */
const STAGE_ALIASES: Record<string, GenerationStage> = {
  ingest: 'ingest',
  read: 'ingest',
  source: 'ingest',
  plan: 'plan',
  planner: 'plan',
  storyboard: 'plan',
  voice: 'voice',
  narrate: 'voice',
  narration: 'voice',
  audio: 'voice',
  visuals: 'visuals',
  assets: 'visuals',
  draw: 'visuals',
  render: 'render',
  encode: 'render',
  video: 'render',
};

/**
 * The share of the overall bar each stage owns.
 *
 * Mirrors `STAGE_WEIGHT` in `packages/pipeline/src/progress.ts`. The stream only
 * carries the overall percentage, so inverting the pipeline's own arithmetic is
 * the only way to show a per-stage number that is true rather than invented — and
 * if the server ever starts sending `stagePct`, that wins (see below).
 */
const STAGE_WEIGHT: Record<GenerationStage, number> = {
  ingest: 4,
  plan: 12,
  voice: 24,
  visuals: 15,
  render: 45,
};

function stageBase(stage: GenerationStage): number {
  let base = 0;
  for (const name of GENERATION_STAGES) {
    if (name === stage) break;
    base += STAGE_WEIGHT[name];
  }
  return base;
}

/** Overall 0–100 -> this stage's own 0–100. */
function stageLocalPct(stage: GenerationStage, overall: number | null): number | null {
  if (overall === null) return null;
  const local = ((overall - stageBase(stage)) / STAGE_WEIGHT[stage]) * 100;
  return Math.round(Math.max(0, Math.min(100, local)));
}

function toStage(raw: unknown): GenerationStage | undefined {
  if (typeof raw !== 'string') return undefined;
  return STAGE_ALIASES[raw.toLowerCase().trim()];
}

export type StageState = 'pending' | 'active' | 'done' | 'failed';

export type StageProgress = {
  state: StageState;
  /** 0–100 within this stage when the server said so, else null. */
  pct: number | null;
  note?: string;
};

export type GenerationStatus = 'idle' | 'connecting' | 'running' | 'done' | 'error';

export type GenerationState = {
  status: GenerationStatus;
  /** The stage currently working, or the one that failed. */
  stage: GenerationStage | null;
  /** Overall 0–100 as reported by the pipeline; null until it reports. */
  pct: number | null;
  note?: string;
  stages: Record<GenerationStage, StageProgress>;
  /** Milliseconds since this hook attached to the run. */
  elapsedMs: number;
  /** Project-relative video path from the terminal event. */
  videoPath?: string;
  error?: string;
};

export type UseGenerationOptions = {
  /** Attach the stream. Pass false for a project that is already finished. */
  enabled?: boolean;
  /** Fires once per terminal success event. */
  onDone?: (videoPath: string | undefined) => void;
  /** Fires when the run moves into a new stage — a good moment to refetch. */
  onStageChange?: (stage: GenerationStage) => void;
  onError?: (message: string) => void;
};

export type UseGenerationResult = GenerationState & {
  /** Reconnect and start the state over. */
  retry: () => void;
};

function idleStages(): Record<GenerationStage, StageProgress> {
  return {
    ingest: { state: 'pending', pct: null },
    plan: { state: 'pending', pct: null },
    voice: { state: 'pending', pct: null },
    visuals: { state: 'pending', pct: null },
    render: { state: 'pending', pct: null },
  };
}

function initialState(enabled: boolean): GenerationState {
  return {
    status: enabled ? 'connecting' : 'idle',
    stage: null,
    pct: null,
    stages: idleStages(),
    elapsedMs: 0,
  };
}

/**
 * Everything before `stage` is finished, `stage` is working, everything after
 * is untouched. The pipeline runs strictly in order, so this is a description
 * rather than a guess.
 */
function advance(
  prev: Record<GenerationStage, StageProgress>,
  stage: GenerationStage,
  pct: number | null,
  note?: string,
): Record<GenerationStage, StageProgress> {
  const index = GENERATION_STAGES.indexOf(stage);
  const next = { ...prev };
  GENERATION_STAGES.forEach((name, i) => {
    if (i < index) {
      next[name] = { state: 'done', pct: 100, ...(prev[name].note ? { note: prev[name].note } : {}) };
    } else if (i === index) {
      next[name] = { state: 'active', pct, ...(note ? { note } : {}) };
    }
  });
  return next;
}

function finishAll(prev: Record<GenerationStage, StageProgress>) {
  const next = { ...prev };
  for (const name of GENERATION_STAGES) {
    next[name] = { state: 'done', pct: 100, ...(prev[name].note ? { note: prev[name].note } : {}) };
  }
  return next;
}

function failAt(prev: Record<GenerationStage, StageProgress>, stage: GenerationStage | null) {
  if (!stage) return prev;
  return { ...prev, [stage]: { ...prev[stage], state: 'failed' as StageState } };
}

/** How many consecutive transport errors we tolerate before giving up. */
const MAX_RECONNECTS = 3;

export function useGeneration(
  projectId: string | null | undefined,
  options: UseGenerationOptions = {},
): UseGenerationResult {
  const enabled = (options.enabled ?? true) && Boolean(projectId);
  const [attempt, setAttempt] = React.useState(0);
  const [state, setState] = React.useState<GenerationState>(() => initialState(enabled));

  // Callbacks live in a ref so a caller passing inline arrow functions does not
  // tear the EventSource down and reopen it on every render.
  const handlers = React.useRef(options);
  handlers.current = options;

  const retry = React.useCallback(() => {
    setState(initialState(true));
    setAttempt((n) => n + 1);
  }, []);

  React.useEffect(() => {
    if (!enabled || !projectId) {
      setState((prev) => (prev.status === 'idle' ? prev : initialState(false)));
      return;
    }

    const startedAt = Date.now();
    let terminal = false;
    let failures = 0;
    let closed = false;
    let lastStage: GenerationStage | null = null;

    setState({ ...initialState(true), elapsedMs: 0 });

    const source = new EventSource(streamPath(projectId));

    const close = () => {
      if (closed) return;
      closed = true;
      source.close();
    };

    source.onopen = () => {
      failures = 0;
      setState((prev) => (prev.status === 'connecting' ? { ...prev, status: 'running' } : prev));
    };

    source.onmessage = (event: MessageEvent<string>) => {
      failures = 0;
      let payload: unknown;
      try {
        payload = JSON.parse(event.data) as unknown;
      } catch {
        return; // a keepalive or a partial frame; nothing to render
      }
      if (!payload || typeof payload !== 'object') return;
      const data = payload as Record<string, unknown>;

      if (typeof data.error === 'string' && data.error.trim()) {
        terminal = true;
        const message = data.error.trim();
        // The error event names the failing stage when the pipeline knew it.
        const failedStage = toStage(data.stage);
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: message,
          stage: failedStage ?? prev.stage,
          stages: failAt(prev.stages, failedStage ?? prev.stage),
          elapsedMs: Date.now() - startedAt,
        }));
        handlers.current.onError?.(message);
        close();
        return;
      }

      if (data.done === true) {
        terminal = true;
        const videoPath = typeof data.videoPath === 'string' ? data.videoPath : undefined;
        setState((prev) => ({
          ...prev,
          status: 'done',
          pct: 100,
          stage: null,
          stages: finishAll(prev.stages),
          elapsedMs: Date.now() - startedAt,
          ...(videoPath ? { videoPath } : {}),
        }));
        handlers.current.onDone?.(videoPath);
        close();
        return;
      }

      const stage = toStage(data.stage);
      const overall = typeof data.pct === 'number' && Number.isFinite(data.pct) ? data.pct : null;
      const reported =
        typeof data.stagePct === 'number' && Number.isFinite(data.stagePct) ? data.stagePct : null;
      const stageLocal = stage ? (reported ?? stageLocalPct(stage, overall)) : reported;
      const note = typeof data.note === 'string' && data.note.trim() ? data.note.trim() : undefined;

      // Announced outside the updater: a state updater must stay pure, and
      // StrictMode calls it twice.
      if (stage && stage !== lastStage) {
        lastStage = stage;
        handlers.current.onStageChange?.(stage);
      }

      setState((prev) => {
        const nextStage = stage ?? prev.stage;
        return {
          ...prev,
          status: 'running',
          stage: nextStage,
          // Monotonic on our side too: the server promises it, we do not trust
          // a late-arriving event to walk the bar backwards.
          pct: overall === null ? prev.pct : Math.max(prev.pct ?? 0, Math.round(overall)),
          ...(note ? { note } : {}),
          stages: stage
            ? advance(prev.stages, stage, stageLocal === null ? null : Math.round(stageLocal), note)
            : prev.stages,
          elapsedMs: Date.now() - startedAt,
        };
      });
    };

    source.onerror = () => {
      if (terminal) return;
      failures += 1;
      // `EventSource` reconnects on its own while readyState is CONNECTING. We
      // only give up once it closed for good, or it has failed repeatedly —
      // otherwise a 404 route would retry silently forever.
      if (source.readyState === EventSource.CLOSED || failures >= MAX_RECONNECTS) {
        terminal = true;
        const message =
          'Lost the progress stream before the render finished. The run may still be going on the server.';
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: message,
          stages: failAt(prev.stages, prev.stage),
          elapsedMs: Date.now() - startedAt,
        }));
        handlers.current.onError?.(message);
        close();
      }
    };

    // The clock is a separate, cheap tick: one setState a second while the run
    // is in flight, stopped the moment it is not.
    const timer = window.setInterval(() => {
      if (terminal) return;
      setState((prev) =>
        prev.status === 'running' || prev.status === 'connecting'
          ? { ...prev, elapsedMs: Date.now() - startedAt }
          : prev,
      );
    }, 1000);

    return () => {
      window.clearInterval(timer);
      close();
    };
  }, [enabled, projectId, attempt]);

  return { ...state, retry };
}
