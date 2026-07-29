/**
 * The store: precedence, backend selection, and the public verbs.
 *
 * ## Precedence
 *
 * `getKey()` reads `process.env` first, then storage. That order is deliberate
 * and it is the one power users and CI both depend on: an exported
 * `ANTHROPIC_API_KEY` must win, so a runner can inject a key with no vault and no
 * passphrase, and a developer can shadow a stored key for one command without
 * mutating storage. `listProviders()` reports which one would win, so the
 * shadowing is never invisible.
 *
 * ## Backend
 *
 * darwin prefers the OS keychain, because then no Inkcast file ever contains a
 * secret. Everywhere else — and on darwin with `INKCAST_KEYVAULT_BACKEND=vault` —
 * the encrypted vault is used. Selection happens once per instance so a status
 * listing and a read cannot disagree about where a key lives.
 *
 * ## Lifetime
 *
 * A key exists in this process only for the duration of the call that asked for
 * it. Nothing caches plaintext: `getKey()` returns a string and keeps no
 * reference, `listProviders()` works from masked previews, and `validateKey()`
 * drops the key when the request settles. The two deliberate exceptions are
 * documented where they live — the scrypt-derived key cache in `vault.ts` and the
 * tracked-value table in `redact.ts`, both cleared by `lock()`.
 */
import { logger } from '@inkcast/core';
import { KeyvaultError } from './errors.js';
import * as keychain from './keychain.js';
import { mask } from './mask.js';
import { clearMeta, metaFor, writeMeta } from './meta.js';
import { metaPath as defaultMetaPath, vaultPath as defaultVaultPath } from './paths.js';
import { passphraseAvailable, resolvePassphrase } from './passphrase.js';
import { assertProvider, envKey, PROVIDERS, type Provider } from './providers.js';
import { forgetSecrets, trackSecret } from './redact.js';
import { probeKey, type ValidationResult } from './validate.js';
import { lockVault, vaultDelete, vaultExists, vaultGet, vaultList, vaultSet } from './vault.js';

const log = logger('keyvault');

/** Where a key came from. */
export type KeySource = 'env' | 'keychain' | 'vault';

/** Which storage backend an instance is bound to. */
export type Backend = 'keychain' | 'vault';

export type ProviderStatus = {
  provider: Provider;
  /** True when `getKey()` would return something. */
  configured: boolean;
  /** Display-safe preview, or null when not configured. Never a raw key. */
  masked: string | null;
  /** ISO timestamp of the last definitive `validateKey()`, or null. */
  lastValidated: string | null;
  /** Where the key would come from, or null when not configured. */
  source: KeySource | null;
};

export type KeyvaultOptions = {
  /** Force a backend. Default: keychain on darwin, vault elsewhere. */
  backend?: Backend | 'auto';
  /** Vault passphrase, when the vault backend is in use. */
  passphrase?: string;
  /** Override the vault file path. */
  vaultPath?: string;
  /** Override the metadata sidecar path. */
  metaPath?: string;
  /** Override the keychain service name. Tests use this to stay isolated. */
  keychainService?: string;
  /** Environment to read for precedence and configuration. */
  env?: NodeJS.ProcessEnv;
  /** Allow a TTY passphrase prompt. Default false — library calls must not block. */
  interactive?: boolean;
  /**
   * Register every key handled with `redact()` so it can never be printed.
   * Default true. See the tracked-value note in `redact.ts`.
   */
  track?: boolean;
};

export type Keyvault = {
  readonly backend: Backend;
  setKey(provider: Provider | string, key: string): Promise<void>;
  getKey(provider: Provider | string): Promise<string | undefined>;
  listProviders(): Promise<ProviderStatus[]>;
  deleteKey(provider: Provider | string): Promise<boolean>;
  validateKey(provider: Provider | string): Promise<ValidationResult>;
  /** Drop cached derived keys and tracked values. */
  lock(): void;
};

/* ---------------------------------------------------------------- validation */

/**
 * A key must be non-empty and free of control characters.
 *
 * The control-character rule is not cosmetic: the keychain backend hands the
 * secret to `security` over a line-oriented prompt, so an embedded newline would
 * silently truncate the stored value. Rejecting it here means both backends
 * accept exactly the same inputs.
 */
function normaliseKey(raw: string): string {
  if (typeof raw !== 'string') throw new KeyvaultError('invalid-key', 'the key must be a string');
  const key = raw.trim();
  if (key.length === 0) {
    throw new KeyvaultError('invalid-key', 'the key is empty');
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(key)) {
    throw new KeyvaultError('invalid-key', 'the key contains control characters', {
      hint: 'This usually means a newline was pasted along with the key. Copy just the key text.',
    });
  }
  return key;
}

function chooseBackend(opts: KeyvaultOptions, env: NodeJS.ProcessEnv): Backend {
  const want =
    opts.backend ?? (env.INKCAST_KEYVAULT_BACKEND as Backend | 'auto' | undefined) ?? 'auto';
  if (want === 'keychain') {
    if (!keychain.keychainAvailable()) {
      throw new KeyvaultError(
        'no-backend',
        'the OS keychain was requested but is only available on macOS',
        { hint: 'Unset INKCAST_KEYVAULT_BACKEND to use the encrypted vault file instead.' },
      );
    }
    return 'keychain';
  }
  if (want === 'vault') return 'vault';
  return keychain.keychainAvailable() ? 'keychain' : 'vault';
}

/* -------------------------------------------------------------------- factory */

/**
 * Build a keyvault bound to a backend, paths and environment.
 *
 * Every exported convenience function delegates here with a fresh instance, so
 * there is no module-level mutable state holding a passphrase or a path.
 */
export function createKeyvault(opts: KeyvaultOptions = {}): Keyvault {
  const env = opts.env ?? process.env;
  const backend = chooseBackend(opts, env);
  const vaultFile = opts.vaultPath ?? defaultVaultPath(env);
  const metaFile = opts.metaPath ?? defaultMetaPath(env);
  const service = opts.keychainService ?? keychain.keychainService(env);
  const track = opts.track ?? true;

  const remember = (key: string | undefined) => {
    if (key && track) trackSecret(key);
    return key;
  };

  const passphrase = () =>
    resolvePassphrase({
      passphrase: opts.passphrase,
      env,
      interactive: opts.interactive,
      prompt: 'Inkcast vault passphrase: ',
    });

  /** Read from storage only — no env. */
  async function readStored(provider: Provider): Promise<string | undefined> {
    if (backend === 'keychain') return keychain.read(provider, service);
    if (!vaultExists(vaultFile)) return undefined;
    return vaultGet(vaultFile, provider, await passphrase());
  }

  return {
    backend,

    async setKey(providerLike, rawKey) {
      const provider = assertProvider(providerLike);
      const key = normaliseKey(rawKey);
      remember(key);

      if (backend === 'keychain') {
        await keychain.write(provider, key, service);
        // `security add-generic-password` exits 0 after storing an *empty*
        // password if its confirmation prompt hit EOF (see keychain.ts). Read
        // back and compare so that trap can never silently lose a key.
        const stored = await keychain.read(provider, service);
        if (stored !== key) {
          throw new KeyvaultError(
            'keychain-failed',
            `the keychain did not store the ${provider} key correctly`,
            { hint: 'Retry, or use INKCAST_KEYVAULT_BACKEND=vault.' },
          );
        }
      } else {
        await vaultSet(vaultFile, provider, key, await passphrase(), env);
      }

      writeMeta(metaFile, provider, {
        masked: mask(key),
        updatedAt: new Date().toISOString(),
        // A rotated key has not been validated yet; clear any stale verdict so
        // the UI cannot show a green tick for a key that no longer exists.
        lastValidated: undefined,
        lastValidatedOk: undefined,
      });

      const shadow = envKey(provider, env);
      if (shadow) {
        log.warn(
          `${provider} key stored, but ${shadow.name} is set in the environment and takes precedence — ` +
            `unset it to use the stored key`,
        );
      } else {
        log.info(`${provider} key stored in the ${backend}`);
      }
    },

    async getKey(providerLike) {
      const provider = assertProvider(providerLike);

      // 1. Environment wins, always.
      const fromEnv = envKey(provider, env);
      if (fromEnv) return remember(fromEnv.value);

      // 2. Storage. A missing passphrase must degrade, not crash: a pipeline
      // stage asking for an optional upgrade key should fall back to its local
      // provider exactly as it would with no key at all.
      try {
        return remember(await readStored(provider));
      } catch (err) {
        if (err instanceof KeyvaultError && err.code === 'passphrase-required') {
          log.warn(
            `a ${provider} key is stored in the vault but no passphrase is available — ` +
              `continuing without it${err.hint ? `. ${err.hint}` : ''}`,
          );
          return undefined;
        }
        throw err;
      }
    },

    async listProviders() {
      // The vault's metadata is readable without a passphrase by design, so this
      // never prompts and never touches key material for stored entries.
      const vaultEntries = backend === 'vault' ? vaultList(vaultFile) : [];

      const out: ProviderStatus[] = [];
      for (const provider of PROVIDERS) {
        const meta = metaFor(metaFile, provider);
        const lastValidated = meta.lastValidated ?? null;
        const fromEnv = envKey(provider, env);

        if (fromEnv) {
          out.push({
            provider,
            configured: true,
            masked: mask(fromEnv.value),
            lastValidated,
            source: 'env',
          });
          continue;
        }

        if (backend === 'vault') {
          const entry = vaultEntries.find((e) => e.provider === provider);
          out.push({
            provider,
            configured: Boolean(entry),
            masked: entry ? entry.masked : null,
            lastValidated,
            source: entry ? 'vault' : null,
          });
          continue;
        }

        // Keychain: probe for existence without reading the secret, and prefer
        // the preview recorded at write time so the key stays in the keychain.
        let present = false;
        try {
          present = await keychain.has(provider, service);
        } catch (err) {
          log.debug(`could not probe the keychain for ${provider}`, err as Error);
        }
        let masked: string | null = null;
        if (present) {
          masked = meta.masked ?? null;
          if (!masked) {
            // No sidecar (fresh machine, or a key added with `security` by hand):
            // read once, mask, and record it so this stays a metadata-only path.
            try {
              const key = await keychain.read(provider, service);
              if (key) {
                masked = mask(key);
                remember(key);
                writeMeta(metaFile, provider, { masked });
              }
            } catch (err) {
              log.debug(`could not read ${provider} to build a preview`, err as Error);
            }
          }
        }
        out.push({
          provider,
          configured: present,
          masked,
          lastValidated,
          source: present ? 'keychain' : null,
        });
      }
      return out;
    },

    async deleteKey(providerLike) {
      const provider = assertProvider(providerLike);
      let removed: boolean;
      if (backend === 'keychain') {
        removed = await keychain.remove(provider, service);
      } else {
        removed = vaultExists(vaultFile)
          ? await vaultDelete(vaultFile, provider, await passphrase(), env)
          : false;
      }
      clearMeta(metaFile, provider);

      const shadow = envKey(provider, env);
      if (shadow) {
        log.warn(
          `${provider} removed from the ${backend}, but ${shadow.name} is still set in the environment — ` +
            `unset it to fully revoke local access`,
        );
      } else if (removed) {
        log.info(`${provider} key removed from the ${backend}`);
      }
      return removed;
    },

    async validateKey(providerLike) {
      const provider = assertProvider(providerLike);

      const fromEnv = envKey(provider, env);
      let source: KeySource | undefined = fromEnv ? 'env' : undefined;
      let key = fromEnv?.value;
      if (!key) {
        try {
          key = await readStored(provider);
          if (key) source = backend;
        } catch (err) {
          if (err instanceof KeyvaultError && err.code === 'passphrase-required') {
            return { provider, ok: false, reason: 'not-configured', message: err.hint };
          }
          throw err;
        }
      }
      if (!key) return { provider, ok: false, reason: 'not-configured' };
      remember(key);

      const result = { ...(await probeKey(provider, key)), source };
      // Only record answers that actually say something about the key: a network
      // outage must not overwrite yesterday's successful check.
      if (result.checkedAt && result.reason !== 'network') {
        writeMeta(metaFile, provider, {
          lastValidated: result.checkedAt,
          lastValidatedOk: result.ok,
        });
      }
      return result;
    },

    lock() {
      lockVault();
      forgetSecrets();
    },
  };
}

/* ----------------------------------------------------- convenience functions */

/** Store `key` for `provider`. Overwrites any existing value. */
export function setKey(
  provider: Provider | string,
  key: string,
  opts?: KeyvaultOptions,
): Promise<void> {
  return createKeyvault(opts).setKey(provider, key);
}

/** The key for `provider`: environment first, then storage. */
export function getKey(
  provider: Provider | string,
  opts?: KeyvaultOptions,
): Promise<string | undefined> {
  return createKeyvault(opts).getKey(provider);
}

/** Status for every provider. Never includes a raw key. */
export function listProviders(opts?: KeyvaultOptions): Promise<ProviderStatus[]> {
  return createKeyvault(opts).listProviders();
}

/** Remove `provider`'s stored key. Returns false when there was none. */
export function deleteKey(provider: Provider | string, opts?: KeyvaultOptions): Promise<boolean> {
  return createKeyvault(opts).deleteKey(provider);
}

/** Confirm `provider`'s key works, with the cheapest live call available. */
export function validateKey(
  provider: Provider | string,
  opts?: KeyvaultOptions,
): Promise<ValidationResult> {
  return createKeyvault(opts).validateKey(provider);
}

/** Drop cached derived keys and tracked secret values process-wide. */
export function lock(): void {
  lockVault();
  forgetSecrets();
}

/**
 * Which backend would be used, and whether it can actually hold a key right now.
 *
 * Lets a CLI print "keys will be stored in your macOS keychain" or "set
 * INKCAST_VAULT_PASSPHRASE to store keys" before the user types a secret.
 */
export function backendStatus(env: NodeJS.ProcessEnv = process.env): {
  backend: Backend;
  ready: boolean;
  why: string;
} {
  const backend = chooseBackend({}, env);
  if (backend === 'keychain') {
    return {
      backend,
      ready: true,
      why: 'macOS keychain — keys are never written to an Inkcast file',
    };
  }
  if (passphraseAvailable(env)) {
    return { backend, ready: true, why: 'encrypted vault file, passphrase from the environment' };
  }
  if (process.stdin.isTTY) {
    return {
      backend,
      ready: true,
      why: 'encrypted vault file, passphrase prompted at the terminal',
    };
  }
  return {
    backend,
    ready: false,
    why: 'encrypted vault file, but no passphrase is available — set INKCAST_VAULT_PASSPHRASE',
  };
}
