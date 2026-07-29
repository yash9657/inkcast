/**
 * Lazy loader for dependencies that are only needed on some paths.
 *
 * PDF/docx/URL ingest and the Anthropic adapter each pull in a chunk of the
 * dependency tree that the default (raw text / markdown, no API key) path never
 * touches. Loading them lazily keeps them off the fast path and keeps a
 * workspace that is missing one of them able to run everything else — the
 * contract's "degrade with a clear warning, never crash" rule applied to
 * build-time as much as run-time.
 *
 * ## Why the specifiers are literal, in a table
 *
 * They used to be one `import(specifier)` over a variable, with
 * `webpackIgnore: true` so a bundler would leave it alone. That is wrong here,
 * and silently so. The studio runs these stages in-process, and Next bundles its
 * server code: an ignored import survives into `.next/server/chunks/`, where a
 * bare specifier resolves against *that* directory. pnpm's isolated layout links
 * these packages under `packages/planner/node_modules`, which is not on that
 * path — verified: every one of them fails with `ERR_MODULE_NOT_FOUND` from the
 * built bundle. The result was PDF, docx and URL ingest quietly unavailable in
 * the studio, and worse, `anthropicAvailable()` reporting no adapter even with a
 * key set, so the LLM planner — the product, per `docs/LESSON-ENGINE.md` — could
 * never run there at all.
 *
 * A literal specifier inside a thunk fixes it: the bundler can see the edge and
 * include the package, Node resolves it from this file's own location, and the
 * import stays lazy because the thunk is only called on demand. Same reasoning,
 * same shape as `PACKAGES` in `packages/pipeline/src/stages.ts`.
 *
 * Adding an optional dependency means adding it here as well as to
 * `package.json`; `optionalImport` says so loudly rather than guessing.
 */
/// <reference path="./vendor.d.ts" />
// The reference is load-bearing, not decorative: `turndown` ships no types, and
// the literal `import()` below now makes every program that compiles this file
// resolve it — including the studio's `next build`, which type-checks the whole
// imported graph against `apps/web/tsconfig.json` and so never sees this
// package's own `include`. Referencing the declaration from the file that needs
// it is what makes it travel.
import { logger } from '@inkcast/core';

const log = logger('planner');

/**
 * Every optional package, behind a literal `import()`.
 *
 * Typed as `unknown` on purpose: the callers know the shape they need and cast
 * to it, and this table's job is resolution, not typing. That also keeps `tsc`
 * from needing type declarations for a package that is legitimately absent.
 */
const OPTIONAL: Record<string, () => Promise<unknown>> = {
  '@anthropic-ai/sdk': () => import('@anthropic-ai/sdk'),
  cheerio: () => import('cheerio'),
  mammoth: () => import('mammoth'),
  turndown: () => import('turndown'),
  unpdf: () => import('unpdf'),
  'zod-to-json-schema': () => import('zod-to-json-schema'),
};

const cache = new Map<string, unknown>();

/**
 * Import an optional module. Returns `undefined` (after one clear warning)
 * when the package is not installed, instead of throwing.
 */
export async function optionalImport<T>(specifier: string, why: string): Promise<T | undefined> {
  if (cache.has(specifier)) return cache.get(specifier) as T | undefined;
  const load = OPTIONAL[specifier];
  if (!load) {
    // A programming error, not a missing install: fail the same way (returning
    // undefined keeps the caller's degraded path working) but say which fix.
    log.warn(`"${specifier}" is not registered in optional.ts, so it can never be loaded — ${why}`);
    cache.set(specifier, undefined);
    return undefined;
  }
  try {
    const mod = (await load()) as T;
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
