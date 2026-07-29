/**
 * One error type, and the rule that every message leaving this package is
 * redacted first.
 *
 * The dangerous failure mode is not a missing key — it is a keychain or HTTP
 * error whose text happens to quote the argument that caused it. Constructing
 * every error through `redact()` means a leak would have to survive both the
 * stream hook and this constructor.
 */
import { redact } from './redact.js';

export type KeyvaultErrorCode =
  /** No backend can hold a key: not darwin, and no passphrase available. */
  | 'no-backend'
  /** A passphrase is required for this operation and none could be resolved. */
  | 'passphrase-required'
  /** The passphrase did not decrypt the vault's verifier. */
  | 'bad-passphrase'
  /** The vault file was modified: AES-GCM authentication failed. */
  | 'tampered'
  /** The vault file is not a shape this version understands. */
  | 'corrupt-vault'
  /** The key is empty, or contains characters a backend cannot store. */
  | 'invalid-key'
  /** The `security` CLI failed for a reason other than "not found". */
  | 'keychain-failed'
  /** The vault path resolves inside a git working tree. */
  | 'vault-in-repo'
  /** Filesystem refused the read or write. */
  | 'io-failed';

export class KeyvaultError extends Error {
  readonly code: KeyvaultErrorCode;
  /** Remediation the caller can print verbatim. */
  readonly hint?: string;

  constructor(code: KeyvaultErrorCode, message: string, opts?: { hint?: string; cause?: unknown }) {
    super(redact(message), opts?.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'KeyvaultError';
    this.code = code;
    if (opts?.hint) this.hint = redact(opts.hint);
  }
}

/** True when `err` is ours and carries `code`. */
export function isKeyvaultError(err: unknown, code?: KeyvaultErrorCode): err is KeyvaultError {
  return err instanceof KeyvaultError && (code === undefined || err.code === code);
}
