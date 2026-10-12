/** Local-machine adapter for the CLI-compatible keychain/vault.
 * Account deployments never load this module. No web request hydrates process.env;
 * job credentials are resolved into an isolated scope in lib/keys.ts.
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
  return createKeyvault({ interactive: false, track: false });
}

/* -------------------------------------------------------------------- status */

export async function keyStatuses(): Promise<KeyStatus[]> {
  return (
    await createKeyvault({ interactive: false, track: false, env: realEnv() }).listProviders()
  ).map(toWire);
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
