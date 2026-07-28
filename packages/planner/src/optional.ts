/**
 * Lazy loader for dependencies that are only needed on some paths.
 *
 * PDF/docx/URL ingest and the Anthropic adapter each pull in a chunk of the
 * dependency tree that the default (raw text / markdown, no API key) path never
 * touches. Loading them through a *dynamic* specifier keeps them out of the
 * static import graph, so a workspace missing them still type-checks and still
 * runs everything else — the contract's "degrade with a clear warning, never
 * crash" rule applied to build-time as much as run-time.
 */
import { logger } from '@inkcast/core';

const log = logger('planner');

const cache = new Map<string, unknown>();

/** Indirection so TypeScript cannot resolve the specifier and demand types. */
const dynamicImport = (specifier: string): Promise<unknown> =>
  import(/* webpackIgnore: true */ specifier);

/**
 * Import an optional module. Returns `undefined` (after one clear warning)
 * when the package is not installed, instead of throwing.
 */
export async function optionalImport<T>(specifier: string, why: string): Promise<T | undefined> {
  if (cache.has(specifier)) return cache.get(specifier) as T | undefined;
  try {
    const mod = (await dynamicImport(specifier)) as T;
    cache.set(specifier, mod);
    return mod;
  } catch (err) {
    log.warn(`optional dependency "${specifier}" is unavailable — ${why}`, err as Error);
    cache.set(specifier, undefined);
    return undefined;
  }
}

/** Interop for CJS packages loaded through `optionalImport`. */
export function cjsDefault<T>(mod: unknown): T {
  const m = mod as { default?: unknown };
  if (m && typeof m === 'object' && 'default' in m && m.default !== undefined) {
    return m.default as T;
  }
  return mod as T;
}
