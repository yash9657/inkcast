import assert from 'node:assert/strict';
import test from 'node:test';
import { builtinMetrics } from '@inkcast/core';
import { inkStyleFor, roleFontSize } from '../src/style.js';
import { serialiseSvg } from '../src/svg.js';
import { layoutText, revealMaskAt, scaleTextLayout, textSvg, wordAt } from '../src/text.js';

const style = inkStyleFor({ style: 'marker', palette: 'color' });
const font = builtinMetrics('Test Hand');
const BOX = { x: 100, y: 200, w: 600, h: 400 };

const SENTENCE = 'Gradient descent walks downhill on the loss surface, one small step at a time.';

test('lines wrap to the box width and never exceed it', () => {
  const layout = layoutText(SENTENCE, { box: BOX, style, font, role: 'body' });
  assert.ok(layout.lines.length > 1, 'a long sentence in a 600-unit box must wrap');
  for (const line of layout.lines) {
    assert.ok(line.width <= BOX.w + 1e-6, `line "${line.text}" is ${line.width} wide`);
    assert.ok(line.text.trim().length > 0);
  }
  assert.equal(layout.lines.map((l) => l.text).join(' '), SENTENCE);
});

test('type shrinks to fit the box height', () => {
  const roomy = layoutText(SENTENCE, { box: BOX, style, font, role: 'title' });
  const fits = layoutText(SENTENCE, { box: { ...BOX, h: 220 }, style, font, role: 'title' });
  assert.ok(fits.fontSize < roomy.fontSize, `${fits.fontSize} should be under ${roomy.fontSize}`);
  assert.ok(fits.lines.length * fits.lineHeight <= 220, 'shrinking failed to fit the box');
});

test('shrink-to-fit stops at the legibility floor instead of vanishing', () => {
  const cramped = layoutText(SENTENCE, {
    box: { ...BOX, h: 40 },
    style,
    font,
    role: 'title',
    minScale: 0.5,
  });
  // Impossible to fit: we clamp at half the role size and overflow knowingly
  // rather than render illegible text.
  const floor = roleFontSize('title', 1080) * 0.5;
  assert.ok(Math.abs(cramped.fontSize - floor) < 1e-6, `${cramped.fontSize} vs floor ${floor}`);
});

test('an unbreakably long word is split by character instead of overflowing', () => {
  const layout = layoutText('supercalifragilisticexpialidocious', {
    box: { x: 0, y: 0, w: 120, h: 400 },
    style,
    font,
    role: 'body',
  });
  assert.ok(layout.lines.length > 1);
  for (const line of layout.lines) assert.ok(line.width <= 120 + 1e-6);
});

test('baselines advance downwards by the line height', () => {
  const layout = layoutText(SENTENCE, { box: BOX, style, font, role: 'body' });
  for (let i = 1; i < layout.lines.length; i++) {
    const prev = layout.lines[i - 1];
    const cur = layout.lines[i];
    assert.ok(prev && cur);
    assert.ok(Math.abs(cur.baseline - prev.baseline - layout.lineHeight) < 1e-6);
  }
});

test('word progress windows are ordered, contiguous and inside 0..1', () => {
  const layout = layoutText(SENTENCE, { box: BOX, style, font, role: 'body' });
  let last = 0;
  const all = layout.lines.flatMap((l) => l.words);
  assert.ok(all.length > 10);
  for (const w of all) {
    assert.ok(w.startFrac >= 0 && w.endFrac <= 1 + 1e-9, `${w.text} ${w.startFrac}-${w.endFrac}`);
    assert.ok(w.endFrac > w.startFrac, `${w.text} has no duration`);
    assert.ok(w.startFrac >= last - 1e-9, `${w.text} goes backwards`);
    last = w.startFrac;
  }
  const first = all[0];
  assert.ok(first);
  assert.equal(first.startFrac, 0);
});

test('reveal masks grow left-to-right in reading order', () => {
  const layout = layoutText(SENTENCE, { box: BOX, style, font, role: 'body' });
  assert.equal(revealMaskAt(layout, 0).length, 0, 'nothing is written at p=0');

  const full = revealMaskAt(layout, 1);
  assert.equal(full.length, layout.lines.length);
  full.forEach((m, i) => {
    const line = layout.lines[i];
    assert.ok(line);
    assert.equal(m.w, line.mask.w);
  });

  // Monotonic: total revealed width only ever increases.
  let prevTotal = -1;
  for (let p = 0; p <= 1.0001; p += 0.05) {
    const total = revealMaskAt(layout, p).reduce((a, m) => a + m.w, 0);
    assert.ok(total >= prevTotal - 1e-9, `revealed width shrank at p=${p}`);
    prevTotal = total;
  }

  // Mid-line: exactly one partial rectangle, narrower than the full line.
  const firstLine = layout.lines[0];
  assert.ok(firstLine);
  const mid = revealMaskAt(layout, firstLine.endFrac / 2);
  assert.equal(mid.length, 1);
  const partial = mid[0];
  assert.ok(partial);
  assert.ok(partial.w < firstLine.mask.w && partial.w > 0);
  assert.equal(partial.x, firstLine.mask.x, 'the reveal must start at the line origin');
});

test('wordAt reports the word being written', () => {
  const layout = layoutText('one two three', { box: BOX, style, font, role: 'body' });
  const first = layout.lines[0]?.words[0];
  const third = layout.lines[0]?.words[2];
  assert.ok(first && third);
  assert.equal(wordAt(layout, 0.01)?.text, first.text);
  assert.equal(wordAt(layout, 0.99)?.text, third.text);
});

test('alignment moves the line, not the box', () => {
  const left = layoutText('hi', { box: BOX, style, font, align: 'left' });
  const centre = layoutText('hi', { box: BOX, style, font, align: 'center' });
  const right = layoutText('hi', { box: BOX, style, font, align: 'right' });
  const lx = left.lines[0]?.x ?? 0;
  const cx = centre.lines[0]?.x ?? 0;
  const rx = right.lines[0]?.x ?? 0;
  assert.equal(lx, BOX.x);
  assert.ok(cx > lx && rx > cx);
  assert.ok(Math.abs(rx + (right.lines[0]?.width ?? 0) - (BOX.x + BOX.w)) < 1e-6);
});

test('scaleTextLayout scales geometry and type together', () => {
  const layout = layoutText(SENTENCE, { box: BOX, style, font });
  const scaled = scaleTextLayout(layout, 2, 10, 20);
  assert.equal(scaled.fontSize, layout.fontSize * 2);
  const a = layout.lines[0];
  const b = scaled.lines[0];
  assert.ok(a && b);
  assert.equal(b.x, a.x * 2 + 10);
  assert.equal(b.width, a.width * 2);
});

test('text is emitted as real text with clip masks, never as traced outlines', () => {
  const layout = layoutText(SENTENCE, { box: BOX, style, font, role: 'body' });
  const { defs, nodes } = textSvg(layout, 'ink-x');
  assert.equal(defs.length, layout.lines.length);
  const markup = [...defs, ...nodes].map((node) => serialiseSvg(node)).join('\n');
  assert.ok(!markup.includes('<path'), 'glyph outlines would defeat the write-on reveal');
  assert.equal((markup.match(/<clipPath/g) ?? []).length, layout.lines.length);
  assert.equal((markup.match(/<text/g) ?? []).length, layout.lines.length);
  assert.match(markup, /id="ink-x-mask-0"/);
  assert.match(markup, /data-ink-words="\[\[/);
  assert.match(markup, /font-family="'Test Hand'/);
});
