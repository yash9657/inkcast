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
  mintSession,
  ownedProjectsFilter,
  readSession,
  requireOwner,
  requireSessionSecret,
  requireViewable,
  sessionCookie,
  sessionCookieHeader,
  sessionOwnerTag,
  setSessionCookie,
  verifySessionToken,
} = session;

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

test.after(async () => {
  await rm(PROJECTS_ROOT, { recursive: true, force: true });
});
