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
 * `process.env` for any provider the real environment did not already supply, and
 * every route that can precede a render calls it. The two rules that keep this
 * honest — the real environment always wins, and what we injected we can retract —
 * live in `packages/keyvault/src/hydrate.ts`.
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
  hydratedProviders,
  installRedaction,
  probeKey,
  storageInfo,
  PROVIDER_SPECS,
  hydrateEnv as hydrateFromVault,
  type Provider,
  type StorageInfo,
} from '@inkcast/keyvault';

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

type HydrationState = { hydrated: boolean };

/**
 * Pinned to `globalThis` because `next dev` re-evaluates modules on edit, and a
 * fresh module-level `false` would re-run hydration on every hot reload.
 */
const scope = globalThis as typeof globalThis & { __inkcastKeyState?: HydrationState };

function state(): HydrationState {
  return (scope.__inkcastKeyState ??= { hydrated: false });
}

/**
 * Force the next `hydrateEnv()` to do real work.
 *
 * Hydration is memoised because on the vault backend it costs a scrypt derivation,
 * and `GET /api/keys` is polled by an open settings tab. Every mutation calls
 * this, so the memo can never be stale.
 */
export function invalidateVault(): void {
  state().hydrated = false;
}

/** Copy stored keys into `process.env`. Idempotent, and cheap after the first call. */
export async function hydrateEnv(): Promise<void> {
  const s = state();
  if (s.hydrated) return;
  await hydrateFromVault({ interactive: false });
  s.hydrated = true;
}

/* -------------------------------------------------------------------- status */

/**
 * `process.env` with this process's own hydration injections removed.
 *
 * Without this, status is read back through the very variables hydration just
 * wrote, so every stored key reports `source: 'env'` and `shadowedByEnv: true` —
 * telling the user their saved key is being ignored by an environment variable
 * they never set. That is precisely the confusion `shadowedByEnv` exists to
 * prevent, so it must be resolved against the *real* environment.
 *
 * `hydrateEnv()` injects under the canonical name only, which is what makes
 * reversing it exact rather than a guess.
 */
function realEnv(): NodeJS.ProcessEnv {
  const injected = hydratedProviders();
  if (injected.length === 0) return process.env;
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const provider of injected) delete env[PROVIDER_SPECS[provider].envVars[0]!];
  return env;
}

export async function keyStatuses(): Promise<KeyStatus[]> {
  await hydrateEnv();
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
