/**
 * `GET /api/media/<id>/<path…>` — serve one file out of a project directory.
 *
 * This is how the studio plays `out.mp4`, scrubs a scene's `audio/*.wav`, and
 * shows a captured frame. Project directories live outside `public/` on purpose
 * — they are working state rather than static assets, and `INKCAST_PROJECTS` can
 * point anywhere — so they need a real handler.
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
import { contentTypeFor, parseRange, resolveMediaFile } from '../../../_lib/media';
import { isValidProjectId, projectDir } from '@/lib/store';

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
