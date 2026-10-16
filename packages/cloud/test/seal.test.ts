import assert from 'node:assert/strict';
import { test } from 'node:test';

import { openRun, sealRun } from '../src/seal.js';

const token = 'a-render-token-of-at-least-24-chars';

test('a sealed run opens with the same token and with no other', () => {
  const request = { projectId: 'abc', providerEnv: { ANTHROPIC_API_KEY: 'sk-secret' } };
  const sealed = sealRun(request, token);
  assert.ok(!sealed.toString('latin1').includes('sk-secret'));
  assert.deepEqual(openRun(sealed, token), request);
  assert.throws(() => openRun(sealed, `${token}x`));
  sealed.writeUInt8(sealed.readUInt8(sealed.length - 1) ^ 1, sealed.length - 1);
  assert.throws(() => openRun(sealed, token));
  assert.throws(() => sealRun(request, 'short'));
});
