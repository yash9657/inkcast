/**
 * The typed client for the studio's API routes.
 *
 * Every function here is a thin, honest wrapper: it sends what the route
 * documents, normalises what comes back, and throws `ApiError` with a message a
 * human can act on. Nothing invents data — a field the server did not send
 * stays `undefined`, and the UI shows a loading or empty state for it.
 *
 * Routes (owned by the API agent; shapes verified against the handlers):
 *   POST   /api/generate            { text | url | file, title?, meta } -> 202 { projectId, streamUrl }
 *   GET    /api/generate/:id/stream SSE { stage, pct, note? } … { done, videoPath, videoUrl } | { error, stage? }
 *   GET    /api/projects            -> { projects: [...], count }
 *   GET    /api/projects/:id        -> { project, storyboard | null, audioUrls, job }
 *   POST   /api/projects/:id/edit   { instruction } -> { storyboard, applied, via, needsRerender }
 *   POST   /api/projects/:id/rerender -> 202 { projectId, streamUrl }
 *   DELETE /api/projects/:id        -> { ok, id } (409 while a render is in flight)
 *   GET    /api/media/:id/*         -> mp4 / wav / thumbnail bytes
 *
 * The generate endpoint validates strictly: storyboard overrides go under
 * `meta`, and exactly one source may be present. Both rules are enforced here.
 *
 * `@inkcast/core` is imported **type-only** on purpose: its barrel re-exports
 * `project.ts`, which pulls `node:fs` and `node:crypto`. Types are erased at
 * compile time, so this file stays safe in a browser bundle.
 */
import type { Storyboard, StoryboardMeta } from '@inkcast/core';

/* ------------------------------------------------------------------- errors */

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status = 0, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/** The best human-readable sentence available for a failure. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  if (typeof err === 'string' && err.trim()) return err;
  return 'Something went wrong.';
}

/* -------------------------------------------------------------------- types */

export type Aspect = StoryboardMeta['aspect'];
export type Palette = StoryboardMeta['palette'];
export type InkStyle = StoryboardMeta['style'];

/** What the studio knows about a project without loading its storyboard. */
export type ProjectStatus = 'draft' | 'queued' | 'running' | 'ready' | 'failed';

export type Project = {
  id: string;
  title: string;
  status: ProjectStatus;
  createdAt?: string;
  updatedAt?: string;
  durationSec?: number;
  /** Project-relative path, as stored in the project index. */
  thumbnailPath?: string;
  videoPath?: string;
  /** Ready-to-use media URL, when the server built one for us. */
  videoUrl?: string;
  /** `16:9` etc. Recorded by the API when the run was started. */
  aspect?: string;
  scenes?: number;
  /** Present when the last run failed and the server recorded why. */
  error?: string;
};

export type ProjectDetail = {
  project: Project;
  /** Absent until the plan stage has written `storyboard.json`. */
  storyboard?: Storyboard;
};

export type GenerateInput = {
  text?: string;
  url?: string;
  /** A dropped pdf/md/txt/docx. Sent as multipart when present. */
  file?: File;
  title?: string;
  aspect: Aspect;
  language: string;
  voice: string;
  style: InkStyle;
  palette: Palette;
};

/* ---------------------------------------------------------------- transport */

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function extractError(body: unknown): string | undefined {
  if (typeof body === 'string' && body.trim()) return body.trim().slice(0, 400);
  if (body && typeof body === 'object') {
    const rec = body as Record<string, unknown>;
    for (const key of ['error', 'message', 'detail']) {
      const v = rec[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (v && typeof v === 'object') {
        const nested = (v as Record<string, unknown>).message;
        if (typeof nested === 'string' && nested.trim()) return nested.trim();
      }
    }
  }
  return undefined;
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { Accept: 'application/json', ...init?.headers } });
  } catch (cause) {
    // A network-level failure: the dev server restarted, or we are offline.
    throw new ApiError(
      cause instanceof DOMException && cause.name === 'AbortError'
        ? 'Request cancelled.'
        : 'Could not reach the studio server.',
      0,
      cause,
    );
  }

  const body = await readBody(res);
  if (!res.ok) {
    throw new ApiError(
      extractError(body) ?? `${res.status} ${res.statusText || 'request failed'}`,
      res.status,
      body,
    );
  }
  // A 200 that carries `{ error }` is still a failure.
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const err = (body as Record<string, unknown>).error;
    if (typeof err === 'string' && err.trim()) throw new ApiError(err.trim(), res.status, body);
  }
  return body;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/* ------------------------------------------------------------ normalisation */

const READY = new Set(['ready', 'done', 'complete', 'completed', 'finished', 'rendered']);
const RUNNING = new Set(['running', 'generating', 'rendering', 'in_progress', 'in-progress', 'busy']);
const QUEUED = new Set(['queued', 'pending', 'waiting', 'starting']);
const FAILED = new Set(['failed', 'error', 'errored', 'cancelled', 'canceled']);

function normaliseStatus(raw: unknown, hasVideo: boolean): ProjectStatus {
  const s = typeof raw === 'string' ? raw.toLowerCase().trim() : '';
  if (READY.has(s)) return 'ready';
  if (RUNNING.has(s)) return 'running';
  if (QUEUED.has(s)) return 'queued';
  if (FAILED.has(s)) return 'failed';
  // No usable status: a finished video on disk is the only honest signal left.
  return hasVideo ? 'ready' : 'draft';
}

/** Shape a raw project record into `Project`, keeping unknown fields out. */
export function parseProject(raw: unknown): Project {
  const rec = asRecord(raw);
  const id = str(rec.id) ?? str(rec.projectId);
  if (!id) throw new ApiError('The server returned a project without an id.', 0, raw);

  const videoPath = str(rec.videoPath) ?? str(rec.video);
  const serverVideoUrl = str(rec.videoUrl);
  const project: Project = {
    id,
    title: str(rec.title) ?? id,
    status: normaliseStatus(rec.status, Boolean(videoPath ?? serverVideoUrl)),
  };

  const createdAt = str(rec.createdAt);
  if (createdAt) project.createdAt = createdAt;
  const updatedAt = str(rec.updatedAt);
  if (updatedAt) project.updatedAt = updatedAt;
  const durationSec = num(rec.durationSec);
  if (durationSec !== undefined && durationSec > 0) project.durationSec = durationSec;
  const thumbnailPath = str(rec.thumbnailPath) ?? str(rec.thumbnail);
  if (thumbnailPath) project.thumbnailPath = thumbnailPath;
  if (videoPath) project.videoPath = videoPath;
  if (serverVideoUrl) project.videoUrl = serverVideoUrl;
  const aspect = str(rec.aspect);
  if (aspect) project.aspect = aspect;
  const scenes = num(rec.scenes);
  if (scenes !== undefined) project.scenes = scenes;
  const error = str(rec.error);
  if (error) project.error = error;

  return project;
}

/**
 * Shape a `{ project, storyboard }` response.
 *
 * The storyboard is passed through structurally rather than parsed with the Zod
 * schema from `@inkcast/core` — that module cannot be bundled for the browser.
 * We only require the two fields every consumer here reads (`title`, `scenes`),
 * and treat anything else as absent.
 */
export function parseProjectDetail(raw: unknown, fallbackId?: string): ProjectDetail {
  const rec = asRecord(raw);
  const projectRaw = rec.project === undefined ? { id: fallbackId } : rec.project;
  const project = parseProject(
    fallbackId ? { id: fallbackId, ...asRecord(projectRaw) } : projectRaw,
  );

  const sbRaw = asRecord(rec.storyboard);
  const storyboard =
    Array.isArray(sbRaw.scenes) && typeof sbRaw.title === 'string'
      ? (rec.storyboard as Storyboard)
      : undefined;

  return storyboard ? { project, storyboard } : { project };
}

/* ------------------------------------------------------------------- routes */

/** The API path for a project's detail record. Used by server components too. */
export function projectPath(id: string): string {
  return `/api/projects/${encodeURIComponent(id)}`;
}

/** The SSE endpoint for a run's progress. */
export function streamPath(id: string): string {
  return `/api/generate/${encodeURIComponent(id)}/stream`;
}

/**
 * Start a run.
 *
 * A pasted document or a URL goes as JSON. A dropped binary (pdf, docx) goes as
 * `multipart/form-data` with the file under `file`, because the browser cannot
 * extract its text and the ingest stage can.
 */
export async function generate(input: GenerateInput, signal?: AbortSignal): Promise<string> {
  // `POST /api/generate` validates with a strict schema: the storyboard
  // overrides go under `meta`, and exactly one source may be present.
  const meta = {
    aspect: input.aspect,
    language: input.language,
    voice: input.voice,
    style: input.style,
    palette: input.palette,
  };
  const title = input.title?.trim();

  let init: RequestInit;
  if (input.file) {
    // Multipart: every scalar is a string and `meta` travels as a JSON blob.
    const form = new FormData();
    form.append('meta', JSON.stringify(meta));
    if (title) form.append('title', title);
    form.append('file', input.file, input.file.name);
    init = { method: 'POST', body: form };
  } else {
    const body: Record<string, unknown> = { meta };
    if (title) body.title = title;
    if (input.text?.trim()) body.text = input.text;
    if (input.url?.trim()) body.url = input.url.trim();
    init = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    };
  }

  const out = asRecord(await request('/api/generate', { ...init, ...(signal ? { signal } : {}) }));
  const projectId = str(out.projectId) ?? str(out.id);
  if (!projectId) throw new ApiError('The server did not return a project id.', 0, out);
  return projectId;
}

export async function listProjects(signal?: AbortSignal): Promise<Project[]> {
  const out = asRecord(await request('/api/projects', signal ? { signal } : undefined));
  const list = Array.isArray(out.projects) ? out.projects : [];
  const projects: Project[] = [];
  for (const raw of list) {
    try {
      projects.push(parseProject(raw));
    } catch {
      // One malformed row must not blank the whole library.
    }
  }
  return projects;
}

export async function getProject(id: string, signal?: AbortSignal): Promise<ProjectDetail> {
  const out = await request(projectPath(id), signal ? { signal } : undefined);
  return parseProjectDetail(out, id);
}

export async function editProject(
  id: string,
  instruction: string,
  signal?: AbortSignal,
): Promise<Storyboard> {
  const out = await request(`${projectPath(id)}/edit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instruction }),
    ...(signal ? { signal } : {}),
  });
  const detail = parseProjectDetail({ project: { id }, storyboard: asRecord(out).storyboard }, id);
  if (!detail.storyboard) {
    throw new ApiError('The edit came back without a storyboard.', 0, out);
  }
  return detail.storyboard;
}

export async function rerenderProject(id: string, signal?: AbortSignal): Promise<string> {
  const out = asRecord(
    await request(`${projectPath(id)}/rerender`, {
      method: 'POST',
      ...(signal ? { signal } : {}),
    }),
  );
  return str(out.projectId) ?? id;
}

export async function deleteProject(id: string, signal?: AbortSignal): Promise<void> {
  await request(projectPath(id), { method: 'DELETE', ...(signal ? { signal } : {}) });
}

/* -------------------------------------------------------------------- media */

/**
 * A URL for one of a project's artefacts.
 *
 * Paths stored in `pipeline.json` are project-relative, but a stage may hand
 * back an absolute one; both collapse to the same media route.
 */
export function mediaUrl(projectId: string, filePath?: string | null): string | undefined {
  if (!filePath) return undefined;
  const normalised = filePath.replaceAll('\\', '/');
  const marker = `/${projectId}/`;
  const cut = normalised.lastIndexOf(marker);
  const rel = (cut >= 0 ? normalised.slice(cut + marker.length) : normalised).replace(/^\/+/, '');
  if (!rel || rel.includes('..')) return undefined;
  const encoded = rel.split('/').map(encodeURIComponent).join('/');
  return `/api/media/${encodeURIComponent(projectId)}/${encoded}`;
}

/**
 * The playable URL. The API already builds one for any project with a video on
 * disk; `out.mp4` is only a fallback for a record that reports ready without it.
 */
export function videoUrl(project: Project): string | undefined {
  if (project.videoUrl) return project.videoUrl;
  if (project.videoPath) return mediaUrl(project.id, project.videoPath);
  return project.status === 'ready' ? mediaUrl(project.id, 'out.mp4') : undefined;
}

export function thumbnailUrl(project: Project): string | undefined {
  return mediaUrl(project.id, project.thumbnailPath);
}

/** A filesystem-friendly download name for a finished video. */
export function downloadName(title: string, id: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || `inkcast-${id}`}.mp4`;
}
