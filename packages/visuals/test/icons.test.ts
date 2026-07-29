import assert from 'node:assert/strict';
import test from 'node:test';
import { ctxFor } from '../src/geometry.js';
import {
  ICON_KEYWORDS,
  iconPathData,
  iconPaths,
  iconsAvailable,
  matchAsset,
  matchIcon,
  readIconSvg,
} from '../src/icons.js';
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

/* ------------------------------------------- the explainer vocabulary sweep */

test('every keyword in the table resolves to an icon that really exists', opts, () => {
  const broken: string[] = [];
  for (const [word, candidates] of Object.entries(ICON_KEYWORDS)) {
    assert.ok(candidates.length > 0, `${word} has no candidates`);
    // Candidate lists are rename chains, so only one has to be installed — but a
    // word whose whole chain is dead silently degrades to fuzzy matching, which is
    // exactly how "loss" became a briefcase.
    if (!candidates.some((slug) => readIconSvg(slug) !== undefined)) broken.push(word);
  }
  assert.deepEqual(broken, [], `keywords with no installed icon: ${broken.join(', ')}`);
});

test('the keyword table covers the vocabulary teaching needs', opts, () => {
  // Maths, physics, biology, economics, pedagogy and the everyday anchors an
  // explanation is built on — none of which the product-flavoured MVP table had.
  const needed = [
    'slope',
    'tangent',
    'curve',
    'hill',
    'valley',
    'minimum',
    'maximum',
    'gradient',
    'loss',
    'weights',
    'derivative',
    'overfitting',
    'plateau',
    'convergence',
    'force',
    'mass',
    'gravity',
    'energy',
    'temperature',
    'wave',
    'frequency',
    'circuit',
    'atom',
    'orbit',
    'magnet',
    'lever',
    'ball',
    'cell',
    'dna',
    'protein',
    'bacteria',
    'virus',
    'blood',
    'bone',
    'photosynthesis',
    'demand',
    'inflation',
    'interest',
    'tax',
    'debt',
    'savings',
    'equilibrium',
    'example',
    'summary',
    'proof',
    'mistake',
    'misconception',
    'question',
    'answer',
    'intuition',
    'analogy',
    'abstract',
    'concrete',
    'fog',
    'rain',
    'walking',
    'hiking',
    'thermostat',
    'maze',
    'ladder',
    'brick',
    'race',
  ];
  const missing = needed.filter((w) => ICON_KEYWORDS[w] === undefined);
  assert.deepEqual(missing, [], `the table is missing: ${missing.join(', ')}`);
  for (const word of needed) {
    const match = matchIcon(word, { allowFallback: false });
    assert.ok(match, `${word} resolves to nothing`);
    assert.equal(match.how, 'keyword', `${word} fell through to a ${match.how} guess`);
  }
});

test('the nouns the MVP got wrong now land on the right icon', opts, () => {
  // Each of these was a real, visible mismatch in the shipped sample films.
  const cases: Array<[string, string]> = [
    ['loss', 'trending-down'],
    ['trending-down', 'trending-down'],
    ['mountain', 'mountain'],
    ['briefcase', 'briefcase'],
    ['cpu', 'cpu'],
    ['gradient', 'trending-down'],
    ['weights', 'sliders-horizontal'],
  ];
  for (const [term, slug] of cases) {
    assert.equal(matchIcon(term)?.slug, slug, `${term} should be ${slug}`);
  }
});

/* ------------------------------------------------------------- matchAsset --- */

test('matchAsset trusts a confident id over the prompt', opts, () => {
  // The exact failure this ordering exists to prevent: the id is a real slug and
  // the prompt is prose, and the prose used to win and drag the match into the
  // fuzzy tier.
  const cases: Array<{ id: string; prompt: string; slug: string }> = [
    { id: 'trending-down', prompt: 'a downward trending arrow', slug: 'trending-down' },
    { id: 'mountain', prompt: 'a mountain peak in the fog', slug: 'mountain' },
    { id: 'briefcase', prompt: 'a business briefcase', slug: 'briefcase' },
    { id: 'cpu', prompt: 'a computer processor chip', slug: 'cpu' },
    { id: 'loss', prompt: 'how wrong the model is right now', slug: 'trending-down' },
  ];
  for (const c of cases) {
    assert.equal(
      matchAsset({ id: c.id, prompt: c.prompt })?.slug,
      c.slug,
      `${c.id} should stay ${c.slug}`,
    );
  }
});

test('matchAsset falls back to the prompt when the id says nothing', opts, () => {
  assert.equal(matchAsset({ id: 'asset-7', prompt: 'a rocket launching' })?.slug, 'rocket');
  assert.equal(matchAsset({ id: 'thing-2', prompt: 'a database' })?.slug, 'database');
  // No prompt and a useless id still yields a mark rather than nothing.
  const bare = matchAsset({ id: 'xq-91' });
  assert.ok(bare, 'a drawing is better than a hole in the board');
  assert.equal(matchAsset({ id: 'xq-91' }, { allowFallback: false })?.how !== 'fallback', true);
});

test('matchAsset agrees with matchIcon when only one of them can decide', opts, () => {
  assert.equal(matchAsset({ id: 'database' })?.slug, matchIcon('database')?.slug);
  assert.equal(matchAsset({ id: '', prompt: 'a brain' })?.slug, matchIcon('a brain')?.slug);
});
