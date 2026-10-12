/**
 * The render service's HTTP surface, with the work injected.
 *
 * Two routes:
 *
 *  - `GET /health` — liveness plus whether this instance is busy. Unauthenticated
 *    and says nothing sensitive.
 *  - `POST /run` — one film. Bearer-authenticated against `INKCAST_RENDER_TOKEN`,
 *    answered with NDJSON for as long as the run takes (see
 *    `packages/cloud/src/protocol.ts` for why the request stays open).
 *
 * **One film per instance.** A render is several Chromium contexts and ffmpeg
 * encoders; a 4 GB Performance instance holds one with headroom and not two. Fluid
 * compute may route a second request to an instance that is already rendering, so
 * this answers `503` immediately rather than queueing behind the first — a queue
 * here would spend the second request's 800-second budget waiting — and the studio
 * retries, which lands on a fresh instance.
 *
 * No workspace imports: the runner is passed in by `main.ts`, after the
 * environment bootstrap has run, which also keeps this file testable without
 * Chromium.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import {
  RenderRequestSchema,
  bearerMatches,
  type RenderEvent,
  type RenderRequest,
} from '@inkcast/cloud';

export type Runner = (
  request: RenderRequest,
  emit: (event: RenderEvent) => void,
) => Promise<Extract<RenderEvent, { type: 'done' | 'error' }>>;

export type ServerOptions = {
  token: string | undefined;
  run: Runner;
  /** Milliseconds between heartbeat lines. */
  heartbeatMs?: number;
  /** Largest accepted request body. The source text is inside it. */
  maxBodyBytes?: number;
};

const DEFAULT_HEARTBEAT_MS = 20_000;
const DEFAULT_MAX_BODY = 1024 * 1024;

export function createRenderServer(options: ServerOptions): Server & { busy: () => boolean } {
  let busy = false;

  const server = createServer((req, res) => {
    void route(req, res).catch((err: unknown) => {
      // Never echo the error: it can carry a path or a provider message.
      console.error('[render-service] unhandled', err instanceof Error ? err.name : 'error');
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
      else res.end();
    });
  });

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/')) {
      sendJson(res, 200, { ok: true, service: 'inkcast-render', busy });
      return;
    }

    if (url.pathname !== '/run') {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'POST only' });
      return;
    }
    if (!options.token) {
      sendJson(res, 503, { error: 'INKCAST_RENDER_TOKEN is not configured on the render service' });
      return;
    }
    if (!bearerMatches(req.headers.authorization, options.token)) {
      sendJson(res, 401, { error: 'unauthorised' });
      return;
    }
    if (busy) {
      sendJson(res, 503, { error: 'busy', busy: true });
      return;
    }

    // Claimed before the body is read, so two requests racing on one instance
    // cannot both pass the check above.
    busy = true;
    try {
      let body: unknown;
      try {
        body = JSON.parse(await readBody(req, options.maxBodyBytes ?? DEFAULT_MAX_BODY));
      } catch (err) {
        sendJson(res, 400, { error: err instanceof Error ? err.message : 'unreadable body' });
        return;
      }
      const parsed = RenderRequestSchema.safeParse(body);
      if (!parsed.success) {
        sendJson(res, 400, {
          error: 'invalid render request',
          issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        });
        return;
      }

      res.writeHead(200, {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'cache-control': 'no-store',
        'x-accel-buffering': 'no',
      });
      const write = (event: RenderEvent) => {
        if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
      };
      write({ type: 'accepted' });
      const beat = setInterval(
        () => write({ type: 'heartbeat' }),
        options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS,
      );
      try {
        const terminal = await options.run(parsed.data, write);
        write(terminal);
      } catch (err) {
        write({
          type: 'error',
          failure: { error: err instanceof Error ? err.message : 'the render failed' },
        });
      } finally {
        clearInterval(beat);
        res.end();
      }
    } finally {
      busy = false;
    }
  }

  return Object.assign(server, { busy: () => busy });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > limit) {
        reject(new Error(`request body exceeds ${limit} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
