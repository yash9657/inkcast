/**
 * End-to-end smoke test: a two-second storyboard all the way to an mp4, checked
 * with ffprobe. Also covers the resumability contract — a second render of an
 * unchanged storyboard must do no work.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { Progress } from '@inkcast/core';
import { chromiumAvailable } from './browser.js';
import { ensureFfmpeg, probeMedia, run } from './ffmpeg.js';
import { compilePlan } from './compile.js';
import { fixtureStoryboard, verticalStoryboard } from './fixture.js';
import { render } from './render.js';

const SKIP = chromiumAvailable()
  ? false
  : 'Playwright chromium is not installed — run `pnpm exec playwright install chromium`';

test('renders a 2 second storyboard to a real mp4', { skip: SKIP, timeout: 300_000 }, async (t) => {
  await ensureFfmpeg();
  const dir = await mkdtemp(path.join(os.tmpdir(), 'inkcast-render-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  // Stand in for the voice stage: 2s of silence at Kokoro's sample rate.
  await mkdir(path.join(dir, 'audio'), { recursive: true });
  const wav = path.join(dir, 'audio', 'narration.wav');
  const made = await run('ffmpeg', [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-t',
    '2',
    '-i',
    'anullsrc=r=24000:cl=mono',
    '-c:a',
    'pcm_s16le',
    wav,
  ]);
  assert.equal(made.code, 0, made.stderr);

  const sb = fixtureStoryboard();
  const seen: Progress[] = [];
  // Three workers over 60 frames means three segments to concatenate.
  const result = await render(sb, dir, {
    concurrency: 3,
    preset: 'ultrafast',
    crf: 30,
    onProgress: (p) => seen.push(p),
  });

  assert.equal(result.cached, false);
  assert.equal(result.frames, 60, '2.0s at 30fps');
  assert.ok(Math.abs(result.durationSec - 2) < 1e-9);
  assert.equal(result.videoPath, path.join(dir, 'out.mp4'));
  assert.ok(existsSync(result.videoPath));

  const info = await probeMedia(result.videoPath);
  assert.ok(info, 'ffprobe should read the output');
  assert.ok(info.video, 'there should be a video stream');
  assert.equal(info.video.codec, 'h264');
  assert.equal(info.video.pixFmt, 'yuv420p');
  assert.equal(info.video.width, 1920);
  assert.equal(info.video.height, 1080);
  assert.ok(info.audio, 'the narration should be muxed in');
  assert.equal(info.audio.codec, 'aac');
  assert.ok(
    info.duration !== null && Math.abs(info.duration - 2) < 0.12,
    `expected ~2.00s, got ${String(info.duration)}`,
  );

  // Every captured frame survives the segment concat — none lost, none doubled.
  const packets = await run('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-count_packets',
    '-show_entries',
    'stream=nb_read_packets',
    '-of',
    'csv=p=0',
    result.videoPath,
  ]);
  assert.equal(Number(packets.stdout.trim()), 60, 'the three segments join seamlessly');

  const thumb = await stat(result.thumbnailPath);
  assert.ok(thumb.size > 5000, `thumbnail should be a real frame, got ${thumb.size} bytes`);

  assert.ok(!existsSync(path.join(dir, 'frames')), 'segment scratch files are cleaned up');
  assert.equal(seen.at(-1)?.pct, 100);
  assert.ok(
    seen.some((p) => (p.note ?? '').startsWith('frame ')),
    'per-frame progress is reported',
  );

  // Resumability: nothing changed, so nothing is re-rendered.
  const again = await render(sb, dir, { concurrency: 2, preset: 'ultrafast', crf: 30 });
  assert.equal(again.cached, true);
  assert.equal(again.frames, 60);

  // ...unless asked to.
  const forced = await render(sb, dir, {
    concurrency: 2,
    preset: 'ultrafast',
    crf: 30,
    force: true,
  });
  assert.equal(forced.cached, false);
});

test(
  'renders 9:16 as a composed vertical film, not a cropped one',
  { skip: SKIP, timeout: 300_000 },
  async (t) => {
    await ensureFfmpeg();
    const dir = await mkdtemp(path.join(os.tmpdir(), 'inkcast-vertical-'));
    t.after(() => rm(dir, { recursive: true, force: true }));

    const sb = verticalStoryboard({ fps: 12 });
    const plan = compilePlan(sb, dir);
    // Composed for the frame: the camera fits the accumulating column into the
    // phone's safe area, and type is scaled up for it rather than shrunk to fit.
    assert.deepEqual(plan.frame, { w: 1080, h: 1920 });
    assert.ok(plan.typeScale > plan.scale);
    assert.ok(
      plan.fill.every((v) => v > 0.25),
      `every vertical beat should carry ink: ${plan.fill.join(', ')}`,
    );

    const result = await render(sb, dir, { concurrency: 2, preset: 'ultrafast', crf: 30 });
    const info = await probeMedia(result.videoPath);
    assert.ok(info?.video);
    assert.equal(info.video.width, 1080, 'a real vertical frame, not a letterboxed one');
    assert.equal(info.video.height, 1920);
    assert.equal(result.frames, Math.ceil(plan.duration * 12));

    // A frame from the middle of the film has to contain real ink, not blank paper.
    const frame = path.join(dir, 'mid.png');
    const grabbed = await run('ffmpeg', [
      '-y',
      '-v',
      'error',
      '-ss',
      (plan.duration * 0.55).toFixed(2),
      '-i',
      result.videoPath,
      '-frames:v',
      '1',
      frame,
    ]);
    assert.equal(grabbed.code, 0, grabbed.stderr);
    const png = await stat(frame);
    assert.ok(png.size > 40_000, `a composed board, not an empty one (${png.size} bytes)`);
  },
);

test(
  'renders without narration rather than failing',
  { skip: SKIP, timeout: 300_000 },
  async (t) => {
    await ensureFfmpeg();
    const dir = await mkdtemp(path.join(os.tmpdir(), 'inkcast-silent-'));
    t.after(() => rm(dir, { recursive: true, force: true }));

    const sb = fixtureStoryboard({ fps: 12 });
    const result = await render(sb, dir, { concurrency: 1, preset: 'ultrafast', crf: 32 });
    const info = await probeMedia(result.videoPath);
    assert.ok(info?.video);
    assert.equal(info.audio, null, 'no audio stream, but a watchable video');
    assert.equal(result.frames, 24, '2.0s at 12fps');
  },
);
