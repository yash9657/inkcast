import { accountKeys } from './deployment';
/**
 * Sessions, accounts, and project ownership.
 *
 * On a laptop there are no accounts. Nobody signs up to watch a whiteboard video
 * get drawn, and asking them to would cost more users than it protects projects.
 * What a local studio actually needs is much smaller: a way to tell *this
 * browser* apart from every other browser, so that `/library` shows you your
 * films, `DELETE` deletes yours, and `/share/<id>` is public only once you said
 * so.
 *
 * So the default identity is a signed opaque id in a cookie, and that is all it
 * is. It proves continuity of a browser, nothing about a person.
 *
 * ## And then there is inkcast.video
 *
 * The hosted deployment does need to know who you are, because it renders on
 * somebody's hardware with somebody's API keys and a generation there is not
 * free. So when it is configured with a Clerk instance, identity comes from
 * Clerk instead, and a request with no signed-in user is refused rather than
 * handed an anonymous library.
 *
 * That is a *deployment* difference and it stops there. `docs/CONTRACT.md` §1
 * requires this to run with zero API keys and zero network, and the landing copy
 * sells precisely that ("no account, no key" —
 * `components/marketing/features.tsx`). A build that could not start without
 * reaching a login service would falsify both. So the switch is
 * `clerkConfigured()` in `./clerk.ts` — both Clerk variables present and
 * non-empty — and when it is false nothing in `@clerk/nextjs` is imported, let
 * alone called. `pnpm dev` on a machine with no Clerk account and no network
 * behaves exactly as it did before this paragraph existed.
 *
 * ## One function decides, and only one
 *
 * `resolveIdentity` is the switch, and it is the only thing in this file that
 * knows Clerk exists. Everything below it is untouched, because the ownership
 * machinery reads exactly one field of a `Session`: `id`. `requireOwner` compares
 * a digest of it, `ownedProjectsFilter` filters on a digest of it,
 * `requireViewable` asks `requireOwner`. Swapping where the id *comes from*
 * therefore costs nothing downstream, which is why this is an addition rather
 * than a rewrite — and why `readSession` is still here, still synchronous, still
 * the anonymous path, with its tests untouched.
 *
 * ## A user id is namespaced before it is digested
 *
 * A Clerk user id becomes the session id `clerk:user_2abc…`, and that colon is
 * doing cryptographic work. `meta.json` stores `sessionOwnerTag(id)` — a keyed
 * digest, never the id — so namespacing the id is what keeps a raw Clerk user id
 * off disk for free, and it is what makes the two identity spaces disjoint:
 * anonymous ids are base64url (`/^[A-Za-z0-9_-]{16,64}$/`, enforced in
 * `verifySessionToken`) and cannot contain a colon, so no anonymous session id
 * can ever spell the same HMAC message as a user id. That is the same
 * prefix-separation argument `SIGN_DOMAIN` and `OWNER_DOMAIN` rest on, applied
 * one level in.
 *
 * ## Projects that predate the sign-in
 *
 * Turning Clerk on does not migrate anything. A project written by an anonymous
 * browser carries `HMAC(OWNER_DOMAIN:<random id>)`; the same person signed in
 * carries `HMAC(OWNER_DOMAIN:clerk:<user id>)`; the tags do not match and are
 * not meant to. So on a box that switches, pre-existing projects drop out of
 * `/library`, refuse `DELETE`/`/edit`/`/rerender` with a 403, and remain
 * reachable through any share link already published. Saying that plainly is
 * half the requirement; the other half is a way out, and `cookieSession` is it —
 * see its docstring for the exact claim flow, which reuses `requireOwner` rather
 * than inventing a second ownership rule.
 *
 * This is a self-hoster's problem and not a launch-day one: `inkcast.video`
 * starts with an empty disk, so there is nothing there to orphan.
 *
 * ## Why a signature at all, when the id is already random
 *
 * Because without one the cookie is *client-supplied input that names a
 * partition of other people's data*. An unsigned session cookie can be edited to
 * any value, so a visitor who guesses or observes another session id — from a
 * log line, a screen share, a shared laptop — inherits that library. With an
 * HMAC, a session id is only usable by whoever was handed the matching
 * signature, and a forged one is indistinguishable from garbage: `readSession`
 * mints a *new* session rather than trusting it, which is also the behaviour a
 * first-time visitor gets, so tampering is not even interesting to do.
 *
 * The comparison is `timingSafeEqual` over fixed-length digests. A `===` on a
 * MAC is the textbook forgery oracle: it returns on the first differing byte, so
 * an attacker who can retry recovers the signature one byte at a time, and this
 * endpoint is one an attacker may hammer for free.
 *
 * ## Two different HMACs, deliberately
 *
 * The cookie carries `id.signature`, where the signature is keyed on the
 * `SIGN_DOMAIN` prefix. What `meta.json` records is a *different* keyed digest of
 * the same id, under `OWNER_DOMAIN` — the "owner tag" (see
 * `ProjectMetaSchema` in `lib/store.ts`, which explains why the raw id must
 * never be written to a project file: `/api/media/<id>/<path…>` will serve
 * `meta.json` to anybody holding a share link).
 *
 * The domain separation is the load-bearing part. If both used the same key and
 * message, the tag stored in `meta.json` *would be a valid cookie signature* for
 * its owner's id — and since the owner tag is readable by every viewer of a
 * shared project, publishing a film would hand away the session that made it.
 * With distinct prefixes, neither digest is a forgery of the other, and reading
 * an owner tag tells you only that two projects share an owner.
 *
 * ## Where the key comes from
 *
 * `INKCAST_SESSION_SECRET`, and when `INKCAST_HOSTED=1` that variable is
 * mandatory: this module throws on import if it is missing, which takes the
 * whole API down with a message naming the fix. That is the intended
 * blast radius. A hosted deployment that silently fell back to *any* known value
 * would sign every visitor's cookie with a key an attacker also has, and every
 * library on the box would be one forged cookie from being readable — a failure
 * nobody would notice, because everything keeps working. Better to not boot.
 *
 * Locally there is no such variable and demanding one would make `pnpm dev`
 * require a setup step, so the fallback is a key *generated* on first use and
 * kept in `projects/.session-secret` (gitignored, mode 0600). Generated, not
 * hardcoded: it is unique per checkout, and it persists across restarts because
 * the owner tags already written into `meta.json` must keep matching — an
 * ephemeral per-process key would make every project on disk look like a
 * stranger's after every restart, which is the same bug as losing them.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Also the environment bootstrap: importing `lib/store` is what guarantees the
// repo-root `.env` (where `INKCAST_SESSION_SECRET` and `INKCAST_HOSTED` are
// documented) has been read before the hosted check at the bottom of this file
// runs. ESM evaluates an imported module's body first, so the ordering is not a
// convention here, it is the language.
import { PROJECTS_DIR, readProjectTruth } from '@/lib/store';
import type { ProjectFilter, ProjectRecord } from '@/lib/store';

import { clerkConfigured } from './clerk';
import type { ClerkServerModule } from './clerk';

/* --------------------------------------------------------------- the secret */

/**
 * The two HMAC domains. Never reuse a key across two meanings; see the header.
 */
const SIGN_DOMAIN = 'inkcast.session.v1';
const OWNER_DOMAIN = 'inkcast.owner.v1';

/**
 * The prefix that turns a Clerk user id into a session id, and the reason it is
 * a constant rather than a string literal typed twice.
 *
 * It is a third domain separator, one level below the two above: the message fed
 * to the owner HMAC is `inkcast.owner.v1:clerk:user_2abc…` for an account and
 * `inkcast.owner.v1:<base64url>` for a browser. Those messages cannot collide,
 * because `verifySessionToken` only ever accepts an id matching
 * `/^[A-Za-z0-9_-]{16,64}$/` and a colon is not in that set — so there is no
 * anonymous cookie, forged or genuine, whose id can be read as a user id or vice
 * versa.
 *
 * It also means `sessionOwnerTag` needed no new parameter and no new domain, so
 * the one existing caller that derives a tag directly
 * (`app/api/generate/route.ts`, which stamps ownership on a project's first
 * upsert) keeps working for signed-in users without being edited. A second HMAC
 * domain would have been equally sound cryptographically and strictly worse
 * operationally: it would have made every existing `sessionOwnerTag(session.id)`
 * call site silently derive the *wrong* tag for an account, and the symptom
 * would have been an empty library rather than an error.
 */
const USER_ID_PREFIX = 'clerk:';

/**
 * Shortest secret a hosted deployment may sign with.
 *
 * A MAC key is only as good as its entropy, and a deployment that sets
 * `INKCAST_SESSION_SECRET=changeme` has authentication in name only — the
 * signature verifies, and anyone who guesses the passphrase mints cookies for
 * arbitrary sessions. 24 characters is not a security proof, it is the smallest
 * bar that a *human-typed* string cannot clear by accident, which is the failure
 * mode this catches.
 */
const MIN_SECRET_LENGTH = 24;

/** Filename of the generated local key, inside the (gitignored) projects dir. */
const SECRET_FILE = '.session-secret';

/**
 * `isHosted()` from `lib/store`, but taking the environment as an argument.
 *
 * The store's version reads `process.env` directly, which is right for the store
 * and wrong here: every exported function below accepts an `env` so a test can
 * exercise the hosted and local branches in one process without mutating global
 * state and hoping the module cache cooperates.
 */
function hosted(env: NodeJS.ProcessEnv): boolean {
  return env.INKCAST_HOSTED === '1';
}

/**
 * The configured secret, or a precise complaint about why there isn't one.
 *
 * Exported so a route (or the health check) can assert configuration without
 * signing anything, and so the failure is testable without arranging for a
 * module import to explode.
 */
export function requireSessionSecret(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.INKCAST_SESSION_SECRET;
  if (configured !== undefined && configured.trim() !== '') {
    if (configured.trim().length < MIN_SECRET_LENGTH) {
      throw new Error(
        `INKCAST_SESSION_SECRET is too short (${configured.trim().length} characters, minimum ${MIN_SECRET_LENGTH}). ` +
          'Generate one with: openssl rand -hex 32',
      );
    }
    return configured.trim();
  }
  if (hosted(env)) {
    // Loud on purpose. Imported at the bottom of this module, so a hosted box
    // missing this variable fails to serve the API at all rather than serving it
    // with forgeable cookies.
    throw new Error(
      [
        '',
        'INKCAST_SESSION_SECRET is not set, and INKCAST_HOSTED=1.',
        '',
        'Sessions are what scope /library, DELETE, /edit and /rerender to the browser',
        'that created a project. Without a secret they cannot be signed, and this',
        'deployment refuses to invent one: a fallback key would be a key every reader',
        'of this source also has.',
        '',
        'Fix: set INKCAST_SESSION_SECRET to a long random string, e.g.',
        '  INKCAST_SESSION_SECRET=$(openssl rand -hex 32)',
        '',
      ].join('\n'),
    );
  }
  return localSecret();
}

/**
 * Read — or create once — the generated local key.
 *
 * Synchronous by design: this runs at most once per process and every caller
 * (cookie signing, tag derivation) is on a request path that must not have to
 * `await` a key. Pinned to `globalThis` for the same reason the store pins its
 * roots: `next dev` re-evaluates this module on every edit, and a re-read that
 * produced a *different* key would invalidate every cookie and orphan every
 * project mid-session.
 */
const globalScope = globalThis as typeof globalThis & { __inkcastSessionSecret?: string };

function localSecret(): string {
  if (globalScope.__inkcastSessionSecret) return globalScope.__inkcastSessionSecret;
  const file = path.join(PROJECTS_DIR, SECRET_FILE);
  try {
    const existing = readFileSync(file, 'utf8').trim();
    if (existing.length >= MIN_SECRET_LENGTH) {
      return (globalScope.__inkcastSessionSecret = existing);
    }
  } catch {
    /* absent or unreadable — write a new one below */
  }
  const minted = randomBytes(32).toString('hex');
  try {
    mkdirSync(PROJECTS_DIR, { recursive: true });
    writeFileSync(file, `${minted}\n`, { mode: 0o600 });
    // `mode` on `writeFileSync` is ignored when the file already exists, and a
    // key that was once world-readable stays world-readable without this.
    chmodSync(file, 0o600);
  } catch {
    // A read-only projects directory is a strange but survivable state: keep the
    // key in memory for this process rather than refusing to serve. Cookies then
    // last until restart, which is a local-only inconvenience.
  }
  return (globalScope.__inkcastSessionSecret = minted);
}

/* -------------------------------------------------------------- the session */

/** Cookie name. Plain, because the value is opaque and says nothing about you. */
export const SESSION_COOKIE = 'inkcast_session';

/**
 * A year.
 *
 * The cookie is the *only* record that a browser owns its projects — there is no
 * account to recover them from — so a short expiry is not a security measure,
 * it is data loss on a timer. Long-lived and revocable by clearing cookies is
 * the honest trade for an anonymous session.
 */
export const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 365;

export type Session = {
  /**
   * The identity, as one opaque string. Either 128 bits of randomness in
   * base64url (an anonymous browser) or `clerk:<user id>` (an account). Nothing
   * downstream parses it: it is the input to `sessionOwnerTag` and nothing else.
   */
  id: string;
  /**
   * `id.signature` — exactly the string that belongs in the cookie — or the
   * empty string for an identity that is not carried by one. A Clerk session's
   * proof is Clerk's own cookie, so there is nothing for us to sign and nothing
   * to set; `fresh` is false on those, which already makes `setSessionCookie` a
   * no-op, and the emptiness is belt to that braces.
   */
  token: string;
  /**
   * True when this request did not arrive with a valid cookie, so the caller
   * must attach one to the response (`setSessionCookie`). False when the
   * browser already had a good cookie and re-sending it would be noise.
   */
  fresh: boolean;
  /**
   * Where this identity came from. Optional, and that is a compatibility
   * decision rather than an oversight: every constructor in this file sets it,
   * but making it required would break any hand-built `Session` literal
   * elsewhere in the tree for no gain, because nothing in the ownership path
   * reads it. It exists so a route that genuinely needs to say "signed-in users
   * only" can ask, instead of sniffing `id` for a prefix.
   */
  kind?: 'anon' | 'user';
};

/** Everything `NextResponse.cookies.set` needs, as a plain object. */
export type SessionCookie = {
  name: typeof SESSION_COOKIE;
  value: string;
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: '/';
  maxAge: number;
};

function sign(id: string, secret: string): string {
  return createHmac('sha256', secret).update(`${SIGN_DOMAIN}:${id}`).digest('base64url');
}

/** Mint a brand-new session. Always `fresh`, so its cookie gets sent. */
export function mintSession(env: NodeJS.ProcessEnv = process.env): Session {
  const secret = requireSessionSecret(env);
  const id = randomBytes(16).toString('base64url');
  return { id, token: `${id}.${sign(id, secret)}`, fresh: true, kind: 'anon' };
}

/**
 * The session for a signed-in Clerk user.
 *
 * `fresh: false` and an empty token, so no cookie is minted, set or sent. That
 * is what keeps this an addition rather than a migration: the ~20
 * `setSessionCookie(...)` call sites and the raw `sessionCookieHeader` in the SSE
 * route are all already gated on `session.fresh`, so an account produces exactly
 * the same responses it would have without this function existing, minus a
 * `Set-Cookie` that would have meant nothing.
 *
 * The id is namespaced (see `USER_ID_PREFIX`) before anything digests it, so a
 * raw Clerk user id never reaches `meta.json` and no user id can be spelled as an
 * anonymous session id.
 */
export function userSession(userId: string): Session {
  return { id: `${USER_ID_PREFIX}${userId}`, token: '', fresh: false, kind: 'user' };
}

/**
 * The session id carried by a token, or `undefined` when the token is not one we
 * signed.
 *
 * Every rejection path returns the same `undefined`: an unsigned value, a
 * tampered id, a truncated signature and a signature from a *previous* secret
 * are all simply "not ours". Distinguishing them in the return type would invite
 * a route to report which, and "your signature is invalid but your id was fine"
 * is a probing oracle.
 */
export function verifySessionToken(
  token: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (!token) return undefined;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return undefined;
  const id = token.slice(0, dot);
  const presented = token.slice(dot + 1);
  // Ids are base64url and contain no dot, so a second one means the value was
  // assembled by someone else.
  if (presented.includes('.')) return undefined;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) return undefined;

  // Compared as *text*, not as decoded bytes, and that is the one surprising
  // line in this file — so here is the measurement that put it there.
  //
  // The first version of this decoded both sides with `Buffer.from(…,
  // 'base64url')` and compared the 32 bytes, which looks obviously right and is
  // subtly wrong. A SHA-256 digest is 43 base64url characters, and 43 × 6 = 258
  // bits carrying 256 — so the final character's low two bits are slack that the
  // decoder simply discards. Four different final characters therefore decode to
  // the same digest (measured: a signature ending `k` also verifies spelled
  // `l`, `m` or `n`), which made the "a tampered signature is rejected" test
  // flake at 4/64 ≈ 6% — it flips the last character, and one flip in sixteen
  // lands inside the same equivalence class. That was caught by a test run, not
  // by reading this code, which is exactly why it is worth a paragraph.
  //
  // Accepting four spellings of a valid MAC is not itself a forgery — producing
  // any of them still needs the key. But a signature check with more than one
  // accepted answer is a check nobody can reason about, and the fix is smaller
  // than the caveat: compare against the canonical encoding. Both sides are
  // fixed-length ASCII, so this is also strictly less code than decoding, and
  // `Buffer.from`'s leniency on non-base64 input stops mattering — garbage is
  // just a string that differs.
  const expected = Buffer.from(sign(id, requireSessionSecret(env)), 'utf8');
  const actual = Buffer.from(presented, 'utf8');
  // A length check before `timingSafeEqual` because that function *throws* on
  // unequal lengths, and a thrown exception is both a crash and a side channel.
  // The length of a SHA-256 digest is public knowledge, so leaking it costs
  // nothing; the characters are compared in constant time.
  if (actual.length !== expected.length) return undefined;
  return timingSafeEqual(actual, expected) ? id : undefined;
}

/**
 * Read one cookie out of a `Cookie` header.
 *
 * Hand-rolled rather than `next/headers`, so that everything in this file is a
 * pure function of a standard `Request` and stays testable under plain
 * `node --test` — the same reason `ratelimit.ts` refuses to import `next/server`.
 */
function cookieValue(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    return part.slice(eq + 1).trim();
  }
  return undefined;
}

/**
 * The caller's session: the one their cookie proves, or a new one.
 *
 * Never throws for a bad cookie and never reports one. A tampered, expired-key
 * or absent cookie all produce a fresh session, which means the worst an
 * attacker achieves by editing theirs is to lose their own library.
 */
export function readSession(
  request: { headers: Headers },
  env: NodeJS.ProcessEnv = process.env,
): Session {
  return cookieSession(request, env) ?? mintSession(env);
}

/**
 * The anonymous session this request's cookie actually proves, or `undefined`.
 *
 * The same work `readSession` does, minus the minting — which is the difference
 * between "who is this" and "does this browser hold a cookie we issued". Two
 * callers want the second question.
 *
 * ## Claiming projects made before the sign-in
 *
 * A deployment that turns Clerk on strands the projects its visitors made
 * anonymously: the tags in `meta.json` are digests of a random cookie id and a
 * signed-in user digests to something else, so those projects leave `/library`
 * and refuse mutation (see this file's header). The cookie itself, though, is
 * still in the browser — `SESSION_MAX_AGE_SEC` is a year — so the proof of the
 * old identity is still being presented on every request. That is what makes a
 * claim possible without a migration script, a database, or a second notion of
 * ownership:
 *
 * ```ts
 * // POST /api/projects/:id/claim  — not written here; this file owns no routes.
 * const who = await resolveIdentity(request);
 * if (!who.ok) return fail(who.status, who.message);
 * const previous = cookieSession(request);
 * if (!previous) return fail(409, 'no earlier anonymous session on this browser');
 * const verdict = await requireOwner(id, previous);          // the same arbiter
 * if (!verdict.ok) return fail(verdict.status, verdict.message);
 * await upsertProject(id, { ownerSession: sessionOwnerTag(who.session.id) });
 * ```
 *
 * `requireOwner` is deliberately the one doing the deciding. A claim route that
 * compared tags itself would be a second authorization rule for the same fact,
 * and every time this repo has grown one of those — `/settings` hiding the BYOK
 * panel while `/api/keys` stayed open — the two have drifted apart in the
 * direction of the more permissive one.
 *
 * Note also what this cannot do: `previous` is whatever cookie the *browser*
 * sends, so a claim only ever transfers projects that browser could already
 * delete. Nothing here lets an account reach a project it did not already own
 * under its old identity.
 */
export function cookieSession(
  request: { headers: Headers },
  env: NodeJS.ProcessEnv = process.env,
): Session | undefined {
  const token = cookieValue(request.headers.get('cookie'), SESSION_COOKIE);
  const id = verifySessionToken(token, env);
  if (id === undefined) return undefined;
  return { id, token: token!, fresh: false, kind: 'anon' };
}

/**
 * The cookie for a session.
 *
 * `httpOnly` because no client script has any reason to read it and XSS should
 * not be able to exfiltrate a library. `sameSite: 'lax'` rather than `'strict'`
 * because a shared `/share/<id>` link followed from Slack is a top-level
 * cross-site navigation, and under `strict` the owner arriving that way would be
 * an anonymous stranger to their own project. `secure` only when hosted, because
 * a `Secure` cookie is dropped on `http://localhost` and the local studio would
 * silently re-mint a session on every request.
 *
 * Not named `__Host-…` despite that prefix being the stronger choice: the prefix
 * *requires* `Secure`, so a name that switched with the deployment would mean the
 * local and hosted code paths differ in the one place where a bug is invisible.
 */
export function sessionCookie(
  session: Session,
  env: NodeJS.ProcessEnv = process.env,
): SessionCookie {
  return {
    name: SESSION_COOKIE,
    value: session.token,
    httpOnly: true,
    sameSite: 'lax',
    secure: hosted(env),
    path: '/',
    maxAge: SESSION_MAX_AGE_SEC,
  };
}

/** The shape of the bit of `NextResponse` this needs, so tests can fake it. */
type CookieSink = { cookies: { set: (cookie: SessionCookie) => unknown } };

/**
 * Attach the session cookie to a response, if it needs attaching.
 *
 * Returns the response so a handler can `return setSessionCookie(json(…),
 * session)` in one line — the shortest form is the one that gets used, and a
 * response that forgets the cookie loses the project the request just created.
 * A non-fresh session is left alone: re-sending an identical cookie on every
 * response is bytes for nothing.
 */
export function setSessionCookie<R extends CookieSink>(
  response: R,
  session: Session,
  env: NodeJS.ProcessEnv = process.env,
): R {
  // `token !== ''` alongside `fresh` is redundant today and cheap insurance
  // tomorrow: the only sessions with an empty token are Clerk's and the
  // signed-out stranger's, and both are constructed `fresh: false`. If a future
  // constructor gets that wrong, the failure this guard prevents is a
  // `Set-Cookie: inkcast_session=` that *clears* the caller's real cookie — data
  // loss for an anonymous user, and invisible until their library empties.
  if (session.fresh && session.token !== '') response.cookies.set(sessionCookie(session, env));
  return response;
}

/**
 * `Set-Cookie` header value, for a response that is not a `NextResponse`.
 *
 * Streaming endpoints (`/api/generate/<id>/stream`) build a raw `Response`
 * around a `ReadableStream` and have no `cookies` helper to call.
 *
 * Unlike `setSessionCookie` this cannot decide for itself whether there is
 * anything to send, because its return value is a header string and there is no
 * "no header" to return. Every call site is therefore already inside an
 * `if (session.fresh)`, and must stay there: an account has no token to put in a
 * cookie, and emitting one anyway would clear whatever cookie the browser had.
 */
export function sessionCookieHeader(
  session: Session,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const c = sessionCookie(session, env);
  return [
    `${c.name}=${c.value}`,
    `Path=${c.path}`,
    `Max-Age=${c.maxAge}`,
    'HttpOnly',
    'SameSite=Lax',
    ...(c.secure ? ['Secure'] : []),
  ].join('; ');
}

/* -------------------------------------------------------------- the identity */

/**
 * Who is calling, as one value a route can act on without knowing which kind of
 * deployment it is running in.
 *
 * Shaped like `OwnerVerdict` on purpose — `ok`, and on refusal a `status` and the
 * sentence to show — because every call site is a route already written in that
 * idiom, so adopting this costs one line:
 *
 * ```ts
 * const who = await resolveIdentity(request);
 * if (!who.ok) return fail(who.status, who.message);
 * const session = who.session;            // and the rest of the handler is unchanged
 * ```
 *
 * The two `ok` variants both carry a `session`, so a handler that does not care
 * *how* the caller was identified never asks. `via` is there for the handlers
 * that legitimately do — a route that must not spend money for an anonymous
 * visitor, a settings page that only makes sense for an account.
 *
 * ## Why the refusal carries a session too
 *
 * `stranger` is what makes this usable by the routes that must never 401. Two of
 * them exist and both are load-bearing: `GET /api/projects/<id>`, which
 * `app/share/<id>/page.tsx` fetches server-side with no cookie forwarded, and
 * `GET /api/media/<id>/<path…>`, which is what a `<video>` element and every
 * range request behind it actually hit. If those refused a signed-out caller,
 * every share link on the internet would 404 — which is the most likely
 * accidental casualty of adding authentication to this app, so the shape of this
 * type is built to make the safe thing writable in one line:
 *
 * ```ts
 * const who = await resolveIdentity(request);
 * const session = who.ok ? who.session : who.stranger;   // public read path
 * ```
 *
 * A stranger is a freshly minted anonymous session marked `fresh: false`. Fresh
 * so that it matches nothing on disk and can therefore see only what has been
 * shared; not-fresh so that no cookie is set — handing a signed-out visitor on an
 * account-based deployment a durable anonymous identity would accumulate an
 * identity they can never sign into, and would quietly re-open the anonymous
 * ownership path on a box that had opted out of it.
 */
export type Identity =
  | { ok: true; session: Session; via: 'user'; userId: string }
  | { ok: true; session: Session; via: 'anonymous' }
  | {
      ok: false;
      status: 401;
      reason: 'sign-in-required';
      message: string;
      stranger: Session;
    };

/**
 * How `resolveIdentity` asks Clerk who is calling. Injectable for tests.
 *
 * This is the same reason every other export in this file takes an `env`: both
 * branches have to be exercisable in one `node --test` process. `auth()` reads
 * Next's async request context and only works once `clerkMiddleware` has run, so
 * there is no request one could construct that would drive the real thing from a
 * unit test — and a Clerk branch that is only ever exercised in production is a
 * Clerk branch nobody has checked.
 */
export type IdentityOptions = {
  readUserId?: () => Promise<string | null>;
};

/**
 * The one switch: Clerk when configured, the anonymous cookie when not.
 *
 * ## Configured, and signed out, is a refusal — not an anonymity
 *
 * The tempting third behaviour is to fall through to the cookie when Clerk finds
 * nobody, so that a signed-out visitor still gets a library. It is wrong in both
 * directions. Security first: on `inkcast.video` a generation costs real money,
 * and a fall-through means the sign-in requirement is satisfied by deleting a
 * cookie. But it is also wrong for the honest user, because it produces two
 * libraries per person — one attached to their account, one to their browser —
 * that are both real, neither complete, and swap places when they sign out.
 * Refusing is the only answer that is a single story.
 *
 * ## A broken Clerk is a refusal too
 *
 * If `auth()` throws — the package missing, `clerkMiddleware` not reached on this
 * path, Clerk's API unreachable — this refuses. It does not degrade to anonymous.
 * `docs/PLAN-LAUNCH.md` names silent degradation as this repo's dominant failure
 * mode, and the version of it available here is the worst one available anywhere:
 * an authentication check that becomes a no-op when a dependency fails. A 401 on
 * a broken box is a visible outage; a downgrade is an invisible one.
 *
 * Unconfigured, nothing above is reached and nothing in `@clerk/nextjs` is
 * imported: the whole Clerk branch is behind `clerkConfigured(env)`, and
 * `readSession` is called exactly as it was before. That property is asserted in
 * `session.test.ts` by passing a `readUserId` that records its calls and proving
 * the count stays zero.
 */
export async function resolveIdentity(
  request: { headers: Headers },
  env: NodeJS.ProcessEnv = process.env,
  options: IdentityOptions = {},
): Promise<Identity> {
  if (!clerkConfigured(env)) {
    return { ok: true, session: readSession(request, env), via: 'anonymous' };
  }

  let userId: string | null = null;
  try {
    const readUserId = options.readUserId ?? clerkUserId;
    userId = await readUserId();
  } catch {
    // Deliberately swallowed and deliberately not distinguished from signed-out.
    // The caller gets a 401 either way, and the operator gets the real diagnosis
    // from the unhandled-rejection-shaped stack Clerk itself logs plus
    // `/api/health`. Reporting "the identity provider is broken" to an anonymous
    // caller tells an attacker which failure they just induced.
    userId = null;
  }

  if (userId === null || userId === '') {
    return {
      ok: false,
      status: 401,
      reason: 'sign-in-required',
      message: 'sign in to continue',
      stranger: { ...mintSession(env), fresh: false },
    };
  }
  return { ok: true, session: userSession(userId), via: 'user', userId };
}

/**
 * Pinned to `globalThis` for the same reason the secret is: `next dev`
 * re-evaluates module bodies on every edit, and re-importing an SDK on each one
 * is pure waste. The *promise* is cached rather than the module, so two requests
 * arriving during a cold start share one import instead of racing two.
 */
const clerkScope = globalThis as typeof globalThis & {
  __inkcastClerkServer?: Promise<ClerkServerModule>;
};

/**
 * The real reader. Only ever called behind `clerkConfigured`, and lazily, which
 * is the property the whole self-hosting story rests on: on a checkout with no
 * Clerk account this line is never reached, so `@clerk/nextjs` is never
 * evaluated, cannot complain about a missing publishable key, and cannot open a
 * connection.
 *
 * A rejection here — the package absent, `clerkMiddleware` never reached on this
 * path, Clerk's API unreachable — propagates to `resolveIdentity`'s `catch` and
 * becomes a 401. Never a fallback to anonymous: see that function's docstring.
 */
async function clerkUserId(): Promise<string | null> {
  // No cast and no suppression: `ClerkServerModule` is built from `typeof auth`
  // and `typeof clerkMiddleware`, so this is checked against the SDK's own
  // declarations. See `./clerk.ts` for why it used to be a `@ts-ignore` and what
  // the install revealed about the hand-written shape it replaced.
  clerkScope.__inkcastClerkServer ??= import('@clerk/nextjs/server');
  const { auth } = await clerkScope.__inkcastClerkServer;
  const state = await auth();
  return state.userId;
}

/* ------------------------------------------------------------------ ownership */

/**
 * The value written to `meta.json`'s `ownerSession`: a keyed digest of the
 * session id under the owner domain, never the id itself.
 *
 * 32 bytes of HMAC-SHA256, base64url — the full digest rather than a truncation,
 * because the only cost of the extra 20 characters is one line of a small JSON
 * file and the only benefit of shortening it would be aesthetic.
 */
export function sessionOwnerTag(sessionId: string, env: NodeJS.ProcessEnv = process.env): string {
  return createHmac('sha256', requireSessionSecret(env))
    .update(`${OWNER_DOMAIN}:${sessionId}`)
    .digest('base64url');
}

/**
 * The owner tag for a whole `Session`, whichever kind it is.
 *
 * Today this is `sessionOwnerTag(session.id)` and nothing more, because a user id
 * is already namespaced into the id before it gets here (`USER_ID_PREFIX`) — so
 * the digests are separated without the derivation needing to branch. The
 * function exists anyway, and is what the code below calls, for a reason worth
 * one line: it is the single place that would have to change if a third identity
 * source ever arrives, and it names the right unit. `sessionOwnerTag` takes a
 * string, so nothing stops a caller passing the wrong one; this takes the
 * identity itself, which is the thing ownership is actually about.
 *
 * `sessionOwnerTag` stays exported and unchanged, both because its docstring's
 * warning still applies and because `app/api/generate/route.ts` calls it directly
 * when it stamps ownership on a new project. That call remains correct for
 * accounts as well as browsers, which was the design constraint.
 */
export function ownerTagFor(session: Session, env: NodeJS.ProcessEnv = process.env): string {
  return sessionOwnerTag(session.id, env);
}

/**
 * Verdicts carry the HTTP status and the sentence to show, because every call
 * site is a route that needs exactly those two things:
 *
 * ```ts
 * const verdict = await requireOwner(id, session);
 * if (!verdict.ok) return fail(verdict.status, verdict.message);
 * ```
 *
 * `reason` is there for the cases that want to branch (log a 403 differently
 * from a 404) without matching on prose.
 */
export type OwnerVerdict =
  | {
      ok: true;
      project: ProjectRecord;
      /**
       * `'session'` when the recorded owner tag is this caller's; `'unclaimed'`
       * when no owner was ever recorded and this deployment allows that. See
       * `requireOwner` for why the second case exists.
       */
      owner: 'session' | 'unclaimed';
    }
  | { ok: false; status: 404; reason: 'missing'; message: string }
  | { ok: false; status: 403; reason: 'not-owner'; message: string };

/**
 * Gate a mutating or private operation — `/library` rows, `DELETE`, `/edit`,
 * `/rerender` — on the caller owning the project.
 *
 * ## The unclaimed case
 *
 * Every project already on disk, and every project the CLI will ever write, has
 * no `ownerSession`. Locally that must not lock the user out of their own films:
 * there is exactly one person at that machine, so an unclaimed project is
 * theirs. Hosted, the same fact means the opposite — a project this deployment
 * cannot attribute must not be deletable by whichever visitor types its id — so
 * hosted refuses. This is deliberately the same rule as `listProjects`'
 * `includeUnowned` default (`lib/store.ts`), because a row the library shows and
 * a row `DELETE` refuses would be a worse experience than either rule alone.
 */
export async function requireOwner(
  projectId: string,
  session: Session,
  env: NodeJS.ProcessEnv = process.env,
): Promise<OwnerVerdict> {
  const truth = await readProjectTruth(projectId);
  if (!truth) {
    return {
      ok: false,
      status: 404,
      reason: 'missing',
      message: `no project "${projectId}"`,
    };
  }
  if (truth.ownerSession === undefined) {
    if (accountKeys(env)) {
      return {
        ok: false,
        status: 403,
        reason: 'not-owner',
        message: `project "${projectId}" has no owner on record, so it cannot be changed from the web`,
      };
    }
    return { ok: true, project: truth.record, owner: 'unclaimed' };
  }
  const mine = ownerTagFor(session, env);
  // Constant time for the same reason the cookie signature is: this compares a
  // keyed digest, and a byte-at-a-time answer is a byte-at-a-time forgery guide.
  if (!sameTag(truth.ownerSession, mine)) {
    return {
      ok: false,
      status: 403,
      reason: 'not-owner',
      message: `project "${projectId}" belongs to a different session`,
    };
  }
  return { ok: true, project: truth.record, owner: 'session' };
}

function sameTag(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Who may *see* a project: its owner, or anybody at all once it is shared.
 *
 * The split from `requireOwner` is the whole point of the `shared` flag. A
 * project id is unguessable but it is not a secret — it travels in address bars,
 * screen shares and server logs — so "knows the id" is not consent to publish.
 * `shared` defaults to false in `ProjectRecordSchema`, including for every
 * project written before the flag existed, so publication is always an act.
 */
export type ViewVerdict =
  | { ok: true; project: ProjectRecord; via: 'owner' | 'shared' }
  | { ok: false; status: 404; reason: 'missing'; message: string }
  | { ok: false; status: 403; reason: 'private'; message: string };

export async function requireViewable(
  projectId: string,
  session: Session,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ViewVerdict> {
  const verdict = await requireOwner(projectId, session, env);
  if (verdict.ok) return { ok: true, project: verdict.project, via: 'owner' };
  if (verdict.reason === 'missing') return verdict;

  // Not the owner. The only remaining question is whether the owner published
  // it, which needs the record the ownership check declined to hand back.
  const truth = await readProjectTruth(projectId);
  if (!truth) {
    return { ok: false, status: 404, reason: 'missing', message: `no project "${projectId}"` };
  }
  if (truth.record.shared) return { ok: true, project: truth.record, via: 'shared' };
  return {
    ok: false,
    status: 403,
    reason: 'private',
    message: `project "${projectId}" has not been shared`,
  };
}

/**
 * The filter `/library` should list with.
 *
 * A helper rather than an inline object so that the owner-tag derivation lives in
 * exactly one place: a route that wrote `{ ownerSession: session.id }` by hand
 * would compare a raw id against stored digests, match nothing, and produce an
 * empty library that looks like data loss.
 */
export function ownedProjectsFilter(
  session: Session,
  env: NodeJS.ProcessEnv = process.env,
): ProjectFilter {
  return { ownerSession: ownerTagFor(session, env) };
}

/* ---------------------------------------------------------------- boot check */

/**
 * The loud failure, at import time.
 *
 * Every route that touches a session imports this module, so on a hosted box
 * with no secret the API does not start — the error above is printed by Next and
 * the deployment is obviously broken instead of subtly insecure. Locally this
 * call is what creates `projects/.session-secret` on first run, which is also
 * worth doing at import rather than on the first request that needs it.
 */
requireSessionSecret();
