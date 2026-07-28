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

import { badRequest, fail, json, parseJsonBody, unexpected, validate } from '../_lib/http';
import type { Parsed } from '../_lib/http';
import {
  GenerateFields,
  MAX_UPLOAD_BYTES,
  META_KEYS,
  MetaPatch,
  NUMERIC_META_KEYS,
  UPLOAD_EXTENSIONS,
  mergeMeta,
  safeUploadName,
  uploadExtension,
} from '../_lib/schemas';
import { REPO_ROOT, loadCore, loadPipeline, upsertProject } from '@/lib/store';
import { startJob } from '@/lib/jobs';

// The filesystem, ffmpeg and a headless Chromium are all involved. Never edge.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SourceRef = { kind: 'text' | 'url' | 'file'; ref: string };

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get('content-type') ?? '';
    const isMultipart = contentType.toLowerCase().includes('multipart/form-data');

    const parsed = isMultipart ? await readMultipart(request) : await readJson(request);
    if (!parsed.ok) return parsed.response;
    const { fields, upload } = parsed.data;
    const meta = mergeMeta(fields);

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
    const id =
      fields.projectId ??
      (upload
        ? core.projectId()
        : core.projectId(JSON.stringify({ source, meta, title: fields.title })));

    const project = await core.openProject(id);

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

    await upsertProject(id, {
      status: 'running',
      title: fields.title ?? titleFor(source),
      source: indexSource(source),
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

    return json(
      {
        projectId: id,
        status: 'running' as const,
        /** False when an identical run was already in flight and was reused. */
        started,
        streamUrl: `/api/generate/${id}/stream`,
      },
      202,
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
