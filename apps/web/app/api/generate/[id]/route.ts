/**
 * `GET /api/generate/<id>` — the current state of a run, without a stream.
 *
 * The SSE endpoint is the primary interface; this exists because a single
 * snapshot is the right tool in two cases the stream handles badly: a page that
 * mounts and wants to know whether to open a stream at all, and any client that
 * would rather poll than hold a connection.
 *
 * Owner-only, unlike `GET /api/projects/<id>`, and the asymmetry is deliberate.
 * That route serves the public share page, so it has a shared-viewer path with a
 * redacted record. This one is a *run* report: its whole payload is the job
 * snapshot — stage names, progress notes, and the failure message of the last
 * attempt, which routinely names a provider or an absolute path on the box.
 * There is nothing here a stranger following a link needs, so there is no
 * shared path to write.
 */

import { badRequest, fail, json, unexpected } from '../../_lib/http';
import { requireOwner, resolveIdentity, setSessionCookie } from '../../_lib/session';
import { getJob } from '@/lib/jobs';
import { isValidProjectId, mediaUrl } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!isValidProjectId(id)) return badRequest(`"${id}" is not a valid project id`);

    // A read, but an owner-level one: a job snapshot carries the last failure
    // message, which routinely names a provider or an absolute path on the box.
    // So it is gated like a mutation rather than falling back to a stranger the
    // way `/api/media/<id>/<path…>` does — nothing public fetches this route, and
    // there is no share link that needs it to answer.
    const who = await resolveIdentity(request);
    if (!who.ok) return fail(who.status, who.message);
    const session = who.session;
    /*
     * `requireOwner` answers 404 for a project with nothing on disk, which folds
     * in the old "no job and no project" check — with one difference worth
     * naming: a run that this process registered a moment ago has already had
     * `upsertProject` write its `meta.json`, so it is found here. A job whose
     * project directory has since been deleted is reported as gone, which is
     * the truth even while the registry still remembers the run.
     */
    const verdict = await requireOwner(id, session);
    if (!verdict.ok) return setSessionCookie(fail(verdict.status, verdict.message), session);

    const job = getJob(id);
    const record = verdict.project;

    return setSessionCookie(
      json({
        projectId: id,
        /**
         * `job` is present only while this process remembers the run. Its absence
         * plus a `project.videoPath` means "finished, some time ago" — which is
         * why both are returned rather than one collapsed status.
         */
        job: job ?? null,
        project: {
          ...record,
          ...(record.videoPath ? { videoUrl: mediaUrl(id, record.videoPath) } : {}),
        },
      }),
      session,
    );
  } catch (err) {
    return unexpected('generate status', err);
  }
}
