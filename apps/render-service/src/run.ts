/**
 * One film, start to finish, on a stateless instance.
 *
 * 1. Mark the job `running` in Blob.
 * 2. Materialise the source locally (an uploaded file comes down from Blob; a
 *    repository path is confined to the image's checkout).
 * 3. Run the ordinary pipeline — `cast()`, the same call the studio and the CLI
 *    make — into `/tmp`, forwarding progress to Blob (throttled) and to the caller.
 * 4. Upload the MP4 and the few small artefacts the studio reads, then mark the
 *    job `done` with everything the project record needs.
 * 5. Delete the local project directory, success or failure: the next request on
 *    this instance must not inherit a stale cache it cannot see in Blob.
 *
 * Must only be imported after `bootstrapEnv()` has run (see `main.ts`).
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  KEPT_ARTEFACTS,
  downloadBuffer,
  newJob,
  projectKey,
  putFile,
  readJob,
  writeJob,
  type JobFailure,
  type JobProgress,
  type JobResult,
  type JobState,
  type RenderEvent,
  type RenderRequest,
} from '@inkcast/cloud';

import type { Runner } from './server.js';

/** A progress write at most this often, unless the stage changed. */
const PROGRESS_WRITE_MS = 5_000;
/** A heartbeat write when nothing else has written for this long. */
const HEARTBEAT_WRITE_MS = 20_000;

const CONTENT_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
};

export function createRunner(options: { repoRoot: string }): Runner {
  return async (request, emit) => {
    const [core, pipeline, keyvault] = await Promise.all([
      import('@inkcast/core'),
      import('@inkcast/pipeline'),
      import('@inkcast/keyvault'),
    ]);
    const { projectId: id, blobPrefix: prefix } = request;
    const dir = path.resolve(core.PROJECTS_ROOT, id);

    // Keep `startedAt` from the dispatcher's `queued` record, so the studio's
    // elapsed clock includes the time it spent waiting for this instance.
    const previous = await readJob(prefix, id).catch(() => undefined);
    let job: JobState = {
      ...(previous ?? newJob(id, 'cast', 'running')),
      status: 'running',
      queue: {
        queued: false,
        position: 0,
        running: 1,
        etaSec: 0,
        message: 'Your turn — this film is being made now.',
      },
    };
    delete job.failure;
    delete job.result;
    delete job.finishedAt;

    let lastWrite = 0;
    let writing: Promise<void> = Promise.resolve();
    const persist = (next: JobState): Promise<void> => {
      job = next;
      lastWrite = Date.now();
      // Serialised: two overlapping puts to one pathname could land out of order
      // and leave an older progress figure as the final word.
      const pending = writing.then(() => writeJob(prefix, next));
      writing = pending.catch(() => {});
      return pending;
    };
    await persist(job);

    const heartbeat = setInterval(() => {
      if (Date.now() - lastWrite >= HEARTBEAT_WRITE_MS) void persist(job).catch(() => {});
    }, HEARTBEAT_WRITE_MS / 2);

    const onProgress = (p: { stage: string; pct: number; note?: string }) => {
      const stagePct = (p as { stagePct?: unknown }).stagePct;
      const progress: JobProgress = {
        stage: core.redactProviderSecrets(p.stage),
        pct: Math.round(p.pct),
        ...(p.note === undefined ? {} : { note: core.redactProviderSecrets(p.note) }),
        ...(typeof stagePct === 'number' && Number.isFinite(stagePct)
          ? { stagePct: Math.round(stagePct) }
          : {}),
      };
      emit({ type: 'progress', progress });
      const stageChanged = job.progress?.stage !== progress.stage;
      if (stageChanged || Date.now() - lastWrite >= PROGRESS_WRITE_MS) {
        void persist({ ...job, progress }).catch(() => {});
      } else {
        job = { ...job, progress };
      }
    };

    try {
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
      const filePath = await materialiseSource(request, dir, options.repoRoot);
      const { repoPath: _repoPath, sourceBlob: _sourceBlob, ...rest } = request.input;
      const input = {
        ...rest,
        ...(filePath === undefined ? {} : { filePath }),
      } as Parameters<typeof pipeline.cast>[0];

      const run = () =>
        pipeline.cast(input, {
          projectId: id,
          force: request.force ?? false,
          onProgress,
        });
      const env = providerEnvFor(request, keyvault.PROVIDER_SPECS);
      const result = env
        ? await keyvault.withSecretRedaction(secretsIn(env, keyvault.PROVIDER_SPECS), () =>
            core.withProviderEnv(env, async () => {
              try {
                return await run();
              } catch (err) {
                // Redacted while the scope still knows the keys, as `runWithKeys`
                // does in the studio: a provider error can quote a key back.
                const error = new Error(
                  keyvault.redact(err instanceof Error ? err.message : String(err)),
                );
                if (err instanceof Error) error.name = err.name;
                const stage = (err as { stage?: unknown } | null)?.stage;
                if (typeof stage === 'string')
                  Object.assign(error, { stage: core.redactProviderSecrets(stage) });
                throw error;
              }
            }),
          )
        : await run();

      // One line per film: how long each stage took on this instance. This is the
      // number to watch against the 800-second ceiling.
      const stages = Object.entries(result.timings)
        .map(([stage, ms]) => `${stage}=${Math.round((ms ?? 0) / 1000)}s`)
        .join(' ');
      console.log(`[render-service] ${id} cast finished: ${stages}`);

      const videoRel = toRelative(dir, result.videoPath);
      await upload(prefix, id, dir, videoRel);
      for (const name of KEPT_ARTEFACTS) {
        if (existsSync(path.join(dir, name))) await upload(prefix, id, dir, name);
      }

      const state = await pipeline.readState(dir).catch(() => undefined);
      const res: JobResult = {
        videoPath: videoRel,
        durationSec: core.totalDuration(result.storyboard),
        title: result.storyboard.title,
        scenes: result.storyboard.scenes.length,
        costUsd: result.cost.usd,
        ...(result.storyboard.meta.aspect ? { aspect: result.storyboard.meta.aspect } : {}),
        ...(state?.grounding ? { grounding: state.grounding } : {}),
        ...(state?.lanes ? { lanes: state.lanes } : {}),
      };
      clearInterval(heartbeat);
      await persist({ ...job, status: 'done', finishedAt: new Date().toISOString(), result: res });
      return { type: 'done', result: res } satisfies RenderEvent;
    } catch (err) {
      clearInterval(heartbeat);
      const failure = describe(err, pipeline.rootCauseMessage);
      await persist({
        ...job,
        status: 'error',
        finishedAt: new Date().toISOString(),
        failure,
      });
      return { type: 'error', failure } satisfies RenderEvent;
    } finally {
      clearInterval(heartbeat);
      await writing;
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  };
}

async function materialiseSource(
  request: RenderRequest,
  dir: string,
  root: string,
): Promise<string | undefined> {
  const { sourceBlob, repoPath } = request.input;
  if (sourceBlob) {
    const name = path.basename(sourceBlob.name);
    const expected = projectKey(request.blobPrefix, request.projectId, `source/${name}`);
    // Only this project's own upload: the pathname is not a free choice.
    if (sourceBlob.pathname !== expected)
      throw new Error('the uploaded source is not this project’s');
    const bytes = await downloadBuffer(expected);
    if (!bytes) throw new Error(`the uploaded source "${name}" is no longer in storage`);
    await mkdir(path.join(dir, 'source'), { recursive: true });
    const target = path.join(dir, 'source', name);
    await writeFile(target, bytes);
    return target;
  }
  if (repoPath) {
    const resolved = path.resolve(root, repoPath);
    const rel = path.relative(root, resolved);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error('filePath must point inside the Inkcast repository');
    }
    if (!existsSync(resolved) || statSync(resolved).isDirectory()) {
      throw new Error(`no such file in the render image: ${repoPath}`);
    }
    return resolved;
  }
  return undefined;
}

async function upload(prefix: string, id: string, dir: string, rel: string): Promise<void> {
  const body = await readFile(path.join(dir, rel));
  const type = CONTENT_TYPES[path.extname(rel).toLowerCase()] ?? 'application/octet-stream';
  await putFile(projectKey(prefix, id, rel), body, type);
}

function toRelative(dir: string, file: string): string {
  const abs = path.isAbsolute(file) ? file : path.resolve(dir, file);
  const rel = path.relative(dir, abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return 'out.mp4';
  return rel.split(path.sep).join('/');
}

function describe(err: unknown, rootCause: (err: unknown) => string): JobFailure {
  let stage: string | undefined;
  if (err instanceof Error && err.name === 'StageError') {
    const tagged = err as Error & { stage?: unknown };
    if (typeof tagged.stage === 'string') stage = tagged.stage;
  }
  let message: string;
  try {
    message = rootCause(err);
  } catch {
    message = err instanceof Error ? err.message : String(err);
  }
  return { error: message || 'the run failed for an unknown reason', ...(stage ? { stage } : {}) };
}

type ProviderSpecs = Record<string, { envVars: readonly string[] }>;

/**
 * The provider environment for this run, or `undefined` to use the process's own.
 *
 * Mirrors `credentialEnvironment` in apps/web/lib/keys.ts. The studio resolved the
 * keys and settings; this only decides what they sit on top of:
 *
 *  - `isolated` (accounts on): exactly what was sent, plus NODE_ENV. Nothing in this
 *    container's environment — in particular no provider key set on the render
 *    project — can reach an account's film.
 *  - otherwise: this container's environment with every provider key removed, then
 *    what was sent. A provider the request deselected stays deselected even if
 *    the render project happens to have its key.
 *
 * `INKCAST_CACHE_DIR` names a per-account cache on the studio's disk; it is moved
 * under this instance's `/tmp`, keeping the per-account separation.
 */
export function providerEnvFor(
  request: RenderRequest,
  specs: ProviderSpecs,
): NodeJS.ProcessEnv | undefined {
  const sent = request.providerEnv;
  if (!sent) {
    if (request.isolated) throw new Error('Account runs require a credential scope');
    return undefined;
  }
  const base: NodeJS.ProcessEnv = request.isolated
    ? { NODE_ENV: process.env.NODE_ENV }
    : { ...process.env };
  for (const spec of Object.values(specs)) for (const name of spec.envVars) delete base[name];
  const env: NodeJS.ProcessEnv = { ...base, ...sent };
  if (request.isolated) env.INKCAST_PUBLIC_SOURCES = '1';
  if (sent.INKCAST_CACHE_DIR) {
    env.INKCAST_CACHE_DIR = path.join(
      tmpdir(),
      'inkcast',
      'account-cache',
      path.basename(sent.INKCAST_CACHE_DIR),
    );
  }
  return env;
}

function secretsIn(env: NodeJS.ProcessEnv, specs: ProviderSpecs): string[] {
  return Object.values(specs).flatMap((spec) =>
    spec.envVars.map((name) => env[name]).filter((key): key is string => Boolean(key)),
  );
}
