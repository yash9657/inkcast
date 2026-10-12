/**
 * Entry point of the render container (`Dockerfile.vercel`).
 *
 * Listens on `$PORT` (Vercel's default for a container is 80) and drains on
 * `SIGTERM`: the platform gives a container 30 seconds after the signal, and a
 * request still in flight then is a film that will not finish — so the handler
 * stops accepting work and lets the current request's own error path write the
 * terminal `job.json` if it can.
 */

import { bootstrapEnv, repoRoot } from './env.js';

bootstrapEnv();

const { installRedaction } = await import('@inkcast/keyvault');
// Before anything can log: a provider error can quote a key back.
installRedaction();

const { createRenderServer } = await import('./server.js');
const { createRunner } = await import('./run.js');

const port = Number(process.env.PORT ?? 80);
const server = createRenderServer({
  token: process.env.INKCAST_RENDER_TOKEN,
  run: createRunner({ repoRoot: repoRoot() }),
});

server.listen(port, '0.0.0.0', () => {
  console.log(
    `[render-service] listening on :${port} (workers=${process.env.INKCAST_RENDER_WORKERS}, projects=${process.env.INKCAST_PROJECTS})`,
  );
});

process.on('SIGTERM', () => {
  console.log(`[render-service] SIGTERM${server.busy() ? ' during a render' : ''}; closing`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 25_000).unref();
});
