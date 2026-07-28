import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  builtinMetrics,
  defaultFontDirs,
  findFontFile,
  loadFontMetrics,
  parseFontMetrics,
} from '../src/fontmetrics.js';
import { inkStyleFor } from '../src/style.js';

test('builtin metrics are self-consistent and monotonic in font size', () => {
  const m = builtinMetrics('Fallback');
  assert.equal(m.source, 'builtin');
  assert.ok(m.ascent > 0.5 && m.ascent < 1.2);
  assert.ok(m.descent > 0 && m.descent < 0.5);
  assert.ok(m.advance(0x6d) > m.advance(0x69), 'm must be wider than i');
  assert.ok(m.advance(0x41) > m.advance(0x61), 'A must be wider than a');
  assert.equal(m.measure('', 100), 0);
  assert.ok(Math.abs(m.measure('abc', 200) - m.measure('abc', 100) * 2) < 1e-9);
  assert.ok(m.measure('mmm', 100) > m.measure('iii', 100));
});

test('every ink style asks for its own handwriting face', () => {
  const seen = new Set<string>();
  for (const name of ['marker', 'pencil', 'chalk', 'ink'] as const) {
    const style = inkStyleFor({ style: name, palette: 'color' });
    assert.ok(style.fontFiles.length > 0);
    assert.ok(style.fontFamily.length > 0);
    seen.add(style.fontFamily);
  }
  assert.equal(seen.size, 4, 'the four styles must not share one face');
});

test('font discovery prefers the requested face, then any handwriting face', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'inkcast-fonts-'));
  // Content does not matter for discovery, only names and extensions.
  await writeFile(path.join(dir, 'notes.txt'), 'x');
  await writeFile(path.join(dir, 'SomeSans-Regular.ttf'), 'x');
  await writeFile(path.join(dir, 'Caveat[wght].ttf'), 'x');
  await writeFile(path.join(dir, 'PatrickHand-Regular.ttf'), 'x');

  assert.equal(path.basename(findFontFile(['caveat'], [dir]) ?? ''), 'Caveat[wght].ttf');
  assert.equal(
    path.basename(findFontFile(['patrickhand', 'patrick-hand'], [dir]) ?? ''),
    'PatrickHand-Regular.ttf',
  );
  // Shantell is absent, so it falls back to another known handwriting face
  // rather than to the unrelated sans.
  assert.equal(path.basename(findFontFile(['shantellsans'], [dir]) ?? ''), 'Caveat[wght].ttf');
  assert.equal(findFontFile(['caveat'], [path.join(dir, 'nope')]), undefined);
});

test('a corrupt or missing font degrades to builtin metrics instead of throwing', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'inkcast-fonts-'));
  await writeFile(path.join(dir, 'Caveat[wght].ttf'), 'definitely not a font');
  const style = inkStyleFor({ style: 'pencil', palette: 'color' });
  const m = loadFontMetrics({
    style: 'pencil',
    preferred: style.fontFiles,
    fontFamily: style.fontFamily,
    dirs: [dir],
  });
  assert.equal(m.source, 'builtin');
  assert.equal(m.familyName, style.fontFamily);
  assert.ok(m.measure('hello', 40) > 0);

  const empty = loadFontMetrics({
    style: 'marker',
    preferred: ['nothing-here'],
    fontFamily: 'Nothing',
    dirs: [path.join(dir, 'missing')],
  });
  assert.equal(empty.source, 'builtin');
});

test('parseFontMetrics rejects non-sfnt data', () => {
  assert.equal(parseFontMetrics(Buffer.from('not a font at all')), undefined);
  assert.equal(parseFontMetrics(Buffer.alloc(0)), undefined);
});

test('defaultFontDirs points at the repo-level assets/fonts', () => {
  const dirs = defaultFontDirs();
  assert.ok(dirs.length > 0);
  assert.ok(
    dirs.some((d) => d.endsWith(path.join('assets', 'fonts'))),
    JSON.stringify(dirs),
  );
});

/**
 * When the OFL fonts have been vendored, parse them for real: advance widths are
 * what all the wrapping depends on, so a silent regression here would ruin every
 * text block.
 */
test('a vendored OFL handwriting font parses with real metrics', () => {
  const file = findFontFile(['shantellsans', 'caveat', 'gaegu', 'patrickhand']);
  if (!file) {
    // Nothing vendored yet; the builtin path is covered above.
    return;
  }
  const m = parseFontMetrics(readFileSync(file), file);
  assert.ok(m, `failed to parse ${file}`);
  assert.equal(m.source, 'file');
  assert.ok(m.unitsPerEm >= 16 && m.unitsPerEm <= 16384);
  assert.ok(m.ascent > 0.4 && m.ascent < 2);
  assert.ok(m.descent > 0 && m.descent < 1);
  assert.ok(m.familyName.length > 0);
  assert.ok(m.advance(0x20) > 0.05, 'space must have an advance');
  assert.ok(m.advance(0x6d) > m.advance(0x69), 'm must be wider than i');
  assert.ok(m.measure('Gradient descent', 100) > 200);
  assert.ok(m.advance(0x4e2d) > 0, 'a missing glyph must still return a width');
});
