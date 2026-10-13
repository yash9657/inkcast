import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';

import {
  RenderServiceBusy,
  STALE_AFTER_MS,
  bearerMatches,
  blobPrefix,
  blobStorageEnabled,
  callRenderService,
  isActiveJob,
  newJob,
  projectKey,
  settleStale,
  type RenderEvent,
  type RenderRequest,
} from '../src/index.js';

test('blob storage is off unless asked for', () => {
  assert.equal(blobStorageEnabled({}), false);
  assert.equal(blobStorageEnabled({ INKCAST_STORAGE: 'local' }), false);
  assert.equal(blobStorageEnabled({ INKCAST_STORAGE: 'blob' }), true);
});

test('the prefix defaults, and refuses anything that could escape it', () => {
  assert.equal(blobPrefix({}), 'inkcast');
  assert.equal(blobPrefix({ INKCAST_BLOB_PREFIX: 'preview' }), 'preview');
  assert.throws(() => blobPrefix({ INKCAST_BLOB_PREFIX: '../x' }));
  assert.throws(() => blobPrefix({ INKCAST_BLOB_PREFIX: 'a/b' }));
});

test('project keys stay inside their project', () => {
  assert.equal(projectKey('inkcast', 'abc123', 'out.mp4'), 'inkcast/projects/abc123/out.mp4');
  assert.equal(
    projectKey('inkcast', 'abc123', 'source/notes.md'),
    'inkcast/projects/abc123/source/notes.md',
  );
  assert.throws(() => projectKey('inkcast', 'abc123', '../meta.json'));
  assert.throws(() => projectKey('inkcast', '..', 'out.mp4'));
  assert.throws(() => projectKey('inkcast', 'abc', 'a//b'));
});

test('the bearer check needs a real token and the right one', () => {
  const token = 'x'.repeat(32);
  assert.equal(bearerMatches(`Bearer ${token}`, token), true);
  assert.equal(bearerMatches(`bearer ${token}`, token), true);
  assert.equal(bearerMatches('Bearer nope', token), false);
  assert.equal(bearerMatches(null, token), false);
  // An unset or short token refuses everything rather than admitting everything.
  assert.equal(bearerMatches('Bearer ', undefined), false);
  assert.equal(bearerMatches('Bearer short', 'short'), false);
});

test('a silent unfinished job is presumed dead, a finished one is left alone', () => {
  const now = Date.now();
  const fresh = { ...newJob('p1', 'cast', 'running'), updatedAt: new Date(now).toISOString() };
  assert.equal(isActiveJob(fresh, now), true);
  assert.equal(settleStale(fresh, now), fresh);

  const silent = { ...fresh, updatedAt: new Date(now - STALE_AFTER_MS - 1).toISOString() };
  assert.equal(isActiveJob(silent, now), false);
  const settled = settleStale(silent, now);
  assert.equal(settled.status, 'error');
  assert.match(settled.failure?.error ?? '', /presumed lost/);

  const done = { ...silent, status: 'done' as const };
  assert.equal(settleStale(done, now), done);
});

const request: RenderRequest = {
  projectId: 'p1',
  blobPrefix: 'inkcast',
  kind: 'cast',
  input: { text: 'hello' },
};

async function serve(
  handler: Parameters<typeof createServer>[1],
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

test('the client reads progress lines split across chunks and returns the terminal one', async () => {
  const server = await serve((req, res) => {
    assert.equal(req.headers.authorization, 'Bearer t0ken');
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    res.write('{"type":"accepted"}\n{"type":"progress","progress":{"stage":"voice"');
    setTimeout(() => {
      res.write(',"pct":40}}\n{"type":"heartbeat"}\n');
      res.end('{"type":"done","result":{"videoPath":"out.mp4","durationSec":70}}');
    }, 10);
  });
  try {
    const seen: RenderEvent['type'][] = [];
    const terminal = await callRenderService(server.url, 't0ken', request, (e) =>
      seen.push(e.type),
    );
    assert.deepEqual(seen, ['accepted', 'progress', 'heartbeat', 'done']);
    assert.equal(terminal.type, 'done');
  } finally {
    await server.close();
  }
});

test('a busy instance is a retryable error, a dead stream is not a success', async () => {
  const busy = await serve((_req, res) => {
    res.writeHead(503).end('busy');
  });
  try {
    await assert.rejects(
      callRenderService(busy.url, 't', request, () => {}),
      RenderServiceBusy,
    );
  } finally {
    await busy.close();
  }

  const dies = await serve((_req, res) => {
    res.writeHead(200);
    res.end('{"type":"progress","progress":{"stage":"render","pct":70}}\n');
  });
  try {
    await assert.rejects(
      callRenderService(dies.url, 't', request, () => {}),
      /closed the connection before the film finished/,
    );
  } finally {
    await dies.close();
  }
});

test('render dispatch refuses redirects instead of replaying credentials', async () => {
  let received = 0;
  const target = await serve((_req, res) => {
    received++;
    res.end();
  });
  const redirect = await serve((_req, res) => {
    res.writeHead(307, { location: target.url }).end();
  });
  try {
    await assert.rejects(
      callRenderService(
        redirect.url,
        'dispatch-token',
        {
          ...request,
          isolated: true,
          providerEnv: { FIREWORKS_API_KEY: 'private-account-key' },
        },
        () => {},
      ),
    );
    assert.equal(received, 0);
  } finally {
    await redirect.close();
    await target.close();
  }
});

test('a render-service HTTP error cannot reflect submitted keys', async () => {
  const service = await serve((_req, res) => res.writeHead(500).end('private-account-key'));
  try {
    await assert.rejects(
      callRenderService(
        service.url,
        'dispatch-token',
        {
          ...request,
          providerEnv: { FIREWORKS_API_KEY: 'private-account-key' },
        },
        () => {},
      ),
      (error: Error) => {
        assert.match(error.message, /500/);
        assert.ok(!error.message.includes('private-account-key'));
        return true;
      },
    );
  } finally {
    await service.close();
  }
});
