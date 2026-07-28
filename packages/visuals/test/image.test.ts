import assert from 'node:assert/strict';
import test from 'node:test';
import { ctxFor } from '../src/geometry.js';
import {
  detectImageProvider,
  extractPathData,
  generateIllustration,
  illustrationPrompt,
  vectoriseToInk,
} from '../src/image.js';
import { inkStyleFor } from '../src/style.js';

const style = inkStyleFor({ style: 'marker', palette: 'color' });

test('with no key configured the text-to-image lane reports none', () => {
  assert.equal(process.env.REPLICATE_API_TOKEN, undefined);
  assert.equal(process.env.FAL_KEY, undefined);
  assert.equal(detectImageProvider(), 'none');
});

test('generateIllustration resolves to undefined rather than throwing', async () => {
  // The zero-key default: no network call, no crash, caller falls back.
  assert.equal(await generateIllustration('a rover on mars'), undefined);
});

test('the prompt is shaped for something a tracer can vectorise', () => {
  const p = illustrationPrompt('  a rover on mars  ');
  assert.match(p, /^a rover on mars,/);
  assert.match(p, /line art/);
  assert.match(p, /no text/);
  assert.match(p, /white background/);
});

test('extractPathData pulls every path out of a vectoriser svg', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">' +
    '<path d="M0 0 L10 0 L10 10 Z" fill="#000"/>' +
    '<path fill="#fff" d="M20 20 C30 20 30 30 20 30 Z"/>' +
    '<rect x="0" y="0" width="4" height="4"/>' +
    '</svg>';
  const paths = extractPathData(svg);
  assert.deepEqual(paths, ['M0 0 L10 0 L10 10 Z', 'M20 20 C30 20 30 30 20 30 Z']);
  assert.deepEqual(extractPathData('<svg></svg>'), []);
});

test('vectorisation degrades to undefined when the native module is absent', async () => {
  // Not a real PNG on purpose: either the optional native dep is missing (we
  // warn and return undefined) or it is present and rejects the input — both
  // paths must be non-fatal.
  const result = await vectoriseToInk(
    Buffer.from('not a png'),
    { x: 0, y: 0, w: 100, h: 100 },
    ctxFor(style, 1),
  );
  assert.equal(result, undefined);
});
