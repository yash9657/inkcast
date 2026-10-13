/**
 * `GET /api/media/<id>/<path…>` — serve one file out of a project directory.
 *
 * This is how the studio plays `out.mp4`, scrubs a scene's `audio/*.wav`, and
 * shows a captured frame. Project directories live outside `public/` on purpose
 * — they are working state rather than static assets, and `INKCAST_PROJECTS` can
 * point anywhere — so they need a real handler.
 *
 * ## Who may read a project's files
 *
 * The owner, or anybody once the owner shared the project (`requireViewable`).
 * This route is the only way project bytes leave the box, and it has no
 * allow-list of filenames — any readable file inside the directory is fair game,
 * including `pipeline.json` and `meta.json` — so it is where an unscoped read
 * would hurt most: unguessable ids are not a permission system, and a hosted box
 * with an open media route publishes every film on it to anyone who has seen an
 * id in a log, a screen share or a referrer header.
 *
 * Two consequences to know before they look like bugs. **A shared film's whole
 * directory is readable**, not just its mp4 — that is what makes the share page
 * work (video, poster, per-scene audio) and it is why `meta.json` records a
 * keyed digest of the owner's session rather than the session id itself; see the
 * header of `_lib/session.ts`. And **the marketing showcase films must be
 * shared**: `components/marketing/site-config.ts` points at real project ids
 * through this route, so a showcase project that has not been published serves
 * 403 here and the landing page degrades to its drawn placeholder. Publishing
 * them with `POST /api/projects/<id>/share` is a launch-runbook step, not
 * something this route should special-case.
 *
 * ## Range support is not optional
 *
 * `<video>` will not let you seek a source that only answers plain 200s: Chrome
 * asks for `bytes=0-`, then jumps around the file as the user drags the scrubber.
 * Without `Accept-Ranges` and honest 206s the timeline is dead and the whole clip
 * has to download before it plays.
 *
 * Path resolution, containment and content types live in `../_lib/media` — see
 * that file for how traversal and symlink escapes are refused.
 */

import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';

import { badRequest, fail, notFound } from '../../../_lib/http';
import {
  contentTypeFor,
  isSafeSegment,
  parseRange,
  resolveMediaFile,
  shareableMediaPath,
} from '../../../_lib/media';
import { requireViewable, resolveIdentity } from '../../../_lib/session';
import { blobStorage, isValidProjectId, projectDir } from '@/lib/store';
import { JOB_BLOB, META_BLOB, blobPrefix, download, projectKey } from '@inkcast/cloud';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string; path: string[] }> };

export async function GET(request: Request, context: Context) {
  return serve(request, context, false);
}

/**
 * Some players probe with HEAD before committing to a download. Identical
 * headers, no body.
 */
export async function HEAD(request: Request, context: Context) {
  return serve(request, context, true);
}

async function serve(request: Request, context: Context, headOnly: boolean): Promise<Response> {
  const { id, path: segments } = await context.params;

  const dir = isValidProjectId(id) ? projectDir(id) : undefined;
  if (!dir) return badRequest(`"${id}" is not a valid project id`);

  /*
   * Permission before the filesystem, on every request including every range
   * request.
   *
   * No cookie is set on the way out, unlike the JSON routes: this is a
   * subresource fetched by `<video>` and `<img>`, so it is never the request
   * where identity should be established — and attaching `Set-Cookie` to a 206
   * is noise on the one response type that arrives dozens of times per playback.
   * A viewer with no session simply gets the shared-project answer, which is the
   * correct one for a stranger following a link.
   *
   * The cost is one `readProjectTruth` per range request — a `meta.json` read
   * plus the pipeline's own project scan. That is the deliberate trade: a cached
   * verdict would keep serving bytes after an owner clicked Unshare, and "the
   * video kept playing for the person I revoked" is a worse defect than a few
   * JSON reads per seek. If seeking ever measures slow, the fix is a short-lived
   * *negative*-safe cache here, not a longer-lived permission.
   *
   * ## This route never 401s, and that is deliberate
   *
   * These bytes are what a `<video src>` and an `<img src>` on a public
   * `/share/<id>` page actually fetch, as whatever stranger is watching — usually
   * with no cookie and, on a deployment with accounts, usually with no account. A
   * refusal here would not show a sign-in page; it would show a broken video
   * element on every shared film. So a signed-out caller is downgraded to
   * `who.stranger` rather than refused, and `requireViewable` decides the rest:
   * shared, or nothing. That is the identical answer this route gave before
   * accounts existed.
   *
   * The owner's *own* unshared film still plays, because a signed-in owner
   * resolves to their real session and `requireViewable` says `via: 'owner'`. The
   * one thing that changed is that on a Clerk deployment a signed-out browser no
   * longer gets a mintable anonymous identity out of this route — it never set a
   * cookie anyway, which is why this is a downgrade with no consequence.
   */
  const who = await resolveIdentity(request);
  const session = who.ok ? who.session : who.stranger;
  const verdict = await requireViewable(id, session);
  if (!verdict.ok) return fail(verdict.status, verdict.message);

  if (verdict.via === 'shared' && !shareableMediaPath(segments ?? [], verdict.project.videoPath))
    return fail(403, 'Only playback media is available through this share link.');

  if (blobStorage()) return serveFromBlob(request, id, segments ?? [], headOnly);

  const resolved = await resolveMediaFile(dir, segments ?? []);
  if (!resolved.ok) {
    if (resolved.reason === 'invalid') return badRequest('invalid media path');
    if (resolved.reason === 'outside') {
      return fail(403, 'that path is outside the project directory');
    }
    return notFound(`no such file in project "${id}"`);
  }

  const { file, size, mtimeMs } = resolved.value;

  /* --------------------------------------------------------- validators */

  // Size + mtime is enough to detect a rerender replacing the file, and costs
  // nothing compared with hashing an mp4 on every request.
  const etag = `W/"${size.toString(16)}-${Math.round(mtimeMs).toString(16)}"`;

  const base: Record<string, string> = {
    'Content-Type': contentTypeFor(file),
    'Accept-Ranges': 'bytes',
    ETag: etag,
    'Last-Modified': new Date(mtimeMs).toUTCString(),
    // Mutable: a rerender replaces out.mp4 in place. `no-cache` still lets the
    // browser store the bytes, it just has to revalidate — so seeking stays fast
    // while a fresh render is picked up immediately.
    'Cache-Control': 'private, no-cache',
    // The type we chose is the only one that may be applied.
    'X-Content-Type-Options': 'nosniff',
    // Project files can originate from an uploaded document, and they are served
    // from the studio's own origin. Without this an SVG could run script here.
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  };

  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: base });
  }

  /* -------------------------------------------------------------- range */

  const rangeHeader = request.headers.get('range');
  const range = rangeHeader === null ? undefined : parseRange(rangeHeader, size);

  if (range === 'unsatisfiable') {
    return new Response(null, {
      status: 416,
      headers: { ...base, 'Content-Range': `bytes */${size}` },
    });
  }

  const start = range ? range.start : 0;
  const end = range ? range.end : Math.max(0, size - 1);
  const length = size === 0 ? 0 : end - start + 1;

  const headers: Record<string, string> = {
    ...base,
    'Content-Length': String(length),
    ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
  };
  const status = range ? 206 : 200;

  if (headOnly || length === 0) return new Response(null, { status, headers });

  /* ------------------------------------------------------------- stream */

  if (request.signal.aborted) return new Response(null, { status, headers });

  const nodeStream = createReadStream(file, { start, end });

  // Dragging the scrubber abandons the previous request mid-flight. Left alone,
  // those reads pile up open file descriptors on a large mp4, so tear the
  // descriptor down as soon as the client goes away.
  const onAbort = () => nodeStream.destroy();
  request.signal.addEventListener('abort', onAbort, { once: true });
  nodeStream.once('close', () => request.signal.removeEventListener('abort', onAbort));

  const body = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
  return new Response(body, { status, headers });
}

/**
 * The same route, when the project lives in Vercel Blob.
 *
 * Authorisation has already happened above, identically. The two bookkeeping
 * documents are refused outright: `meta.json` carries the owner tag and `job.json`
 * the raw failure text, and on disk neither is something a share link needs. A
 * `Range` header is forwarded so a seek costs only the bytes after it; the
 * response is streamed, so the 4.5 MB Function body cap does not apply.
 */
async function serveFromBlob(
  request: Request,
  id: string,
  segments: string[],
  headOnly: boolean,
): Promise<Response> {
  if (segments.length === 0 || segments.length > 16 || !segments.every(isSafeSegment)) {
    return badRequest('invalid media path');
  }
  const rel = segments.join('/');
  if (rel === META_BLOB || rel === JOB_BLOB) return notFound(`no such file in project "${id}"`);

  const range = request.headers.get('range') ?? undefined;
  const found = await download(projectKey(blobPrefix(), id, rel), {
    ...(range ? { range } : {}),
    signal: request.signal,
  }).catch(() => undefined);
  if (!found) return notFound(`no such file in project "${id}"`);

  const headers: Record<string, string> = {
    'Content-Type': contentTypeFor(rel),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  };
  for (const name of ['content-length', 'content-range', 'etag', 'last-modified']) {
    const value = found.headers.get(name);
    if (value) headers[name] = value;
  }
  if (headOnly) {
    await found.stream.cancel();
    return new Response(null, { status: found.status, headers });
  }
  return new Response(found.stream, { status: found.status, headers });
}
