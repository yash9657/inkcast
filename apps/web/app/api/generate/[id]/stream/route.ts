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
 * ## Owner-only, said in the stream rather than in the status line
 *
 * A run's events are the owner's: progress notes carry stage names and the
 * terminal `error` carries a pipeline failure message, which routinely names a
 * provider or a path on the box. But a 403 would break the contract below — the
 * client cannot read the body of a non-2xx `EventSource` response, so a refusal
 * would surface as an unexplained connection error and a reconnect loop. So the
 * refusal is delivered the same way every other condition is: one `error` event
 * on a 200 stream that then closes, which the client already knows how to
 * display. It is the *terminal* event, so a client that closes on `error` (which
 * the studio's hook does) stops there.
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
import { requireOwner, resolveIdentity, sessionCookieHeader } from '../../../_lib/session';
import type { Session } from '../../../_lib/session';
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

  /*
   * Identity before ownership, and a signed-out caller is refused — this stream
   * carries the run's live progress and its failure messages, which name
   * providers and absolute paths on the box.
   *
   * The refusal is delivered as a one-shot `error` *event* on a 200 rather than as
   * a 401, which is this route's existing convention and not an exception made for
   * auth: `EventSource` cannot read the body of a non-2xx response, so a 401 would
   * reach the browser as an `onerror` with no message and the studio would show a
   * spinner that never resolves. The same reasoning already applies to the 403
   * below (`verdict.message` on a 200), and splitting the two would mean this one
   * route reported permission failures two different ways. Nothing is disclosed by
   * the 200: the body is the sentence "sign in to continue" and no project state is
   * read before this line.
   *
   * No session is passed to the refusal, and `oneShot` takes none — see its
   * docstring. Nothing is minted, nothing is set, and there is no `who.stranger`
   * anywhere in this file for an audit to have to reason about.
   */
  const who = await resolveIdentity(request);
  if (!who.ok) return oneShot({ error: who.message });
  const session = who.session;

  const verdict = await requireOwner(id, session);
  if (!verdict.ok) return oneShot({ error: verdict.message }, session);

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

  return new Response(stream, { status: 200, headers: sseHeaders(session) });
}

/**
 * The SSE headers, plus the session cookie when this request minted one.
 *
 * A raw `Response` around a `ReadableStream` has no `cookies` helper — which is
 * why `session.ts` exports the header form — and skipping it here would matter:
 * a browser whose first request to the studio is a stream would keep being handed
 * a new session on every subsequent request, and the projects it created would
 * each be owned by an identity it never held.
 */
function sseHeaders(session: Session | undefined): Record<string, string> {
  return {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Tell nginx and friends not to buffer, which would defeat the whole
    // point by delivering every event at once when the run ends.
    'X-Accel-Buffering': 'no',
    ...(session?.fresh ? { 'Set-Cookie': sessionCookieHeader(session) } : {}),
  };
}

/**
 * One event, then end of stream — the refusal path, as a valid SSE body.
 *
 * A plain string body rather than a `ReadableStream`: there is nothing to stream,
 * and a fixed body cannot leak a subscription or a heartbeat. The comment
 * preamble is kept so the client's `onopen` fires before the event arrives,
 * exactly as it does on the real stream, and `retry` is long here because
 * whatever a refused client reconnects for is not going to change.
 */
/**
 * `session` is optional, and the one caller that omits it is the sign-in refusal.
 *
 * There is genuinely no session to attach there — a signed-out caller on a Clerk
 * deployment has no identity and must not be issued one — and the alternative was
 * to hand this the `stranger` session from `resolveIdentity` purely so the
 * parameter had a value. That reads, at every call site and in every audit, as the
 * route granting a stranger identity to an unauthenticated caller. It would not
 * have been (a stranger is `fresh: false`, so `sseHeaders` emits no cookie either
 * way) but "it happens to be inert" is a worse guarantee than "there is nothing
 * there". `app/api/_lib/routes.test.ts` asserts that no gated route mentions
 * `who.stranger` at all, and this is the change that makes that assertion true of
 * this file rather than requiring an exception in it.
 */
function oneShot(event: JobEvent, session?: Session): Response {
  const body = `: inkcast stream open\n\nretry: 60000\n\ndata: ${JSON.stringify(event)}\n\n`;
  return new Response(body, { status: 200, headers: sseHeaders(session) });
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
