/**
 * `POST /api/projects/<id>/share` — publish or unpublish one film.
 *
 * This is the act that plan item D3 makes `/share/<id>` wait for. Everything
 * else in the ownership story is a refusal; this is the one route whose whole
 * job is to *widen* access, so it is the one place where being explicit matters
 * most:
 *
 *  - **Only the owner may call it.** Otherwise "publish" is something a stranger
 *    holding a link can do to somebody else's project, which is worse than the
 *    leak the flag exists to prevent — a private film would become a public URL
 *    on a third party's say-so.
 *  - **It is a POST with a body, not a GET or a link.** A `GET /share` would be
 *    publishable by a prefetching browser, a link scanner, or an `<img>` tag in
 *    an email; state-changing requests do not belong on a method anything is
 *    allowed to speculatively follow.
 *  - **Unsharing is the same route.** `{"shared":false}` retracts, and it
 *    deliberately does not need any of the preconditions publishing needs: if a
 *    film is public and its owner wants it private, nothing about the state of
 *    the box should be able to stand in the way.
 *
 * Sharing is *sticky* across renders. `mergeMeta` in `lib/store.ts` inherits the
 * flag whenever a patch omits it, so a background job that finishes and stamps
 * `status: 'ready'` cannot un-publish a film as a side effect — which is what
 * would happen with a naive full-record write, and it would happen minutes after
 * the request that caused it.
 */

import {
  badRequest,
  fail,
  json,
  parseJsonBody,
  unexpected,
  unprocessable,
} from '../../../_lib/http';
import { ShareBody } from '../../../_lib/schemas';
import { requireOwner, resolveIdentity, setSessionCookie } from '../../../_lib/session';
import { isValidProjectId, setProjectShared } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!isValidProjectId(id)) return badRequest(`"${id}" is not a valid project id`);

    // Identity, then ownership. This route is what makes a film public, so it is
    // the one mutation whose failure mode is a disclosure rather than a loss —
    // and `readSession` would let a caller with no identity at all reach the
    // ownership check with a freshly minted one. Reading a shared project stays
    // open (`GET /api/projects/<id>`); *publishing* one is the owner's act alone.
    const who = await resolveIdentity(request);
    if (!who.ok) return fail(who.status, who.message);
    const session = who.session;
    const verdict = await requireOwner(id, session);
    if (!verdict.ok) return setSessionCookie(fail(verdict.status, verdict.message), session);

    const parsed = await parseJsonBody(request, ShareBody);
    if (!parsed.ok) return parsed.response;
    const { shared } = parsed.data;

    /*
     * A share link has to resolve, and `/share/<id>` is a video page: without an
     * mp4 it renders a title over nothing. Refusing to publish a project that
     * has not finished rendering therefore prevents a dead public URL rather
     * than merely disallowing something odd — and the owner is one re-render
     * away from being able to do it, which is what the message says.
     *
     * `verdict.project` is the merged truth from `readProjectTruth`, so
     * `videoPath` here is the pipeline's own answer to "is there a film", not a
     * status field that a failed run could have left stale.
     */
    if (shared && !verdict.project.videoPath) {
      return setSessionCookie(
        unprocessable(
          `project "${id}" has no finished video yet, so there is nothing to share — render it first and the link will work`,
        ),
        session,
      );
    }

    const record = await setProjectShared(id, shared);
    if (!record) {
      // The directory went away between the ownership check and the write —
      // a concurrent DELETE, or the D5 janitor. Reported as gone rather than as
      // a failure to share, because that is what happened.
      return setSessionCookie(fail(404, `no project "${id}"`), session);
    }

    return setSessionCookie(
      json({
        id,
        shared: record.shared,
        /**
         * The page to hand somebody, or `null` while the film is private.
         *
         * Relative on purpose. The public origin is a deployment fact (the
         * hostname behind Caddy, `NEXT_PUBLIC_INKCAST_BASE_URL`), and a route
         * that guessed it from the `Host` header would happily mint links
         * pointing at whatever an attacker put there — the standard way an
         * absolute URL built from request headers becomes a redirect somebody
         * else controls. The client already knows its own origin.
         */
        shareUrl: record.shared ? `/share/${encodeURIComponent(id)}` : null,
      }),
      session,
    );
  } catch (err) {
    return unexpected('share project', err);
  }
}
