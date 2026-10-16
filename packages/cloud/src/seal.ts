/**
 * A render request at rest, for the Fargate path.
 *
 * ECS cannot hand a task a 1 MB body (container overrides cap at 8 KB), so the studio
 * leaves the request in Blob as `run.sealed` and the task reads it. The request carries
 * the film's provider keys, so it is sealed with AES-256-GCM under a key derived from
 * `INKCAST_RENDER_TOKEN`, the secret both sides already share, and the task deletes it
 * as soon as it has read it.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** The sealed request's file name inside a project's Blob prefix. */
export const RUN_BLOB = 'run.sealed';

function keyFor(token: string): Buffer {
  if (!token || token.length < 24) throw new Error('INKCAST_RENDER_TOKEN is not configured');
  return createHash('sha256').update(`inkcast-run-seal:${token}`).digest();
}

/** iv (12) | tag (16) | ciphertext */
export function sealRun(request: unknown, token: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(token), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(request), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

/** Throws on a wrong token or any tampering. */
export function openRun(sealed: Buffer, token: string): unknown {
  const decipher = createDecipheriv('aes-256-gcm', keyFor(token), sealed.subarray(0, 12));
  decipher.setAuthTag(sealed.subarray(12, 28));
  const body = Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]);
  return JSON.parse(body.toString('utf8'));
}
