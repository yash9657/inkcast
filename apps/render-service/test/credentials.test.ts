import assert from 'node:assert/strict';
import test from 'node:test';
import { RenderRequestSchema, type RenderRequest } from '@inkcast/cloud';
import { providerEnvFor } from '../src/run.js';
const request: RenderRequest = {
  projectId: 'film1',
  blobPrefix: 'inkcast',
  kind: 'cast',
  input: { text: 'hello' },
  isolated: true,
};
const specs = { fireworks: { envVars: ['FIREWORKS_API_KEY'] } };

test('isolated render requests never fall back to operator credentials', () => {
  assert.equal(RenderRequestSchema.safeParse(request).success, false);
  assert.throws(() => providerEnvFor(request, specs), /credential scope/);
  const before = process.env.FIREWORKS_API_KEY;
  process.env.FIREWORKS_API_KEY = 'operator-key';
  try {
    const env = providerEnvFor({ ...request, providerEnv: {} }, specs)!;
    assert.equal(env.FIREWORKS_API_KEY, undefined);
    assert.equal(env.INKCAST_PUBLIC_SOURCES, '1');
    const own = providerEnvFor(
      {
        ...request,
        providerEnv: { FIREWORKS_API_KEY: 'account-key', INKCAST_PUBLIC_SOURCES: '0' },
      },
      specs,
    )!;
    assert.equal(own.FIREWORKS_API_KEY, 'account-key');
    assert.equal(own.INKCAST_PUBLIC_SOURCES, '1');
  } finally {
    if (before === undefined) delete process.env.FIREWORKS_API_KEY;
    else process.env.FIREWORKS_API_KEY = before;
  }
});

test('account render wire refuses repository file reads', () => {
  assert.equal(
    RenderRequestSchema.safeParse({
      ...request,
      providerEnv: {},
      input: { repoPath: 'private.env' },
    }).success,
    false,
  );
});
