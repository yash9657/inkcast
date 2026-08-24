/**
 * The code lane's two pieces that live in core (plan item 6.2): the character grid both
 * stages measure on, and the glyph outlines the lane draws.
 *
 * The grid tests exist because two stages read it — the planner reserving a box and the
 * visuals stage setting into one — and A-4's lesson is that two measurements of one width
 * is how `empty stac` shipped. The outline tests exist because a `glyf` reader that is
 * subtly wrong does not throw: it draws a letter with a corner where it should have a
 * bowl, which nothing but a frame or a contour count will catch.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CODE_LINE_HEIGHT,
  builtinMetrics,
  codeBox,
  codeCellEm,
  codeGrid,
  monoMetrics,
} from '../src/index.js';

/* ------------------------------------------------------------------- the grid */

test('tabs expand to the stop, so indentation is columns and not characters', () => {
  assert.deepEqual(codeGrid('if x:\n\treturn 1').lines, ['if x:', '    return 1']);
  // A tab mid-line advances to the *next* stop, not by four: `ab\tc` is `ab  c`.
  assert.deepEqual(codeGrid('ab\tc').lines, ['ab  c']);
  assert.deepEqual(codeGrid('a\tb').lines, ['a   b']);
  assert.deepEqual(codeGrid('abcd\te').lines, ['abcd    e']);
  // Tabs and spaces that mean the same indentation measure the same grid, which is the
  // property the planner's reservation and the lane's layout both depend on.
  assert.deepEqual(codeGrid('if x:\n\treturn 1'), codeGrid('if x:\n    return 1'));
});

test('trailing blank lines go and leading ones stay', () => {
  assert.equal(codeGrid('a\n\n\n').lines.length, 1);
  assert.equal(codeGrid('a\n\nb\n').lines.length, 3, 'a blank line inside the listing is content');
  assert.deepEqual(codeGrid('\na').lines, ['', 'a']);
  assert.deepEqual(codeGrid('').lines, []);
});

test('CRLF is not two more columns', () => {
  assert.deepEqual(codeGrid('a\r\nb').lines, ['a', 'b']);
  assert.equal(codeGrid('a\r\nb').cols, 1);
});

test('cols is the widest line, counted in code points', () => {
  assert.equal(codeGrid('ab\nabcd\nabc').cols, 4);
  // A code point, not a UTF-16 unit: an emoji occupies one cell in this count, and
  // over-counting it would reserve a box wider than the listing.
  assert.equal(codeGrid('x😀').cols, 2);
});

test('codeBox clamps on width, and the height follows the clamped size', () => {
  const cell = codeCellEm();
  // A listing that fits: the size asked for is the size given.
  const small = codeBox('ab', 40, 900);
  assert.equal(small.size, 40);
  assert.equal(small.w, Math.round(2 * cell * 40));
  assert.equal(small.h, Math.round(1 * CODE_LINE_HEIGHT * 40));

  // One 80 columns wide cannot be set at 40 inside 900 units, so the width decides —
  // and the height must come from *that* size. Taking it from the requested one is how a
  // reservation ends up the wrong aspect and the listing letterboxes inside it.
  const wide = codeBox('x'.repeat(80), 40, 900);
  assert.ok(wide.size < 40);
  assert.ok(wide.w <= 900);
  assert.equal(wide.h, Math.round(CODE_LINE_HEIGHT * wide.size));
  assert.equal(wide.cols, 80);
});

/* -------------------------------------------------------------- the outlines */

test('the vendored monospace face is monospace, and readable', () => {
  const mono = monoMetrics();
  assert.ok(mono, 'assets/fonts/code must hold a readable .ttf');
  assert.equal(mono.source, 'file');
  assert.match(mono.familyName, /JetBrains Mono/);
  // Every cell the same width is the property the whole grid rests on.
  for (const ch of ['i', 'M', 'W', '.', '0', ' ', '@']) {
    assert.equal(mono.advance(ch.codePointAt(0) as number), codeCellEm(), ch);
  }
});

test('a glyph comes back as closed contours, counters and all', () => {
  const mono = monoMetrics();
  assert.ok(mono);
  const contours = (d: string): number => (d.match(/M/g) ?? []).length;

  // `H` is one contour; `o` is two, because the hole in an "o" is a contour of its own
  // and nonzero winding is what keeps it a hole. A reader that dropped the inner contour
  // would draw a filled blob, which is the failure this asserts against.
  assert.equal(contours(mono.outline(0x48) as string), 1, 'H');
  assert.equal(contours(mono.outline(0x6f) as string), 2, 'o');
  for (const cp of [0x48, 0x6f, 0x30, 0x7b]) {
    const d = mono.outline(cp) as string;
    assert.match(d, /^M/);
    assert.match(d, /Z$/, 'a glyph contour is closed');
    assert.ok(!/NaN|Infinity|undefined/.test(d), d);
  }
  // `H` is straight lines only and `o` is curves only — which is the sharpest test of the
  // on/off-curve flags there is. A reader that ignored them would draw `o` as a polygon
  // (no Q at all) or `H` with phantom curves through its corners.
  assert.ok(!/Q/.test(mono.outline(0x48) as string), 'H has no curves');
  assert.ok(/Q/.test(mono.outline(0x6f) as string), 'o is made of curves');
  // A composite glyph — é is e plus an acute, placed by offset. Getting the composite
  // path wrong is how an accent ends up in the next character's cell.
  assert.ok(contours(mono.outline(0xe9) as string) >= 3, 'é is a composite');
});

test('a space draws nothing and an uncovered code point draws no thing at all', () => {
  const mono = monoMetrics();
  assert.ok(mono);
  // Covered, but empty: the difference between "" and undefined is the difference
  // between "this cell is blank" and "this face cannot write this", and the lane treats
  // the second as a refusal.
  assert.equal(mono.outline(0x20), '');
  assert.ok(mono.covers(0x20));
  assert.equal(mono.outline(0x6f2b), undefined);
  assert.ok(!mono.covers(0x6f2b));
});

test('the builtin width table has no letterforms, and says so', () => {
  // It can fake an advance; it cannot fake an outline. A lane that accepted `undefined`
  // here and drew something anyway would be inventing letters.
  assert.equal(builtinMetrics().outline(0x48), undefined);
});
