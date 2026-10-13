import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';

import { callRenderService, RenderServiceBusy, type RenderRequest } from '@inkcast/cloud';

import { createRenderServer, type Runner } from '../src/server.js';

const TOKEN = 'a'.repeat(40);

const request: RenderRequest = {
  projectId: 'abc123',
  blobPrefix: 'inkcast',
  kind: 'cast',
  input: { text: 'Why is the sky blue?' },
};

async function start(run: Runner, token: string | undefined = TOKEN) {
  const server = createRenderServer({ token, run, heartbeatMs: 5 });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    server,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test('health answers without a token', async () => {
  const s = await start(async () => ({ type: 'done', result: { videoPath: 'out.mp4' } }));
  try {
    const res = await fetch(`${s.url}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, service: 'inkcast-render', busy: false });
  } finally {
    await s.close();
  }
});

test('a run needs the token, a configured token, and a valid body', async () => {
  let ran = 0;
  const run: Runner = async () => {
    ran += 1;
    return { type: 'done', result: { videoPath: 'out.mp4' } };
  };

  const s = await start(run);
  try {
    const wrong = await fetch(`${s.url}/run`, {
      method: 'POST',
      headers: { authorization: 'Bearer nope' },
      body: JSON.stringify(request),
    });
    assert.equal(wrong.status, 401);

    const bad = await fetch(`${s.url}/run`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ ...request, projectId: '../etc' }),
    });
    assert.equal(bad.status, 400);

    const extra = await fetch(`${s.url}/run`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ ...request, input: { text: 'x', filePath: '/etc/passwd' } }),
    });
    assert.equal(extra.status, 400, 'an absolute filePath is not part of the wire format');
    assert.equal(ran, 0);
  } finally {
    await s.close();
  }

  const unconfigured = await start(run, '');
  try {
    const res = await fetch(`${unconfigured.url}/run`, {
      method: 'POST',
      headers: { authorization: 'Bearer ' },
      body: JSON.stringify(request),
    });
    assert.equal(res.status, 503);
  } finally {
    await unconfigured.close();
  }
});

test('progress streams to the caller, and a second film on a busy instance is refused', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const run: Runner = async (_req, emit) => {
    emit({ type: 'progress', progress: { stage: 'render', pct: 50 } });
    await gate;
    return { type: 'done', result: { videoPath: 'out.mp4', durationSec: 72 } };
  };
  const s = await start(run);
  try {
    const seen: string[] = [];
    const first = callRenderService(s.url, TOKEN, request, (e) => seen.push(e.type));
    // Wait until the first run is in flight.
    for (let i = 0; i < 100 && !s.server.busy(); i++) await new Promise((r) => setTimeout(r, 5));
    assert.equal(s.server.busy(), true);
    await assert.rejects(
      callRenderService(s.url, TOKEN, request, () => {}),
      RenderServiceBusy,
    );

    release();
    const terminal = await first;
    assert.equal(terminal.type, 'done');
    assert.ok(seen.includes('accepted'));
    assert.ok(seen.includes('progress'));
    assert.equal(s.server.busy(), false);
  } finally {
    await s.close();
  }
});

test('a runner that throws still ends the stream with an error line', async () => {
  const s = await start(async () => {
    throw new Error('provider reflected secret-do-not-disclose');
  });
  try {
    const terminal = await callRenderService(s.url, TOKEN, request, () => {});
    assert.deepEqual(terminal, {
      type: 'error',
      failure: { error: 'The render failed unexpectedly. Check the service configuration.' },
    });
  } finally {
    await s.close();
  }
});
