import assert from 'node:assert/strict';
import test from 'node:test';
import { claimJob, newJob, readJson, updateJson } from '../src/index.js';
import { blobEmulator } from './blob-emulator.js';

test('Blob mutations preserve concurrent first writes and later updates', async () => {
  const blob = blobEmulator();
  try {
    const add = (key: string) =>
      updateJson('keys.json', (raw) => ({
        value: { ...((raw as object) ?? {}), [key]: true },
        result: key,
      }));
    await Promise.all([add('fireworks'), add('elevenlabs')]);
    await Promise.all([add('fal'), add('anthropic')]);
    assert.deepEqual((await readJson('keys.json'))?.value, {
      fireworks: true,
      elevenlabs: true,
      fal: true,
      anthropic: true,
    });
  } finally {
    await blob.close();
  }
});

test('damaged Blob JSON is refused without overwriting it', async () => {
  const blob = blobEmulator();
  try {
    blob.records.set('keys.json', { body: '{broken', etag: 'old' });
    await assert.rejects(
      updateJson('keys.json', () => ({ value: {}, result: true })),
      /damaged/,
    );
    assert.equal(blob.writes, 0);
  } finally {
    await blob.close();
  }
});

test('simultaneous Function admissions start only one render', async () => {
  const blob = blobEmulator();
  try {
    const claims = await Promise.all(
      Array.from({ length: 4 }, () => claimJob('inkcast', newJob('film1', 'cast', 'queued'))),
    );
    assert.equal(claims.filter((claim) => claim.started).length, 1);
    assert.equal(blob.writes, 1);
  } finally {
    await blob.close();
  }
});
