/**
 * Which storage a process uses, and where in it.
 *
 * Everything in this package is inert unless `INKCAST_STORAGE=blob`. That is the
 * whole compatibility promise: the CLI, `pnpm dev` and the Docker/Fly deployments
 * never set it, so they keep their local `projects/` directory and in-process job
 * registry exactly as before. A stateless host (Vercel Functions plus a Vercel
 * container for rendering) sets it on both sides, and then project metadata, job
 * progress and the finished film live in a Vercel Blob store instead of on a disk
 * that does not survive the request.
 */

/** Read per call, never captured, so tests can flip it. */
export function blobStorageEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.INKCAST_STORAGE === 'blob';
}

const PREFIX_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/;

/**
 * The top-level folder this deployment writes under.
 *
 * One Blob store can serve production and previews at once, so the prefix is what
 * keeps a preview's films out of production's library. Defaults to `inkcast`.
 */
export function blobPrefix(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env.INKCAST_BLOB_PREFIX ?? '').trim();
  if (raw === '') return 'inkcast';
  if (!isValidBlobPrefix(raw)) {
    throw new Error(
      'INKCAST_BLOB_PREFIX must be 1-48 characters of letters, digits, "-" or "_", starting with a letter or digit',
    );
  }
  return raw;
}

export function isValidBlobPrefix(prefix: string): boolean {
  return PREFIX_RE.test(prefix);
}

/**
 * `private` (the default) or `public` — must match how the Blob store was created.
 *
 * Private is the right choice for this product: `/api/media/<id>/…` already decides
 * who may see a film (owner, or anyone once it is shared), and a public store would
 * hand every finished video an unauthenticated URL that bypasses that decision.
 */
export function blobAccess(env: NodeJS.ProcessEnv = process.env): 'private' | 'public' {
  return env.INKCAST_BLOB_ACCESS === 'public' ? 'public' : 'private';
}

/** Same alphabet as `isValidProjectId` in the studio's store. */
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function isValidId(id: string): boolean {
  return ID_RE.test(id);
}

/** `<prefix>/projects/<id>/` — every blob belonging to one project. */
export function projectPrefix(prefix: string, id: string): string {
  if (!isValidBlobPrefix(prefix)) throw new Error(`invalid blob prefix "${prefix}"`);
  if (!isValidId(id)) throw new Error(`invalid project id "${id}"`);
  return `${prefix}/projects/${id}/`;
}

/** Pathname of one project file. `rel` is a project-relative, `/`-separated path. */
export function projectKey(prefix: string, id: string, rel: string): string {
  const parts = rel.split('/');
  if (parts.length === 0 || parts.some((p) => p === '' || p === '.' || p === '..')) {
    throw new Error(`invalid project path "${rel}"`);
  }
  return `${projectPrefix(prefix, id)}${rel}`;
}

/** The two JSON documents per project. Never served by the media route. */
export const META_BLOB = 'meta.json';
export const JOB_BLOB = 'job.json';

/**
 * What the render service uploads after a successful run, and nothing else.
 *
 * The frames, the per-scene wavs, the lesson cache and the visuals sidecar stay in
 * the render instance's `/tmp` and die with it. That keeps Blob storage to roughly
 * the size of the MP4 per film, and it is also why edit and re-render are not
 * available on a Blob deployment: they resume from exactly the files not kept.
 */
export const KEPT_ARTEFACTS = ['thumbnail.png', 'storyboard.json', 'captions.vtt'] as const;
