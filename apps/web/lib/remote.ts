/**
 * Runs on a stateless host: the job registry's job, split across instances.
 *
 * `lib/jobs.ts` assumes one long-lived process — the run is a detached promise in
 * this server, its progress is in this server's memory, and the SSE stream reads
 * it from there. On Vercel none of that holds: a Function instance may be frozen
 * the moment its response is sent, the stream request may land on a different
 * instance from the one that started the run, and Chromium cannot run in a
 * Function anyway. So with `INKCAST_STORAGE=blob` the studio does this instead:
 *
 *  1. `POST /api/generate` writes the project record and a `queued` `job.json`,
 *     answers 202 at once, and — in `after()`, which keeps this invocation alive
 *     up to the route's `maxDuration` — calls the render service
 *     (`apps/render-service`, a Vercel container) and holds that request open
 *     while the film is made.
 *  2. The render service writes progress into `job.json` and the film into Blob.
 *  3. `GET /api/generate/<id>/stream` polls `job.json` and replays it as the very
 *     same SSE events the in-process registry emits, so the browser code is
 *     unchanged.
 *  4. When the render service answers, the dispatcher writes the final project
 *     record. If the dispatcher itself is lost, `store.ts` reconciles the record
 *     from `job.json` on the next read, so a film is never stranded as "running".
 *
 * Queueing is the platform's: Fluid compute scales the render service out, one
 * film per instance. There is no admission control beyond the per-IP limiter and
 * a short retry when the instance reached was busy.
 */

import { after } from 'next/server';

import {
  RenderServiceBusy,
  blobPrefix,
  callRenderService,
  claimJob,
  isActiveJob,
  newJob,
  readJob,
  settleStale,
  writeJob,
  type JobState,
  type RenderInput,
  type RenderRequest,
} from '@inkcast/cloud';

import type { DoneEvent, ErrorEvent, JobEvent, JobSnapshot, QueueEvent } from './jobs';
import { getProject, mediaUrl, patchFromJob, upsertProject } from './store';

/* ------------------------------------------------------------------ reading */

export async function remoteJobState(id: string): Promise<JobState | undefined> {
  const job = await readJob(blobPrefix(), id).catch(() => undefined);
  return job ? settleStale(job) : undefined;
}

/** Same shape as `getJob()` from the in-process registry. */
export async function remoteJob(id: string): Promise<JobSnapshot | undefined> {
  const job = await remoteJobState(id);
  return job ? snapshotOf(job) : undefined;
}

/** Queued or running, and still heartbeating. */
export async function remoteIsRunning(id: string): Promise<boolean> {
  return isActiveJob(await readJob(blobPrefix(), id).catch(() => undefined));
}

function doneEvent(job: JobState): DoneEvent | undefined {
  if (job.status !== 'done' || !job.result) return undefined;
  return {
    done: true,
    projectId: job.projectId,
    videoPath: job.result.videoPath,
    videoUrl: mediaUrl(job.projectId, job.result.videoPath),
    ...(job.result.durationSec === undefined ? {} : { durationSec: job.result.durationSec }),
  };
}

function errorEvent(job: JobState): ErrorEvent | undefined {
  if (job.status !== 'error') return undefined;
  return {
    error: job.failure?.error ?? 'the run failed for an unknown reason',
    ...(job.failure?.stage ? { stage: job.failure.stage } : {}),
  };
}

function snapshotOf(job: JobState): JobSnapshot {
  const result = doneEvent(job);
  const error = errorEvent(job);
  return {
    projectId: job.projectId,
    kind: job.kind,
    status: job.status,
    startedAt: job.startedAt,
    ...(job.finishedAt ? { finishedAt: job.finishedAt } : {}),
    ...(job.progress ? { progress: job.progress } : {}),
    ...(job.queue ? { queue: job.queue } : {}),
    ...(result ? { result } : {}),
    ...(error ? { error } : {}),
  };
}

/* ------------------------------------------------------------------ starting */

const WAITING: QueueEvent = {
  queued: true,
  position: 1,
  running: 0,
  etaSec: null,
  message: 'Starting a renderer — a cold one takes a few seconds to wake up.',
};

/**
 * Start a film on the render service, unless one is already in flight.
 *
 * Mirrors `startJob()`'s contract: the snapshot is the truthful starting state
 * and `started: false` means an existing run was reused.
 */
export async function startRemoteCast(
  id: string,
  input: RenderInput,
  options: {
    force?: boolean;
    resolveProviderEnv?: () => Promise<Record<string, string>>;
    isolated?: boolean;
  } = {},
): Promise<{ snapshot: JobSnapshot; started: boolean }> {
  const prefix = blobPrefix();
  const claim = await claimJob(prefix, { ...newJob(id, 'cast', 'queued'), queue: WAITING });
  if (!claim.started) return { snapshot: snapshotOf(claim.job), started: false };
  const job = claim.job;

  const request: RenderRequest = {
    projectId: id,
    blobPrefix: prefix,
    kind: 'cast',
    input,
    ...(options.force === undefined ? {} : { force: options.force }),
    ...(options.isolated === undefined ? {} : { isolated: options.isolated }),
  };
  // `after` is `waitUntil` on Vercel: the invocation stays alive (and billed for
  // memory, not CPU, while it waits) until the render service answers or the
  // route's `maxDuration` ends it.
  after(() => dispatch(job, request, options.resolveProviderEnv));
  return { snapshot: snapshotOf(job), started: true };
}

/** How long to keep retrying when every instance reached is mid-render. */
const BUSY_RETRY_MS = 3 * 60 * 1000;

async function dispatch(
  job: JobState,
  request: RenderRequest,
  resolveProviderEnv?: () => Promise<Record<string, string>>,
): Promise<void> {
  const prefix = request.blobPrefix;
  const id = request.projectId;
  const baseUrl = (process.env.INKCAST_RENDER_URL ?? '').trim();
  const token = (process.env.INKCAST_RENDER_TOKEN ?? '').trim();

  const fail = async (error: string) => {
    await writeJob(prefix, {
      ...job,
      status: 'error',
      finishedAt: new Date().toISOString(),
      failure: { error, stage: 'queue' },
    }).catch(() => {});
    await upsertProject(id, { status: 'failed', error }).catch(() => {});
  };

  if (!baseUrl || !token) {
    await fail(
      'This deployment has no render service configured (INKCAST_RENDER_URL and INKCAST_RENDER_TOKEN), so nothing can be rendered.',
    );
    return;
  }

  const bypassToken = process.env.INKCAST_RENDER_BYPASS_TOKEN?.trim();
  const deadline = Date.now() + BUSY_RETRY_MS;
  for (let attempt = 1; ; attempt++) {
    try {
      // Resolve on every admission attempt: removal or replacement while waiting
      // for a busy renderer must take effect before a provider is called.
      const admitted = {
        ...request,
        ...(resolveProviderEnv ? { providerEnv: await resolveProviderEnv() } : {}),
      };
      const terminal = await callRenderService(baseUrl, token, admitted, () => {}, {
        ...(bypassToken ? { bypassToken } : {}),
      });
      const settled: JobState =
        terminal.type === 'done'
          ? { ...job, status: 'done', result: terminal.result }
          : { ...job, status: 'error', failure: terminal.failure };
      await upsertProject(id, patchFromJob(settled));
      return;
    } catch (err) {
      if (err instanceof RenderServiceBusy && Date.now() < deadline) {
        job = {
          ...job,
          queue: {
            ...WAITING,
            message: 'Every renderer is busy with another film — trying again in a moment.',
          },
        };
        await writeJob(prefix, job).catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, 5_000 * attempt)));
        continue;
      }
      // A transport failure is not proof the film failed: the render service may
      // still be working and heartbeating `job.json`. Only a silent job is failed.
      const current = await readJob(prefix, id).catch(() => undefined);
      if (current && current.status !== 'queued' && isActiveJob(current)) return;
      if (current && (current.status === 'done' || current.status === 'error')) {
        await upsertProject(id, patchFromJob(current)).catch(() => {});
        return;
      }
      await fail(
        err instanceof RenderServiceBusy
          ? 'Every renderer stayed busy for three minutes, so this film was not started. Try again shortly.'
          : `The render service could not be reached: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
  }
}

/* ------------------------------------------------------------------ streaming */

const POLL_MS = 2_000;
/** Close and let `EventSource` reconnect before the route's 300 s limit. */
const STREAM_LIFETIME_MS = 270_000;
const HEARTBEAT_MS = 15_000;

/**
 * The SSE body for one project, fed from `job.json`.
 *
 * Emits exactly what `subscribe()` would: the current queue event first, then
 * progress as it changes, then one terminal event and close. A stream that
 * outlives `STREAM_LIFETIME_MS` simply ends; the browser's `EventSource`
 * reconnects (the preamble sets `retry: 3000`) and is replayed the current state.
 */
export function remoteEventStream(id: string, signal: AbortSignal): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const write = (chunk: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          open = false;
        }
      };
      const send = (event: JobEvent) => write(`data: ${JSON.stringify(event)}\n\n`);
      const close = () => {
        if (!open) return;
        open = false;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      signal.addEventListener('abort', close, { once: true });

      write(': inkcast stream open\n\nretry: 3000\n\n');
      const until = Date.now() + STREAM_LIFETIME_MS;
      let lastQueue = '';
      let lastProgress = '';
      let lastBeat = Date.now();

      while (open && Date.now() < until) {
        const job = await remoteJobState(id);
        if (!job) {
          send(await idleEvent(id));
          break;
        }
        if (job.queue && JSON.stringify(job.queue) !== lastQueue) {
          lastQueue = JSON.stringify(job.queue);
          send(job.queue);
        }
        if (job.progress && JSON.stringify(job.progress) !== lastProgress) {
          lastProgress = JSON.stringify(job.progress);
          send(job.progress);
        }
        const terminal = doneEvent(job) ?? errorEvent(job);
        if (terminal) {
          send(terminal);
          break;
        }
        if (Date.now() - lastBeat >= HEARTBEAT_MS) {
          write(': ping\n\n');
          lastBeat = Date.now();
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
      close();
    },
  });
}

/** No job document: answer from the project record, as the local stream does. */
async function idleEvent(id: string): Promise<JobEvent> {
  const project = await getProject(id);
  if (!project) return { error: `no project "${id}"` };
  if (project.videoPath && project.videoUrl) {
    return {
      done: true,
      projectId: id,
      videoPath: project.videoPath,
      videoUrl: project.videoUrl,
      durationSec: project.durationSec,
    };
  }
  return {
    error:
      project.error ?? 'no run is in progress for this project — start one with POST /api/generate',
  };
}
