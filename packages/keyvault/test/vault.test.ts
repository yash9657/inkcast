/**
 * Storage: round-trip, tamper detection, permissions, and the repo guard.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createKeyvault, isKeyvaultError, lock } from '../src/index.js';
import { FAKE, sandbox } from './helpers.js';

test('set/get round-trips through the encrypted vault', async () => {
  const box = sandbox();
  try {
    const kv = createKeyvault(box.opts());
    await kv.setKey('anthropic', FAKE.anthropic);
    assert.equal(await kv.getKey('anthropic'), FAKE.anthropic);

    // A second instance proves the value survives the file, not a cache.
    const fresh = createKeyvault(box.opts());
    assert.equal(await fresh.getKey('anthropic'), FAKE.anthropic);
  } finally {
    lock();
    box.cleanup();
  }
});

test('every provider round-trips independently', async () => {
  const box = sandbox();
  try {
    const kv = createKeyvault(box.opts());
    const keys = {
      anthropic: FAKE.anthropic,
      elevenlabs: FAKE.elevenlabs,
      replicate: FAKE.replicate,
      fal: FAKE.fal,
    } as const;
    for (const [provider, key] of Object.entries(keys)) await kv.setKey(provider, key);
    for (const [provider, key] of Object.entries(keys)) {
      assert.equal(await kv.getKey(provider), key, provider);
    }
    assert.equal(await kv.deleteKey('replicate'), true);
    assert.equal(await kv.getKey('replicate'), undefined);
    // Deleting one entry must not disturb the others.
    assert.equal(await kv.getKey('anthropic'), FAKE.anthropic);
    assert.equal(await kv.deleteKey('replicate'), false, 'second delete reports nothing removed');
  } finally {
    lock();
    box.cleanup();
  }
});

test('the vault never contains the plaintext key', async () => {
  const box = sandbox();
  try {
    await createKeyvault(box.opts()).setKey('anthropic', FAKE.anthropic);
    const raw = readFileSync(box.vaultPath, 'utf8');
    assert.ok(!raw.includes(FAKE.anthropic), 'plaintext key found in the vault file');
    // Not even a substantial fragment of it.
    assert.ok(!raw.includes(FAKE.anthropic.slice(8, 32)), 'key fragment found in the vault file');
    assert.ok(raw.includes('aes') === false, 'the cipher name is not the payload');
    const parsed = JSON.parse(raw);
    assert.equal(parsed.kdf.name, 'scrypt');
    assert.ok(parsed.kdf.salt.length > 0, 'a per-vault salt is recorded');
    assert.ok(parsed.entries.anthropic.tag, 'the entry carries a GCM auth tag');
  } finally {
    lock();
    box.cleanup();
  }
});

test('each vault gets its own random salt', async () => {
  const a = sandbox();
  const b = sandbox();
  try {
    await createKeyvault(a.opts()).setKey('anthropic', FAKE.anthropic);
    await createKeyvault(b.opts()).setKey('anthropic', FAKE.anthropic);
    const saltA = JSON.parse(readFileSync(a.vaultPath, 'utf8')).kdf.salt;
    const saltB = JSON.parse(readFileSync(b.vaultPath, 'utf8')).kdf.salt;
    assert.notEqual(saltA, saltB, 'two vaults share a salt');
    // Same key, same passphrase, different salt and IV -> different ciphertext.
    const ctA = JSON.parse(readFileSync(a.vaultPath, 'utf8')).entries.anthropic.ct;
    const ctB = JSON.parse(readFileSync(b.vaultPath, 'utf8')).entries.anthropic.ct;
    assert.notEqual(ctA, ctB, 'identical keys produced identical ciphertext');
  } finally {
    lock();
    a.cleanup();
    b.cleanup();
  }
});

test('tampered ciphertext is rejected, not silently ignored', async () => {
  const box = sandbox();
  try {
    await createKeyvault(box.opts()).setKey('anthropic', FAKE.anthropic);

    const vault = JSON.parse(readFileSync(box.vaultPath, 'utf8'));
    // Flip one bit of the ciphertext.
    const ct = Buffer.from(vault.entries.anthropic.ct, 'base64');
    ct.writeUInt8(ct.readUInt8(0) ^ 0x01, 0);
    vault.entries.anthropic.ct = ct.toString('base64');
    writeFileSync(box.vaultPath, JSON.stringify(vault, null, 2));

    lock();
    await assert.rejects(
      () => createKeyvault(box.opts()).getKey('anthropic'),
      (err: unknown) => isKeyvaultError(err, 'tampered'),
      'a flipped ciphertext bit must raise `tampered`',
    );
  } finally {
    lock();
    box.cleanup();
  }
});

test('a tampered auth tag is rejected', async () => {
  const box = sandbox();
  try {
    await createKeyvault(box.opts()).setKey('anthropic', FAKE.anthropic);
    const vault = JSON.parse(readFileSync(box.vaultPath, 'utf8'));
    const tag = Buffer.from(vault.entries.anthropic.tag, 'base64');
    tag.writeUInt8(tag.readUInt8(15) ^ 0xff, 15);
    vault.entries.anthropic.tag = tag.toString('base64');
    writeFileSync(box.vaultPath, JSON.stringify(vault, null, 2));

    lock();
    await assert.rejects(
      () => createKeyvault(box.opts()).getKey('anthropic'),
      (err: unknown) => isKeyvaultError(err, 'tampered'),
    );
  } finally {
    lock();
    box.cleanup();
  }
});

test('the AAD binds a ciphertext to its provider and its masked preview', async () => {
  const box = sandbox();
  try {
    const kv = createKeyvault(box.opts());
    await kv.setKey('anthropic', FAKE.anthropic);
    await kv.setKey('replicate', FAKE.replicate);

    // Move the anthropic envelope onto the replicate entry. Without AAD binding
    // this would decrypt cleanly and hand out the wrong provider's key.
    const vault = JSON.parse(readFileSync(box.vaultPath, 'utf8'));
    const stolen = vault.entries.anthropic;
    vault.entries.replicate = {
      ...vault.entries.replicate,
      iv: stolen.iv,
      ct: stolen.ct,
      tag: stolen.tag,
    };
    writeFileSync(box.vaultPath, JSON.stringify(vault, null, 2));

    lock();
    await assert.rejects(
      () => createKeyvault(box.opts()).getKey('replicate'),
      (err: unknown) => isKeyvaultError(err, 'tampered'),
      'a relocated ciphertext must fail authentication',
    );
  } finally {
    lock();
    box.cleanup();
  }
});

test('editing the masked preview breaks authentication', async () => {
  const box = sandbox();
  try {
    await createKeyvault(box.opts()).setKey('anthropic', FAKE.anthropic);
    const vault = JSON.parse(readFileSync(box.vaultPath, 'utf8'));
    vault.entries.anthropic.masked = 'sk-ant-api03-XX…dead';
    writeFileSync(box.vaultPath, JSON.stringify(vault, null, 2));

    lock();
    await assert.rejects(
      () => createKeyvault(box.opts()).getKey('anthropic'),
      (err: unknown) => isKeyvaultError(err, 'tampered'),
    );
  } finally {
    lock();
    box.cleanup();
  }
});

test('a wrong passphrase is reported as such, not as tampering', async () => {
  const box = sandbox();
  try {
    await createKeyvault(box.opts()).setKey('anthropic', FAKE.anthropic);
    lock();
    await assert.rejects(
      () =>
        createKeyvault(box.opts({ passphrase: 'wrong passphrase entirely' })).getKey('anthropic'),
      (err: unknown) => isKeyvaultError(err, 'bad-passphrase'),
      'the verifier exists so this is distinguishable from a modified file',
    );
  } finally {
    lock();
    box.cleanup();
  }
});

test('a missing passphrase degrades to "no key" instead of crashing a stage', async () => {
  const box = sandbox();
  try {
    await createKeyvault(box.opts()).setKey('anthropic', FAKE.anthropic);
    lock();
    // No passphrase, no env, not interactive: a pipeline stage asking for an
    // optional upgrade key must get `undefined` and fall back to local.
    const kv = createKeyvault({
      backend: 'vault',
      vaultPath: box.vaultPath,
      metaPath: box.metaPath,
      env: {},
      track: false,
    });
    assert.equal(await kv.getKey('anthropic'), undefined);
    // But an explicit write still refuses, because that needs a real decision.
    await assert.rejects(
      () => kv.setKey('anthropic', FAKE.anthropic),
      (err: unknown) => isKeyvaultError(err, 'passphrase-required'),
    );
  } finally {
    lock();
    box.cleanup();
  }
});

test('the vault and the sidecar are owner-only', async () => {
  const box = sandbox();
  try {
    const kv = createKeyvault(box.opts());
    await kv.setKey('anthropic', FAKE.anthropic);
    await kv.listProviders();
    assert.equal(statSync(box.vaultPath).mode & 0o777, 0o600, 'vault should be mode 600');
    assert.equal(
      statSync(box.metaPath).mode & 0o077,
      0,
      'sidecar should not be group/world readable',
    );
    // The vault directory carries a blanket .gitignore.
    const ignore = readFileSync(path.join(box.dir, '.gitignore'), 'utf8');
    assert.match(ignore, /^\*$/m, 'the vault directory must blanket-ignore itself');
  } finally {
    lock();
    box.cleanup();
  }
});

test('a vault path inside a git repository is refused', async () => {
  const box = sandbox();
  try {
    const repo = path.join(box.dir, 'checkout');
    mkdirSync(path.join(repo, '.git'), { recursive: true });
    const inside = path.join(repo, 'sub', 'vault.json');
    const kv = createKeyvault({
      backend: 'vault',
      vaultPath: inside,
      metaPath: box.metaPath,
      passphrase: 'pw pw pw pw',
      env: {},
      track: false,
    });
    await assert.rejects(
      () => kv.setKey('anthropic', FAKE.anthropic),
      (err: unknown) => isKeyvaultError(err, 'vault-in-repo'),
    );

    // ...and the documented escape hatch works, for someone who really means it.
    const forced = createKeyvault({
      backend: 'vault',
      vaultPath: inside,
      metaPath: box.metaPath,
      passphrase: 'pw pw pw pw',
      env: { INKCAST_VAULT_ALLOW_IN_REPO: '1' },
      track: false,
    });
    await forced.setKey('anthropic', FAKE.anthropic);
    assert.equal(await forced.getKey('anthropic'), FAKE.anthropic);
  } finally {
    lock();
    box.cleanup();
  }
});

test('a corrupt vault file is reported clearly', async () => {
  const box = sandbox();
  try {
    mkdirSync(path.dirname(box.vaultPath), { recursive: true });
    writeFileSync(box.vaultPath, '{ this is not json');
    await assert.rejects(
      () => createKeyvault(box.opts()).getKey('anthropic'),
      (err: unknown) => isKeyvaultError(err, 'corrupt-vault'),
    );
    writeFileSync(box.vaultPath, JSON.stringify({ version: 99, entries: {} }));
    await assert.rejects(
      () => createKeyvault(box.opts()).getKey('anthropic'),
      (err: unknown) => isKeyvaultError(err, 'corrupt-vault'),
    );
  } finally {
    lock();
    box.cleanup();
  }
});

test('keys with control characters are rejected before they reach a backend', async () => {
  const box = sandbox();
  try {
    const kv = createKeyvault(box.opts());
    for (const bad of [`${FAKE.anthropic}\nrm -rf /`, `sk-ant- abc`, '   ', '']) {
      await assert.rejects(
        () => kv.setKey('anthropic', bad),
        (err: unknown) => isKeyvaultError(err, 'invalid-key'),
        JSON.stringify(bad),
      );
    }
    // Surrounding whitespace is a paste artefact, not an error.
    await kv.setKey('anthropic', `  ${FAKE.anthropic}\t`);
    assert.equal(await kv.getKey('anthropic'), FAKE.anthropic);
  } finally {
    lock();
    box.cleanup();
  }
});

test('an unknown provider is rejected with a list of the valid ones', async () => {
  const box = sandbox();
  try {
    await assert.rejects(
      () => createKeyvault(box.opts()).getKey('openai'),
      /unknown provider "openai".*anthropic, elevenlabs, replicate, fal/s,
    );
  } finally {
    box.cleanup();
  }
});
