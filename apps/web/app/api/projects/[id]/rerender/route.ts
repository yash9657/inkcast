/**
 * `POST /api/projects/<id>/rerender` — rebuild the video from the saved storyboard.
 *
 * Same shape as `/api/generate`: returns a project id immediately and the client
 * follows `/api/generate/<id>/stream`, because it is the same job registry and
 * the same progress events. Ingest and plan are skipped, and the voice stage
 * only re-synthesises scenes whose narration actually changed — which is what
 * makes "edit one line, re-render" cheap.
 *
 * Owner-only, and one of the ten daily operations rather than one of the three
 * daily films. That asymmetry is the point of two buckets: a re-render costs a
 * Chromium context and an ffmpeg process but usually no provider call at all
 * (every stage is cached and only changed narration is re-synthesised), so
 * charging it against the film budget would make the edit-and-look loop — the
 * loop that actually makes a video good — the most expensive thing a user can
 * do.
 */

import {
  badRequest,
  fail,
  json,
  parseJsonBody,
  tooManyRequests,
  unexpected,
  unprocessable,
} from '../../../_lib/http';
import { admit } from '../../../_lib/ratelimit';
import { RerenderBody } from '../../../_lib/schemas';
import { requireOwner, resolveIdentity, setSessionCookie } from '../../../_lib/session';
import { isValidProjectId, loadPipeline, readProjectStoryboard, upsertProject } from '@/lib/store';
import { isRunning, startJob } from '@/lib/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!isValidProjectId(id)) return badRequest(`"${id}" is not a valid project id`);

    // Headers-only refusal first, then identity, then the charge — the same
    // order and the same reasoning as `/edit` and `/api/generate`.
    const probe = admit(request.headers, 'operation', { spend: false });
    if (!probe.allowed) return tooManyRequests(probe);

    // Identity, then ownership. A rerender spends a Chromium context and an
    // ffmpeg process, so this is the second-most expensive endpoint in the
    // product and the sign-in requirement applies to it for the same reason it
    // applies to `POST /api/generate`. `readSession` would mint an identity for a
    // caller who has none, which is the hole this replaces.
    const who = await resolveIdentity(request);
    if (!who.ok) return fail(who.status, who.message);
    const session = who.session;
    const verdict = await requireOwner(id, session);
    if (!verdict.ok) return setSessionCookie(fail(verdict.status, verdict.message), session);

    const parsed = await parseJsonBody(request, RerenderBody);
    if (!parsed.ok) return parsed.response;

    const storyboard = await readProjectStoryboard(id);
    if (!storyboard) {
      return setSessionCookie(
        unprocessable(
          `project "${id}" has no storyboard to render — run POST /api/generate for it first`,
        ),
        session,
      );
    }

    /*
     * Charged unless this request is about to join a run that is already in
     * flight, in which case `startJob` hands back the existing job and this
     * request causes no work at all. A double-clicked Re-render button, or the
     * studio's retry after a dropped response, must not cost two operations for
     * one video — the same rule `/api/generate` applies to a repeated cast.
     */
    const admission = isRunning(id) ? probe : admit(request.headers, 'operation');
    if (!admission.allowed) return tooManyRequests(admission);

    await upsertProject(id, {
      status: 'running',
      title: storyboard.title,
      scenes: storyboard.scenes.length,
      aspect: storyboard.meta.aspect,
    });

    const { started } = startJob(id, 'rerender', async (onProgress) => {
      const { rerender } = await loadPipeline();
      const result = await rerender(id, {
        // `rerender` already defaults this to true; passing it through lets a
        // caller ask for the cheap path (`force: false`) explicitly.
        force: parsed.data.force ?? true,
        onProgress,
      });
      return {
        videoPath: result.videoPath,
        storyboard: result.storyboard,
        costUsd: result.cost.usd,
        title: result.storyboard.title,
      };
    });

    return setSessionCookie(
      json(
        {
          projectId: id,
          status: 'running' as const,
          /** False when a run was already in flight and this request joined it. */
          started,
          streamUrl: `/api/generate/${id}/stream`,
          /** See the same field on `/edit`; absent when the limiter is off. */
          ...(Number.isFinite(admission.remaining)
            ? { operationsLeftToday: admission.remaining }
            : {}),
        },
        202,
      ),
      session,
    );
  } catch (err) {
    return unexpected('rerender', err);
  }
}
