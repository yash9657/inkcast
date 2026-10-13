/**
 * The Blob-storage branch of the store, as far as it can be checked without a
 * Blob store: the flag is off by default (so every other test in this directory
 * exercises the disk path), and a finished `job.json` becomes the right patch to
 * the project record. The Blob round-trips themselves are covered against an
 * emulator in `packages/cloud` and end to end in docs/DEPLOY_VERCEL.md.
 */

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { JobState } from '@inkcast/cloud';

process.env.INKCAST_PROJECTS ??= mkdtempSync(path.join(os.tmpdir(), 'inkcast-store-blob-'));
const store = await import('./store.js');

const base: JobState = {
  version: 1,
  projectId: 'abc123',
  kind: 'cast',
  status: 'done',
  startedAt: '2026-10-12T00:00:00.000Z',
  updatedAt: '2026-10-12T00:05:00.000Z',
};

test('blob storage is opt-in', () => {
  const saved = process.env.INKCAST_STORAGE;
  try {
    delete process.env.INKCAST_STORAGE;
    assert.equal(store.blobStorage(), false);
    process.env.INKCAST_STORAGE = 'blob';
    assert.equal(store.blobStorage(), true);
  } finally {
    if (saved === undefined) delete process.env.INKCAST_STORAGE;
    else process.env.INKCAST_STORAGE = saved;
  }
});

test('a finished job becomes a ready record carrying what the film is', () => {
  const patch = store.patchFromJob({
    ...base,
    result: {
      videoPath: 'out.mp4',
      durationSec: 72.4,
      title: 'Photosynthesis',
      scenes: 8,
      costUsd: 0,
      aspect: '16:9',
      grounding: 'document',
    },
  });
  assert.deepEqual(patch, {
    status: 'ready',
    videoPath: 'out.mp4',
    title: 'Photosynthesis',
    scenes: 8,
    durationSec: 72.4,
    costUsd: 0,
    aspect: '16:9',
    grounding: 'document',
  });
});

test('a failed job becomes a failed record with its reason, and never a ready one', () => {
  assert.deepEqual(
    store.patchFromJob({
      ...base,
      status: 'error',
      failure: { error: 'ffmpeg died', stage: 'render' },
    }),
    { status: 'failed', error: 'ffmpeg died' },
  );
  // "done" without a result is not evidence of a film.
  assert.equal(store.patchFromJob({ ...base, status: 'done' }).status, 'failed');
});

test('Blob first-claim races cannot change a project owner', async () => {
  const { blobEmulator } = await import('../../../packages/cloud/test/blob-emulator.js');
  const blob = blobEmulator();
  const storage = process.env.INKCAST_STORAGE;
  const hosted = process.env.INKCAST_HOSTED;
  process.env.INKCAST_STORAGE = 'blob';
  process.env.INKCAST_HOSTED = '1';
  try {
    const result = await Promise.allSettled([
      store.upsertProject('race-film', { ownerSession: 'owner-a' }, 'owner-a'),
      store.upsertProject('race-film', { ownerSession: 'owner-b' }, 'owner-b'),
    ]);
    assert.equal(result.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(result.filter((r) => r.status === 'rejected').length, 1);
    assert.ok(
      ['owner-a', 'owner-b'].includes((await store.readProjectTruth('race-film'))!.ownerSession!),
    );
  } finally {
    if (storage === undefined) delete process.env.INKCAST_STORAGE;
    else process.env.INKCAST_STORAGE = storage;
    if (hosted === undefined) delete process.env.INKCAST_HOSTED;
    else process.env.INKCAST_HOSTED = hosted;
    await blob.close();
  }
});
