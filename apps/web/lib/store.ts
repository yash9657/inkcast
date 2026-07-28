/**
 * Environment bootstrap + the studio's project index.
 *
 * ## Why this file has no static workspace imports
 *
 * `@inkcast/core` captures `PROJECTS_ROOT` from `INKCAST_PROJECTS` **once, at
 * module load** (see `packages/core/src/project.ts`). `next dev` runs with
 * `apps/web` as its cwd, so if core loaded before we fixed that variable every
 * project directory would land in `apps/web/projects/` and the studio would not
 * see anything the CLI produced.
 *
 * The CLI solves this in `apps/cli/src/env.ts` by configuring the environment
 * and *then* dynamically importing everything else. This module is the web
 * equivalent: its body runs the bootstrap, and core/pipeline are reached only
 * through the memoised `loadCore()` / `loadPipeline()` helpers below, which
 * cannot possibly evaluate earlier. Route handlers therefore use `import type`
 * for workspace types and never a value import — that keeps correctness out of
 * the hands of import ordering.
 *
 * ## What the index is for
 *
 * `projects/index.json` is a *cache*, never the source of truth. The pipeline
 * can rebuild every finished project from disk alone (`pipeline.json` +
 * `storyboard.json`), and the CLI writes projects this app never saw. So the
 * index only adds what disk cannot know: that a run is in flight, and why the
 * last one failed. Listing merges the two, disk winning on anything factual.
 */

import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import type * as CoreModule from '@inkcast/core';
import type * as PipelineModule from '@inkcast/pipeline';

/* --------------------------------------------------------------- bootstrap */

const ROOT_MARKERS = ['pnpm-workspace.yaml', 'tsconfig.base.json'];

/** Nearest ancestor of `from` that looks like the monorepo root. */
function findRepoRoot(from: string): string {
  let dir = path.resolve(from);
  for (;;) {
    if (ROOT_MARKERS.every((m) => existsSync(path.join(dir, m)))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(from);
    dir = parent;
  }
}

/**
 * Minimal `.env` reader for the *repo root* file.
 *
 * Next only auto-loads `.env` from the app directory (`apps/web`), but the repo
 * root `.env` is the one `.env.example` documents and the one the CLI reads, so
 * a key set there must work in the studio too. Never overwrites a variable that
 * is already set, so the real environment and `apps/web/.env.local` both win.
 */
function loadRootDotEnv(root: string): void {
  const file = path.join(root, '.env');
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line
      .slice(0, eq)
      .replace(/^export\s+/, '')
      .trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) continue;
    let value = line.slice(eq + 1).trim();
    const quoted = /^(["'])([\s\S]*)\1$/.exec(value);
    if (quoted) value = quoted[2]!;
    else value = value.replace(/\s+#.*$/, '').trim();
    process.env[key] = value;
  }
}

function bootstrap(): { repoRoot: string; projectsRoot: string } {
  const repoRoot = findRepoRoot(process.cwd());
  loadRootDotEnv(repoRoot);
  if (!process.env.INKCAST_PROJECTS) {
    process.env.INKCAST_PROJECTS = path.join(repoRoot, 'projects');
  }
  return { repoRoot, projectsRoot: path.resolve(process.env.INKCAST_PROJECTS) };
}

/**
 * Survive HMR. `next dev` re-evaluates this module on edit; re-running the
 * bootstrap is harmless but recomputing the roots per reload is wasted work,
 * and pinning them on `globalThis` keeps them identical to whatever a job
 * captured on the previous reload.
 */
const globalScope = globalThis as typeof globalThis & {
  __inkcastEnv?: { repoRoot: string; projectsRoot: string };
};
const env = (globalScope.__inkcastEnv ??= bootstrap());

/** Monorepo root — where `projects/`, `examples/` and `.env` live. */
export const REPO_ROOT = env.repoRoot;

/** Absolute path of the directory holding every project directory. */
export const PROJECTS_DIR = env.projectsRoot;

/* -------------------------------------------------------- lazy workspace io */

let corePromise: Promise<typeof CoreModule> | undefined;
let pipelinePromise: Promise<typeof PipelineModule> | undefined;

/** `@inkcast/core`, guaranteed to load after the environment is configured. */
export function loadCore(): Promise<typeof CoreModule> {
  return (corePromise ??= import('@inkcast/core'));
}

/** `@inkcast/pipeline`, likewise. The stage packages stay lazy inside it. */
export function loadPipeline(): Promise<typeof PipelineModule> {
  return (pipelinePromise ??= import('@inkcast/pipeline'));
}

/* ------------------------------------------------------------------- paths */

/**
 * Project ids come from `projectId()` in core: base36 timestamps or hex
 * digests. Anything outside this alphabet is not an id we ever wrote, and
 * rejecting it early is what stops `..` and absolute paths reaching the fs.
 */
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function isValidProjectId(id: string): boolean {
  return ID_RE.test(id);
}

/**
 * Absolute directory for a project, or `undefined` when the id is not one we
 * would have written. Never throws — callers turn `undefined` into a 400.
 */
export function projectDir(id: string): string | undefined {
  if (!isValidProjectId(id)) return undefined;
  const dir = path.resolve(PROJECTS_DIR, id);
  // Belt and braces: the regex already forbids separators, but containment is
  // the property we actually care about, so assert it rather than infer it.
  if (path.dirname(dir) !== PROJECTS_DIR) return undefined;
  return dir;
}

export function projectExists(id: string): boolean {
  const dir = projectDir(id);
  return dir !== undefined && existsSync(dir);
}

/** URL the browser can fetch a project-relative artefact from. */
export function mediaUrl(id: string, relPath: string): string {
  const clean = relPath.split(path.sep).join('/').replace(/^\/+/, '');
  return `/api/media/${encodeURIComponent(id)}/${clean.split('/').map(encodeURIComponent).join('/')}`;
}

/* ------------------------------------------------------------------- index */

export const PROJECT_STATUSES = ['queued', 'running', 'ready', 'failed'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

const SourceRefSchema = z.object({
  kind: z.enum(['text', 'url', 'file']),
  ref: z.string(),
});

const ProjectRecordSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(PROJECT_STATUSES),
  createdAt: z.string(),
  updatedAt: z.string(),
  scenes: z.number().int().nonnegative().default(0),
  durationSec: z.number().nonnegative().default(0),
  /** Project-relative path of the finished video, when one exists on disk. */
  videoPath: z.string().optional(),
  source: SourceRefSchema.optional(),
  /** Failure message from the last run, cleared when a run succeeds. */
  error: z.string().optional(),
  costUsd: z.number().nonnegative().optional(),
  aspect: z.string().optional(),
});

export type ProjectRecord = z.infer<typeof ProjectRecordSchema>;

/** What the API actually returns: the record plus browser-ready URLs. */
export type ProjectDto = ProjectRecord & { videoUrl?: string };

const IndexSchema = z.object({
  version: z.literal(1),
  projects: z.record(z.string(), ProjectRecordSchema),
});

const INDEX_FILE = 'index.json';

function indexPath(): string {
  return path.join(PROJECTS_DIR, INDEX_FILE);
}

async function readIndex(): Promise<Record<string, ProjectRecord>> {
  let raw: string;
  try {
    raw = await readFile(indexPath(), 'utf8');
  } catch {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A truncated index is a cache miss, not an outage: disk still has the
    // projects, so returning empty degrades to a full rescan.
    return {};
  }
  const result = IndexSchema.safeParse(parsed);
  if (result.success) return result.data.projects;

  // Salvage what we can — one bad entry should not hide every other project.
  const salvaged: Record<string, ProjectRecord> = {};
  const bag = (parsed as { projects?: unknown })?.projects;
  if (bag && typeof bag === 'object') {
    for (const [id, value] of Object.entries(bag as Record<string, unknown>)) {
      const one = ProjectRecordSchema.safeParse(value);
      if (one.success) salvaged[id] = one.data;
    }
  }
  return salvaged;
}

/**
 * Serialise index writes.
 *
 * Several jobs can finish at once, and read-modify-write on a shared JSON file
 * is exactly where that loses data. The chain is per-process, which is all we
 * need: concurrent renders live in this process, and the CLI does not touch
 * this file at all.
 */
let writeChain: Promise<unknown> = Promise.resolve();

function serialise<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  // Keep the chain alive regardless of individual failures.
  writeChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function writeIndex(projects: Record<string, ProjectRecord>): Promise<void> {
  await mkdir(PROJECTS_DIR, { recursive: true });
  const body = `${JSON.stringify({ version: 1, projects }, null, 2)}\n`;
  // Write-then-rename so a crash mid-write cannot leave a half-file behind.
  const tmp = `${indexPath()}.${process.pid}.tmp`;
  await writeFile(tmp, body);
  await rename(tmp, indexPath());
}

/**
 * Create or update one entry. Returns the stored record.
 * `createdAt` is preserved; `updatedAt` is stamped on every call.
 */
export function upsertProject(
  id: string,
  patch: Partial<Omit<ProjectRecord, 'id'>>,
): Promise<ProjectRecord> {
  return serialise(async () => {
    const projects = await readIndex();
    const now = new Date().toISOString();
    const previous = projects[id];
    const videoPath = patch.videoPath ?? previous?.videoPath;
    const source = patch.source ?? previous?.source;
    const costUsd = finite(patch.costUsd ?? previous?.costUsd);
    const aspect = patch.aspect ?? previous?.aspect;

    const record: ProjectRecord = {
      id,
      title: patch.title ?? previous?.title ?? id,
      status: patch.status ?? previous?.status ?? 'queued',
      createdAt: previous?.createdAt ?? patch.createdAt ?? now,
      updatedAt: now,
      scenes: patch.scenes ?? previous?.scenes ?? 0,
      durationSec: finite(patch.durationSec ?? previous?.durationSec) ?? 0,
      ...(videoPath === undefined ? {} : { videoPath }),
      ...(source === undefined ? {} : { source }),
      ...(costUsd === undefined ? {} : { costUsd }),
      ...(aspect === undefined ? {} : { aspect }),
      // `error` is deliberately *not* inherited: a run that reaches 'ready'
      // clears the previous failure instead of carrying it forever.
      ...(patch.error === undefined ? {} : { error: patch.error }),
    };
    projects[id] = record;
    await writeIndex(projects);
    return record;
  });
}

export function removeProjectFromIndex(id: string): Promise<void> {
  return serialise(async () => {
    const projects = await readIndex();
    if (!(id in projects)) return;
    delete projects[id];
    await writeIndex(projects);
  });
}

/* ------------------------------------------------------------------ reading */

function toDto(record: ProjectRecord): ProjectDto {
  return {
    ...record,
    ...(record.videoPath ? { videoUrl: mediaUrl(record.id, record.videoPath) } : {}),
  };
}

/**
 * Every project the studio should show, newest first.
 *
 * Disk is authoritative for title/scenes/duration/video — that is what makes a
 * project created by `pnpm cast` appear here with no extra bookkeeping. The
 * index contributes status and error, plus the entries for runs that have not
 * written anything yet.
 */
export async function listProjects(): Promise<ProjectDto[]> {
  const [indexed, onDisk] = await Promise.all([readIndex(), scanDisk()]);
  const byId = new Map<string, ProjectRecord>();

  for (const [id, record] of Object.entries(indexed)) byId.set(id, record);

  for (const summary of onDisk) {
    byId.set(summary.id, mergeDisk(summary, byId.get(summary.id)));
  }

  return [...byId.values()]
    .filter((r) => projectExists(r.id) || r.status === 'queued' || r.status === 'running')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(toDto);
}

/**
 * Fold a disk scan over an index entry.
 *
 * Disk wins on everything it can observe. The index only survives where it
 * knows something disk cannot: that a run is in flight right now, and why the
 * last one failed.
 */
function mergeDisk(summary: DiskSummary, previous: ProjectRecord | undefined): ProjectRecord {
  const inFlight = previous?.status === 'running' || previous?.status === 'queued';
  const status: ProjectStatus = inFlight
    ? previous.status
    : summary.videoPath
      ? 'ready'
      : (previous?.status ?? 'failed');
  const updatedAt =
    previous && previous.updatedAt > summary.updatedAt ? previous.updatedAt : summary.updatedAt;
  const source = summary.source ?? previous?.source;
  const costUsd = summary.costUsd ?? previous?.costUsd;

  return {
    id: summary.id,
    title: summary.title,
    status,
    createdAt: previous?.createdAt ?? updatedAt,
    updatedAt,
    scenes: summary.scenes,
    durationSec: summary.durationSec,
    ...(summary.videoPath ? { videoPath: summary.videoPath } : {}),
    ...(source === undefined ? {} : { source }),
    ...(costUsd === undefined ? {} : { costUsd }),
    ...(previous?.aspect === undefined ? {} : { aspect: previous.aspect }),
    // A project with a video on disk is not a failure, whatever the index says.
    ...(previous?.error !== undefined && !summary.videoPath ? { error: previous.error } : {}),
  };
}

export async function getProject(id: string): Promise<ProjectDto | undefined> {
  const dir = projectDir(id);
  if (!dir) return undefined;
  const indexed = (await readIndex())[id];
  if (!existsSync(dir)) return indexed ? toDto(indexed) : undefined;

  const summary = await summarise(id, dir);
  if (!summary) return indexed ? toDto(indexed) : undefined;
  return toDto(mergeDisk(summary, indexed));
}

/** A project's storyboard, or `undefined` when it has not been planned yet. */
export async function readProjectStoryboard(
  id: string,
): Promise<CoreModule.Storyboard | undefined> {
  const dir = projectDir(id);
  if (!dir || !existsSync(path.join(dir, 'storyboard.json'))) return undefined;
  const core = await loadCore();
  try {
    return await core.loadStoryboard(dir);
  } catch {
    // Present but unparseable (hand-edited, or written by a newer version).
    return undefined;
  }
}

/** Delete a project directory and its index entry. */
export async function deleteProject(id: string): Promise<boolean> {
  const dir = projectDir(id);
  if (!dir) return false;
  const existed = existsSync(dir);
  if (existed) await rm(dir, { recursive: true, force: true });
  await removeProjectFromIndex(id);
  return existed;
}

/* --------------------------------------------------------------- disk scan */

type DiskSummary = {
  id: string;
  title: string;
  scenes: number;
  durationSec: number;
  /** Project-relative. */
  videoPath?: string;
  updatedAt: string;
  costUsd?: number;
  source?: z.infer<typeof SourceRefSchema>;
};

/**
 * Reuse the pipeline's own project scan rather than re-deriving it here: it
 * already tolerates half-finished directories and knows where the video lives.
 */
async function scanDisk(): Promise<DiskSummary[]> {
  let ids: string[];
  try {
    ids = (await readdir(PROJECTS_DIR, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter(isValidProjectId);
  } catch {
    return [];
  }
  const out: DiskSummary[] = [];
  for (const id of ids) {
    const dir = path.join(PROJECTS_DIR, id);
    const summary = await summarise(id, dir);
    if (summary) out.push(summary);
  }
  return out;
}

async function summarise(id: string, dir: string): Promise<DiskSummary | undefined> {
  const pipeline = await loadPipeline();
  const core = await loadCore();

  const state = await pipeline.readState(dir);
  let storyboard: CoreModule.Storyboard | undefined;
  try {
    storyboard = await core.loadStoryboard(dir);
  } catch {
    storyboard = undefined;
  }
  if (!storyboard && !state) return undefined;

  const videoAbs = await pipeline.findVideo(dir, state?.videoPath);
  return {
    id,
    title: storyboard?.title ?? state?.title ?? id,
    scenes: storyboard?.scenes.length ?? 0,
    durationSec: finite(storyboard ? core.totalDuration(storyboard) : state?.durationSec) ?? 0,
    ...(videoAbs ? { videoPath: path.relative(dir, videoAbs) || 'out.mp4' } : {}),
    updatedAt: state?.updatedAt ?? (await mtime(dir)),
    ...(state?.cost ? { costUsd: state.cost.usd } : {}),
    ...(state?.source ? { source: state.source } : {}),
  };
}

/**
 * Coerce a number that has to survive a JSON round trip.
 *
 * `JSON.stringify(NaN)` is `null`, which fails the index schema on read and would
 * silently drop the whole entry. A duration is derived from measured audio, so a
 * missing measurement can reach here as NaN — clamp it rather than lose the
 * project over it.
 */
function finite(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** Directory mtime, for projects the pipeline never stamped. */
async function mtime(dir: string): Promise<string> {
  try {
    return (await stat(dir)).mtime.toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}
