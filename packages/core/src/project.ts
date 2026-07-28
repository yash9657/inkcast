/**
 * Per-project working directory + content-addressed cache.
 *
 * Every stage is resumable: it hashes its inputs, and if the artefact on disk
 * was produced by the same hash it skips the work. That is what makes an edit
 * to scene 7 cheap instead of a full regeneration.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Storyboard } from './storyboard.js';

export const PROJECTS_ROOT = process.env.INKCAST_PROJECTS ?? 'projects';

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
