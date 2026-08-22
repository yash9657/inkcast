/**
 * The per-account credential store: the cipher, and the store around it.
 *
 * These tests are the reason the module is shaped the way it is. Each one pins a
 * property that, if it broke, would break silently — a store still returns
 * plausible JSON when its AEAD has quietly stopped authenticating anything, and a
 * routine that decrypts one account's key for another account looks exactly like a
 * routine that works.
 *
 * Everything here is offline and writes only inside a `mkdtemp` directory. Nothing
 * imports a provider SDK and nothing makes a network call: live provider keys sit
 * in this machine's keychain and are injected into `process.env` by
 * `hydrateKeys()`, so a test that reaches a provider is a test that spends money.
 */

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

// The master key and the store directory are read from the environment on every
// call, never captured at import, which is what lets one process exercise a
// configured box, an unconfigured one and a hosted one without reloading modules.
const MASTER = randomBytes(32).toString('hex');
const DIR = await mkdtemp(path.join(tmpdir(), 'inkcast-secrets-'));
process.env.INKCAST_SECRET_KEY = MASTER;
process.env.INKCAST_SECRETS_DIR = DIR;

const {
  SECRET_KEY_ENV,
  SecretsError,
  deleteOwnerSecret,
  isSecretsError,
  listOwnerSecrets,
  markOwnerSecretValidated,
  openSecret,
  readOwnerKey,
  readOwnerSummary,
  requireSecretKey,
  sealSecret,
  secretHint,
  secretsConfigured,
  secretsDir,
  writeOwnerSecret,
} = await import('./secrets.js');

/**
 * A synthetic environment: the real one, with variables overridden or removed.
 *
 * Built from `process.env` rather than from `{}` because this repository types
 * `NodeJS.ProcessEnv` with a required `NODE_ENV`, and because an empty object
 * would also drop the store directory these tests write into. `undefined` removes
 * a variable, which is how the missing-key cases are expressed without touching
 * the real environment other tests in this file rely on.
 */
function env(over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...process.env };
  for (const [name, value] of Object.entries(over)) {
    if (value === undefined) delete out[name];
    else out[name] = value;
  }
  return out;
}

/**
 * Two owner digests, in the shape `sessionOwnerTag()` produces: 32 bytes of
 * HMAC-SHA256 in base64url. Literal rather than derived so that this file tests
 * the store and not the identity module.
 */
const ALICE = randomBytes(32).toString('base64url');
const BOB = randomBytes(32).toString('base64url');

/** Shaped like a real key, and not one. The `-fake-` is there for the human. */
const ALICE_KEY = `sk-ant-api03-fake-alice-${'A1b2C3d4E5f6G7h8'.repeat(2)}`;
const BOB_KEY = `sk-ant-api03-fake-bob-${'Z9y8X7w6V5u4T3s2'.repeat(2)}`;

/* ------------------------------------------------------------- the master key */

test('a missing master key fails loudly, and names itself', () => {
  try {
    requireSecretKey(env({ [SECRET_KEY_ENV]: undefined }));
    assert.fail('a missing master key was accepted');
  } catch (err) {
    assert.ok(isSecretsError(err), `wrong error type: ${String(err)}`);
    assert.equal(err.code, 'no-master-key');
    assert.match(err.message, /INKCAST_SECRET_KEY/);
  }
});

test('a hosted box with no master key gets the whole answer, not a one-liner', () => {
  try {
    requireSecretKey(env({ INKCAST_HOSTED: '1', [SECRET_KEY_ENV]: undefined }));
    assert.fail('a hosted box with no master key was accepted');
  } catch (err) {
    assert.ok(isSecretsError(err));
    // Whoever reads this is staring at a container that will not start, so the
    // message has to carry the diagnosis *and* the command.
    assert.match(err.message, /INKCAST_HOSTED=1/);
    assert.match(err.message, /openssl rand -hex 32/);
    assert.ok(err.message.split('\n').length > 6, 'the loud failure is not loud');
  }
});

test('a short key is refused rather than stretched', () => {
  // 31 bytes of hex, which is 62 characters. Refused because HKDF spreads entropy
  // and does not create any — and refused *as hex*: the bug this pins is a decoder
  // that fails the hex rule, falls through to base64url, re-reads the same 62
  // characters as 46 bytes and calls it strong enough.
  const short = randomBytes(31).toString('hex');
  try {
    requireSecretKey(env({ [SECRET_KEY_ENV]: short }));
    assert.fail('a 31-byte key was accepted');
  } catch (err) {
    assert.ok(isSecretsError(err));
    assert.equal(err.code, 'weak-master-key');
  }
});

test('values that are not a whole key are refused, passphrases included', () => {
  // Base64 decoding accepts prose, so a permissive decoder would stretch any of
  // these into a 256-bit costume over a guessable secret. Each is caught by a
  // different rule: a character outside the alphabets, too few bytes, and a byte
  // count that is not a round key size.
  //
  // The limit, stated because it is real: a 44-character string from the base64
  // alphabet that decodes to exactly 32 bytes is structurally a key, and no rule
  // here can tell it from one. That hole is closed by the `openssl` line in the
  // failure message, not by a regex.
  for (const attempt of [
    'correct horse battery staple correct horse battery',
    'changeme-changeme-changeme-changeme',
    'this_is_a_very_long_passphrase_but_only_ascii_words',
    "hunter2!'; DROP TABLE keys; --",
  ]) {
    assert.equal(
      secretsConfigured(env({ [SECRET_KEY_ENV]: attempt })),
      false,
      `accepted a passphrase: ${attempt}`,
    );
  }
});

test('hex and base64 keys of 32 bytes or more are accepted', () => {
  assert.ok(secretsConfigured(env({ [SECRET_KEY_ENV]: randomBytes(32).toString('hex') })));
  assert.ok(secretsConfigured(env({ [SECRET_KEY_ENV]: randomBytes(32).toString('base64url') })));
  assert.ok(secretsConfigured(env({ [SECRET_KEY_ENV]: randomBytes(48).toString('base64') })));
});

test('secretsConfigured never throws, whatever it is given', () => {
  assert.equal(secretsConfigured(env({ [SECRET_KEY_ENV]: undefined })), false);
  assert.equal(secretsConfigured(env({ [SECRET_KEY_ENV]: '' })), false);
  assert.equal(secretsConfigured(env({ [SECRET_KEY_ENV]: '   ' })), false);
});

/* ------------------------------------------------------------------- the seal */

test('a sealed key round-trips for its own owner and provider', () => {
  const ref = { owner: ALICE, provider: 'anthropic' };
  const sealed = sealSecret(ALICE_KEY, ref);
  assert.equal(openSecret(sealed, ref), ALICE_KEY);
});

test('the sealed record does not contain the key, in any encoding', () => {
  const sealed = sealSecret(ALICE_KEY, { owner: ALICE, provider: 'anthropic' });
  const serialised = JSON.stringify(sealed);
  assert.ok(!serialised.includes(ALICE_KEY), 'the plaintext is in the record');
  assert.ok(
    !serialised.includes(Buffer.from(ALICE_KEY, 'utf8').toString('base64')),
    'the plaintext is in the record, base64-encoded',
  );
  // Nor does it name its owner: the owner is an input to decryption, not a field.
  assert.ok(!serialised.includes(ALICE), 'the record names its owner');
});

test('every write uses a fresh IV and a fresh data key', () => {
  const ref = { owner: ALICE, provider: 'anthropic' };
  const first = sealSecret(ALICE_KEY, ref);
  const second = sealSecret(ALICE_KEY, ref);
  // The same plaintext under the same master key. Identical ciphertext would mean
  // a reused IV, which turns AES-GCM into a stream cipher with a published
  // keystream — and would leak that two accounts hold the same key.
  assert.notEqual(first.data.iv, second.data.iv);
  assert.notEqual(first.data.ct, second.data.ct);
  assert.notEqual(first.wrap.iv, second.wrap.iv);
  assert.notEqual(first.wrap.ct, second.wrap.ct);
});

test('a tampered ciphertext fails to open rather than returning garbage', () => {
  const ref = { owner: ALICE, provider: 'anthropic' };
  const sealed = sealSecret(ALICE_KEY, ref);
  const flipped = Buffer.from(sealed.data.ct, 'base64');
  flipped.writeUInt8(flipped.readUInt8(0) ^ 0x01, 0);
  assert.throws(
    () => openSecret({ ...sealed, data: { ...sealed.data, ct: flipped.toString('base64') } }, ref),
    (err: unknown) => isSecretsError(err) && err.code === 'tampered',
  );
});

test('a tampered IV fails to open', () => {
  const ref = { owner: ALICE, provider: 'anthropic' };
  const sealed = sealSecret(ALICE_KEY, ref);
  const iv = Buffer.from(sealed.data.iv, 'base64');
  iv.writeUInt8(iv.readUInt8(0) ^ 0x80, 0);
  assert.throws(
    () => openSecret({ ...sealed, data: { ...sealed.data, iv: iv.toString('base64') } }, ref),
    (err: unknown) => isSecretsError(err) && err.code === 'tampered',
  );
});

test('a tampered auth tag fails to open', () => {
  const ref = { owner: ALICE, provider: 'anthropic' };
  const sealed = sealSecret(ALICE_KEY, ref);
  const tag = Buffer.from(sealed.data.tag, 'base64');
  tag.writeUInt8(tag.readUInt8(tag.length - 1) ^ 0x01, tag.length - 1);
  assert.throws(
    () => openSecret({ ...sealed, data: { ...sealed.data, tag: tag.toString('base64') } }, ref),
    (err: unknown) => isSecretsError(err) && err.code === 'tampered',
  );
});

test('a truncated IV or tag is one answer, not a distinguishable error', () => {
  const ref = { owner: ALICE, provider: 'anthropic' };
  const sealed = sealSecret(ALICE_KEY, ref);
  for (const broken of [
    { ...sealed, data: { ...sealed.data, iv: Buffer.alloc(8).toString('base64') } },
    { ...sealed, data: { ...sealed.data, tag: Buffer.alloc(4).toString('base64') } },
    { ...sealed, wrap: { ...sealed.wrap, tag: Buffer.alloc(1).toString('base64') } },
  ]) {
    assert.throws(
      () => openSecret(broken, ref),
      (err: unknown) => isSecretsError(err) && err.code === 'tampered',
      'a malformed record was distinguishable from an unauthentic one',
    );
  }
});

test('a tampered wrapped data key fails, so the envelope is authenticated too', () => {
  const ref = { owner: ALICE, provider: 'anthropic' };
  const sealed = sealSecret(ALICE_KEY, ref);
  const ct = Buffer.from(sealed.wrap.ct, 'base64');
  ct.writeUInt8(ct.readUInt8(3) ^ 0x10, 3);
  assert.throws(
    () => openSecret({ ...sealed, wrap: { ...sealed.wrap, ct: ct.toString('base64') } }, ref),
    (err: unknown) => isSecretsError(err) && err.code === 'tampered',
  );
});

test('a record re-tagged to another owner fails to open — the AAD binding', () => {
  // The property the whole design rests on. Both AEAD layers bind to the owner
  // digest, and the AAD is built from the owner the *caller* asked for, so there
  // is no way to present Alice's record as Bob's.
  const sealed = sealSecret(ALICE_KEY, { owner: ALICE, provider: 'anthropic' });
  assert.throws(
    () => openSecret(sealed, { owner: BOB, provider: 'anthropic' }),
    (err: unknown) => isSecretsError(err) && err.code === 'tampered',
  );
});

test('a record moved to another provider fails to open', () => {
  // The mistake this catches is a store that keys by owner and trusts the record's
  // own `provider` field: an ElevenLabs slot would then serve an Anthropic key to
  // a stage that logs its own 401s.
  const sealed = sealSecret(ALICE_KEY, { owner: ALICE, provider: 'anthropic' });
  assert.throws(
    () =>
      openSecret({ ...sealed, provider: 'elevenlabs' }, { owner: ALICE, provider: 'elevenlabs' }),
    (err: unknown) => isSecretsError(err) && err.code === 'tampered',
  );
});

test('a record sealed under a different master key fails to open', () => {
  const ref = { owner: ALICE, provider: 'anthropic' };
  const sealed = sealSecret(
    ALICE_KEY,
    ref,
    env({ [SECRET_KEY_ENV]: randomBytes(32).toString('hex') }),
  );
  assert.throws(
    () => openSecret(sealed, ref),
    (err: unknown) => isSecretsError(err) && err.code === 'tampered',
  );
});

test('an owner digest that is not one is refused before it can name a file', () => {
  for (const owner of ['../../etc/passwd', 'short', '', 'a/b/c', `${ALICE}/..`]) {
    assert.throws(
      () => sealSecret(ALICE_KEY, { owner, provider: 'anthropic' }),
      (err: unknown) => isSecretsError(err) && err.code === 'rejected',
      `accepted an owner digest: ${JSON.stringify(owner)}`,
    );
  }
});

test('an empty or oversized key is refused rather than stored', () => {
  assert.throws(
    () => sealSecret('   ', { owner: ALICE, provider: 'anthropic' }),
    (err: unknown) => isSecretsError(err) && err.code === 'rejected',
  );
  assert.throws(
    () => sealSecret('x'.repeat(8193), { owner: ALICE, provider: 'anthropic' }),
    (err: unknown) => isSecretsError(err) && err.code === 'rejected',
  );
});

/* ------------------------------------------------------------------- the hint */

test('the hint is the last four characters and nothing more', () => {
  const hint = secretHint(ALICE_KEY);
  assert.equal(hint, `••••${ALICE_KEY.slice(-4)}`);
  // Not the provider prefix, not a leading fragment: this one is served over the
  // network from a shared box, unlike the local vault's richer preview.
  assert.ok(!hint.includes('sk-ant'), `the hint carries a prefix: ${hint}`);
  assert.equal(hint.replace(/•/g, '').length, 4);
});

test('a key too short to spare four characters shows none of them', () => {
  assert.equal(secretHint('abc'), '••••');
  assert.equal(secretHint('sk-shortish'), '••••');
});

/* ------------------------------------------------------------------ the store */

test('the store round-trips through the filesystem, per owner', async () => {
  const alice = await writeOwnerSecret({ owner: ALICE, provider: 'anthropic' }, ALICE_KEY);
  assert.equal(alice.provider, 'anthropic');
  assert.equal(alice.length, ALICE_KEY.length);
  assert.equal(alice.hint, `••••${ALICE_KEY.slice(-4)}`);

  await writeOwnerSecret({ owner: BOB, provider: 'elevenlabs' }, BOB_KEY);

  assert.equal(await readOwnerKey({ owner: ALICE, provider: 'anthropic' }), ALICE_KEY);
  assert.equal(await readOwnerKey({ owner: BOB, provider: 'elevenlabs' }), BOB_KEY);
});

test('one account cannot read another account through the store', async () => {
  // Bob asking for the provider Alice configured gets "nothing", not Alice's key.
  assert.equal(await readOwnerKey({ owner: BOB, provider: 'anthropic' }), undefined);
  assert.equal(await readOwnerSummary({ owner: BOB, provider: 'anthropic' }), undefined);
  const bobs = await listOwnerSecrets(BOB);
  assert.deepEqual(
    bobs.map((entry) => entry.provider),
    ['elevenlabs'],
  );
});

test('one account cannot overwrite or delete another account entry', async () => {
  await writeOwnerSecret({ owner: BOB, provider: 'anthropic' }, BOB_KEY);
  // Bob writing the provider Alice also uses does not touch Alice's record.
  assert.equal(await readOwnerKey({ owner: ALICE, provider: 'anthropic' }), ALICE_KEY);

  assert.equal(await deleteOwnerSecret({ owner: BOB, provider: 'anthropic' }), true);
  assert.equal(await readOwnerKey({ owner: BOB, provider: 'anthropic' }), undefined);
  // Still Alice's, still hers.
  assert.equal(await readOwnerKey({ owner: ALICE, provider: 'anthropic' }), ALICE_KEY);
});

test('a record physically moved into another account file does not open', async () => {
  // The end-to-end form of the AAD test above: not a hand-built call with the
  // wrong owner, but the bytes actually sitting in the wrong file — which is what
  // a restore from the wrong backup, or a helpful hand-edit, produces.
  const files = await readdir(secretsDir());
  const contents = await Promise.all(
    files
      .filter((name) => name.endsWith('.json'))
      .map(async (name) => {
        const full = path.join(secretsDir(), name);
        return { full, parsed: JSON.parse(await readFile(full, 'utf8')) };
      }),
  );
  const alice = contents.find((entry) => entry.parsed.keys.anthropic !== undefined);
  const bob = contents.find((entry) => entry.parsed.keys.elevenlabs !== undefined);
  assert.ok(alice && bob, 'expected one file per account');
  assert.notEqual(alice.full, bob.full);

  bob.parsed.keys.anthropic = alice.parsed.keys.anthropic;
  await writeFile(bob.full, JSON.stringify(bob.parsed), 'utf8');

  await assert.rejects(
    readOwnerKey({ owner: BOB, provider: 'anthropic' }),
    (err: unknown) => isSecretsError(err) && err.code === 'tampered',
    'a moved record decrypted for the wrong account',
  );
  // And the metadata beside it is still only metadata: a stolen record shows a
  // hint and a length because those were never encrypted, and yields no key.
  const summary = await readOwnerSummary({ owner: BOB, provider: 'anthropic' });
  assert.equal(summary?.hint, `••••${ALICE_KEY.slice(-4)}`);
});

test('the store directory and its files are not readable by anyone else', async () => {
  const dir = await stat(secretsDir());
  assert.equal(dir.mode & 0o777, 0o700, 'the key directory is not 0700');
  const files = (await readdir(secretsDir())).filter((name) => name.endsWith('.json'));
  assert.ok(files.length > 0);
  for (const name of files) {
    const file = await stat(path.join(secretsDir(), name));
    assert.equal(file.mode & 0o777, 0o600, `${name} is not 0600`);
  }
  // The same `*`-only guard `@inkcast/keyvault` writes beside its vault, because
  // this directory can be pointed anywhere by INKCAST_SECRETS_DIR.
  assert.equal((await readFile(path.join(secretsDir(), '.gitignore'), 'utf8')).trim(), '*');
});

test('replacing a key keeps the stored-since date and moves the updated one', async () => {
  const before = await readOwnerSummary({ owner: ALICE, provider: 'anthropic' });
  assert.ok(before);
  await new Promise((resolve) => setTimeout(resolve, 2));
  const after = await writeOwnerSecret({ owner: ALICE, provider: 'anthropic' }, `${ALICE_KEY}2`);
  assert.equal(after.createdAt, before.createdAt);
  assert.notEqual(after.updatedAt, before.updatedAt);
  assert.equal(await readOwnerKey({ owner: ALICE, provider: 'anthropic' }), `${ALICE_KEY}2`);
});

test('a validation verdict is recorded per account, and a re-paste clears it', async () => {
  await markOwnerSecretValidated({ owner: ALICE, provider: 'anthropic' }, true);
  const checked = await readOwnerSummary({ owner: ALICE, provider: 'anthropic' });
  assert.equal(checked?.validatedOk, true);
  assert.ok(checked?.validatedAt);

  // A different key was pasted, so yesterday's verdict is about a value that is no
  // longer stored. Carrying it forward would report a check that never ran.
  const replaced = await writeOwnerSecret({ owner: ALICE, provider: 'anthropic' }, ALICE_KEY);
  assert.equal(replaced.validatedOk, undefined);
  assert.equal(replaced.validatedAt, undefined);
});

test('marking a provider nobody stored is a no-op, not a written record', async () => {
  await markOwnerSecretValidated({ owner: BOB, provider: 'replicate' }, true);
  assert.equal(await readOwnerSummary({ owner: BOB, provider: 'replicate' }), undefined);
});

test('concurrent writes for one account do not lose a key', async () => {
  // The lost-update shape `projects/index.json` had: two providers saved at once,
  // read-modify-write on one file, and the loser vanishes with a 200.
  const providers = ['anthropic', 'elevenlabs', 'replicate', 'fal'];
  await Promise.all(
    providers.map((provider) =>
      writeOwnerSecret({ owner: BOB, provider }, `${BOB_KEY}-${provider}`),
    ),
  );
  const stored = (await listOwnerSecrets(BOB)).map((entry) => entry.provider);
  assert.deepEqual(stored, [...providers].sort());
  for (const provider of providers) {
    assert.equal(await readOwnerKey({ owner: BOB, provider }), `${BOB_KEY}-${provider}`);
  }
});

test('an unparseable file reads as empty rather than breaking the page', async () => {
  const stranger = randomBytes(32).toString('base64url');
  await writeOwnerSecret({ owner: stranger, provider: 'fal' }, `${ALICE_KEY}-fal`);
  const files = await readdir(secretsDir());
  const mine = (
    await Promise.all(
      files
        .filter((name) => name.endsWith('.json'))
        .map(async (name) => {
          const full = path.join(secretsDir(), name);
          const parsed = JSON.parse(await readFile(full, 'utf8'));
          return { full, hit: Object.keys(parsed.keys).length === 1 && parsed.keys.fal };
        }),
    )
  ).find((entry) => entry.hit);
  assert.ok(mine);
  await writeFile(mine.full, '{ this is not json', 'utf8');
  assert.deepEqual(await listOwnerSecrets(stranger), []);
  assert.equal(await readOwnerKey({ owner: stranger, provider: 'fal' }), undefined);

  // And a save against that damaged file does not leak into the *next* account
  // whose file is absent. The bug this pins had no cipher in it: one shared empty
  // object, read by every miss and mutated by every write.
  await writeOwnerSecret({ owner: stranger, provider: 'fal' }, `${ALICE_KEY}-again`);
  const nobody = randomBytes(32).toString('base64url');
  assert.deepEqual(await listOwnerSecrets(nobody), []);
  assert.equal(await readOwnerKey({ owner: nobody, provider: 'fal' }), undefined);
});

test('SecretsError never carries the key or the master key in its message', () => {
  const sealed = sealSecret(ALICE_KEY, { owner: ALICE, provider: 'anthropic' });
  try {
    openSecret(sealed, { owner: BOB, provider: 'anthropic' });
    assert.fail('opened');
  } catch (err) {
    assert.ok(err instanceof SecretsError);
    const dump = `${err.message}\n${err.stack ?? ''}`;
    assert.ok(!dump.includes(ALICE_KEY), 'the key is in the error');
    assert.ok(!dump.includes(MASTER), 'the master key is in the error');
    assert.ok(!dump.includes(ALICE), 'the owner digest is in the error');
  }
});
