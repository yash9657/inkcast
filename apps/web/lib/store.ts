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
 * ## What the index is for, and why it is no longer written to directly
 *
 * `projects/index.json` is a *cache*, never the source of truth. The pipeline
 * can rebuild every finished project from disk alone (`pipeline.json` +
 * `storyboard.json`), and the CLI writes projects this app never saw. So the
 * index only adds what disk cannot know: that a run is in flight, why the last
 * one failed, who owns the project, and whether it has been shared.
 *
 * That sentence used to be aspirational. Until this change the *only* copy of
 * those four facts was `index.json`, and every job that finished did a
 * read-modify-write of that one file. A single module-level promise chain
 * (`writeChain`) serialised those writes, which is correct exactly as long as
 * there is one instance of this module in one process — and neither half of
 * that holds. `next dev` re-evaluates this module on every edit, so an
 * in-flight render finishes against the *previous* instance's chain while a new
 * request writes through the new one; two chains, no mutual exclusion, and the
 * loser's projects vanish from the library. Worse, the temp file was named
 * `index.json.<pid>.tmp` — one fixed path per process — so two interleaved
 * writers raced for one path: whoever renamed second found nothing there, and
 * `upsertProject` rejected with `ENOENT` about a temp file, which is why the
 * missing projects were never traced back to the index.
 *
 * Both halves are measured rather than reasoned about. `lib/store.test.ts`
 * reimplements the committed algorithm (`git show 13c7fe8:apps/web/lib/store.ts`,
 * lines 245–311) and runs it with two module instances and 50 concurrent
 * writers: over 15 runs, **25–26 of 50 projects survived and 22–25 of the 50
 * writes rejected with ENOENT** — most often exactly 25 and 25. The same
 * scenario against the code below is 50 of 50 with nothing rejected, in all 15.
 * A four-step hand-scheduled interleaving in the same file proves the lost
 * update without depending on timing at all.
 *
 * So the layout is now:
 *
 *  - **`projects/<id>/meta.json` is the truth.** One small file per project,
 *    written atomically, holding only what disk cannot derive. Two projects
 *    finishing at once touch two different files, so there is no shared
 *    document to lose an update to — the failure mode is *structurally* gone
 *    rather than guarded against.
 *  - **`projects/index.json` is derived.** It is rebuilt from the per-project
 *    truth under `indexLock` (a real FIFO mutex, not a boolean flag), and a
 *    rebuild that is queued but has not started reading yet is *coalesced*, so
 *    50 concurrent writes cost two scans rather than fifty. Because every
 *    rebuild recomputes the whole map from truth, a lost rebuild loses nothing:
 *    the next one restores it, and a corrupt index is a cache miss.
 *
 * Nothing reads `index.json` for correctness any more (`listProjects` scans the
 * per-project truth), so it exists for cheap external inspection — `jq` over
 * one file, the D5 disk janitor — and to carry projects that predate
 * `meta.json` until their next write migrates them.
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

/**
 * True on the public deployment (`INKCAST_HOSTED=1`).
 *
 * It lives here rather than in the session helper because the answer depends on
 * the bootstrap above: `INKCAST_HOSTED` is documented in the repo-root `.env`,
 * which Next does not load and `loadRootDotEnv` does. Anything reading this
 * variable before this module's body has run would see a local machine.
 *
 * Read on every call rather than captured, so a test can flip it without
 * defeating the module cache.
 */
export function isHosted(): boolean {
  return process.env.INKCAST_HOSTED === '1';
}

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

/**
 * Kept in step with `SourceRef` in `@inkcast/pipeline`, which is the authority:
 * the pipeline now also records `topic` (a bare subject went straight into the
 * lesson stage) and `lesson` (a hand-authored `*.lesson.json` was rendered
 * directly). The studio only ever *creates* the first three, but it indexes
 * every project on disk — including ones the CLI made — so a narrower enum here
 * would drop those from the library on read.
 */
const SourceRefSchema = z.object({
  kind: z.enum(['text', 'url', 'file', 'topic', 'lesson']),
  ref: z.string(),
});

/**
 * Kept in step with `Grounding` in `@inkcast/pipeline`, which is the authority: what the
 * facts in a film rest on — a document, the model's own knowledge, or a supplied lesson
 * (plan 5.1, audit S0-a). Optional, and never defaulted: a project cast before the
 * pipeline recorded this has no answer, and guessing one would be the exact opposite of
 * what the field is for.
 */
const GroundingSchema = z.enum(['document', 'parametric', 'supplied']);

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
  /** What this film's facts rest on, when a run recorded it. See `GroundingSchema`. */
  grounding: GroundingSchema.optional(),
  /** Failure message from the last run, cleared when a run succeeds. */
  error: z.string().optional(),
  costUsd: z.number().nonnegative().optional(),
  aspect: z.string().optional(),
  /**
   * Whether `/share/<id>` may serve this project to someone who does not own
   * it. Default **false**, and a default rather than a required field so every
   * record written before sharing existed reads back as private: an id is
   * unguessable but it is not a secret — it travels in URLs, logs and screen
   * shares — so publication has to be an act, not an accident.
   */
  shared: z.boolean().default(false),
});

export type ProjectRecord = z.infer<typeof ProjectRecordSchema>;

/** What the API actually returns: the record plus browser-ready URLs. */
export type ProjectDto = ProjectRecord & { videoUrl?: string };

/**
 * `projects/<id>/meta.json` — the per-project truth.
 *
 * A superset of the public record: everything the studio shows, plus who owns
 * it. `ownerSession` is **not** a session id, it is the opaque tag
 * `sessionOwnerTag()` derives from one (`app/api/_lib/session.ts`), and that is
 * deliberate. `/api/media/<id>/<path…>` serves *any* readable file inside a
 * project directory — there is no allow-list in that route — so anyone holding
 * a shared link can fetch `meta.json`. A raw session id in this file would be a
 * bearer token handed to every viewer; a keyed digest of one is unusable
 * without the secret. `version` is written so a future shape change can migrate
 * rather than guess.
 */
const ProjectMetaSchema = ProjectRecordSchema.extend({
  version: z.literal(1).default(1),
  ownerSession: z.string().min(1).optional(),
});

export type ProjectMeta = z.infer<typeof ProjectMetaSchema>;

/**
 * What `upsertProject` accepts. `id` and `version` are the writer's business,
 * every other field is optional, and an omitted field is *inherited* rather
 * than cleared — with the one documented exception of `error`.
 */
export type ProjectPatch = Partial<Omit<ProjectMeta, 'id' | 'version'>>;

/**
 * A record beside the ownership fact that governs it.
 *
 * Ownership is kept out of `ProjectRecord` — and therefore out of every DTO the
 * API serialises — so that no route can leak an owner tag to a browser by
 * spreading a project into a response. Only `readProjectTruth` hands it out,
 * and only the session helper calls that.
 */
export type ProjectTruth = { record: ProjectRecord; ownerSession?: string };

/** Filter for `listProjects`. See that function for the unowned-project rule. */
export type ProjectFilter = {
  /** Keep only projects carrying this owner tag (`sessionOwnerTag()`). */
  ownerSession?: string;
  /**
   * Whether projects with no owner recorded are visible. Defaults to `true`
   * locally and `false` when hosted.
   */
  includeUnowned?: boolean;
};

const IndexSchema = z.object({
  version: z.literal(1),
  projects: z.record(z.string(), ProjectRecordSchema),
});

const INDEX_FILE = 'index.json';
const META_FILE = 'meta.json';

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

/* ------------------------------------------------------------------- mutex */

/**
 * A FIFO async mutex.
 *
 * The thing this replaces was a promise chain, and the thing people reach for
 * instead is `let busy = true` — which is not a lock at all, because the second
 * caller has nowhere to wait and either spins or gives up. This is the small
 * correct primitive: each caller takes the *previous* holder's release promise,
 * publishes its own before awaiting anything, and hands the lock to whoever
 * asked next. Two properties are worth spelling out because the correctness of
 * the index rebuild rests on them:
 *
 *  - **FIFO fairness.** `this.tail` is reassigned in the synchronous prologue of
 *    `run` — before the first `await` — so acquisition order is call order. No
 *    waiter can be starved by a later one, however long the queue.
 *  - **`fn` never runs synchronously.** `await previous` yields even when
 *    `previous` is already settled (a resolved promise still defers its
 *    continuation to a microtask). Callers may therefore finish their own
 *    bookkeeping after calling `run` and rely on it happening first — which is
 *    exactly what makes rebuild coalescing below safe.
 *
 * Not a dependency, because `async-mutex` would be 200 lines of semaphore and
 * cancellation machinery for these twelve, and because a lock is the last thing
 * in this repo that should live behind an unread `node_modules` directory.
 */
export class AsyncMutex {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await fn();
    } finally {
      // Always released, including when `fn` throws: a lock that a failed write
      // can wedge shut would take the whole library down with it.
      release();
    }
  }
}

/** Guards the derived index. One rebuild at a time, in the order asked for. */
const indexLock = new AsyncMutex();

/**
 * Guards read-modify-write of one project's `meta.json`, keyed by project id.
 *
 * Per id rather than global because that is the whole point of the layout: two
 * projects finishing at once must not queue behind each other. The map is
 * reference-counted and entries are dropped when idle — a long-lived studio
 * process handles thousands of ids, and a `Map` that only grows is a leak with
 * a slow fuse.
 */
const metaLocks = new Map<string, { mutex: AsyncMutex; waiters: number }>();

function withMetaLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  let entry = metaLocks.get(id);
  if (!entry) {
    entry = { mutex: new AsyncMutex(), waiters: 0 };
    metaLocks.set(id, entry);
  }
  const held = entry;
  held.waiters += 1;
  return held.mutex.run(fn).finally(() => {
    held.waiters -= 1;
    // Safe to forget only when nobody is queued: dropping it earlier would let
    // the next caller build a second mutex for a lock somebody still holds.
    if (held.waiters === 0 && metaLocks.get(id) === held) metaLocks.delete(id);
  });
}

/* ------------------------------------------------------------------- writes */

/**
 * Write-then-rename, with a temp name unique per write.
 *
 * The old code used one temp path per process (`…json.<pid>.tmp`), which was
 * fine while a single promise chain guaranteed one writer — and produced
 * truncated JSON the moment two module instances shared a pid. `rename` is
 * atomic within a filesystem, so a unique temp name makes a torn file
 * impossible rather than unlikely.
 */
let tmpCounter = 0;

async function writeAtomic(file: string, body: string): Promise<void> {
  const tmp = `${file}.${process.pid}.${(tmpCounter += 1)}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await writeFile(tmp, body);
  try {
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

function metaPathFor(dir: string): string {
  return path.join(dir, META_FILE);
}

/** Parse one `meta.json`, or `undefined` when it is absent or unreadable. */
async function readMetaFile(dir: string): Promise<ProjectMeta | undefined> {
  let raw: string;
  try {
    raw = await readFile(metaPathFor(dir), 'utf8');
  } catch {
    return undefined;
  }
  try {
    const parsed = ProjectMetaSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    // Hand-edited or half-written by an older build. Treated as absent, which
    // degrades to "rebuild this project's record from disk" rather than to an
    // error page — and the next upsert rewrites it.
    return undefined;
  }
}

/** The public projection: the record without the ownership tag. */
function publicRecord(meta: ProjectMeta): ProjectRecord {
  const { version: _version, ownerSession: _ownerSession, ...record } = meta;
  return record;
}

/** Read one project's truth, ownership included. */
export async function readProjectMeta(id: string): Promise<ProjectMeta | undefined> {
  const dir = projectDir(id);
  if (!dir) return undefined;
  return readMetaFile(dir);
}

/**
 * Create or update one project's `meta.json`, then refresh the derived index.
 * Returns the stored record. `createdAt` is preserved; `updatedAt` is stamped on
 * every call.
 *
 * The directory is created if it is missing: a run is registered as `running`
 * before the pipeline has written anything, and that fact needs somewhere to
 * live. The awaited rebuild is what lets a caller treat a resolved
 * `upsertProject` as "this project is in the index now" — the property the
 * concurrency test asserts.
 */
export async function upsertProject(id: string, patch: ProjectPatch): Promise<ProjectRecord> {
  const dir = projectDir(id);
  if (!dir) throw new Error(`"${id}" is not a valid project id, so it has no metadata to write`);

  const meta = await withMetaLock(id, async () => {
    // A project that predates `meta.json` still has an index entry, and its
    // `createdAt`, `status`, `error` and owner would otherwise be reset by the
    // first write after this migration. Reading the cache as a fallback *base*
    // is the migration, and it costs one file read per project, once.
    const previous = (await readMetaFile(dir)) ?? legacyBase(id, await readIndex());
    const merged = mergeMeta(id, previous, patch);
    await mkdir(dir, { recursive: true });
    await writeAtomic(metaPathFor(dir), `${JSON.stringify(merged, null, 2)}\n`);
    return merged;
  });

  await rebuildIndex();
  return publicRecord(meta);
}

/** An index entry, promoted to a metadata base for the migration read above. */
function legacyBase(id: string, indexed: Record<string, ProjectRecord>): ProjectMeta | undefined {
  const record = indexed[id];
  return record ? { version: 1, ...record } : undefined;
}

/** Merge a patch onto whatever was there, field by field, with the reasons. */
function mergeMeta(
  id: string,
  previous: ProjectMeta | undefined,
  patch: ProjectPatch,
): ProjectMeta {
  const now = new Date().toISOString();
  const videoPath = patch.videoPath ?? previous?.videoPath;
  const source = patch.source ?? previous?.source;
  // Sticky like `source`, and for the same reason: what the facts rest on is decided by
  // the run that wrote the lesson, and a later status patch that carries nothing must
  // not erase it.
  const grounding = patch.grounding ?? previous?.grounding;
  const costUsd = finite(patch.costUsd ?? previous?.costUsd);
  const aspect = patch.aspect ?? previous?.aspect;
  // Ownership and publication are sticky: a status update from a background job
  // carries neither field, and must not be able to orphan a project or
  // un-publish a shared one as a side effect of finishing a render.
  const ownerSession = patch.ownerSession ?? previous?.ownerSession;

  return {
    version: 1,
    id,
    title: patch.title ?? previous?.title ?? id,
    status: patch.status ?? previous?.status ?? 'queued',
    createdAt: previous?.createdAt ?? patch.createdAt ?? now,
    updatedAt: now,
    scenes: patch.scenes ?? previous?.scenes ?? 0,
    durationSec: finite(patch.durationSec ?? previous?.durationSec) ?? 0,
    shared: patch.shared ?? previous?.shared ?? false,
    ...(videoPath === undefined ? {} : { videoPath }),
    ...(source === undefined ? {} : { source }),
    ...(grounding === undefined ? {} : { grounding }),
    ...(costUsd === undefined ? {} : { costUsd }),
    ...(aspect === undefined ? {} : { aspect }),
    ...(ownerSession === undefined ? {} : { ownerSession }),
    // `error` is deliberately *not* inherited: a run that reaches 'ready'
    // clears the previous failure instead of carrying it forever.
    ...(patch.error === undefined ? {} : { error: patch.error }),
  };
}

/**
 * Publish or unpublish a project. Returns `undefined` when there is nothing on
 * disk to publish, so a route can answer 404 without a second lookup.
 *
 * Separate from `upsertProject` only so the intent is legible at the call site
 * and in the audit trail; the merge rules are identical.
 */
export async function setProjectShared(
  id: string,
  shared: boolean,
): Promise<ProjectRecord | undefined> {
  if (!projectExists(id)) return undefined;
  return upsertProject(id, { shared });
}

/**
 * Forget a project.
 *
 * The name is historical — there is no longer an entry to delete, because the
 * index is derived. What it now does is drop the truth (`meta.json`, which the
 * caller has usually already removed with the whole directory) and rebuild.
 */
export async function removeProjectFromIndex(id: string): Promise<void> {
  const dir = projectDir(id);
  if (dir) await withMetaLock(id, () => rm(metaPathFor(dir), { force: true }));
  await rebuildIndex();
}

/* ------------------------------------------------------------------ rebuild */

/**
 * A rebuild that has been queued but has not started reading yet.
 *
 * Coalescing is safe *because* of the ordering the mutex guarantees. A writer
 * always finishes its `meta.json` write before calling `rebuildIndex`, so any
 * rebuild that has not yet begun its scan is guaranteed to observe that write,
 * and joining it is as good as queueing a fresh one. The slot is cleared at the
 * top of the critical section, so a write landing after the scan has started
 * schedules a new rebuild instead of joining a stale one — which is what keeps
 * "resolved upsert implies indexed" true under 50 concurrent writers.
 */
let queuedRebuild: Promise<void> | undefined;

export function rebuildIndex(): Promise<void> {
  if (queuedRebuild) return queuedRebuild;
  const task = indexLock.run(async () => {
    queuedRebuild = undefined;
    const truth = await collectTruth();
    const projects: Record<string, ProjectRecord> = {};
    for (const [id, entry] of truth) projects[id] = entry.record;
    await mkdir(PROJECTS_DIR, { recursive: true });
    await writeAtomic(indexPath(), `${JSON.stringify({ version: 1, projects }, null, 2)}\n`);
  });
  // Reached only after `indexLock.run` has parked on its first `await`, so the
  // task cannot have cleared this slot before it is set. See `AsyncMutex`.
  queuedRebuild = task;
  return task;
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
 * project created by `pnpm cast` appear here with no extra bookkeeping.
 * `meta.json` contributes status, error, ownership and sharing, plus the runs
 * that have not written anything yet.
 *
 * ## The unowned-project rule
 *
 * Every project in an existing `projects/` directory, and every project the CLI
 * will ever write, has no owner recorded. Hiding those would empty the library
 * of the only machine that has one, so locally an unowned project belongs to
 * whoever is looking — there is exactly one person there. Hosted, the same
 * reasoning inverts: an unowned project is one this deployment cannot attribute,
 * and showing it to an arbitrary visitor would be the leak. `includeUnowned`
 * therefore defaults to `!isHosted()`, and a caller that means something else
 * has to say so.
 */
export async function listProjects(filter: ProjectFilter = {}): Promise<ProjectDto[]> {
  const truth = await collectTruth();
  const includeUnowned = filter.includeUnowned ?? !isHosted();

  return [...truth.values()]
    .filter(({ ownerSession }) => {
      if (filter.ownerSession === undefined) return true;
      if (ownerSession === undefined) return includeUnowned;
      return ownerSession === filter.ownerSession;
    })
    .map(({ record }) => record)
    .filter((r) => projectExists(r.id) || r.status === 'queued' || r.status === 'running')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(toDto);
}

/**
 * Fold every project's truth into one map: `meta.json` (or, for projects that
 * predate it, the index entry) merged with what disk can observe.
 *
 * This is the function `listProjects` and `rebuildIndex` share, which is the
 * reason the index can never disagree with a listing: they are the same
 * computation, one of them cached.
 */
async function collectTruth(): Promise<Map<string, ProjectTruth>> {
  const indexed = await readIndex();
  const out = new Map<string, ProjectTruth>();

  for (const id of await projectDirNames()) {
    const dir = path.join(PROJECTS_DIR, id);
    const meta = await readMetaFile(dir);
    const base = meta ? publicRecord(meta) : indexed[id];
    const summary = await summarise(id, dir);
    // A directory with neither metadata nor a pipeline footprint is somebody
    // else's folder, not a project we should invent a row for.
    if (!summary && !base) continue;
    const record = summary ? mergeDisk(summary, base) : base!;
    out.set(id, {
      record,
      ...(meta?.ownerSession === undefined ? {} : { ownerSession: meta.ownerSession }),
    });
  }

  // Cached entries whose directory is gone. Kept only while a run claims to be
  // in flight, matching the filter in `listProjects`: anything else is a row for
  // a project a user deleted, and showing it is worse than losing the cache.
  for (const [id, record] of Object.entries(indexed)) {
    if (out.has(id)) continue;
    if (record.status === 'queued' || record.status === 'running') out.set(id, { record });
  }

  return out;
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
  const grounding = summary.grounding ?? previous?.grounding;

  return {
    id: summary.id,
    title: summary.title,
    status,
    createdAt: previous?.createdAt ?? updatedAt,
    updatedAt,
    scenes: summary.scenes,
    durationSec: summary.durationSec,
    // Disk cannot observe publication, so the recorded value is the only value.
    shared: previous?.shared ?? false,
    ...(summary.videoPath ? { videoPath: summary.videoPath } : {}),
    ...(source === undefined ? {} : { source }),
    ...(grounding === undefined ? {} : { grounding }),
    ...(costUsd === undefined ? {} : { costUsd }),
    ...(previous?.aspect === undefined ? {} : { aspect: previous.aspect }),
    // A project with a video on disk is not a failure, whatever the index says.
    ...(previous?.error !== undefined && !summary.videoPath ? { error: previous.error } : {}),
  };
}

export async function getProject(id: string): Promise<ProjectDto | undefined> {
  const truth = await readProjectTruth(id);
  return truth ? toDto(truth.record) : undefined;
}

/**
 * One project's record *and* its owner tag.
 *
 * The only door onto ownership, and the one the session helper's `requireOwner`
 * goes through. Kept separate from `getProject` so that a route cannot acquire
 * the tag by accident and spread it into a response.
 */
export async function readProjectTruth(id: string): Promise<ProjectTruth | undefined> {
  const dir = projectDir(id);
  if (!dir) return undefined;

  const meta = await readMetaFile(dir);
  const base = meta ? publicRecord(meta) : (await readIndex())[id];
  const owner = meta?.ownerSession === undefined ? {} : { ownerSession: meta.ownerSession };

  if (!existsSync(dir)) return base ? { record: base, ...owner } : undefined;

  const summary = await summarise(id, dir);
  if (!summary) return base ? { record: base, ...owner } : undefined;
  return { record: mergeDisk(summary, base), ...owner };
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
  grounding?: z.infer<typeof GroundingSchema>;
};

/** Every subdirectory of `projects/` whose name is an id we would have written. */
async function projectDirNames(): Promise<string[]> {
  try {
    return (await readdir(PROJECTS_DIR, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter(isValidProjectId);
  } catch {
    return [];
  }
}

/**
 * Reuse the pipeline's own project scan rather than re-deriving it here: it
 * already tolerates half-finished directories and knows where the video lives.
 *
 * The `existsSync` guard is not a micro-optimisation. `loadPipeline()` pulls in
 * the whole stage graph, and a rebuild now runs on every write — so a project
 * that has produced nothing but `meta.json` (every queued run, and every one of
 * the 50 in the concurrency test) must cost two stats, not a module graph.
 * Everything below reads `pipeline.json` or `storyboard.json`; if neither is
 * there, there is provably nothing to summarise.
 */
async function summarise(id: string, dir: string): Promise<DiskSummary | undefined> {
  if (
    !existsSync(path.join(dir, 'pipeline.json')) &&
    !existsSync(path.join(dir, 'storyboard.json'))
  ) {
    return undefined;
  }

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
    ...(state?.grounding ? { grounding: state.grounding } : {}),
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
