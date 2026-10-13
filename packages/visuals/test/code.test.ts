/**
 * The code lane's red tests (plan item 6.2).
 *
 * The done-bar has two halves and both are here: a listing comes out as highlighted
 * glyph geometry revealing line by line, and it is byte-identical across two resolves.
 * The rest of the file is the lane's refusals, which matter as much: this lane's whole
 * argument is that a listing lettered by hand is worse than no listing, so every path
 * that cannot set one has to return nothing rather than something approximate.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { CODE_LINE_HEIGHT, codeCellEm, codeGrid, monoMetrics } from '@inkcast/core';
import { resolveCode, type CodeSpec, type ResolvedCode } from '../src/code.js';
import { ctxFor, seedFrom } from '../src/geometry.js';
import { inkStyleFor } from '../src/style.js';
import { parsePath } from '../src/svg.js';

const style = inkStyleFor({ style: 'marker', palette: 'color' });
const SEED = seedFrom('code-test');
const BOX = { x: 120, y: 80, w: 700, h: 300 };

/** The plan's own acceptance example: the lookup half of a hash map. */
const LOOKUP = [
  'def get(self, key):',
  '    i = hash(key) % len(self.slots)',
  '    for k, v in self.slots[i]:   # walk the bucket',
  '        if k == key:',
  '            return v',
  '    raise KeyError(key)',
].join('\n');

function resolve(
  code: string,
  over: Partial<CodeSpec> = {},
  opts: { minEm?: number; maxEm?: number } = {},
): Promise<ResolvedCode | undefined> {
  return resolveCode(
    { code, lang: 'python', box: BOX, align: 'left', ...over },
    ctxFor(style, SEED),
    {
      style,
      ...opts,
    },
  );
}

function ds(r: ResolvedCode): string[] {
  return r.items.flatMap((i) => (i.kind === 'path' ? [i.path.d] : []));
}

test('a listing sets as real glyph outlines, crisp and filled', async () => {
  const r = await resolve(LOOKUP);
  assert.ok(r, 'the code lane produced nothing at all');

  // 114 drawable characters in the six lines above; a floor rather than the exact count,
  // so a font revision cannot break this while a degeneration to one blob still fails.
  assert.ok(r.layout.marks >= 100, `expected a glyph per character, got ${r.layout.marks}`);
  assert.equal(ds(r).length, r.layout.marks);
  assert.equal(r.layout.lines, 6);
  assert.equal(r.layout.lang, 'python');

  for (const d of ds(r)) {
    assert.match(d, /^M/, `path data must start with a moveto: ${d.slice(0, 24)}`);
    assert.ok(!/NaN|Infinity|undefined/.test(d), `non-numeric path data: ${d}`);
    assert.ok(parsePath(d).length >= 2, `mark has no geometry: ${d}`);
  }
  for (const item of r.items) {
    if (item.kind !== 'path') continue;
    // A glyph is a filled outline. An unfilled listing is a wireframe of a program.
    assert.notEqual(item.path.fill, 'none');
    assert.equal(item.path.fillRule, 'nonzero');
  }
});

test('the marks are in document order, so the reveal types line by line', async () => {
  const r = await resolve(LOOKUP);
  assert.ok(r);
  // `group` names the source line, and the groups must appear in ascending order with no
  // interleaving: the page slices an item's timeline in mark order, so mark order *is*
  // the reveal. A listing whose line 3 drew before line 1 would type itself backwards.
  const lines = r.items.flatMap((i) =>
    i.kind === 'path' ? [Number(/^code:(\d+)$/.exec(i.path.group ?? '')?.[1] ?? -1)] : [],
  );
  assert.ok(!lines.includes(-1), 'every mark must name the line it belongs to');
  for (let i = 1; i < lines.length; i++) {
    assert.ok(
      (lines[i] as number) >= (lines[i - 1] as number),
      `line ${String(lines[i])} drew after line ${String(lines[i - 1])}`,
    );
  }
  assert.equal(Math.min(...lines), 0);
  assert.equal(Math.max(...lines), 5);
});

test('byte-identical across two resolves — the item’s own done-bar', async () => {
  const a = await resolve(LOOKUP);
  const b = await resolve(LOOKUP);
  assert.ok(a && b);
  // Resolve a different listing in between, because the highlighter and the font reader
  // are both cached per process and a cache that leaked state would show up here.
  await resolve('SELECT 1;', { lang: 'sql' });
  const c = await resolve(LOOKUP);
  assert.ok(c);
  assert.deepEqual(ds(b), ds(a));
  assert.deepEqual(ds(c), ds(a));
  assert.deepEqual(b.layout, a.layout);
  assert.deepEqual(c.layout, a.layout);
});

test('highlighting spends four inks, and spends them on the right words', async () => {
  const r = await resolve('x = "hi"  # note\nreturn x');
  assert.ok(r);
  const grid = codeGrid('x = "hi"  # note\nreturn x');
  // Which tone each column of each line got, read back off the parts.
  const toneAt = new Map<string, string>();
  let mark = 0;
  for (const [lineIndex, line] of grid.lines.entries()) {
    for (const [col, ch] of [...line].entries()) {
      if (ch === ' ') continue;
      const part = r.layout.parts.find((p) => p.from <= mark && mark < p.to);
      toneAt.set(`${lineIndex}:${col}`, part?.tone ?? 'none');
      mark++;
    }
  }
  assert.equal(toneAt.get('0:0'), 'ink', 'an identifier is plain ink');
  assert.equal(toneAt.get('0:4'), 'contrast', 'a string literal is the contrast ink');
  assert.equal(toneAt.get('0:10'), 'muted', 'a comment is the soft ink');
  assert.equal(toneAt.get('1:0'), 'accent', '`return` is a keyword');
  // Every tone used is one of the four the IR has. A fifth would be the rainbow board.
  for (const part of r.layout.parts) {
    assert.ok(['ink', 'accent', 'contrast', 'muted'].includes(part.tone), part.tone);
  }
  // The runs cover every mark exactly once, in order — the renderer indexes into them.
  let next = 0;
  for (const part of r.layout.parts) {
    assert.equal(part.from, next, 'the runs must tile the draw sequence with no gaps');
    assert.ok(part.to > part.from);
    next = part.to;
  }
  assert.equal(next, r.layout.marks);
});

test('indentation is geometry: tabs and spaces land on the same columns', async () => {
  const spaces = await resolve('if x:\n    return 1\n', { lang: 'python' });
  const tabs = await resolve('if x:\n\treturn 1\n', { lang: 'python' });
  assert.ok(spaces && tabs);
  // Same grid, same box, same glyphs in the same places. A tab is a column instruction,
  // and a listing whose indentation moved is a listing whose block structure moved.
  assert.deepEqual(ds(tabs), ds(spaces));
  assert.deepEqual(tabs.layout.bounds, spaces.layout.bounds);
});

test('nothing is wrapped: a long line shrinks the whole block', async () => {
  const short = await resolve('a = 1', { lang: 'python' });
  const long = await resolve(`a = 1  # ${'x'.repeat(90)}`, { lang: 'python' });
  assert.ok(short && long);
  assert.equal(long.layout.lines, 1, 'a long line must not become two');
  assert.ok(long.layout.emSize < short.layout.emSize, 'the block should have been set smaller');
  // And it still fits the box it was given, which is what "fit" has to mean.
  assert.ok(long.layout.bounds.w <= BOX.w, `${long.layout.bounds.w} overran ${BOX.w}`);
});

test('the grid is the one in core, at the size the lane chose', async () => {
  const r = await resolve(LOOKUP);
  assert.ok(r);
  const { cols, lines } = codeGrid(LOOKUP);
  assert.equal(r.layout.cols, cols);
  assert.equal(r.layout.lines, lines.length);
  // The recorded cell and line advances are the ones a consumer would re-derive, so the
  // renderer never has to know the face — this is the A-4 rule for the code lane.
  assert.ok(Math.abs(r.layout.cellWidth - codeCellEm() * r.layout.emSize) < 0.02);
  assert.ok(Math.abs(r.layout.lineHeight - CODE_LINE_HEIGHT * r.layout.emSize) < 0.02);
  assert.ok(Math.abs(r.layout.bounds.w - cols * r.layout.cellWidth) < 0.5);
});

test('align places the block, and never stretches it', async () => {
  const left = await resolve('a = 1', { align: 'left' });
  const right = await resolve('a = 1', { align: 'right' });
  const centre = await resolve('a = 1', { align: 'center' });
  assert.ok(left && right && centre);
  assert.ok(right.layout.bounds.x > (centre.layout.bounds.x as number));
  assert.ok((centre.layout.bounds.x as number) > left.layout.bounds.x);
  // Same size in all three: alignment moves a block, it does not resize it.
  assert.equal(right.layout.emSize, left.layout.emSize);
  assert.equal(centre.layout.emSize, left.layout.emSize);
});

/* ------------------------------------------------- what the lane refuses to do */

test('a listing too big for its box is refused, not shrunk into a grey rectangle', async () => {
  const twenty = Array.from({ length: 20 }, (_, i) => `    step_${i}(value, index)`).join('\n');
  const r = await resolve(twenty, { box: { x: 0, y: 0, w: 200, h: 120 } }, { minEm: 12 });
  assert.equal(r, undefined, 'it must return nothing so the caller can gate');
  // The same listing in a box that can hold it at that floor does set.
  const ok = await resolve(twenty, { box: { x: 0, y: 0, w: 1400, h: 900 } }, { minEm: 12 });
  assert.ok(ok);
});

test('a character the face cannot draw is refused, never set as a blank cell', async () => {
  const mono = monoMetrics();
  assert.ok(mono, 'the vendored monospace face must be readable');
  // A CJK ideograph: real text, no glyph in a latin monospace face. Setting it would put
  // a hole in the listing with nothing anywhere saying so — S4-b, in monospace.
  assert.ok(!mono.covers('漢'.codePointAt(0) as number));
  assert.equal(await resolve('x = "漢"'), undefined);
});

test('whitespace alone is not a listing', async () => {
  assert.equal(await resolve('   \n\t\n'), undefined);
  assert.equal(await resolve(''), undefined);
});

test('an unknown grammar sets unhighlighted rather than failing the render', async () => {
  const r = await resolve('let x = 1', { lang: 'not-a-language' });
  assert.ok(r, 'a bad language id must not lose the listing');
  assert.equal(r.layout.lang, 'text');
  assert.equal(r.layout.langAsked, 'not-a-language');
  // Unhighlighted means one ink, not no ink.
  assert.deepEqual([...new Set(r.layout.parts.map((p) => p.tone))], ['ink']);
});

test('the em ceiling keeps a one-line snippet from becoming a headline', async () => {
  const r = await resolve('a = 1', { box: { x: 0, y: 0, w: 1000, h: 500 } }, { maxEm: 24 });
  assert.ok(r);
  assert.ok(r.layout.emSize <= 24.001, `set at ${r.layout.emSize}`);
});
