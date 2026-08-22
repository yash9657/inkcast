/**
 * In-process registry for generation runs, plus admission control and progress
 * fan-out to SSE.
 *
 * Four problems this solves, in the order they bite:
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
 *  4. **The box has a finite number of renderers.** A render is four Chromium
 *     contexts and four ffmpeg processes *inside the Next process*. Ten of those
 *     at once do not take ten times as long; they thrash, the box swaps, and
 *     every one of the ten misses. So work is admitted through a semaphore with
 *     a FIFO queue in front of it, and the wait is *shown* rather than hidden
 *     behind a spinner that looks identical to a stall.
 *
 * ## Why the queue is per stage class rather than one lock
 *
 * The stages are not the same kind of expensive. `lesson` is one HTTPS request
 * to Anthropic and then idle waiting; `voice` is the same shape against
 * ElevenLabs; `render` is the part that actually saturates the CPU. Holding one
 * global lock across all three would mean a job that is doing nothing but
 * waiting on somebody else's server is occupying a slot no renderer can use —
 * the box sits idle with a full queue, which is the worst of both worlds. So
 * each class has its own pool (`CLASS_LIMIT`), a job holds a slot only while it
 * is *in* that class, and the classes are strictly ranked
 * (`lesson` < `voice` < `render`) so that a lease can only ever be taken in
 * increasing order. That ranking is what makes the scheme deadlock-free: a job
 * holding a render slot can never block waiting for a lesson slot, because
 * asking for one throws instead of waiting. `Scheduler.acquire` enforces it
 * rather than documenting it, because the failure it prevents — every render
 * slot held by a job waiting for a slot it can never get — is unrecoverable
 * without a restart, and would look exactly like "the box is slow today".
 *
 * `cast` jobs nonetheless hold a **render** slot for their whole run today, and
 * that is a deliberate, temporary over-reservation rather than an oversight:
 * `cast()` in `packages/pipeline/src/cast.ts` is one monolithic call with no
 * pre-render hook, so this module cannot see the boundary between "waiting on
 * ElevenLabs" and "driving Chromium". Given the choice between bounding
 * Chromium at two (the property that keeps the box alive) and bounding it at
 * whatever the cloud stages happen to allow (four, or more), the safe reading
 * wins. `JobContext.lease` is the mechanism for the honest version: once the
 * pipeline accepts a `beforeRender` gate, the hosted route starts the job with
 * `hold: 'lesson'` and wraps the render in `ctx.lease('render', …)`, and the
 * queue stops charging cloud latency against a renderer. Nothing else has to
 * change — the pools, the FIFO, the copy and the estimate are already written
 * against the general case, and `jobs.test.ts` proves the nested path works.
 *
 * ## Why the estimate is measured and not a constant
 *
 * "About 6 minutes" is only worth saying if it is true, and the one number
 * nobody can guess from here is how long *this* box takes to draw a film: it
 * depends on the preset, the core count and how many other renders are running.
 * So every completed render lease is timed and folded into a rolling mean of the
 * last `SAMPLE_WINDOW` (`Scheduler.meanSec`), and the wait is a list-scheduling
 * simulation over that mean (`estimateWaitSec`). Before the first film finishes
 * there is no mean, `etaSec` is `null`, and the copy says so instead of
 * inventing a figure — an estimate that is wrong by a factor of three is worse
 * than an admission that we do not know yet, because the first one gets
 * believed.
 *
 * Scope is deliberately one process: one box, one Next server. It is pinned to
 * `globalThis` so `next dev`'s hot reload cannot orphan a running render or,
 * worse, hand out a second empty semaphore beside the one holding the leases.
 */

import path from 'node:path';

import type { OnProgress, Storyboard } from '@inkcast/core';
import { isHosted, loadCore, loadPipeline, mediaUrl, projectDir, upsertProject } from './store';

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

/**
 * Where a job sits in the queue, or that it has left it.
 *
 * Sent on the *existing* SSE channel rather than a second one. A separate
 * "queue channel" would need its own connection, its own reconnect logic and
 * its own ordering guarantee against the progress stream, and the first bug it
 * would produce is a client showing "you're #3" underneath a progress bar at
 * 40% because the two channels disagreed about which came first. One ordered
 * stream cannot disagree with itself.
 *
 * `queued: false` is sent exactly once, at the moment a slot is granted; it is
 * how a client leaves the waiting state without having to infer it from the
 * first progress event (which can be seconds later, since the pipeline opens a
 * project and reads caches before it reports anything).
 */
export type QueueEvent = {
  queued: boolean;
  /** 1-based place in the FIFO; `0` once the job has been admitted. */
  position: number;
  /** How many runs of the same class are working ahead of this one. */
  running: number;
  /** Seconds until this job is expected to start, or `null` while unmeasured. */
  etaSec: number | null;
  /**
   * The sentence to show. Written here rather than in the browser so that the
   * SSE stream, `GET /api/generate/<id>` and any future surface (a Slack
   * notifier, the CLI) all say the same thing about the same wait.
   */
  message: string;
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

export type JobEvent = ProgressEvent | QueueEvent | DoneEvent | ErrorEvent;
export type TerminalEvent = DoneEvent | ErrorEvent;

export function isTerminal(event: JobEvent): event is TerminalEvent {
  return 'done' in event || 'error' in event;
}

/* -------------------------------------------------------- admission control */

/**
 * The three kinds of expensive, in the order a run meets them.
 *
 * `lesson` and `voice` are network-bound (Anthropic, then ElevenLabs or the
 * local Kokoro), `render` is Chromium plus ffmpeg. They are separate classes
 * because they exhaust separate resources, and separate *ranks* because a
 * pipeline only ever moves forwards through them.
 */
export type StageClass = 'lesson' | 'voice' | 'render';

/**
 * How many of each class may run at once.
 *
 * Two renders: a render already fans out to four Chromium contexts and four
 * ffmpeg workers, so two of them is eight of each — the point at which a
 * commodity box is fully committed and a third would only steal from the first
 * two. Four cloud stages: those are HTTPS requests that spend their life
 * blocked on somebody else's server, and the ceiling exists to bound spend and
 * socket count, not CPU.
 */
export const CLASS_LIMIT: Record<StageClass, number> = {
  lesson: 4,
  voice: 4,
  render: 2,
};

/**
 * Lease ordering. A job may only acquire a class strictly higher than every
 * class it already holds; see this file's header for why that is the whole
 * deadlock argument.
 */
const CLASS_RANK: Record<StageClass, number> = { lesson: 0, voice: 1, render: 2 };

/** How many finished leases the rolling mean remembers, per class. */
const SAMPLE_WINDOW = 8;

/** What the holder of a slot gives back. Releasing twice is a no-op. */
export type Lease = {
  /**
   * `'ok'` folds this lease's duration into the class mean; `'failed'` does not.
   * A render that died after nine seconds because ffmpeg was missing is not
   * evidence about how long a render takes, and letting it in would tell the
   * next person in line to expect a nine-second wait.
   */
  release: (outcome?: 'ok' | 'failed') => void;
};

/** A waiter's view of its own place in line. */
export type QueueView = {
  cls: StageClass;
  /** 1-based. */
  position: number;
  running: number;
  etaSec: number | null;
};

/**
 * The synchronous answer to "may I run?".
 *
 * Deliberately not a bare promise: the *uncontended* case has to be
 * distinguishable without awaiting, because `startJob` has to report a truthful
 * status in the response it returns to the caller, and "queued" for a job that
 * started immediately would be a lie the studio then has to render.
 */
export type Admission = { lease: Lease } | { wait: Promise<Lease>; view: QueueView };

export type Scheduler = {
  acquire: (cls: StageClass, id: string, onQueue?: (view: QueueView) => void) => Admission;
  /** Vacate a *waiting* job. Returns false when it was not in a queue. */
  cancel: (id: string) => boolean;
  depth: (cls: StageClass) => { running: number; waiting: number };
  /** Rolling mean lease duration in seconds, or null before the first sample. */
  meanSec: (cls: StageClass) => number | null;
  /** Fold a measured duration in directly. Exists for tests and for recovery. */
  record: (cls: StageClass, ms: number) => void;
  /** Which classes `id` currently holds, lowest rank first. */
  held: (id: string) => StageClass[];
};

export type SchedulerOptions = {
  limits?: Partial<Record<StageClass, number>>;
  /** Injectable clock, so the tests do not have to spend real seconds. */
  now?: () => number;
  samples?: number;
};

/** Thrown into a waiter's `wait` promise when the job is cancelled in the queue. */
export class QueueCancelled extends Error {
  constructor(id: string) {
    super(`the run for "${id}" was cancelled while it was waiting in the queue`);
    this.name = 'QueueCancelled';
  }
}

type Slot = { id: string; startedAt: number };

type Waiter = {
  id: string;
  grant: (lease: Lease) => void;
  reject: (err: unknown) => void;
  onQueue?: (view: QueueView) => void;
  /** Last view handed to `onQueue`, so an unchanged queue emits nothing. */
  told?: QueueView;
};

type Pool = {
  limit: number;
  active: Slot[];
  /** FIFO. Pushed at the tail, taken from the head, and never reordered. */
  waiting: Waiter[];
  /** Durations in ms, oldest first, capped at `samples`. */
  samples: number[];
};

export function createScheduler(options: SchedulerOptions = {}): Scheduler {
  const now = options.now ?? Date.now;
  const window = options.samples ?? SAMPLE_WINDOW;

  const pools: Record<StageClass, Pool> = {
    lesson: pool(options.limits?.lesson ?? CLASS_LIMIT.lesson),
    voice: pool(options.limits?.voice ?? CLASS_LIMIT.voice),
    render: pool(options.limits?.render ?? CLASS_LIMIT.render),
  };

  function pool(limit: number): Pool {
    return { limit: Math.max(1, Math.floor(limit)), active: [], waiting: [], samples: [] };
  }

  /** Every class each id holds. Read to enforce the rank rule, and to report. */
  const heldBy = new Map<string, StageClass[]>();

  function meanMs(cls: StageClass): number | null {
    const { samples } = pools[cls];
    if (samples.length === 0) return null;
    return samples.reduce((sum, ms) => sum + ms, 0) / samples.length;
  }

  function record(cls: StageClass, ms: number): void {
    if (!Number.isFinite(ms) || ms <= 0) return;
    const { samples } = pools[cls];
    samples.push(ms);
    if (samples.length > window) samples.splice(0, samples.length - window);
  }

  function viewOf(cls: StageClass, waiter: Waiter): QueueView {
    const p = pools[cls];
    const position = p.waiting.indexOf(waiter) + 1;
    const mean = meanMs(cls);
    const at = now();
    return {
      cls,
      position,
      running: p.active.length,
      etaSec: estimateWaitSec({
        position,
        limit: p.limit,
        meanSec: mean === null ? null : mean / 1000,
        // How much longer each running job has, on the evidence of the mean.
        // Clamped at zero rather than extrapolated: once a render has run past
        // the mean, "any moment now" is the only claim the mean supports.
        remainingSec:
          mean === null ? [] : p.active.map((s) => Math.max(0, (mean - (at - s.startedAt)) / 1000)),
      }),
    };
  }

  /** Tell every waiter whose view moved. Silence means nothing changed. */
  function broadcast(cls: StageClass): void {
    for (const waiter of [...pools[cls].waiting]) {
      if (!waiter.onQueue) continue;
      const view = viewOf(cls, waiter);
      const told = waiter.told;
      if (told && told.position === view.position && told.etaSec === view.etaSec) continue;
      waiter.told = view;
      try {
        waiter.onQueue(view);
      } catch {
        // A waiter whose notifier throws is still a waiter. Losing its place in
        // line because its own callback is broken would be a much worse bug
        // than a missed position update.
      }
    }
  }

  function grant(cls: StageClass, id: string): Lease {
    const p = pools[cls];
    const slot: Slot = { id, startedAt: now() };
    p.active.push(slot);
    const held = heldBy.get(id);
    if (held) held.push(cls);
    else heldBy.set(id, [cls]);

    let released = false;
    return {
      release(outcome: 'ok' | 'failed' = 'ok') {
        if (released) return;
        released = true;
        const at = p.active.indexOf(slot);
        if (at >= 0) p.active.splice(at, 1);
        const mine = heldBy.get(id);
        if (mine) {
          const which = mine.lastIndexOf(cls);
          if (which >= 0) mine.splice(which, 1);
          if (mine.length === 0) heldBy.delete(id);
        }
        if (outcome === 'ok') record(cls, now() - slot.startedAt);
        pump(cls);
      },
    };
  }

  function pump(cls: StageClass): void {
    const p = pools[cls];
    while (p.active.length < p.limit && p.waiting.length > 0) {
      const waiter = p.waiting.shift()!;
      waiter.grant(grant(cls, waiter.id));
    }
    broadcast(cls);
  }

  return {
    acquire(cls, id, onQueue) {
      for (const held of heldBy.get(id) ?? []) {
        if (CLASS_RANK[held] >= CLASS_RANK[cls]) {
          // Not a wait: a wait here is a deadlock with extra steps, since the
          // slot this job is holding is one of the slots it is waiting for.
          throw new Error(
            `"${id}" already holds a ${held} slot and cannot also take a ${cls} one — ` +
              'stage leases must be acquired in order (lesson, voice, render)',
          );
        }
      }

      const p = pools[cls];
      // The empty-queue check is what makes this FIFO rather than
      // barge-in-when-lucky: a free slot goes to the head of the line, never to
      // whoever happened to ask while the line was not looking.
      if (p.waiting.length === 0 && p.active.length < p.limit) {
        return { lease: grant(cls, id) };
      }

      let grantFn: (lease: Lease) => void = () => {};
      let rejectFn: (err: unknown) => void = () => {};
      const wait = new Promise<Lease>((resolve, reject) => {
        grantFn = resolve;
        rejectFn = reject;
      });
      const waiter: Waiter = {
        id,
        grant: grantFn,
        reject: rejectFn,
        ...(onQueue ? { onQueue } : {}),
      };
      p.waiting.push(waiter);
      const view = viewOf(cls, waiter);
      waiter.told = view;
      return { wait, view };
    },

    cancel(id) {
      let vacated = false;
      for (const cls of Object.keys(pools) as StageClass[]) {
        const p = pools[cls];
        const at = p.waiting.findIndex((w) => w.id === id);
        if (at < 0) continue;
        const [waiter] = p.waiting.splice(at, 1);
        vacated = true;
        waiter!.reject(new QueueCancelled(id));
        // Everyone behind the hole moves *forwards*. Nothing moves back: the
        // list is only ever spliced, never reordered, so an index cannot grow.
        broadcast(cls);
      }
      return vacated;
    },

    depth(cls) {
      return { running: pools[cls].active.length, waiting: pools[cls].waiting.length };
    },

    meanSec(cls) {
      const mean = meanMs(cls);
      return mean === null ? null : mean / 1000;
    },

    record,

    held(id) {
      return [...(heldBy.get(id) ?? [])].sort((a, b) => CLASS_RANK[a] - CLASS_RANK[b]);
    },
  };
}

/**
 * When the `position`-th waiter is expected to start, in seconds from now.
 *
 * List scheduling over `limit` identical servers: the queue's head takes the
 * first slot to come free, and every slot that frees is then busy again for one
 * mean duration. Written as a pure function of four numbers so the arithmetic
 * can be checked without a clock, a pool or a fake job — the last time an
 * estimate like this lived inline in the waiting code, the only way to test it
 * was to wait.
 *
 * `null` in, `null` out: with no measured duration there is no honest answer,
 * and the copy is written to survive not having one.
 */
export function estimateWaitSec(input: {
  position: number;
  limit: number;
  meanSec: number | null;
  remainingSec: readonly number[];
}): number | null {
  const { position, limit, meanSec } = input;
  if (meanSec === null || !Number.isFinite(meanSec) || meanSec <= 0) return null;
  if (position < 1) return 0;

  // One entry per server: how long until it is free. A server we have no
  // reading for is treated as free now, which only happens if the queue is
  // non-empty while a slot is idle — a transient the pump closes immediately.
  const slots: number[] = [];
  for (let i = 0; i < Math.max(1, limit); i++) slots.push(input.remainingSec[i] ?? 0);

  for (let nth = 1; nth <= position; nth++) {
    let first = 0;
    for (let i = 1; i < slots.length; i++) if (slots[i]! < slots[first]!) first = i;
    const at = slots[first]!;
    if (nth === position) return Math.max(0, Math.round(at));
    slots[first] = at + meanSec;
  }
  return null;
}

/**
 * A wait, in words, rounded to the precision the estimate actually has.
 *
 * Never a countdown in seconds. The mean it comes from has a spread of tens of
 * seconds, so "4:37" would be a claim about a number we do not have; "about 5
 * minutes" is the same number told to the accuracy it deserves.
 */
export function waitCopy(sec: number): string {
  if (sec < 45) return 'under a minute';
  if (sec < 90) return 'about a minute';
  if (sec < 90 * 60) return `about ${Math.round(sec / 60)} minutes`;
  return 'over an hour';
}

/**
 * The sentence a waiting client is shown.
 *
 * The honest wait math *is* the product here, so the copy leads with the
 * number and never apologises for it: somebody who can see they are fourth and
 * that fourth means six minutes can decide to make a coffee. Somebody looking
 * at "Please wait…" can only decide whether the page is broken.
 */
export function queueCopy(view: QueueView): string {
  const place = view.position <= 1 ? "You're next in line" : `You're #${view.position} in line`;
  if (view.etaSec === null) {
    return (
      `${place}. This box draws ${CLASS_LIMIT.render} films at a time and has not finished ` +
      'one yet, so there is no measured wait to quote you — the estimate appears here as ' +
      'soon as there is one.'
    );
  }
  return `${place} — ${waitCopy(view.etaSec)}.`;
}

/* --------------------------------------------------------------------- jobs */

export type JobKind = 'cast' | 'rerender';

/**
 * `queued` is a first-class state, not a flavour of running.
 *
 * `/api/health` already counts it (see `queueDepth` there), the studio renders a
 * different screen for it, and `isRunning` deliberately covers both: a queued
 * project is every bit as un-editable and un-deletable as one being rendered,
 * and treating it as idle would let a second `POST /api/generate` start a
 * duplicate run for a project already in line.
 */
export type JobStatus = 'queued' | 'running' | 'done' | 'error';

/** What a job's `run` callback must hand back so we can finish bookkeeping. */
export type JobOutcome = {
  /** Absolute or project-relative; normalised to project-relative here. */
  videoPath: string;
  storyboard?: Storyboard;
  costUsd?: number;
  title?: string;
};

/**
 * What a run can ask of the scheduler while it is working.
 *
 * The second argument to a job's `run`, so that the existing one-parameter
 * callbacks keep compiling untouched — this is additive on purpose, since the
 * routes that own those callbacks are not this change's to edit.
 */
export type JobContext = {
  /**
   * Hold one slot of `cls` for exactly as long as `fn` runs.
   *
   * The class must rank above everything the job already holds; see the header.
   * The duration is folded into the class mean only when `fn` resolves.
   */
  lease: <T>(cls: StageClass, fn: () => Promise<T>) => Promise<T>;
};

export type JobRunner = (onProgress: OnProgress, ctx: JobContext) => Promise<JobOutcome>;

/** The serialisable view of a job, for `GET /api/generate/[id]`. */
export type JobSnapshot = {
  projectId: string;
  kind: JobKind;
  status: JobStatus;
  startedAt: string;
  finishedAt?: string;
  progress?: ProgressEvent;
  /** The latest admission event: where it sits, or that it was admitted. */
  queue?: QueueEvent;
  result?: DoneEvent;
  error?: ErrorEvent;
};

type Listener = (event: JobEvent) => void;

type Job = {
  projectId: string;
  kind: JobKind;
  status: JobStatus;
  /** The class held for the whole run. See the header on why `cast` is render. */
  hold: StageClass;
  startedAt: number;
  finishedAt?: number;
  /** Coalesced progress history, capped — see HISTORY_CAP. */
  history: ProgressEvent[];
  /**
   * The latest queue event, kept as one slot rather than appended to `history`.
   *
   * This is the whole reason a late subscriber gets a *correct* position: replay
   * of a queue log would walk a new client through "#7, #6, #5" before telling
   * it the truth, and the first number it rendered would be the stalest one.
   * One overwritten slot can only ever replay the current answer.
   */
  queue?: QueueEvent;
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

/**
 * Which pool a job of each kind holds for its whole life.
 *
 * `rerender` is measured, not assumed: an offline re-render
 * (`INKCAST_PROJECTS=… inkcast rerender cardiac8f`) is Playwright plus ffmpeg
 * for ~222 s and makes zero provider calls, so a render slot is exactly what it
 * consumes and holding one costs nothing. `cast` holds one too, for now, and
 * the header explains why that is the conservative reading rather than the
 * right one.
 */
const HOLD_CLASS: Record<JobKind, StageClass> = { cast: 'render', rerender: 'render' };

const registry = ((
  globalThis as typeof globalThis & { __inkcastJobs?: Map<string, Job> }
).__inkcastJobs ??= new Map<string, Job>());

/**
 * The process-wide scheduler.
 *
 * Pinned to `globalThis` for the same reason as the registry, and with more at
 * stake: an HMR reload that produced a second scheduler would produce a second
 * set of empty pools, and two pools of two renders each is four renders on a box
 * sized for two — the exact failure the semaphore exists to prevent, arriving
 * silently and only under `next dev`.
 */
const scheduler = ((
  globalThis as typeof globalThis & { __inkcastScheduler?: Scheduler }
).__inkcastScheduler ??= createScheduler());

/** Queue depth per class, for `/api/health` and for operators. */
export function queueDepth(cls: StageClass = 'render'): { running: number; waiting: number } {
  return scheduler.depth(cls);
}

/** Measured mean duration of a completed lease of `cls`, in seconds. */
export function measuredMeanSec(cls: StageClass = 'render'): number | null {
  return scheduler.meanSec(cls);
}

/* ------------------------------------------------------------------ control */

/**
 * Start a run for `projectId`, unless one is already in flight or in line.
 *
 * Returns `{ started: false }` when an existing run was reused — the caller
 * turns that into a 409 or simply hands back the same id, depending on whether
 * re-requesting the same work is a mistake. The returned snapshot already
 * carries the truthful state: a job that had to queue says `queued` and carries
 * its position, so the 202 response can tell the client where it stands before
 * it has even opened the stream.
 */
export function startJob(
  projectId: string,
  kind: JobKind,
  run: JobRunner,
  options: { hold?: StageClass } = {},
): { snapshot: JobSnapshot; started: boolean } {
  sweep();
  const existing = registry.get(projectId);
  if (existing && isActive(existing)) {
    return { snapshot: snapshotOf(existing), started: false };
  }

  const job: Job = {
    projectId,
    kind,
    // Corrected synchronously by `execute` below, which either takes a slot or
    // reports the wait before it awaits anything. `queued` is the truthful
    // starting state: nothing has been admitted at the moment this object exists.
    status: 'queued',
    hold: options.hold ?? HOLD_CLASS[kind],
    startedAt: Date.now(),
    history: [],
    listeners: new Set(),
    promise: Promise.resolve(),
  };
  registry.set(projectId, job);

  job.promise = execute(job, run);
  return { snapshot: snapshotOf(job), started: true };
}

/**
 * Cancel a run that has not started yet.
 *
 * Only a *queued* job can be cancelled, and that limit is honest rather than
 * lazy: nothing in the pipeline is abortable today — no Chromium context, no
 * ffmpeg child and no in-flight provider request takes a signal — so a
 * "cancel" on a running render would return true, leave the work running, and
 * hand the user a lie plus a slot that never frees. Vacating a queued job, by
 * contrast, is exact: the waiter leaves the list, everyone behind it moves
 * forwards, and no slot was ever taken.
 */
export function cancelJob(projectId: string): boolean {
  const job = registry.get(projectId);
  if (!job || job.status !== 'queued') return false;
  return scheduler.cancel(projectId);
}

async function execute(job: Job, run: JobRunner) {
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

  const context: JobContext = {
    lease: async <T>(cls: StageClass, fn: () => Promise<T>): Promise<T> => {
      const admission = scheduler.acquire(cls, job.projectId, (view) => publishQueue(job, view));
      let lease: Lease;
      if ('lease' in admission) {
        lease = admission.lease;
      } else {
        publishQueue(job, admission.view);
        lease = await admission.wait;
        publishAdmitted(job, cls);
      }
      try {
        const value = await fn();
        lease.release('ok');
        return value;
      } catch (err) {
        lease.release('failed');
        throw err;
      }
    },
  };

  /* ------------------------------------------------------------- admission */

  const admission = scheduler.acquire(job.hold, job.projectId, (view) => publishQueue(job, view));
  let lease: Lease;
  if ('lease' in admission) {
    job.status = 'running';
    lease = admission.lease;
  } else {
    job.status = 'queued';
    publishQueue(job, admission.view);
    try {
      lease = await admission.wait;
    } catch (err) {
      // The only way `wait` rejects is `cancelJob`, and a cancellation is not a
      // failure of the run — it is the answer to a request. It is still terminal,
      // because the client is waiting on this stream for an answer either way.
      const message =
        err instanceof QueueCancelled
          ? 'This film was cancelled while it was waiting in the queue, so nothing was rendered.'
          : `the run could not be admitted: ${err instanceof Error ? err.message : String(err)}`;
      await upsertProject(job.projectId, { status: 'failed', error: message }).catch(() => {});
      finish(job, 'error', { error: message, stage: 'queue' });
      return;
    }
    job.status = 'running';
    publishAdmitted(job, job.hold);
  }

  /* ------------------------------------------------------------- the work */

  try {
    const outcome = await run(onProgress, context);
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

    // Released before the index write, not after: the index write is filesystem
    // work of milliseconds, but it is also the one step here that can retry and
    // block, and a slot held across it is a slot the next person waits for on
    // no compute at all.
    lease.release('ok');

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
    // A failure must give the slot back, and it must give it back before we go
    // anywhere near the filesystem or the pipeline module: `describeFailure`
    // dynamic-imports `@inkcast/pipeline` to find the root cause, and a slot
    // held across a module load is a queue that stalls on a *crash*, which is
    // the moment a queue most needs to keep moving.
    lease.release('failed');
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

/* ------------------------------------------------------------- queue events */

/**
 * Publish where this job stands.
 *
 * No clamping of `position` here, deliberately. The FIFO is append-at-tail and
 * splice-only, so an index can only ever fall, and a defensive `Math.min` would
 * mean a future change that broke that invariant showed up as a *frozen* number
 * instead of a failing test. The browser clamps instead
 * (`lib/use-generation.ts`), where the enemy is a reconnect replaying a stale
 * event after a live one rather than a wrong queue.
 *
 * The guard is on `terminal`, not on `status`, because a job can wait for a
 * *second* class part-way through its run: with `JobContext.lease`, a job that
 * already holds a lesson slot and is queueing for a renderer is `running` on
 * this side and waiting on the client's. Its position still has to reach the
 * screen, so the only event that must never be published is one for a job that
 * has already been told how it ended.
 */
function publishQueue(job: Job, view: QueueView): void {
  if (job.terminal) return;
  const event: QueueEvent = {
    queued: true,
    position: view.position,
    running: view.running,
    etaSec: view.etaSec,
    message: queueCopy(view),
  };
  job.queue = event;
  emit(job, event);
}

/** The one `queued: false` event: this job has a slot and is starting. */
function publishAdmitted(job: Job, cls: StageClass): void {
  if (job.terminal) return;
  const depth = scheduler.depth(cls);
  const event: QueueEvent = {
    queued: false,
    position: 0,
    running: depth.running,
    etaSec: 0,
    message: 'Your turn — this film is being made now.',
  };
  job.queue = event;
  emit(job, event);
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
 *
 * The queue event goes first, and it is the *current* one: a client that opened
 * its stream ten seconds after asking must be told it is #3 now, not that it was
 * #5 when it asked. Everything after it is chronological, since a job cannot
 * report progress before it was admitted.
 */
export function subscribe(
  projectId: string,
  listener: Listener,
): { unsubscribe: () => void; found: boolean; settled: boolean } {
  sweep();
  const job = registry.get(projectId);
  if (!job) return { unsubscribe: () => {}, found: false, settled: false };

  if (job.queue) listener(job.queue);
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

/**
 * True while a project is queued *or* rendering.
 *
 * Both count. A queued project has no video, is about to be written to, and
 * must not be edited, deleted or started a second time — so every caller that
 * asks "is this busy?" gets the same answer for both states.
 */
export function isRunning(projectId: string): boolean {
  const job = registry.get(projectId);
  return job ? isActive(job) : false;
}

function isActive(job: Job): boolean {
  return job.status === 'queued' || job.status === 'running';
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
    ...(job.queue === undefined ? {} : { queue: job.queue }),
    ...(terminal && 'done' in terminal ? { result: terminal } : {}),
    ...(terminal && 'error' in terminal ? { error: terminal } : {}),
  };
}

/**
 * Drop finished jobs that nobody is reading any more.
 *
 * Called from every entry point rather than on a timer: an interval would keep
 * the dev server's event loop busy and survive HMR as a duplicate, whereas
 * sweeping on access is both cheap and self-limiting. Running *and queued* jobs
 * are never swept, however long they take — a job that has been in line for an
 * hour is exactly the one whose disappearance would be least forgivable.
 */
function sweep(): void {
  const cutoff = Date.now() - RETAIN_MS;
  for (const [id, job] of registry) {
    if (isActive(job)) continue;
    if ((job.finishedAt ?? job.startedAt) < cutoff && job.listeners.size === 0) {
      registry.delete(id);
    }
  }
}

/* ------------------------------------------------------- the hosted format */

/**
 * The one preset a hosted box will render, and the numbers behind the choice.
 *
 * A queue is a budget: at two renders at a time, the *only* lever on how long
 * the tenth person waits is how long each film takes. `standard` targets 150
 * seconds of video and renders every frame of it; `explainer` targets 75, over
 * at most eight beats, with a wiping board (see the essay on
 * `packages/planner/src/presets.ts`) — so it is not merely half the render, it
 * is half the render of a film that was designed to be watched by somebody who
 * has not decided yet whether they trust us. Capping the hosted path to it
 * halves every wait in the queue, and it is the reason the estimate this module
 * quotes can stay in single-digit minutes at depth ten.
 *
 * Local runs are untouched: the person pasting the text is the person paying for
 * the tokens and waiting for their own CPU, and `standard` is still the right
 * default there. That is the whole reason this is a function of `isHosted()`
 * rather than a change to `resolvePreset`.
 */
export const HOSTED_PRESET = 'explainer' as const;

/** `PRESETS.explainer.maxSeconds` — quoted in copy, so it lives beside it. */
export const HOSTED_PRESET_SEC = 75;

/**
 * The `preset` to merge into a `CastInput` on this deployment.
 *
 * An object rather than a bare string so a caller can spread it: `{}` locally
 * means "say nothing and let the CLI-shaped defaults stand", which is exactly
 * what the studio wants, and it composes without a conditional at the call site.
 */
export function hostedFormat(hosted: boolean = isHosted()): { preset?: typeof HOSTED_PRESET } {
  return hosted ? { preset: HOSTED_PRESET } : {};
}

/* -------------------------------------------------------------------- paths */

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
