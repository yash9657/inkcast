import { fail, tooLarge, type Parsed } from './http';
import { accountKeys } from './deployment';

/** Reject cross-origin browser requests before reading a credential or spending. */
export function guardRequest(request: Request, localVault = false): Response | undefined {
  const url = new URL(request.url);
  if (localVault && !accountKeys() && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    return fail(
      403,
      'Local keys are available only through localhost. Configure account storage for a shared deployment.',
    );
  }
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') {
    return fail(403, 'Use Inkcast from its own site to make this request.');
  }
  const origin = request.headers.get('origin');
  let expected = url.origin;
  // Use a configured canonical origin behind a proxy. Never trust forwarded host.
  if (process.env.INKCAST_PUBLIC_URL?.trim()) {
    try {
      expected = new URL(process.env.INKCAST_PUBLIC_URL).origin;
    } catch {
      return fail(503, 'The deployment origin is not configured correctly.');
    }
  }
  if (origin && origin !== expected) return fail(403, 'The request origin does not match Inkcast.');
  if (
    !['GET', 'HEAD'].includes(request.method) &&
    !origin &&
    site !== 'same-origin' &&
    request.headers.get('x-inkcast-request') !== '1'
  ) {
    return fail(
      403,
      'Send this request from Inkcast, or set X-Inkcast-Request: 1 in an API client.',
    );
  }
  return undefined;
}

/** Bound the bytes actually read, including chunked bodies with no length header. */
export async function readCredentialBody(request: Request): Promise<Parsed<unknown>> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return { ok: false, response: fail(415, 'Send credentials as application/json.') };
  }
  const limit = 16 * 1024;
  if (Number(request.headers.get('content-length')) > limit) {
    return { ok: false, response: tooLarge('The key request is too large.') };
  }
  const reader = request.body?.getReader();
  let text = '';
  let size = 0;
  const decoder = new TextDecoder();
  try {
    if (reader)
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) {
          await reader.cancel();
          return { ok: false, response: tooLarge('The key request is too large.') };
        }
        text += decoder.decode(value, { stream: true });
      }
    text += decoder.decode();
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, response: fail(400, 'The key request must be valid JSON.') };
  } finally {
    reader?.releaseLock();
  }
}
