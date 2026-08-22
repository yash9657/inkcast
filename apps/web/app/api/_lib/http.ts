/**
 * Shared request/response plumbing for the studio API.
 *
 * `_lib` is a Next private folder, so nothing in here is routable.
 *
 * Two conventions every route follows:
 *  - **Errors are JSON with a real status code.** `{ error, details? }`, where
 *    `error` is a sentence a human can act on and `details` lists the specific
 *    field problems. The studio renders `error` directly, so it is never a
 *    stack trace and never just "Bad Request".
 *  - **Nothing is cached.** These responses describe filesystem state that a
 *    background job is mutating; a cached project list would show a video that
 *    has already been deleted.
 */

import { NextResponse } from 'next/server';
import type { z } from 'zod';

import { limitMessage } from './ratelimit';
import type { Denied } from './ratelimit';

// Imported for its module side effect as much as its exports: `lib/store` is the
// environment bootstrap, and importing it here means no route can reach the
// pipeline before `INKCAST_PROJECTS` is settled. See the header of that file.
import { loadPipeline } from '@/lib/store';

export type ApiError = { error: string; details?: string[] };

const NO_STORE = { 'Cache-Control': 'no-store, must-revalidate' } as const;

export function json<T>(data: T, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(data, { status, headers: { ...NO_STORE, ...headers } });
}

export function fail(status: number, error: string, details?: string[]) {
  return json<ApiError>({ error, ...(details && details.length > 0 ? { details } : {}) }, status);
}

export const badRequest = (error: string, details?: string[]) => fail(400, error, details);
export const notFound = (error: string) => fail(404, error);
export const unprocessable = (error: string, details?: string[]) => fail(422, error, details);
export const serverError = (error: string) => fail(500, error);

/**
 * 403 for a project that exists but is not the caller's.
 *
 * Deliberately *not* a 404. Project ids are unguessable, so a caller holding one
 * either owns it or was given the link, and telling the second person "no such
 * project" when they can see the id in their address bar reads as a bug rather
 * than a rule. The 404-instead-of-403 dodge is for resources whose existence is
 * itself a secret; a shareable video is the opposite of that.
 */
export const forbidden = (error: string) => fail(403, error);

/**
 * 413 for a request that is well-formed but larger than the hosted deployment
 * will carry. Distinct from `badRequest` because the client's fix is different:
 * nothing is malformed, there is simply too much of it.
 */
export const tooLarge = (error: string) => fail(413, error);

/**
 * 429, with the copy and the wait that `ratelimit.ts` computed.
 *
 * Two things travel with it. `Retry-After` in seconds, because that is the only
 * part of a 429 that automated clients read — without it a retry loop hammers a
 * box that is already saying no. And the friendly sentence in `error`, which the
 * studio renders directly (see this file's header): a bare 429 shows up in the UI
 * as "Too Many Requests", which tells a user neither what the limit is nor when
 * it lifts. `limit` and `retryAfterSec` are structured alongside so the client can
 * render a countdown instead of re-parsing English.
 */
export function tooManyRequests(denied: Denied) {
  return json<ApiError & { limit: Denied['limit']; retryAfterSec: number }>(
    { error: limitMessage(denied), limit: denied.limit, retryAfterSec: denied.retryAfterSec },
    429,
    { 'Retry-After': String(denied.retryAfterSec) },
  );
}

/**
 * True on the shared deployment, false in the local studio.
 *
 * The distinction earns its keep in three places: the rate limiter is inert
 * locally (see `limiterEnabled`), the source-text cap only applies to text we
 * are paying to plan, and D5 hides the BYOK settings UI when the server holds
 * the keys. It is a single env var (`INKCAST_HOSTED=1`) rather than a guess at
 * `NODE_ENV`, because "production build" and "public deployment" are not the
 * same claim — `next build && next start` on a laptop is the former, not the
 * latter, and a laptop must not inherit a stranger's limits.
 */
export function isHosted(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.INKCAST_HOSTED === '1';
}

/**
 * 409 for an operation that cannot proceed while a run is in flight.
 *
 * Deleting or editing a project mid-render would corrupt it in a place far from
 * the request that caused it, so the conflict is reported here instead — with the
 * stream URL, so the client can wait for the run rather than guess.
 */
export const conflictingJob = (id: string) =>
  json<ApiError & { projectId: string; streamUrl: string }>(
    {
      error: `a run is already in progress for project "${id}" — wait for it to finish`,
      projectId: id,
      streamUrl: `/api/generate/${id}/stream`,
    },
    409,
  );

/** Flatten a zod error into one readable line per problem. */
export function issueLines(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const where = issue.path.length > 0 ? issue.path.join('.') : 'body';
    return `${where}: ${issue.message}`;
  });
}

/** Discriminated result so callers can `return parsed.response` on failure. */
export type Parsed<T> = { ok: true; data: T } | { ok: false; response: NextResponse };

/**
 * Read and validate a JSON body.
 *
 * An absent or empty body is treated as `{}` rather than an error: routes like
 * `rerender` take only optional fields, and requiring `Content-Type` plus a
 * literal `{}` from every caller buys nothing.
 */
export async function parseJsonBody<S extends z.ZodTypeAny>(
  request: Request,
  schema: S,
): Promise<Parsed<z.infer<S>>> {
  let raw: unknown = {};
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, response: badRequest('could not read the request body') };
  }
  if (text.trim() !== '') {
    try {
      raw = JSON.parse(text);
    } catch (err) {
      return {
        ok: false,
        response: badRequest('the request body is not valid JSON', [
          err instanceof Error ? err.message : String(err),
        ]),
      };
    }
  }
  return validate(schema, raw);
}

export function validate<S extends z.ZodTypeAny>(schema: S, input: unknown): Parsed<z.infer<S>> {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  return {
    ok: false,
    response: badRequest('the request body is not valid', issueLines(result.error)),
  };
}

/**
 * Turn anything thrown inside a handler into a 500 that still says something
 * useful. Unwraps the pipeline's nested `cause` chain when it is available,
 * because the deepest message is the actionable one.
 */
export async function unexpected(scope: string, err: unknown): Promise<NextResponse> {
  let message = err instanceof Error ? err.message : String(err);
  try {
    const { rootCauseMessage } = await loadPipeline();
    message = rootCauseMessage(err);
  } catch {
    /* pipeline unavailable — the plain message will do */
  }
  console.error(`[api:${scope}]`, err);
  return serverError(`${scope} failed: ${message}`);
}
