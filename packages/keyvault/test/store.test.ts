/**
 * Masking, env precedence, listing and validation behaviour.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  createKeyvault,
  describeValidation,
  keychainAvailable,
  listProviders,
  lock,
  mask,
  maskedMiddle,
  PROVIDERS,
  PROVIDER_SPECS,
  storageInfo,
} from '../src/index.js';
import { FAKE, sandbox } from './helpers.js';

/* ------------------------------------------------------------------- masking */

test('masking never reveals the middle of a key', () => {
  for (const key of Object.values(FAKE)) {
    const masked = mask(key);
    const middle = maskedMiddle(key);

    assert.ok(!masked.includes(key), `the whole key leaked: ${masked}`);
    assert.ok(middle.length >= 4, `too little was withheld from ${key}`);
    assert.ok(!masked.includes(middle), `the withheld middle appeared in ${masked}`);

    // The invariant is *positional*, and has to be asserted that way: a
    // content-only check gives false positives because real keys repeat short
    // runs (FAKE.elevenlabs ends with a 4-character run that also occurs
    // mid-key, so "does this run appear in the preview" is not the question).
    // What matters is that the preview is exactly the complement of the withheld
    // region — a leading slice and a trailing slice of the key, nothing else.
    const [head, tail, ...extra] = masked.split('…');
    assert.equal(extra.length, 0, `${masked} has more than one elision`);
    assert.ok(head !== undefined && tail !== undefined, `${masked} has no elision marker`);
    assert.ok(key.startsWith(head!), `"${head}" is not a prefix of the key`);
    assert.ok(key.endsWith(tail!), `"${tail}" is not a suffix of the key`);
    // Shown + withheld accounts for the whole key, so nothing from the withheld
    // span is on screen and exactly 2 body + 4 trailing characters are.
    assert.equal(
      head!.length + middle.length + tail!.length,
      key.length,
      `${masked} does not account for every character of the key`,
    );
    assert.equal(tail!.length, 4, `${masked} shows ${tail!.length} trailing characters`);
  }
});

test('masking hides the body entirely when a key is short', () => {
  for (const short of ['abcd', 'sk-abc', 'sk-ant-xy', '12345678']) {
    const masked = mask(short);
    const body = short.replace(/^(sk-ant-|sk-)/, '');
    assert.ok(!masked.includes(body), `${masked} revealed the body of ${short}`);
    assert.match(masked, /•{6}/, `${masked} should be fully bulleted`);
  }
});

test('masking keeps the public prefix so keys stay recognisable', () => {
  assert.ok(mask(FAKE.anthropic).startsWith('sk-ant-api03-'), mask(FAKE.anthropic));
  assert.ok(mask(FAKE.replicate).startsWith('r8_'), mask(FAKE.replicate));
  assert.equal(mask(''), '', 'no key means no preview');
  assert.equal(mask(undefined), '');
});

/* --------------------------------------------------------------- precedence */

test('getKey resolves the vault before the environment', async () => {
  const box = sandbox();
  try {
    const stored = FAKE.anthropic;
    const exported = 'sk-ant-api03-InJeCtEd0000111122223333444455556666777788889999';

    await createKeyvault(box.opts()).setKey('anthropic', stored);
    assert.equal(await createKeyvault(box.opts()).getKey('anthropic'), stored);

    // Same vault, and the variable is exported too: the pasted key still wins —
    // a stale shell export must not keep running renders on the wrong account.
    const withEnv = createKeyvault(box.opts({ env: { ANTHROPIC_API_KEY: exported } }));
    assert.equal(await withEnv.getKey('anthropic'), stored, 'the stored key must take precedence');

    // And the listing says so, so the overridden variable is never invisible.
    const status = (await withEnv.listProviders()).find((p) => p.provider === 'anthropic');
    assert.equal(status?.source, 'vault');
    assert.equal(status?.masked, mask(stored));
    assert.equal(status?.overridesEnv, true);
  } finally {
    lock();
    box.cleanup();
  }
});

test('the environment supplies a key when nothing is stored', async () => {
  const box = sandbox();
  try {
    const kv = createKeyvault(box.opts({ env: { REPLICATE_API_TOKEN: FAKE.replicate } }));
    assert.equal(await kv.getKey('replicate'), FAKE.replicate);
    assert.equal(await kv.getKey('anthropic'), undefined);
  } finally {
    box.cleanup();
  }
});

test('an empty or whitespace-only env var counts as unset', async () => {
  const box = sandbox();
  try {
    await createKeyvault(box.opts()).setKey('anthropic', FAKE.anthropic);
    for (const value of ['', '   ']) {
      const kv = createKeyvault(box.opts({ env: { ANTHROPIC_API_KEY: value } }));
      assert.equal(
        await kv.getKey('anthropic'),
        FAKE.anthropic,
        `an exported-but-empty var must not shadow the stored key (${JSON.stringify(value)})`,
      );
    }
  } finally {
    lock();
    box.cleanup();
  }
});

test("fal's older env var name is still honoured", async () => {
  const box = sandbox();
  try {
    const kv = createKeyvault(box.opts({ env: { FAL_API_KEY: FAKE.fal } }));
    assert.equal(await kv.getKey('fal'), FAKE.fal);
    // FAL_KEY is canonical and wins when both are present.
    const both = createKeyvault(
      box.opts({ env: { FAL_KEY: FAKE.fal, FAL_API_KEY: 'aaaa-bbbb:cccc' } }),
    );
    assert.equal(await both.getKey('fal'), FAKE.fal);
  } finally {
    box.cleanup();
  }
});

/* ------------------------------------------------------------------ listing */

test('listProviders never returns a raw key', async () => {
  const box = sandbox();
  try {
    const kv = createKeyvault(box.opts({ env: { ELEVENLABS_API_KEY: FAKE.elevenlabs } }));
    await kv.setKey('anthropic', FAKE.anthropic);
    await kv.setKey('fal', FAKE.fal);

    const list = await kv.listProviders();
    const serialised = JSON.stringify(list);
    for (const key of [FAKE.anthropic, FAKE.fal, FAKE.elevenlabs]) {
      assert.ok(!serialised.includes(key), `a raw key appeared in the listing: ${serialised}`);
    }

    assert.deepEqual(
      list.map((p) => p.provider),
      [...PROVIDERS],
      'every provider is reported, configured or not',
    );

    const byId = new Map(list.map((p) => [p.provider, p]));
    assert.equal(byId.get('anthropic')?.configured, true);
    assert.equal(byId.get('anthropic')?.source, 'vault');
    assert.equal(byId.get('anthropic')?.masked, mask(FAKE.anthropic));
    assert.equal(byId.get('elevenlabs')?.source, 'env');
    assert.equal(byId.get('replicate')?.configured, false);
    assert.equal(byId.get('replicate')?.masked, null);
    assert.equal(byId.get('replicate')?.source, null);
    assert.equal(byId.get('replicate')?.lastValidated, null);
  } finally {
    lock();
    box.cleanup();
  }
});

test('listProviders needs no passphrase, and says a locked key is not usable', async () => {
  const box = sandbox();
  try {
    await createKeyvault(box.opts()).setKey('anthropic', FAKE.anthropic);
    lock();
    // Deliberate design property: which providers have an entry, and their masked
    // previews, are readable without unlocking the vault. This must never prompt.
    const list = await listProviders({
      backend: 'vault',
      vaultPath: box.vaultPath,
      metaPath: box.metaPath,
      env: {},
      track: false,
    });
    const anthropic = list.find((p) => p.provider === 'anthropic');
    assert.equal(anthropic?.masked, mask(FAKE.anthropic));
    assert.equal(anthropic?.length, FAKE.anthropic.length);

    // ...but an entry no passphrase can open is *not* configured, because that is
    // what the pipeline will experience: `getKey()` degrades to undefined here.
    // Calling it configured is what let a saved key look usable while every
    // render silently ran locally.
    assert.equal(anthropic?.availability, 'locked');
    assert.equal(anthropic?.configured, false);
    assert.equal(anthropic?.source, null);
  } finally {
    lock();
    box.cleanup();
  }
});

test('listProviders reports a readable key as configured, with its provenance', async () => {
  const box = sandbox();
  try {
    await createKeyvault(box.opts()).setKey('anthropic', FAKE.anthropic);
    const anthropic = (await listProviders(box.opts())).find((p) => p.provider === 'anthropic');

    assert.equal(anthropic?.availability, 'stored');
    assert.equal(anthropic?.configured, true);
    assert.equal(anthropic?.source, 'vault');
    assert.equal(anthropic?.envVar, 'ANTHROPIC_API_KEY');
    assert.equal(anthropic?.length, FAKE.anthropic.length);
    assert.equal(anthropic?.shadowedByEnv, false);
    assert.ok(anthropic?.updatedAt, 'a stored key records when it was set');
    assert.equal(anthropic?.lastValidatedOk, null, 'never validated yet');
  } finally {
    lock();
    box.cleanup();
  }
});

test('a stored key overriding the environment is reported as doing so', async () => {
  const box = sandbox();
  try {
    await createKeyvault(box.opts()).setKey('anthropic', FAKE.anthropic);
    // The same provider supplied by the environment as well. The stored key
    // wins, so the exported variable is inert — and a user who cannot see that
    // has no way to explain why changing it changes nothing.
    const ambient = 'sk-ant-api03-EnvLosesEnvLosesEnvLosesEnvLoses012345';
    const anthropic = (await listProviders(box.opts({ env: { ANTHROPIC_API_KEY: ambient } }))).find(
      (p) => p.provider === 'anthropic',
    );

    assert.equal(anthropic?.availability, 'stored');
    assert.equal(anthropic?.source, 'vault');
    assert.equal(anthropic?.configured, true);
    assert.equal(anthropic?.overridesEnv, true);
    assert.equal(anthropic?.shadowedByEnv, false);
    assert.equal(anthropic?.masked, mask(FAKE.anthropic), 'the preview is of the key in use');
    assert.equal(anthropic?.length, FAKE.anthropic.length);
  } finally {
    lock();
    box.cleanup();
  }
});

test('an unusable stored entry is shadowed by an environment key', async () => {
  const box = sandbox();
  try {
    await createKeyvault(box.opts()).setKey('anthropic', FAKE.anthropic);
    lock();
    // No passphrase available: the stored key cannot be read, so the environment
    // supplies the key in use — and the listing must say a stored entry is
    // sitting behind it, because editing that entry changes nothing.
    const ambient = 'sk-ant-api03-EnvActsAsFallback000011112222333344445555';
    const anthropic = (
      await listProviders({
        backend: 'vault',
        vaultPath: box.vaultPath,
        metaPath: box.metaPath,
        env: { ANTHROPIC_API_KEY: ambient },
        track: false,
      })
    ).find((p) => p.provider === 'anthropic');

    assert.equal(anthropic?.availability, 'env');
    assert.equal(anthropic?.source, 'env');
    assert.equal(anthropic?.configured, true);
    assert.equal(anthropic?.shadowedByEnv, true);
    assert.equal(anthropic?.overridesEnv, false);
    assert.equal(anthropic?.masked, mask(ambient), 'the preview is of the key in use');
  } finally {
    lock();
    box.cleanup();
  }
});

test('an edited vault entry is reported unreadable rather than absent', async () => {
  const box = sandbox();
  try {
    await createKeyvault(box.opts()).setKey('anthropic', FAKE.anthropic);
    lock();

    // Flip a byte of the ciphertext. GCM authentication catches it, and the remedy
    // ("paste it again") differs from a missing passphrase ("set one"), so the two
    // must not collapse into a single verdict.
    const file = JSON.parse(readFileSync(box.vaultPath, 'utf8')) as {
      entries: Record<string, { ct: string }>;
    };
    const ct = Buffer.from(file.entries.anthropic!.ct, 'base64');
    ct[0] = ct[0]! ^ 0xff;
    file.entries.anthropic!.ct = ct.toString('base64');
    writeFileSync(box.vaultPath, JSON.stringify(file, null, 2));

    const anthropic = (await listProviders(box.opts())).find((p) => p.provider === 'anthropic');
    assert.equal(anthropic?.availability, 'unreadable');
    assert.equal(anthropic?.configured, false);
    assert.equal(anthropic?.masked, mask(FAKE.anthropic), 'the preview still identifies it');
  } finally {
    lock();
    box.cleanup();
  }
});

/* ------------------------------------------------------------- storage info */

test('storageInfo describes the vault backend from the vault itself', () => {
  const box = sandbox();
  try {
    const info = storageInfo(box.opts());
    assert.equal(info.backend, 'vault');
    assert.equal(info.path, box.vaultPath);
    assert.equal(info.cipher, 'aes-256-gcm');
    assert.equal(info.kdf?.name, 'scrypt');
    assert.equal(info.metaPath, box.metaPath);
  } finally {
    box.cleanup();
  }
});

test(
  'storageInfo names no file on the keychain backend',
  {
    skip: keychainAvailable() ? false : 'no macOS keychain on this platform',
  },
  () => {
    const info = storageInfo({ backend: 'keychain', env: {} });
    assert.equal(info.backend, 'keychain');
    // Nothing is written, so a settings page must not promise a file that does not
    // exist. Null is the honest answer, not a path nobody will find.
    assert.equal(info.path, null);
    assert.equal(info.cipher, null);
    assert.equal(info.kdf, null);
  },
);

test('rotating a key updates the preview and clears the stale verdict', async () => {
  const box = sandbox();
  try {
    const kv = createKeyvault(box.opts());
    await kv.setKey('replicate', FAKE.replicate);
    const rotated = 'r8_ZzYyXxWwVvUuTtSsRrQqPpOoNnMmLlKkJj';
    await kv.setKey('replicate', rotated);

    assert.equal(await kv.getKey('replicate'), rotated);
    const status = (await kv.listProviders()).find((p) => p.provider === 'replicate');
    assert.equal(status?.masked, mask(rotated));
    assert.notEqual(status?.masked, mask(FAKE.replicate));
    assert.equal(status?.lastValidated, null, 'a rotated key must not inherit a green tick');
  } finally {
    lock();
    box.cleanup();
  }
});

/* --------------------------------------------------------------- validation */

test('validateKey reports "not configured" without touching the network', async () => {
  const box = sandbox();
  try {
    const result = await createKeyvault(box.opts()).validateKey('anthropic');
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'not-configured');
    assert.equal(result.status, undefined);
    assert.match(describeValidation(result), /no key configured/);
  } finally {
    box.cleanup();
  }
});

test('every provider has a validation probe and a documented env var', () => {
  for (const provider of PROVIDERS) {
    const spec = PROVIDER_SPECS[provider];
    assert.ok(spec.envVars.length > 0, `${provider} has no env var`);
    assert.ok(spec.console.startsWith('https://'), `${provider} has no console URL`);
    assert.ok(
      describeValidation({ provider, ok: false, reason: 'rejected' }).includes(provider),
      `${provider} has no readable validation summary`,
    );
  }
});

test('validation summaries never carry a key and read correctly', () => {
  const lines = [
    describeValidation({ provider: 'anthropic', ok: true, reason: 'accepted', source: 'env' }),
    describeValidation({ provider: 'fal', ok: true, reason: 'rate-limited', source: 'vault' }),
    describeValidation({
      provider: 'replicate',
      ok: false,
      reason: 'rejected',
      status: 401,
      message: 'You did not pass a valid authentication token',
    }),
    describeValidation({
      provider: 'elevenlabs',
      ok: false,
      reason: 'network',
      message: 'offline',
    }),
  ];
  assert.match(lines[0]!, /accepted \(from env\)/);
  assert.match(lines[1]!, /rate limited/);
  assert.match(lines[2]!, /rejected/);
  assert.match(lines[3]!, /could not reach/);
  for (const line of lines) {
    for (const key of Object.values(FAKE)) assert.ok(!line.includes(key));
  }
});
