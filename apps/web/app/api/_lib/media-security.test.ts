import assert from 'node:assert/strict';
import test from 'node:test';
import { shareableMediaPath } from './media';

test('public sharing exposes playback assets but never source files, metadata or diagnostics', () => {
  for (const name of [
    'meta.json',
    'cache.json',
    'pipeline.json',
    'source/private.pdf',
    'source/key.txt',
    'audio/../meta.json',
    'assets/source.json',
  ])
    assert.equal(shareableMediaPath(name.split('/'), 'out.mp4'), false, name);
  for (const name of [
    'out.mp4',
    'audio/narration.wav',
    'assets/figure.png',
    'assets/diagram.svg',
    'thumbnail.jpg',
  ])
    assert.equal(shareableMediaPath(name.split('/'), 'out.mp4'), true, name);
});
