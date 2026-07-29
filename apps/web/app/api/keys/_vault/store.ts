/**
 * The on-disk vault: `<dir>/keys.json` plus, unless a passphrase is set,
 * `<dir>/vault.key`.
 *
 * Three design decisions carry most of the value here.
 *
 * **The mask is stored in plaintext alongside the ciphertext.** Listing keys is
 * by far the most frequent operation and the one the browser sees, so it must not
 * need the unsealing material at all. `list()` reads a file and returns previews;
 * there is no code path from a GET to a plaintext key, which is a stronger
 * guarantee than remembering not to write one.
 *
 * **Changing how the vault is sealed re-keys it instead of bricking it.** Setting
 * `INKCAST_VAULT_SECRET` after saving keys without one would otherwise leave every
 * entry permanently unsealable. The next write migrates whatever can still be
 * read and drops whatever cannot, and `read()` reports `unreadable` in the
 * meantime so the UI can ask for the key again rather than claim it is missing.
 *
 * **The directory is a parameter, not a global.** That is what lets the tests
 * exercise real encryption against a real temp directory instead of a fake, and
 * it keeps this module free of `@/` imports so it can run under plain `node`.
 */

import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  decodeVaultKey,
  deriveKeyFromPassphrase,
  generateSalt,
  generateVaultKey,
  isSealed,
  seal,
  unseal,
  type Sealed,
} from './crypto.js';

const KEYS_FILE = 'keys.json';
const KEY_FILE = 'vault.key';

/** Owner read/write only. The whole point of the file-backed factor is this bit. */
const PRIVATE_FILE = 0o600;
const PRIVATE_DIR = 0o700;

/** How the unsealing material is obtained, recorded so a mismatch is legible. */
export type Kdf = 'file' | 'passphrase';

/**
 * The only environment this module reads.
 *
 * Narrowed to the single variable rather than typed as `NodeJS.ProcessEnv` so a
 * caller — a test, most usefully — can pass a literal instead of assembling a
 * whole process environment. It also documents the dependency exactly.
 */
export type VaultEnv = {
  INKCAST_VAULT_SECRET?: string | undefined;
  /** So `process.env` itself is assignable without a cast. */
  [other: string]: string | undefined;
};

type StoredEntry = {
  sealed: Sealed;
  /** Non-secret preview, so `list()` never has to unseal. */
  mask: string;
  /** Character count of the original key. Helps spot a truncated paste. */
  length: number;
  updatedAt: string;
};

type VaultFile = {
  version: 1;
  kdf: Kdf;
  /** Present only for `passphrase`. Not a secret; it only has to be unique. */
  salt?: string;
  entries: Record<string, StoredEntry>;
};

/** What a caller learns about a stored key. Never includes the key. */
export type StoredSummary = {
  id: string;
  mask: string;
  length: number;
  updatedAt: string;
};

export type ReadResult =
  | { ok: true; key: string }
  | { ok: false; reason: 'missing' }
  /** Present but unsealable — the vault key or the passphrase changed. */
  | { ok: false; reason: 'unreadable' };

export type Vault = {
  /** Absolute path of `keys.json`, for showing the user where this lives. */
  readonly file: string;
  /** How this vault is currently sealed. */
  kdf(): Promise<Kdf>;
  list(): Promise<StoredSummary[]>;
  read(id: string): Promise<ReadResult>;
  write(id: string, key: string): Promise<StoredSummary>;
  remove(id: string): Promise<boolean>;
  /** Delete the vault and its key file. */
  destroy(): Promise<void>;
};

/**
 * Serialise every mutation.
 *
 * `keys.json` is read-modify-written, and saving two keys from two tabs at once
 * is exactly the race that loses one of them. `openVault` memoises per directory,
 * so in the app there is one chain per vault for the life of the process.
 */
function chained(): <T>(fn: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const next = tail.then(fn, fn);
    tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
}

const cache = new Map<string, Vault>();

/** The vault for a directory. Memoised so the write chain is shared. */
export function openVault(dir: string, env: VaultEnv = process.env): Vault {
  const resolved = path.resolve(dir);
  const existing = cache.get(resolved);
  if (existing) return existing;
  const vault = createVault(resolved, env);
  cache.set(resolved, vault);
  return vault;
}

/** Drop the memo for a directory, so the next `openVault` re-reads the env. */
export function forgetVault(dir: string): void {
  cache.delete(path.resolve(dir));
}

function createVault(dir: string, env: VaultEnv): Vault {
  const file = path.join(dir, KEYS_FILE);
  const keyFile = path.join(dir, KEY_FILE);
  const serialise = chained();

  function passphrase(): string | undefined {
    const raw = env.INKCAST_VAULT_SECRET;
    return raw !== undefined && raw.trim() !== '' ? raw : undefined;
  }

  /** How a write *would* seal, given the environment as it is right now. */
  function targetKdf(): Kdf {
    return passphrase() ? 'passphrase' : 'file';
  }

  async function ensureDir(): Promise<void> {
    await mkdir(dir, { recursive: true, mode: PRIVATE_DIR });
  }

  async function header(): Promise<VaultFile> {
    let raw: string;
    try {
      raw = await readFile(file, 'utf8');
    } catch {
      return { version: 1, kdf: targetKdf(), entries: {} };
    }
    return parseVaultFile(raw, targetKdf());
  }

  /** Material that can unseal what is already stored, or `undefined`. */
  async function unsealingMaterial(current: VaultFile): Promise<Buffer | undefined> {
    if (current.kdf === 'passphrase') {
      const secret = passphrase();
      if (secret === undefined || current.salt === undefined) return undefined;
      return deriveKeyFromPassphrase(secret, current.salt);
    }
    try {
      return decodeVaultKey((await readFile(keyFile, 'utf8')).trim());
    } catch {
      return undefined;
    }
  }

  /**
   * Material to seal *new* entries with, creating whatever is missing, plus the
   * header that describes it. Returned together because the salt is generated
   * here and has to be persisted with the entries it protects.
   */
  async function sealingMaterial(
    current: VaultFile,
  ): Promise<{ head: VaultFile; material: Buffer }> {
    const kdf = targetKdf();
    if (kdf === 'passphrase') {
      const secret = passphrase();
      if (secret === undefined) throw new Error('the vault passphrase disappeared mid-write');
      const salt =
        current.kdf === 'passphrase' && current.salt !== undefined ? current.salt : generateSalt();
      return {
        head: { version: 1, kdf, salt, entries: current.entries },
        material: deriveKeyFromPassphrase(secret, salt),
      };
    }

    let keyB64: string | undefined;
    try {
      const found = (await readFile(keyFile, 'utf8')).trim();
      decodeVaultKey(found);
      keyB64 = found;
    } catch {
      keyB64 = undefined;
    }
    if (keyB64 === undefined) {
      await ensureDir();
      keyB64 = generateVaultKey();
      await writeFile(keyFile, `${keyB64}\n`, { mode: PRIVATE_FILE });
      await chmod(keyFile, PRIVATE_FILE).catch(() => undefined);
    }
    return {
      head: { version: 1, kdf, entries: current.entries },
      material: decodeVaultKey(keyB64),
    };
  }

  /**
   * Re-seal every entry that can still be read, under new material.
   *
   * Entries that cannot be read are dropped rather than carried forward as
   * ciphertext nobody will ever open: keeping them would show the user a
   * configured key that silently never works.
   */
  async function rekey(current: VaultFile, material: Buffer): Promise<Record<string, StoredEntry>> {
    const ids = Object.keys(current.entries);
    if (ids.length === 0) return {};
    const old = await unsealingMaterial(current);
    if (!old) return {};
    const next: Record<string, StoredEntry> = {};
    for (const id of ids) {
      const entry = current.entries[id];
      if (!entry) continue;
      const plain = unseal(entry.sealed, old);
      if (plain === undefined) continue;
      next[id] = { ...entry, sealed: seal(plain, material) };
    }
    return next;
  }

  async function persist(next: VaultFile): Promise<void> {
    await ensureDir();
    const body = `${JSON.stringify(next, null, 2)}\n`;
    // Write-then-rename so an interrupted save cannot leave half a file behind,
    // and the temp file is created private so nothing is briefly readable.
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, body, { mode: PRIVATE_FILE });
    await rename(tmp, file);
    await chmod(file, PRIVATE_FILE).catch(() => undefined);
  }

  return {
    file,

    async kdf() {
      return (await header()).kdf;
    },

    async list() {
      const current = await header();
      return Object.entries(current.entries)
        .map(([id, entry]) => ({
          id,
          mask: entry.mask,
          length: entry.length,
          updatedAt: entry.updatedAt,
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
    },

    async read(id) {
      const current = await header();
      const entry = current.entries[id];
      if (!entry) return { ok: false, reason: 'missing' };
      const material = await unsealingMaterial(current);
      if (!material) return { ok: false, reason: 'unreadable' };
      const plain = unseal(entry.sealed, material);
      if (plain === undefined) return { ok: false, reason: 'unreadable' };
      return { ok: true, key: plain };
    },

    write(id, key) {
      return serialise(async () => {
        const current = await header();
        const { head, material } = await sealingMaterial(current);
        const migrating = head.kdf !== current.kdf || head.salt !== current.salt;
        const entries = migrating ? await rekey(current, material) : { ...current.entries };

        const trimmed = key.trim();
        const entry: StoredEntry = {
          sealed: seal(trimmed, material),
          mask: maskFor(trimmed),
          length: trimmed.length,
          updatedAt: new Date().toISOString(),
        };
        entries[id] = entry;
        await persist({ ...head, entries });
        return { id, mask: entry.mask, length: entry.length, updatedAt: entry.updatedAt };
      });
    },

    remove(id) {
      return serialise(async () => {
        const current = await header();
        if (!(id in current.entries)) return false;
        const entries = { ...current.entries };
        delete entries[id];
        await persist({ ...current, entries });
        return true;
      });
    },

    destroy() {
      return serialise(async () => {
        await rm(file, { force: true });
        await rm(keyFile, { force: true });
      });
    },
  };
}

/**
 * Parse `keys.json`, salvaging what is valid.
 *
 * A single malformed entry must not hide the other three: the user would see "no
 * keys configured", re-paste everything, and never learn why. Anything that is
 * not a well-formed sealed entry is dropped, which presents as that one key being
 * absent — recoverable by pasting it again.
 */
function parseVaultFile(raw: string, fallbackKdf: Kdf): VaultFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { version: 1, kdf: fallbackKdf, entries: {} };
  }
  const rec = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  const kdf: Kdf =
    rec.kdf === 'passphrase' ? 'passphrase' : rec.kdf === 'file' ? 'file' : fallbackKdf;
  const salt = typeof rec.salt === 'string' && rec.salt !== '' ? rec.salt : undefined;

  const entries: Record<string, StoredEntry> = {};
  const bag = rec.entries;
  if (bag && typeof bag === 'object') {
    for (const [id, value] of Object.entries(bag as Record<string, unknown>)) {
      const entry = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
      if (!isSealed(entry.sealed)) continue;
      entries[id] = {
        sealed: entry.sealed,
        mask: typeof entry.mask === 'string' && entry.mask !== '' ? entry.mask : '••••',
        length:
          typeof entry.length === 'number' && Number.isFinite(entry.length) ? entry.length : 0,
        updatedAt:
          typeof entry.updatedAt === 'string' ? entry.updatedAt : new Date(0).toISOString(),
      };
    }
  }

  return { version: 1, kdf, ...(salt === undefined ? {} : { salt }), entries };
}

/**
 * The stored preview.
 *
 * Duplicated from `maskSecret` in `components/settings/catalog.ts`, which is in
 * turn identical to `mask()` in `@inkcast/keyvault`. The duplication is
 * deliberate: this module must stay importable by a bare `node --test` run, so it
 * carries no `@/` import. `vault.test.ts` asserts all of them agree, which is what
 * keeps the copy honest.
 */
const PUBLIC_PREFIXES = [
  'sk-ant-api03-',
  'sk-ant-api',
  'sk-ant-oat01-',
  'sk-ant-oat',
  'sk-ant-',
  'sk-proj-',
  'sk_live_',
  'sk_test_',
  'sk-',
  'sk_',
  'r8_',
  'hf_',
  'ghp_',
] as const;

function maskFor(key: string): string {
  if (key.length === 0) return '';
  const prefix = PUBLIC_PREFIXES.find((candidate) => key.startsWith(candidate)) ?? '';
  const body = key.slice(prefix.length);
  if (body.length < 10) return `${prefix}${'\u2022'.repeat(6)}`;
  return `${prefix}${body.slice(0, 2)}\u2026${body.slice(-4)}`;
}
