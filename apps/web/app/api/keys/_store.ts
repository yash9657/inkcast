/**
 * The studio's view of `@inkcast/keyvault`: one vault, shared with the CLI.
 *
 * ## Why this file is thin
 *
 * It used to be a second vault. The studio wrote `<repo>/.inkcast/keys.json` with
 * its own AES-GCM code while the CLI wrote the macOS keychain, so a key set in one
 * was invisible to the other and `/api/keys` reported `configured: false` for a
 * key that plainly existed. Two implementations of one security boundary is one
 * too many — the duplicate is gone and everything below delegates.
 *
 * What remains here is the stateful part that is genuinely the studio's own: the
 * memoised hydration a long-lived server needs, and the provenance a settings page
 * shows. The pure translations — status to wire shape, probe verdict to prose,
 * redaction — live in `_wire.ts`, where they can be tested without a vault.
 *
 * ## How a stored key actually takes effect
 *
 * The stages decide their provider by reading `process.env` (see
 * `packages/pipeline/src/providers.ts`), which is the one mechanism the CLI, the
 * studio and a CI run all share. So the vault does not introduce a second
 * mechanism; it *populates the first one*. `hydrateEnv()` copies stored keys into
 * `process.env` — overriding any value the environment already carried, because
 * the key the user pasted is the one that must run — and every route that can
 * precede a render calls it. The two rules that keep this honest — a stored key
 * wins, and what we injected (or overrode) we can restore — live in
 * `packages/keyvault/src/hydrate.ts`.
 *
 * ## Secrecy
 *
 * `installRedaction()` runs once at module load, which patches `console` so that a
 * key cannot reach a log line even from code that never heard of this package.
 * `effectiveKey()` is the only function here that yields plaintext; exactly one
 * route calls it, and puts the result in an outbound request header.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

import {
  createKeyvault,
  installRedaction,
  probeKey,
  realEnv,
  storageInfo,
  type Provider,
  type StorageInfo,
} from '@inkcast/keyvault';

import { hydrateEnv, invalidateVault } from '@/lib/keys';
import { REPO_ROOT } from '@/lib/store';
import { providerInfo, type ProviderId } from '@/components/settings/catalog';
import {
  describeProbe,
  scrub,
  toWire,
  type KeySource,
  type KeyStatus,
  type ValidationResult,
} from './_wire.js';

export { scrub };
export type { KeySource, KeyStatus, ValidationResult, ValidationStatus } from './_wire.js';

/**
 * Redaction is installed as a side effect of importing this module, not from a
 * route handler. Next may evaluate a handler more than once and in any order, and
 * a key that reaches `console` before the first request would already be printed.
 */
installRedaction();

/**
 * A studio key never comes from a TTY prompt: there is no terminal attached to a
 * request, and a blocked handler would hang the settings page rather than fail it.
 * `interactive: false` makes that explicit at every call.
 */
function vault() {
  return createKeyvault({ interactive: false });
}

/* ------------------------------------------------------------------ hydration */

/**
 * Hydration itself lives in `@/lib/keys`, and these are re-exports so that the
 * settings routes can keep importing it from here.
 *
 * It moved because it was needed somewhere this module has no business being
 * imported: the routes that spend money. `POST /api/generate` must put stored
 * keys in `process.env` before the pipeline reads them, and a render route
 * reaching into `app/api/keys/` for that would be a route depending on another
 * route's private helper. The memo is `globalThis`-pinned in one place, so the
 * settings page and a render still share exactly one hydration.
 */
export { hydrateEnv, invalidateVault };

/* -------------------------------------------------------------------- status */

export async function keyStatuses(): Promise<KeyStatus[]> {
  await hydrateEnv();
  // Provenance is resolved against the *real* environment — `realEnv()` reverses
  // this process's own hydration injections, restoring any value they overrode.
  // Without it, status is read back through the very variables hydration just
  // wrote, and every stored key reports as coming from an environment variable
  // the user never set. The bookkeeping behind it survives `next dev`'s module
  // re-evaluation — see the `globalThis` note in `packages/keyvault/src/hydrate.ts`.
  return (await createKeyvault({ interactive: false, env: realEnv() }).listProviders()).map(toWire);
}

export async function keyStatus(id: ProviderId): Promise<KeyStatus> {
  const found = (await keyStatuses()).find((entry) => entry.id === id);
  if (!found) throw new Error(`no status for provider "${id}"`);
  return found;
}

/* ------------------------------------------------------------------ mutation */

/** Store a key. Returns the masked status — never the key. */
export async function saveKey(id: ProviderId, key: string): Promise<KeyStatus> {
  await vault().setKey(id as Provider, key);
  invalidateVault();
  return keyStatus(id);
}

export type DeleteOutcome = {
  /** False when there was nothing stored for this provider. */
  removed: boolean;
  /**
   * True when the environment still supplies this key, so the stage keeps using
   * it. Deleting a stored entry cannot unset a variable someone put in `.env`.
   */
  stillFromEnv: boolean;
  status: KeyStatus;
};

export async function deleteKey(id: ProviderId): Promise<DeleteOutcome> {
  const removed = await vault().deleteKey(id as Provider);
  invalidateVault();
  // Re-hydrate rather than deleting the variable here: `hydrateEnv()` retracts
  // only what it injected itself, so a key the environment supplies survives and
  // one we injected is dropped — which is exactly the distinction below.
  await hydrateEnv();
  const status = await keyStatus(id);
  return { removed, stillFromEnv: status.source === 'env', status };
}

/**
 * The key a stage would actually use, for validate-now.
 *
 * This is the one function in the module that yields plaintext. It is called by
 * exactly one route, which puts the result in a request header and never in a
 * response.
 */
export async function effectiveKey(
  id: ProviderId,
): Promise<
  { ok: true; key: string; source: KeySource } | { ok: false; reason: 'missing' | 'unreadable' }
> {
  const status = await keyStatus(id);
  const key = await vault().getKey(id as Provider);
  if (key === undefined) {
    return { ok: false, reason: status.unreadable ? 'unreadable' : 'missing' };
  }
  return { ok: true, key, source: status.source };
}

/* ---------------------------------------------------------------- provenance */

export type VaultInfo = StorageInfo & {
  /**
   * A vault written by the studio before it adopted `@inkcast/keyvault`, if one is
   * still lying around. Its keys are not readable from here — different file,
   * different sealing material — so the page has to say so rather than let someone
   * wonder why a key they saved last month has vanished.
   */
  legacyPath: string | null;
};

/** Where keys live on this machine, and what protects them. Reads no secret. */
export function vaultInfo(): VaultInfo {
  const legacy = path.join(REPO_ROOT, '.inkcast', 'keys.json');
  return {
    ...storageInfo(),
    legacyPath: existsSync(legacy) ? path.relative(REPO_ROOT, legacy) : null,
  };
}

/* ------------------------------------------------------------------ validation */

/** Ask the provider whether `key` works, and turn the answer into a sentence. */
export async function validateKey(id: ProviderId, key: string): Promise<ValidationResult> {
  const label = providerInfo(id).label;
  const trimmed = key.trim();
  if (trimmed === '') return { status: 'unknown', message: 'There is no key to check.' };
  return describeProbe(await probeKey(id as Provider, trimmed), label, trimmed);
}
