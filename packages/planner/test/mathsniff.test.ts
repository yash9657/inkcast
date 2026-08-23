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
import { makeText, sniffMath } from '../src/elements.js';

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
