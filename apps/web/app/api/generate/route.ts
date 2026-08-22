/**
 * `POST /api/generate` — start a cast run and return immediately.
 *
 * The response is a project id, not a video: a render takes minutes and no
 * browser is going to hold a request open for it. The work becomes a background
 * job (see `lib/jobs.ts`) which the client follows over
 * `GET /api/generate/<id>/stream`.
 *
 * Accepts either JSON (`{ text | url | filePath }`) or `multipart/form-data`
 * with a `file` part. An upload is written into the project directory *before*
 * the job starts, so the run has a real path to ingest and the source stays with
 * the project — re-rendering a project a week later does not depend on a temp
 * file that no longer exists.
 */

import { createWriteStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline as pipeStream } from 'node:stream/promises';
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';

import {
  badRequest,
  fail,
  forbidden,
  isHosted,
  json,
  parseJsonBody,
  tooLarge,
  tooManyRequests,
  unexpected,
  validate,
} from '../_lib/http';
import type { Parsed } from '../_lib/http';
import { admit } from '../_lib/ratelimit';
import { readSession, requireOwner, sessionOwnerTag, setSessionCookie } from '../_lib/session';
import {
  GenerateFields,
  MAX_UPLOAD_BYTES,
  META_KEYS,
  MetaPatch,
  NUMERIC_META_KEYS,
  UPLOAD_EXTENSIONS,
  hostedSourceProblem,
  mergeMeta,
  safeUploadName,
  uploadExtension,
} from '../_lib/schemas';
import { REPO_ROOT, loadCore, loadPipeline, upsertProject } from '@/lib/store';
import { isRunning, startJob } from '@/lib/jobs';

// The filesystem, ffmpeg and a headless Chromium are all involved. Never edge.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SourceRef = { kind: 'text' | 'url' | 'file'; ref: string };

export async function POST(request: Request) {
  try {
    /*
     * Admission before anything else, and specifically before the body is read.
     *
     * This is the most expensive endpoint in the product — an Anthropic lesson
     * call, ElevenLabs characters, then a Chromium context and an ffmpeg process
     * for minutes — so the refusal has to be the cheapest thing the route can
     * do. Reading a 32 MB multipart upload to disk and *then* saying "not today"
     * would let a refused client cost us the whole transfer, which is a
     * denial-of-service with extra steps. The limiter needs only headers.
     *
     * It is inert unless the deployment asked for it; see `limiterEnabled`.
     *
     * This first check does not *spend* a token — a request that turns out to be
     * malformed must not cost one of three films for the day. The token is taken
     * further down, at the point where the run is actually committed.
     */
    const probe = admit(request.headers, 'generation', { spend: false });
    if (!probe.allowed) return tooManyRequests(probe);

    /*
     * Who is asking. This is the request that *creates* ownership, so the
     * session is read before any work and its cookie travels back with the 202
     * — a project stamped with a session the browser never receives is a project
     * nobody can ever see again, and it would be created by the happy path.
     * `readSession` mints one when the cookie is absent or forged, so there is
     * always an owner to record.
     */
    const session = readSession(request);

    const contentType = request.headers.get('content-type') ?? '';
    const isMultipart = contentType.toLowerCase().includes('multipart/form-data');

    const parsed = isMultipart ? await readMultipart(request) : await readJson(request);
    if (!parsed.ok) return parsed.response;
    const { fields, upload } = parsed.data;
    const meta = mergeMeta(fields);

    /* ---------------------------------------------- the hosted source cap */

    // Only on the hosted path: locally the person pasting the text is the person
    // paying for the tokens, and a 200-page book is their business.
    if (isHosted()) {
      const overflow = hostedSourceProblem(fields.text);
      if (overflow) return tooLarge(overflow);
    }

    /* ------------------------------------------------- exactly one source */

    const declared = [
      fields.text !== undefined ? 'text' : undefined,
      fields.url !== undefined ? 'url' : undefined,
      fields.filePath !== undefined ? 'filePath' : undefined,
      upload ? 'file' : undefined,
    ].filter((v): v is string => v !== undefined);

    if (declared.length === 0) {
      return badRequest('nothing to cast — provide text, a url, a filePath, or upload a file');
    }
    if (declared.length > 1) {
      return badRequest(
        `provide exactly one source, but got ${declared.length}: ${declared.join(', ')}`,
      );
    }

    /* ------------------------------------------- resolve a server filePath */

    let serverPath: string | undefined;
    if (fields.filePath !== undefined) {
      const resolved = confineToRepo(fields.filePath);
      if (!resolved) {
        return fail(
          403,
          'filePath must point inside the Inkcast repository (e.g. "examples/gradient-descent.md"). Upload the file instead to cast something from elsewhere.',
        );
      }
      if (!existsSync(resolved)) return badRequest(`no such file: ${fields.filePath}`);
      if (statSync(resolved).isDirectory()) {
        return badRequest(`${fields.filePath} is a directory, not a document`);
      }
      serverPath = resolved;
    }

    /* ----------------------------------------------------- project id + dir */

    const core = await loadCore();
    const source: SourceRef = upload
      ? { kind: 'file', ref: upload.name }
      : serverPath
        ? { kind: 'file', ref: serverPath }
        : fields.url !== undefined
          ? { kind: 'url', ref: fields.url }
          : { kind: 'text', ref: fields.text ?? '' };

    /**
     * An explicit id wins. Otherwise the id is derived from the source so that
     * re-submitting the same document resumes that project (every stage is
     * cached, so it costs nothing) instead of littering `projects/` with
     * duplicates. Uploads are the exception: the bytes have to be written before
     * they could be hashed, and a fresh upload is a fresh intent anyway.
     */
    const wanted =
      fields.projectId ??
      (upload
        ? core.projectId()
        : core.projectId(JSON.stringify({ source, meta, title: fields.title })));

    /*
     * ------------------------------------------------ whose project is that id
     *
     * The derived id is a hash of the *source*, which means two people casting
     * the same document — the same popular blog post, the same textbook page —
     * derive the same id. Left alone that is an ownership transfer and a
     * cross-tenant read in one step: the second request's `upsertProject` patch
     * carries its own `ownerSession`, and a patch field wins over the stored one
     * in `mergeMeta`, so the second caster silently adopts the first caster's
     * project, the first caster's library row disappears, and the render "resumes"
     * from cached stages the second caster never made. On a single-user machine
     * that resumption is the whole point of a content-addressed id; on a shared
     * box it is a bug with no error message.
     *
     * So the collision is resolved by *who asked*:
     *
     *  - A **derived** id that belongs to somebody else becomes a fresh random
     *    id. The caller never asked for that id, so branching quietly is right,
     *    and they get their own project with their own cache.
     *  - An **explicit** `projectId` that belongs to somebody else is a 403. The
     *    caller named a specific project, and silently writing somewhere else
     *    would be a worse answer than "not yours" — this is also the only way a
     *    client can aim this route at an existing project at all.
     *
     * `requireOwner` is the arbiter rather than a comparison here, so the
     * constant-time tag check and the local "unclaimed projects are yours" rule
     * live in exactly one place. Hosted, an unclaimed project counts as somebody
     * else's, which is what stops a visitor adopting a film the CLI made.
     */
    const claim = await requireOwner(wanted, session);
    const takenByAnother = !claim.ok && claim.reason === 'not-owner';
    if (takenByAnother && fields.projectId !== undefined) {
      return setSessionCookie(forbidden(claim.message), session);
    }
    const id = takenByAnother ? core.projectId() : wanted;

    const project = await core.openProject(id);

    /* ------------------------------------------------ charge the generation */

    /*
     * Now that the request is known-good and has an id, take the token.
     *
     * Except when a run for this id is already in flight, in which case
     * `startJob` will hand back the existing job and this request causes no work
     * at all — charging for it would mean a double-clicked button, or the
     * studio's own retry after a dropped response, cost two of three films. The
     * id is derived from the source, so "the same request twice" is exactly the
     * case that lands here.
     */
    const admission = isRunning(id) ? probe : admit(request.headers, 'generation');
    if (!admission.allowed) return tooManyRequests(admission);

    /* --------------------------------------------------------- the upload */

    if (upload) {
      const target = path.join(await project.sub('source'), upload.name);
      try {
        await writeUpload(upload.file, target);
      } catch (err) {
        if (err instanceof UploadTooLarge) {
          return fail(413, `the upload exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB limit`);
        }
        throw err;
      }
      serverPath = target;
      source.ref = target;
    }

    /* ------------------------------------------------------------- the job */

    const castInput = {
      ...(fields.text === undefined ? {} : { text: fields.text }),
      ...(fields.url === undefined ? {} : { url: fields.url }),
      ...(serverPath === undefined ? {} : { filePath: serverPath }),
      ...(fields.title === undefined ? {} : { title: fields.title }),
      ...(meta === undefined ? {} : { meta }),
    };

    /*
     * `ownerSession` is the keyed digest of the session id, never the id itself
     * — `/api/media/<id>/<path…>` will serve `meta.json` to anyone holding a
     * share link, so the raw id in that file would be a bearer token handed to
     * every viewer (see the header of `_lib/session.ts`).
     *
     * Written on the *first* upsert rather than after the render, because the
     * window between them is minutes long and everything in it — the library
     * row, the progress stream, the stream's error messages — is already
     * ownership-gated, so a project that is only claimed at the end is a project
     * that is unattributable for the entire time anybody is looking at it.
     *
     * Safe to write unconditionally *because* of the collision resolution above:
     * `id` is either a project this session already owns (or may claim) or a
     * fresh random one. A patch's `ownerSession` beats the stored value in
     * `mergeMeta`, so without that step this line would be the transfer.
     */
    await upsertProject(id, {
      status: 'running',
      title: fields.title ?? titleFor(source),
      source: indexSource(source),
      ownerSession: sessionOwnerTag(session.id),
      ...(meta?.aspect === undefined ? {} : { aspect: meta.aspect }),
    });

    const { started } = startJob(id, 'cast', async (onProgress) => {
      const { cast } = await loadPipeline();
      const result = await cast(castInput, {
        projectId: id,
        force: fields.force ?? false,
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
          /** False when an identical run was already in flight and was reused. */
          started,
          streamUrl: `/api/generate/${id}/stream`,
          /**
           * Films left today, so the studio can say "2 left" beside the button
           * instead of only finding out at the 429. Omitted entirely when the
           * limiter is off or was bypassed — `remaining` is `Infinity` there, and
           * `JSON.stringify(Infinity)` is `null`, which would read as zero.
           */
          ...(Number.isFinite(admission.remaining)
            ? { generationsLeftToday: admission.remaining }
            : {}),
        },
        202,
      ),
      session,
    );
  } catch (err) {
    return unexpected('generate', err);
  }
}

/* ------------------------------------------------------------- body readers */

type GenerateInput = {
  fields: GenerateFields;
  upload?: { file: File; name: string };
};

async function readJson(request: Request): Promise<Parsed<GenerateInput>> {
  const parsed = await parseJsonBody(request, GenerateFields);
  if (!parsed.ok) return parsed;
  return { ok: true, data: { fields: parsed.data } };
}

/**
 * Read `multipart/form-data`.
 *
 * Every scalar arrives as a string, so numbers and booleans are coerced here and
 * `meta` is accepted as a JSON blob — that keeps one schema governing both
 * transports rather than a second, looser one for forms.
 */
async function readMultipart(request: Request): Promise<Parsed<GenerateInput>> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch (err) {
    return {
      ok: false,
      response: badRequest('could not parse the multipart body', [
        err instanceof Error ? err.message : String(err),
      ]),
    };
  }

  const raw: Record<string, unknown> = {};
  for (const key of ['text', 'url', 'filePath', 'title', 'projectId'] as const) {
    const value = form.get(key);
    if (typeof value === 'string' && value.trim() !== '') raw[key] = value;
  }

  // Flattened `meta` fields, which is what an HTML form produces. `fps` and
  // `outroSec` are numbers in the schema, so they are coerced here rather than
  // rejected for being the strings a form always sends.
  const numericMeta = new Set<string>(NUMERIC_META_KEYS);
  for (const key of META_KEYS) {
    const value = form.get(key);
    if (typeof value !== 'string' || value.trim() === '') continue;
    if (numericMeta.has(key)) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        return { ok: false, response: badRequest(`${key} must be a number`) };
      }
      raw[key] = parsed;
    } else {
      raw[key] = value;
    }
  }

  const force = form.get('force');
  if (typeof force === 'string' && force !== '') {
    if (!['true', 'false', '1', '0'].includes(force)) {
      return { ok: false, response: badRequest('force must be true or false') };
    }
    raw.force = force === 'true' || force === '1';
  }

  const metaField = form.get('meta');
  if (typeof metaField === 'string' && metaField.trim() !== '') {
    let metaJson: unknown;
    try {
      metaJson = JSON.parse(metaField);
    } catch {
      return { ok: false, response: badRequest('meta must be a JSON object') };
    }
    const meta = validate(MetaPatch, metaJson);
    if (!meta.ok) return meta;
    raw.meta = meta.data;
  }

  const parsed = validate(GenerateFields, raw);
  if (!parsed.ok) return parsed;

  const file = form.get('file');
  if (file === null) return { ok: true, data: { fields: parsed.data } };
  if (!(file instanceof File)) {
    return { ok: false, response: badRequest('the "file" part must be a file upload') };
  }

  const name = safeUploadName(file.name);
  const ext = uploadExtension(name);
  if (!(UPLOAD_EXTENSIONS as readonly string[]).includes(ext)) {
    return {
      ok: false,
      response: fail(
        415,
        `cannot read "${file.name}" — supported types are ${UPLOAD_EXTENSIONS.join(', ')}`,
      ),
    };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      response: fail(413, `the upload exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB limit`),
    };
  }

  return { ok: true, data: { fields: parsed.data, upload: { file, name } } };
}

/* ------------------------------------------------------------------ uploads */

class UploadTooLarge extends Error {
  constructor() {
    super('upload too large');
    this.name = 'UploadTooLarge';
  }
}

/**
 * Stream the upload to disk, enforcing the size limit as bytes go past.
 *
 * `file.size` was already checked, but it is a claim by the client's runtime and
 * the write is the thing that actually consumes disk — so the limit is enforced
 * where it can be trusted.
 */
async function writeUpload(file: File, target: string): Promise<void> {
  const web = file.stream() as unknown as NodeWebReadableStream<Uint8Array>;
  await pipeStream(Readable.fromWeb(web), capped(MAX_UPLOAD_BYTES), createWriteStream(target));
}

function capped(limit: number) {
  return async function* (source: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
    let total = 0;
    for await (const chunk of source) {
      total += chunk.byteLength;
      if (total > limit) throw new UploadTooLarge();
      yield chunk;
    }
  };
}

/* -------------------------------------------------------------------- paths */

/**
 * Resolve a client-supplied server path and confirm it stays inside the repo.
 *
 * Relative paths resolve against the repo root rather than the process cwd, so
 * `examples/foo.md` means the same thing however the dev server was launched.
 */
function confineToRepo(input: string): string | undefined {
  const resolved = path.resolve(REPO_ROOT, input);
  const rel = path.relative(REPO_ROOT, resolved);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return undefined;
  return resolved;
}

/* ------------------------------------------------------------------- labels */

/** A human title to show while the planner works out the real one. */
function titleFor(source: SourceRef): string {
  if (source.kind === 'file') return path.basename(source.ref).replace(/\.[^.]+$/, '');
  if (source.kind === 'url') {
    try {
      const url = new URL(source.ref);
      return `${url.hostname}${url.pathname === '/' ? '' : url.pathname}`;
    } catch {
      return source.ref.slice(0, 80);
    }
  }
  const firstLine = source.ref.split(/\r?\n/).find((l) => l.trim() !== '') ?? 'Untitled';
  return (
    firstLine
      .replace(/^#+\s*/, '')
      .trim()
      .slice(0, 80) || 'Untitled'
  );
}

/**
 * The index keeps a *display* copy of the source, so a pasted essay is
 * truncated: the pipeline's own `pipeline.json` is the durable record, and this
 * one only has to be recognisable in a list.
 */
function indexSource(source: SourceRef): SourceRef {
  if (source.kind !== 'text') return source;
  return { kind: 'text', ref: source.ref.slice(0, 200) };
}
