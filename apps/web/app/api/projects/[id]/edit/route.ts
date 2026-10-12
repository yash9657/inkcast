/**
 * `POST /api/projects/<id>/edit` — patch a storyboard from plain English.
 *
 * Returns the new storyboard. It does **not** re-render: the client decides when
 * to spend minutes of compute, and it is common to make three edits and render
 * once. Call `/rerender` when ready.
 *
 * Works with no API key — the pipeline falls back to its pattern-matched local
 * instruction parser, and the response says which path was taken via `via`, so
 * the UI can be honest about the difference.
 *
 * Owner-only, and it draws on the cheap half of the daily budget. An edit that
 * reaches Anthropic is a real (small) spend and an edit that does not still
 * rewrites a storyboard on our disk, so it is one of the ten daily "operations"
 * rather than one of the three films — which is precisely the split
 * `ratelimit.ts` exists to express.
 */

import {
  badRequest,
  conflictingJob,
  fail,
  json,
  parseJsonBody,
  tooManyRequests,
  unavailableOnBlob,
  unexpected,
  unprocessable,
} from '../../../_lib/http';
import { admit } from '../../../_lib/ratelimit';
import { EditBody } from '../../../_lib/schemas';
import { requireOwner, resolveIdentity, setSessionCookie } from '../../../_lib/session';
import {
  blobStorage,
  isValidProjectId,
  loadPipeline,
  readProjectStoryboard,
  upsertProject,
} from '@/lib/store';
import { hydrateEnv } from '@/lib/keys';
import { isRunning } from '@/lib/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!isValidProjectId(id)) return badRequest(`"${id}" is not a valid project id`);
    if (blobStorage()) return unavailableOnBlob('Editing');

    /*
     * The order here is: cheapest refusal, then identity, then the charge.
     *
     * The probe reads headers only and spends nothing, so a client that is out
     * of budget is turned away before this route touches the filesystem. The
     * token is taken further down, once the edit is known to be one we would
     * actually perform — a 400 from a malformed body, a 403 from the ownership
     * check, a 409 from a running render and the 422 for a project with no
     * storyboard all land *above* the charge and cost nothing. This mirrors
     * `generate/route.ts`, which probes on headers and charges at the point of
     * commitment for the same reason.
     *
     * The one refusal that *is* charged is the 422 further down, where the
     * pipeline could not map the instruction onto an edit. That is deliberate
     * and it was checked rather than assumed: with a key set, `editProject`
     * asks Claude first and only falls back to the pattern parser when that
     * call fails, so by the time an `EditError` exists a real (small) provider
     * call has already been billed. A measured run of eleven of these against
     * one address returned ten 422s and then a 429 naming the `total` ceiling —
     * i.e. the unparseable instruction does spend, which is the honest answer.
     * Making it free would hand anyone a free unlimited channel to the Claude
     * edit prompt simply by sending instructions nothing can parse.
     */
    const probe = admit(request.headers, 'operation', { spend: false });
    if (!probe.allowed) return tooManyRequests(probe);

    // Identity, then ownership — two different questions, and a mutating route
    // needs both. `resolveIdentity` refuses a signed-out caller on a deployment
    // with accounts; `requireOwner` decides whether *this* identity may touch
    // *this* project. Never `readSession` on a gated route: it mints a fresh
    // anonymous identity for a caller with no cookie, which is right on a laptop
    // and is a hole here.
    const who = await resolveIdentity(request);
    if (!who.ok) return fail(who.status, who.message);
    const session = who.session;
    const verdict = await requireOwner(id, session);
    if (!verdict.ok) return setSessionCookie(fail(verdict.status, verdict.message), session);

    // The voice and render stages read the storyboard as they go; rewriting it
    // underneath them would produce a video that matches neither version.
    if (isRunning(id)) return setSessionCookie(conflictingJob(id), session);

    const parsed = await parseJsonBody(request, EditBody);
    if (!parsed.ok) return parsed.response;

    if (!(await readProjectStoryboard(id))) {
      return setSessionCookie(
        unprocessable(
          `project "${id}" has no storyboard yet — it has not finished planning, so there is nothing to edit`,
        ),
        session,
      );
    }

    // The point of commitment: from here the request either rewrites a
    // storyboard or fails inside the pipeline, and either way it has consumed
    // real work. Charged once, on the same headers the probe read.
    const admission = admit(request.headers, 'operation');
    if (!admission.allowed) return tooManyRequests(admission);

    /*
     * Stored keys into the environment before the pipeline reads them — the same
     * defect as `/api/generate`, and here it has a name the response prints.
     * `editProject` asks Claude when `ANTHROPIC_API_KEY` is set and falls back to
     * the pattern parser when it is not, and reports which happened as `via`. On a
     * server process that had not served the settings page, the key never reached
     * `process.env`, so every edit took the local path and the response said
     * `via: 'local'` — truthfully, about a choice nobody made.
     *
     * No `withKeys` here: this route does its work inline rather than as a job, so
     * there is no later moment to hydrate for.
     */
    await hydrateEnv();

    const pipeline = await loadPipeline();
    let result: Awaited<ReturnType<typeof pipeline.editProject>>;
    try {
      result = await pipeline.editProject(id, parsed.data.instruction);
    } catch (err) {
      // An instruction the local parser could not map onto an edit operation is
      // a 422 with the pipeline's own usage hint attached — the user needs to
      // rephrase, not retry.
      if (err instanceof Error && err.name === 'EditError') {
        return setSessionCookie(
          unprocessable(err.message, pipeline.EDIT_USAGE_HINT.split('\n').filter(Boolean)),
          session,
        );
      }
      throw err;
    }

    /*
     * Refresh the descriptive fields only. `status` is deliberately left alone:
     * an edit does not make an unrendered project ready, and stamping 'ready'
     * here would advertise a video that does not exist. Any existing mp4 still
     * plays, it is just stale — which is what `needsRerender` says.
     */
    await upsertProject(id, {
      title: result.storyboard.title,
      scenes: result.storyboard.scenes.length,
      aspect: result.storyboard.meta.aspect,
    });

    return setSessionCookie(
      json({
        storyboard: result.storyboard,
        /** One line per change, ready to show as a diff summary. */
        applied: result.applied,
        /** `anthropic` when a key was set and the call succeeded, else `local`. */
        via: result.via,
        /** True whenever an edit lands: the existing mp4 is now stale. */
        needsRerender: true,
        /**
         * Operations left in today's budget, so the studio can warn before the
         * refusal. Omitted when the limiter is off or was bypassed, where
         * `remaining` is `Infinity` and `JSON.stringify` would turn it into
         * `null` — which a client would read as none left.
         */
        ...(Number.isFinite(admission.remaining)
          ? { operationsLeftToday: admission.remaining }
          : {}),
      }),
      session,
    );
  } catch (err) {
    return unexpected('edit storyboard', err);
  }
}
