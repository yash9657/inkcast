/**
 * The server-side facade over the vault: where it lives, what is configured, and
 * how a saved key reaches the pipeline.
 *
 * ## How a vault key actually takes effect
 *
 * The stages decide their provider by reading `process.env` (see
 * `packages/pipeline/src/providers.ts`), which is deliberate — it is the one
 * mechanism the CLI, the studio and a CI run all share. So the vault does not
 * introduce a second mechanism; it *populates the first one*. `hydrateEnv()`
 * copies saved keys into `process.env` for any provider the real environment did
 * not already supply, and every route that can precede a render calls it.
 *
 * Two rules keep that honest:
 *
 *  - **The real environment always wins.** A key in `.env` or the shell is
 *    authoritative; the vault never overwrites one. Otherwise a value you can see
 *    in a file would be silently shadowed by one you cannot.
 *  - **What we injected, we can retract.** Deleting a key removes it from
 *    `process.env` too, so it stops applying immediately rather than at the next
 *    restart. Variables that arrived from the environment are never touched.
 *
 * The pristine snapshot is taken once per process and pinned to `globalThis`,
 * because `next dev` re-evaluates modules on edit and a second snapshot would
 * observe our own injections and report them as environment-provided.
 *
 * ## Handoff: replacing this with `@inkcast/keyvault`
 *
 * `packages/keyvault` landed while this was being written and is the better home
 * for all of it — it adds an OS-keychain backend and process-wide redaction. The
 * studio cannot import it yet: `@inkcast/keyvault` is not in
 * `apps/web/package.json` and not in `transpilePackages` in `next.config.ts`, and
 * neither file is this agent's to edit. So the local `store.ts` stays for now, and
 * this module is shaped to make the swap mechanical rather than a rewrite:
 *
 *  - `keyStatuses()` returns the fields of that package's `ProviderStatus`
 *    (`configured`, `masked`→`mask`, `source`), and `KeySource` already includes
 *    `'keychain'` so no client or component changes when a real keychain appears.
 *  - `maskSecret()` in the catalog is that package's `mask()`, algorithm for
 *    algorithm, so previews written before the swap render identically after it.
 *  - `judgeKeyShape()` refuses exactly what its `normaliseKey()` refuses.
 *  - Env-var precedence per provider matches its `envKey()`, `FAL_API_KEY` fallback
 *    included.
 *
 * The swap is then: add the dependency and the `transpilePackages` entry, and
 * replace the four bodies below with `listProviders`, `setKey`, `deleteKey`,
 * `getKey` and `hydrateEnv` from `@inkcast/keyvault`. Nothing above this layer
 * moves. `installRedaction()` should also be called once at process start.
 */

import path from 'node:path';

import { REPO_ROOT } from '@/lib/store';
import {
  PROVIDERS,
  maskSecret,
  providerInfo,
  type ProviderId,
} from '@/components/settings/catalog';
import { openVault, type Kdf, type Vault } from './store.js';

/** Where the vault lives, honouring an override for anyone running several checkouts. */
export function vaultDir(): string {
  const override = process.env.INKCAST_VAULT_DIR;
  if (override !== undefined && override.trim() !== '') return path.resolve(override);
  // `.inkcast/` is already git-ignored at the repo root, so a saved key cannot be
  // committed by accident.
  return path.join(REPO_ROOT, '.inkcast');
}

function vault(): Vault {
  return openVault(vaultDir());
}

/**
 * The first environment variable set for a provider, in the catalog's precedence
 * order. Whitespace-only counts as unset — an exported-but-empty variable is the
 * classic way to accidentally shadow a stored key, and every other provider check
 * in the repo treats it as absent.
 */
function envValue(id: ProviderId): { name: string; value: string } | undefined {
  for (const name of providerInfo(id).envVars) {
    const raw = process.env[name];
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    if (value !== '') return { name, value };
  }
  return undefined;
}

/* --------------------------------------------------------------- process state */

type VaultState = {
  /** Providers whose env var was set before we touched anything. */
  pristine: Set<ProviderId>;
  /** Providers whose env var this process populated from the vault. */
  injected: Set<ProviderId>;
  /** Providers with a stored entry that can no longer be unsealed. */
  unreadable: Set<ProviderId>;
  hydrated: boolean;
};

const scope = globalThis as typeof globalThis & { __inkcastVaultState?: VaultState };

function state(): VaultState {
  return (scope.__inkcastVaultState ??= {
    pristine: new Set(PROVIDERS.filter((p) => envValue(p.id) !== undefined).map((p) => p.id)),
    injected: new Set<ProviderId>(),
    unreadable: new Set<ProviderId>(),
    hydrated: false,
  });
}

/**
 * Force the next `hydrateEnv()` to do real work.
 *
 * Hydration is memoised because unsealing costs a scrypt derivation per key when
 * a passphrase is in use, and `GET /api/keys` is polled by an open settings tab.
 * Every mutation calls this, so the memo can never be stale.
 */
export function invalidateVault(): void {
  state().hydrated = false;
}

/* ------------------------------------------------------------------ hydration */

/**
 * Copy saved keys into `process.env`, and retract ones that are no longer saved.
 * Idempotent, and cheap after the first call.
 */
export async function hydrateEnv(): Promise<void> {
  const s = state();
  if (s.hydrated) return;
  const v = vault();

  for (const provider of PROVIDERS) {
    if (s.pristine.has(provider.id)) {
      // Provided by the real environment. Not ours to manage.
      s.unreadable.delete(provider.id);
      continue;
    }
    const result = await v.read(provider.id);
    if (result.ok) {
      process.env[provider.envVar] = result.key;
      s.injected.add(provider.id);
      s.unreadable.delete(provider.id);
      continue;
    }
    if (s.injected.has(provider.id)) {
      delete process.env[provider.envVar];
      s.injected.delete(provider.id);
    }
    if (result.reason === 'unreadable') s.unreadable.add(provider.id);
    else s.unreadable.delete(provider.id);
  }

  s.hydrated = true;
}

/* -------------------------------------------------------------------- status */

/**
 * Where a configured key came from. `none` means the stage runs locally.
 *
 * `keychain` is declared but not yet produced: it is what `@inkcast/keyvault`
 * reports on macOS, and including it now means the client, the types in
 * `lib/api.ts` and the UI already handle that case on the day this module
 * delegates to that package. See the handoff note at the top of the file.
 */
export type KeySource = 'env' | 'vault' | 'keychain' | 'none';

/** Everything the browser is allowed to know about a key. No plaintext, ever. */
export type KeyStatus = {
  id: ProviderId;
  envVar: string;
  configured: boolean;
  source: KeySource;
  /** `sk-ant…9f2a`. Absent when nothing is configured. */
  mask?: string;
  /** Character count, so a truncated paste is visible. */
  length?: number;
  /** When it was saved. Only ever set for a vault key. */
  updatedAt?: string;
  /**
   * A stored entry exists but cannot be unsealed — `INKCAST_VAULT_SECRET` or
   * `vault.key` changed since it was saved. The remedy is to paste it again.
   */
  unreadable?: boolean;
  /**
   * A key is saved in the vault *and* set in the environment. The environment
   * wins, so the saved one is inert — worth saying out loud, because otherwise
   * editing the vault entry appears to do nothing.
   */
  shadowedByEnv?: boolean;
};

export async function keyStatuses(): Promise<KeyStatus[]> {
  await hydrateEnv();
  const s = state();
  const stored = new Map((await vault().list()).map((entry) => [entry.id, entry]));

  return PROVIDERS.map((provider) => {
    const fromEnv = s.pristine.has(provider.id);
    const entry = stored.get(provider.id);

    if (fromEnv) {
      const found = envValue(provider.id);
      const raw = found?.value ?? '';
      return {
        id: provider.id,
        // The variable that actually supplied it, which for `fal` may be the
        // legacy `FAL_API_KEY` rather than the canonical name.
        envVar: found?.name ?? provider.envVar,
        configured: true,
        source: 'env' as const,
        mask: maskSecret(raw),
        length: raw.length,
        ...(entry ? { shadowedByEnv: true } : {}),
      };
    }

    if (entry && s.injected.has(provider.id)) {
      return {
        id: provider.id,
        envVar: provider.envVar,
        configured: true,
        source: 'vault' as const,
        mask: entry.mask,
        length: entry.length,
        updatedAt: entry.updatedAt,
      };
    }

    if (entry) {
      // Stored but unusable. Reported as not configured, because that is what the
      // pipeline will experience, with the reason attached so the fix is obvious.
      return {
        id: provider.id,
        envVar: provider.envVar,
        configured: false,
        source: 'none' as const,
        mask: entry.mask,
        updatedAt: entry.updatedAt,
        unreadable: true,
      };
    }

    return {
      id: provider.id,
      envVar: provider.envVar,
      configured: false,
      source: 'none' as const,
    };
  });
}

export async function keyStatus(id: ProviderId): Promise<KeyStatus> {
  const all = await keyStatuses();
  const found = all.find((entry) => entry.id === id);
  if (!found) throw new Error(`no status for provider "${id}"`);
  return found;
}

/* ------------------------------------------------------------------ mutation */

/** Save a key. Returns the masked status — never the key. */
export async function saveKey(id: ProviderId, key: string): Promise<KeyStatus> {
  await vault().write(id, key);
  invalidateVault();
  return keyStatus(id);
}

export type DeleteOutcome = {
  /** False when there was nothing saved for this provider. */
  removed: boolean;
  /**
   * True when the environment still supplies this key, so the stage keeps using
   * it. Deleting a vault entry cannot unset a variable someone put in `.env`.
   */
  stillFromEnv: boolean;
  status: KeyStatus;
};

export async function deleteKey(id: ProviderId): Promise<DeleteOutcome> {
  const removed = await vault().remove(id);
  const s = state();
  // Retract our own injection immediately, so the next render sees the change
  // without waiting for a hydration pass.
  if (!s.pristine.has(id) && s.injected.has(id)) {
    delete process.env[providerInfo(id).envVar];
    s.injected.delete(id);
  }
  invalidateVault();
  return { removed, stillFromEnv: s.pristine.has(id), status: await keyStatus(id) };
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
  await hydrateEnv();
  const s = state();
  const info = providerInfo(id);
  if (s.pristine.has(id)) {
    const found = envValue(id);
    return found === undefined
      ? { ok: false, reason: 'missing' }
      : { ok: true, key: found.value, source: 'env' };
  }
  const result = await vault().read(id);
  if (result.ok) return { ok: true, key: result.key, source: 'vault' };
  return { ok: false, reason: result.reason };
}

/* ---------------------------------------------------------------- provenance */

export type VaultInfo = {
  /** Repo-relative when it sits inside the checkout, absolute otherwise. */
  path: string;
  kdf: Kdf;
  cipher: 'aes-256-gcm';
};

export async function vaultInfo(): Promise<VaultInfo> {
  const v = vault();
  const rel = path.relative(REPO_ROOT, v.file);
  return {
    path: rel.startsWith('..') || path.isAbsolute(rel) ? v.file : rel,
    kdf: await v.kdf(),
    cipher: 'aes-256-gcm',
  };
}
