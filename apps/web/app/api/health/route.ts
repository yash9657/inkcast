/**
 * `GET /api/health` — the one endpoint an operator, a load balancer and a
 * container runtime all read.
 *
 * Plan item D5 asks for "queue depth + disk free", and those two numbers are
 * chosen precisely: they are the two ways this box dies. Renders are gated at a
 * small concurrency with a FIFO queue in front of them (D1), so queue depth is
 * the leading indicator of "the wait is now dishonest"; and every finished film
 * leaves an mp4, per-scene wavs and a frame cache behind until the janitor
 * sweeps it, so free disk is the leading indicator of "the next render fails
 * halfway through ffmpeg". CPU and memory are the *symptom* of the first and are
 * better read from the host than from inside the process that is being starved.
 *
 * ## What it deliberately does not say
 *
 * This route is unauthenticated — a healthcheck that needs a session is a
 * healthcheck that reports "unhealthy" during exactly the outage it exists to
 * diagnose. So it leaks nothing that is not already public: no project ids,
 * titles or sources (that is `/api/projects`, which is owner-scoped), no
 * absolute paths (naming the projects directory tells an attacker the layout of
 * the box for no operational gain), no environment values, no provider names or
 * key states, and no client addresses — the rate limiter's tracked-client
 * *count* is a scalar and identifies nobody.
 *
 * ## Why it is 200 even when it is unhappy
 *
 * A Docker `HEALTHCHECK` that fails gets the container restarted. Restarting
 * does not create disk space, and it *does* kill every render in flight and
 * every SSE listener watching one — turning a degraded box into a broken one and
 * losing the work of whoever was mid-generation. So the HTTP status answers only
 * "is this process serving requests", which is the question a restart can
 * actually fix, and `status: 'degraded'` in the body carries the rest for the
 * human or the alert rule that can do something about it. The single exception
 * is a store we cannot read at all, which is a genuine "this instance is not
 * fit to serve" and answers 503.
 */

import { statfs } from 'node:fs/promises';
import path from 'node:path';

import { json, unexpected } from '../_lib/http';
import { limiterEnabled, sharedLimiter } from '../_lib/ratelimit';
import { PROJECTS_DIR, blobStorage } from '@/lib/store';
import { listJobs } from '@/lib/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Below this, refuse to call the box healthy.
 *
 * A 1080p explainer's working set — PNG frame cache, per-scene wavs, the mux
 * output and ffmpeg's own temporaries — runs to a few hundred megabytes for the
 * duration of a render, and two run at once. 2 GiB is therefore roughly "one
 * more film's worth of headroom": enough warning to sweep before anything fails,
 * close enough to the edge that it does not cry wolf.
 */
const LOW_DISK_BYTES = 2 * 1024 * 1024 * 1024;

/** Queue depth past which the honest wait stops being a pleasant number. */
const DEEP_QUEUE = 10;

export async function GET() {
  try {
    // A stateless deployment has no local disk or in-process queue to report on:
    // films live in Blob and renders run in the render service. What can be wrong
    // here is configuration, so that is what is reported.
    if (blobStorage()) {
      const renderService = Boolean(
        (process.env.INKCAST_RENDER_URL?.trim() || process.env.INKCAST_RENDER_ECS?.trim()) &&
        process.env.INKCAST_RENDER_TOKEN?.trim(),
      );
      const blob = Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
      return json({
        status: renderService && blob ? 'ok' : 'degraded',
        storage: 'blob',
        uptimeSec: Math.round(process.uptime()),
        renderService: { configured: renderService },
        blobStore: { configured: blob },
        rateLimit: { enabled: limiterEnabled(), tracked: sharedLimiter().tracked() },
      });
    }
    const queue = queueDepth();
    const disk = await diskFree();

    // An unreadable projects volume is the one condition where the process
    // genuinely cannot do its job: every route below this one reads or writes
    // it. Everything else is a warning with a 200 attached — see the header.
    const status: 'ok' | 'degraded' | 'unavailable' =
      disk === undefined
        ? 'unavailable'
        : disk.freeBytes < LOW_DISK_BYTES || queue.queued >= DEEP_QUEUE
          ? 'degraded'
          : 'ok';

    return json(
      {
        status,
        /** Seconds this process has been up — the cheapest crash-loop detector. */
        uptimeSec: Math.round(process.uptime()),
        queue,
        /** Null rather than an absent key: a monitor's JSON path stays valid. */
        disk: disk ?? null,
        rateLimit: {
          enabled: limiterEnabled(),
          /**
           * Distinct client buckets currently held. A scalar, so it names
           * nobody, and it is the number that says whether the in-process store
           * is anywhere near the bound documented in `ratelimit.ts`.
           */
          tracked: sharedLimiter().tracked(),
        },
      },
      status === 'unavailable' ? 503 : 200,
    );
  } catch (err) {
    return unexpected('health', err);
  }
}

/**
 * Work in flight, from the job registry.
 *
 * `queued` is read structurally rather than as a typed comparison on purpose.
 * D1 adds a `queued` job state and a FIFO in front of the render semaphore;
 * until it lands, `JobStatus` has no such member and a direct `=== 'queued'`
 * would not compile. Reading it through `String()` means this route reports the
 * real depth the moment that state exists and reports a truthful zero before it
 * does — which is better than a health endpoint that has to be edited in the
 * same commit as the queue it watches.
 */
function queueDepth(): { active: number; queued: number; total: number } {
  const jobs = listJobs();
  let active = 0;
  let queued = 0;
  for (const job of jobs) {
    const status = String(job.status);
    if (status === 'running') active += 1;
    else if (status === 'queued') queued += 1;
  }
  return { active, queued, total: active + queued };
}

/**
 * Free space on the volume holding `projects/`.
 *
 * `bavail` (blocks available to an unprivileged process), not `bfree`: on a
 * filesystem with reserved blocks the difference is several gigabytes that this
 * process cannot actually have, and a healthcheck that reports space it cannot
 * use is worse than none. The path itself never leaves this function.
 */
async function diskFree(): Promise<
  { freeBytes: number; totalBytes: number; freePct: number } | undefined
> {
  // `projects/` is created lazily on the first write, so a freshly deployed box
  // has none — and reporting "cannot see the volume" on a healthy new container
  // would fail the very deploy it is meant to certify. The parent directory is
  // on the same filesystem and answers the same question, so it is the fallback;
  // only when neither can be stat'd is the volume genuinely unreadable.
  for (const dir of [PROJECTS_DIR, path.dirname(PROJECTS_DIR)]) {
    try {
      const fs = await statfs(dir);
      const blockSize = Number(fs.bsize);
      const freeBytes = Number(fs.bavail) * blockSize;
      const totalBytes = Number(fs.blocks) * blockSize;
      if (!Number.isFinite(freeBytes) || !Number.isFinite(totalBytes) || totalBytes <= 0) continue;
      return {
        freeBytes,
        totalBytes,
        freePct: Math.round((freeBytes / totalBytes) * 1000) / 10,
      };
    } catch {
      /* try the parent, then give up */
    }
  }
  return undefined;
}
