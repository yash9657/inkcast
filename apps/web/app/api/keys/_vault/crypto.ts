/**
 * Sealing, unsealing and redaction. No filesystem, no environment, no state.
 *
 * ## What this protects against, honestly stated
 *
 * Inkcast runs on your machine, so there is no server-side secret to hide the
 * key behind. What encryption at rest buys here is real but bounded: a pasted
 * key never appears in plaintext on disk, so it cannot be picked up by a backup,
 * a `grep -r sk-ant` across the repo, a synced folder, an editor's file search,
 * or a screenshare of the file. The unsealing material sits next to it in a
 * `0600` file, or is derived from `INKCAST_VAULT_SECRET` if you set one — in
 * which case the key on disk is useless without that passphrase.
 *
 * What it does not buy: protection from a process already running as you. That is
 * the same trust boundary `.env` has, which is why the settings page says so.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
/** GCM's canonical nonce length. Never reuse one; every seal generates a fresh. */
const IV_BYTES = 12;
const KEY_BYTES = 32;
const SALT_BYTES = 16;

/** scrypt parameters. N=2^15 costs ~60ms here — imperceptible, and not cheap to grind. */
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

/** A sealed secret, as it is stored. Three base64 fields and nothing else. */
export type Sealed = { iv: string; tag: string; data: string };

export function isSealed(value: unknown): value is Sealed {
  if (!value || typeof value !== 'object') return false;
  const rec = value as Record<string, unknown>;
  return typeof rec.iv === 'string' && typeof rec.tag === 'string' && typeof rec.data === 'string';
}

/** 32 random bytes, base64. The file-backed unsealing material. */
export function generateVaultKey(): string {
  return randomBytes(KEY_BYTES).toString('base64');
}

export function generateSalt(): string {
  return randomBytes(SALT_BYTES).toString('base64');
}

/**
 * Turn `INKCAST_VAULT_SECRET` into 32 bytes.
 *
 * scrypt rather than a bare hash because a passphrase a human chose has far less
 * entropy than the 256 bits AES wants, and the work factor is what closes that
 * gap. The salt is stored beside the ciphertext; it is not a secret, it only has
 * to be unique per vault.
 */
export function deriveKeyFromPassphrase(passphrase: string, saltB64: string): Buffer {
  return scryptSync(
    passphrase.normalize('NFKC'),
    Buffer.from(saltB64, 'base64'),
    KEY_BYTES,
    SCRYPT,
  );
}

export function decodeVaultKey(keyB64: string): Buffer {
  const buf = Buffer.from(keyB64, 'base64');
  if (buf.length !== KEY_BYTES) {
    throw new Error(`the vault key must be ${KEY_BYTES} bytes; found ${buf.length}`);
  }
  return buf;
}

export function seal(plaintext: string, key: Buffer): Sealed {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

/**
 * Unseal, or return `undefined`.
 *
 * A GCM tag mismatch throws, and it throws for two very different reasons: the
 * file was tampered with, or the unsealing material changed (someone set
 * `INKCAST_VAULT_SECRET` after saving without one). Neither is recoverable and
 * neither is exceptional from the caller's point of view — it just means "this
 * entry can no longer be read, ask for it again" — so it is a value, not a throw.
 */
export function unseal(sealed: Sealed, key: Buffer): string | undefined {
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(sealed.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    const out = Buffer.concat([
      decipher.update(Buffer.from(sealed.data, 'base64')),
      decipher.final(),
    ]);
    return out.toString('utf8');
  } catch {
    return undefined;
  }
}

/* ---------------------------------------------------------------- redaction */

/**
 * Key formats we recognise well enough to redact even when we do not hold the
 * secret — for a message that came back from a provider, or from a stack we did
 * not build.
 */
const KEY_PATTERNS: readonly RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{12,}/g,
  /sk-[A-Za-z0-9]{20,}/g,
  /sk_[A-Za-z0-9]{20,}/g,
  /r8_[A-Za-z0-9]{16,}/g,
  /\bkey-[A-Za-z0-9]{16,}/g,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{16,}/gi,
];

const REDACTED = '[redacted]';

/**
 * Make a string safe to return to a browser or write to a log.
 *
 * Two passes, because either alone is insufficient. The first removes secrets we
 * are holding — the only reliable defence, since a provider is free to echo the
 * key we sent it. The second removes anything *shaped* like a key, which catches
 * the case where the leak is a different key than the one in hand.
 *
 * Every string that leaves the keys routes goes through this, including the ones
 * that "obviously" cannot contain a key. That is the point: the routes stay safe
 * without anyone having to reason about each message individually.
 */
export function scrub(message: string, secrets: readonly string[] = []): string {
  let out = message;
  for (const secret of secrets) {
    const trimmed = secret.trim();
    // Below 8 characters a "secret" is likelier to be a substring of ordinary
    // prose than a credential, and blanket-replacing it would corrupt the text.
    if (trimmed.length < 8) continue;
    out = out.split(trimmed).join(REDACTED);
  }
  for (const pattern of KEY_PATTERNS) out = out.replace(pattern, REDACTED);
  return out.length > 400 ? `${out.slice(0, 400)}…` : out;
}
