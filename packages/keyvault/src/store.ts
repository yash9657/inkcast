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
 *
 * `listProviders()` reports whether a stored key is *readable*, not merely
 * present, because "configured" for an entry nothing can decrypt is a lie the
 * pipeline exposes a minute later. It gets that without holding a secret:
 * `vaultVerify()` opens the entry and returns a verdict rather than the key. The
 * one path that still touches plaintext is a keychain entry with no sidecar, where
 * the preview has to be built from a single read; that value is tracked for
 * redaction and dropped immediately.
 */
import { logger } from '@inkcast/core';
import { KeyvaultError } from './errors.js';
import * as keychain from './keychain.js';
import { mask } from './mask.js';
import { clearMeta, metaFor, writeMeta, type ProviderMeta } from './meta.js';
import { metaPath as defaultMetaPath, vaultPath as defaultVaultPath } from './paths.js';
import { passphraseAvailable, resolvePassphrase } from './passphrase.js';
import { assertProvider, envKey, PROVIDERS, PROVIDER_SPECS, type Provider } from './providers.js';
import { forgetSecrets, trackSecret } from './redact.js';
import { probeKey, type ValidationResult } from './validate.js';
import {
  lockVault,
  vaultDelete,
  vaultExists,
  vaultGet,
  vaultKdf,
  vaultList,
  vaultSet,
  vaultVerify,
  type VaultEntryInfo,
  type VaultKdfInfo,
} from './vault.js';

const log = logger('keyvault');

/** Where a key came from. */
export type KeySource = 'env' | 'keychain' | 'vault';

/** Which storage backend an instance is bound to. */
export type Backend = 'keychain' | 'vault';

/**
 * Whether a key is actually usable, and when it is not, why not.
 *
 * `configured` on its own cannot carry this. A vault entry sealed under a
 * passphrase this process does not have is present on disk and useless to the
 * pipeline; an entry that fails authentication is present and unrecoverable. Both
 * would be "not configured" — but one is fixed by setting a variable and the other
 * by pasting the key again, so a UI that cannot tell them apart cannot give the
 * right instruction. Every value here names a distinct remedy.
 */
export type KeyAvailability =
  /** The environment supplies it, which beats anything stored. */
  | 'env'
  /** Stored and proven readable: `getKey()` will return it. */
  | 'stored'
  /** Stored, but no passphrase is available to open the vault. Set one. */
  | 'locked'
  /** Stored, but it failed authentication — the vault was modified. Re-add it. */
  | 'unreadable'
  /** Nothing anywhere. That stage runs on this machine, for nothing. */
  | 'absent';

export type ProviderStatus = {
  provider: Provider;
  /** True when `getKey()` would return something — `availability` is env or stored. */
  configured: boolean;
  /** The usable/not-usable verdict, with the reason when it is not. */
  availability: KeyAvailability;
  /** Display-safe preview, or null when nothing is stored or set. Never a raw key. */
  masked: string | null;
  /**
   * Character count, or null when it was never recorded.
   *
   * Worth surfacing because a truncated paste masks identically to a whole key, so
   * the length is the only cheap way for a user to spot the commonest mistake.
   */
  length: number | null;
  /**
   * The environment variable in play: the one that actually supplied the key when
   * `availability` is `env` — which for `fal` may be the legacy `FAL_API_KEY` —
   * and otherwise the canonical name a stored key is injected under.
   */
  envVar: string;
  /** ISO timestamp of the last set or rotate through this package, or null. */
  updatedAt: string | null;
  /** ISO timestamp of the last definitive `validateKey()`, or null. */
  lastValidated: string | null;
  /** Whether that last validation passed. Null when it has never run. */
  lastValidatedOk: boolean | null;
  /** Where the key would come from, or null when not configured. */
  source: KeySource | null;
  /**
   * A key is stored *and* set in the environment. The environment wins, so the
   * stored one is inert — worth saying out loud, because otherwise editing the
   * stored entry appears to do nothing at all.
   */
  shadowedByEnv: boolean;
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

  /**
   * The passphrase, but never by asking.
   *
   * Status paths must not block: a settings screen that prompted for a password
   * before it could render "anthropic is configured" would be a login screen.
   */
  const quietPassphrase = () =>
    resolvePassphrase({ passphrase: opts.passphrase, env, interactive: false });

  /** Read from storage only — no env. */
  async function readStored(provider: Provider): Promise<string | undefined> {
    if (backend === 'keychain') return keychain.read(provider, service);
    if (!vaultExists(vaultFile)) return undefined;
    return vaultGet(vaultFile, provider, await passphrase());
  }

  /** What storage holds for one provider, with no env and no prompting. */
  type StoredState = {
    availability: Exclude<KeyAvailability, 'env'>;
    masked: string | null;
    length: number | null;
    createdAt: string | null;
  };

  const ABSENT: StoredState = {
    availability: 'absent',
    masked: null,
    length: null,
    createdAt: null,
  };

  /**
   * Inspect storage for `provider` without reading a secret it does not have to.
   *
   * The keychain answers presence directly, so nothing is ever decrypted on this
   * path. The vault's per-entry metadata answers presence too — but not
   * *readability*, and that is the distinction worth paying for: an entry sealed
   * under a passphrase we do not have, and one that has been edited, are both
   * present and both unusable, with different fixes. `vaultVerify()` separates them
   * and returns a verdict rather than the key, so this stays a metadata path.
   */
  async function storedState(
    provider: Provider,
    vaultEntries: readonly VaultEntryInfo[],
    meta: ProviderMeta,
  ): Promise<StoredState> {
    if (backend === 'keychain') {
      let present = false;
      try {
        present = await keychain.has(provider, service);
      } catch (err) {
        log.debug(`could not probe the keychain for ${provider}`, err as Error);
        return ABSENT;
      }
      if (!present) return ABSENT;

      // Prefer the preview and length recorded at write time so the key stays in
      // the keychain. Only a missing sidecar — a fresh machine, or a key added
      // with `security` by hand — costs one read.
      let masked = meta.masked ?? null;
      let length = meta.length ?? null;
      if (masked === null || length === null) {
        try {
          const key = await keychain.read(provider, service);
          if (key) {
            masked = mask(key);
            length = key.length;
            remember(key);
            writeMeta(metaFile, provider, { masked, length });
          }
        } catch (err) {
          log.debug(`could not read ${provider} to build a preview`, err as Error);
        }
      }
      return { availability: 'stored', masked, length, createdAt: null };
    }

    const entry = vaultEntries.find((e) => e.provider === provider);
    if (!entry) return ABSENT;
    const found = {
      masked: entry.masked,
      length: meta.length ?? null,
      createdAt: entry.createdAt,
    };

    let verdict: Awaited<ReturnType<typeof vaultVerify>>;
    try {
      verdict = await vaultVerify(vaultFile, provider, await quietPassphrase());
    } catch (err) {
      if (err instanceof KeyvaultError && err.code === 'passphrase-required') {
        return { ...found, availability: 'locked' };
      }
      // A corrupt or unreadable file is reported, not thrown: one bad entry must
      // not stop a status listing describing the other three providers.
      log.debug(`could not open the stored ${provider} key`, err as Error);
      return { ...found, availability: 'unreadable' };
    }
    switch (verdict) {
      case 'ok':
        return { ...found, availability: 'stored' };
      case 'locked':
        return { ...found, availability: 'locked' };
      case 'tampered':
        return { ...found, availability: 'unreadable' };
      case 'missing':
        return ABSENT;
    }
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
        length: key.length,
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
      // Per-entry vault metadata is readable without a passphrase by design, so
      // presence never prompts. Read once for all four providers rather than
      // re-parsing the file per provider.
      const vaultEntries = backend === 'vault' ? vaultList(vaultFile) : [];

      const out: ProviderStatus[] = [];
      for (const provider of PROVIDERS) {
        const meta = metaFor(metaFile, provider);
        const lastValidated = meta.lastValidated ?? null;
        const lastValidatedOk = meta.lastValidatedOk ?? null;
        const fromEnv = envKey(provider, env);

        // Storage is inspected even when the environment wins, because "you have
        // saved a key that is being ignored" is exactly the state a user cannot
        // otherwise explain — see `shadowedByEnv`.
        const stored = await storedState(provider, vaultEntries, meta);

        if (fromEnv) {
          out.push({
            provider,
            configured: true,
            availability: 'env',
            masked: mask(fromEnv.value),
            length: fromEnv.value.length,
            envVar: fromEnv.name,
            // `updatedAt` describes the *stored* entry, which is not the key in
            // use here, so reporting it would attach a date to the wrong key.
            updatedAt: null,
            lastValidated,
            lastValidatedOk,
            source: 'env',
            shadowedByEnv: stored.availability !== 'absent',
          });
          continue;
        }

        const configured = stored.availability === 'stored';
        out.push({
          provider,
          configured,
          availability: stored.availability,
          masked: stored.masked,
          length: stored.length,
          envVar: PROVIDER_SPECS[provider].envVars[0]!,
          updatedAt: meta.updatedAt ?? stored.createdAt,
          lastValidated,
          lastValidatedOk,
          source: configured ? backend : null,
          shadowedByEnv: false,
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
  return describeBackend(chooseBackend({}, env), env);
}

function describeBackend(
  backend: Backend,
  env: NodeJS.ProcessEnv,
): { backend: Backend; ready: boolean; why: string } {
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

/**
 * Where keys are kept on this machine and what protects them.
 *
 * This is the honest version of a "where these live" panel. A settings screen that
 * hard-codes that prose goes stale the moment the backend differs from whatever
 * the author was running, and the difference is not cosmetic: on the keychain
 * backend there is no Inkcast file to point at and no passphrase to explain, so a
 * page promising an encrypted file beside the checkout would be describing
 * something that does not exist. Every field is either read from the backend in
 * use or explicitly null.
 */
export type StorageInfo = {
  backend: Backend;
  /** True when the backend can hold a key right now. */
  ready: boolean;
  /** One sentence: the backend, and what it still needs. */
  why: string;
  /** The vault file. Null on the keychain backend — nothing is written there. */
  path: string | null;
  /** The AEAD sealing the vault, or null on the keychain backend. */
  cipher: 'aes-256-gcm' | null;
  /**
   * How the vault key is derived, read from the vault itself so an older file is
   * described by its own parameters rather than today's defaults. Null on the
   * keychain backend, and when the file exists but cannot be parsed.
   */
  kdf: VaultKdfInfo | null;
  /**
   * The non-secret sidecar: masked previews, lengths and validation timestamps.
   * Never key material, on either backend.
   */
  metaPath: string;
};

/** Describe this machine's key storage. Reads no secret and creates nothing. */
export function storageInfo(opts: KeyvaultOptions = {}): StorageInfo {
  const env = opts.env ?? process.env;
  const backend = chooseBackend(opts, env);
  const described = describeBackend(backend, env);
  const metaFile = opts.metaPath ?? defaultMetaPath(env);

  if (backend === 'keychain') {
    return { ...described, path: null, cipher: null, kdf: null, metaPath: metaFile };
  }
  const vaultFile = opts.vaultPath ?? defaultVaultPath(env);
  return {
    ...described,
    path: vaultFile,
    cipher: 'aes-256-gcm',
    kdf: vaultKdf(vaultFile) ?? null,
    metaPath: metaFile,
  };
}
