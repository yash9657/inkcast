import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchPublicText, isPublicAddress, publicDestination } from '../src/public-fetch.js';

test('shared URL ingestion rejects local, metadata, mapped IPv4, reserved and embedded-auth destinations', async () => {
  for (const address of [
    '127.0.0.1',
    '10.3.4.5',
    '169.254.169.254',
    '100.100.100.200',
    '192.168.1.1',
    '172.16.3.4',
    '0.0.0.0',
    '198.18.0.1',
    '224.0.0.1',
    '::1',
    '::ffff:127.0.0.1',
    'fe80::1',
    'fd00::1',
    '2001:db8::1',
    '2002:7f00:1::',
  ])
    assert.equal(isPublicAddress(address), false, address);
  for (const url of [
    'http://127.1/',
    'http://2130706433/',
    'http://[::1]/',
    'http://user:password@example.com/',
    'file:///etc/passwd',
  ])
    await assert.rejects(fetchPublicText(new URL(url)));
});

test('DNS answers must all be public; the selected public address is returned for socket pinning', async () => {
  const url = new URL('https://example.com');
  await assert.rejects(
    publicDestination(url, async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ]),
  );
  assert.deepEqual(await publicDestination(url, async () => [{ address: '8.8.8.8', family: 4 }]), {
    address: '8.8.8.8',
    family: 4,
  });
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
});

test('redirects cannot enter a private network after a public first hop', async (t) => {
  const { default: http } = await import('node:http');
  const { EventEmitter } = await import('node:events');
  const { PassThrough } = await import('node:stream');
  let requests = 0;
  t.mock.method(http, 'get', (_url: URL, _options: unknown, respond: (value: unknown) => void) => {
    requests++;
    const request = new EventEmitter();
    queueMicrotask(() => {
      const response = Object.assign(new PassThrough(), {
        statusCode: 302,
        headers: { location: 'http://169.254.169.254/latest/meta-data/' },
      });
      respond(response);
    });
    return request;
  });
  await assert.rejects(fetchPublicText(new URL('http://8.8.8.8/')), /private or reserved/);
  assert.equal(requests, 1, 'a request reached the redirected private destination');
});

test('public source responses are bounded by bytes actually received', async (t) => {
  const { default: http } = await import('node:http');
  const { EventEmitter } = await import('node:events');
  const { PassThrough } = await import('node:stream');
  t.mock.method(http, 'get', (_url: URL, _options: unknown, respond: (value: unknown) => void) => {
    const request = new EventEmitter();
    queueMicrotask(() => {
      const response = Object.assign(new PassThrough(), {
        statusCode: 200,
        headers: { 'content-type': 'text/plain' },
      });
      respond(response);
      response.end(Buffer.alloc(8 * 1024 * 1024 + 1, 'a'));
    });
    return request;
  });
  await assert.rejects(fetchPublicText(new URL('http://8.8.8.8/')), /exceeds 8 MB/);
});
