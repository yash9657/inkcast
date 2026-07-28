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
