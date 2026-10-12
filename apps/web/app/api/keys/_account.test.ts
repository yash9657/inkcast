/**
 * `/api/keys` on the hosted box: one account cannot see, change or delete
 * another's key, and no response ever carries one.
 *
 * These run the real route handlers, not a re-implementation of them, because the
 * bugs worth catching here live in the wiring rather than in the crypto — a branch
 * that resolves the owner *after* parsing the body, a delete that forgets whose
 * key it is, a response that helpfully echoes what was saved. `_lib/secrets.test.ts`
 * covers the cipher; this covers the doors.
 *
 * Two things are deliberately not exercised, and both are deliberate rather than
 * missing:
 *
 *  - **The local `@inkcast/keyvault` path.** Reaching it from a test would read
 *    the real macOS keychain on whatever machine is running the suite. It is
 *    unchanged by this work apart from being loaded lazily, and it has its own
 *    tests in `packages/keyvault`.
 *  - **A real provider probe.** Live keys sit in this machine's keychain and get
 *    injected into `process.env`, so a test that reaches a provider is a test that
 *    spends money. `validateAccountKey` takes an injectable probe for exactly this
 *    reason, and the route paths tested below are the ones that answer without
 *    probing at all.
 */

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * A hosted box, configured, with no identity provider — so identity is the signed
 * anonymous cookie and each cookie is an account. The Clerk-configured branch is
 * flipped on inside its own test further down, because `resolveIdentity` reads the
 * environment per request rather than at import.
 *
 * Set before the dynamic imports below: `_lib/secrets.ts` checks for a master key
 * at import time when `INKCAST_HOSTED=1`, and `_lib/session.ts` does the same for
 * the session secret. Those checks are the feature, so the test has to satisfy
 * them the way a deployment does.
 */
const DIR = await mkdtemp(path.join(tmpdir(), 'inkcast-keys-route-'));
process.env.INKCAST_HOSTED = '1';
process.env.INKCAST_SECRET_KEY = randomBytes(32).toString('hex');
process.env.INKCAST_SECRETS_DIR = DIR;
process.env.INKCAST_SESSION_SECRET ??= randomBytes(32).toString('hex');
delete process.env.CLERK_SECRET_KEY;
delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

const { DELETE, GET, POST } = await import('./route.js');
const { POST: VALIDATE } = await import('./validate/route.js');
const { accountOwner, recordAccountValidation, validateAccountKey } = await import('./_account.js');
const { mintSession, ownerTagFor } = await import('../_lib/session.js');
const { readOwnerKey, secretsDir } = await import('../_lib/secrets.js');

/* ------------------------------------------------------------------- fixtures */

/** Shaped like real Anthropic keys, and not ones. The `-fake-` is for the human. */
const ALICE_KEY = `sk-ant-api03-fake-alice-${'A1b2C3d4E5f6G7h8'.repeat(2)}`;
const BOB_KEY = `sk-ant-api03-fake-bob-x-${'Z9y8X7w6V5u4T3s2'.repeat(2)}`;
const SECRETS = [ALICE_KEY, BOB_KEY];

const alice = mintSession();
const bob = mintSession();

function request(url: string, init: RequestInit = {}, token?: string): Request {
  const headers = new Headers(init.headers);
  if (token !== undefined) headers.set('cookie', `inkcast_session=${token}`);
  return new Request(`http://localhost${url}`, { ...init, headers });
}

function post(body: unknown, token?: string): Request {
  return request(
    '/api/keys',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    token,
  );
}

/**
 * Read a response once, and hold both forms.
 *
 * The serialised text is the thing asserted against for secrecy: parsing first and
 * checking fields would only prove that the fields we thought to look at are
 * clean, and the failure mode is a key arriving in a field nobody expected — a
 * `detail`, a `note`, an echoed error.
 */
async function read(response: Response) {
  const text = await response.text();
  for (const secret of SECRETS) {
    // The failure message deliberately does not quote the body. `installRedaction`
    // has patched this process's stdout, and a rewritten byte inside the test
    // runner's own serialised stream corrupts the report — measured, not feared:
    // a printed key turned a clean assertion failure into "unable to deserialize
    // cloned data". Every comparison below therefore compares booleans rather than
    // letting `assert.equal` print a credential into its diff.
    assert.ok(!text.includes(secret), 'a key reached the client');
    assert.ok(
      !text.includes(Buffer.from(secret, 'utf8').toString('base64')),
      'a key reached the client, base64-encoded',
    );
  }
  return { status: response.status, text, body: JSON.parse(text) as Record<string, never> };
}

/**
 * Is this account's stored credential exactly this string?
 *
 * A predicate rather than `assert.equal(await readOwnerKey(...), KEY)` on purpose:
 * a failing `assert.equal` prints both values, which would write a credential into
 * the test log — and into a stdout that `installRedaction` is rewriting, which
 * corrupts the runner's report as well as leaking. Booleans compare fine.
 */
async function holds(
  session: typeof alice,
  provider: string,
  expected: string | undefined,
): Promise<boolean> {
  return (await readOwnerKey({ owner: ownerTagFor(session), provider })) === expected;
}

type Row = { id: string; configured: boolean; source: string; mask?: string; length?: number };

function row(body: Record<string, never>, id: string): Row {
  const keys = body.keys as unknown as Row[];
  const found = keys.find((entry) => entry.id === id);
  assert.ok(found, `no row for ${id}`);
  return found;
}

/* ------------------------------------------------------------- the empty state */

test('a hosted GET describes all supported providers and what protects them', async () => {
  const out = await read(await GET(request('/api/keys', {}, alice.token)));
  assert.equal(out.status, 200);
  assert.deepEqual((out.body.keys as unknown as Row[]).map((entry) => entry.id).sort(), [
    'anthropic',
    'elevenlabs',
    'fal',
    'fireworks',
    'replicate',
  ]);
  for (const entry of out.body.keys as unknown as Row[]) assert.equal(entry.configured, false);

  const vault = out.body.vault as unknown as Record<string, unknown>;
  assert.equal(vault.backend, 'vault');
  assert.equal(vault.ready, true);
  assert.match(String(vault.cipher), /AES-256-GCM/);
  // Null on purpose: an absolute path on a shared box is a free map of the
  // container. `GET /api/providers` redacts `projectsDir` for the same reason.
  assert.equal(vault.path, null);
  assert.equal(vault.kdf, null);
});

/* -------------------------------------------------------------- store and read */

test('a stored key comes back as a hint, a length and a date — never a key', async () => {
  const saved = await read(
    await POST(post({ provider: 'anthropic', key: ALICE_KEY }, alice.token)),
  );
  assert.equal(saved.status, 200);
  const key = saved.body.key as unknown as Row & { updatedAt?: string };
  assert.equal(key.configured, true);
  assert.equal(key.source, 'vault');
  assert.equal(key.mask, `••••${ALICE_KEY.slice(-4)}`);
  assert.equal(key.length, ALICE_KEY.length);
  assert.ok(key.updatedAt);
  // The note says what is true and stops there. It must not promise the next
  // render bills this key: the stages read `process.env`, and the threading that
  // changes that is not in this route.
  assert.match(String(saved.body.note), /encrypted/);
  assert.ok(!/next render/.test(String(saved.body.note)), 'the note promises a render behaviour');

  const listed = await read(await GET(request('/api/keys', {}, alice.token)));
  assert.equal(row(listed.body, 'anthropic').mask, `••••${ALICE_KEY.slice(-4)}`);
  assert.equal(row(listed.body, 'elevenlabs').configured, false);
});

test('the key is on disk encrypted, and opens only for its own owner', async () => {
  // Belt to the braces of `_lib/secrets.test.ts`: the route really did seal the
  // value the caller sent, under the caller's own owner digest.
  assert.ok(await holds(alice, 'anthropic', ALICE_KEY), 'the route did not seal what was sent');
  assert.ok(
    await holds(bob, 'anthropic', undefined),
    "another account can read this account's key",
  );
});

/* --------------------------------------------------------------- the isolation */

test('another account cannot read the key through GET', async () => {
  const out = await read(await GET(request('/api/keys', {}, bob.token)));
  for (const entry of out.body.keys as unknown as Row[]) {
    assert.equal(entry.configured, false, `${entry.id} leaked to another account`);
    assert.equal(entry.mask, undefined);
  }
});

test('another account cannot overwrite the key through POST', async () => {
  const mine = await read(await POST(post({ provider: 'anthropic', key: BOB_KEY }, bob.token)));
  assert.equal((mine.body.key as unknown as Row).mask, `••••${BOB_KEY.slice(-4)}`);

  // Alice's record is untouched — same hint, same length, same plaintext.
  const listed = await read(await GET(request('/api/keys', {}, alice.token)));
  assert.equal(row(listed.body, 'anthropic').mask, `••••${ALICE_KEY.slice(-4)}`);
  assert.ok(await holds(alice, 'anthropic', ALICE_KEY), 'the route did not seal what was sent');
});

test('another account cannot delete the key through DELETE', async () => {
  const gone = await read(
    await DELETE(request('/api/keys?provider=anthropic', { method: 'DELETE' }, bob.token)),
  );
  assert.equal(gone.status, 200);
  assert.equal(gone.body.removed, true);
  // Bob deleted Bob's. Alice still has hers.
  assert.ok(
    await holds(bob, 'anthropic', undefined),
    "another account can read this account's key",
  );
  assert.ok(await holds(alice, 'anthropic', ALICE_KEY), 'the route did not seal what was sent');
  // And `stillFromEnv` is false rather than a report on the operator's box.
  assert.equal(gone.body.stillFromEnv, false);
});

test('another account cannot validate the key, and is told nothing about it', async () => {
  // No `key` in the body means "check the one that is stored". Bob has none, so
  // this answers without reaching a provider — which is also why it is safe to run
  // offline. A bug that looked the key up globally would make a network call here.
  const out = await read(
    await VALIDATE(
      request(
        '/api/keys/validate',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ provider: 'anthropic' }),
        },
        bob.token,
      ),
    ),
  );
  assert.equal(out.status, 200);
  const result = out.body.result as unknown as { status: string; message: string };
  assert.equal(result.status, 'unknown');
  assert.match(result.message, /you have no anthropic key stored/i);
});

test('deleting your own key removes it, and says so once', async () => {
  const gone = await read(
    await DELETE(request('/api/keys?provider=anthropic', { method: 'DELETE' }, alice.token)),
  );
  assert.equal(gone.body.removed, true);
  assert.ok(await holds(alice, 'anthropic', undefined), 'a refused request still wrote a key');

  const again = await read(
    await DELETE(request('/api/keys?provider=anthropic', { method: 'DELETE' }, alice.token)),
  );
  assert.equal(again.body.removed, false);
  assert.match(String(again.body.note), /nothing saved/i);
});

/* ------------------------------------------------------------------- first visit */

test('a first-visit request is given the cookie the key was filed under', async () => {
  // On a Clerk-less hosted box the cookie *is* the account. Storing a key against
  // a freshly minted session and not sending its cookie back would file it under
  // an identity the browser can never present again — silent, permanent data loss
  // that looks exactly like the store dropping it.
  const response = await POST(post({ provider: 'fal', key: `${ALICE_KEY}-fal` }));
  const setCookie = response.headers.get('set-cookie');
  assert.ok(setCookie, 'no session cookie was issued to a first-time caller');
  const token = /inkcast_session=([^;]+)/.exec(setCookie)?.[1];
  assert.ok(token);
  assert.match(setCookie, /HttpOnly/i);

  const listed = await read(await GET(request('/api/keys', {}, decodeURIComponent(token))));
  assert.equal(row(listed.body, 'fal').configured, true);
});

/* ----------------------------------------------------------------- refusals */

test('a tampered cookie is a different account, not an error', async () => {
  // `readSession` never reports a bad cookie; the worst a tamperer achieves is
  // losing their own library. Here that means seeing an empty key list.
  const forged = `${alice.token.split('.')[0]}.${'A'.repeat(43)}`;
  const out = await read(await GET(request('/api/keys', {}, forged)));
  assert.equal(out.status, 200);
  for (const entry of out.body.keys as unknown as Row[]) assert.equal(entry.configured, false);
});

test('with Clerk configured, a signed-out caller is refused by every method', async () => {
  // No `@clerk/nextjs` on disk and no middleware in this process, so `auth()` is
  // unreachable — which is exactly the "Clerk is broken" case, and it must refuse
  // rather than fall back to the anonymous cookie. Same answer, same status.
  process.env.CLERK_SECRET_KEY = 'sk_test_not-a-real-clerk-secret';
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_not-a-real-clerk-key';
  try {
    const refusals = [
      await GET(request('/api/keys', {}, alice.token)),
      await POST(post({ provider: 'anthropic', key: ALICE_KEY }, alice.token)),
      await DELETE(request('/api/keys?provider=fal', { method: 'DELETE' }, alice.token)),
      await VALIDATE(
        request(
          '/api/keys/validate',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ provider: 'anthropic', key: ALICE_KEY }),
          },
          alice.token,
        ),
      ),
    ];
    for (const response of refusals) {
      const out = await read(response);
      assert.equal(out.status, 401, `a signed-out caller was served: ${out.text}`);
      assert.match(String(out.body.error), /sign in/i);
    }
    // Nothing was written, and nothing that was already stored was touched.
    assert.ok(await holds(alice, 'anthropic', undefined), 'a refused request still wrote a key');
  } finally {
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  }
});

test('a malformed body is refused without quoting it', async () => {
  const out = await read(
    await POST(post({ provider: 'anthropic', key: 'sk-ant-short' }, alice.token)),
  );
  assert.equal(out.status, 400);
  assert.match(String(out.body.error), /characters/);
  assert.ok(!out.text.includes('sk-ant-short'), 'the refusal quoted the input');
});

/* ------------------------------------------------------------------- identity */

test('an account is addressed by a keyed digest, never by its user id', async () => {
  const env = {
    ...process.env,
    CLERK_SECRET_KEY: 'sk_test_not-a-real-clerk-secret',
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_not-a-real-clerk-key',
  };
  const one = await accountOwner(request('/api/keys'), env, {
    readUserId: async () => 'user_2abcDEF',
  });
  const two = await accountOwner(request('/api/keys'), env, {
    readUserId: async () => 'user_2zzzZZZ',
  });
  assert.ok(one.ok && two.ok);
  assert.equal(one.owner.signedIn, true);
  assert.notEqual(one.owner.tag, two.owner.tag);
  // The digest is what names the file and what the AAD binds to, so a raw user id
  // never reaches disk — the same property `meta.json`'s `ownerSession` relies on.
  assert.ok(!one.owner.tag.includes('user_'), 'the raw user id is in the owner tag');
  assert.ok(!one.owner.tag.includes('clerk'), 'the identity source is in the owner tag');
  // And the same user is the same account across requests, or nobody keeps a key.
  const again = await accountOwner(request('/api/keys'), env, {
    readUserId: async () => 'user_2abcDEF',
  });
  assert.ok(again.ok);
  assert.equal(again.owner.tag, one.owner.tag);
});

test('a box with no master key refuses to hold a key rather than storing one', async () => {
  const env = { ...process.env };
  delete env.INKCAST_SECRET_KEY;
  const who = await accountOwner(request('/api/keys'), env);
  assert.ok(!who.ok);
  assert.equal(who.response.status, 503);
});

test('a stored record that no longer opens is reported, not crashed on', async () => {
  // The realistic cause is a master key rotated without re-wrapping the records.
  // The wrong answers are a 500 (which says nothing) and "not configured" (which
  // invites the user to wonder why the page can see an entry it denies having).
  const carol = mintSession();
  const key = `r8_${'A1b2C3d4'.repeat(5)}`;
  await POST(post({ provider: 'replicate', key }, carol.token));

  const files = await readdir(secretsDir());
  let corrupted = false;
  for (const name of files.filter((entry) => entry.endsWith('.json'))) {
    const full = path.join(secretsDir(), name);
    const parsed = JSON.parse(await readFile(full, 'utf8'));
    if (parsed.keys.replicate === undefined) continue;
    const ct = Buffer.from(parsed.keys.replicate.data.ct, 'base64');
    ct.writeUInt8(ct.readUInt8(0) ^ 0x01, 0);
    parsed.keys.replicate.data.ct = ct.toString('base64');
    await writeFile(full, JSON.stringify(parsed), 'utf8');
    corrupted = true;
  }
  assert.ok(corrupted, 'no record was written to corrupt');

  const out = await read(
    await VALIDATE(
      request(
        '/api/keys/validate',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ provider: 'replicate' }),
        },
        carol.token,
      ),
    ),
  );
  assert.equal(out.status, 200);
  const result = out.body.result as unknown as { status: string; message: string };
  assert.equal(result.status, 'unknown');
  assert.match(result.message, /unsealed/i);
  assert.ok(!out.text.includes(key), 'the key reached the client');
});

/* ----------------------------------------------------------------- validation */

test('a validation verdict never echoes the key the provider echoed back', async () => {
  // The worst case: the provider quotes the credential we sent it straight back at
  // us, and the answer is forwarded to a browser.
  const result = await validateAccountKey('anthropic', ALICE_KEY, async () => ({
    reason: 'rejected',
    status: 401,
    message: `{"error":"bad key: ${ALICE_KEY}"}`,
  }));
  assert.equal(result.status, 'invalid');
  const dump = JSON.stringify(result);
  assert.ok(!dump.includes(ALICE_KEY), `the key reached the browser: ${dump}`);
});

test('a definitive verdict is remembered against the account that asked', async () => {
  await POST(post({ provider: 'elevenlabs', key: ALICE_KEY }, alice.token));
  const who = await accountOwner(request('/api/keys', {}, alice.token));
  assert.ok(who.ok);
  await recordAccountValidation(who.owner, 'elevenlabs', true);

  const listed = await read(await GET(request('/api/keys', {}, alice.token)));
  // The verdict is stored beside the record and reported as a date plus a boolean,
  // because "last we heard" is the only honest form of it — a key that authenticated
  // on Tuesday can be revoked on Wednesday. The wire shape stays masks-only: no
  // field here is ever the key, whatever else gets added to it.
  const checked = row(listed.body, 'elevenlabs') as Row & {
    validatedAt?: string;
    validatedOk?: boolean;
  };
  assert.equal(checked.configured, true);
  assert.equal(checked.validatedOk, true);
  assert.match(String(checked.validatedAt), /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(
    await holds(bob, 'elevenlabs', undefined),
    "another account can read this account's key",
  );
});
