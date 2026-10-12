/**
 * `GET /api/projects` — the studio's library.
 *
 * Merges the on-disk projects with the in-process job registry, so the list
 * shows both a video `pnpm cast` produced an hour ago and a render that started
 * ten seconds ago and has written nothing yet.
 *
 * ## Whose library
 *
 * The listing is scoped to the calling session's owner tag (plan item D3). This
 * is the one route where getting that wrong is invisible in testing and obvious
 * in production: with no scoping, the first visitor to the hosted box sees every
 * film anybody has made — titles, source excerpts, costs — and the failure looks
 * exactly like a working library. So the filter is not optional, and it is built
 * by `ownedProjectsFilter` rather than assembled here, because a route that
 * passed the raw session id would compare it against stored *digests*, match
 * nothing, and produce an empty library that looks like data loss instead of a
 * bug.
 *
 * `includeUnowned` is left at the store's default (`!accountKeys()`), which is what
 * keeps the local studio whole: every project the CLI ever wrote, and every one
 * that predates ownership, has no owner recorded, and hiding those from the only
 * person at the machine would empty their library. Hosted, the same default
 * hides projects the deployment cannot attribute — see `listProjects`.
 */

import { fail, json, unexpected } from '../_lib/http';
import { ownedProjectsFilter, resolveIdentity, setSessionCookie } from '../_lib/session';
import { blobStorage, listProjects } from '@/lib/store';
import { listJobs } from '@/lib/jobs';
import type { JobSnapshot } from '@/lib/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    // The library is the studio's landing request, so on a deployment without
    // accounts it is also where a first-time visitor picks up the cookie that will
    // own everything they make next. Minting there rather than only in
    // `/api/generate` means the identity exists before the first film does, and a
    // generation that races the cookie cannot end up unattributed.
    //
    // A refusal rather than an empty list when Clerk is configured and nobody is
    // signed in, and the difference is not cosmetic. An empty list is a *claim*:
    // it says "you have no projects", and a signed-out request that is answered
    // with one tells somebody holding a hundred films that they have none. It also
    // hands a signed-out browser a durable anonymous identity that would then own
    // whatever it made next — the second library per person that
    // `resolveIdentity`'s docstring refuses to create. 401 says the true thing.
    const who = await resolveIdentity(request);
    if (!who.ok) return fail(who.status, who.message);
    const session = who.session;
    const projects = await listProjects(ownedProjectsFilter(session));
    // Explicit type arguments: inferring them from `map` would produce
    // `Map<string | JobSnapshot, …>`, because an array literal widens to an array
    // rather than the tuple the Map constructor wants.
    // With Blob storage there is no registry in this process; `listProjects` has
    // already reconciled each in-flight record against its `job.json`.
    const byId = new Map<string, JobSnapshot>(
      blobStorage() ? [] : listJobs().map((job) => [job.projectId, job]),
    );

    return setSessionCookie(
      json({
        projects: projects.map((project) => {
          const job = byId.get(project.id);
          return {
            ...project,
            // The registry is the only thing that knows a render is happening
            // *right now*, and the percentage it is at. It is keyed by project
            // id and holds every run on the box, so it is read only for ids the
            // owner filter above already admitted — otherwise this join would
            // hand back the progress of a stranger's render.
            ...(job
              ? {
                  status: job.status === 'running' ? ('running' as const) : project.status,
                  ...(job.progress ? { progress: job.progress } : {}),
                }
              : {}),
          };
        }),
        count: projects.length,
      }),
      session,
    );
  } catch (err) {
    return unexpected('list projects', err);
  }
}
