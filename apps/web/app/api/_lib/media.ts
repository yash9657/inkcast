/**
 * Filesystem resolution, byte ranges and content types for `/api/media`.
 *
 * Kept out of the route file because this is the security-critical half of that
 * endpoint and it has no business depending on a request object: everything here
 * is a pure function of a path or a header, which makes it directly testable and
 * keeps the route down to plumbing.
 */

import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

/* --------------------------------------------------------------- resolution */

export type ResolvedFile = { file: string; size: number; mtimeMs: number };

/**
 * Why a media path was refused. `invalid` is a segment we will never accept,
 * `outside` escaped the project directory, `missing` is a 404.
 */
export type ResolveFailure = 'invalid' | 'outside' | 'missing';

/** Depth limit — no legitimate project artefact is nested this far. */
const MAX_SEGMENTS = 16;

/**
 * True when `child` is a strict descendant of `parent`.
 *
 * Compares the relative path rather than string prefixes, because
 * `/projects/abc-evil` starts with `/projects/abc` but is a different directory.
 */
export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  if (rel === '' || rel === '..') return false;
  if (path.isAbsolute(rel)) return false;
  return !rel.startsWith(`..${path.sep}`);
}

/**
 * Reject a path segment that could never name a real artefact.
 *
 * Next has already percent-decoded these by the time we see them, so `%2e%2e`
 * arrives here as `..` and is caught. Separators are rejected outright: a
 * segment containing one means the client encoded a path where a name belongs.
 */
export function isSafeSegment(segment: string): boolean {
  if (segment === '' || segment === '.' || segment === '..') return false;
  if (segment.includes('\0')) return false;
  return !segment.includes('/') && !segment.includes('\\');
}

/**
 * Resolve `segments` beneath `dir` and stat the result.
 *
 * Containment is checked twice, and the second check is the one that matters:
 * once on the lexically resolved path, then again after `realpath` has followed
 * symlinks. Without the second, a symlink inside a project directory would read
 * any file the server process can.
 *
 * `realpath` is applied to `dir` too — on macOS the projects root can sit under
 * `/tmp`, which is itself a symlink to `/private/tmp`, and comparing a real path
 * against a symlinked one would otherwise reject every legitimate file.
 */
export async function resolveMediaFile(
  dir: string,
  segments: string[],
): Promise<{ ok: true; value: ResolvedFile } | { ok: false; reason: ResolveFailure }> {
  if (segments.length === 0 || segments.length > MAX_SEGMENTS) {
    return { ok: false, reason: 'invalid' };
  }
  if (!segments.every(isSafeSegment)) return { ok: false, reason: 'invalid' };

  const candidate = path.resolve(dir, ...segments);
  if (!isInside(dir, candidate)) return { ok: false, reason: 'outside' };

  let realFile: string;
  let realDir: string;
  try {
    realDir = await realpath(dir);
    realFile = await realpath(candidate);
  } catch {
    return { ok: false, reason: 'missing' };
  }
  if (!isInside(realDir, realFile)) return { ok: false, reason: 'outside' };

  try {
    const info = await stat(realFile);
    if (!info.isFile()) return { ok: false, reason: 'missing' };
    return { ok: true, value: { file: realFile, size: info.size, mtimeMs: info.mtimeMs } };
  } catch {
    return { ok: false, reason: 'missing' };
  }
}

/* ------------------------------------------------------------------ ranges */

export type ByteRange = { start: number; end: number };

/**
 * Parse a single `Range` header against a known size.
 *
 * Returns `undefined` for anything we choose not to honour — notably multi-range
 * requests (`bytes=0-99,200-299`), which are served as a plain 200. RFC 9110
 * explicitly allows a server to ignore a Range header, and no media element
 * needs multipart/byteranges.
 *
 * `'unsatisfiable'` means answer 416 with a `Content-Range` naming the real size.
 */
export function parseRange(header: string, size: number): ByteRange | 'unsatisfiable' | undefined {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return undefined;

  const rawStart = match[1] ?? '';
  const rawEnd = match[2] ?? '';
  // `bytes=-` names neither a start nor a suffix length.
  if (rawStart === '' && rawEnd === '') return 'unsatisfiable';
  // Nothing can satisfy a range over an empty file.
  if (size === 0) return 'unsatisfiable';

  let start: number;
  let end: number;

  if (rawStart === '') {
    // Suffix form: the final N bytes. Clamped, so `bytes=-999999` on a small
    // file is the whole file rather than an error.
    const suffix = Number(rawEnd);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return 'unsatisfiable';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    if (!Number.isSafeInteger(start)) return 'unsatisfiable';
    if (rawEnd === '') {
      end = size - 1;
    } else {
      const requested = Number(rawEnd);
      if (!Number.isSafeInteger(requested)) return 'unsatisfiable';
      // An end past EOF is clamped, which is what byte-serving clients expect.
      end = Math.min(requested, size - 1);
    }
  }

  if (start < 0 || start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}

/* ----------------------------------------------------------- content types */

/**
 * Explicit allow-list; an unknown extension becomes an opaque download rather
 * than something the browser tries to interpret.
 *
 * `.html` maps to `text/plain` on purpose. An ingested HTML source document sits
 * inside the project directory, and serving it as `text/html` would let it run
 * script on this origin. The route's CSP header is the second line of defence;
 * this is the first.
 */
export const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
  '.srt': 'text/plain; charset=utf-8',
  '.html': 'text/plain; charset=utf-8',
  '.htm': 'text/plain; charset=utf-8',
};

export function contentTypeFor(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}
