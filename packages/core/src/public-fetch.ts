import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';

const privateV4 = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const)
  privateV4.addSubnet(address, prefix, 'ipv4');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
const privateV6 = new BlockList();
for (const [address, prefix] of [
  ['2001::', 32],
  ['2001:db8::', 32],
  ['2002::', 16],
] as const)
  privateV6.addSubnet(address, prefix, 'ipv6');

export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return !privateV4.check(address, 'ipv4');
  return version === 6 && globalV6.check(address, 'ipv6') && !privateV6.check(address, 'ipv6');
}

type Resolve = (hostname: string) => Promise<{ address: string; family: number }[]>;
export async function publicDestination(
  url: URL,
  resolve: Resolve = (hostname) => lookup(hostname, { all: true }),
) {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Use a public HTTP or HTTPS page without embedded credentials.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const literal = isIP(hostname);
  const addresses = literal ? [{ address: hostname, family: literal }] : await resolve(hostname);
  if (!addresses.length || addresses.some((entry) => !isPublicAddress(entry.address)))
    throw new Error(
      'This page resolves to a private or reserved network. Upload the document instead.',
    );
  return addresses[0]!;
}

/** No ambient credentials. DNS is checked once and pinned to the socket, including every redirect. */
export async function fetchPublicText(
  url: URL,
  redirects = 0,
): Promise<{ body: string; contentType: string }> {
  if (redirects > 5) throw new Error('The source page redirected too many times.');
  const address = await publicDestination(url);
  return new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? https : http).get(
      url,
      {
        headers: { 'user-agent': 'inkcast/0.1' },
        signal: AbortSignal.timeout(30_000),
        // Retain the original hostname for HTTP Host and TLS verification, but
        // never ask DNS again after the public-address check.
        lookup: (_hostname, options, callback) => {
          if (typeof options === 'object' && options.all) callback(null, [address]);
          else callback(null, address.address, address.family);
        },
      },
      (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.destroy();
          let target: URL;
          try {
            target = new URL(res.headers.location, url);
          } catch {
            reject(new Error('Invalid source redirect.'));
            return;
          }
          void fetchPublicText(target, redirects + 1).then(resolve, reject);
          return;
        }
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          res.destroy();
          reject(new Error(`Source page returned HTTP ${res.statusCode ?? 'unknown'}.`));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 8 * 1024 * 1024) {
            res.destroy(new Error('Source page exceeds 8 MB. Upload a smaller document.'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          resolve({
            body: Buffer.concat(chunks).toString('utf8'),
            contentType: res.headers['content-type'] ?? '',
          }),
        );
        res.on('error', reject);
      },
    );
    req.on('error', reject);
  });
}
