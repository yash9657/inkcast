/**
 * In-process registry for generation runs, plus progress fan-out to SSE.
 *
 * Three problems this solves, in the order they bite:
 *
 *  1. **The response returns before the work does.** `POST /api/generate`
 *     answers with a project id in milliseconds while a render takes minutes, so
 *     the run has to outlive its request. It is a detached promise held here.
 *  2. **Clients connect late.** The browser gets the id, then navigates, then
 *     opens the EventSource — by which point `ingest` and `plan` have already
 *     been and gone. Every job therefore *buffers* its progress, and a new
 *     subscriber is replayed the buffer before it sees anything live. A client
 *     that connects after the run finished still gets the terminal event, so it
 *     never hangs waiting for news that already happened.
 *  3. **There can be more than one listener.** Two tabs, or a reconnect that
 *     overlaps the connection it replaces. Listeners are a set, and unsubscribing
 *     one never disturbs another.
 *
 * Scope is deliberately one process: the studio is a local single-user app, so a
 * `Map` is the right amount of infrastructure. It is pinned to `globalThis` so
 * `next dev`'s hot reload cannot orphan a running render.
 */

import path from 'node:path';

import type { OnProgress, Storyboard } from '@inkcast/core';
import { loadCore, loadPipeline, mediaUrl, projectDir, upsertProject } from './store';

/* ------------------------------------------------------------------- events */

/** A stage reporting in. `pct` is overall 0–100 and never goes backwards. */
export type ProgressEvent = {
  stage: string;
  pct: number;
  note?: string;
  /**
   * 0–100 *within* the current stage, when the pipeline supplies it.
   *
   * The pipeline's `progressBus` emits `PipelineProgress`, which carries this
   * alongside the overall figure, but core's `Progress` type does not declare it.
   * It is forwarded because a per-stage bar needs it: overall `pct` sits at 61%
   * for the whole render, while `stagePct` is what actually moves.
   */
  stagePct?: number;
};

export type DoneEvent = {
  done: true;
  projectId: string;
  /** Project-relative path of the finished video. */
  videoPath: string;
  /** Ready to drop into a `<video src>`. */
  videoUrl: string;
  durationSec?: number;
};

export type ErrorEvent = {
  error: string;
  /** Which pipeline stage failed, when the failure named one. */
  stage?: string;
};

export type JobEvent = ProgressEvent | DoneEvent | ErrorEvent;
export type TerminalEvent = DoneEvent | ErrorEvent;

export function isTerminal(event: JobEvent): event is TerminalEvent {
  return 'done' in event || 'error' in event;
}

/* --------------------------------------------------------------------- jobs */

export type JobKind = 'cast' | 'rerender';
export type JobStatus = 'running' | 'done' | 'error';

/** What a job's `run` callback must hand back so we can finish bookkeeping. */
export type JobOutcome = {
  /** Absolute or project-relative; normalised to project-relative here. */
  videoPath: string;
  storyboard?: Storyboard;
  costUsd?: number;
  title?: string;
};

/** The serialisable view of a job, for `GET /api/generate/[id]`. */
export type JobSnapshot = {
  projectId: string;
  kind: JobKind;
  status: JobStatus;
  startedAt: string;
  finishedAt?: string;
  progress?: ProgressEvent;
  result?: DoneEvent;
  error?: ErrorEvent;
};

type Listener = (event: JobEvent) => void;

type Job = {
  projectId: string;
  kind: JobKind;
  status: JobStatus;
  startedAt: number;
  finishedAt?: number;
  /** Coalesced progress history, capped — see HISTORY_CAP. */
  history: ProgressEvent[];
  terminal?: TerminalEvent;
  listeners: Set<Listener>;
  /** Held so nothing can garbage-collect the run, and so tests can await it. */
  promise: Promise<void>;
};

/**
 * How much progress history a late subscriber is replayed.
 *
 * The render stage emits per-frame-batch updates, so an unbounded history would
 * grow into thousands of entries for a long video and every reconnect would
 * replay all of them. A cap plus the coalescing in `record()` keeps the replay
 * proportional to what a UI can actually show: the stage transitions and the
 * recent tail.
 */
const HISTORY_CAP = 128;

/** How long a finished job stays queryable before it is swept. */
const RETAIN_MS = 30 * 60 * 1000;

const registry = ((
  globalThis as typeof globalThis & { __inkcastJobs?: Map<string, Job> }
).__inkcastJobs ??= new Map<string, Job>());

/* ------------------------------------------------------------------ control */

/**
 * Start a run for `projectId`, unless one is already in flight.
 *
 * Returns `{ job, started: false }` when an existing run was reused — the
 * caller turns that into a 409 or simply hands back the same id, depending on
 * whether re-requesting the same work is a mistake.
 */
export function startJob(
  projectId: string,
  kind: JobKind,
  run: (onProgress: OnProgress) => Promise<JobOutcome>,
): { snapshot: JobSnapshot; started: boolean } {
  sweep();
  const existing = registry.get(projectId);
  if (existing && existing.status === 'running') {
    return { snapshot: snapshotOf(existing), started: false };
  }

  const job: Job = {
    projectId,
    kind,
    status: 'running',
    startedAt: Date.now(),
    history: [],
    listeners: new Set(),
    promise: Promise.resolve(),
  };
  registry.set(projectId, job);

  job.promise = execute(job, run);
  return { snapshot: snapshotOf(job), started: true };
}

async function execute(job: Job, run: (onProgress: OnProgress) => Promise<JobOutcome>) {
  const onProgress: OnProgress = (p) => {
    // `stagePct` is present on the pipeline's richer `PipelineProgress` but not on
    // core's `Progress`, so it is read structurally rather than assumed.
    const stagePct = (p as { stagePct?: unknown }).stagePct;
    record(job, {
      stage: p.stage,
      pct: p.pct,
      ...(p.note === undefined ? {} : { note: p.note }),
      ...(typeof stagePct === 'number' && Number.isFinite(stagePct)
        ? { stagePct: Math.round(stagePct) }
        : {}),
    });
  };

  try {
    const outcome = await run(onProgress);
    const relative = toRelative(job.projectId, outcome.videoPath);
    const core = await loadCore();
    const durationSec = outcome.storyboard ? core.totalDuration(outcome.storyboard) : undefined;

    const done: DoneEvent = {
      done: true,
      projectId: job.projectId,
      videoPath: relative,
      videoUrl: mediaUrl(job.projectId, relative),
      ...(durationSec === undefined ? {} : { durationSec }),
    };

    await upsertProject(job.projectId, {
      status: 'ready',
      videoPath: relative,
      ...((outcome.title ?? outcome.storyboard?.title)
        ? { title: outcome.title ?? outcome.storyboard!.title }
        : {}),
      ...(outcome.storyboard ? { scenes: outcome.storyboard.scenes.length } : {}),
      ...(durationSec === undefined ? {} : { durationSec }),
      ...(outcome.costUsd === undefined ? {} : { costUsd: outcome.costUsd }),
      ...(outcome.storyboard ? { aspect: outcome.storyboard.meta.aspect } : {}),
      // No `error` key: `upsertProject` never inherits one, so reaching 'ready'
      // retracts the previous failure rather than carrying it forever.
    });

    finish(job, 'done', done);
  } catch (err) {
    const event = await describeFailure(err);
    // Best-effort: a failure to write the index must not mask the real error.
    await upsertProject(job.projectId, { status: 'failed', error: event.error }).catch(() => {});
    finish(job, 'error', event);
  }
}

/** Turn a thrown value into an `ErrorEvent` that names the stage and the cause. */
async function describeFailure(err: unknown): Promise<ErrorEvent> {
  let stage: string | undefined;
  let message: string;

  // Duck-typed rather than `instanceof`: under HMR the module identity of
  // StageError can differ between the throw site and here, and `name` + `stage`
  // is the property we actually depend on.
  if (err instanceof Error && err.name === 'StageError') {
    const tagged = err as Error & { stage?: unknown };
    if (typeof tagged.stage === 'string') stage = tagged.stage;
  }

  try {
    // `rootCauseMessage` digs out the deepest cause, which is where the real
    // reason lives ("ffmpeg not found" rather than "TypeError: undefined").
    const { rootCauseMessage } = await loadPipeline();
    message = rootCauseMessage(err);
  } catch {
    message = err instanceof Error ? err.message : String(err);
  }
  if (!message) message = 'the run failed for an unknown reason';
  return { error: message, ...(stage === undefined ? {} : { stage }) };
}

function finish(job: Job, status: JobStatus, event: TerminalEvent): void {
  job.status = status;
  job.finishedAt = Date.now();
  job.terminal = event;
  emit(job, event);
  // Every subscriber has now seen the terminal event and will close its own
  // stream; dropping them here keeps a finished job from pinning closures.
  job.listeners.clear();
}

/**
 * Append to the history, coalescing no-op updates.
 *
 * A stage that reports the same rounded percentage twice (common: 200 frames
 * mapping onto 100 integers) contributes nothing a UI can render, so it is
 * dropped rather than allowed to push a real transition out of the buffer.
 */
function record(job: Job, event: ProgressEvent): void {
  if (job.status !== 'running') return;
  const last = job.history[job.history.length - 1];
  const sameAsLast =
    last !== undefined &&
    last.stage === event.stage &&
    last.pct === event.pct &&
    last.note === event.note &&
    last.stagePct === event.stagePct;
  if (!sameAsLast) {
    job.history.push(event);
    if (job.history.length > HISTORY_CAP) {
      // Keep the first entry: it is the only record of where the run began.
      job.history.splice(1, job.history.length - HISTORY_CAP);
    }
  }
  emit(job, event);
}

function emit(job: Job, event: JobEvent): void {
  for (const listener of job.listeners) {
    try {
      listener(event);
    } catch {
      // A broken listener (closed stream, mid-teardown) is not the job's
      // problem — it will be unsubscribed by its own abort handler.
    }
  }
}

/* ---------------------------------------------------------------- listening */

/**
 * Attach a listener and replay everything it missed.
 *
 * The replay is synchronous and happens before this returns, so a caller cannot
 * observe live events out of order with buffered ones. Returns the unsubscribe
 * function; callers MUST invoke it on disconnect.
 */
export function subscribe(
  projectId: string,
  listener: Listener,
): { unsubscribe: () => void; found: boolean; settled: boolean } {
  sweep();
  const job = registry.get(projectId);
  if (!job) return { unsubscribe: () => {}, found: false, settled: false };

  for (const event of job.history) listener(event);
  if (job.terminal) {
    listener(job.terminal);
    // Nothing further will ever arrive; do not register at all.
    return { unsubscribe: () => {}, found: true, settled: true };
  }

  job.listeners.add(listener);
  return {
    unsubscribe: () => {
      job.listeners.delete(listener);
    },
    found: true,
    settled: false,
  };
}

export function getJob(projectId: string): JobSnapshot | undefined {
  sweep();
  const job = registry.get(projectId);
  return job ? snapshotOf(job) : undefined;
}

export function isRunning(projectId: string): boolean {
  return registry.get(projectId)?.status === 'running';
}

/** Every job this process knows about, newest first. */
export function listJobs(): JobSnapshot[] {
  sweep();
  return [...registry.values()].sort((a, b) => b.startedAt - a.startedAt).map(snapshotOf);
}

/**
 * Wait for a run to settle. Used by nothing in the request path — it exists so
 * a caller that genuinely wants to block (a script, a test) can.
 */
export async function waitForJob(projectId: string): Promise<JobSnapshot | undefined> {
  const job = registry.get(projectId);
  if (!job) return undefined;
  await job.promise;
  return snapshotOf(job);
}

function snapshotOf(job: Job): JobSnapshot {
  const last = job.history[job.history.length - 1];
  const terminal = job.terminal;
  return {
    projectId: job.projectId,
    kind: job.kind,
    status: job.status,
    startedAt: new Date(job.startedAt).toISOString(),
    ...(job.finishedAt === undefined ? {} : { finishedAt: new Date(job.finishedAt).toISOString() }),
    ...(last === undefined ? {} : { progress: last }),
    ...(terminal && 'done' in terminal ? { result: terminal } : {}),
    ...(terminal && 'error' in terminal ? { error: terminal } : {}),
  };
}

/**
 * Drop finished jobs that nobody is reading any more.
 *
 * Called from every entry point rather than on a timer: an interval would keep
 * the dev server's event loop busy and survive HMR as a duplicate, whereas
 * sweeping on access is both cheap and self-limiting. Running jobs are never
 * swept, however long they take.
 */
function sweep(): void {
  const cutoff = Date.now() - RETAIN_MS;
  for (const [id, job] of registry) {
    if (job.status === 'running') continue;
    if ((job.finishedAt ?? job.startedAt) < cutoff && job.listeners.size === 0) {
      registry.delete(id);
    }
  }
}

/* ------------------------------------------------------------------- paths */

/** Normalise whatever the pipeline returned into a project-relative path. */
function toRelative(projectId: string, videoPath: string): string {
  const dir = projectDir(projectId);
  if (!dir) return 'out.mp4';
  const abs = path.isAbsolute(videoPath) ? videoPath : path.resolve(dir, videoPath);
  const rel = path.relative(dir, abs);
  // A video outside its own project dir cannot be served by /api/media, and the
  // conventional location is the only sane guess.
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return 'out.mp4';
  return rel.split(path.sep).join('/');
}
