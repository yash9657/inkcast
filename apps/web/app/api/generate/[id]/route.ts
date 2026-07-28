/**
 * `GET /api/generate/<id>` — the current state of a run, without a stream.
 *
 * The SSE endpoint is the primary interface; this exists because a single
 * snapshot is the right tool in two cases the stream handles badly: a page that
 * mounts and wants to know whether to open a stream at all, and any client that
 * would rather poll than hold a connection.
 */

import { badRequest, json, notFound, unexpected } from '../../_lib/http';
import { getJob } from '@/lib/jobs';
import { getProject, isValidProjectId } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!isValidProjectId(id)) return badRequest(`"${id}" is not a valid project id`);

    const job = getJob(id);
    const project = await getProject(id);
    if (!job && !project) return notFound(`no project "${id}"`);

    return json({
      projectId: id,
      /**
       * `job` is present only while this process remembers the run. Its absence
       * plus a `project.videoPath` means "finished, some time ago" — which is
       * why both are returned rather than one collapsed status.
       */
      job: job ?? null,
      project: project ?? null,
    });
  } catch (err) {
    return unexpected('generate status', err);
  }
}
