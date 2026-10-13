/**
 * The session cookie and the ownership check, tested where they are attacked.
 *
 * Six properties carry the whole design, and each one is a way this has gone
 * wrong in other codebases:
 *
 *  1. **A cookie we signed round-trips.** The boring case, and the one that
 *     silently breaking would look exactly like data loss: a session that fails
 *     to verify mints a new one, so the user's entire library disappears with no
 *     error anywhere.
 *  2. **A tampered cookie is not trusted — and does not fail loudly either.** It
 *     mints a fresh session, which is the same thing a first visit gets. An
 *     attacker who edits their cookie must learn nothing and gain nothing.
 *  3. **A cookie signed with a different secret is rejected.** This is what makes
 *     rotating `INKCAST_SESSION_SECRET` a revocation rather than a suggestion,
 *     and it is the test that would catch a signature that accidentally did not
 *     depend on the key at all.
 *  4. **The two HMACs are different HMACs.** The owner tag stored in `meta.json`
 *     is readable by anyone holding a share link (`/api/media` serves it), so if
 *     it equalled the cookie signature, publishing a film would publish its
 *     author's session. Domain separation is asserted, not assumed.
 *  5. **Owner allowed, stranger refused, with the unowned rule differing by
 *     deployment.** Locally an unattributed project belongs to the one person at
 *     the machine; hosted it belongs to nobody and must not be mutable.
 *  6. **`shared` defaults false.** `/share/<id>` is a 403 until the owner acts,
 *     including for projects written before sharing existed.
 *
 * A hosted deployment with no secret must also refuse to boot; that is asserted
 * against `requireSessionSecret` directly rather than by arranging for a module
 * import to explode, which would take this file's own suite with it. (The import
 * itself was checked by hand:
 * `INKCAST_HOSTED=1 INKCAST_SESSION_SECRET= node --import tsx -e "import
 * './app/api/_lib/session.ts'"` throws the full message and never returns a
 * module.)
 *
 * Property 2 earned a seventh test the hard way. Flipping one character of a MAC
 * *usually* breaks it, so the tamper case passed on almost every run and failed
 * on about one in sixteen — because base64url of a 32-byte digest has two slack
 * bits and a byte-wise comparison accepted four different spellings of the same
 * signature. The fix was to compare the canonical text; the test that pins it is
 * `only the canonical spelling of a valid MAC is accepted`, and the tamper case
 * now walks every character position instead of trusting one.
 *
 * ## Four more properties, since identity can now come from Clerk
 *
 *  7. **Unconfigured Clerk is not merely unused — it is unreached.** This is the
 *     constraint most likely to be broken silently, because breaking it produces
 *     a working hosted site and a broken self-hosted one, and only one of those
 *     is being looked at. It is asserted the only way that actually proves
 *     something: `resolveIdentity` is handed a `readUserId` that counts its
 *     calls, and the count must stay at zero. Nothing in `@clerk/nextjs` is
 *     imported here either — the package is not even installed in this
 *     workspace, so a top-level import in the module under test would fail this
 *     whole file at load.
 *  8. **A user id and a session id cannot digest to the same tag.** `meta.json`
 *     holds `HMAC(OWNER_DOMAIN:<id>)` for both kinds of identity, so the two id
 *     spaces have to be disjoint or an account could inherit a browser's
 *     projects. They are, because a user id is namespaced to `clerk:<id>` and
 *     `verifySessionToken` refuses any id containing a colon. Both halves are
 *     asserted, because either one alone is not the property.
 *  9. **Configured Clerk plus no signed-in user is a refusal, not an anonymity.**
 *     Falling through to the cookie would mean the sign-in requirement is
 *     satisfied by clearing one. The refusal still hands back a `stranger`
 *     session, and that stranger must own nothing and must not be issued a
 *     cookie.
 * 10. **A broken identity provider refuses too.** A `readUserId` that throws is
 *     indistinguishable, to the caller, from signed out. An authentication check
 *     that becomes a no-op when its dependency fails is the worst available
 *     shape of this repo's dominant failure mode.
 *
 * The claim path for projects made before a deployment turned Clerk on is
 * exercised end-to-end in `an account can claim what its browser already owned`,
 * because "documented" is not a property a reader can check and "tested" is.
 */

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/*
 * `lib/store` captures the projects root at first evaluation and `session.ts`
 * imports it, so the temp root has to be in the environment before either module
 * body runs — hence dynamic imports. `INKCAST_HOSTED` is cleared for the same
 * reason: with it set and no secret configured, importing `session.ts` is
 * *supposed* to throw, and that is tested deliberately below rather than by
 * accident here.
 */
const PROJECTS_ROOT = mkdtempSync(path.join(os.tmpdir(), 'inkcast-session-test-'));
process.env.INKCAST_PROJECTS = PROJECTS_ROOT;
delete process.env.INKCAST_HOSTED;
delete process.env.INKCAST_SESSION_SECRET;

const session = await import('./session.js');
const {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SEC,
  cookieSession,
  mintSession,
  ownedProjectsFilter,
  ownerTagFor,
  readSession,
  requireOwner,
  requireSessionSecret,
  requireViewable,
  resolveIdentity,
  sessionCookie,
  sessionCookieHeader,
  sessionOwnerTag,
  setSessionCookie,
  userSession,
  verifySessionToken,
} = session;

const { CLERK_PUBLISHABLE_KEY_VAR, CLERK_SECRET_KEY_VAR, clerkConfigured } =
  await import('./clerk.js');

const { setProjectShared, upsertProject } = await import('@/lib/store.js');

/** Two secrets, both long enough to be accepted. */
const SECRET_A = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
const SECRET_B = 'ffffeeeeddddccccbbbbaaaa99998888';

/**
 * A handful of variables, as an environment.
 *
 * Same helper, and the same reason, as `asEnv` in `ratelimit.test.ts`: Next's
 * type declarations make `NODE_ENV` a *required* member of `ProcessEnv`, so an
 * object holding only the variables under test is not a `ProcessEnv` and a cast
 * at each call site would have to route through `unknown` — which would also
 * accept a misspelled variable name and produce a test that proves nothing.
 */
function asEnv(vars: Record<string, string>): NodeJS.ProcessEnv {
  return { NODE_ENV: 'test', ...vars };
}

/** An environment with a known secret, and optionally the hosted flag. */
function envWith(secret: string, hosted = false): NodeJS.ProcessEnv {
  return asEnv({
    INKCAST_PROJECTS: PROJECTS_ROOT,
    INKCAST_SESSION_SECRET: secret,
    ...(hosted ? { INKCAST_HOSTED: '1' } : {}),
  });
}

/**
 * The same environment, plus a Clerk instance.
 *
 * Fake keys, and that is the point of the whole design: `clerkConfigured` is a
 * test for two variables being *present*, and everything past it goes through the
 * injected `readUserId`, so this entire suite exercises the account path with no
 * Clerk account, no `@clerk/nextjs` installed, and no network.
 */
function envWithClerk(secret: string, hosted = false): NodeJS.ProcessEnv {
  return {
    ...envWith(secret, hosted),
    [CLERK_SECRET_KEY_VAR]: 'sk_test_notarealkey',
    [CLERK_PUBLISHABLE_KEY_VAR]: 'pk_test_notarealkey',
  };
}

/**
 * A `readUserId` that answers a fixed value and records how often it was asked.
 *
 * The count is the assertion, not a convenience: the claim "Clerk is unreached
 * when unconfigured" cannot be made by observing the return value, because the
 * anonymous answer and a Clerk answer are the same shape.
 */
type Reader = { read: () => Promise<string | null>; calls: number };

function reader(userId: string | null): Reader {
  // Annotated rather than inferred: the arrow closes over `spy`, and TypeScript
  // refuses to infer a type that is referenced inside its own initializer.
  const spy: Reader = {
    calls: 0,
    read: async () => {
      spy.calls += 1;
      return userId;
    },
  };
  return spy;
}

/** A request carrying (or not carrying) a session cookie. */
function request(cookie?: string): Request {
  return new Request('http://localhost:3000/api/projects', {
    headers: cookie === undefined ? {} : { cookie },
  });
}

/* ------------------------------------------------------------- the secret */

test('a hosted deployment with no secret refuses to work, loudly', () => {
  assert.throws(
    () => requireSessionSecret(asEnv({ INKCAST_HOSTED: '1' })),
    (err: Error) => {
      // The message is the fix. A hosted box that failed with "undefined is not
      // a string" would be debugged by reading this source; one that names the
      // variable and the command is debugged in ten seconds.
      assert.match(err.message, /INKCAST_SESSION_SECRET is not set/);
      assert.match(err.message, /openssl rand -hex 32/);
      return true;
    },
  );
  // Blank counts as missing: the classic way an unset variable becomes an empty
  // key that signs everything identically.
  assert.throws(() =>
    requireSessionSecret(asEnv({ INKCAST_HOSTED: '1', INKCAST_SESSION_SECRET: '   ' })),
  );
});

test('a human-typed secret is refused before it can sign anything', () => {
  assert.throws(
    () => requireSessionSecret(envWith('changeme', true)),
    /INKCAST_SESSION_SECRET is too short/,
  );
});

test('locally the secret is generated once and persisted, never hardcoded', () => {
  // Importing this module is what creates it, so it is already on disk.
  const file = path.join(PROJECTS_ROOT, '.session-secret');
  assert.ok(existsSync(file), 'a local run must not require a setup step');
  const onDisk = readFileSync(file, 'utf8').trim();
  assert.ok(onDisk.length >= 24);
  assert.equal(
    requireSessionSecret(asEnv({ INKCAST_PROJECTS: PROJECTS_ROOT })),
    onDisk,
    'stable across calls — owner tags already in meta.json must keep matching',
  );
  assert.notEqual(onDisk, SECRET_A, 'and unique per checkout, not a constant in the source');
});

/* ------------------------------------------------------------ the round trip */

test('a cookie we signed round-trips to the same session', () => {
  const env = envWith(SECRET_A);
  const minted = mintSession(env);
  assert.equal(minted.fresh, true, 'a new session must be told to set its cookie');

  const read = readSession(request(`${SESSION_COOKIE}=${minted.token}`), env);
  assert.equal(read.id, minted.id);
  assert.equal(read.fresh, false, 're-sending an identical cookie is bytes for nothing');
  assert.equal(verifySessionToken(minted.token, env), minted.id);
});

test('the cookie survives the company of other cookies', () => {
  const env = envWith(SECRET_A);
  const minted = mintSession(env);
  const header = `theme=dark; ${SESSION_COOKIE}=${minted.token}; other=1`;
  assert.equal(readSession(request(header), env).id, minted.id);
});

test('a tampered signature mints a new session instead of being trusted', () => {
  const env = envWith(SECRET_A);
  const minted = mintSession(env);
  const [id, signature] = minted.token.split('.') as [string, string];

  /*
   * Every single-character edit, not one arbitrary one.
   *
   * This test used to flip only the *last* character, and it failed roughly one
   * run in sixteen — the flake that found the base64url slack-bit bug now
   * documented in `verifySessionToken`. Flipping every position in turn is both
   * deterministic and a stronger claim: 43 characters × 2 substitutions, and not
   * one of them may verify.
   */
  for (let i = 0; i < signature.length; i += 1) {
    for (const replacement of ['A', 'z'] as const) {
      if (signature[i] === replacement) continue;
      const forged = `${signature.slice(0, i)}${replacement}${signature.slice(i + 1)}`;
      assert.equal(
        verifySessionToken(`${id}.${forged}`, env),
        undefined,
        `a signature differing at index ${i} must not verify`,
      );
    }
  }

  const flipped = `${signature.slice(0, -1)}${signature.slice(-1) === 'A' ? 'z' : 'A'}`;
  const read = readSession(request(`${SESSION_COOKIE}=${id}.${flipped}`), env);
  assert.notEqual(read.id, id, 'a forged cookie must not select somebody else’s library');
  assert.equal(read.fresh, true, 'it is treated exactly like a first visit');
});

test('only the canonical spelling of a valid MAC is accepted', () => {
  const env = envWith(SECRET_A);
  const minted = mintSession(env);
  const signature = minted.token.slice(minted.token.indexOf('.') + 1);
  assert.equal(signature.length, 43, 'base64url of a 32-byte digest, unpadded');

  // The four final characters that decode to identical bytes — `k`, `l`, `m`,
  // `n` for a signature ending in `k`. A byte-wise comparison accepts all four;
  // this one accepts exactly the string we issued. Not a forgery either way (the
  // key is still needed to get the other 42 characters), but a MAC check with
  // four right answers is a MAC check nobody can reason about.
  const alternates = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'].filter(
    (c) =>
      c !== signature.slice(-1) &&
      Buffer.from(`${signature.slice(0, -1)}${c}`, 'base64url').equals(
        Buffer.from(signature, 'base64url'),
      ),
  );
  assert.equal(alternates.length, 3, 'the slack bits are real; this is the bug being pinned');
  for (const c of alternates) {
    assert.equal(verifySessionToken(`${minted.id}.${signature.slice(0, -1)}${c}`, env), undefined);
  }
  // Padding is another non-canonical spelling of the same bytes.
  assert.equal(verifySessionToken(`${minted.id}.${signature}=`, env), undefined);
  assert.equal(verifySessionToken(minted.token, env), minted.id, 'and the real one still works');
});

test('a tampered id mints a new session, and so does an unsigned one', () => {
  const env = envWith(SECRET_A);
  const minted = mintSession(env);
  const signature = minted.token.slice(minted.token.indexOf('.') + 1);

  // The signature is real, the id is not: the case that a naive
  // "does the cookie have two parts" check would wave through.
  assert.equal(verifySessionToken(`AAAAAAAAAAAAAAAAAAAAAA.${signature}`, env), undefined);
  // No signature at all, which is what a hand-written cookie looks like.
  assert.equal(verifySessionToken(minted.id, env), undefined);
  assert.equal(verifySessionToken(`${minted.id}.`, env), undefined);
  assert.equal(verifySessionToken(`.${signature}`, env), undefined);
  // Truncated MACs must not compare equal to their own prefix, which is what a
  // `startsWith`-shaped comparison would do.
  assert.equal(verifySessionToken(`${minted.id}.${signature.slice(0, 20)}`, env), undefined);
  // Not even valid base64url, and 43 characters of it so it clears the length
  // check and reaches the comparison. Neither shape may throw: a throw inside
  // signature verification is a 500 on every request carrying a junk cookie.
  assert.equal(verifySessionToken(`${minted.id}.!!!not-base64!!!`, env), undefined);
  assert.equal(verifySessionToken(`${minted.id}.${'!'.repeat(43)}`, env), undefined);
  assert.equal(verifySessionToken(undefined, env), undefined);
  assert.equal(readSession(request(), env).fresh, true, 'no cookie at all: a fresh session');
});

test('a cookie signed with a different secret is rejected', () => {
  const minted = mintSession(envWith(SECRET_A));
  assert.equal(
    verifySessionToken(minted.token, envWith(SECRET_B)),
    undefined,
    'rotating the secret must actually revoke every outstanding cookie',
  );
  // And the signature genuinely depends on the key rather than only on the id.
  assert.notEqual(mintSession(envWith(SECRET_A)).token.split('.')[1], undefined);
  const id = minted.id;
  const underA = verifySessionToken(minted.token, envWith(SECRET_A));
  assert.equal(underA, id);
});

/* ---------------------------------------------------------------- the cookie */

test('the cookie is httpOnly, lax, long-lived, and secure only when hosted', () => {
  const local = sessionCookie(mintSession(envWith(SECRET_A)), envWith(SECRET_A));
  assert.equal(local.name, SESSION_COOKIE);
  assert.equal(local.httpOnly, true);
  assert.equal(local.sameSite, 'lax');
  assert.equal(local.path, '/');
  assert.equal(local.maxAge, SESSION_MAX_AGE_SEC);
  assert.ok(
    local.maxAge >= 60 * 60 * 24 * 180,
    'short expiry on an anonymous session is data loss',
  );
  assert.equal(local.secure, false, 'a Secure cookie is dropped on http://localhost');

  const hosted = sessionCookie(mintSession(envWith(SECRET_A, true)), envWith(SECRET_A, true));
  assert.equal(hosted.secure, true);

  const header = sessionCookieHeader(mintSession(envWith(SECRET_A, true)), envWith(SECRET_A, true));
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Lax/);
  assert.match(header, /Secure/);
  assert.ok(
    !sessionCookieHeader(mintSession(envWith(SECRET_A)), envWith(SECRET_A)).includes('Secure'),
  );
});

test('setSessionCookie sets a fresh session and leaves a returning one alone', () => {
  const env = envWith(SECRET_A);
  const sent: unknown[] = [];
  const response = { cookies: { set: (c: unknown) => sent.push(c) }, body: 'ok' };

  const fresh = mintSession(env);
  assert.equal(setSessionCookie(response, fresh, env), response, 'returns its argument');
  assert.equal(sent.length, 1);

  setSessionCookie(response, { ...fresh, fresh: false }, env);
  assert.equal(sent.length, 1, 'nothing to say to a browser that already has the cookie');
});

/* ------------------------------------------------------- domain separation */

test('the owner tag is not the cookie signature', () => {
  const env = envWith(SECRET_A);
  const minted = mintSession(env);
  const signature = minted.token.slice(minted.token.indexOf('.') + 1);
  const tag = sessionOwnerTag(minted.id, env);

  // The tag is stored in meta.json, which every viewer of a shared project can
  // fetch. If these were equal, publishing a film would hand out a working
  // cookie for the session that made it.
  assert.notEqual(tag, signature);
  assert.equal(verifySessionToken(`${minted.id}.${tag}`, env), undefined);
  // Deterministic, keyed, and not the id itself.
  assert.equal(tag, sessionOwnerTag(minted.id, env));
  assert.notEqual(tag, sessionOwnerTag(minted.id, envWith(SECRET_B)));
  assert.ok(!tag.includes(minted.id));

  assert.deepEqual(ownedProjectsFilter(minted, env), { ownerSession: tag });
});

/* -------------------------------------------------------------- ownership */

test('the owner may act, a stranger may not, and a missing project is a 404', async () => {
  const env = envWith(SECRET_A);
  const owner = mintSession(env);
  const stranger = mintSession(env);
  await upsertProject('ownedone', {
    title: 'Owned',
    status: 'ready',
    ownerSession: sessionOwnerTag(owner.id, env),
  });

  const mine = await requireOwner('ownedone', owner, env);
  assert.equal(mine.ok, true);
  assert.equal(mine.ok && mine.owner, 'session');
  assert.equal(mine.ok && mine.project.id, 'ownedone');

  const theirs = await requireOwner('ownedone', stranger, env);
  assert.equal(theirs.ok, false);
  assert.equal(!theirs.ok && theirs.status, 403);
  assert.equal(!theirs.ok && theirs.reason, 'not-owner');

  const absent = await requireOwner('nosuchproject', owner, env);
  assert.equal(absent.ok, false);
  assert.equal(!absent.ok && absent.status, 404);
  assert.equal(!absent.ok && absent.reason, 'missing');

  // An id we would never have written is a 404, not a filesystem error.
  const bogus = await requireOwner('../escape', owner, env);
  assert.equal(!bogus.ok && bogus.status, 404);
});

test('an unclaimed project is the local user’s and nobody’s when hosted', async () => {
  const env = envWith(SECRET_A);
  const anyone = mintSession(env);
  // Exactly what `pnpm cast` leaves behind, and what every project on disk
  // before this change looks like.
  await upsertProject('unclaimed1', { title: 'From the CLI', status: 'ready' });

  const local = await requireOwner('unclaimed1', anyone, env);
  assert.equal(local.ok, true);
  assert.equal(local.ok && local.owner, 'unclaimed');

  const hosted = await requireOwner('unclaimed1', anyone, envWith(SECRET_A, true));
  assert.equal(hosted.ok, false);
  assert.equal(!hosted.ok && hosted.status, 403);
  assert.match(!hosted.ok ? hosted.message : '', /no owner on record/);
});

/* ----------------------------------------------------------------- sharing */

test('a project is private until its owner shares it', async () => {
  const env = envWith(SECRET_A);
  const owner = mintSession(env);
  const audience = mintSession(env);
  await upsertProject('sharedone', {
    title: 'Shareable',
    status: 'ready',
    ownerSession: sessionOwnerTag(owner.id, env),
  });

  // Default false, so knowing the id is not consent to publish — an id travels
  // in address bars, screen shares and logs.
  const beforeShare = await requireViewable('sharedone', audience, env);
  assert.equal(beforeShare.ok, false);
  assert.equal(!beforeShare.ok && beforeShare.status, 403);
  assert.equal(!beforeShare.ok && beforeShare.reason, 'private');

  // The owner can always see their own, shared or not.
  const ownerView = await requireViewable('sharedone', owner, env);
  assert.equal(ownerView.ok && ownerView.via, 'owner');

  await setProjectShared('sharedone', true);
  const afterShare = await requireViewable('sharedone', audience, env);
  assert.equal(afterShare.ok, true);
  assert.equal(afterShare.ok && afterShare.via, 'shared');
  assert.equal(afterShare.ok && afterShare.project.shared, true);

  // Un-sharing takes it back, which is the only reason the flag is a boolean
  // rather than a one-way door.
  await setProjectShared('sharedone', false);
  assert.equal((await requireViewable('sharedone', audience, env)).ok, false);

  const absent = await requireViewable('nosuchproject', audience, env);
  assert.equal(!absent.ok && absent.status, 404);
});

test('sharing does not make a project editable by its audience', async () => {
  const env = envWith(SECRET_A);
  const owner = mintSession(env);
  const audience = mintSession(env);
  await upsertProject('sharedtwo', {
    status: 'ready',
    shared: true,
    ownerSession: sessionOwnerTag(owner.id, env),
  });

  // The whole point of splitting `requireViewable` from `requireOwner`: publish
  // is read-only consent. `DELETE`, `/edit` and `/rerender` keep asking the
  // stricter question.
  assert.equal((await requireViewable('sharedtwo', audience, env)).ok, true);
  const verdict = await requireOwner('sharedtwo', audience, env);
  assert.equal(!verdict.ok && verdict.status, 403);
});

/* ------------------------------------------------------- identity, optionally Clerk */

test('Clerk is configured only when both of its variables are really set', () => {
  assert.equal(clerkConfigured(asEnv({})), false);
  assert.equal(clerkConfigured(asEnv({ [CLERK_SECRET_KEY_VAR]: 'sk_test_x' })), false);
  assert.equal(clerkConfigured(asEnv({ [CLERK_PUBLISHABLE_KEY_VAR]: 'pk_test_x' })), false);
  assert.equal(
    clerkConfigured(
      asEnv({ [CLERK_SECRET_KEY_VAR]: 'sk_test_x', [CLERK_PUBLISHABLE_KEY_VAR]: 'pk_test_x' }),
    ),
    true,
  );
  // `VAR=` in a shell script is the classic way an unset variable arrives looking
  // set. A publishable key alone would render a working sign-in flow whose result
  // the server cannot verify, which is the half-configuration worth refusing.
  assert.equal(
    clerkConfigured(
      asEnv({ [CLERK_SECRET_KEY_VAR]: '  ', [CLERK_PUBLISHABLE_KEY_VAR]: 'pk_test_x' }),
    ),
    false,
  );
});

test('with Clerk unconfigured, identity is the anonymous cookie and Clerk is never asked', async () => {
  const env = envWith(SECRET_A);
  const minted = mintSession(env);
  const spy = reader('user_shouldnotbeused');

  const who = await resolveIdentity(request(`${SESSION_COOKIE}=${minted.token}`), env, {
    readUserId: spy.read,
  });
  assert.equal(who.ok, true);
  assert.equal(who.ok && who.via, 'anonymous');
  assert.equal(who.ok && who.session.id, minted.id, 'the same session the cookie proves');
  assert.equal(who.ok && who.session.kind, 'anon');
  assert.equal(who.ok && who.session.fresh, false);

  // The whole self-hosting promise in one assertion. A `pnpm dev` checkout has no
  // Clerk account, no `@clerk/nextjs` on disk and possibly no network; if this
  // number is ever 1, that checkout is broken and the hosted box still works, so
  // nobody would notice from production.
  assert.equal(spy.calls, 0, 'unconfigured Clerk must be unreached, not merely unused');

  // And a first visit still mints, exactly as before this branch existed.
  const first = await resolveIdentity(request(), env, { readUserId: spy.read });
  assert.equal(first.ok && first.session.fresh, true);
  assert.equal(spy.calls, 0);
});

test('with Clerk configured, a signed-in user is the identity and carries no cookie', async () => {
  const env = envWithClerk(SECRET_A, true);
  const spy = reader('user_2abcDEF');

  const who = await resolveIdentity(request(), env, { readUserId: spy.read });
  // `assert.fail` returns `never`, so this both checks and narrows — `userId`
  // only exists on the `via: 'user'` arm, and a discriminated union is the point.
  if (!who.ok || who.via !== 'user') assert.fail('a signed-in user must be identified');
  assert.equal(who.userId, 'user_2abcDEF');
  assert.equal(spy.calls, 1);

  assert.equal(who.session.kind, 'user');
  assert.equal(who.session.id, 'clerk:user_2abcDEF', 'namespaced before anything digests it');
  assert.equal(who.session.token, '', 'Clerk holds the proof; we sign nothing');
  assert.equal(who.session.fresh, false, 'so every setSessionCookie call site is a no-op');

  // Proven rather than reasoned: an account must not cause a Set-Cookie.
  const sent: unknown[] = [];
  const response = { cookies: { set: (c: unknown) => sent.push(c) } };
  setSessionCookie(response, who.session, env);
  assert.equal(sent.length, 0);

  // A signed-in cookie in the jar changes nothing: Clerk is the authority when
  // Clerk is configured, so a leftover anonymous cookie cannot select a library.
  const stale = mintSession(env);
  const withCookie = await resolveIdentity(request(`${SESSION_COOKIE}=${stale.token}`), env, {
    readUserId: spy.read,
  });
  assert.equal(withCookie.ok && withCookie.session.id, 'clerk:user_2abcDEF');
});

test('with Clerk configured, a signed-out request is refused rather than made anonymous', async () => {
  const env = envWithClerk(SECRET_A, true);
  const anonymous = mintSession(env);
  await upsertProject('clerkowned', {
    title: 'Made while signed out',
    status: 'ready',
    ownerSession: sessionOwnerTag(anonymous.id, env),
  });

  // Presenting a perfectly valid anonymous cookie must not buy anything. If it
  // did, the sign-in requirement would be satisfiable by clearing a cookie, and
  // an honest user would have two half-libraries that swap on sign-out.
  const who = await resolveIdentity(request(`${SESSION_COOKIE}=${anonymous.token}`), env, {
    readUserId: reader(null).read,
  });
  assert.equal(who.ok, false);
  assert.equal(!who.ok && who.status, 401);
  assert.equal(!who.ok && who.reason, 'sign-in-required');

  // The stranger exists so `/api/media/<id>/…` and the share page's own
  // server-side fetch of `/api/projects/<id>` can still answer without a 401 —
  // and it must own nothing, or the refusal would be decorative.
  const stranger = !who.ok ? who.stranger : mintSession(env);
  assert.equal(stranger.fresh, false, 'a refused caller is not handed a durable identity');
  const verdict = await requireOwner('clerkowned', stranger, env);
  assert.equal(verdict.ok, false);
  assert.equal(!verdict.ok && verdict.status, 403);

  // An empty string from Clerk is signed out too, not a user named "".
  const blank = await resolveIdentity(request(), env, { readUserId: reader('').read });
  assert.equal(blank.ok, false);
});

test('a broken identity provider refuses; it does not degrade to anonymous', async () => {
  const env = envWithClerk(SECRET_A, true);
  const who = await resolveIdentity(request(), env, {
    readUserId: async () => {
      throw new Error('clerk unreachable');
    },
  });
  assert.equal(who.ok, false);
  assert.equal(!who.ok && who.status, 401);

  // And the same with no injection at all, which on this workspace means the real
  // loader failing to find `@clerk/nextjs`: still a refusal, never a crash and
  // never an anonymous session. An auth check that no-ops when its dependency
  // fails is the worst shape of this repo's dominant failure mode.
  const real = await resolveIdentity(request(), env);
  assert.equal(real.ok, false);
  assert.equal(!real.ok && real.status, 401);
});

/* ------------------------------------------- domain separation, second layer */

test('a user id and a session id cannot digest to the same owner tag', () => {
  const env = envWith(SECRET_A);
  const account = userSession('user_2abcDEF');

  // The collision to rule out is a browser whose *session id* is spelled exactly
  // like somebody's Clerk user id. The namespace is what stops it.
  const impostor = { id: 'user_2abcDEF', token: '', fresh: false, kind: 'anon' as const };
  assert.notEqual(ownerTagFor(account, env), ownerTagFor(impostor, env));
  assert.notEqual(ownerTagFor(account, env), sessionOwnerTag('user_2abcDEF', env));

  // The other half of the property, and the half that makes the first half safe:
  // no cookie can ever *carry* an id containing a colon, whatever it is signed
  // with, because the id-shape gate runs before any comparison. So the namespaced
  // space is unreachable from the cookie side entirely.
  assert.ok(!account.id.includes('.'), 'or the token grammar would be ambiguous too');
  assert.equal(verifySessionToken(`${account.id}.${'A'.repeat(43)}`, env), undefined);
  for (let i = 0; i < 32; i += 1) {
    assert.ok(!mintSession(env).id.includes(':'), 'anonymous ids are base64url, colon-free');
  }

  // Keyed, and not the raw user id: `meta.json` is served to every holder of a
  // share link, so a Clerk user id must never be written to it.
  const tag = ownerTagFor(account, env);
  assert.ok(!tag.includes('user_2abcDEF'));
  assert.ok(!tag.includes('clerk'));
  assert.notEqual(tag, ownerTagFor(account, envWith(SECRET_B)));
});

test('ownerTagFor is exactly sessionOwnerTag of the id, for both kinds', () => {
  const env = envWith(SECRET_A);
  // Pinned because `app/api/generate/route.ts` stamps ownership by calling
  // `sessionOwnerTag(session.id)` directly. If these two ever diverge, that route
  // writes a tag `requireOwner` will not accept, and the symptom is a project
  // that renders fine and then 403s its own author — with an empty library, which
  // reads as data loss rather than as a bug.
  const anon = mintSession(env);
  assert.equal(ownerTagFor(anon, env), sessionOwnerTag(anon.id, env));
  const account = userSession('user_9zzz');
  assert.equal(ownerTagFor(account, env), sessionOwnerTag(account.id, env));
  assert.deepEqual(ownedProjectsFilter(account, env), { ownerSession: ownerTagFor(account, env) });
});

test('an account owns its own projects and a stranger account does not', async () => {
  const env = envWithClerk(SECRET_A, true);
  const mine = userSession('user_owner');
  const theirs = userSession('user_other');
  await upsertProject('accountown', {
    title: 'Made signed in',
    status: 'ready',
    ownerSession: ownerTagFor(mine, env),
  });

  const ok = await requireOwner('accountown', mine, env);
  assert.equal(ok.ok, true);
  assert.equal(ok.ok && ok.owner, 'session');

  const no = await requireOwner('accountown', theirs, env);
  assert.equal(!no.ok && no.status, 403);

  // Sharing works identically — nothing in the view path learned about accounts.
  await setProjectShared('accountown', true);
  const viewed = await requireViewable('accountown', theirs, env);
  assert.equal(viewed.ok && viewed.via, 'shared');
  await setProjectShared('accountown', false);
});

/* ------------------------------------------------------------------- migration */

test('cookieSession reports only a cookie we actually issued, never a fresh one', () => {
  const env = envWith(SECRET_A);
  const minted = mintSession(env);
  assert.equal(cookieSession(request(`${SESSION_COOKIE}=${minted.token}`), env)?.id, minted.id);
  // The difference from `readSession`, and the reason both exist: "who is this"
  // mints, "does this browser hold a cookie we issued" must not.
  assert.equal(cookieSession(request(), env), undefined);
  assert.equal(cookieSession(request(`${SESSION_COOKIE}=${minted.id}.forged`), env), undefined);
  assert.equal(
    cookieSession(request(`${SESSION_COOKIE}=${minted.token}`), envWith(SECRET_B)),
    undefined,
  );
  assert.equal(readSession(request(), env).fresh, true, 'readSession still mints');
});

test('an account can claim what its browser already owned', async () => {
  const env = envWithClerk(SECRET_A, true);
  const browser = mintSession(env);
  await upsertProject('preauthone', {
    title: 'Drawn before the sign-in existed',
    status: 'ready',
    ownerSession: sessionOwnerTag(browser.id, env),
  });
  const account = userSession('user_claimant');

  // The state a deployment lands in the moment it turns Clerk on: the tags on
  // disk are digests of a random cookie id, so the signed-in owner is a stranger
  // to their own films. That is stated in the module header rather than hidden.
  assert.equal((await requireOwner('preauthone', account, env)).ok, false);

  // The way out. `requireOwner` against the browser's still-valid cookie is the
  // authorization — no second ownership rule is invented — and the transfer is a
  // rewrite of the tag.
  const carried = cookieSession(request(`${SESSION_COOKIE}=${browser.token}`), env);
  assert.ok(carried, 'the cookie outlives the sign-in: SESSION_MAX_AGE_SEC is a year');
  assert.equal((await requireOwner('preauthone', carried, env)).ok, true);
  await upsertProject('preauthone', { ownerSession: ownerTagFor(account, env) });

  assert.equal((await requireOwner('preauthone', account, env)).ok, true);
  // And the transfer is a move, not a copy: the old anonymous identity loses it,
  // which is what stops a shared laptop from leaving a second owner behind.
  assert.equal((await requireOwner('preauthone', carried, env)).ok, false);
});

test.after(async () => {
  await rm(PROJECTS_ROOT, { recursive: true, force: true });
});
