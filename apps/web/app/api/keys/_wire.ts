/**
 * The wire shape, and the two translations between `@inkcast/keyvault` and the
 * browser. No filesystem, no environment, no vault — so it is cheap to test and
 * cheap to audit, which for the redaction rule below is the point.
 *
 * `_store.ts` holds the stateful half. This holds the part that decides what a
 * user is told, which is where the mistakes that matter live: a status that omits
 * *why* a key is unusable, or a message that forwards a provider's raw error body
 * with the key still in it.
 */

import { redact, type KeyAvailability, type ProviderStatus } from '@inkcast/keyvault';

import type { ProviderId } from '@/components/settings/catalog';

/**
 * Where a configured key came from. `none` means the stage runs locally.
 *
 * `keychain` is what the package reports on macOS, which is the default there.
 */
export type KeySource = 'env' | 'vault' | 'keychain' | 'none';

/** Everything the browser is allowed to know about a key. No plaintext, ever. */
export type KeyStatus = {
  id: ProviderId;
  envVar: string;
  configured: boolean;
  source: KeySource;
  /** `sk-ant…9f2a`. Absent when nothing is stored or set. */
  mask?: string;
  /** Character count, so a truncated paste is visible. */
  length?: number;
  /** When it was stored. Only ever set for a stored key. */
  updatedAt?: string;
  /**
   * When this key was last checked against the provider, and how that went.
   *
   * Only the per-account store fills these in (see `_account.ts`): a hosted user
   * has no `inkcast keys check` to run and no vault sidecar to read, so the last
   * verdict is the only evidence they have that the key they pasted a month ago
   * still works. The local path leaves them absent, because `@inkcast/keyvault`
   * already surfaces its own `lastValidated` through the settings page.
   *
   * `validatedOk` is a verdict, never a claim about right now: a key that
   * authenticated on Tuesday can be revoked on Wednesday, so the UI must read
   * this as "last we heard", which is what the timestamp is for.
   */
  validatedAt?: string;
  validatedOk?: boolean;
  /**
   * A stored entry exists but cannot be used. Reported as *not* configured,
   * because that is what the pipeline will experience — with the reason attached
   * so the remedy is obvious.
   */
  unreadable?: boolean;
  /** Set when `unreadable` is a missing passphrase rather than a damaged entry. */
  locked?: boolean;
  /**
   * A key is stored *and* set in the environment. The environment wins, so the
   * stored one is inert — worth saying out loud, because otherwise editing the
   * stored entry appears to do nothing.
   */
  shadowedByEnv?: boolean;
};

/** Availabilities that mean "there is an entry, and it is no use to anyone". */
const UNUSABLE: readonly KeyAvailability[] = ['locked', 'unreadable'];

/**
 * Narrow the package's `ProviderStatus` to what the page can use.
 *
 * Optional fields are omitted rather than sent as null, because the client parser
 * treats absence as "unknown" and would otherwise have to special-case null at
 * every site.
 */
export function toWire(status: ProviderStatus): KeyStatus {
  return {
    id: status.provider as ProviderId,
    envVar: status.envVar,
    configured: status.configured,
    source: status.source ?? 'none',
    ...(status.masked ? { mask: status.masked } : {}),
    ...(status.length === null ? {} : { length: status.length }),
    ...(status.updatedAt === null ? {} : { updatedAt: status.updatedAt }),
    ...(UNUSABLE.includes(status.availability) ? { unreadable: true as const } : {}),
    ...(status.availability === 'locked' ? { locked: true as const } : {}),
    ...(status.shadowedByEnv ? { shadowedByEnv: true as const } : {}),
  };
}

/* ------------------------------------------------------------------ redaction */

const REDACTED = '[redacted]';
const MAX_MESSAGE_CHARS = 400;
/**
 * Below this a "secret" is likelier to be a substring of ordinary prose than a
 * credential, and blanket-replacing it would corrupt the text.
 */
const MIN_SECRET_CHARS = 8;

/**
 * Make a string safe to return to a browser or write to a log.
 *
 * Two passes, because either alone is insufficient. The explicit `secrets` pass
 * removes the key we *are* holding, which is the only reliable defence when a
 * provider echoes back the key we sent it. `redact()` then removes anything
 * *shaped* like a credential, which catches a leak of some other key entirely.
 *
 * The secrets are passed per call rather than through the package's
 * `trackSecret()` on purpose: a key that arrived in a request body and was never
 * saved should not join a process-wide table for the lifetime of the server.
 *
 * Every string that leaves the keys routes goes through this, including the ones
 * that "obviously" cannot contain a key. That is the point — the routes stay safe
 * without anyone having to reason about each message individually.
 */
export function scrub(message: string, secrets: readonly string[] = []): string {
  let out = message;
  for (const secret of secrets) {
    const value = secret.trim();
    if (value.length < MIN_SECRET_CHARS) continue;
    out = out.split(value).join(REDACTED);
  }
  out = redact(out);
  return out.length > MAX_MESSAGE_CHARS ? `${out.slice(0, MAX_MESSAGE_CHARS)}…` : out;
}

/* ----------------------------------------------------------------- validation */

export type ValidationStatus = 'valid' | 'invalid' | 'unknown';

export type ValidationResult = {
  status: ValidationStatus;
  /** One sentence for the user. Already scrubbed. */
  message: string;
  /** What the provider told us, when it told us anything. */
  detail?: string;
  /** HTTP status, when we got one. Useful in a bug report. */
  httpStatus?: number;
};

/** The machine verdict `probeKey()` returns, narrowed to what this needs. */
type Probed = {
  reason: string;
  status?: number;
  message?: string;
};

/**
 * Turn a probe result into a sentence a person can act on.
 *
 * The package returns a machine verdict plus the provider's raw body, which is the
 * right shape for a CLI and the wrong one here: `{"type":"error",…}` tells a user
 * nothing about what to do next. So the reason is mapped to curated prose and the
 * raw body is demoted to `detail`, where it stays available for a bug report
 * without being the headline.
 *
 * Three outcomes, not two, because "the request failed" has two causes that need
 * opposite responses. Collapsing `unknown` into `invalid` would tell someone on a
 * train that their perfectly good key is wrong, and they would delete it.
 */
export function describeProbe(probed: Probed, label: string, secret: string): ValidationResult {
  const detail = probed.message === undefined ? undefined : scrub(probed.message, [secret]);
  const out = (status: ValidationStatus, message: string): ValidationResult => ({
    status,
    message,
    ...(detail === undefined ? {} : { detail }),
    ...(probed.status === undefined ? {} : { httpStatus: probed.status }),
  });

  switch (probed.reason) {
    case 'accepted':
      return out('valid', `${label} accepted the key.`);
    case 'rate-limited':
      // The request got past authentication to a quota check, so the key is good.
      // "Invalid" would be wrong here and "unknown" would be timid.
      return out(
        'valid',
        `${label} accepted the key, but this account is being rate-limited right now.`,
      );
    case 'rejected':
      return out(
        'invalid',
        `${label} rejected the key. Copy it again from the dashboard — a key is only shown once, and a truncated paste fails exactly like this.`,
      );
    case 'forbidden':
      return out(
        'invalid',
        `${label} recognised the key but refused the request, so the key is real and lacks the permission this needs. Check its scopes, and that the account is in good standing.`,
      );
    case 'server-error':
      return out(
        'unknown',
        `${label} is having trouble at their end, so the key could not be checked. That says nothing about the key — it is saved and will be used.`,
      );
    case 'network':
      return out(
        'unknown',
        `Could not reach ${label} from this machine, so the key could not be checked. It is saved and will be used.`,
      );
    case 'not-configured':
      return { status: 'unknown', message: `No ${label} key is configured.` };
    default:
      return out(
        'unknown',
        `${label} answered in a way this check does not recognise, which is neither an acceptance nor a rejection. The key is saved and will be used.`,
      );
  }
}
