/**
 * Vault tests. Real AES-GCM, real scrypt, a real temp directory — no fakes,
 * because the properties worth testing here are exactly the ones a fake removes.
 *
 *   node --import tsx --test 'apps/web/app/api/keys/_vault/*.test.ts'
 *
 * Run from the repo root. The imports are deliberately relative and free of the
 * `@/` alias so this file needs nothing but Node and tsx — `store.ts` and
 * `crypto.ts` carry no framework dependency for the same reason.
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  decodeVaultKey,
  generateSalt,
  generateVaultKey,
  deriveKeyFromPassphrase,
  isSealed,
  scrub,
  seal,
  unseal,
} from './crypto.js';
import { forgetVault, openVault, type VaultEnv } from './store.js';
import { maskSecret } from '../../../../components/settings/catalog.js';

/** Shaped like a real Anthropic key so the format-aware redaction is exercised. */
const ANTHROPIC = `sk-ant-api03-${'A9bQ'.repeat(18)}`;
const REPLICATE = `r8_${'k3J'.repeat(12)}`;

async function tempVault(env: VaultEnv = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'inkcast-vault-'));
  forgetVault(dir);
  return {
    dir,
    vault: openVault(dir, env),
    async cleanup() {
      forgetVault(dir);
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/* ------------------------------------------------------------------- crypto */

test('a sealed secret round-trips and is nothing like the plaintext', () => {
  const key = decodeVaultKey(generateVaultKey());
  const sealed = seal(ANTHROPIC, key);

  assert.ok(isSealed(sealed));
  assert.equal(unseal(sealed, key), ANTHROPIC);
  const serialised = JSON.stringify(sealed);
  assert.ok(!serialised.includes(ANTHROPIC), 'ciphertext must not contain the key');
  assert.ok(!serialised.includes('sk-ant'), 'not even the recognisable prefix');
});

test('sealing the same secret twice produces different ciphertext', () => {
  const key = decodeVaultKey(generateVaultKey());
  const a = seal(ANTHROPIC, key);
  const b = seal(ANTHROPIC, key);
  assert.notEqual(a.iv, b.iv, 'a fresh nonce every time');
  assert.notEqual(a.data, b.data);
  assert.equal(unseal(a, key), unseal(b, key));
});

test('unsealing with the wrong key returns undefined rather than throwing', () => {
  const sealed = seal(ANTHROPIC, decodeVaultKey(generateVaultKey()));
  assert.equal(unseal(sealed, decodeVaultKey(generateVaultKey())), undefined);
});

test('a tampered ciphertext fails the authentication tag', () => {
  const key = decodeVaultKey(generateVaultKey());
  const sealed = seal(ANTHROPIC, key);
  const flipped = Buffer.from(sealed.data, 'base64');
  flipped.writeUInt8(flipped.readUInt8(0) ^ 0xff, 0);
  assert.equal(unseal({ ...sealed, data: flipped.toString('base64') }, key), undefined);
});

test('passphrase derivation is deterministic per salt and not across salts', () => {
  const salt = generateSalt();
  assert.deepEqual(
    deriveKeyFromPassphrase('a shared secret', salt),
    deriveKeyFromPassphrase('a shared secret', salt),
  );
  assert.notDeepEqual(
    deriveKeyFromPassphrase('a shared secret', salt),
    deriveKeyFromPassphrase('a shared secret', generateSalt()),
  );
});

test('decodeVaultKey rejects material of the wrong length', () => {
  assert.throws(() => decodeVaultKey(Buffer.alloc(16).toString('base64')), /32 bytes/);
});

/* ---------------------------------------------------------------- redaction */

test('scrub removes a held secret', () => {
  const message = `the provider rejected ${ANTHROPIC} at 09:00`;
  const cleaned = scrub(message, [ANTHROPIC]);
  assert.ok(!cleaned.includes(ANTHROPIC));
  assert.ok(cleaned.includes('[redacted]'));
  assert.ok(cleaned.includes('at 09:00'), 'the rest of the message survives');
});

test('scrub removes key-shaped text even with no secret in hand', () => {
  for (const shaped of [ANTHROPIC, REPLICATE, 'sk_0123456789abcdefghijklmno']) {
    const cleaned = scrub(`unexpected: ${shaped}`);
    assert.ok(!cleaned.includes(shaped), `${shaped.slice(0, 6)} must be redacted`);
  }
});

test('scrub leaves ordinary prose alone and caps length', () => {
  assert.equal(scrub('ElevenLabs rejected the key.'), 'ElevenLabs rejected the key.');
  assert.equal(scrub('short'.repeat(200)).length, 401, '400 characters plus an ellipsis');
});

/* -------------------------------------------------------------------- masks */

test('a mask shows the public prefix and hides the whole middle', () => {
  const mask = maskSecret(ANTHROPIC);
  // `sk-ant-api03-` carries no entropy — every Anthropic key has it — so it is
  // shown in full. Of the body, only two leading and four trailing characters.
  assert.equal(mask, 'sk-ant-api03-A9…A9bQ');
  assert.notEqual(mask, ANTHROPIC);

  // The invariant that actually matters: no contiguous run from the middle of the
  // key ever appears in the preview.
  const body = ANTHROPIC.slice('sk-ant-api03-'.length);
  for (let start = 2; start + 8 <= body.length - 4; start += 1) {
    assert.ok(!mask.includes(body.slice(start, start + 8)), `mask leaked a run at ${start}`);
  }
});

test('a short body is bulleted rather than partially shown', () => {
  // The prefix is public and still shown; nothing of the body is.
  assert.equal(maskSecret('r8_short'), 'r8_••••••');
  assert.equal(maskSecret('nopfx'), '••••••');
});

test('an absent secret masks to the empty string, not to bullets', () => {
  // A caller has to be able to tell "no key" from "a key I am not showing you".
  assert.equal(maskSecret(''), '');
  assert.equal(maskSecret(undefined), '');
});

/* -------------------------------------------------------------------- store */

test('a written key can be read back, and the file never holds plaintext', async () => {
  const { dir, vault, cleanup } = await tempVault();
  try {
    const summary = await vault.write('anthropic', ANTHROPIC);
    assert.equal(summary.length, ANTHROPIC.length);
    assert.equal(summary.mask, maskSecret(ANTHROPIC), 'store and catalog masks agree');

    const read = await vault.read('anthropic');
    assert.deepEqual(read, { ok: true, key: ANTHROPIC });

    const onDisk = await readFile(path.join(dir, 'keys.json'), 'utf8');
    assert.ok(!onDisk.includes(ANTHROPIC), 'the key itself is never written');
    // The mask legitimately carries the public prefix, so the real check is that
    // no secret-bearing run survives anywhere in the file.
    assert.ok(!onDisk.includes(ANTHROPIC.slice(20, 44)), 'no usable fragment either');
    assert.ok(onDisk.includes(summary.mask), 'the mask is stored so listing needs no key');
  } finally {
    await cleanup();
  }
});

test('list reports every key, masked, without unsealing anything', async () => {
  const { dir, vault, cleanup } = await tempVault();
  try {
    await vault.write('anthropic', ANTHROPIC);
    await vault.write('replicate', REPLICATE);

    // Remove the unsealing material entirely: listing must still work, which is
    // the property that makes GET /api/keys structurally unable to leak.
    await rm(path.join(dir, 'vault.key'));
    const listed = await vault.list();
    assert.deepEqual(
      listed.map((entry) => entry.id),
      ['anthropic', 'replicate'],
    );
    assert.equal(listed[0]?.mask, maskSecret(ANTHROPIC));
    assert.deepEqual(await vault.read('anthropic'), { ok: false, reason: 'unreadable' });
  } finally {
    await cleanup();
  }
});

test('the vault and its key file are readable by their owner only', async () => {
  const { dir, vault, cleanup } = await tempVault();
  try {
    await vault.write('anthropic', ANTHROPIC);
    for (const name of ['keys.json', 'vault.key']) {
      const mode = (await stat(path.join(dir, name))).mode & 0o777;
      assert.equal(mode, 0o600, `${name} should be 0600, found ${mode.toString(8)}`);
    }
  } finally {
    await cleanup();
  }
});

test('reading a provider that was never saved reports missing, not unreadable', async () => {
  const { vault, cleanup } = await tempVault();
  try {
    assert.deepEqual(await vault.read('fal'), { ok: false, reason: 'missing' });
  } finally {
    await cleanup();
  }
});

test('remove deletes one key and leaves the others intact', async () => {
  const { vault, cleanup } = await tempVault();
  try {
    await vault.write('anthropic', ANTHROPIC);
    await vault.write('replicate', REPLICATE);

    assert.equal(await vault.remove('anthropic'), true);
    assert.equal(await vault.remove('anthropic'), false, 'removing twice is not an error');
    assert.deepEqual(await vault.read('anthropic'), { ok: false, reason: 'missing' });
    assert.deepEqual(await vault.read('replicate'), { ok: true, key: REPLICATE });
  } finally {
    await cleanup();
  }
});

test('overwriting a key replaces it', async () => {
  const { vault, cleanup } = await tempVault();
  try {
    await vault.write('anthropic', ANTHROPIC);
    const replacement = `${ANTHROPIC}-second`;
    await vault.write('anthropic', replacement);
    assert.deepEqual(await vault.read('anthropic'), { ok: true, key: replacement });
    assert.equal((await vault.list()).length, 1);
  } finally {
    await cleanup();
  }
});

test('concurrent writes all survive', async () => {
  const { vault, cleanup } = await tempVault();
  try {
    // Read-modify-write on one JSON file is where a lost update would happen.
    await Promise.all([
      vault.write('anthropic', ANTHROPIC),
      vault.write('replicate', REPLICATE),
      vault.write('fal', `${'ab'.repeat(16)}:${'cd'.repeat(8)}`),
      vault.write('elevenlabs', 'e'.repeat(32)),
    ]);
    assert.equal((await vault.list()).length, 4);
    assert.deepEqual(await vault.read('replicate'), { ok: true, key: REPLICATE });
  } finally {
    await cleanup();
  }
});

test('a passphrase seals the vault with no key file at all', async () => {
  const { dir, vault, cleanup } = await tempVault({
    INKCAST_VAULT_SECRET: 'correct horse battery',
  });
  try {
    await vault.write('anthropic', ANTHROPIC);
    assert.equal(await vault.kdf(), 'passphrase');
    await assert.rejects(stat(path.join(dir, 'vault.key')), 'no key file is created');
    assert.deepEqual(await vault.read('anthropic'), { ok: true, key: ANTHROPIC });

    // A different passphrase cannot open it, and says so instead of pretending
    // the key was never there.
    forgetVault(dir);
    const wrong = openVault(dir, { INKCAST_VAULT_SECRET: 'not the passphrase' });
    assert.deepEqual(await wrong.read('anthropic'), { ok: false, reason: 'unreadable' });
  } finally {
    await cleanup();
  }
});

test('adding a passphrase later re-keys what can still be read', async () => {
  const { dir, cleanup } = await tempVault();
  try {
    const before = openVault(dir, {});
    await before.write('anthropic', ANTHROPIC);
    await before.write('replicate', REPLICATE);

    // The user sets INKCAST_VAULT_SECRET and saves one key again.
    forgetVault(dir);
    const after = openVault(dir, { INKCAST_VAULT_SECRET: 'a new passphrase' });
    await after.write('elevenlabs', 'e'.repeat(32));

    assert.equal(await after.kdf(), 'passphrase');
    assert.deepEqual(await after.read('anthropic'), { ok: true, key: ANTHROPIC });
    assert.deepEqual(await after.read('replicate'), { ok: true, key: REPLICATE });
    assert.deepEqual(await after.read('elevenlabs'), { ok: true, key: 'e'.repeat(32) });
  } finally {
    await cleanup();
  }
});

test('one corrupt entry does not hide the others', async () => {
  const { dir, vault, cleanup } = await tempVault();
  try {
    await vault.write('anthropic', ANTHROPIC);
    await vault.write('replicate', REPLICATE);

    const file = path.join(dir, 'keys.json');
    const parsed = JSON.parse(await readFile(file, 'utf8')) as {
      entries: Record<string, unknown>;
    };
    parsed.entries.replicate = { mask: 'r8_abc…wxyz' }; // no `sealed`
    await writeFile(file, JSON.stringify(parsed));

    const listed = await vault.list();
    assert.deepEqual(
      listed.map((entry) => entry.id),
      ['anthropic'],
      'the salvageable entry survives',
    );
    assert.deepEqual(await vault.read('anthropic'), { ok: true, key: ANTHROPIC });
  } finally {
    await cleanup();
  }
});

test('an unparseable vault file reads as empty rather than throwing', async () => {
  const { dir, vault, cleanup } = await tempVault();
  try {
    await vault.write('anthropic', ANTHROPIC);
    await writeFile(path.join(dir, 'keys.json'), '{ this is not json');
    assert.deepEqual(await vault.list(), []);
    assert.deepEqual(await vault.read('anthropic'), { ok: false, reason: 'missing' });
  } finally {
    await cleanup();
  }
});

test('a key is stored trimmed, because a pasted key carries whitespace', async () => {
  const { vault, cleanup } = await tempVault();
  try {
    const summary = await vault.write('anthropic', `  ${ANTHROPIC}\n`);
    assert.equal(summary.length, ANTHROPIC.length);
    assert.deepEqual(await vault.read('anthropic'), { ok: true, key: ANTHROPIC });
  } finally {
    await cleanup();
  }
});
