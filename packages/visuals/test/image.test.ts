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

import type { ModelSpend } from '@inkcast/core';
import { ctxFor } from '../src/geometry.js';
import {
  ILLUSTRATION_DIR,
  detectImageProvider,
  extractPathData,
  figureGround,
  figureImageRect,
  formPlausibility,
  generateIllustration,
  illustrationKey,
  illustrationPaths,
  illustrationPrompt,
  illustrationRaster,
  isDarkSurface,
  keyFigureToSurface,
  resetIllustrationCache,
  resetImageProviderNotice,
  vectoriseToInk,
  type IllustrationRaster,
  type RasterGate,
  type RasterVerdict,
} from '../src/image.js';
import { readPng } from '../src/png.js';
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

/* ------------------------------------------------------- what was really billed */

/**
 * The image cost line, built from calls instead of from intent (audit X-e).
 *
 * `generatedAssets` used to count every asset the finished board marked `generated`, which
 * is a statement about where a picture came from *originally* and stays true forever. The
 * measurement is `projects/qc64-hashmap`: four such assets, zero provider calls, the
 * machine cache unchanged at 42 files afterwards, and `visuals fal $0.0120` on the report.
 * Only this lane can tell a generation from the three cache tiers above it, so this is
 * where the bill is now written.
 */
test('a cache hit is not billed, and a real generation is', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'inkcast-spend-'));
  resetIllustrationCache();
  const spend: ModelSpend[] = [];

  const made = await illustrationRaster({
    id: 'sonde',
    prompt: 'a weather sonde',
    dir,
    gate: stubGate,
    onSpend: (s) => spend.push(s),
    generate: async () => Buffer.from('good-bytes'),
  });
  assert.ok(made);
  assert.equal(made.cached, false);
  // A copy, not `spend` itself: `assert.deepEqual` narrows its argument's type, and this
  // array is pushed to again below.
  assert.deepEqual([...spend], [{ lane: 'illustration', provider: 'none', images: 1 }]);

  // The same subject again, now sitting in the project. This is the run the old counter
  // billed: the asset is still `generated`, and nothing was generated.
  resetIllustrationCache();
  const again = await illustrationRaster({
    id: 'sonde',
    prompt: 'a weather sonde',
    dir,
    gate: stubGate,
    onSpend: (s) => spend.push(s),
    generate: async () => Buffer.from('good-bytes'),
  });
  assert.ok(again);
  assert.equal(again.cached, true);
  assert.equal(spend.length, 1, 'a picture that was found is free');
});

test('a raster the gate throws away was still paid for', async () => {
  // The one place this departs from the handoff's `cached === false` shape, and the file
  // said so before the bill did: "a rejected generation still cost money". Two attempts
  // rejected means two images billed and none drawn — a caller keying off the returned
  // raster sees `undefined` and would bill nothing at all.
  const dir = await mkdtemp(path.join(tmpdir(), 'inkcast-spend-'));
  resetIllustrationCache();
  const spend: ModelSpend[] = [];

  const got = await illustrationRaster({
    id: 'balloon',
    prompt: 'a stratospheric balloon',
    dir,
    gate: stubGate,
    onSpend: (s) => spend.push(s),
    generate: async () => Buffer.from('garbage-bytes'),
  });

  assert.equal(got, undefined);
  assert.equal(spend.length, 2, 'both rejected attempts were charged for');
  assert.equal(
    spend.reduce((n, s) => n + (s.images ?? 0), 0),
    2,
  );
});

test('a call that returned nothing at all is not billed', async () => {
  // A 402, a network error, a provider with no key: nothing was drawn, so nothing is owed.
  // The distinction is bytes coming back, not the gate's opinion of them.
  const dir = await mkdtemp(path.join(tmpdir(), 'inkcast-spend-'));
  resetIllustrationCache();
  const spend: ModelSpend[] = [];

  const got = await illustrationRaster({
    id: 'kite',
    prompt: 'a box kite',
    dir,
    gate: stubGate,
    onSpend: (s) => spend.push(s),
    generate: async () => undefined,
  });

  assert.equal(got, undefined);
  assert.deepEqual(spend, []);
});

test('the lane a raster is billed under is the lane that asked for it', async () => {
  // A figure and a form are two lanes on the report; the underlay is a third, and it spends
  // inside the *lesson* stage, so filing it under `figure` would describe a different part
  // of the run. Grouping in `cost.ts` is by (lane, provider, model).
  const dir = await mkdtemp(path.join(tmpdir(), 'inkcast-spend-'));
  const spend: ModelSpend[] = [];
  const draw = async (id: string, extra: { kind?: 'form' | 'figure'; lane?: string }) => {
    resetIllustrationCache();
    await illustrationRaster({
      id,
      prompt: `a ${id}`,
      dir,
      gate: stubGate,
      onSpend: (s) => spend.push(s),
      generate: async () => Buffer.from('good-bytes'),
      ...extra,
    });
  };

  await draw('glider', {});
  await draw('airship', { kind: 'figure' });
  await draw('anemometer', { lane: 'underlay' });

  assert.deepEqual(
    spend.map((s) => s.lane),
    ['illustration', 'figure', 'underlay'],
  );
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

/* ------------------------------ keying a figure for a dark board (plan 9.2) */

const SLATE = { paper: '#1b232e', ink: '#f2efe6' };

test('a board is light or dark, and an unreadable colour is treated as light', () => {
  assert.equal(isDarkSurface('#1b232e'), true, 'slate');
  assert.equal(isDarkSurface('#fcfbf9'), false, 'the board`s own paper');
  // The line is drawn on *relative luminance*, which is not the byte value: `#808080` is
  // the midpoint of the range as a number and 0.216 as a luminance, so it keys. That is
  // the right way round — every colour a pack author would call cream, sand or pale grey
  // is well above the line (`#bcbcbc` is roughly where it falls), and everything below it
  // is dark enough that multiplying a picture's ink into it costs more than it buys.
  assert.equal(isDarkSurface('#808080'), true, 'half-value grey is 0.216 luminance');
  assert.equal(isDarkSurface('#d9d4c8'), false, 'sand is nowhere near the line');
  // Never silently change how a figure composites on a colour this cannot read: every
  // film in the corpus is on the multiply path and must stay there.
  assert.equal(isDarkSurface('rgb(20,20,20)'), false);
  assert.equal(isDarkSurface('not a colour'), false);
});

test('keying a figure turns its white ground transparent and its ink into chalk', () => {
  // Black line art on white, which is what every provider in this repo returns.
  const png = makePng(32, 32, (x, y) => (x > 8 && x < 24 && y > 8 && y < 24 ? BLACK : WHITE));
  const keyed = readPng(keyFigureToSurface(png, SLATE)!);
  assert.ok(keyed);

  const at = (x: number, y: number): number[] =>
    Array.from(keyed.rgba.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 4));

  // The ground: gone. This is the whole defect — under multiply it stayed opaque and
  // dragged the board's own colour down with it.
  assert.deepEqual(at(2, 2).slice(3), [0], 'the white ground must key to fully transparent');
  // The ink: fully opaque, and drawn in the board's own ink rather than left black.
  const mark = at(16, 16);
  assert.equal(mark[3], 255, 'black ink must key to fully opaque');
  assert.deepEqual(mark.slice(0, 3), [0xf2, 0xef, 0xe6], 'a neutral mark is made of chalk');
});

test('a keyed figure keeps real colour and rejects compression noise', () => {
  // Two marks: a saturated one (a real coloured figure) and a near-black one carrying the
  // channel noise every provider's compression leaves behind. Before the corpus sweep that
  // set `CHROMA_FLOOR`, the second came out as a bright speckle.
  const ORANGE: Rgba = [240, 140, 40, 255];
  const NOISY_BLACK: Rgba = [5, 30, 5, 255];
  const png = makePng(32, 32, (x) => (x < 8 ? ORANGE : x < 16 ? NOISY_BLACK : WHITE));
  const keyed = readPng(keyFigureToSurface(png, SLATE)!);
  assert.ok(keyed);
  const at = (x: number): number[] =>
    Array.from(keyed.rgba.subarray((16 * 32 + x) * 4, (16 * 32 + x) * 4 + 4));

  // Real colour survives, and reads as orange rather than as chalk.
  const orange = at(4);
  assert.ok(orange[0]! > 200 && orange[2]! < 80, `the orange must stay orange, got ${orange}`);
  assert.ok(orange[0]! - orange[2]! > 100, 'and stay saturated');

  // Noise does not. A 25-count channel error is a black stroke, not a green one.
  assert.deepEqual(at(12).slice(0, 3), [0xf2, 0xef, 0xe6], 'noise must key as neutral chalk');
});

test('keying abstains on bytes it cannot read, rather than guessing', () => {
  assert.equal(keyFigureToSurface(Buffer.from('not a png'), SLATE), undefined);
});

test('a figure fills the box it was given, centred, and is never letterboxed', () => {
  // One of the two finish defects `docs/PLAN-WATCHABILITY.md` §4.2 names. It is not
  // cosmetic: the reveal mask and the pen sprite both work from the *element's*
  // bounding box, so an image letterboxed inside a wider box spends part of its sweep
  // on empty margin and parks the nib off the picture.
  const box = { w: 840, h: 560 };

  // A square raster in a 3:2 box: height is the binding dimension, and the picture is
  // centred horizontally with nothing above or below it.
  const square = figureImageRect(box, { w: 1024, h: 1024 });
  assert.equal(square.h, 560, 'the binding dimension is filled exactly');
  assert.equal(square.y, 0);
  assert.equal(square.w, 560);
  assert.equal(square.x, 140, 'centred in the remaining width');

  // A raster wider than the box: width binds, and the margin moves to the other axis.
  const wide = figureImageRect(box, { w: 1600, h: 800 });
  assert.equal(wide.w, 840);
  assert.equal(wide.x, 0);
  assert.equal(wide.h, 420);
  assert.equal(wide.y, 70);

  // Aspect is never traded for coverage: a stretched figure is a different picture.
  for (const rect of [square, wide]) {
    assert.ok(rect.w <= box.w + 1e-9 && rect.h <= box.h + 1e-9, 'never overflows the box');
  }
  assert.ok(
    Math.abs(square.w / square.h - 1) < 1e-9 && Math.abs(wide.w / wide.h - 2) < 1e-9,
    'the raster keeps its own aspect',
  );

  // A raster whose size could not be read takes the whole box rather than collapsing
  // to nothing — `pngSize` abstains on shapes the decoder does not know.
  assert.deepEqual(figureImageRect(box, { w: 0, h: 0 }), { x: 0, y: 0, w: 840, h: 560 });
});
