import { clerkConfigured } from '../_lib/clerk';
/**
 * The hosted half of `/api/keys`: whose key is this, and what may they do with it.
 *
 * `_store.ts` is the local half and stays untouched — it is `@inkcast/keyvault`,
 * the macOS keychain, the one operator at the machine. This file is the other
 * deployment: many owners on one box, each bringing their own provider keys, each
 * able to see and change exactly their own. The two never share a code path. On a
 * hosted box the routes above do not so much as *import* `_store.ts` (they load it
 * lazily inside the local branch), so there is no reachable sequence of calls from
 * a stranger's request to the operator's keychain — which is the failure
 * `offOnHostedBox` was written to prevent and which this file has to keep
 * preventing now that these endpoints are live on the hosted box.
 *
 * ## Identity comes from one place
 *
 * `app/api/_lib/session.ts` is the single identity chokepoint for the whole API,
 * and this file consumes it rather than re-deriving anything. Two consequences
 * worth stating:
 *
 *  - **The owner is a keyed digest, never an identity.** `sessionOwnerTag()` HMACs
 *    the session id under its own domain, and that digest is what
 *    `app/api/_lib/secrets.ts` binds a record to. So a Clerk user id is stored the
 *    same way `meta.json` stores it — as an opaque tag — and a raw user id never
 *    reaches disk, for free, because the tag is a function of whatever string the
 *    session carries.
 *  - **Signed-out means refused when Clerk is configured.** If the deployment has
 *    Clerk keys, an anonymous cookie is not an account and must not become one:
 *    keys stored against a cookie that a browser can clear (or that a shared
 *    machine hands to the next person) are keys attached to nothing. Where Clerk
 *    is *not* configured — a self-hoster, `pnpm dev` with `INKCAST_HOSTED=1` — the
 *    signed HMAC cookie is the identity the whole rest of the app already scopes
 *    projects by, and it scopes keys the same way. That fallback is not a
 *    convenience; a mandatory third-party login is what `docs/CONTRACT.md`'s
 *    zero-network rule and the AGPL pitch both forbid.
 *
 * ## Nothing here decides who you are
 *
 * `resolveIdentity()` in `_lib/session.ts` is the whole of it: Clerk when
 * configured, the signed anonymous cookie when not, a 401 when configured and
 * signed out, and a 401 rather than a downgrade when Clerk itself is broken. This
 * file adds no second opinion — no env sniffing, no `clerk:` prefix test, no
 * "well, if there is a cookie". A key store that reached its own conclusion about
 * identity would be a second authorization surface, and this repository's
 * recurring defect is two catalogues of one fact (see `offOnHostedBox`, written
 * after `/settings` and `/api/keys` disagreed about whether the vault existed).
 * The only thing taken from that module's answer is the owner tag.
 */

import { installRedaction, probeKey, type Provider } from '@inkcast/keyvault';

import { fail } from '../_lib/http';
import { ownerTagFor, resolveIdentity, setSessionCookie } from '../_lib/session';
import type { IdentityOptions, Session, SessionCookie } from '../_lib/session';
import {
  deleteOwnerSecret,
  listOwnerSecrets,
  markOwnerSecretValidated,
  readOwnerKey,
  readOwnerSummary,
  secretsConfigured,
  secretHint,
  writeOwnerSecret,
  type SecretSummary,
} from '../_lib/secrets';
import { PROVIDER_IDS, providerInfo, type ProviderId } from '@/components/settings/catalog';
import { describeProbe, type KeyStatus, type ValidationResult } from './_wire.js';

/**
 * Installed here as well as in `_store.ts`, because on a hosted box `_store.ts` is
 * never imported and this is the module the keys routes do load. It patches the
 * process's stdout and stderr, so it catches `console.*`, `@inkcast/core`'s logger
 * and Node's own uncaught-exception reporter — one hook, end to end. A key printed
 * before the first request would already be out, so it goes at module load rather
 * than in a handler.
 */
installRedaction();

/* ------------------------------------------------------------------- identity */

/** An account, reduced to the one string the credential store is allowed to see. */
export type AccountOwner = {
  /** `ownerTagFor(session)` — a keyed digest of the identity, not the identity. */
  tag: string;
  /** Carried so a route can attach a first-visit cookie. See `withAccountCookie`. */
  session: Session;
  /** True for a Clerk account, false for an anonymous cookie on a Clerk-less box. */
  signedIn: boolean;
};

export type OwnerRefusal = { ok: false; response: ReturnType<typeof fail> };
export type OwnerResult = { ok: true; owner: AccountOwner } | OwnerRefusal;

/**
 * Who is asking, or the refusal to send back.
 *
 * Order matters. Configuration is checked before identity, so a box that cannot
 * encrypt says so instead of interrogating the caller and then failing anyway;
 * identity is checked before anything reads the filesystem or parses a body, so an
 * unauthenticated request never causes a disk touch or gets a key parsed out of it.
 *
 * `options` exists only so a test can drive the Clerk branch — `auth()` reads
 * Next's request context and cannot be reached from `node --test` — and is passed
 * straight through to `resolveIdentity`. See `IdentityOptions` there.
 */
export async function accountOwner(
  request: { headers: Headers },
  env: NodeJS.ProcessEnv = process.env,
  options: IdentityOptions = {},
): Promise<OwnerResult> {
  if (
    (env.CLERK_SECRET_KEY?.trim() || env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim()) &&
    !clerkConfigured(env)
  ) {
    return {
      ok: false,
      response: fail(
        503,
        'Account authentication is not fully configured. No keys can be accessed.',
      ),
    };
  }
  if (!secretsConfigured(env)) {
    // Unreachable on a correctly booted hosted box — `_lib/secrets.ts` refuses to
    // finish importing without a master key — and answered rather than thrown
    // anyway, because the one thing this must never do is accept a credential it
    // cannot encrypt. 503: the request is fine, the deployment is not.
    return {
      ok: false,
      response: fail(
        503,
        'This deployment is not configured to store API keys yet. Nothing was saved.',
      ),
    };
  }

  const who = await resolveIdentity(request, env, options);
  if (!who.ok) {
    // 401 and not the vault's 404. `offOnHostedBox` hides an endpoint whose very
    // existence is the operator's business; this endpoint plainly exists for
    // everyone, and hiding it would only confuse the person who is one sign-in
    // away from using it. The refusal's own sentence is replaced because
    // "sign in to continue" belongs to a generic 401 and this one can say what
    // for — while the *status* comes from the identity module, not from here.
    return {
      ok: false,
      response: fail(who.status, 'Sign in to add, check or remove your API keys.'),
    };
  }

  return {
    ok: true,
    owner: {
      tag: ownerTagFor(who.session, env),
      session: who.session,
      signedIn: who.via === 'user',
    },
  };
}

/**
 * Attach the session cookie when this is the browser's first request.
 *
 * Only ever a no-op or a `Set-Cookie`: `setSessionCookie` checks `session.fresh`
 * itself, so a Clerk-identified caller (or a returning cookie) passes straight
 * through. It matters on the Clerk-less hosted box, where the anonymous cookie
 * *is* the account: a key stored against a freshly minted session whose cookie was
 * never sent back is a key filed under an identity the browser can never present
 * again — silent, permanent, and indistinguishable from the store losing it.
 */
type CookieSink = { cookies: { set: (cookie: SessionCookie) => unknown } };

export function withAccountCookie<R extends CookieSink>(response: R, owner: AccountOwner): R {
  return setSessionCookie(response, owner.session);
}

/* --------------------------------------------------------------------- status */

/**
 * Every provider's status for one account. Masks and timestamps only.
 *
 * All providers are always listed, configured or not, because the settings
 * page renders a row per provider and a missing row reads as a broken page rather
 * than as an unset key. `source: 'vault'` for a stored key: the client's parser
 * accepts `env | vault | keychain` and this genuinely is an encrypted file, which
 * makes it the honest member of that set — `keychain` would be a lie on Linux and
 * `env` would claim the operator supplied it.
 *
 * Stored credentials are opened only to verify readability and authenticate the
 * display metadata. Plaintext never joins the returned status object.
 */
export async function accountKeyStatuses(
  owner: AccountOwner,
  env: NodeJS.ProcessEnv = process.env,
): Promise<KeyStatus[]> {
  const stored = new Map<string, SecretSummary>(
    (await listOwnerSecrets(owner.tag, env)).map((entry) => [entry.provider, entry]),
  );
  return Promise.all(
    PROVIDER_IDS.map(async (id) => {
      const status = toAccountWire(id, stored.get(id));
      if (status.configured) {
        const read = await accountKeyPlaintext(owner, id, env);
        if (!read.ok)
          return {
            id,
            envVar: status.envVar,
            source: status.source,
            configured: false,
            unreadable: true,
          };
        return { ...status, mask: secretHint(read.key), length: read.key.length };
      }
      return status;
    }),
  );
}

function toAccountWire(id: ProviderId, stored: SecretSummary | undefined): KeyStatus {
  const info = providerInfo(id);
  if (stored === undefined) {
    return { id, envVar: info.envVar, configured: false, source: 'none' };
  }
  return {
    id,
    envVar: info.envVar,
    configured: true,
    source: 'vault',
    mask: stored.hint,
    length: stored.length,
    updatedAt: stored.updatedAt,
    // Omitted rather than sent as null when a key has never been checked: the
    // client parser treats absence as "unknown" and would otherwise have to
    // special-case two empty values at every site. Same rule as `toWire`.
    ...(stored.validatedAt === undefined ? {} : { validatedAt: stored.validatedAt }),
    ...(stored.validatedOk === undefined ? {} : { validatedOk: stored.validatedOk }),
  };
}

/**
 * What protects an account's keys, in the shape the settings page already parses.
 *
 * `path` is null on purpose, and not because there is no file. On a shared box an
 * absolute filesystem path is a free map of the container for anyone probing the
 * other end of `/api/media/<id>/<path…>`; `GET /api/providers` redacts
 * `projectsDir` on the hosted box for exactly that reason. `kdf` is null because
 * there is no passphrase and no scrypt here: the key comes from the environment,
 * and describing a KDF that is not running would be worse than describing none.
 */
export type AccountVaultInfo = {
  scope: 'account';
  backend: 'vault';
  ready: boolean;
  why: string;
  path: null;
  cipher: string;
  kdf: null;
  metaPath: null;
  legacyPath: null;
};

export function accountVaultInfo(): AccountVaultInfo {
  return {
    scope: 'account',
    backend: 'vault',
    ready: true,
    why: 'Keys are encrypted at rest on this server and scoped to your account. Inkcast decrypts them to call your selected providers. Server operators with access to the encryption secret can also decrypt them. Only masked previews are returned to your browser.',
    path: null,
    cipher: 'AES-256-GCM (envelope: a random data key per record, sealed under the server key)',
    kdf: null,
    metaPath: null,
    legacyPath: null,
  };
}

/* ------------------------------------------------------------------ mutation */

/** Store a key for this account. Returns the masked status — never the key. */
export async function saveAccountKey(
  owner: AccountOwner,
  provider: ProviderId,
  key: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<KeyStatus> {
  const summary = await writeOwnerSecret({ owner: owner.tag, provider }, key, env);
  return toAccountWire(provider, summary);
}

export type AccountDeleteOutcome = { removed: boolean; status: KeyStatus };

export async function deleteAccountKey(
  owner: AccountOwner,
  provider: ProviderId,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AccountDeleteOutcome> {
  const removed = await deleteOwnerSecret({ owner: owner.tag, provider }, env);
  return {
    removed,
    status: toAccountWire(provider, await readOwnerSummary({ owner: owner.tag, provider }, env)),
  };
}

/**
 * The account's stored key, for the one caller that needs plaintext.
 *
 * Kept as its own named function rather than letting a route reach into
 * `_lib/secrets.ts`, so that `grep -n accountKeyPlaintext apps/web` lists every
 * place on the hosted path where a credential is in scope. Today that is one
 * the validate route. Job admission separately resolves credentials in lib/keys.ts.
 *
 * The result shape mirrors `_store.ts`'s `effectiveKey` deliberately, because the
 * two failures need opposite words. `missing` means nothing was stored: paste one.
 * `unreadable` means a record exists and will not open — the realistic cause is a
 * master key that was rotated without re-wrapping, and the remedy is to paste the
 * key again, not to wonder why the page says "not configured" about an entry it can
 * see. Returned rather than thrown so the route answers with a sentence instead of
 * a 500.
 */
export type AccountKeyRead =
  { ok: true; key: string } | { ok: false; reason: 'missing' | 'unreadable' };

export async function accountKeyPlaintext(
  owner: AccountOwner,
  provider: ProviderId,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AccountKeyRead> {
  let key: string | undefined;
  try {
    key = await readOwnerKey({ owner: owner.tag, provider }, env);
  } catch {
    // Deliberately not distinguished further and deliberately not logged. Every
    // failure `openSecret` reports is the same answer to a user, and the error is
    // thrown from a frame where a plaintext buffer was live.
    return { ok: false, reason: 'unreadable' };
  }
  return key === undefined ? { ok: false, reason: 'missing' } : { ok: true, key };
}

/** Remember how a check went, so the page can show it without re-checking. */
export async function recordAccountValidation(
  owner: AccountOwner,
  provider: ProviderId,
  ok: boolean,
  env: NodeJS.ProcessEnv = process.env,
  checkedKey?: string,
): Promise<void> {
  await markOwnerSecretValidated({ owner: owner.tag, provider }, ok, env, checkedKey);
}

/* ---------------------------------------------------------------- validation */

/**
 * One outbound authenticated request to the provider, turned into a sentence.
 *
 * The probe is a parameter with a default rather than a direct call so that the
 * tests for this module stay offline. That is not tidiness: the repository's own
 * warning is that live provider keys sit in this machine's keychain and get
 * injected into `process.env`, so a unit test that reaches a provider is a unit
 * test that can spend money. The default is the real probe, so a route pays
 * nothing for the seam.
 *
 * This deliberately does not go through `_store.ts`'s `validateKey`: that module
 * opens the operator's vault, and nothing on the hosted path may load it.
 */
export type Probe = (
  provider: Provider,
  key: string,
) => Promise<{ reason: string; status?: number; message?: string }>;

export async function validateAccountKey(
  provider: ProviderId,
  key: string,
  probe: Probe = probeKey,
): Promise<ValidationResult> {
  const label = providerInfo(provider).label;
  const trimmed = key.trim();
  if (trimmed === '') return { status: 'unknown', message: 'There is no key to check.' };
  return describeProbe(await probe(provider as Provider, trimmed), label, trimmed);
}
