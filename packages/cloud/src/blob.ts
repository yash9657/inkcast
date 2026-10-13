/**
 * The handful of Vercel Blob operations Inkcast needs, behind one lazy import.
 *
 * `@vercel/blob` is loaded only when a function here is called, so a process that
 * never enables Blob storage never evaluates it. Credentials come from the SDK's
 * own environment lookup (`BLOB_READ_WRITE_TOKEN`, which Vercel sets when a store
 * is connected to a project).
 */

import type * as BlobSdk from '@vercel/blob';

import { blobAccess } from './config.js';

let sdk: Promise<typeof BlobSdk> | undefined;

function blob(): Promise<typeof BlobSdk> {
  return (sdk ??= import('@vercel/blob'));
}

/** The smallest cache lifetime Blob accepts. JSON reads bypass it anyway. */
const MIN_CACHE_SEC = 60;

export type JsonRead = { value: unknown; etag: string };

/**
 * Read and parse a JSON blob, straight from origin.
 *
 * `useCache: false` matters: `job.json` and `meta.json` are overwritten in place,
 * and a CDN-cached copy would show a progress bar a minute behind the render.
 * Returns `undefined` only when the blob does not exist. Damaged records fail
 * closed, so a caller cannot overwrite credentials or ownership as if absent.
 */
export async function readJson(pathname: string): Promise<JsonRead | undefined> {
  const { get } = await blob();
  const result = await get(pathname, { access: blobAccess(), useCache: false });
  if (!result) return undefined;
  if (result.statusCode !== 200) throw new Error('Stored JSON could not be read');
  if (!result.blob.etag) throw new Error('Stored JSON has no concurrency token');
  const text = await new Response(result.stream).text();
  try {
    return { value: JSON.parse(text) as unknown, etag: result.blob.etag };
  } catch {
    throw new Error('Stored JSON is damaged');
  }
}

/**
 * Write a JSON blob, replacing whatever is there.
 *
 * With `ifMatch`, the write only lands if nobody else wrote since that read, and a
 * lost race throws `PreconditionFailed` for the caller to retry — the same
 * read-merge-write discipline the local store gets from its per-project mutex.
 */
export async function writeJson(
  pathname: string,
  value: unknown,
  options: { ifMatch?: string; createOnly?: boolean } = {},
): Promise<void> {
  const { put } = await blob();
  await put(pathname, `${JSON.stringify(value, null, 2)}\n`, {
    access: blobAccess(),
    addRandomSuffix: false,
    allowOverwrite: !options.createOnly,
    contentType: 'application/json; charset=utf-8',
    cacheControlMaxAge: MIN_CACHE_SEC,
    ...(options.ifMatch === undefined ? {} : { ifMatch: options.ifMatch }),
  });
}

/** Cross-instance read/modify/write, including an atomic first creation. */
export async function updateJson<T>(
  pathname: string,
  update: (current: unknown | undefined) => { value?: unknown; result: T },
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const current = await readJson(pathname);
    const next = update(current?.value);
    if (next.value === undefined) return next.result;
    try {
      await writeJson(
        pathname,
        next.value,
        current ? { ifMatch: current.etag } : { createOnly: true },
      );
      return next.result;
    } catch (err) {
      if (attempt >= 4) throw err;
      // A create-only conflict has no dedicated SDK error class. Re-read it:
      // retry only when a competing writer actually created the document.
      if (current ? !(await isPreconditionFailed(err)) : !(await readJson(pathname))) throw err;
    }
  }
}

/** True when `err` is the SDK's "someone else wrote first" error. */
export async function isPreconditionFailed(err: unknown): Promise<boolean> {
  const { BlobPreconditionFailedError } = await blob();
  return err instanceof BlobPreconditionFailedError;
}

/** Upload a file's bytes. Multipart above 8 MB so a long film does not time out. */
export async function putFile(pathname: string, body: Buffer, contentType: string): Promise<void> {
  const { put } = await blob();
  await put(pathname, body, {
    access: blobAccess(),
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType,
    cacheControlMaxAge: MIN_CACHE_SEC,
    multipart: body.byteLength > 8 * 1024 * 1024,
  });
}

export type BlobDownload = {
  /** 200, or 206 when a range was honoured. */
  status: 200 | 206;
  stream: ReadableStream<Uint8Array>;
  headers: Headers;
};

/**
 * Stream a blob, optionally a byte range of it.
 *
 * The `Range` header is forwarded as-is and Blob answers it, so a seek in a 30 MB
 * video costs the bytes after the seek point, not the whole file. A streamed
 * Function response is not subject to the 4.5 MB body cap.
 */
export async function download(
  pathname: string,
  options: { range?: string; signal?: AbortSignal } = {},
): Promise<BlobDownload | undefined> {
  const { get } = await blob();
  const result = await get(pathname, {
    access: blobAccess(),
    ...(options.range ? { headers: { range: options.range } } : {}),
    ...(options.signal ? { abortSignal: options.signal } : {}),
  });
  if (!result || result.statusCode !== 200) return undefined;
  return {
    status: result.headers.has('content-range') ? 206 : 200,
    stream: result.stream,
    headers: result.headers,
  };
}

/** Download a whole blob into memory. For small sources and JSON only. */
export async function downloadBuffer(pathname: string): Promise<Buffer | undefined> {
  const found = await download(pathname);
  if (!found) return undefined;
  return Buffer.from(await new Response(found.stream).arrayBuffer());
}

/** Every pathname under `prefix`, following pagination. */
export async function listPathnames(prefix: string, max = 5000): Promise<string[]> {
  const { list } = await blob();
  const out: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
    for (const item of page.blobs) out.push(item.pathname);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor && out.length < max);
  return out;
}

/** Delete every blob under `prefix`. Returns how many there were. */
export async function deletePrefix(prefix: string): Promise<number> {
  const { del } = await blob();
  const names = await listPathnames(prefix);
  for (let i = 0; i < names.length; i += 100) await del(names.slice(i, i + 100));
  return names.length;
}
