import { guardRequest } from '../_lib/request-guard';
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
  conflictingJob,
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
import { admit, type Allowed } from '../_lib/ratelimit';
import { ownerTagFor, requireOwner, resolveIdentity, setSessionCookie } from '../_lib/session';
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
import { REPO_ROOT, blobStorage, loadCore, loadPipeline, upsertProject } from '@/lib/store';
import { credentialEnvironment, defaultProviders, withKeys } from '@/lib/keys';
import { selectedVoice } from '@/lib/provider-selection';
import { accountKeys } from '../_lib/deployment';
import { isRunning, startJob, studioFormat } from '@/lib/jobs';
import { remoteIsRunning, startRemoteCast } from '@/lib/remote';
import type { ProviderSelection } from '@/lib/provider-selection';
import { blobPrefix, projectKey, putFile, type RenderInput } from '@inkcast/cloud';

// The filesystem, ffmpeg and a headless Chromium are all involved. Never edge.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * With Blob storage (`INKCAST_STORAGE=blob`) this invocation stays alive in
 * `after()` for as long as the render service takes, so it needs the Pro plan's
 * 800-second ceiling. Ignored by `next start`.
 */
export const maxDuration = 800;

/**
 * A Vercel Function's request body is capped at 4.5 MB, so an upload that would
 * pass the local 32 MB limit cannot even reach this handler there. Refused here
 * with a sentence rather than by the platform with a bare 413.
 */
const BLOB_UPLOAD_LIMIT = 4 * 1024 * 1024;

type SourceRef = { kind: 'text' | 'url' | 'file'; ref: string };

export async function POST(request: Request) {
  const refused = guardRequest(request, true);
  if (refused) return refused;
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
     * Who is asking. This is the request that *creates* ownership, so identity
     * is resolved before any work and its cookie travels back with the 202 — a
     * project stamped with a session the browser never receives is a project
     * nobody can ever see again, and it would be created by the happy path.
     *
     * ## This is the route the sign-in requirement exists for
     *
     * Everything else in this API guards *access to a thing that already
     * exists*, and `requireOwner` does that job whether the identity came from
     * Clerk or from a cookie. This route is different in kind: it is the one that
     * spends money. A generation runs an Anthropic lesson call, ElevenLabs
     * characters, a headless Chromium and an ffmpeg process for minutes, on
     * hardware somebody pays for. So on a deployment with accounts a refusal here
     * is the product decision, and it has to be enforced *here* rather than by the
     * page that renders the form: `/studio` shows a sign-in wall to a signed-out
     * visitor, but a wall in a server component is a UX affordance and this
     * endpoint is reachable with `curl`.
     *
     * `resolveIdentity` rather than `readSession`, and the difference is the whole
     * point. `readSession` *mints* an anonymous session when the cookie is absent
     * or forged, which is exactly right on a laptop and exactly wrong here: it
     * means a signed-out caller is handed a brand-new identity and a free film,
     * so the sign-in requirement would be satisfiable by clearing a cookie. With
     * Clerk unconfigured `resolveIdentity` calls `readSession` and this line
     * behaves as it always did.
     */
    const who = await resolveIdentity(request);
    if (!who.ok) return fail(who.status, who.message);
    const session = who.session;

    const contentType = request.headers.get('content-type') ?? '';
    const isMultipart = contentType.toLowerCase().includes('multipart/form-data');

    const parsed = isMultipart ? await readMultipart(request) : await readJson(request);
    if (!parsed.ok) return parsed.response;
    const { fields, upload } = parsed.data;
    const selection = fields.providers ?? (await defaultProviders(session));
    const meta = {
      ...mergeMeta(fields),
      voice: selectedVoice(selection, mergeMeta(fields)?.voice),
    };
    // Fail before creating a project if a selected key is missing/unreadable.
    try {
      await credentialEnvironment(session, selection);
    } catch {
      return badRequest(
        'A selected provider key is missing or unreadable. Check it in Settings, or select the local option.',
      );
    }

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
      if (accountKeys()) return forbidden('Upload a document instead of reading server files.');
      const resolved = confineToRepo(fields.filePath);
      if (!resolved) {
        return fail(
          403,
          'filePath must point inside the Inkcast repository (e.g. "examples/gradient-descent.md"). Upload the file instead to cast something from elsewhere.',
        );
      }
      // With Blob storage the repository checkout that matters is the render
      // service's image, not this Function's bundle; it checks existence there.
      if (!blobStorage()) {
        if (!existsSync(resolved)) return badRequest(`no such file: ${fields.filePath}`);
        if (statSync(resolved).isDirectory()) {
          return badRequest(`${fields.filePath} is a directory, not a document`);
        }
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
        : core.projectId(
            // `preset` joins the derivation because it changes the film: `explainer`
            // is 75 seconds over eight beats and `deepdive` is 150 over fourteen, and
            // without it the same document cast at both lengths would derive one id,
            // resume the first one's cached lesson and storyboard, and hand back the
            // wrong film. Absent when nothing asked, so `JSON.stringify` drops it and
            // every id derived before this line still derives the same way.
            JSON.stringify({
              owner: ownerTagFor(session),
              source,
              meta,
              title: fields.title,
              preset: fields.preset,
              providers: selection,
            }),
          ));

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

    const busy = blobStorage() ? await remoteIsRunning(id) : isRunning(id);
    if (busy) return setSessionCookie(conflictingJob(id), session);

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
    const admission = admit(request.headers, 'generation');
    if (!admission.allowed) return tooManyRequests(admission);
    await upsertProject(
      id,
      { ownerSession: ownerTagFor(session), providers: selection },
      ownerTagFor(session),
    );

    if (blobStorage()) {
      return await startOnRenderService({
        id,
        fields,
        meta,
        source,
        session,
        selection,
        admission,
        ...(upload ? { upload } : {}),
        ...(serverPath === undefined ? {} : { serverPath }),
      });
    }

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

    /*
     * The film's *shape*, spread here rather than merged inside the runner because
     * this is the only place that knows a request asked for it — everything
     * downstream sees an already-decided `CastInput`.
     *
     * `studioFormat` always returns one now, and that is the change. It used to
     * return `{}` locally, meaning "let the CLI-shaped defaults stand" — and the
     * CLI-shaped default is `standard`: one 4448×2908 canvas that accumulates every
     * beat, panned at zoom 4.4, ending on a recap zoomed out to 1.2 where ten
     * panels are thumbnails nobody can read. So `explainer` and everything measured
     * about it (fill 55.5% → 62.3%, regions 4 → 1) was reachable from the CLI and
     * from a hosted box and from nowhere a local user could press.
     *
     * Hosted still pins `explainer` whatever the body said, for the queue reason on
     * `HOSTED_PRESET`: `estimateWaitSec` quotes a wait built from measured leases,
     * and a 150-second film in the queue is a wait for everybody behind it.
     *
     * `GenerateFields.preset` is a two-value enum — `explainer` and `deepdive`,
     * both wiping — so the refusal that note used to describe still holds where it
     * was pointed: nothing a form can send selects the mega-canvas.
     */
    const castInput = {
      ...(fields.text === undefined ? {} : { text: fields.text }),
      ...(fields.url === undefined ? {} : { url: fields.url }),
      ...(serverPath === undefined ? {} : { filePath: serverPath }),
      ...(fields.title === undefined ? {} : { title: fields.title }),
      ...(meta === undefined ? {} : { meta }),
      ...studioFormat(fields.preset),
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
      ownerSession: ownerTagFor(session),
      ...(meta?.aspect === undefined ? {} : { aspect: meta.aspect }),
    });

    const { snapshot, started } = startJob(
      id,
      'cast',
      withKeys(session, selection, async (onProgress) => {
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
      }),
    );

    return setSessionCookie(
      json(
        {
          projectId: id,
          /*
           * The scheduler's own verdict, not a literal.
           *
           * This said `status: 'running' as const` while `startJob` was returning a
           * snapshot whose status is `'queued'` whenever both render slots are
           * busy — so under exactly the load the queue exists for, the 202 told
           * every client it had started. `jobs.ts`'s docstring says this response
           * is where a client learns where it stands; a hardcoded literal made
           * that false, and made it false silently, because a queued job does
           * eventually run and the lie repairs itself before anyone can point at
           * it. The load harness could not read an admission depth here at all
           * and had to infer one from the first SSE queue event.
           *
           * `queue` is forwarded whole rather than flattened: it already carries
           * the position, the number running ahead, the eta (`null` until there
           * are measurements to average) and the sentence to show — one shape,
           * written once in `jobs.ts`, so the 202 and the stream cannot describe
           * the same wait in two different ways. It is absent on an admitted job.
           */
          status: snapshot.status,
          ...(snapshot.queue === undefined ? {} : { queue: snapshot.queue }),
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

/* ---------------------------------------------------- the stateless path */

/**
 * The tail of `POST` when projects live in Blob (`INKCAST_STORAGE=blob`).
 *
 * Same contract as the local path — same record, same 202 body — but the run is
 * handed to the render service (see `lib/remote.ts`) instead of the in-process
 * job registry, and an upload goes to Blob instead of the project directory.
 * The provider environment is resolved here, exactly as `withKeys` would resolve
 * it for an in-process run (account keys when accounts are on, the operator's
 * otherwise), and travels with the render request — the render service runs the
 * pipeline inside that snapshot and never stores it.
 */
async function startOnRenderService(args: {
  id: string;
  fields: GenerateFields;
  meta: ReturnType<typeof mergeMeta>;
  source: SourceRef;
  session: Parameters<typeof ownerTagFor>[0];
  selection: ProviderSelection;
  admission: Allowed;
  upload?: { file: File; name: string };
  serverPath?: string;
}): Promise<Response> {
  const { id, fields, meta, source, session, selection, admission, upload, serverPath } = args;

  let sourceBlob: RenderInput['sourceBlob'];
  if (upload) {
    if (upload.file.size > BLOB_UPLOAD_LIMIT) {
      return fail(
        413,
        `uploads are limited to ${BLOB_UPLOAD_LIMIT / (1024 * 1024)} MB on this deployment — paste the text instead`,
      );
    }
    const pathname = projectKey(blobPrefix(), id, `source/${upload.name}`);
    await putFile(
      pathname,
      Buffer.from(await upload.file.arrayBuffer()),
      upload.file.type || 'application/octet-stream',
    );
    sourceBlob = { pathname, name: upload.name };
  }

  await upsertProject(
    id,
    {
      status: 'queued',
      title: fields.title ?? titleFor(source),
      source: indexSource(source),
      ownerSession: ownerTagFor(session),
      ...(meta?.aspect === undefined ? {} : { aspect: meta.aspect }),
    },
    ownerTagFor(session),
  );

  const input: RenderInput = {
    ...(fields.text === undefined ? {} : { text: fields.text }),
    ...(fields.url === undefined ? {} : { url: fields.url }),
    ...(serverPath === undefined || upload
      ? {}
      : { repoPath: path.relative(REPO_ROOT, serverPath) }),
    ...(sourceBlob ? { sourceBlob } : {}),
    ...(fields.title === undefined ? {} : { title: fields.title }),
    ...(meta === undefined ? {} : { meta: meta as Record<string, unknown> }),
    ...studioFormat(fields.preset),
  };

  const { snapshot, started } = await startRemoteCast(id, input, {
    force: fields.force ?? false,
    resolveProviderEnv: async () =>
      forRenderService(await credentialEnvironment(session, selection)),
    isolated: accountKeys(),
  });

  return setSessionCookie(
    json(
      {
        projectId: id,
        status: snapshot.status,
        ...(snapshot.queue === undefined ? {} : { queue: snapshot.queue }),
        started,
        streamUrl: `/api/generate/${id}/stream`,
        ...(Number.isFinite(admission.remaining)
          ? { generationsLeftToday: admission.remaining }
          : {}),
      },
      202,
    ),
    session,
  );
}

/**
 * The part of a credential environment the render service may receive: provider
 * keys and the provider/model settings the stages read through `providerEnv()`.
 * Never the rest of this Function's environment (session secret, Blob token,
 * Clerk keys), which `credentialEnvironment` copies wholesale when accounts are off.
 */
const RENDER_ENV =
  /^(NODE_ENV|FIREWORKS_API_KEY|ANTHROPIC_API_KEY|REPLICATE_API_TOKEN|FAL_KEY|FAL_API_KEY|ELEVENLABS_[A-Z_]+|INKCAST_(PLANNER|IMAGES|VOICE|PUBLIC_SOURCES|CACHE_DIR|FIGURE_MODEL|ROUTER_MODEL|LESSON_MODEL|PLANNER_MODEL|FIREWORKS_[A-Z_]+|DRAW_[A-Z_]+|VOICE_[A-Z_]+))$/;

function forRenderService(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && RENDER_ENV.test(name)) out[name] = value;
  }
  return out;
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
  for (const key of ['text', 'url', 'filePath', 'title', 'projectId', 'preset'] as const) {
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

  const providerField = form.get('providers');
  if (typeof providerField === 'string') {
    try {
      raw.providers = JSON.parse(providerField);
    } catch {
      return { ok: false, response: badRequest('providers must be a JSON object') };
    }
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
