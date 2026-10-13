/** In-memory HTTP boundary for the real Blob SDK; never reaches a live store. */
import '@vercel/blob';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sdkRequire = createRequire(require.resolve('@vercel/blob'));
const { MockAgent, getGlobalDispatcher, setGlobalDispatcher } = sdkRequire('undici');

export function blobEmulator(allowLoopback = false) {
  // Initialise Node's lazy fetch globals before installing the SDK dispatcher.
  new Headers();
  const before = getGlobalDispatcher();
  const agent = new MockAgent();
  agent.disableNetConnect();
  if (allowLoopback) agent.enableNetConnect(/^127\.0\.0\.1:\d+$/);
  setGlobalDispatcher(agent);
  const saved = { ...process.env };
  process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_teststore_synthetic';
  process.env.INKCAST_BLOB_ACCESS = 'private';
  process.env.VERCEL_BLOB_RETRIES = '0';
  process.env.VERCEL_BLOB_API_URL = 'https://blob-test.invalid';
  const records = new Map<string, { body: string | Buffer; etag: string }>();
  let version = 0;
  let writes = 0;
  agent
    .get('https://teststore.private.blob.vercel-storage.com')
    .intercept({ path: /.*/, method: 'GET' })
    .reply(({ path }: { path: string }) => {
      const key = new URL(path, 'https://test.invalid').pathname.slice(1);
      const record = records.get(key);
      return record
        ? {
            statusCode: 200,
            data: record.body,
            responseOptions: { headers: { etag: record.etag } },
          }
        : { statusCode: 404, data: '' };
    })
    .persist();
  agent
    .get('https://blob-test.invalid')
    .intercept({ path: /.*/, method: 'PUT' })
    .reply(
      ({
        path,
        body,
        headers,
      }: {
        path: string;
        body: string | Uint8Array;
        headers: Record<string, string>;
      }) => {
        const key = new URL(path, 'https://test.invalid').searchParams.get('pathname')!;
        const current = records.get(key);
        const h = new Headers(headers);
        if (
          (h.get('x-if-match') && h.get('x-if-match') !== current?.etag) ||
          (h.get('x-allow-overwrite') === '0' && current)
        ) {
          return {
            statusCode: 412,
            data: JSON.stringify({ error: { code: 'precondition_failed' } }),
          };
        }
        const etag = `"${++version}"`;
        records.set(key, {
          body: body instanceof Uint8Array ? Buffer.from(body) : String(body),
          etag,
        });
        writes++;
        return {
          statusCode: 200,
          data: JSON.stringify({
            pathname: key,
            etag,
            url: `https://teststore.private.blob.vercel-storage.com/${key}`,
          }),
        };
      },
    )
    .persist();
  return {
    records,
    get writes() {
      return writes;
    },
    async close() {
      setGlobalDispatcher(before);
      for (const name of [
        'BLOB_READ_WRITE_TOKEN',
        'INKCAST_BLOB_ACCESS',
        'VERCEL_BLOB_RETRIES',
        'VERCEL_BLOB_API_URL',
      ]) {
        if (saved[name] === undefined) delete process.env[name];
        else process.env[name] = saved[name];
      }
      await agent.close();
    },
  };
}
