/**
 * The encrypted vault file: AES-256-GCM per entry, scrypt-derived key, 0600.
 *
 * Used everywhere the OS keychain is unavailable (Linux, Windows, containers) and
 * on darwin when the user explicitly asks for a portable vault.
 *
 * ## Shape
 *
 * Each provider is its own AEAD envelope, with the non-secret metadata in the
 * clear next to it:
 *
 * ```json
 * { "version": 1,
 *   "kdf": { "name": "scrypt", "salt": "…", "N": 65536, "r": 8, "p": 2, "keyLen": 32 },
 *   "verifier": { "iv": "…", "ct": "…", "tag": "…" },
 *   "entries": { "anthropic": { "iv": "…", "ct": "…", "tag": "…",
 *                              "masked": "sk-ant-ap…4f2a", "createdAt": "…" } } }
 * ```
 *
 * Three decisions worth the words:
 *
 * - **Per-entry envelopes, not one blob.** `listProviders()` must be able to say
 *   "anthropic is configured, it looks like `sk-ant-ap…4f2a`, last validated
 *   Tuesday" *without* a passphrase, or every status screen becomes a password
 *   prompt. So which providers are configured is deliberately not secret; only
 *   the key material is.
 * - **The AAD binds each ciphertext to its own metadata.** It is
 *   `inkcast-vault/1|<provider>|<masked>|<createdAt>`, so moving a ciphertext
 *   from one provider to another, or editing the masked preview to misrepresent
 *   which key is stored, fails authentication rather than succeeding quietly.
 * - **A separate verifier tells a wrong passphrase apart from tampering.** Both
 *   are GCM authentication failures. Decrypting the verifier first means the
 *   error can say "wrong passphrase" instead of accusing the user's disk.
 *
 * ## Parameters
 *
 * scrypt N=2^16, r=8, p=2 — 64 MiB and ~190 ms on an M-series laptop. p=2
 * doubles the work without doubling the memory, which is the right trade for a
 * CLI that derives once per invocation. The parameters are stored in the file, so
 * raising them later stays backward compatible.
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from 'node:crypto';
import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { logger } from '@inkcast/core';
import { KeyvaultError } from './errors.js';
import { mask } from './mask.js';
import { assertNotInRepo, ensurePrivateDir } from './paths.js';
import type { Provider } from './providers.js';

const log = logger('keyvault:vault');

const VERSION = 1 as const;
const AAD_PREFIX = 'inkcast-vault/1';
const VERIFIER_PLAINTEXT = 'inkcast-keyvault-verifier';
const CIPHER = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit nonce, the GCM standard.
const SALT_BYTES = 32;
const TAG_BYTES = 16;

const KDF_DEFAULTS = { name: 'scrypt', N: 65536, r: 8, p: 2, keyLen: 32 } as const;
/** node's scrypt needs maxmem > 128*N*r; 64 MiB of work, 128 MiB ceiling. */
const MAXMEM = 128 * 1024 * 1024;

type Sealed = { iv: string; ct: string; tag: string };

type Kdf = {
  name: 'scrypt';
  salt: string;
  N: number;
  r: number;
  p: number;
  keyLen: number;
};

type Entry = Sealed & {
  /** Display-safe preview. In the AAD, so editing it breaks decryption. */
  masked: string;
  createdAt: string;
};

export type VaultFile = {
  version: typeof VERSION;
  kdf: Kdf;
  verifier: Sealed;
  entries: Partial<Record<Provider, Entry>>;
};

/** Metadata a status listing can read with no passphrase. */
export type VaultEntryInfo = { provider: Provider; masked: string; createdAt: string };

function scrypt(passphrase: string, kdf: Kdf): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(
      passphrase,
      Buffer.from(kdf.salt, 'base64'),
      kdf.keyLen,
      { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: MAXMEM },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

/**
 * Derived keys, cached per (salt, parameters) for the life of the process.
 *
 * Without this, a run that touches three providers pays scrypt three times.
 * The cost is that a derived key sits in memory until `lock()`; the key alone is
 * useless without the vault file, and anyone who can read this process's heap
 * can read the decrypted secrets anyway.
 */
const derived = new Map<string, Buffer>();

function kdfFingerprint(kdf: Kdf): string {
  return `${kdf.name}:${kdf.salt}:${kdf.N}:${kdf.r}:${kdf.p}:${kdf.keyLen}`;
}

async function keyFor(passphrase: string, kdf: Kdf): Promise<Buffer> {
  // Include the passphrase in the cache key so switching passphrases mid-process
  // cannot silently reuse the wrong derived key.
  const id = `${kdfFingerprint(kdf)}:${Buffer.from(passphrase).toString('base64')}`;
  const hit = derived.get(id);
  if (hit) return hit;
  const key = await scrypt(passphrase, kdf);
  derived.set(id, key);
  return key;
}

/** Zero and drop every cached derived key. */
export function lockVault(): void {
  for (const key of derived.values()) key.fill(0);
  derived.clear();
}

function seal(key: Buffer, plaintext: string, aad: string): Sealed {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(CIPHER, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

/** Returns undefined on any authentication failure — the caller decides why. */
function open(key: Buffer, sealed: Sealed, aad: string): string | undefined {
  try {
    const decipher = createDecipheriv(CIPHER, key, Buffer.from(sealed.iv, 'base64'), {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    const out = Buffer.concat([
      decipher.update(Buffer.from(sealed.ct, 'base64')),
      decipher.final(),
    ]);
    return out.toString('utf8');
  } catch {
    return undefined;
  }
}

function entryAad(provider: Provider, entry: Pick<Entry, 'masked' | 'createdAt'>): string {
  return `${AAD_PREFIX}|${provider}|${entry.masked}|${entry.createdAt}`;
}

const VERIFIER_AAD = `${AAD_PREFIX}|verifier`;

/* ------------------------------------------------------------------ file I/O */

function isSealed(v: unknown): v is Sealed {
  const s = v as Sealed | null;
  return Boolean(
    s && typeof s.iv === 'string' && typeof s.ct === 'string' && typeof s.tag === 'string',
  );
}

/** Parse and structurally validate a vault file. */
function parse(raw: string, file: string): VaultFile {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (cause) {
    throw new KeyvaultError('corrupt-vault', `${file} is not valid JSON`, { cause });
  }
  const v = json as Partial<VaultFile>;
  if (v?.version !== VERSION) {
    throw new KeyvaultError(
      'corrupt-vault',
      `${file} has unsupported version ${String(v?.version)} (this build understands ${VERSION})`,
    );
  }
  const kdf = v.kdf;
  if (
    !kdf ||
    kdf.name !== 'scrypt' ||
    typeof kdf.salt !== 'string' ||
    !Number.isInteger(kdf.N) ||
    !Number.isInteger(kdf.r) ||
    !Number.isInteger(kdf.p) ||
    !Number.isInteger(kdf.keyLen)
  ) {
    throw new KeyvaultError('corrupt-vault', `${file} has an unreadable kdf block`);
  }
  if (!isSealed(v.verifier)) {
    throw new KeyvaultError('corrupt-vault', `${file} has no passphrase verifier`);
  }
  const entries: Partial<Record<Provider, Entry>> = {};
  for (const [k, e] of Object.entries(v.entries ?? {})) {
    const entry = e as Entry;
    if (
      !isSealed(entry) ||
      typeof entry.masked !== 'string' ||
      typeof entry.createdAt !== 'string'
    ) {
      throw new KeyvaultError('corrupt-vault', `${file} has a malformed entry for ${k}`);
    }
    entries[k as Provider] = entry;
  }
  return { version: VERSION, kdf, verifier: v.verifier, entries };
}

/** Read the vault, or `undefined` when there is none yet. */
export function readVaultFile(file: string): VaultFile | undefined {
  if (!existsSync(file)) return undefined;
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (cause) {
    throw new KeyvaultError('io-failed', `cannot read ${file}`, { cause });
  }
  // Loud, not fatal: the secrets are still sealed, but a group- or
  // world-readable vault means the ciphertext is available for offline attack.
  try {
    const mode = statSync(file).mode & 0o777;
    if (mode & 0o077) {
      log.warn(
        `${file} is mode ${mode.toString(8)} — it should be 600. Fix with: chmod 600 ${file}`,
      );
    }
  } catch {
    // stat failing is not a reason to refuse a readable file.
  }
  return parse(raw, file);
}

/** Create an empty vault sealed under `passphrase`. */
async function createVault(passphrase: string): Promise<VaultFile> {
  const kdf: Kdf = { ...KDF_DEFAULTS, salt: randomBytes(SALT_BYTES).toString('base64') };
  const key = await keyFor(passphrase, kdf);
  return {
    version: VERSION,
    kdf,
    verifier: seal(key, VERIFIER_PLAINTEXT, VERIFIER_AAD),
    entries: {},
  };
}

/**
 * Write atomically, owner-only.
 *
 * Temp file then rename, so a crash or a full disk can never leave a truncated
 * vault where a complete one used to be. The temp file is created 0600 and
 * `chmod`ed explicitly because `writeFileSync`'s mode is masked by the umask.
 */
function writeVaultFile(file: string, vault: VaultFile, env: NodeJS.ProcessEnv): void {
  assertNotInRepo(file, env);
  ensurePrivateDir(path.dirname(file));
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tmp, `${JSON.stringify(vault, null, 2)}\n`, { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, file);
    chmodSync(file, 0o600);
  } catch (cause) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      // Best effort; the rename never happened so the real vault is intact.
    }
    throw new KeyvaultError('io-failed', `cannot write ${file}`, { cause });
  }
}

/* -------------------------------------------------------------- operations */

/**
 * Load the vault and check the passphrase.
 *
 * Distinguishing a wrong passphrase from a tampered file is the whole point of
 * the verifier: if the verifier opens, the passphrase is right and any later
 * failure is the file's fault.
 */
async function unlock(
  file: string,
  passphrase: string,
): Promise<{ vault: VaultFile; key: Buffer }> {
  const vault = readVaultFile(file);
  if (!vault) throw new KeyvaultError('corrupt-vault', `no vault at ${file}`);
  const key = await keyFor(passphrase, vault.kdf);
  if (open(key, vault.verifier, VERIFIER_AAD) !== VERIFIER_PLAINTEXT) {
    throw new KeyvaultError('bad-passphrase', `the passphrase does not open ${file}`, {
      hint: 'If you have forgotten it there is no recovery — delete the vault and re-add your keys.',
    });
  }
  return { vault, key };
}

/** Store `plaintextKey` for `provider`, creating the vault if needed. */
export async function vaultSet(
  file: string,
  provider: Provider,
  plaintextKey: string,
  passphrase: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const existing = readVaultFile(file);
  let vault: VaultFile;
  let key: Buffer;
  if (existing) {
    ({ vault, key } = await unlock(file, passphrase));
  } else {
    vault = await createVault(passphrase);
    key = await keyFor(passphrase, vault.kdf);
  }

  const meta = { masked: mask(plaintextKey), createdAt: new Date().toISOString() };
  vault.entries[provider] = { ...meta, ...seal(key, plaintextKey, entryAad(provider, meta)) };
  writeVaultFile(file, vault, env);
}

/**
 * Read the key for `provider`.
 *
 * Throws `tampered` — never returns undefined — when an entry exists but fails
 * authentication under a passphrase that already opened the verifier. Silently
 * treating that as "no key configured" would turn a detected attack into a
 * confusing fallback to the local provider.
 */
export async function vaultGet(
  file: string,
  provider: Provider,
  passphrase: string,
): Promise<string | undefined> {
  const { vault, key } = await unlock(file, passphrase);
  const entry = vault.entries[provider];
  if (!entry) return undefined;
  const plaintext = open(key, entry, entryAad(provider, entry));
  if (plaintext === undefined) {
    throw new KeyvaultError(
      'tampered',
      `the ${provider} entry in ${file} failed authentication — the file has been modified`,
      { hint: `Delete the entry and re-add the key: inkcast keys set ${provider}` },
    );
  }
  return plaintext;
}

/** Remove an entry. Returns false when there was nothing stored. */
export async function vaultDelete(
  file: string,
  provider: Provider,
  passphrase: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const { vault } = await unlock(file, passphrase);
  if (!vault.entries[provider]) return false;
  delete vault.entries[provider];
  writeVaultFile(file, vault, env);
  return true;
}

/**
 * Non-secret metadata for every stored provider — no passphrase required.
 *
 * This is what keeps `listProviders()` from prompting. See the file header for
 * why that is a deliberate disclosure.
 */
export function vaultList(file: string): VaultEntryInfo[] {
  const vault = readVaultFile(file);
  if (!vault) return [];
  return Object.entries(vault.entries).map(([provider, entry]) => ({
    provider: provider as Provider,
    masked: entry.masked,
    createdAt: entry.createdAt,
  }));
}

/** True when a vault file exists at `file`. */
export function vaultExists(file: string): boolean {
  return existsSync(file);
}

/**
 * Constant-time compare, exported for callers that need to check a secret
 * against a stored value without leaking length-dependent timing.
 */
export function secretEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
