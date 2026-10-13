/** Local-only end-to-end check: real Kokoro/Chromium/ffmpeg, emulated Blob, no provider calls. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = await mkdtemp(path.join(tmpdir(), 'inkcast-render-check-'));
process.chdir(root);
console.log(`Verification artifacts: ${output}`);
process.env.INKCAST_PROJECTS = path.join(output, 'projects');
process.env.INKCAST_HOME = path.join(output, 'state');
process.env.INKCAST_OFFLINE = '1';
process.env.INKCAST_RENDER_WORKERS = '2';
process.env.INKCAST_MODEL_CACHE = path.join(root, '.models');
const { blobEmulator } = await import('../packages/cloud/test/blob-emulator.ts');
const { createRunner } = await import('../apps/render-service/src/run.ts');
const { createRenderServer } = await import('../apps/render-service/src/server.ts');
const { callRenderService, readJob } = await import('../packages/cloud/src/index.ts');
const blob = blobEmulator(true);
const token = 'synthetic-render-verification-token';
const server = createRenderServer({ token, run: createRunner({ repoRoot: root }) });
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as { port: number }).port;
try {
  const terminal = await callRenderService(
    `http://127.0.0.1:${port}`,
    token,
    {
      projectId: 'integration-smoke',
      blobPrefix: 'verification',
      kind: 'cast',
      isolated: true,
      providerEnv: {
        INKCAST_PLANNER: 'local',
        INKCAST_VOICE: 'kokoro',
        INKCAST_IMAGES: 'off',
        INKCAST_CACHE_DIR: 'smoke-account',
        INKCAST_PUBLIC_SOURCES: '1',
      },
      input: {
        text: await readFile('examples/photosynthesis.md', 'utf8'),
        preset: 'explainer',
        meta: { voice: 'kokoro:af_heart', style: 'marker' },
      },
    },
    (event) => {
      if (event.type === 'progress') console.log(event.progress.stage, event.progress.pct);
    },
  );
  console.log(JSON.stringify(terminal));
  assert.equal(terminal.type, 'done');
  const state = await readJob('verification', 'integration-smoke');
  assert.equal(state?.status, 'done');
  const record = blob.records.get('verification/projects/integration-smoke/out.mp4');
  assert.ok(record);
  const out = path.join(output, 'pipeline-smoke.mp4');
  await writeFile(out, record.body);
  const probe = JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', out], {
      encoding: 'utf8',
    }),
  );
  assert.ok(
    probe.streams.some(
      (s: any) => s.codec_type === 'video' && s.width === 1920 && s.height === 1080,
    ),
  );
  assert.ok(probe.streams.some((s: any) => s.codec_type === 'audio'));
  assert.ok(Number(probe.format.duration) > 10);
  await writeFile(
    path.join(output, 'pipeline-smoke-report.json'),
    JSON.stringify({ terminal, probe }, null, 2),
  );
  console.log('FULL PIPELINE SMOKE PASS');
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await blob.close();
}
