/**
 * `job.json` — a run's progress, written where any instance can read it.
 *
 * On a single box the studio's job registry (`apps/web/lib/jobs.ts`) keeps a run's
 * progress in memory and fans it out to SSE listeners. On a stateless host the
 * request that starts a run, the request that streams its progress and the
 * container that does the work are three different instances, so the registry's
 * job is split: the render service writes this document as it goes, and the
 * studio's stream route polls it. The event shapes inside it are the registry's
 * own (`ProgressEvent`, `QueueEvent`, `DoneEvent`, `ErrorEvent`), so the browser
 * cannot tell which of the two it is talking to.
 */

import { z } from 'zod';

import { readJson, writeJson } from './blob.js';
import { JOB_BLOB, projectKey } from './config.js';

export const ProgressSchema = z.object({
  stage: z.string(),
  pct: z.number(),
  note: z.string().optional(),
  stagePct: z.number().optional(),
});

export const QueueSchema = z.object({
  queued: z.boolean(),
  position: z.number(),
  running: z.number(),
  etaSec: z.number().nullable(),
  message: z.string(),
});

/** Everything the studio's project record needs from a finished run. */
export const ResultSchema = z.object({
  videoPath: z.string(),
  durationSec: z.number().optional(),
  title: z.string().optional(),
  scenes: z.number().optional(),
  costUsd: z.number().optional(),
  aspect: z.string().optional(),
  grounding: z.enum(['document', 'parametric', 'supplied']).optional(),
  lanes: z.object({ unserved: z.array(z.string()) }).optional(),
});

export const FailureSchema = z.object({ error: z.string(), stage: z.string().optional() });

export const JobStateSchema = z.object({
  version: z.literal(1),
  projectId: z.string(),
  kind: z.enum(['cast', 'rerender']),
  status: z.enum(['queued', 'running', 'done', 'error']),
  startedAt: z.string(),
  /** Bumped by every write, including heartbeats. Staleness is measured from it. */
  updatedAt: z.string(),
  finishedAt: z.string().optional(),
  progress: ProgressSchema.optional(),
  queue: QueueSchema.optional(),
  result: ResultSchema.optional(),
  failure: FailureSchema.optional(),
});

export type JobState = z.infer<typeof JobStateSchema>;
export type JobProgress = z.infer<typeof ProgressSchema>;
export type JobQueue = z.infer<typeof QueueSchema>;
export type JobResult = z.infer<typeof ResultSchema>;
export type JobFailure = z.infer<typeof FailureSchema>;

/**
 * How long an unfinished job may go without a write before it is presumed dead.
 *
 * The render service heartbeats every 20 s, so three minutes of silence means the
 * instance is gone — killed at its duration limit, OOM, or a deploy — and nothing
 * will ever write the terminal event. Without this the project would say
 * "rendering" forever and refuse to be deleted.
 */
export const STALE_AFTER_MS = 3 * 60 * 1000;

export function isActiveJob(job: JobState | undefined, now = Date.now()): boolean {
  if (!job) return false;
  if (job.status !== 'queued' && job.status !== 'running') return false;
  return now - Date.parse(job.updatedAt) < STALE_AFTER_MS;
}

/**
 * The job as a reader should see it: an unfinished job that has gone silent is
 * reported as the failure it almost certainly is.
 */
export function settleStale(job: JobState, now = Date.now()): JobState {
  if (job.status !== 'queued' && job.status !== 'running') return job;
  if (now - Date.parse(job.updatedAt) < STALE_AFTER_MS) return job;
  return {
    ...job,
    status: 'error',
    finishedAt: job.updatedAt,
    failure: {
      error:
        'The renderer stopped reporting progress, so this run is presumed lost (it most likely ' +
        'hit the 800-second limit or ran out of memory). Start it again; finished stages are not ' +
        'kept between runs on this deployment.',
      ...(job.progress ? { stage: job.progress.stage } : {}),
    },
  };
}

export async function readJob(prefix: string, id: string): Promise<JobState | undefined> {
  const read = await readJson(projectKey(prefix, id, JOB_BLOB));
  if (!read) return undefined;
  const parsed = JobStateSchema.safeParse(read.value);
  return parsed.success ? parsed.data : undefined;
}

export async function writeJob(prefix: string, job: JobState): Promise<void> {
  await writeJson(projectKey(prefix, job.projectId, JOB_BLOB), {
    ...job,
    updatedAt: new Date().toISOString(),
  });
}

export function newJob(id: string, kind: JobState['kind'], status: JobState['status']): JobState {
  const now = new Date().toISOString();
  return { version: 1, projectId: id, kind, status, startedAt: now, updatedAt: now };
}
