/**
 * Stored keys, made effective for the studio's server process.
 *
 * ## Why this is in `lib/` and not next to the settings route
 *
 * It used to live in `app/api/keys/_store.ts`, which made it reachable only from
 * the code that is *about* keys — the settings page and `/api/providers`. That
 * placement was the bug: every stage adapter decides its provider by reading
 * `process.env` (`packages/pipeline/src/providers.ts`), a stored key only takes
 * effect once `hydrateEnv()` has copied it there, and the routes that actually
 * spend money — `POST /api/generate`, `POST /api/projects/<id>/rerender`,
 * `POST /api/projects/<id>/edit` — never called it. Keys reached the pipeline
 * only because a settings-page or studio-status fetch happened to hydrate as a
 * side effect first.
 *
 * On a warm dev server that is invisible. On a freshly restarted `next dev`
 * process it is the whole difference between a film narrated by ElevenLabs and
 * one narrated by Kokoro, between a lesson authored by Claude and one authored
 * by the heuristic, and between a figure lane that runs and one that does not —
 * silently, every time, with the keys sitting perfectly readable in the vault.
 *
 * So hydration is a `lib/` concern now: the money paths import it directly, and
 * `app/api/keys/_store.ts` delegates here so there is still exactly one memo.
 *
 * ## The memo, and why it is on `globalThis`
 *
 * Hydration costs a scrypt derivation on the vault backend and `GET /api/keys`
 * is polled by an open settings tab, so the result is memoised. `next dev`
 * re-evaluates modules on edit, and a fresh module-level `false` would re-run
 * hydration on every hot reload — hence `globalThis`. Every mutation calls
 * `invalidateVault()`, so the memo can never be stale.
 *
 * ## Never throws
 *
 * A locked vault, a missing passphrase or an unreadable entry must degrade to
 * "that stage runs locally", exactly as having no key at all does — the same
 * rule the CLI's `hydrateKeys()` obeys. A render must not fail because the
 * keychain was busy.
 */

import { hydrateEnv as hydrateFromVault, installRedaction } from '@inkcast/keyvault';
import type { KeyvaultOptions } from '@inkcast/keyvault';

import type { JobRunner } from './jobs';

type HydrationState = { hydrated: boolean };

const scope = globalThis as typeof globalThis & { __inkcastKeyState?: HydrationState };

function state(): HydrationState {
  return (scope.__inkcastKeyState ??= { hydrated: false });
}

/**
 * Force the next `hydrateEnv()` to do real work.
 *
 * Called by every vault mutation. A job runner that starts minutes after a key
 * was saved re-reads storage because of this.
 */
export function invalidateVault(): void {
  state().hydrated = false;
}

/**
 * Copy stored keys into `process.env`. Idempotent, and cheap after the first call.
 *
 * `opts` exists for tests, which pin a sandbox vault and hydrate into their own
 * `target` object; production passes nothing. Passing `opts` also bypasses the
 * memo, because a test that pins a different vault must not be answered from a
 * previous test's cached "already done".
 */
export async function hydrateEnv(
  opts?: KeyvaultOptions & { target?: NodeJS.ProcessEnv },
): Promise<void> {
  // Installed here rather than at module load so importing this file has no side
  // effect, but still before a single key is read — the point of the patch is
  // that a key cannot reach a log line, and hydration is where keys start moving.
  installRedaction();

  if (opts) {
    await run({ interactive: false, ...opts });
    return;
  }
  const s = state();
  if (s.hydrated) return;
  await run({ interactive: false });
  // Only a successful pass may be memoised. A vault that was locked at 10:00 and
  // unlocked at 10:05 has to be readable by the 10:05 render, and memoising the
  // failure would pin the whole process to the degraded answer.
  s.hydrated = true;
}

async function run(opts: KeyvaultOptions & { target?: NodeJS.ProcessEnv }): Promise<void> {
  try {
    await hydrateFromVault(opts);
  } catch {
    /* Degrade to local stages; see the header. */
  }
}

/**
 * Wrap a background job so that stored keys are in the environment before it runs.
 *
 * The wrap is what makes this correct rather than merely likely. A job can sit in
 * the render queue for minutes, and hydration at *request* time answers the
 * question "what keys existed when the button was pressed" — which is the wrong
 * question when the user pasted a key into settings while their film was waiting.
 * The route hydrates too (so the run is already keyed by the time the 202 is
 * written), but this is the call that decides what the stages see.
 */
export function withKeys(run: JobRunner): JobRunner {
  return async (onProgress, ctx) => {
    await hydrateEnv();
    return run(onProgress, ctx);
  };
}
