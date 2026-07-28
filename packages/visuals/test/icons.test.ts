import assert from 'node:assert/strict';
import test from 'node:test';
import { ctxFor } from '../src/geometry.js';
import { iconPathData, iconPaths, iconsAvailable, matchIcon, readIconSvg } from '../src/icons.js';
import { inkStyleFor } from '../src/style.js';
import { containsBox, padBox, pathBBox, unionBox } from '../src/svg.js';

const style = inkStyleFor({ style: 'marker', palette: 'color' });
const available = iconsAvailable();
// lucide-static is a hard dependency of this package; the guard exists so the
// suite reports honestly instead of erroring before `pnpm install` has run.
const opts = available ? {} : { skip: 'lucide-static is not installed' };

/** The nouns a heuristic planner actually produces for explainer content. */
const NOUNS = [
  'data',
  'dataset',
  'database',
  'user',
  'users',
  'customer',
  'server',
  'backend',
  'cloud',
  'brain',
  'model',
  'neural network',
  'money',
  'cost',
  'revenue',
  'clock',
  'time',
  'latency',
  'warning',
  'risk',
  'bug',
  'growth',
  'trend',
  'decline',
  'network',
  'graph',
  'file',
  'document',
  'folder',
  'lock',
  'security',
  'key',
  'token',
  'search',
  'query',
  'gear',
  'settings',
  'config',
  'arrow right',
  'arrow left',
  'arrow up',
  'arrow down',
  'chart',
  'analytics',
  'dashboard',
  'database shard',
  'cloud storage',
  'code',
  'terminal',
  'api',
  'mail',
  'message',
  'phone',
  'laptop',
  'globe',
  'wifi',
  'link',
  'shield',
  'eye',
  'target',
  'trophy',
  'star',
  'heart',
  'idea',
  'lightbulb',
  'rocket',
  'flag',
  'map',
  'book',
  'pencil',
  'image',
  'video',
  'microphone',
  'filter',
  'list',
  'check',
  'cross',
  'plus',
  'layers',
  'stack',
  'grid',
  'workflow',
  'pipeline',
  'branch',
  'merge',
  'tree',
  'hierarchy',
  'package',
  'container',
  'cpu',
  'memory',
  'gradient descent',
  'loss function',
  'weights',
  'training loop',
  'the request queue',
  'a happy customer',
  'building',
  'factory',
  'truck',
  'gift',
  'experiment',
  'science',
  'atom',
  'dna',
  'fire',
  'water',
  'leaf',
  'sun',
  'infinity',
  'puzzle',
  'bot',
  'agent',
];

test('common explainer nouns resolve to icons that exist on disk', opts, () => {
  const unresolved: string[] = [];
  for (const noun of NOUNS) {
    const match = matchIcon(noun);
    assert.ok(match, `no match at all for "${noun}"`);
    assert.ok(readIconSvg(match.slug), `"${noun}" resolved to a missing file ${match.slug}.svg`);
    if (match.how === 'fallback') unresolved.push(noun);
  }
  assert.deepEqual(unresolved, [], 'these nouns fell through to the generic fallback');
});

test('plurals, typos and phrases still land somewhere sensible', opts, () => {
  assert.equal(matchIcon('servers')?.slug, 'server');
  assert.equal(matchIcon('users')?.slug, 'users');
  assert.equal(matchIcon('databases')?.slug, 'database');
  assert.equal(matchIcon('Data')?.slug, 'database');
  assert.equal(matchIcon('  clock  ')?.slug, 'clock');
  // The head noun of a phrase wins over the modifier.
  assert.equal(matchIcon('http request queue')?.slug, 'inbox');
  assert.equal(matchIcon('customer support team')?.slug, 'users');
  // A near-miss goes through similarity rather than to the fallback.
  const typo = matchIcon('databse');
  assert.ok(typo && typo.how !== 'fallback', 'a one-letter typo should still resolve');
});

test('an unmatched noun degrades to the fallback icon, never to nothing', opts, () => {
  const match = matchIcon('zzzqqqxxwv');
  assert.ok(match);
  assert.ok(readIconSvg(match.slug));
});

test('matchIcon can refuse to guess when asked', opts, () => {
  assert.equal(matchIcon('zzzqqqxxwv', { allowFallback: false }), undefined);
});

test('iconPathData converts paths, circles, rects and lines', opts, () => {
  // `user` is a path plus a circle; `layout-grid` is four rects.
  const user = readIconSvg('user');
  assert.ok(user);
  const userPaths = iconPathData(user);
  assert.ok(userPaths.length >= 2, 'the circle child must not be dropped');
  for (const d of userPaths) assert.match(d, /^M/);

  const grid = readIconSvg('layout-grid');
  assert.ok(grid);
  const gridPaths = iconPathData(grid);
  assert.equal(gridPaths.length, 4, 'four <rect> children');
  for (const d of gridPaths) assert.ok(d.endsWith('Z'), 'a rect must close');
});

test('iconPathData ignores the header comment and svg attributes', opts, () => {
  const svg = readIconSvg('circle');
  assert.ok(svg);
  const paths = iconPathData(svg);
  assert.equal(paths.length, 1);
  assert.match(paths[0] ?? '', /^M/);
});

test('roughened icons stay inside the box they were given', opts, () => {
  const box = { x: 500, y: 300, w: 240, h: 240 };
  for (const noun of ['database', 'user', 'brain', 'cloud', 'workflow']) {
    const result = iconPaths(noun, box, ctxFor(style, 99));
    assert.ok(result, `no geometry for ${noun}`);
    assert.ok(result.paths.length > 0);
    const bounds = unionBox(result.paths.map((p) => pathBBox(p.d)));
    // Roughening wanders a few units outside the fitted geometry, so compare
    // against the box grown by the stroke width.
    assert.ok(
      containsBox(padBox(box, style.strokeWidth * 4), bounds),
      `${noun} drew outside its box: ${JSON.stringify(bounds)}`,
    );
    assert.ok(bounds.w > box.w * 0.4, `${noun} came out suspiciously small`);
  }
});

test('icon geometry is deterministic for a given seed', opts, () => {
  const box = { x: 0, y: 0, w: 200, h: 200 };
  const a = iconPaths('server', box, ctxFor(style, 21));
  const b = iconPaths('server', box, ctxFor(style, 21));
  assert.deepEqual(
    a?.paths.map((p) => p.d),
    b?.paths.map((p) => p.d),
  );
});

test('an explicit slug bypasses matching', opts, () => {
  const result = iconPaths('anything at all', { x: 0, y: 0, w: 100, h: 100 }, ctxFor(style, 1), {
    slug: 'rocket',
  });
  assert.equal(result?.slug, 'rocket');
});
