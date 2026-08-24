/**
 * The math sniffer on `makeText` — audit S5-b, the routing half of D1.
 *
 * The equation lane was always sound; the defect was that nothing stopped an
 * author steering `α|0⟩ + β|1⟩` into a plain text element, where it is wrapped
 * at estimated widths and lettered by a handwriting font with no glyphs for it.
 * `makeText` now promotes such a string to the equation lane, and the storyboard
 * that reaches visuals carries a typeset equation where the mangled text was.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { makeCode, makeText, sniffMath } from '../src/elements.js';

test('the sniffer knows math from prose', () => {
  // The exact frame the reference product mangles (its D1).
  assert.ok(sniffMath('α|0⟩ + β|1⟩'));
  assert.ok(sniffMath('The state is α|0⟩ before measurement'));
  // TeX fragments are never prose.
  assert.ok(sniffMath('\\frac{dv}{dt} = -g'));
  assert.ok(sniffMath('the update is $w - 0.1 \\times 4$'));
  // Clustered Unicode math.
  assert.ok(sniffMath('E = mc² where c² is enormous'));
  assert.ok(sniffMath('∑ xᵢ ÷ n'));

  // Prose stays prose: single decorative signals must not reroute a caption.
  assert.ok(!sniffMath('Gradient descent walks downhill'));
  assert.ok(!sniffMath('A 10× speedup on the benchmark'));
  assert.ok(!sniffMath('H2O is written with a subscript'));
  assert.ok(!sniffMath('the letter π by itself in a sentence'));
  assert.ok(!sniffMath('C:\\Users\\demo is a Windows path')); // \U, \d — two+ letters required
});

test('a mathematical string is promoted to the equation lane, box discipline intact', () => {
  const el = makeText('note0', 'α|0⟩ + β|1⟩', 'body', { maxWidth: 500, align: 'center' });
  assert.equal(el.type, 'equation');
  assert.ok(el.type === 'equation' && el.tex === 'α|0⟩ + β|1⟩');
  assert.ok(el.at.w <= 500, 'the caller’s maxWidth still bounds the box');
  assert.equal(el.align, 'center');
});

test('ordinary text is untouched', () => {
  const el = makeText('note1', 'walks downhill, one step at a time', 'body');
  assert.equal(el.type, 'text');
});

/**
 * The sniffer would eat code, which is why code must never reach `makeText` (plan 6.2).
 *
 * Every one of these is a real line of source that the TeX test fires on, and the promotion
 * would be silent: the storyboard would carry an `equation` whose `tex` is a shell command,
 * MathJax would report an error on it, and the beat would fall back to drawing the source in
 * the handwriting font — arriving at the exact defect the code lane was built to end, by a
 * longer route. `makeCode` is therefore the only builder a listing may go through, and
 * `buildCode` in `./compile.ts` is the only router that reaches it.
 */
test('the sniffer would misread code, which is why code never goes through makeText', () => {
  // `$…$` is a shell variable, a PHP variable and an awk field — measured, not supposed.
  assert.ok(sniffMath('echo "$HOME is $USER"'));
  assert.ok(sniffMath('$total = $price * $qty;'));
  assert.ok(sniffMath("awk '{print $1, $3}' file"));
  // A backslash followed by two or more letters: `\bword\b` in a grep pattern.
  assert.ok(sniffMath('grep -o "\\bword\\b" file'));
  // Two or more Unicode math codepoints: a comparison chain written with real glyphs.
  assert.ok(sniffMath('if (a ≤ b ≤ c) return;'));
  // Three that do *not* fire, on the record: `C:\Users\demo` (the `\` follows a colon or a
  // letter), `/\d+\s*\w/` (one letter after each backslash) and `a << 2 | b >> 1` (ASCII).
  // The sniffer is tighter than the trap it guards against, and that is the point — but a
  // lane cannot be built on three near-misses when the four above are certain.
  assert.ok(!sniffMath('copy C:\\projects\\build to the share'));
  assert.ok(!sniffMath('const re = /\\d+\\s*\\w/;'));
  assert.ok(!sniffMath('x = a << 2 | b >> 1;'));

  // So `makeCode` exists, and it is not `makeText`: the same string set as a listing keeps
  // every character it had, and comes out as a `code` element rather than an equation.
  const el = makeCode('snip0', '$total = $price * $qty;', 'php', { maxWidth: 500 });
  assert.equal(el.type, 'code');
  assert.equal(el.code, '$total = $price * $qty;');
  assert.equal(el.lang, 'php');
  assert.ok(el.at.w <= 500, 'the caller’s maxWidth still bounds the box');
});
