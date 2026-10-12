/**
 * Per-project working directory + content-addressed cache.
 *
 * Every stage is resumable: it hashes its inputs, and if the artefact on disk
 * was produced by the same hash it skips the work. That is what makes an edit
 * to scene 7 cheap instead of a full regeneration.
 *
 * There are two caches here and the difference matters. The per-project one
 * (`isFresh`/`markFresh`) makes *re-running one video* cheap. The machine-wide one
 * (`cacheDir`) makes the *tenth video* cheaper than the first, because an
 * expensively generated asset is keyed by what it is rather than by which project
 * happened to ask for it first.
 */
import { providerEnv } from './provider-context.js';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { Storyboard } from './storyboard.js';

export const PROJECTS_ROOT = process.env.INKCAST_PROJECTS ?? 'projects';

/* -------------------------------------------------------- machine-wide state */

/**
 * The Inkcast state directory — machine-wide, never inside a project.
 *
 * One definition, because two would be one too many: `@inkcast/keyvault` puts the
 * vault here and this module puts the shared cache here, and a build where those
 * disagreed about `INKCAST_HOME` would scatter state across two roots.
 */
export function stateDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.INKCAST_HOME ? path.resolve(env.INKCAST_HOME) : path.join(homedir(), '.inkcast');
}

/**
 * A path inside the machine-wide cache, e.g. `cacheDir('illustrations')`.
 *
 * Everything under here is *reproducible* — derived from inputs recorded
 * elsewhere — so deleting it costs time and never work. That is the contract that
 * makes it safe to cache across projects: a stale or absent entry degrades to
 * regenerating, never to a wrong drawing, because the key covers the inputs.
 */
export function cacheDir(...parts: string[]): string {
  // Account jobs use an owner-specific cache; CLI/local work retains the machine cache.
  const root = providerEnv().INKCAST_CACHE_DIR ?? path.join(stateDir(), 'cache');
  return path.join(root, ...parts);
}

export type Project = {
  id: string;
  dir: string;
  /** Absolute path for a project-relative path. */
  abs(rel: string): string;
  /** Ensure a subdirectory exists and return its absolute path. */
  sub(rel: string): Promise<string>;
};

/** Short, stable, filesystem-safe id. */
export function projectId(seed?: string): string {
  if (seed) return hash(seed).slice(0, 12);
  // Time-ordered so `ls` sorts chronologically, plus entropy for collisions.
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export async function openProject(id: string = projectId()): Promise<Project> {
  const dir = path.resolve(PROJECTS_ROOT, id);
  await mkdir(dir, { recursive: true });
  return {
    id,
    dir,
    abs: (rel) => path.resolve(dir, rel),
    async sub(rel) {
      const p = path.resolve(dir, rel);
      await mkdir(p, { recursive: true });
      return p;
    },
  };
}

export function hash(...parts: unknown[]): string {
  const h = createHash('sha256');
  for (const p of parts) h.update(typeof p === 'string' ? p : (JSON.stringify(p) ?? ''));
  return h.digest('hex');
}

/* ------------------------------------------------------------------- cache */

type CacheFile = Record<string, string>;

function cachePath(dir: string) {
  return path.resolve(dir, 'cache.json');
}

async function readCache(dir: string): Promise<CacheFile> {
  try {
    return JSON.parse(await readFile(cachePath(dir), 'utf8')) as CacheFile;
  } catch {
    return {};
  }
}

/**
 * True when `key`'s recorded hash matches `inputHash` AND every listed artefact
 * still exists on disk. Artefacts are project-relative paths.
 */
export async function isFresh(
  dir: string,
  key: string,
  inputHash: string,
  artefacts: string[] = [],
): Promise<boolean> {
  const cache = await readCache(dir);
  if (cache[key] !== inputHash) return false;
  return artefacts.every((a) => existsSync(path.resolve(dir, a)));
}

export async function markFresh(dir: string, key: string, inputHash: string): Promise<void> {
  const cache = await readCache(dir);
  cache[key] = inputHash;
  await writeFile(cachePath(dir), JSON.stringify(cache, null, 2));
}

/**
 * Forget one key, for a stage that has just invalidated the artefact under it.
 *
 * The counterpart `isFresh` always needed and nobody had written: it checks that the
 * artefact still *exists*, which cannot notice a file that was overwritten by work the
 * cache entry does not describe. That is audit N-2 exactly — the voice stage abandons a
 * failed attempt after writing its clip, and the scene it wrote over kept a freshness
 * marker for the clip that used to be there. A stage that clobbers a file it is not
 * about to re-key has to say so here.
 */
export async function clearFresh(dir: string, key: string): Promise<void> {
  const cache = await readCache(dir);
  if (!(key in cache)) return;
  delete cache[key];
  await writeFile(cachePath(dir), JSON.stringify(cache, null, 2));
}

/* -------------------------------------------------------------- storyboard */

export async function saveStoryboard(dir: string, sb: Storyboard): Promise<string> {
  const p = path.resolve(dir, 'storyboard.json');
  await writeFile(p, JSON.stringify(sb, null, 2));
  return p;
}

export async function loadStoryboard(dir: string): Promise<Storyboard> {
  const raw = await readFile(path.resolve(dir, 'storyboard.json'), 'utf8');
  const { parseStoryboard } = await import('./storyboard.js');
  return parseStoryboard(JSON.parse(raw));
}
