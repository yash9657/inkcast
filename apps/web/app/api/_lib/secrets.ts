/**
 * Per-account credential storage for the hosted deployment: envelope encryption
 * with a server-held master key, and the small on-disk store that holds the
 * sealed records.
 *
 * **This is the most security-sensitive file in the repository.** Read the four
 * rules below before changing a line of it.
 *
 * ## Why this exists at all, next to `@inkcast/keyvault`
 *
 * `@inkcast/keyvault` is the *local* story and stays that way: one macOS keychain
 * item per provider, or one scrypt-sealed `~/.inkcast/vault.json`, for the one
 * person sitting at the machine. It is single-tenant by construction — one
 * keychain service, one vault file, one derived key cached per process, one
 * process-global tracked-secret table — and that is the right design for a desktop
 * studio. None of it survives contact with a hosted box: a Linux container has no
 * keychain, and the vault backend wants a passphrase from a TTY that a request
 * does not have. More importantly, a shared deployment has *many* owners, and a
 * store with one slot per provider cannot represent that. So this is a second
 * store rather than a keyvault option, exactly as `packages/keyvault/README.md`
 * asks: nothing here writes into a project directory, and nothing here touches the
 * keychain.
 *
 * ## The four rules
 *
 *  1. **The master key comes from the environment or nowhere.** There is no
 *     default, no constant, no derivation from the hostname or the session secret
 *     or anything else a reader of this source could reconstruct. A hosted box
 *     without `INKCAST_SECRET_KEY` fails at import (see the bottom of this file),
 *     which is the same shape of loud failure `session.ts` uses for
 *     `INKCAST_SESSION_SECRET`, and for the same reason: a fallback key is a key
 *     that every reader of this repository also has.
 *  2. **The owner is an input to decryption, not a field on the record.** Both
 *     AEAD layers bind their ciphertext to `owner` and `provider` through the
 *     additional authenticated data, and the AAD is always built from the owner
 *     the *caller* asked for — never from anything stored in the record. So a
 *     record copied into another account's file does not decrypt for that account:
 *     it fails authentication, which is a loud `tampered` error rather than a
 *     credential quietly showing up in the wrong person's settings page. This is
 *     the property that turns "we filter by owner in a query" into something the
 *     cipher enforces. The record deliberately does not store its own owner
 *     digest: it would be a field nobody may trust, and one more handle for
 *     correlating this directory against `meta.json`'s `ownerSession`.
 *  3. **Plaintext leaves through exactly one function.** `openSecret` (and
 *     `readOwnerKey`, which wraps it). Everything else — listing, status, the
 *     masked hint — is computed from fields stored in the clear beside the
 *     ciphertext. The account API separately verifies readability before returning
 *     a summary.
 *  4. **Nothing here logs.** Not the key, not the record, not the error. Errors
 *     carry a fixed sentence and a code; the routes above turn those into prose.
 *     `@inkcast/keyvault`'s `installRedaction()` still runs in this process (see
 *     `app/api/keys/_account.ts`), so even a stray `console` call from elsewhere
 *     can scrub scoped job credentials — but this module gives it nothing to catch.
 *
 * ## Why envelope encryption rather than one AES-GCM layer
 *
 * Each record gets a fresh random 32-byte data key; the credential is sealed under
 * the data key, and the data key is sealed under the master key. One layer would
 * work today and would make master-key rotation mean decrypting every stored
 * credential — i.e. holding every user's key in memory at once, in a migration
 * script, which is the worst possible place for it. With the envelope, rotation
 * re-wraps 32 bytes per record and never touches a credential. It also keeps a
 * single master key well clear of the AES-GCM per-key message limit, since each
 * data key encrypts exactly one short message and is then thrown away.
 *
 * ## Where the records live, and why there
 *
 * `${INKCAST_PROJECTS}/.keys/` by default, overridable with
 * `INKCAST_SECRETS_DIR`. The projects directory is the one path a hosted
 * deployment already has to mount as a persistent volume — that is where the films
 * are, so if it is not persistent the product does not work — which makes it the
 * only place a key can survive a container restart without inventing a second
 * volume for an operator to forget. The leading dot is load-bearing twice over:
 * `isValidProjectId` in `lib/store.ts` requires an alphanumeric first character, so
 * `.keys` is invisible to `projectDirNames()` (it can never appear in the library
 * index) and `projectDir('.keys')` returns `undefined` (the media route can never
 * be talked into serving a byte of it). `.session-secret` already sits in that
 * directory on exactly the same reasoning. Nothing here goes *inside* a project
 * directory, because D5's disk janitor deletes those after 48 hours.
 */

import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { blobPrefix, blobStorageEnabled, readJson, updateJson } from '@inkcast/cloud';

// Imported for the module side effect as much as for `PROJECTS_DIR`: `lib/store`
// is the environment bootstrap, and it is what has read the repo-root `.env` into
// `process.env` before anything below looks for a master key. See its header.
import { PROJECTS_DIR } from '@/lib/store';

/* ------------------------------------------------------------------ constants */

/** The environment variable holding the master key. Nothing else is consulted. */
export const SECRET_KEY_ENV = 'INKCAST_SECRET_KEY';

/**
 * Bytes of key material a master key must carry.
 *
 * 32, because the wrapping cipher is AES-256-GCM and a shorter input would be
 * stretched by the HKDF below into a 256-bit key that only ever had, say, 64 bits
 * behind it. HKDF spreads entropy; it does not create any. The accepted encodings
 * are chosen so that clearing this bar means clearing it honestly — see
 * `decodeMasterKey`.
 */
const MIN_KEY_BYTES = 32;

/**
 * HKDF info strings. Three distinct labels over one master key, so that no two
 * uses of it ever see the same derived bytes.
 *
 * The same discipline as `SIGN_DOMAIN`/`OWNER_DOMAIN` in `session.ts`, which
 * records what happens without it: two meanings sharing one key made the digest
 * that every viewer of a shared project could read into a valid cookie signature
 * for its owner. Adding a fourth use of `INKCAST_SECRET_KEY` means adding a fourth
 * label here, not reusing one of these.
 */
const INFO_MASTER = 'inkcast.secrets.v1/master';
const INFO_FILENAME = 'inkcast.secrets.v1/filename';

/**
 * AAD prefixes for the two envelope layers.
 *
 * Separate labels so a wrapped data key can never be substituted for a sealed
 * credential or the other way round, even though both are AES-256-GCM under keys
 * derived from the same root.
 */
const AAD_WRAP = 'inkcast.secrets.v1/wrap';
const AAD_DATA = 'inkcast.secrets.v1/data';

/** AES-256-GCM: 96-bit IV (the size the mode is specified for), 128-bit tag. */
const CIPHER = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const DATA_KEY_BYTES = 32;

/** Directory holding one file per account. Overridable, defaulted, never guessed. */
const SECRETS_DIR_ENV = 'INKCAST_SECRETS_DIR';
const SECRETS_DIRNAME = '.keys';

/**
 * The longest credential this store will seal.
 *
 * The routes above already cap a request body far below this; the cap is repeated
 * here because this function is also reachable from code that has not been
 * through a zod schema, and a store that will seal an arbitrary blob is a store
 * that can be used to write arbitrary blobs to the volume.
 */
const MAX_SECRET_CHARS = 8192;

/** Widest owner digest this store will name a file for. See `ownerFile`. */
const OWNER_RE = /^[A-Za-z0-9_-]{16,128}$/;

/* --------------------------------------------------------------------- errors */

export type SecretsErrorCode =
  /** `INKCAST_SECRET_KEY` is absent or empty. */
  | 'no-master-key'
  /** Present, but too short or not an encoding that can carry 32 random bytes. */
  | 'weak-master-key'
  /** AEAD authentication failed: the record was altered, or is not this owner's. */
  | 'tampered'
  /** The caller passed something this store will not put on disk. */
  | 'rejected';

/**
 * The only error type this module throws.
 *
 * A code rather than prose-matching, so the routes can decide what a user is told
 * without parsing English. The `message` is fixed text — it never quotes the
 * plaintext, the ciphertext, the owner digest or the key material, because an
 * error message is the most common way a secret escapes a module that was
 * otherwise careful.
 */
export class SecretsError extends Error {
  readonly code: SecretsErrorCode;

  constructor(code: SecretsErrorCode, message: string) {
    super(message);
    this.name = 'SecretsError';
    this.code = code;
  }
}

export function isSecretsError(err: unknown): err is SecretsError {
  return err instanceof SecretsError;
}

/* ---------------------------------------------------------------- master key */

/**
 * `isHosted()` from `lib/store`, but taking the environment as an argument.
 *
 * Copied rather than imported for the same reason `session.ts` copies it: every
 * exported function here accepts an `env` so a test can exercise the hosted and
 * local branches in one process without mutating global state and hoping the
 * module cache cooperates. It is also two lines, and importing `_lib/http` for it
 * would drag `next/server` into a module that has no business knowing about HTTP.
 */
function hosted(env: NodeJS.ProcessEnv): boolean {
  return env.INKCAST_HOSTED === '1';
}

/**
 * The accepted encodings for the master key: hex, base64, base64url — nothing
 * else, and only at a length and a size a key generator actually emits.
 *
 * A structural test rather than "decode it and see", because base64 decoding
 * accepts almost any prose. `Buffer.from('correct horse battery', 'base64')`
 * returns bytes without complaint, so a permissive decoder would take a
 * human-typed passphrase, stretch it with HKDF and hand back a key with a
 * dictionary's worth of entropy wearing a 256-bit costume. Three rules, each
 * closing a hole that was measured rather than imagined:
 *
 *  - **A hex-looking value is only ever read as hex.** 62 hex characters is 31
 *    bytes and must fail; falling through to base64url would re-read the same
 *    string as 46 bytes and pass it. Anything in the hex alphabet is judged as hex
 *    and never reinterpreted.
 *  - **The decoded material must be a round number of 8-byte words.** Key
 *    material comes in round sizes — 16, 24, 32, 48, 64 bytes — because that is
 *    what `openssl rand` and every SDK emit. A value that decodes to 37 bytes is
 *    not a key; it is a sentence that happened to use the base64 alphabet, and
 *    this rule refuses seven of every eight such sentences.
 *  - **32 bytes is the floor**, per `MIN_KEY_BYTES`.
 *
 * What this does *not* do, said plainly rather than left to be discovered: a
 * 44-character passphrase drawn from the base64 alphabet that happens to decode to
 * 32 bytes is structurally indistinguishable from a key, and this function will
 * accept it. There is no regex that fixes that. The defences against it are the
 * `openssl rand -hex 32` in the failure message and this paragraph.
 */
const HEX_CHARS = /^[0-9a-fA-F]+$/;
const BASE64URL_CHARS = /^[A-Za-z0-9_-]+$/;
const BASE64_CHARS = /^[A-Za-z0-9+/]+={0,2}$/;
const KEY_SIZE_STEP = 8;

function sized(material: Buffer): Buffer | undefined {
  if (material.length < MIN_KEY_BYTES) return undefined;
  return material.length % KEY_SIZE_STEP === 0 ? material : undefined;
}

function decodeMasterKey(raw: string): Buffer | undefined {
  if (HEX_CHARS.test(raw)) {
    return raw.length % 2 === 0 ? sized(Buffer.from(raw, 'hex')) : undefined;
  }
  if (BASE64URL_CHARS.test(raw)) return sized(Buffer.from(raw, 'base64url'));
  if (BASE64_CHARS.test(raw)) return sized(Buffer.from(raw, 'base64'));
  return undefined;
}

const HOW_TO_MAKE_ONE = 'Generate one with: openssl rand -hex 32';

/**
 * The failure, spelled out.
 *
 * Long and loud because of where it is read from: the bottom of this module, at
 * import time, on a box that is about to serve strangers. Whoever sees this is an
 * operator staring at a container that will not start, and the message has to
 * contain the whole answer — what is missing, what it protects, why there is no
 * default, and the command that produces one.
 */
function missingKeyMessage(reason: 'absent' | 'weak'): string {
  return [
    '',
    reason === 'absent'
      ? `${SECRET_KEY_ENV} is not set, and INKCAST_HOSTED=1.`
      : `${SECRET_KEY_ENV} is set but is not 32 or more bytes of random key material.`,
    '',
    'On the hosted deployment every user brings their own provider API keys, and',
    'this is the key those are encrypted with, per record, before anything is',
    "written to disk. Without it there is nowhere safe to put a visitor's",
    'credential, so the deployment refuses to hold one rather than storing it in',
    'the clear.',
    '',
    reason === 'absent'
      ? 'There is deliberately no fallback and no generated default: a key this'
      : 'A short or human-typed value is refused rather than stretched: HKDF spreads',
    reason === 'absent'
      ? 'source could invent is a key every reader of this source also has.'
      : 'entropy, it does not create any, and a passphrase behind a 256-bit key is',
    reason === 'absent' ? '' : 'a passphrase.',
    '',
    `Fix: set ${SECRET_KEY_ENV} to 64 hex characters (or 43+ base64 characters).`,
    `  ${SECRET_KEY_ENV}=$(openssl rand -hex 32)`,
    '',
  ]
    .filter((line, i, all) => !(line === '' && all[i - 1] === ''))
    .join('\n');
}

/**
 * Derived keys, pinned to `globalThis` and keyed by a digest of the raw value.
 *
 * Pinned because `next dev` re-evaluates modules on edit and re-deriving per
 * reload is waste; keyed by the *value* so that a test which changes the
 * environment gets the key belonging to the new value rather than a stale one
 * cached under the module. The digest is the map key so the raw string is not held
 * a second time.
 */
const scope = globalThis as typeof globalThis & { __inkcastSecretKeys?: Map<string, Buffer> };

function derived(raw: string, info: string): Buffer {
  const cache = (scope.__inkcastSecretKeys ??= new Map());
  const id = `${info}:${createHash('sha256').update(raw).digest('base64url')}`;
  const hit = cache.get(id);
  if (hit) return hit;
  const material = decodeMasterKey(raw);
  if (material === undefined || material.length < MIN_KEY_BYTES) {
    // Unreachable through the exports — every caller passes the value
    // `requireSecretKey` just approved — and asserted rather than assumed, because
    // the failure mode of assuming would be a key derived from a shorter input.
    throw new SecretsError('weak-master-key', `${SECRET_KEY_ENV} is not usable key material`);
  }
  // No salt. HKDF's salt is there to decorrelate low-entropy inputs, and the
  // input here is required to be 32+ random bytes, so a fixed empty salt with a
  // domain-separating `info` is the honest use of the primitive. A random salt
  // would have to be stored somewhere, and a stored salt on the same volume as
  // the ciphertext protects nothing that the key itself does not already protect.
  const key = Buffer.from(hkdfSync('sha256', material, Buffer.alloc(0), info, 32));
  cache.set(id, key);
  return key;
}

/**
 * The raw configured value, or a precise complaint.
 *
 * Exported so a health check or a boot guard can assert configuration without
 * encrypting anything, and so the failure is testable without arranging for a
 * module import to explode.
 */
export function requireSecretKey(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env[SECRET_KEY_ENV] ?? '').trim();
  if (raw === '') {
    throw new SecretsError(
      'no-master-key',
      hosted(env)
        ? missingKeyMessage('absent')
        : `${SECRET_KEY_ENV} is not set. ${HOW_TO_MAKE_ONE}`,
    );
  }
  const material = decodeMasterKey(raw);
  if (material === undefined || material.length < MIN_KEY_BYTES) {
    throw new SecretsError(
      'weak-master-key',
      hosted(env)
        ? missingKeyMessage('weak')
        : `${SECRET_KEY_ENV} is not 32 or more bytes of random key material. ${HOW_TO_MAKE_ONE}`,
    );
  }
  return raw;
}

/**
 * True when this box can hold an account credential at all.
 *
 * The routes ask this before offering the feature, so a misconfigured box refuses
 * the request instead of throwing a 500 with a configuration essay in it. It never
 * throws, because "can I do this" must be answerable without a `try`.
 */
export function secretsConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    requireSecretKey(env);
    return true;
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------- the record */

const BlobSchema = z
  .object({
    /** base64. */
    iv: z.string().min(1),
    tag: z.string().min(1),
    ct: z.string().min(1),
  })
  .strict();

/**
 * A sealed credential, as it sits on disk.
 *
 * Everything outside `wrap` and `data` is metadata the settings page needs and
 * that reveals nothing: which provider, how long the key is, the last four
 * characters, when it was stored, and how a validation check went. Keeping those
 * in the clear supports masked summaries. Version 2 authenticates the mask,
 * length and storage timestamps as AAD. The account API checks readability before
 * returning these summaries; raw credentials never reach the response.
 *
 * Note what is *not* here: the owner. See rule 2 in the header.
 */
const SealedSchema = z
  .object({
    v: z.union([z.literal(1), z.literal(2)]),
    provider: z.string().min(1).max(32),
    wrap: BlobSchema,
    data: BlobSchema,
    /** `••••9f2a`. Never more than the last four characters of the credential. */
    hint: z.string().max(64),
    length: z.number().int().nonnegative(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    validatedAt: z.string().min(1).optional(),
    validatedOk: z.boolean().optional(),
  })
  .strict();

export type SealedSecret = z.infer<typeof SealedSchema>;

const FileSchema = z
  .object({
    v: z.literal(1),
    /** Keyed by provider id. The routes above decide which ids are meaningful. */
    keys: z.record(z.string(), SealedSchema),
  })
  .strict();

type SecretsFile = z.infer<typeof FileSchema>;

/** What a caller may know about a stored credential without unsealing it. */
export type SecretSummary = {
  provider: string;
  hint: string;
  length: number;
  createdAt: string;
  updatedAt: string;
  validatedAt?: string;
  validatedOk?: boolean;
};

export function summarise(sealed: SealedSecret): SecretSummary {
  return {
    provider: sealed.provider,
    hint: sealed.hint,
    length: sealed.length,
    createdAt: sealed.createdAt,
    updatedAt: sealed.updatedAt,
    ...(sealed.validatedAt === undefined ? {} : { validatedAt: sealed.validatedAt }),
    ...(sealed.validatedOk === undefined ? {} : { validatedOk: sealed.validatedOk }),
  };
}

/**
 * The last four characters, and nothing else.
 *
 * Deliberately *not* `maskSecret()` from `components/settings/catalog.ts`. That
 * function shows a provider's public prefix in full plus two leading characters of
 * the body, which is the right call for the local vault — it is the format
 * `@inkcast/keyvault` stores beside the ciphertext, the CLI and the studio must
 * render the same preview, and the only reader is the person who typed the key.
 * Here the hint is served over the network from a multi-tenant box, so it carries
 * the smallest thing that still answers "is this the key I think it is": four
 * trailing characters. A key too short to spare four is shown as dots alone rather
 * than as a fraction of itself.
 */
const HINT_TAIL = 4;
const HINT_MIN_LENGTH = 12;

export function secretHint(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length < HINT_MIN_LENGTH) return '•'.repeat(HINT_TAIL);
  return `••••${trimmed.slice(-HINT_TAIL)}`;
}

/* -------------------------------------------------------------- seal and open */

/** Who a record belongs to, and what it is. Both are bound into the AAD. */
export type SecretRef = {
  /**
   * The owner digest from `sessionOwnerTag()` — a keyed HMAC of the identity,
   * never a raw session id and never a raw Clerk user id. Callers pass the tag;
   * this module never sees an identity.
   */
  owner: string;
  provider: string;
};

/**
 * The additional authenticated data for one layer of one record.
 *
 * Built from the *requested* owner and provider, which is the entire mechanism
 * behind rule 2: there is no path by which a value read from the record itself can
 * influence what the AAD says. Moving a record between accounts, or between
 * providers within an account, therefore breaks authentication rather than
 * decrypting successfully for the wrong owner. The version number is in the string
 * so a future record format cannot be authenticated as this one.
 */
function aad(prefix: string, ref: SecretRef): Buffer {
  return Buffer.from(`${prefix}|1|${ref.owner}|${ref.provider}`, 'utf8');
}

function dataAad(
  ref: SecretRef,
  record: Pick<SealedSecret, 'v' | 'hint' | 'length' | 'createdAt' | 'updatedAt'>,
): Buffer {
  const base = aad(AAD_DATA, ref);
  return record.v === 1
    ? base
    : Buffer.concat([
        base,
        Buffer.from(
          JSON.stringify([2, record.hint, record.length, record.createdAt, record.updatedAt]),
        ),
      ]);
}

function assertOwner(owner: string): void {
  if (!OWNER_RE.test(owner)) {
    // The owner digest is base64url out of `sessionOwnerTag`, so anything else is
    // a caller bug. Refused rather than sanitised: this value names a file, and a
    // store that quietly accepts `../` is one filesystem write from being a
    // different program.
    throw new SecretsError('rejected', 'that is not an owner digest');
  }
}

function assertRef(ref: SecretRef): void {
  assertOwner(ref.owner);
  if (!/^[a-z0-9-]{1,32}$/.test(ref.provider)) {
    throw new SecretsError('rejected', 'that is not a provider id');
  }
}

function encrypt(key: Buffer, plaintext: Buffer, additional: Buffer) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(CIPHER, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(additional);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ct: ct.toString('base64'),
  };
}

function decrypt(key: Buffer, blob: z.infer<typeof BlobSchema>, additional: Buffer): Buffer {
  const iv = Buffer.from(blob.iv, 'base64');
  const tag = Buffer.from(blob.tag, 'base64');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    // A wrong-length IV or tag is rejected here rather than by `createDecipheriv`,
    // which throws a different error for each case and would let a caller
    // distinguish "malformed" from "does not authenticate". One answer for every
    // failure, as `verifySessionToken` does for a bad cookie.
    throw new SecretsError('tampered', 'this record could not be opened');
  }
  const decipher = createDecipheriv(CIPHER, key, iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(additional);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(Buffer.from(blob.ct, 'base64')), decipher.final()]);
  } catch {
    // GCM's `final()` is where authentication is checked. Nothing from the
    // underlying error is forwarded: it says nothing useful and the plaintext
    // buffer is in scope at this point.
    throw new SecretsError('tampered', 'this record could not be opened');
  }
}

/**
 * Seal a credential for one owner and one provider.
 *
 * `previous` carries the timestamps forward when a key is being replaced, so
 * "stored since" survives a re-paste while `updatedAt` moves. Everything
 * cryptographic is regenerated: a new data key, and a new IV for each layer. IVs
 * are never reused across writes, which is the one mistake that turns AES-GCM from
 * an AEAD into a stream cipher with a published keystream.
 */
export function sealSecret(
  key: string,
  ref: SecretRef,
  env: NodeJS.ProcessEnv = process.env,
  previous?: SealedSecret,
): SealedSecret {
  assertRef(ref);
  const plaintext = key.trim();
  if (/[\s\x00-\x1f\x7f]/.test(plaintext))
    throw new SecretsError('rejected', 'the key contains whitespace or control characters');
  if (plaintext === '') throw new SecretsError('rejected', 'there is no key to store');
  if (plaintext.length > MAX_SECRET_CHARS) {
    throw new SecretsError('rejected', 'that is far too long to be a key');
  }

  const master = derived(requireSecretKey(env), INFO_MASTER);
  const dataKey = randomBytes(DATA_KEY_BYTES);
  const now = new Date().toISOString();
  const metadata = {
    v: 2 as const,
    hint: secretHint(plaintext),
    length: plaintext.length,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
  try {
    return {
      ...metadata,
      provider: ref.provider,
      wrap: encrypt(master, dataKey, aad(AAD_WRAP, ref)),
      data: encrypt(dataKey, Buffer.from(plaintext, 'utf8'), dataAad(ref, metadata)),
      // A re-paste invalidates any previous verdict: the stored key is a different
      // key now, and carrying "validated yesterday" across a write would report a
      // check that was never run against this value.
    };
  } finally {
    // Not a security control on its own — the buffer may already have been copied
    // by the cipher — but it stops the data key being readable from this frame if
    // something later in the request captures it.
    dataKey.fill(0);
  }
}

/**
 * Unseal a credential. **The only function in this module that yields plaintext.**
 *
 * Throws `SecretsError('tampered')` for every failure that is not a caller bug:
 * an altered ciphertext, a swapped IV or tag, a record belonging to another owner,
 * a record belonging to another provider, and a record sealed under a different
 * master key are all one answer. There is nothing for a caller to learn from
 * telling those apart, and a store that distinguishes them is an oracle.
 */
export function openSecret(
  sealed: SealedSecret,
  ref: SecretRef,
  env: NodeJS.ProcessEnv = process.env,
): string {
  assertRef(ref);
  const master = derived(requireSecretKey(env), INFO_MASTER);
  const dataKey = decrypt(master, sealed.wrap, aad(AAD_WRAP, ref));
  try {
    if (dataKey.length !== DATA_KEY_BYTES) {
      throw new SecretsError('tampered', 'this record could not be opened');
    }
    return decrypt(dataKey, sealed.data, dataAad(ref, sealed)).toString('utf8');
  } finally {
    dataKey.fill(0);
  }
}

/* ----------------------------------------------------------------- the store */

/** Where account records live on this box. Read per call, never captured. */
export function secretsDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = (env[SECRETS_DIR_ENV] ?? '').trim();
  return configured === '' ? path.join(PROJECTS_DIR, SECRETS_DIRNAME) : path.resolve(configured);
}

/**
 * The file holding one account's records.
 *
 * Named by a digest of the owner digest rather than by the owner digest itself,
 * for two small reasons and one that matters. The small ones: the tag is base64url
 * and a future change to its length or padding would change what is a legal
 * filename, and a hashed name is fixed-width. The one that matters: this path is
 * built from a value that arrived over the network as a cookie, and a hex digest
 * cannot contain a separator, a dot or a null no matter what the input was.
 * `assertRef` already refuses anything that is not a plausible tag; this makes the
 * traversal question unanswerable rather than merely answered.
 *
 * The derivation is keyed by the master key, so a directory listing cannot be
 * joined against the `ownerSession` tags in `meta.json` by anyone who has the
 * volume but not the environment. Rotating the master key therefore renames these
 * files — a rotation tool must move them, and that is written down here because it
 * is the kind of thing that is discovered the hard way.
 */
function ownerFile(owner: string, env: NodeJS.ProcessEnv): string {
  const name = createHash('sha256')
    .update(derived(requireSecretKey(env), INFO_FILENAME))
    .update('|')
    .update(owner)
    .digest('hex');
  return path.join(secretsDir(env), `${name}.json`);
}

/**
 * A fresh empty file, and a function rather than a constant.
 *
 * A shared `const EMPTY = { v: 1, keys: {} }` would be a cross-account leak with
 * no cipher involved: `writeOwnerSecret` reads, assigns into `file.keys`, and
 * writes — so one save against an absent or damaged file would mutate the shared
 * object, and the next account whose file was absent would read back a record it
 * never stored. Nothing here is hot enough to want the allocation saved.
 */
function empty(): SecretsFile {
  return { v: 1, keys: {} };
}

/**
 * Where an account's sealed records live on a Blob-storage (stateless) deployment:
 * `<prefix>/account-keys/<same digest-derived name as on disk>`, in the private
 * store. A Function's filesystem does not outlive its instance, so the disk path
 * would accept a key and lose it. What is stored is exactly the on-disk document —
 * envelope-sealed records that open only with `INKCAST_SECRET_KEY` and the owner —
 * so the trust argument above is unchanged; only the medium is.
 */
function ownerBlob(owner: string, env: NodeJS.ProcessEnv): string {
  return `${blobPrefix(env)}/account-keys/${path.basename(ownerFile(owner, env))}`;
}

async function readOwnerText(owner: string, env: NodeJS.ProcessEnv): Promise<string> {
  if (!blobStorageEnabled(env)) return readFile(ownerFile(owner, env), 'utf8');
  const found = await readJson(ownerBlob(owner, env));
  if (!found) throw Object.assign(new Error('absent'), { code: 'ENOENT' });
  return JSON.stringify(found.value);
}

async function readFileFor(owner: string, env: NodeJS.ProcessEnv): Promise<SecretsFile> {
  let text: string;
  try {
    text = await readOwnerText(owner, env);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return empty();
    throw new SecretsError(
      'tampered',
      'The account key store cannot be read. Contact the server operator.',
    );
  }
  try {
    const file = FileSchema.parse(JSON.parse(text));
    if (Object.entries(file.keys).some(([id, record]) => id !== record.provider)) throw new Error();
    return file;
  } catch {
    throw new SecretsError(
      'tampered',
      'The account key store is damaged. Contact the server operator; no keys were overwritten.',
    );
  }
}

/**
 * Serialise writes per account.
 *
 * Two providers saved at once would otherwise be a read-modify-write race over one
 * file, and the loser's key would vanish with a 200 — the same lost-update shape
 * `projects/index.json` had (PLAN-LAUNCH D4). A promise chain per owner is enough
 * for the single-process filesystem deployment. Blob deployments instead use
 * `mutateOwner` and conditional writes across instances.
 */
const writes = new Map<string, Promise<unknown>>();

function serialised<T>(owner: string, work: () => Promise<T>): Promise<T> {
  const previous = writes.get(owner) ?? Promise.resolve();
  const next = previous.then(work, work);
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  writes.set(owner, settled);
  void settled.then(() => {
    if (writes.get(owner) === settled) writes.delete(owner);
  });
  return next;
}

async function writeFileFor(
  owner: string,
  file: SecretsFile,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  if (blobStorageEnabled(env)) {
    throw new Error('Blob credential writes require a conditional update');
  }
  const target = ownerFile(owner, env);
  const dir = path.dirname(target);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  // `mode` on `mkdir` is masked by the process umask, and a directory of sealed
  // credentials that is group-readable because of a container's umask is worth two
  // lines to prevent. Same reasoning as `session.ts` chmod-ing `.session-secret`.
  await chmod(dir, 0o700);
  // A `*`-only .gitignore, exactly as `@inkcast/keyvault` writes beside its vault.
  // The default location is inside `projects/`, which the repo already ignores by
  // an anchored rule — but this directory can be moved with INKCAST_SECRETS_DIR,
  // and the one place it must never end up is tracked.
  await writeFile(path.join(dir, '.gitignore'), '*\n', { mode: 0o600 }).catch(() => undefined);

  // Temp file then rename, so a crash mid-write leaves the previous file intact
  // rather than a truncated one. The temp name is random so two writers cannot
  // collide on it even though `serialised` already stops them from trying.
  const temp = `${target}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await chmod(temp, 0o600);
    await rename(temp, target);
  } catch (err) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw err;
  }
}

/** Disk uses the local mutex; Blob retries the entire mutation on ETag conflict. */
async function mutateOwner<T>(
  owner: string,
  env: NodeJS.ProcessEnv,
  mutate: (file: SecretsFile) => T,
): Promise<T> {
  if (blobStorageEnabled(env)) {
    return updateJson(ownerBlob(owner, env), (current) => {
      let file: SecretsFile;
      try {
        file = current === undefined ? empty() : FileSchema.parse(current);
        if (Object.entries(file.keys).some(([id, record]) => id !== record.provider))
          throw new Error();
      } catch {
        throw new SecretsError(
          'tampered',
          'The account key store is damaged; no keys were overwritten.',
        );
      }
      const result = mutate(file);
      return { value: file, result };
    });
  }
  return serialised(ownerFile(owner, env), async () => {
    const file = await readFileFor(owner, env);
    const result = mutate(file);
    await writeFileFor(owner, file, env);
    return result;
  });
}

/** Every stored credential for one account, as summaries. Unseals nothing. */
export async function listOwnerSecrets(
  owner: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SecretSummary[]> {
  assertOwner(owner);
  const file = await readFileFor(owner, env);
  return Object.entries(file.keys)
    .filter(([provider, sealed]) => provider === sealed.provider)
    .map(([, sealed]) => summarise(sealed))
    .sort((a, b) => a.provider.localeCompare(b.provider));
}

/** One stored credential's summary, or undefined. Unseals nothing. */
export async function readOwnerSummary(
  ref: SecretRef,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SecretSummary | undefined> {
  assertRef(ref);
  const sealed = (await readFileFor(ref.owner, env)).keys[ref.provider];
  return sealed === undefined ? undefined : summarise(sealed);
}

/**
 * Store a credential for one account, replacing whatever was there.
 *
 * Returns the summary — never the key. The caller passes plaintext in and gets
 * metadata out, which is the shape that makes the routes above write-only by
 * construction rather than by discipline.
 */
export async function writeOwnerSecret(
  ref: SecretRef,
  key: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SecretSummary> {
  assertRef(ref);
  return mutateOwner(ref.owner, env, (file) => {
    const sealed = sealSecret(key, ref, env, file.keys[ref.provider]);
    file.keys[ref.provider] = sealed;
    return summarise(sealed);
  });
}

/** Remove one credential. False when there was nothing stored for that provider. */
export async function deleteOwnerSecret(
  ref: SecretRef,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  assertRef(ref);
  return mutateOwner(ref.owner, env, (file) => {
    if (file.keys[ref.provider] === undefined) return false;
    delete file.keys[ref.provider];
    return true;
  });
}

/** Record how a validation check went, so the page can show it later. */
export async function markOwnerSecretValidated(
  ref: SecretRef,
  ok: boolean,
  env: NodeJS.ProcessEnv = process.env,
  checkedKey?: string,
): Promise<void> {
  assertRef(ref);
  await mutateOwner(ref.owner, env, (file) => {
    const sealed = file.keys[ref.provider];
    if (sealed === undefined) return;
    if (checkedKey !== undefined && openSecret(sealed, ref, env) !== checkedKey) return;
    file.keys[ref.provider] = { ...sealed, validatedAt: new Date().toISOString(), validatedOk: ok };
  });
}

/**
 * The credential one account stored for one provider, in the clear.
 *
 * Used for status readability checks, validation and job admission. Jobs install
 * the result in an async credential scope, never in process.env. Callers must
 * neither retain plaintext globally nor include it in a response.
 *
 * `undefined` means nothing is stored. A stored record that will not open throws,
 * because that is a different fact with a different remedy: re-paste the key.
 */
export async function readOwnerKey(
  ref: SecretRef,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  assertRef(ref);
  const sealed = (await readFileFor(ref.owner, env)).keys[ref.provider];
  if (sealed === undefined) return undefined;
  return openSecret(sealed, ref, env);
}

/* ------------------------------------------------------------------ boot check */

/**
 * Fail at import on a hosted box with no master key.
 *
 * The same shape as `session.ts`'s trailing `requireSessionSecret()`, and the same
 * argument: a deployment that is missing the key that protects visitors' keys must
 * not serve the endpoints that accept them. Import-time rather than per-request so
 * the failure lands in the operator's logs at startup, next to the deploy that
 * caused it, instead of in one user's 500 an hour later.
 *
 * Local runs are untouched — `pnpm dev` never needs this variable, because the
 * local studio keeps its keys in `@inkcast/keyvault` and this store is only used
 * when `INKCAST_HOSTED=1`.
 */
if (hosted(process.env)) requireSecretKey();
