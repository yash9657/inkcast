import assert from 'node:assert/strict';
import test from 'node:test';
import { parseStoryboard } from '@inkcast/core';
import { speechSyncCheck } from './speech-sync.js';
import type { RenderPlan } from './types.js';

test('sync checks inspect the final drawing schedule, not only the aligned IR', () => {
  const sb = parseStoryboard({
    version: 1,
    title: 'Timing',
    meta: {},
    scenes: [
      {
        id: 's',
        narration: 'The receiver listens.',
        camera: { x: 0, y: 0, zoom: 1 },
        elements: [
          {
            id: 'label',
            type: 'text',
            role: 'label',
            text: 'receiver',
            at: { x: 0, y: 0, w: 100, h: 40 },
            enter: { style: 'write', at: 0.1, cue: 'receiver', cueWord: 1 },
          },
        ],
        words: [
          { word: 'The', start: 0, end: 0.2 },
          { word: 'receiver', start: 0.3, end: 0.7 },
          { word: 'listens', start: 0.8, end: 1.2 },
        ],
      },
    ],
  });
  const plan = {
    scenes: [{ start: 0 }],
    items: [{ id: 'label', scene: 0, start: 3 }],
  } as RenderPlan;
  assert.equal(speechSyncCheck(sb, plan).status, 'warn');
  plan.items[0]!.start = 0.6;
  assert.equal(speechSyncCheck(sb, plan).status, 'pass');
  delete sb.scenes[0]!.words;
  assert.equal(speechSyncCheck(sb, plan).status, 'skip');
});
