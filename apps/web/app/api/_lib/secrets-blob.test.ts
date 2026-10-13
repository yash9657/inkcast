import assert from 'node:assert/strict';
import test from 'node:test';
import { blobEmulator } from '../../../../../packages/cloud/test/blob-emulator.js';
import {
  deleteOwnerSecret,
  markOwnerSecretValidated,
  readOwnerKey,
  readOwnerSummary,
  writeOwnerSecret,
} from './secrets.js';

const env: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  INKCAST_STORAGE: 'blob',
  INKCAST_SECRET_KEY: 'a'.repeat(64),
};
const owner = 'b'.repeat(43);
const fireworks = { owner, provider: 'fireworks' as const };
const elevenlabs = { owner, provider: 'elevenlabs' as const };

test('account Blob keys survive simultaneous saves, replacement and stale validation', async () => {
  const blob = blobEmulator();
  try {
    await Promise.all([
      writeOwnerSecret(fireworks, 'fireworks-original-key', env),
      writeOwnerSecret(elevenlabs, 'elevenlabs-original-key', env),
    ]);
    assert.equal(await readOwnerKey(fireworks, env), 'fireworks-original-key');
    assert.equal(await readOwnerKey(elevenlabs, env), 'elevenlabs-original-key');
    await Promise.all([
      writeOwnerSecret(fireworks, 'fireworks-replacement-key', env),
      deleteOwnerSecret(elevenlabs, env),
    ]);
    await markOwnerSecretValidated(fireworks, true, env, 'fireworks-original-key');
    assert.equal((await readOwnerSummary(fireworks, env))?.validatedOk, undefined);
    assert.equal(await readOwnerKey(fireworks, env), 'fireworks-replacement-key');
    assert.equal(await readOwnerKey(elevenlabs, env), undefined);
    assert.equal(await readOwnerKey({ ...fireworks, owner: 'c'.repeat(43) }, env), undefined);
    const stored = [...blob.records.values()].map((v) => v.body).join();
    assert.ok(!stored.includes('fireworks-replacement-key'));
  } finally {
    await blob.close();
  }
});

test('corrupted Blob credentials cannot be replaced as an empty account', async () => {
  const blob = blobEmulator();
  try {
    await writeOwnerSecret(fireworks, 'fireworks-original-key', env);
    const key = [...blob.records.keys()][0]!;
    for (const body of ['{broken', '{"v":1,"keys":{"fireworks":{}}}']) {
      blob.records.set(key, { body, etag: 'corrupt' });
      const writes = blob.writes;
      await assert.rejects(writeOwnerSecret(elevenlabs, 'elevenlabs-new-key', env));
      await assert.rejects(readOwnerKey(fireworks, env));
      assert.equal(blob.writes, writes);
    }
  } finally {
    await blob.close();
  }
});
