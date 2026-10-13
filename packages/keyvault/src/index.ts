/**
 * `@inkcast/keyvault` — bring-your-own-key credential storage for Inkcast.
 *
 * Inkcast runs end to end with no keys at all. A key is only ever an opt-in
 * upgrade for one stage, which shapes everything here: storing a key must be
 * deliberate, reading one must degrade quietly when it is absent, and a key must
 * never be able to reach a log line, an SSE frame, an HTTP body or a stack trace.
 *
 * ```ts
 * import { setKey, getKey, listProviders, validateKey, installRedaction } from '@inkcast/keyvault';
 *
 * installRedaction();                              // once, at process start
 * await setKey('anthropic', key);                  // keychain on macOS, else encrypted vault
 * const key = await getKey('anthropic');           // storage first, then env
 * await listProviders();                           // masked previews only, never a raw key
 * await validateKey('anthropic');                  // one free metadata call
 * ```
 *
 * See `README.md` for the storage design, the threat model, and key rotation.
 */

export {
  PROVIDERS,
  PROVIDER_SPECS,
  assertProvider,
  envKey,
  isProvider,
  type Provider,
  type ProviderSpec,
} from './providers.js';

export {
  backendStatus,
  createKeyvault,
  deleteKey,
  getKey,
  listProviders,
  lock,
  setKey,
  storageInfo,
  validateKey,
  type Backend,
  type KeyAvailability,
  type KeySource,
  type Keyvault,
  type KeyvaultOptions,
  type ProviderStatus,
  type StorageInfo,
} from './store.js';

export {
  dehydrate,
  hydrateEnv,
  hydratedProviders,
  realEnv,
  type HydrateResult,
} from './hydrate.js';

export {
  describeValidation,
  probeKey,
  type ValidationReason,
  type ValidationResult,
} from './validate.js';

export { mask, maskedMiddle } from './mask.js';

export {
  withSecretRedaction,
  forgetSecrets,
  installRedaction,
  looksRedacted,
  redact,
  redactDeep,
  redactError,
  redactJson,
  redactionInstalled,
  trackSecret,
  trackedCount,
  uninstallRedaction,
  type RedactOptions,
} from './redact.js';

export { KeyvaultError, isKeyvaultError, type KeyvaultErrorCode } from './errors.js';

export {
  passphraseAvailable,
  promptSecret,
  resolvePassphrase,
  type PassphraseOptions,
} from './passphrase.js';

export { GITIGNORE_RULES, gitRoot, metaPath, stateDir, vaultPath } from './paths.js';

export { keychainAvailable, keychainService } from './keychain.js';

export {
  secretEquals,
  vaultExists,
  vaultKdf,
  vaultVerify,
  type VaultEntryInfo,
  type VaultEntryVerdict,
  type VaultKdfInfo,
} from './vault.js';
