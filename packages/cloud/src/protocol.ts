/**
 * The wire between the studio and the render service.
 *
 * One request per film: `POST <INKCAST_RENDER_URL>/run` with a bearer token and a
 * JSON body. The service holds the request open for the whole run — a Vercel
 * container lives exactly as long as the requests it is serving, so a
 * fire-and-forget design would let the platform freeze the instance mid-render —
 * and answers with newline-delimited JSON: progress lines, a heartbeat every 20 s
 * so no proxy closes an idle connection, and one terminal line.
 *
 * The NDJSON is a convenience for the caller, not the source of truth. The service
 * also writes `job.json` to Blob, which is what the browser's progress stream
 * reads, so a dispatcher that dies mid-run loses nothing a viewer can see.
 */

import { timingSafeEqual, createHash } from 'node:crypto';

import { z } from 'zod';

import { isValidBlobPrefix, isValidId } from './config.js';
import { FailureSchema, ProgressSchema, ResultSchema } from './job.js';

/** The subset of `CastInput` a studio request can carry. */
export const RenderInputSchema = z
  .object({
    text: z.string().optional(),
    url: z.string().url().optional(),
    title: z.string().optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
    preset: z.string().optional(),
    /** A repository-relative path, e.g. `examples/gradient-descent.md`. */
    repoPath: z.string().optional(),
    /** An uploaded source, already in Blob at this pathname. */
    sourceBlob: z.object({ pathname: z.string(), name: z.string() }).optional(),
  })
  .strict();

export const RenderRequestSchema = z
  .object({
    projectId: z.string().refine(isValidId, 'not a valid project id'),
    blobPrefix: z.string().refine(isValidBlobPrefix, 'not a valid blob prefix'),
    kind: z.literal('cast'),
    input: RenderInputSchema,
    force: z.boolean().optional(),
    /**
     * The provider environment the pipeline runs inside: keys and provider/model
     * settings, resolved by the studio for this request (an account's own keys when
     * accounts are on). Used for this run only — never written to Blob or logged.
     */
    providerEnv: z.record(z.string().regex(/^[A-Z][A-Z0-9_]*$/), z.string()).optional(),
    /**
     * True when the studio runs with per-account keys: the render service must then
     * use `providerEnv` as the complete provider environment and never fall back to
     * keys in its own environment (the account-isolation rule in apps/web/lib/keys.ts).
     */
    isolated: z.boolean().optional(),
  })
  .superRefine((request, ctx) => {
    if (request.isolated && !request.providerEnv) {
      ctx.addIssue({
        code: 'custom',
        path: ['providerEnv'],
        message: 'isolated runs require a credential scope',
      });
    }
    if (request.isolated && request.input.repoPath !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['input', 'repoPath'],
        message: 'account runs cannot read server files',
      });
    }
  });

export type RenderInput = z.infer<typeof RenderInputSchema>;
export type RenderRequest = z.infer<typeof RenderRequestSchema>;

export const RenderEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('accepted') }),
  z.object({ type: z.literal('heartbeat') }),
  z.object({ type: z.literal('progress'), progress: ProgressSchema }),
  z.object({ type: z.literal('done'), result: ResultSchema }),
  z.object({ type: z.literal('error'), failure: FailureSchema }),
]);

export type RenderEvent = z.infer<typeof RenderEventSchema>;

/** Constant-time bearer check. An unset token refuses everything. */
export function bearerMatches(
  header: string | null | undefined,
  token: string | undefined,
): boolean {
  if (!token || token.length < 24) return false;
  const presented = /^Bearer\s+(.+)$/i.exec(header ?? '')?.[1]?.trim() ?? '';
  // Hash both sides first so the comparison is fixed-length whatever was sent.
  const a = createHash('sha256').update(presented).digest();
  const b = createHash('sha256').update(token).digest();
  return timingSafeEqual(a, b);
}

/** Thrown by `callRenderService` when every instance it reached was busy. */
export class RenderServiceBusy extends Error {
  constructor() {
    super('every renderer was busy');
    this.name = 'RenderServiceBusy';
  }
}

/**
 * Run one film on the render service, reading its event stream to the end.
 *
 * Resolves with the terminal event. Rejects on transport failure, a non-2xx
 * answer, or a stream that ends without a terminal line (the instance died).
 * A `503` means this instance is already rendering — the service renders one film
 * per instance so a 4 GB instance never holds two — and becomes
 * `RenderServiceBusy`, which the caller may retry.
 */
export async function callRenderService(
  baseUrl: string,
  token: string,
  request: RenderRequest,
  onEvent: (event: RenderEvent) => void,
  options: { signal?: AbortSignal; bypassToken?: string } = {},
): Promise<Extract<RenderEvent, { type: 'done' | 'error' }>> {
  const response = await fetch(new URL('/run', baseUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      // Lets the studio reach a render deployment behind Vercel Deployment
      // Protection (a preview URL, say). Harmless when protection is off.
      ...(options.bypassToken ? { 'x-vercel-protection-bypass': options.bypassToken } : {}),
    },
    body: JSON.stringify(request),
    // A redirect must never replay provider keys to a different server.
    redirect: 'error',
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (response.status === 503) {
    await response.body?.cancel();
    throw new RenderServiceBusy();
  }
  if (!response.ok || !response.body) {
    // An upstream/proxy error may reflect the submitted credential-bearing body.
    await response.body?.cancel();
    throw new Error(`the render service answered ${response.status}`);
  }

  const decoder = new TextDecoder();
  let buffered = '';
  let terminal: Extract<RenderEvent, { type: 'done' | 'error' }> | undefined;

  const handle = (line: string) => {
    if (line.trim() === '') return;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      return;
    }
    const parsed = RenderEventSchema.safeParse(raw);
    if (!parsed.success) return;
    const event = parsed.data;
    if (event.type === 'done' || event.type === 'error') terminal = event;
    onEvent(event);
  };

  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffered += decoder.decode(chunk, { stream: true });
    let newline = buffered.indexOf('\n');
    while (newline >= 0) {
      handle(buffered.slice(0, newline));
      buffered = buffered.slice(newline + 1);
      newline = buffered.indexOf('\n');
    }
  }
  handle(buffered + decoder.decode());

  if (!terminal)
    throw new Error('the render service closed the connection before the film finished');
  return terminal;
}
