/**
 * Entry point of a Fargate render task: one film, then exit.
 *
 * The studio sealed the request into Blob (`INKCAST_RUN_BLOB`, see
 * `packages/cloud/src/seal.ts`) and started this task. The run itself is the same
 * `createRunner` that `POST /run` uses, so progress, artefacts and the terminal
 * `job.json` are written exactly as on the HTTP path; only the transport differs.
 */

import { bootstrapEnv, repoRoot } from './env.js';

bootstrapEnv();

const { installRedaction } = await import('@inkcast/keyvault');
// Before anything can log: a provider error can quote a key back.
installRedaction();

const { RenderRequestSchema, deletePrefix, downloadBuffer, openRun } =
  await import('@inkcast/cloud');
const { createRunner } = await import('./run.js');

const pathname = process.env.INKCAST_RUN_BLOB ?? '';
const sealed = pathname ? await downloadBuffer(pathname) : undefined;
if (!sealed) {
  console.error(`[render-task] no sealed request at "${pathname}"`);
  process.exit(2);
}
// The request carries provider keys: gone from Blob before any work starts.
await deletePrefix(pathname).catch(() => {});

const request = RenderRequestSchema.parse(openRun(sealed, process.env.INKCAST_RENDER_TOKEN ?? ''));
console.log(`[render-task] ${request.projectId} starting`);
const terminal = await createRunner({ repoRoot: repoRoot() })(request, () => {});
console.log(`[render-task] ${request.projectId} ${terminal.type}`);
process.exit(terminal.type === 'done' ? 0 : 1);
