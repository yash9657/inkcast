import { guardRequest } from '../../_lib/request-guard';
/**
 * `GET /api/projects/<id>`    — one project, with its storyboard.
 * `DELETE /api/projects/<id>` — remove the project directory and index entry.
 *
 * The GET returns the storyboard inline because every consumer of a single
 * project needs it (the scene list, the editor, the player's chapter marks) and
 * a second round trip for a file that is already on disk earns nothing.
 *
 * ## Two different gates, on purpose
 *
 * `DELETE` is the owner's alone. `GET` is the owner's *or* anybody's once the
 * owner has shared it, because this route is what backs the public
 * `/share/<id>` page: that page is a server component which fetches this
 * endpoint over HTTP without forwarding the visitor's cookies, so it arrives
 * here as a plain stranger and `requireViewable` is exactly the question it
 * needs answered. A consequence worth knowing before it is reported as a bug:
 * on the hosted deployment the *owner* previewing their own unshared
 * `/share/<id>` page also sees the 404 that page renders for a refusal, because
 * the fetch carries no cookie of theirs. That is the honest behaviour — a share
 * page is a promise about what a stranger sees — and it is why the studio's own
 * player reads this route directly from the browser instead.
 *
 * A stranger who may see a shared film still does not get the parts of the
 * record that are the owner's business; see `publicView`.
 */

import { badRequest, conflictingJob, fail, json, notFound, unexpected } from '../../_lib/http';
import {
  requireOwner,
  requireViewable,
  resolveIdentity,
  setSessionCookie,
} from '../../_lib/session';
import {
  blobStorage,
  deleteProject,
  isValidProjectId,
  mediaUrl,
  readProjectStoryboard,
} from '@/lib/store';
import type { ProjectDto, ProjectRecord } from '@/lib/store';
import { getJob, isRunning } from '@/lib/jobs';
import { remoteIsRunning, remoteJob } from '@/lib/remote';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    // A malformed id is a caller bug rather than a permission question, and it
    // is answered before the session is read so that the message stays the same
    // one it always was: the ownership helpers would fold it into "no project",
    // which tells a developer with a typo nothing about the typo.
    if (!isValidProjectId(id)) return badRequest(`"${id}" is not a valid project id`);

    /*
     * The one read path that must never 401, and the reason is two directories
     * away: `app/share/<id>/page.tsx` renders by fetching this endpoint
     * server-side and deliberately does not forward the visitor's cookie, so
     * every share link on the internet arrives here as a signed-out stranger. A
     * `401` on this line would turn all of them into `notFound()` — the single
     * most likely accidental casualty of adding authentication to this app, and
     * one that looks like a rendering bug rather than an auth bug.
     *
     * So a refusal is downgraded to `who.stranger` instead of returned: a freshly
     * minted anonymous session that matches nothing on disk and is marked
     * `fresh: false` so no cookie is set. `requireViewable` then answers the only
     * question a stranger's request can have — has the owner shared this — and
     * that answer is unchanged from before accounts existed. Nothing is *granted*
     * by this line; it exists so the gate does not close on the public surface.
     */
    const who = await resolveIdentity(request);
    const session = who.ok ? who.session : who.stranger;

    const verdict = await requireViewable(id, session);
    if (!verdict.ok) return setSessionCookie(fail(verdict.status, verdict.message), session);

    const mine = verdict.via === 'owner';
    const storyboard = await readProjectStoryboard(id);
    const job = mine ? (blobStorage() ? await remoteJob(id) : getJob(id)) : undefined;

    return setSessionCookie(
      json({
        project: {
          ...(mine ? withVideoUrl(verdict.project) : publicView(verdict.project)),
          ...(job?.status === 'running' ? { status: 'running' as const } : {}),
        },
        /** Null until the plan stage has run. */
        storyboard: storyboard ?? null,
        /**
         * Per-scene audio, as URLs the browser can play. Handy for scrubbing a
         * storyboard before the video exists.
         */
        // Per-scene audio is not kept on a Blob deployment (only the film is), so
        // there are no URLs to hand out there.
        audioUrls:
          storyboard && !blobStorage()
            ? storyboard.scenes.map((scene) =>
                scene.audioPath ? mediaUrl(id, scene.audioPath) : null,
              )
            : [],
        /**
         * The live run, for the owner only. A job snapshot carries the failure
         * message of the last attempt, which routinely contains a provider name
         * or an absolute path on the box — fine for the person who started the
         * render, not something to hand a stranger who followed a link.
         */
        job: job ?? null,
      }),
      session,
    );
  } catch (err) {
    return unexpected('read project', err);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const refused = guardRequest(request);
  if (refused) return refused;
  try {
    const { id } = await context.params;
    if (!isValidProjectId(id)) return badRequest(`"${id}" is not a valid project id`);

    // Gated, unlike the GET above. Nothing fetches DELETE server-side and no
    // share link is a delete, so there is no public caller to protect — and the
    // stranger session the GET falls back to would be worse than useless here: it
    // matches nothing, so every delete would 403 with a message about a different
    // session rather than saying "sign in".
    const who = await resolveIdentity(request);
    if (!who.ok) return fail(who.status, who.message);
    const session = who.session;

    // Ownership before the running-job check, so that "a render is in progress"
    // is not something a stranger can learn about a project that is not theirs.
    const verdict = await requireOwner(id, session);
    if (!verdict.ok) return setSessionCookie(fail(verdict.status, verdict.message), session);

    // Deleting the directory under a running render would make the pipeline fail
    // in a confusing place. Refuse instead, and say why.
    if (blobStorage() ? await remoteIsRunning(id) : isRunning(id)) {
      return setSessionCookie(conflictingJob(id), session);
    }

    const removed = await deleteProject(id);
    // `requireOwner` already found a record, so a false here means the directory
    // was gone before we got to it — a double-clicked delete, or a janitor
    // sweep. Still a 404, because "there is nothing there now" is the truth.
    if (!removed) return setSessionCookie(notFound(`no project "${id}"`), session);
    return setSessionCookie(json({ ok: true, id }), session);
  } catch (err) {
    return unexpected('delete project', err);
  }
}

/**
 * A record is not a DTO: `videoUrl` is derived, and `readProjectTruth` (which
 * the ownership check goes through) hands back the record. Rebuilt here rather
 * than by calling `getProject` a second time, which would repeat the whole disk
 * scan to learn something already in hand.
 */
function withVideoUrl(record: ProjectRecord): ProjectDto {
  return {
    ...record,
    ...(record.videoPath ? { videoUrl: mediaUrl(record.id, record.videoPath) } : {}),
  };
}

/**
 * What a shared film looks like to somebody who does not own it.
 *
 * Everything needed to play and title a video, and nothing else. Three fields
 * are dropped and each for a concrete reason rather than caution:
 *
 *  - **`source`** is a 200-character excerpt of whatever was cast, and for a
 *    `file` source it is an absolute server path (`/home/…/examples/foo.md`).
 *    One is the owner's material, the other is a map of the box.
 *  - **`costUsd`** is what that film cost us to make. Per-project unit economics
 *    are not a thing to publish alongside a video, and on a free product it
 *    reads as a price tag.
 *  - **`error`** is the last failure message, which is a pipeline diagnostic
 *    aimed at the person who can act on it.
 *
 * Written as an allow-list — the fields are named going *in* — so that a field
 * added to `ProjectRecord` later is private until somebody decides otherwise.
 * A deny-list here would leak by default, which is how this kind of redaction
 * usually fails: the leak arrives in an unrelated commit that adds a field.
 */
function publicView(record: ProjectRecord): Partial<ProjectDto> {
  return {
    id: record.id,
    title: record.title,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    scenes: record.scenes,
    durationSec: record.durationSec,
    shared: record.shared,
    // What the film's facts rest on (plan 5.1). On the *public* view deliberately: a
    // stranger on `/share/<id>` has no other way to know whether they are watching a film
    // built from a document somebody supplied or one taught out of a model's memory, and
    // that is exactly who the honesty is for. It leaks nothing — three enum values about
    // provenance, not the source itself, which stays withheld here.
    ...(record.grounding === undefined ? {} : { grounding: record.grounding }),
    ...(record.aspect === undefined ? {} : { aspect: record.aspect }),
    ...(record.videoPath
      ? { videoPath: record.videoPath, videoUrl: mediaUrl(record.id, record.videoPath) }
      : {}),
  };
}
