/**
 * The glyph gate — audit S4-b (CRITICAL), the reference product's D1 defect.
 *
 * The claim under test is exactly the plan's done-bar: a storyboard containing
 * `α|0⟩` in a plain text element fails loudly under strict with the offending
 * codepoint named, and the same storyboard still renders under degrade (the
 * pre-gate behaviour), with the defect warned rather than shipped silently.
 */
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseStoryboard, type Storyboard } from '@inkcast/core';
import { builtinMetrics, loadFontMetrics } from '@inkcast/core';
import { formatGlyphViolation, glyphViolations, handwrittenStrings } from '../src/glyphgate.js';
import { resolveVisuals } from '../src/resolve.js';

const KET = 'The state is α|0⟩ + β|1⟩ before measurement';

function fixture(text: string): Storyboard {
  return parseStoryboard({
    version: 1,
    title: 'Quantum states',
    meta: { style: 'marker', palette: 'color' },
    canvas: { x: 0, y: 0, w: 1920, h: 1080 },
    assets: [],
    scenes: [
      {
        id: 's1',
        narration: 'The qubit holds both amplitudes at once.',
        camera: { x: 480, y: 270, zoom: 1 },
        elements: [
          {
            id: 'state',
            type: 'text',
            text,
            role: 'body',
            at: { x: 120, y: 90, w: 900, h: 240 },
            enter: { at: 0, duration: 1.2, style: 'write' },
          },
        ],
      },
    ],
  });
}

test('every handwritten string is collected; equation tex is not', () => {
  const sb = fixture('plain words');
  const el = sb.scenes[0]!.elements[0]!;
  sb.scenes[0]!.elements.push({
    ...el,
    id: 'eq',
    type: 'equation',
    tex: '\\frac{1}{2}',
    display: true,
    align: 'center',
  } as never);
  const strings = handwrittenStrings(parseStoryboard(sb));
  assert.deepEqual(
    strings.map((s) => s.text),
    ['plain words'],
    'equation tex must not be gated as handwriting — it has its own lane and its own gate',
  );
});

test('uncovered codepoints are named, one per (string, codepoint)', () => {
  const violations = glyphViolations(fixture(KET), builtinMetrics());
  const chars = violations.map((v) => v.char).sort();
  // α, β, ⟩ are outside the builtin table's honest ASCII coverage; | and digits are in it.
  assert.deepEqual(chars, ['α', 'β', '⟩']);
  const first = violations[0]!;
  const message = formatGlyphViolation(first);
  assert.match(message, /U\+0[0-9A-F]{3}/, 'the codepoint is named as U+XXXX');
  assert.match(message, /"state"/, 'the element is named');
  assert.match(message, /equation lane/, 'math-looking misses point at the fix');
});

test('the vendored handwriting face passes ASCII and fails Greek', () => {
  const font = loadFontMetrics({
    preferred: ['shantellsans'],
    fontFamily: 'Shantell Sans',
  });
  if (font.source !== 'file') return; // fonts not fetched on this machine — covered above
  assert.equal(glyphViolations(fixture('plain ASCII prose, 42%'), font).length, 0);
  // The gate consults the real cmap, not a guess: Shantell Sans genuinely carries
  // bra-ket brackets (U+27E8/9) — measured, to this test's own surprise — but no
  // Greek, so α and β are what a film would ship as tofu.
  const violations = glyphViolations(fixture(KET), font);
  assert.deepEqual(violations.map((v) => v.char).sort(), ['α', 'β']);
});

test('strict blocks the α|0⟩ board with the codepoint named; degrade renders it', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'inkcast-glyphgate-'));
  await assert.rejects(
    () => resolveVisuals(fixture(KET), dir, { gates: 'strict' }),
    (err: Error) => {
      assert.match(err.message, /no glyph/);
      assert.match(err.message, /U\+/);
      assert.match(err.message, /strict quality gate/);
      return true;
    },
  );
  // Default (no gates) is today's behaviour: resolved, with warnings.
  const out = await resolveVisuals(fixture(KET), dir);
  assert.equal(out.scenes.length, 1);
});

test('strict blocks an equation that would fall back to TeX-as-handwriting', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'inkcast-eqgate-'));
  const sb = fixture('plain words');
  sb.scenes[0]!.elements.push({
    id: 'eq',
    type: 'equation',
    tex: '\\notarealmacro{x}',
    display: true,
    align: 'center',
    at: { x: 120, y: 400, w: 600, h: 160 },
    enter: { at: 0.2, duration: 1, style: 'draw' },
    persist: true,
  } as never);
  const strictSb = parseStoryboard(sb);
  await assert.rejects(
    () => resolveVisuals(strictSb, dir, { gates: 'strict' }),
    /could not be typeset/,
  );
  // Degrade keeps the beat: the TeX source is drawn as text, warned.
  const out = await resolveVisuals(strictSb, dir);
  assert.equal(out.scenes[0]!.elements.length, 2);
});
