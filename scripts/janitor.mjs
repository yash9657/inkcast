#!/usr/bin/env node
/**
 * The disk janitor — plan item D5's last clause: "delete project dirs older than
 * 48 h unless `shared: true`".
 *
 * ## Why this exists at all
 *
 * A finished film is not small. Measured across the 26 projects in this
 * repository, a completed 1080p project directory is **~33 MB** (`out.mp4`, the
 * per-scene wavs, `thumbnail.png`, the storyboard and lesson JSON), and
 * `projects/` as a whole is 481 MB. The hosted studio allows three generations
 * per address per day with no accounts and no expiry, so disk is the one resource
 * that only ever grows. `/api/health` reports free space precisely because
 * running out of it is how this box dies: ffmpeg fails partway through a mux the
 * user has already waited four minutes for.
 *
 * ## What is deliberately *not* swept, and why each exemption is load-bearing
 *
 * 1. **`shared: true`.** A shared link is a promise. Someone posted it. Sweeping
 *    a shared project turns a URL somebody put in a Slack thread into a 404, and
 *    the flag exists (`apps/web/lib/store.ts:255`) exactly so that publication is
 *    an act rather than an accident. Shared projects are kept regardless of age;
 *    if that ever becomes a disk problem, the fix is an expiry the *sharer* is
 *    told about, not a silent deletion.
 *
 * 2. **Anything touched recently — measured two ways at once.** This is the
 *    subtle one and it is the difference between a janitor and an outage. A
 *    render in flight writes thousands of PNG/JPEG frames and four segment mp4s
 *    into `<project>/frames/` over several minutes, but it does *not* rewrite
 *    `meta.json` while it does so: `updatedAt` only moves at stage boundaries. So
 *    a project can be simultaneously "stale" by `updatedAt` and "actively being
 *    written" on disk. Deleting it mid-render destroys the work and leaves the
 *    job's SSE stream reporting a file that no longer exists.
 *
 *    Hence `ageOf` takes the **most recent** of `updatedAt`, `createdAt` and the
 *    real mtimes of the directory and its children, and a project is swept only
 *    when *all* of them are past the deadline. Erring toward keeping a directory
 *    costs 33 MB until the next sweep; erring the other way costs a user their
 *    film.
 *
 * 3. **A `status: 'running'` project is still swept once it is genuinely cold.**
 *    Tempting to exempt it, but a crashed process leaves `status: 'running'` in
 *    `meta.json` forever, so an unconditional exemption is an unbounded leak
 *    dressed up as caution. Rule 2 already protects a *live* render — a live
 *    render has fresh mtimes — so a "running" project whose every timestamp is
 *    two days old is a crash, not work, and is the single most useless thing on
 *    the disk. It is logged distinctly (`crashed`) so an operator watching the
 *    output can tell a stale crash from ordinary expiry.
 *
 * ## Usage
 *
 *   node scripts/janitor.mjs                # sweep, using INKCAST_PROJECTS
 *   node scripts/janitor.mjs --dry-run      # report what would go, delete nothing
 *   node scripts/janitor.mjs --ttl-hours=72 # override the 48 h default
 *   node scripts/janitor.mjs --json         # one JSON object, for a log pipeline
 *
 * Deleting is the default rather than opt-in on purpose. A janitor that needs a
 * flag to do its job is a janitor somebody wires into a cron without the flag,
 * and then the first anyone hears of it is a full disk; `--dry-run` is there for
 * the human who wants to look first.
 *
 * Plain Node ESM with no imports beyond `node:*`, so it runs from the container
 * (which installs production dependencies only), from a cron line, and from a
 * `docker compose exec` with equal indifference.
 */

import { readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 48 hours, per the plan. Overridable because a busy box may want less. */
const DEFAULT_TTL_HOURS = 48;

/**
 * Files and directories at the top of `projects/` that are not projects.
 *
 * `index.json` is the derived cache described at the head of
 * `apps/web/lib/store.ts` ("a cache, never the source of truth"). It is
 * deliberately left alone: rebuilding it here would mean reimplementing the
 * store's own aggregation in a script that cannot import it, and a stale entry
 * pointing at a swept directory is harmless — `listProjects` scans the
 * directories rather than trusting the index, and the next write rebuilds it.
 */
const NOT_PROJECTS = new Set(['index.json', '.DS_Store', '.gitignore', '.gitkeep']);

/**
 * Where the films live.
 *
 * `INKCAST_PROJECTS` first, matching `PROJECTS_ROOT` in
 * `packages/core/src/project.ts:21` and the container's own environment. The
 * fallback resolves `projects/` against the repository root rather than the
 * current working directory, because a cron line's cwd is not something to bet a
 * recursive delete on.
 */
export function projectsRoot(env = process.env) {
  if (env.INKCAST_PROJECTS) return path.resolve(env.INKCAST_PROJECTS);
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', 'projects');
}

/** Newest of a set of possibly-absent epoch millisecond values. */
function newest(...values) {
  let best = 0;
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value > best) best = value;
  }
  return best;
}

/** An ISO timestamp from `meta.json` as epoch ms, or undefined if unusable. */
function parseStamp(value) {
  if (typeof value !== 'string') return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * The most recent mtime in a project directory, one level deep.
 *
 * One level, not a full recursive walk, and that is a considered trade. A render
 * in flight writes into `<project>/frames/`, so the *directory* `frames` has a
 * fresh mtime the moment a file inside it is created or removed — which is all
 * this needs to know. Walking thousands of frame files to learn the same fact
 * would make the janitor's cost scale with the very thing it is trying to delete.
 */
async function newestMtime(dir) {
  let latest = 0;
  try {
    const info = await stat(dir);
    latest = info.mtimeMs;
  } catch {
    return 0;
  }
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return latest;
  }
  for (const entry of entries) {
    try {
      const info = await stat(path.join(dir, entry.name));
      if (info.mtimeMs > latest) latest = info.mtimeMs;
    } catch {
      /* vanished mid-sweep: a concurrent write, which argues for keeping */
    }
  }
  return latest;
}

/**
 * Read one project's `meta.json`.
 *
 * A missing or unparseable file is **not** treated as "no metadata, therefore
 * safe to delete". It returns `undefined`, and the caller then has only mtimes to
 * go on — which is the right answer for a project that predates `meta.json`
 * (`store.ts` says such projects exist until their next write migrates them) and
 * for one whose meta is being rewritten at this instant.
 */
async function readMeta(dir) {
  try {
    const raw = await readFile(path.join(dir, 'meta.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Classify one project directory against the deadline.
 *
 * Returns the decision *and* the reason, because "the janitor deleted my film"
 * is a question that has to be answerable from a log line.
 */
export async function inspect(dir, deadlineMs, now = Date.now()) {
  const meta = await readMeta(dir);

  // Rule 1: a shared link is a promise. Age is not consulted.
  if (meta?.shared === true) {
    return { keep: true, reason: 'shared' };
  }

  const mtime = await newestMtime(dir);
  const touched = newest(parseStamp(meta?.updatedAt), parseStamp(meta?.createdAt), mtime);

  // A timestamp in the future (a clock step, a bad restore) must never read as
  // "infinitely old". Treat it as just-touched and let the next sweep decide.
  const ageMs = Math.max(0, now - touched);

  if (touched === 0) {
    // Nothing could be read at all: not the meta, not an mtime. Something is
    // wrong with this directory, and a recursive delete is the wrong response to
    // "I cannot tell what this is".
    return { keep: true, reason: 'unreadable', ageMs: 0 };
  }
  if (touched > deadlineMs) {
    return { keep: true, reason: meta?.status === 'running' ? 'in-flight' : 'fresh', ageMs };
  }
  return {
    keep: false,
    reason: meta?.status === 'running' ? 'crashed' : 'expired',
    ageMs,
    title: typeof meta?.title === 'string' ? meta.title : undefined,
  };
}

/** Bytes on disk for a project directory, one level deep — for the log only. */
async function roughSize(dir) {
  let total = 0;
  const walk = async (d, depth) => {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (depth > 0) await walk(full, depth - 1);
        continue;
      }
      try {
        total += (await stat(full)).size;
      } catch {
        /* ignore */
      }
    }
  };
  await walk(dir, 2);
  return total;
}

/**
 * Sweep once.
 *
 * Exported so this can be driven in-process (see the wiring note in
 * docs/DEPLOY.md) as well as from the command line. Never throws for a single
 * bad project: one undeletable directory must not stop the other forty from
 * being reclaimed, so failures are collected and reported.
 */
export async function sweep(options = {}) {
  const root = options.root ?? projectsRoot();
  const ttlHours = options.ttlHours ?? ttlFromEnv();
  const dryRun = options.dryRun ?? false;
  const now = options.now ?? Date.now();
  const log = options.log ?? (() => {});

  const deadlineMs = now - ttlHours * 60 * 60 * 1000;
  const result = {
    root,
    ttlHours,
    dryRun,
    scanned: 0,
    deleted: [],
    kept: { shared: 0, fresh: 0, 'in-flight': 0, unreadable: 0 },
    freedBytes: 0,
    errors: [],
  };

  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (err) {
    // A projects directory that does not exist yet is the normal state of a
    // freshly deployed box, not an error worth a non-zero exit.
    if (err && err.code === 'ENOENT') {
      log(`nothing to sweep: ${root} does not exist yet`);
      return result;
    }
    throw err;
  }

  for (const entry of entries) {
    if (NOT_PROJECTS.has(entry.name)) continue;
    // Directories only, and never through a symlink: `isDirectory()` is false for
    // a symlink in a `withFileTypes` listing, so a link planted in the projects
    // root cannot aim this `rm -rf` somewhere else.
    if (!entry.isDirectory()) continue;

    const dir = path.join(root, entry.name);
    // Second confinement check, mirroring `projectDir()` in the store: resolve
    // and insist the parent really is the root before anything recursive.
    if (path.dirname(path.resolve(dir)) !== root) continue;

    result.scanned += 1;

    let verdict;
    try {
      verdict = await inspect(dir, deadlineMs, now);
    } catch (err) {
      result.errors.push({ id: entry.name, error: String(err) });
      continue;
    }

    if (verdict.keep) {
      result.kept[verdict.reason] = (result.kept[verdict.reason] ?? 0) + 1;
      continue;
    }

    const bytes = await roughSize(dir);
    const days = (verdict.ageMs / (24 * 60 * 60 * 1000)).toFixed(1);
    const mb = (bytes / (1024 * 1024)).toFixed(1);

    if (dryRun) {
      log(`would delete ${entry.name} (${verdict.reason}, ${days}d, ${mb} MB)`);
      result.deleted.push({ id: entry.name, reason: verdict.reason, bytes, ageMs: verdict.ageMs });
      result.freedBytes += bytes;
      continue;
    }

    try {
      await rm(dir, { recursive: true, force: true });
      log(`deleted ${entry.name} (${verdict.reason}, ${days}d, ${mb} MB)`);
      result.deleted.push({ id: entry.name, reason: verdict.reason, bytes, ageMs: verdict.ageMs });
      result.freedBytes += bytes;
    } catch (err) {
      result.errors.push({ id: entry.name, error: String(err) });
    }
  }

  return result;
}

function ttlFromEnv(env = process.env) {
  const raw = env.INKCAST_JANITOR_TTL_HOURS;
  if (raw === undefined || String(raw).trim() === '') return DEFAULT_TTL_HOURS;
  const n = Number(raw);
  // A zero or negative TTL would mean "delete everything, including the film
  // rendering right now". Refuse it and use the default rather than obey it.
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_HOURS;
}

/* ------------------------------------------------------------------- the CLI */

function parseArgs(argv) {
  const opts = { dryRun: false, json: false };
  for (const arg of argv) {
    if (arg === '--dry-run' || arg === '-n') opts.dryRun = true;
    else if (arg === '--json') opts.json = true;
    else if (arg.startsWith('--ttl-hours=')) {
      const n = Number(arg.slice('--ttl-hours='.length));
      if (Number.isFinite(n) && n > 0) opts.ttlHours = n;
    } else if (arg.startsWith('--root=')) opts.root = path.resolve(arg.slice('--root='.length));
    else if (arg === '--help' || arg === '-h') opts.help = true;
  }
  return opts;
}

const USAGE = `inkcast janitor — reclaim project directories

  node scripts/janitor.mjs [--dry-run] [--ttl-hours=48] [--root=<dir>] [--json]

Deletes project directories untouched for longer than the TTL, except any with
"shared": true in meta.json, which are kept indefinitely. Reads INKCAST_PROJECTS
and INKCAST_JANITOR_TTL_HOURS.`;

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  const lines = [];
  const result = await sweep({
    ...opts,
    log: (line) => (opts.json ? lines.push(line) : process.stdout.write(`janitor: ${line}\n`)),
  });

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    const mb = (result.freedBytes / (1024 * 1024)).toFixed(1);
    const kept = Object.entries(result.kept)
      .filter(([, n]) => n > 0)
      .map(([reason, n]) => `${n} ${reason}`)
      .join(', ');
    process.stdout.write(
      `janitor: scanned ${result.scanned}, ` +
        `${result.dryRun ? 'would free' : 'freed'} ${mb} MB from ${result.deleted.length}` +
        `${kept ? `, kept ${kept}` : ''}` +
        `${result.errors.length ? `, ${result.errors.length} failed` : ''}\n`,
    );
  }

  for (const err of result.errors) {
    process.stderr.write(`janitor: could not remove ${err.id}: ${err.error}\n`);
  }
  // A failure to reclaim is worth a non-zero exit so a cron wrapper can alert:
  // the disk is not going to fix itself.
  if (result.errors.length > 0) process.exitCode = 1;
}

// Run only when invoked directly, so `sweep` can be imported by an in-process
// scheduler without the import itself deleting anything.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`janitor: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exitCode = 1;
  });
}
