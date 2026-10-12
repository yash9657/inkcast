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
 *   GET    /api/providers           -> { providers, local, keys, warnings, accepts }
 *
 * `/api/keys` is deliberately absent from this module. Its client lives in
 * `components/settings/client.ts`, next to the only screen that may call it, so
 * that nothing which imports the general studio client acquires the ability to
 * post a credential.
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
  /**
   * What the facts in this film rest on, when the run recorded it (plan 5.1; audit
   * S0-a). `parametric` means a bare topic: nothing was retrieved, so every claim is the
   * model's own knowledge and nothing downstream could have checked it. Absent on films
   * cast before the pipeline recorded this, which is not the same as `parametric`.
   */
  grounding?: 'document' | 'parametric' | 'supplied';
  /**
   * Classes of picture this film asked for that inkcast has no renderer for (plan 6.1;
   * audit S5-a) — `chemistry`, `circuits`, `geography`, `code`. Absent, and normally so:
   * it is named only when a lesson actually asked for one.
   *
   * Free strings, not a union, and unlike `grounding` an unrecognised one is *kept*: the
   * name is the message here, so a lane a newer pipeline learns to miss should reach the
   * reader before this file learns to spell it.
   */
  unservedLanes?: string[];
  /** Present when the last run failed and the server recorded why. */
  error?: string;
};

export type ProjectDetail = {
  project: Project;
  /** Absent until the plan stage has written `storyboard.json`. */
  storyboard?: Storyboard;
};

/**
 * How thoroughly to teach, and therefore how long the video runs.
 *
 * **No longer what the studio's Length control sends.** `depth` and `targetSeconds`
 * are `meta` fields, and `POST /api/generate` has never validated either — so
 * `teachingMeta()` dropped them on every submit and the form printed a note saying
 * the runtime followed the document. The control that offered them is now
 * `FilmFormat`, which selects a preset the endpoint really does accept.
 *
 * Kept because they are a coherent request to make of a server that grows the
 * fields, and `teachingMeta()` still guards them behind `accepts`. Nothing in this
 * app sets them today.
 */
export type Depth = 'short' | 'standard' | 'deep';

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
  depth?: Depth;
  /** Target runtime the lesson stage should plan against. */
  targetSeconds?: number;
  /**
   * The film's shape. Sent only when the server advertised it in `formats`.
   *
   * Not part of `meta`: this is the *format* — the preset — and it sits beside
   * `meta` in the generate schema for the same reason it sits beside it here.
   */
  format?: FilmFormat;
  /** What `GET /api/providers` said this build accepts as `preset`. */
  formats?: readonly FilmFormat[];
  /**
   * The `meta` field names this server validates, from `GET /api/providers`.
   *
   * Depth and target length are newer than the generate endpoint's schema, which
   * is `.strict()` — an unrecognised field is a 400, not a shrug. So they are sent
   * only when the server has advertised them, which means a studio that knows
   * about an option can never break against a build that does not. Leave it
   * undefined and neither is sent.
   */
  accepts?: readonly string[];
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

/**
 * The transport, for the one feature client that lives outside this module.
 *
 * `components/settings/client.ts` needs the same error normalisation — an
 * `ApiError` whose message is the server's sentence — and duplicating it would
 * mean two behaviours for a failed request. Exported rather than copied; the
 * settings client is still the only place that knows the keys endpoints exist.
 */
export const apiRequest = request;

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
const RUNNING = new Set([
  'running',
  'generating',
  'rendering',
  'in_progress',
  'in-progress',
  'busy',
]);
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
  // Plan 5.1. Validated against the three known values rather than passed through as a
  // string: this drives a sentence a viewer reads about how much to trust the film, and a
  // value nothing here recognises must render as *absent* — which says "nobody recorded
  // it" — rather than as a fourth state the UI has no wording for.
  const grounding = str(rec.grounding);
  if (grounding === 'document' || grounding === 'parametric' || grounding === 'supplied') {
    project.grounding = grounding;
  }
  // Plan 6.1, and flattened out of the record's `{ lanes: { unserved } }` because the
  // studio only ever wants the list. Filtered to non-empty strings for the usual reason a
  // parser here filters anything: this reaches a sentence a person reads.
  const unserved = asRecord(rec.lanes).unserved;
  if (Array.isArray(unserved)) {
    const names = unserved.map(str).filter((s): s is string => Boolean(s));
    if (names.length > 0) project.unservedLanes = names;
  }

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

/* ------------------------------------------------------------ capabilities */

/** Which provider a stage will use on this machine, and why. */
export type StageProvider = {
  name: string;
  /** True when the work leaves this machine and can be billed. */
  cloud: boolean;
  why: string;
  model?: string;
};

/** The masked view of one credential. A key value never appears here. */
export type KeyState = {
  id: 'fireworks' | 'anthropic' | 'elevenlabs' | 'replicate' | 'fal';
  envVar: string;
  configured: boolean;
  /** `keychain` on macOS, where `@inkcast/keyvault` uses the OS keychain. */
  source: 'env' | 'vault' | 'keychain' | 'none';
  mask?: string;
  length?: number;
  updatedAt?: string;
  /** Stored but unusable — see `locked` for which of the two reasons. */
  unreadable?: boolean;
  /** Unusable because no passphrase is available, not because it is damaged. */
  locked?: boolean;
  /** A stored-but-unusable entry sits behind the environment key in use. */
  shadowedByEnv?: boolean;
  /** The saved key is in use; an env var for the same provider is ignored. */
  overridesEnv?: boolean;
};

export type Capabilities = {
  planner: StageProvider;
  voice: StageProvider;
  images: StageProvider;
  /** True when nothing in a run leaves this machine. */
  local: boolean;
  keys: KeyState[];
  /** The degradations in plain language, worst first. */
  warnings: string[];
  /** `meta` fields `POST /api/generate` will accept on this build. */
  accepts: string[];
  /**
   * The ink packs in this tree's `styles/`, as the server read them.
   *
   * Empty when the server is older than this field or could not read the directory,
   * which is why the picker keeps a built-in list to fall back to — see
   * `components/studio/options.ts`.
   */
  styles: StylePack[];
  /**
   * The film shapes `POST /api/generate` will accept as `preset` on this build.
   *
   * Empty against a server that predates the field, and the form then sends no
   * `preset` at all — which is right rather than merely safe: that server's own
   * default is whatever it was, and a `.strict()` schema would 400 the whole
   * request over an option it has never heard of.
   */
  formats: FilmFormat[];
};

/**
 * How long the film runs, and what the board does between beats.
 *
 * Both wipe: one card per beat, cleared between them. The mega-canvas presets
 * (`standard`, `short`, `square`) are reachable from the CLI and deliberately not
 * from here — see `studioFormat` in `lib/jobs.ts`.
 */
export type FilmFormat = 'explainer' | 'deepdive';

/** One ink pack, named by the file it came from. See `styles/README.md`. */
export type StylePack = { id: InkStyle; label: string; hint: string };

function parseStageProvider(raw: unknown): StageProvider {
  const rec = asRecord(raw);
  const model = str(rec.model);
  return {
    name: str(rec.name) ?? 'unknown',
    cloud: rec.cloud === true,
    why: str(rec.why) ?? '',
    ...(model === undefined ? {} : { model }),
  };
}

const KEY_IDS = ['fireworks', 'anthropic', 'elevenlabs', 'replicate', 'fal'] as const;

function parseKeyState(raw: unknown): KeyState | undefined {
  const rec = asRecord(raw);
  const id = KEY_IDS.find((candidate) => candidate === rec.id);
  if (!id) return undefined;
  const mask = str(rec.mask);
  const updatedAt = str(rec.updatedAt);
  const length = num(rec.length);
  const source =
    rec.source === 'env' || rec.source === 'vault' || rec.source === 'keychain'
      ? rec.source
      : 'none';
  return {
    id,
    envVar: str(rec.envVar) ?? '',
    configured: rec.configured === true,
    source,
    ...(mask === undefined ? {} : { mask }),
    ...(length === undefined ? {} : { length }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    ...(rec.unreadable === true ? { unreadable: true as const } : {}),
    ...(rec.locked === true ? { locked: true as const } : {}),
    ...(rec.shadowedByEnv === true ? { shadowedByEnv: true as const } : {}),
    ...(rec.overridesEnv === true ? { overridesEnv: true as const } : {}),
  };
}

/**
 * What this machine can currently do.
 *
 * Every field is derived from the server's answer; nothing is inferred. If the
 * request fails the caller gets an `ApiError` and should render the studio as if
 * fully local — which is the truthful default, since local is what runs when
 * nothing else is configured.
 */
export async function getCapabilities(signal?: AbortSignal): Promise<Capabilities> {
  const out = asRecord(await request('/api/providers', signal ? { signal } : undefined));
  const providers = asRecord(out.providers);
  const keys: KeyState[] = [];
  for (const raw of Array.isArray(out.keys) ? out.keys : []) {
    const parsed = parseKeyState(raw);
    if (parsed) keys.push(parsed);
  }
  return {
    planner: parseStageProvider(providers.planner),
    voice: parseStageProvider(providers.voice),
    images: parseStageProvider(providers.images),
    local: out.local === true,
    keys,
    warnings: (Array.isArray(out.warnings) ? out.warnings : []).filter(
      (line): line is string => typeof line === 'string' && line.trim() !== '',
    ),
    accepts: (Array.isArray(out.accepts) ? out.accepts : []).filter(
      (field): field is string => typeof field === 'string',
    ),
    formats: (Array.isArray(out.formats) ? out.formats : []).filter(
      (name): name is FilmFormat => name === 'explainer' || name === 'deepdive',
    ),
    styles: (Array.isArray(out.styles) ? out.styles : []).flatMap((raw) => {
      const rec = asRecord(raw);
      const id = str(rec.id);
      // A pack with no id is not a pack. The hint is genuinely optional — the
      // schema defaults `description` to an empty string — so it is not a filter.
      return id ? [{ id, label: str(rec.label) ?? id, hint: str(rec.hint) ?? '' }] : [];
    }),
  };
}

/** The key state for one provider, or `undefined` when the server omitted it. */
export function keyStateFor(
  caps: Capabilities | undefined,
  id: KeyState['id'],
): KeyState | undefined {
  return caps?.keys.find((key) => key.id === id);
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
 * The names a build might use for "how long should this be".
 *
 * Checked in order against what the server advertises. The lesson stage's own
 * option is `maxSeconds`; a storyboard-level mirror of it would more naturally be
 * `targetSeconds`. Rather than betting on one, this sends whichever the endpoint
 * says it validates, and nothing at all when it validates neither.
 */
const SECONDS_FIELDS = ['targetSeconds', 'maxSeconds', 'targetSec'] as const;

/**
 * The teaching-depth part of `meta`, reduced to what this server accepts.
 *
 * Silently dropping an option is normally a bad idea, which is why the create
 * form reads the same `accepts` list and says out loud when length is not being
 * sent. The alternative — posting the field regardless — turns a missing feature
 * into a failed render, and the aspect ratio, ink and voice the user also chose
 * would go down with it.
 */
function teachingMeta(input: GenerateInput): Record<string, unknown> {
  const accepts = input.accepts;
  if (!accepts || accepts.length === 0) return {};
  const out: Record<string, unknown> = {};
  if (input.depth !== undefined && accepts.includes('depth')) out.depth = input.depth;
  if (input.targetSeconds !== undefined) {
    const field = SECONDS_FIELDS.find((name) => accepts.includes(name));
    if (field) out[field] = Math.round(input.targetSeconds);
  }
  return out;
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
  const meta: Record<string, unknown> = {
    aspect: input.aspect,
    language: input.language,
    voice: input.voice,
    style: input.style,
    palette: input.palette,
    ...teachingMeta(input),
  };
  const title = input.title?.trim();
  /*
   * The format, sent only when this server said it validates one.
   *
   * Same rule as `teachingMeta` above and for the same reason: the generate schema
   * is `.strict()`, so a field a build has never heard of is a 400 that takes the
   * aspect ratio, ink and voice down with it. A server too old to advertise
   * `formats` renders at whatever its own default is, which is the honest outcome.
   */
  const format = input.format && input.formats?.includes(input.format) ? input.format : undefined;

  let init: RequestInit;
  if (input.file) {
    // Multipart: every scalar is a string and `meta` travels as a JSON blob.
    const form = new FormData();
    form.append('meta', JSON.stringify(meta));
    if (title) form.append('title', title);
    if (format) form.append('preset', format);
    form.append('file', input.file, input.file.name);
    init = { method: 'POST', body: form };
  } else {
    const body: Record<string, unknown> = { meta };
    if (title) body.title = title;
    if (format) body.preset = format;
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
