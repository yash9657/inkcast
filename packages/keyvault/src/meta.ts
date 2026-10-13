/**
 * The non-secret sidecar: when each key was last validated, and its masked
 * preview when the backend cannot cheaply produce one.
 *
 * This exists so `listProviders()` is backend-agnostic. The keychain has nowhere
 * to hang "last validated Tuesday" that we can read without pulling the secret
 * out, and the vault should not need a passphrase to answer it. Keeping the
 * timestamps in one plain file solves both — and by construction the file holds
 * no key material, so 0600 here is hygiene rather than the security boundary.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { chmodSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { logger } from '@inkcast/core';
import { ensurePrivateDir } from './paths.js';
import { PROVIDERS, type Provider } from './providers.js';

const log = logger('keyvault:meta');

export type ProviderMeta = {
  /** ISO timestamp of the last definitive validation result. */
  lastValidated?: string;
  /** Whether that result was a pass. */
  lastValidatedOk?: boolean;
  /** Masked preview, recorded on write so a listing need not read the secret. */
  masked?: string;
  /**
   * Character count of the stored key, recorded on write.
   *
   * A length is not key material, and having it here is what lets a status
   * listing say "97 characters" without opening the keychain. That number is the
   * cheapest way for a user to spot the single most common failure — a paste that
   * dropped the tail — because a truncated key masks identically to a whole one.
   */
  length?: number;
  /** ISO timestamp of the last set/rotate through this package. */
  updatedAt?: string;
};

type MetaFile = { version: 1; providers: Partial<Record<Provider, ProviderMeta>> };

const EMPTY: MetaFile = { version: 1, providers: {} };

/**
 * Read the sidecar. Never throws: this is convenience data, and a corrupt or
 * unreadable sidecar must not stop a key from being used.
 */
export function readMeta(file: string): MetaFile {
  if (!existsSync(file)) return { ...EMPTY, providers: {} };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<MetaFile>;
    if (parsed?.version !== 1 || typeof parsed.providers !== 'object' || !parsed.providers) {
      log.debug(`ignoring ${file}: unrecognised shape`);
      return { ...EMPTY, providers: {} };
    }
    const providers: Partial<Record<Provider, ProviderMeta>> = {};
    for (const p of PROVIDERS) {
      const entry = parsed.providers[p];
      if (entry && typeof entry === 'object') providers[p] = entry;
    }
    return { version: 1, providers };
  } catch (err) {
    log.debug(`ignoring unreadable ${file}`, err as Error);
    return { ...EMPTY, providers: {} };
  }
}

/** Merge `patch` into the record for `provider`. Best effort, never throws. */
export function writeMeta(file: string, provider: Provider, patch: ProviderMeta): void {
  try {
    const current = readMeta(file);
    current.providers[provider] = { ...current.providers[provider], ...patch };
    ensurePrivateDir(path.dirname(file));
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
    try {
      writeFileSync(tmp, `${JSON.stringify(current, null, 2)}\n`, { mode: 0o600 });
      chmodSync(tmp, 0o600);
      renameSync(tmp, file);
    } catch (err) {
      if (existsSync(tmp)) unlinkSync(tmp);
      throw err;
    }
  } catch (err) {
    log.debug(`could not update ${file}`, err as Error);
  }
}

/** Drop a provider's record, e.g. after `deleteKey`. */
export function clearMeta(file: string, provider: Provider): void {
  try {
    if (!existsSync(file)) return;
    const current = readMeta(file);
    if (!current.providers[provider]) return;
    delete current.providers[provider];
    writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);
  } catch (err) {
    log.debug(`could not clear ${provider} from ${file}`, err as Error);
  }
}

/** Metadata for one provider, or an empty record. */
export function metaFor(file: string, provider: Provider): ProviderMeta {
  return readMeta(file).providers[provider] ?? {};
}

/** True when the sidecar exists and is owner-only. Used by the tests. */
export function metaIsPrivate(file: string): boolean {
  if (!existsSync(file)) return true;
  return (statSync(file).mode & 0o077) === 0;
}
