/**
 * `GET /api/generate/<id>/stream` — Server-Sent Events for one run.
 *
 * Each message is a bare JSON object on a `data:` line:
 *
 *   {"stage":"render","pct":62,"note":"frame 1140/1830"}
 *   {"done":true,"projectId":"…","videoPath":"out.mp4","videoUrl":"/api/media/…"}
 *   {"error":"[voice] kokoro model download failed","stage":"voice"}
 *
 * A `done` or `error` message is always last, and the server closes the stream
 * straight after it.
 *
 * ## Why this endpoint always answers 200
 *
 * `EventSource` has no way to read a non-2xx body and reconnects forever when it
 * sees one. A 404 for "that project has no run" would therefore become a silent
 * retry loop rather than a message on screen. So every condition a client could
 * legitimately hit — unknown project, run already finished, server restarted
 * mid-render — is reported as an `error` or `done` event on a 200 stream. Only a
 * malformed id (a bug in the caller, not a state) gets a 4xx.
 */

import { badRequest } from '../../../_lib/http';
import { getProject, isValidProjectId, projectExists } from '@/lib/store';
import { isTerminal, subscribe } from '@/lib/jobs';
import type { JobEvent } from '@/lib/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Comment-line keepalive interval. SSE ignores lines starting with `:`, but the
 * bytes keep intermediaries from timing out a stream that is quiet because a
 * stage is thinking rather than because it died.
 */
const HEARTBEAT_MS = 15_000;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  if (!isValidProjectId(id)) return badRequest(`"${id}" is not a valid project id`);

  const encoder = new TextEncoder();

  /**
   * Hoisted so `cancel()` can release the same resources `start()` acquired.
   * The runtime can drop a stream either by aborting the request signal or by
   * cancelling the stream, and both paths have to unsubscribe.
   */
  let release = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribe: (() => void) | undefined;
      let heartbeat: ReturnType<typeof setInterval> | undefined;

      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // The consumer is gone and `enqueue` threw. Treat it as a disconnect
          // rather than an error: shut down and stop producing.
          closed = true;
          teardown();
        }
      };

      const send = (event: JobEvent) => write(`data: ${JSON.stringify(event)}\n\n`);

      /** Release everything this connection holds. Safe to call repeatedly. */
      const teardown = () => {
        if (heartbeat !== undefined) {
          clearInterval(heartbeat);
          heartbeat = undefined;
        }
        unsubscribe?.();
        unsubscribe = undefined;
        request.signal.removeEventListener('abort', onAbort);
      };
      release = teardown;

      const finish = () => {
        const wasOpen = !closed;
        closed = true;
        teardown();
        if (!wasOpen) return;
        try {
          controller.close();
        } catch {
          /* already closed by the runtime */
        }
      };

      function onAbort() {
        // Client navigated away or closed the tab. The *job* keeps running —
        // only this listener goes. That is the point of the registry: reopening
        // the stream replays what was missed.
        finish();
      }
      request.signal.addEventListener('abort', onAbort, { once: true });

      if (request.signal.aborted) {
        finish();
        return;
      }

      // Flush a preamble so the browser fires `onopen` immediately instead of
      // waiting for the first real event, and set the reconnect backoff.
      write(': inkcast stream open\n\nretry: 3000\n\n');

      const subscription = subscribe(id, (event) => {
        send(event);
        if (isTerminal(event)) finish();
      });

      if (!subscription.found) {
        // No job in this process. Answer from disk instead of hanging: either
        // the video is already there, or there is genuinely nothing running.
        void idleEvent(id).then((event) => {
          send(event);
          finish();
        });
        return;
      }

      // A settled job replayed its terminal event during `subscribe`, which
      // already called `finish`. Nothing is registered, so there is nothing to
      // keep alive.
      if (subscription.settled || closed) {
        finish();
        return;
      }

      unsubscribe = subscription.unsubscribe;
      heartbeat = setInterval(() => write(': ping\n\n'), HEARTBEAT_MS);
    },

    cancel() {
      // The runtime dropped the stream without firing the request's abort
      // signal. Without this the listener and the heartbeat would outlive the
      // connection, which is exactly the leak this endpoint has to avoid.
      release();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Tell nginx and friends not to buffer, which would defeat the whole
      // point by delivering every event at once when the run ends.
      'X-Accel-Buffering': 'no',
    },
  });
}

/**
 * What to tell a client that asked about a run this process is not tracking.
 *
 * Three real cases: the project never existed, the project is finished (a
 * reconnect after the job was swept, or after a server restart), or the project
 * exists but has no video and no job — which is what a dev-server restart
 * mid-render looks like.
 */
async function idleEvent(id: string): Promise<JobEvent> {
  if (!projectExists(id)) return { error: `no project "${id}"` };

  const project = await getProject(id);
  if (project?.videoPath && project.videoUrl) {
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
      project?.error ??
      'no run is in progress for this project — start one with POST /api/generate or /rerender',
  };
}
