/**
 * Style packs are data (plan item 7.3, audit X-f).
 *
 * The done-bar is "adding a fifth style touches zero TypeScript", and the only way to
 * test that honestly is to add one: `withPacks` writes a JSON file into a scratch
 * directory, points `INKCAST_STYLE_DIR` at it, and asks the schema, the loader and the
 * cache key about a style this repository has never heard of. Everything else here is the
 * discipline the loader is supposed to enforce — one accent, a light surface, a filename
 * that agrees with the id — which is the other half of the bar: a pack format nobody can
 * misuse quietly.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseStoryboard } from '../src/storyboard.js';
import {
  DEFAULT_STYLE,
  MIN_PAPER_LUMA,
  relativeLuminance,
  resetStylePacks,
  styleIds,
  styleKey,
  stylePackFor,
  stylePacks,
  stylePalette,
} from '../src/stylepack.js';

/** The one camera every scene in this file is shot with; nothing here is about framing. */
const SHOT = { x: 0, y: 0, zoom: 1 };

/** A minimal legal pack: id, name, a face and a pen. Everything else defaults. */
function packBody(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    name: id,
    hand: { fontFamily: `Face ${id}`, fontFiles: [id] },
    pen: {
      width: 3,
      weight: 0.8,
      art: {
        unit: 100,
        baseAngle: 150,
        follow: 0.5,
        parts: [{ d: 'M 0 0 L 0 -20', fill: '#000' }],
      },
    },
    ...extra,
  };
}

/**
 * Run `fn` with extra packs on the search path, then put the loader back.
 *
 * The directory is *prepended* rather than replacing the repo's, which is what
 * `INKCAST_STYLE_DIR` does in production too — so the four shipped packs are still there
 * and the fixture is genuinely a fifth style rather than a whole new world.
 */
function withPacks<T>(files: Record<string, unknown>, fn: (dir: string) => T): T {
  const dir = mkdtempSync(path.join(tmpdir(), 'inkcast-styles-'));
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), JSON.stringify(body, null, 2));
  }
  const before = process.env.INKCAST_STYLE_DIR;
  process.env.INKCAST_STYLE_DIR = dir;
  resetStylePacks();
  try {
    return fn(dir);
  } finally {
    if (before === undefined) delete process.env.INKCAST_STYLE_DIR;
    else process.env.INKCAST_STYLE_DIR = before;
    resetStylePacks();
  }
}

test('the four shipped personalities are packs, and the default is among them', () => {
  const ids = styleIds();
  for (const want of ['marker', 'pencil', 'chalk', 'ink']) {
    assert.ok(ids.includes(want), `${want} must be a pack in styles/`);
  }
  assert.ok(ids.includes(DEFAULT_STYLE));
  // Every pack is filed under its own id — `stylePacks()` refuses a mismatch, and this is
  // what makes "the style a film names" and "the file a reader opens" the same thing.
  for (const id of ids) assert.equal(path.basename(stylePackFor(id).file, '.json'), id);
});

test('the shipped packs carry the numbers the four hardcoded tables held', () => {
  // Spot-checked against the tables this item replaced, one field per table: the visuals
  // stroke width, the renderer's pen weight, the sketch engine's passes and the face. If
  // a pack is edited by accident these are the four that move the pinned pixels.
  const marker = stylePackFor('marker');
  assert.equal(marker.pen.width, 4.4);
  assert.equal(marker.pen.weight, 1.0);
  assert.equal(marker.sketch.passes, 2);
  assert.equal(marker.hand.fontFamily, 'Shantell Sans');
  const liner = stylePackFor('ink');
  assert.equal(liner.rough.multiStroke, false, 'the liner draws each edge once');
  assert.equal(liner.sketch.passes, 1);
});

test('a fifth style is a fifth file — no TypeScript anywhere', () => {
  withPacks({ 'felt-tip.json': packBody('felt-tip') }, () => {
    assert.ok(styleIds().includes('felt-tip'));
    // The IR accepts it, which is the seam every stage reads the style through.
    const sb = parseStoryboard({
      version: 1,
      title: 'x',
      meta: { style: 'felt-tip' },
      scenes: [{ id: 's1', narration: 'hello', camera: SHOT, elements: [] }],
    });
    assert.equal(sb.meta.style, 'felt-tip');
    // And the four it did not replace are still there.
    assert.equal(stylePackFor('marker').pen.width, 4.4);
  });
});

test('an unknown style is rejected at the IR, with the known ones named', () => {
  assert.throws(
    () =>
      parseStoryboard({
        version: 1,
        title: 'x',
        meta: { style: 'crayon' },
        scenes: [{ id: 's1', narration: 'hello', camera: SHOT, elements: [] }],
      }),
    /crayon[\s\S]*marker/,
  );
});

test('a cache key carries what the name means, not just the name', () => {
  const before = styleKey('marker');
  assert.match(before, /^marker@[0-9a-f]{12}$/);
  // Same name, different ink: a film keyed on the bare name would serve the old geometry.
  withPacks({ 'marker.json': packBody('marker', { rough: { roughness: 9 } }) }, () => {
    assert.notEqual(styleKey('marker'), before, 'an edited pack must move the key');
  });
  assert.equal(styleKey('marker'), before, 'and the key must come back when it does');
});

test('the schema keeps the film to one accent', () => {
  const pal = {
    paper: '#fcfbf9',
    ink: '#1b232e',
    inkSoft: '#5a6472',
    grid: 'rgba(0,0,0,0.05)',
    accent: '#2f6fed',
    contrast: '#c2410c',
    highlight: '#f5c445',
  };
  // A second accent has nowhere to go: the field is one string, and `.strict()` means an
  // `accents` array is an error rather than an ignored line.
  assert.throws(
    () =>
      withPacks({ 'rainbow.json': packBody('rainbow', { palette: { ...pal, accents: [] } }) }, () =>
        styleIds(),
      ),
    /accents/,
  );
  // An accent that cannot be told from the ink is not a mark-up...
  assert.throws(
    () =>
      withPacks({ 'flat.json': packBody('flat', { palette: { ...pal, accent: pal.ink } }) }, () =>
        styleIds(),
      ),
    /accent must differ from the ink/,
  );
  // ...and one that cannot be told from the second marker is not a pair.
  assert.throws(
    () =>
      withPacks(
        { 'same.json': packBody('same', { palette: { ...pal, contrast: pal.accent } }) },
        () => styleIds(),
      ),
    /tellable apart/,
  );
  // The legal one loads, and answers only for a colour film — mono is a mode, not a taste.
  withPacks({ 'cream.json': packBody('cream', { palette: { ...pal, paper: '#f7f0e2' } }) }, () => {
    assert.equal(stylePalette('cream', 'color')?.paper, '#f7f0e2');
    assert.equal(stylePalette('cream', 'mono'), undefined);
    // A pack that declares nothing leaves the board's own table in charge.
    assert.equal(stylePalette('marker', 'color'), undefined);
  });
});

/**
 * The inverse of the test that used to be here (plan 9.2, audit S5.6).
 *
 * A dark board was refused outright, because a generated figure composited with multiply
 * disappeared into it. Now that a figure is keyed to real alpha for a dark surface
 * (`keyFigureToSurface` in `@inkcast/visuals`), a slate pack is a supported pack — and the
 * constant that refused it is kept, at the same value, as the switch that routes the two
 * composites. This asserts both halves: it loads, and it is still on the dark side of the
 * line the renderer will ask about.
 */
test('a dark board loads, and is still recognised as the dark side of the line', () => {
  const slate = {
    paper: '#1b232e',
    ink: '#fcfbf9',
    inkSoft: '#b9c0c9',
    grid: 'rgba(255,255,255,0.06)',
    accent: '#7fb3ff',
    contrast: '#ffb27f',
    highlight: '#f5c445',
  };
  assert.ok(relativeLuminance('#1b232e') < MIN_PAPER_LUMA, 'slate is the dark case');
  assert.ok(
    relativeLuminance('#fcfbf9') > MIN_PAPER_LUMA,
    'the board`s own paper is the light one',
  );
  const ids = withPacks({ 'slate.json': packBody('slate', { palette: slate }) }, () => styleIds());
  assert.ok(ids.includes('slate'), 'a dark pack must load now that figures can be keyed');
});

/**
 * What replaced the luma floor: the thing it was a proxy for.
 *
 * A board is unreadable when its ink is too close to its own paper, and that is as true of
 * a white board with pale-grey ink — which the old floor happily accepted — as of a slate
 * board with charcoal on it.
 */
test('a board whose ink cannot be read against it is refused, light or dark', () => {
  const pale = {
    paper: '#fcfbf9',
    ink: '#d8d5d0',
    inkSoft: '#e4e2de',
    grid: 'rgba(0,0,0,0.05)',
    accent: '#7fb3ff',
    contrast: '#ffb27f',
    highlight: '#f5c445',
  };
  assert.throws(
    () => withPacks({ 'pale.json': packBody('pale', { palette: pale }) }, () => styleIds()),
    /contrasts .*below the 4\.5:1 floor/,
  );
  // And the dark twin of the same fault, which the luma floor could never have caught
  // because it only ever looked at the paper.
  const murk = { ...pale, paper: '#1b232e', ink: '#2f3a49', inkSoft: '#3d4a5c' };
  assert.throws(
    () => withPacks({ 'murk.json': packBody('murk', { palette: murk }) }, () => styleIds()),
    /contrasts .*below the 4\.5:1 floor/,
  );
});

test('a typo in a pack is an error, not a silently ignored line', () => {
  assert.throws(
    () =>
      withPacks({ 'typo.json': packBody('typo', { rough: { roughnes: 2 } }) }, () => styleIds()),
    /roughnes/,
  );
  assert.throws(
    () => withPacks({ 'misfiled.json': packBody('other') }, () => styleIds()),
    /filed as/,
  );
});

test('packs are loaded once, and the same object is handed out', () => {
  assert.equal(stylePacks(), stylePacks());
  assert.equal(stylePackFor('chalk'), stylePackFor('chalk'));
});
