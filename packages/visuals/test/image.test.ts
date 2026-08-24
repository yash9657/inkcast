import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

// The machine-wide cache is a real directory in the developer's home, and the tests below
// generate rasters into it — a run would otherwise leave a `rover-*.png` in the cache that
// makes two videos about the rover agree, and would read whatever is already in there.
//
// Setting it here works because `cacheDir()` reads the environment on every call, not at
// import: ESM hoists the imports below this line above it, so a module that resolved the
// directory once at load time would already have the real one. Nothing does today, and a
// test that started failing mysteriously is the sign that something began to.
process.env.INKCAST_HOME = mkdtempSync(path.join(tmpdir(), 'inkcast-home-'));

import { ctxFor } from '../src/geometry.js';
import {
  ILLUSTRATION_DIR,
  detectImageProvider,
  extractPathData,
  figureGround,
  formPlausibility,
  generateIllustration,
  illustrationKey,
  illustrationPaths,
  illustrationPrompt,
  illustrationRaster,
  resetIllustrationCache,
  resetImageProviderNotice,
  vectoriseToInk,
  type IllustrationRaster,
  type RasterGate,
  type RasterVerdict,
} from '../src/image.js';
import { inkStyleFor } from '../src/style.js';
import { flatPng, makePng, type Rgba } from './pngfixture.js';

const style = inkStyleFor({ style: 'marker', palette: 'color' });

const WHITE: Rgba = [255, 255, 255, 255];
const BLACK: Rgba = [0, 0, 0, 255];

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
  assert.equal(moved, 'M100 40 L110 40 L110 50 Z');
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

/* -------------------------------------------------------- the trust gate (6.4) */

/** A gate that says yes to bytes containing `good` and no to everything else. */
const stubGate: RasterGate = async ({ png }): Promise<RasterVerdict> =>
  png.includes('good') ? { ok: true, score: 1 } : { ok: false, score: 0.1, why: 'it is garbage' };

test('a garbage generation is rejected and retried once, and only the keeper is cached', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'inkcast-gate-'));
  resetIllustrationCache();
  const attempts: number[] = [];
  const problems: string[] = [];

  const got = await illustrationRaster({
    id: 'rover',
    prompt: 'a mars rover',
    dir,
    seed: 7,
    gate: stubGate,
    onProblem: (n) => problems.push(n),
    generate: async ({ attempt }) => {
      attempts.push(attempt);
      return Buffer.from(attempt === 1 ? 'garbage-bytes' : 'good-bytes');
    },
  });

  assert.deepEqual(attempts, [1, 2], 'the first miss must be retried exactly once');
  assert.ok(got, 'the accepted second attempt is what the lane returns');
  assert.equal(got.png.toString(), 'good-bytes');
  assert.equal(got.cached, false);

  // The trap this item exists to avoid: caching a rejection makes the retry permanent, so
  // the only file on disk must be the one that passed.
  const written = await readdir(path.join(dir, ILLUSTRATION_DIR));
  assert.deepEqual(written, [`${illustrationKey('rover', 'a mars rover')}.png`]);
  assert.equal(
    (await readFile(path.join(dir, got.rel))).toString(),
    'good-bytes',
    'the file under the cache key must be the accepted attempt, not the rejected one',
  );
  assert.equal(problems.length, 1, 'the rejected attempt was paid for, so it is reported');
  assert.match(problems[0] as string, /rejected/);
  assert.match(problems[0] as string, /paid for and not kept/);
});

test('two misses give up rather than looping, and both reach the run’s record', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'inkcast-gate-'));
  resetIllustrationCache();
  let calls = 0;
  const problems: string[] = [];

  // Its own subject: the machine-wide cache is shared across these tests exactly as it is
  // across projects, so two tests using one id would be one test reading the other's raster.
  const got = await illustrationRaster({
    id: 'lander',
    prompt: 'a mars lander',
    dir,
    gate: stubGate,
    onProblem: (n) => problems.push(n),
    generate: async () => {
      calls++;
      return Buffer.from('garbage-bytes');
    },
  });

  assert.equal(got, undefined, 'the caller falls back rather than drawing a rejected raster');
  assert.equal(calls, 2, 'one retry and no more — a model that missed twice will miss again');
  assert.equal(problems.length, 2);
  // Nothing was written, so a later run is free to try again from scratch.
  assert.equal(existsSync(path.join(dir, ILLUSTRATION_DIR)), false);
});

test('the retry asks for a different draw, not the same one again', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'inkcast-gate-'));
  resetIllustrationCache();
  const seeds: (number | undefined)[] = [];
  await illustrationRaster({
    id: 'orbiter',
    prompt: 'a mars orbiter',
    dir,
    seed: 41,
    gate: stubGate,
    generate: async ({ seed }) => {
      seeds.push(seed);
      return Buffer.from('garbage-bytes');
    },
  });
  // Deterministically derived from the asset's own seed, so the second attempt is
  // reproducible from the same inputs rather than random.
  assert.deepEqual(seeds, [41, 42]);
});

test('a cached raster is gated too, and a rejected one is reported, not re-billed', async () => {
  // Where this departs from the pose lane, deliberately: these caches predate the gate and
  // hold the audit's own evidence, so a gate that trusted them would never fire.
  const dir = await mkdtemp(path.join(tmpdir(), 'inkcast-gate-'));
  const key = illustrationKey('probe', 'a mars probe');
  await mkdir(path.join(dir, ILLUSTRATION_DIR), { recursive: true });
  await writeFile(path.join(dir, ILLUSTRATION_DIR, `${key}.png`), Buffer.from('garbage-bytes'));

  resetIllustrationCache();
  const problems: string[] = [];
  let generated = 0;
  const got = await illustrationRaster({
    id: 'probe',
    prompt: 'a mars probe',
    dir,
    gate: stubGate,
    onProblem: (n) => problems.push(n),
    generate: async () => {
      generated++;
      return Buffer.from('good-bytes');
    },
  });

  assert.equal(got, undefined);
  assert.equal(generated, 0, 'a cache hit is never silently re-billed to fix itself');
  assert.equal(problems.length, 1);
  assert.match(problems[0] as string, /Delete .*\.png/, 'the note names the file to remove');
});

test('the gate abstains on bytes it cannot see, so a missing tracer is not a lane outage', async () => {
  // `formPlausibility` on something that is not an image: the tracer either is not
  // installed or refuses the bytes, and neither is evidence that the raster is bad.
  const verdict = await formPlausibility(Buffer.from('not a png'));
  assert.equal(verdict.ok, true);
  assert.equal(verdict.score, 1);
  assert.equal(verdict.why, undefined);
});

test('a grey-ground figure raster is flagged, and a white one is not', async () => {
  // A figure is composited with multiply, which is the identity only against white.
  const grey = await figureGround(flatPng(64, 64, [200, 200, 200, 255]));
  assert.equal(grey.ok, false);
  assert.match(grey.why ?? '', /ground is not white/);
  assert.match(grey.why ?? '', /grey card/);

  const white = await figureGround(flatPng(64, 64, WHITE));
  assert.equal(white.ok, true);
  assert.equal(white.score, 1);
});

test('the form gate rejects a blank page and a strip, and accepts a drawing', async (t) => {
  // The tracer is an optionalDependency; where it is absent the gate abstains and there is
  // nothing here to assert. That abstention is itself covered above.
  const grid = makePng(256, 256, (x, y) => {
    const inBlock = (v: number): boolean => v >= 28 && (v - 28) % 40 < 20 && v < 228;
    return inBlock(x) && inBlock(y) ? BLACK : WHITE;
  });
  const drawing = await formPlausibility(grid);
  if (drawing.ok && drawing.score === 1 && (await formPlausibility(flatPng(64, 64, WHITE))).ok) {
    t.skip('the optional native tracer is not installed here — the gate abstains');
    return;
  }

  assert.equal(drawing.ok, true, 'a page of drawn blocks is a drawing');

  const blank = await formPlausibility(flatPng(256, 256, WHITE));
  assert.equal(blank.ok, false);
  assert.match(blank.why ?? '', /blank|nothing/);

  // One long thin bar: the shape a model returns when it writes a line of words instead of
  // drawing. 200×8 is 25:1, well past the 4:1 ceiling.
  const strip = makePng(256, 256, (x, y) =>
    x >= 28 && x < 228 && y >= 124 && y < 132 ? BLACK : WHITE,
  );
  const verdict = await formPlausibility(strip);
  assert.equal(verdict.ok, false);
  assert.match(verdict.why ?? '', /strip rather than a subject/);
});

/* ------------------------------------ the model in the figure key (6.5) */

test('the figure key names its model, and only when it is not a built-in one', () => {
  const plain = illustrationKey('ventricle', 'a cutaway heart', 'figure');
  // Both providers' own endpoints contribute nothing, so the eight figure rasters already
  // in the machine cache stay served and `illustration/v2` stays an honest version token.
  // Setting the override to the value it already had is a no-op, as it should be.
  assert.equal(
    plain,
    illustrationKey('ventricle', 'a cutaway heart', 'figure', 1, 'fal-ai/flux/dev'),
  );
  assert.equal(
    plain,
    illustrationKey('ventricle', 'a cutaway heart', 'figure', 1, 'black-forest-labs/flux-dev'),
  );
  // A model that draws a different heart is a different picture, and a figure is shown as
  // it arrived — this is the aliasing the `kind` token already exists to stop.
  assert.notEqual(
    plain,
    illustrationKey('ventricle', 'a cutaway heart', 'figure', 1, 'fal-ai/nano-banana'),
  );
  // A form raster is binarised and re-traced, so the model that drew it does not survive
  // into the board: invalidating those would be paying twice for the same ink.
  const form = illustrationKey('ventricle', 'a cutaway heart');
  assert.equal(
    form,
    illustrationKey('ventricle', 'a cutaway heart', 'form', 1, 'fal-ai/nano-banana'),
  );
  assert.notEqual(form, plain);
});

/** Everything the lane wrote to stdout while it ran. */
async function logged(fn: () => Promise<void>): Promise<string> {
  const out: string[] = [];
  const real = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown) => {
    out.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    await fn();
  } finally {
    process.stdout.write = real;
  }
  return out.join('');
}

test('switching INKCAST_FIGURE_MODEL misses the figure cache and says why', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'inkcast-figmodel-'));
  const pass: RasterGate = async (): Promise<RasterVerdict> => ({ ok: true, score: 1 });
  const ask = async (bytes: string): Promise<IllustrationRaster | undefined> => {
    resetIllustrationCache();
    return illustrationRaster({
      id: 'ventricle',
      prompt: 'a cutaway heart',
      dir,
      kind: 'figure',
      gate: pass,
      generate: async () => Buffer.from(bytes),
    });
  };

  const first = await ask('built-in-bytes');
  assert.ok(first);
  assert.equal(first.cached, false);
  // The built-in model's picture is on disk now, so the same ask is free.
  assert.equal((await ask('never-called'))?.cached, true);

  let switched: IllustrationRaster | undefined;
  let said = '';
  process.env.INKCAST_FIGURE_MODEL = 'fal-ai/nano-banana';
  try {
    said = await logged(async () => {
      switched = await ask('banana-bytes');
    });
  } finally {
    delete process.env.INKCAST_FIGURE_MODEL;
  }

  assert.ok(switched);
  assert.equal(switched.cached, false, 'a different model draws a different picture');
  assert.notEqual(switched.rel, first.rel, 'and it is filed under its own key, not over the old');
  assert.equal(switched.png.toString(), 'banana-bytes');
  // "says why": the miss names the model that caused it and the file it declined to serve,
  // so a re-bill of a subject the cache visibly holds is never unexplained.
  assert.match(said, /INKCAST_FIGURE_MODEL=fal-ai\/nano-banana/);
  assert.match(said, /was not served/);
  assert.ok(said.includes(path.resolve(dir, first.rel)), 'the note names the declined file');

  // Back on the built-in model the original picture returns, unbilled: the override adds a
  // key, it does not replace one.
  const back = await ask('never-called');
  assert.equal(back?.cached, true);
  assert.equal(back?.png.toString(), 'built-in-bytes');
});

test('the form lane does not read INKCAST_FIGURE_MODEL at all', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'inkcast-figmodel-'));
  const pass: RasterGate = async (): Promise<RasterVerdict> => ({ ok: true, score: 1 });
  const ask = async (bytes: string): Promise<IllustrationRaster | undefined> => {
    resetIllustrationCache();
    return illustrationRaster({
      id: 'derrick',
      prompt: 'a drilling derrick',
      dir,
      gate: pass,
      generate: async () => Buffer.from(bytes),
    });
  };

  assert.equal((await ask('line-art'))?.cached, false);
  process.env.INKCAST_FIGURE_MODEL = 'fal-ai/nano-banana';
  try {
    const again = await ask('never-called');
    assert.equal(again?.cached, true, 'the figure model must not invalidate traced line art');
    assert.equal(again?.png.toString(), 'line-art');
  } finally {
    delete process.env.INKCAST_FIGURE_MODEL;
  }
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
