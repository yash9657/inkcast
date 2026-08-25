/**
 * The typed client for `/api/keys`. The only module in the app that posts a
 * credential.
 *
 * It lives here rather than in `lib/api.ts` on purpose: `lib/api.ts` is imported
 * by every studio screen, and a module that can send a key should be reachable
 * from exactly one of them.
 *
 * Nothing here ever *receives* a key. Every response is masked status, so there
 * is no state in this layer to accidentally render, log or persist. The raw value
 * exists only as a local in the component that owns the paste field, and only
 * until the save resolves.
 */

import { apiRequest } from '@/lib/api';
import type { KeyState } from '@/lib/api';
import type { ProviderId } from './catalog';

export type { KeyState };

/**
 * Where keys are kept on this machine and what protects them. Shown so it can be
 * reasoned about rather than trusted.
 *
 * `backend` is the load-bearing field: on macOS keys go to the OS keychain and
 * there is no Inkcast file at all, so `path`, `cipher` and `kdf` are null and the
 * page must not describe an encrypted file that does not exist.
 */
export type VaultInfo = {
  backend: 'keychain' | 'vault';
  /** True when the backend can actually hold a key right now. */
  ready: boolean;
  /** One sentence: the backend, and what it still needs. */
  why: string;
  /** The vault file. Null on the keychain backend. */
  path: string | null;
  /** The AEAD sealing the vault, or null on the keychain backend. */
  cipher: string | null;
  /** scrypt parameters read from the vault itself, or null on the keychain. */
  kdf: { name: string; N: number; r: number; p: number } | null;
  /** The non-secret sidecar: previews, lengths and validation timestamps. */
  metaPath: string;
  /** A pre-`@inkcast/keyvault` studio vault still on disk, whose keys are stranded. */
  legacyPath: string | null;
};

export type KeysSnapshot = {
  keys: KeyState[];
  vault?: VaultInfo;
};

export type ValidationStatus = 'valid' | 'invalid' | 'unknown';

export type Validation = {
  status: ValidationStatus;
  message: string;
  detail?: string;
  httpStatus?: number;
  /** Which key was checked: the pasted one, the stored one, or the environment's. */
  checked?: 'body' | 'env' | 'vault' | 'keychain';
};

export type SaveOutcome = {
  key: KeyState;
  /** Set when the key saved but does not look like this provider's format. */
  warning?: string;
  note?: string;
};

export type DeleteOutcome = {
  key: KeyState;
  removed: boolean;
  /** The environment still supplies it, so removing the vault entry changed nothing. */
  stillFromEnv: boolean;
  note?: string;
};

/* ------------------------------------------------------------- normalisation */

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

const IDS = ['anthropic', 'elevenlabs', 'replicate', 'fal'] as const;

function parseKey(raw: unknown): KeyState | undefined {
  const rec = asRecord(raw);
  const id = IDS.find((candidate) => candidate === rec.id);
  if (!id) return undefined;
  const mask = str(rec.mask);
  const updatedAt = str(rec.updatedAt);
  const length =
    typeof rec.length === 'number' && Number.isFinite(rec.length) ? rec.length : undefined;
  return {
    id,
    envVar: str(rec.envVar) ?? '',
    configured: rec.configured === true,
    source:
      rec.source === 'env' || rec.source === 'vault' || rec.source === 'keychain'
        ? rec.source
        : 'none',
    ...(mask === undefined ? {} : { mask }),
    ...(length === undefined ? {} : { length }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    ...(rec.unreadable === true ? { unreadable: true as const } : {}),
    ...(rec.locked === true ? { locked: true as const } : {}),
    ...(rec.shadowedByEnv === true ? { shadowedByEnv: true as const } : {}),
    ...(rec.overridesEnv === true ? { overridesEnv: true as const } : {}),
  };
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parseKdf(raw: unknown): VaultInfo['kdf'] {
  const rec = asRecord(raw);
  const name = str(rec.name);
  const N = num(rec.N);
  const r = num(rec.r);
  const p = num(rec.p);
  if (!name || N === undefined || r === undefined || p === undefined) return null;
  return { name, N, r, p };
}

function parseVault(raw: unknown): VaultInfo | undefined {
  const rec = asRecord(raw);
  const backend =
    rec.backend === 'keychain' ? 'keychain' : rec.backend === 'vault' ? 'vault' : undefined;
  if (backend === undefined) return undefined;
  return {
    backend,
    ready: rec.ready !== false,
    why: str(rec.why) ?? '',
    path: str(rec.path) ?? null,
    cipher: str(rec.cipher) ?? null,
    kdf: parseKdf(rec.kdf),
    metaPath: str(rec.metaPath) ?? '',
    legacyPath: str(rec.legacyPath) ?? null,
  };
}

function parseValidation(raw: unknown): Validation {
  const out = asRecord(raw);
  const result = asRecord(out.result);
  const status: ValidationStatus =
    result.status === 'valid' ? 'valid' : result.status === 'invalid' ? 'invalid' : 'unknown';
  const detail = str(result.detail);
  const httpStatus =
    typeof result.httpStatus === 'number' && Number.isFinite(result.httpStatus)
      ? result.httpStatus
      : undefined;
  const checked =
    out.checked === 'body' ||
    out.checked === 'env' ||
    out.checked === 'vault' ||
    out.checked === 'keychain'
      ? out.checked
      : undefined;
  return {
    status,
    message: str(result.message) ?? 'The provider gave no answer.',
    ...(detail === undefined ? {} : { detail }),
    ...(httpStatus === undefined ? {} : { httpStatus }),
    ...(checked === undefined ? {} : { checked }),
  };
}

/* ------------------------------------------------------------------- routes */

export async function listKeys(signal?: AbortSignal): Promise<KeysSnapshot> {
  const out = asRecord(await apiRequest('/api/keys', signal ? { signal } : undefined));
  const keys: KeyState[] = [];
  for (const raw of Array.isArray(out.keys) ? out.keys : []) {
    const parsed = parseKey(raw);
    if (parsed) keys.push(parsed);
  }
  const vault = parseVault(out.vault);
  return { keys, ...(vault === undefined ? {} : { vault }) };
}

export async function saveKey(
  provider: ProviderId,
  key: string,
  signal?: AbortSignal,
): Promise<SaveOutcome> {
  const out = asRecord(
    await apiRequest('/api/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, key }),
      ...(signal ? { signal } : {}),
    }),
  );
  const parsed = parseKey(out.key);
  if (!parsed) throw new Error('The server saved the key but did not describe it.');
  const warning = str(out.warning);
  const note = str(out.note);
  return {
    key: parsed,
    ...(warning === undefined ? {} : { warning }),
    ...(note === undefined ? {} : { note }),
  };
}

export async function deleteKey(
  provider: ProviderId,
  signal?: AbortSignal,
): Promise<DeleteOutcome> {
  const out = asRecord(
    await apiRequest(`/api/keys?provider=${encodeURIComponent(provider)}`, {
      method: 'DELETE',
      ...(signal ? { signal } : {}),
    }),
  );
  const parsed = parseKey(out.key);
  if (!parsed) throw new Error('The server removed the key but did not describe what is left.');
  const note = str(out.note);
  return {
    key: parsed,
    removed: out.removed === true,
    stillFromEnv: out.stillFromEnv === true,
    ...(note === undefined ? {} : { note }),
  };
}

/**
 * Ask the provider whether a key works.
 *
 * With `key`, the pasted value is checked without being saved. Without it, the
 * key the pipeline would actually use is checked — which is the question someone
 * returning to this page a week later is really asking.
 */
export async function validateKey(
  provider: ProviderId,
  key?: string,
  signal?: AbortSignal,
): Promise<Validation> {
  const body: Record<string, unknown> = { provider };
  if (key !== undefined && key.trim() !== '') body.key = key.trim();
  return parseValidation(
    await apiRequest('/api/keys/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    }),
  );
}
