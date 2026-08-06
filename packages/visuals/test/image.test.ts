import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ctxFor } from '../src/geometry.js';
import {
  ILLUSTRATION_DIR,
  detectImageProvider,
  extractPathData,
  generateIllustration,
  illustrationKey,
  illustrationPaths,
  illustrationPrompt,
  illustrationRaster,
  resetIllustrationCache,
  resetImageProviderNotice,
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

test('a traced path is placed where its own translate says, not at the origin', () => {
  // vtracer writes every path relative to its own origin and carries the real position
  // in a transform. Reading `d` alone stacked every part of an illustration on one
  // point — the anatomical heart the hybrid lane is built for came back as six paths all
  // starting `M0 0`, five of them interior details that landed in a smudge.
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">' +
    '<path d="M0 0 L10 0 L10 10 Z" fill="#000" transform="translate(100,40)"/>' +
    '<path d="M0 0 L4 0" fill="#000" transform="translate(0,0)"/>' +
    '</svg>';
  const [moved, untouched] = extractPathData(svg);
  assert.equal(moved, 'M100,40L110,40L110,50Z');
  // A zero translate is left exactly as it was written, so nothing is re-serialised for
  // no reason and the common case is byte-for-byte what it always was.
  assert.equal(untouched, 'M0 0 L4 0');
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

/* --------------------------------------------------- the illustration lane */

test('the prompt is engineered for our aesthetic as well as for the tracer', () => {
  const p = illustrationPrompt('Odysseus at the mast');
  // Single subject, black line art, white ground, no shading, no background: the
  // aesthetic constraint and the "this must vectorise" constraint agree.
  assert.match(p, /^Odysseus at the mast,/);
  assert.match(p, /single centred subject/);
  assert.match(p, /black line art/);
  assert.match(p, /white background/);
  assert.match(p, /high contrast/);
  assert.match(p, /no shading/);
  assert.match(p, /no background/);
  assert.match(p, /no text/);
  assert.match(p, /not cropped/);
});

test('the cache key is stable for an id and prompt, and changes with either', () => {
  const a = illustrationKey('rover', 'a mars rover');
  assert.equal(a, illustrationKey('rover', 'a mars rover'));
  assert.equal(a, illustrationKey('rover', '  a mars rover  '), 'whitespace must not matter');
  assert.notEqual(a, illustrationKey('rover', 'a lunar rover'));
  assert.notEqual(a, illustrationKey('lander', 'a mars rover'));
  // Safe as a filename: this becomes assets/illustrations/<key>.png.
  assert.match(a, /^[A-Za-z0-9_-]+$/);
  assert.match(illustrationKey('a/b c!', 'x'), /^[A-Za-z0-9_-]+$/);
});

test('with no key the lane returns undefined instead of failing the pipeline', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'inkcast-image-'));
  resetIllustrationCache();
  assert.equal(await illustrationRaster({ id: 'rover', prompt: 'a mars rover', dir }), undefined);
  assert.equal(
    await illustrationPaths({
      id: 'rover',
      prompt: 'a mars rover',
      dir,
      box: { x: 0, y: 0, w: 256, h: 256 },
      ctx: ctxFor(style, 3),
    }),
    undefined,
  );
  // Nothing was written, so a later run with a key still generates.
  assert.equal(existsSync(path.join(dir, 'assets', 'illustrations')), false);
});

test('a cached raster on disk is reused, so an id is generated once ever', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'inkcast-image-'));
  const key = illustrationKey('rover', 'a mars rover');
  const rel = `${ILLUSTRATION_DIR}/${key}.png`;
  await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
  await writeFile(path.join(dir, rel), Buffer.from('cached-bytes'));

  resetIllustrationCache();
  const first = await illustrationRaster({ id: 'rover', prompt: 'a mars rover', dir });
  assert.ok(first, 'a cached raster must be served with no key present');
  assert.equal(first.cached, true);
  assert.equal(first.rel, rel);
  assert.equal(first.png.toString(), 'cached-bytes');

  // Concurrent callers share one promise rather than racing the provider.
  const [a, b] = await Promise.all([
    illustrationRaster({ id: 'rover', prompt: 'a mars rover', dir }),
    illustrationRaster({ id: 'rover', prompt: 'a mars rover', dir }),
  ]);
  assert.equal(a, b, 'the same id must resolve to the very same result object');

  // A different prompt is a different cache entry, so it is not wrongly reused.
  assert.equal(
    await illustrationRaster({ id: 'rover', prompt: 'a different rover', dir }),
    undefined,
  );
});

test('provider selection prefers replicate, then fal, then none', () => {
  const before = { r: process.env.REPLICATE_API_TOKEN, f: process.env.FAL_KEY };
  try {
    process.env.REPLICATE_API_TOKEN = 'r';
    process.env.FAL_KEY = 'f';
    resetImageProviderNotice();
    assert.equal(detectImageProvider(), 'replicate');
    delete process.env.REPLICATE_API_TOKEN;
    resetImageProviderNotice();
    assert.equal(detectImageProvider(), 'fal');
    delete process.env.FAL_KEY;
    resetImageProviderNotice();
    assert.equal(detectImageProvider(), 'none');
  } finally {
    if (before.r === undefined) delete process.env.REPLICATE_API_TOKEN;
    else process.env.REPLICATE_API_TOKEN = before.r;
    if (before.f === undefined) delete process.env.FAL_KEY;
    else process.env.FAL_KEY = before.f;
    resetImageProviderNotice();
  }
});
