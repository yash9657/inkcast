/**
 * How a listing reaches the board (plan item 6.2).
 *
 * Two doors, and the item's bar names both: a `code` visual intent an author wrote, and a
 * fenced block in an ingested document. This file walks each of them from the input to the
 * `code` element that comes out, and pins the two ways the old behaviour destroyed a
 * listing on the way — proportional handwriting, and indentation collapsed by the
 * document parser before any lane saw it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { CODE_MAX_COLS, CODE_MAX_LINES, Lesson, type CodeElement } from '@inkcast/core';
import { buildBeats } from '../src/beats.js';
import { parseBlocks } from '../src/blocks.js';
import { compileLesson, fencedCode } from '../src/compile.js';
import { heuristicPlan } from '../src/heuristic.js';

const LOOKUP = ['def get(self, key):', '    i = hash(key) % 8', '    return self.slots[i]'].join(
  '\n',
);

/** A one-beat lesson whose only picture is whatever `visual` says. */
function lessonWith(visual: Record<string, unknown>): Lesson {
  const step = (v: Record<string, unknown>) => ({
    idea: 'a hash map finds a key in one step',
    because: 'the hash tells it where to look',
    narration: 'A hash map turns the key into an index, and looks in exactly that slot.',
    visuals: [v],
  });
  return Lesson.parse({
    version: 1,
    topic: 'How does a hash map work',
    objective: 'explain why a lookup does not search',
    hook: step({ describe: 'a row of numbered slots', kind: 'draw' }),
    anchor: step({ describe: 'a key going into a funnel and an index coming out', kind: 'draw' }),
    steps: [step(visual)],
    recap: step({ describe: 'the whole chain retraced', kind: 'draw' }),
  });
}

function codeElements(lesson: Lesson): CodeElement[] {
  const sb = compileLesson(lesson, {});
  return sb.scenes.flatMap((s) =>
    s.elements.flatMap((el) => (el.type === 'code' ? [el as CodeElement] : [])),
  );
}

/* ------------------------------------------------- door one: a `code` intent */

test('a code intent puts the listing on the board, character for character', () => {
  const els = codeElements(
    lessonWith({ describe: 'the two lines that do the lookup', kind: 'code', code: LOOKUP, lang: 'python' }), // prettier-ignore
  );
  assert.equal(els.length, 1);
  const el = els[0] as CodeElement;
  assert.equal(el.code, LOOKUP, 'not re-indented, not truncated, not re-flowed');
  assert.equal(el.lang, 'python');
  // A box measured from the listing's own grid: wider than tall, three lines of it.
  assert.ok(el.at.w > el.at.h, `${el.at.w}×${el.at.h} is not the shape of three code lines`);
  assert.equal(el.enter.style, 'draw', 'glyph outlines are drawn, not written word by word');
});

test('a fenced block in the describe is the same listing arriving by the other door', () => {
  const els = codeElements(
    lessonWith({ describe: `look at this:\n\`\`\`python\n${LOOKUP}\n\`\`\`\n`, kind: 'draw' }),
  );
  assert.equal(els.length, 1, 'a fence outranks the kind the author named');
  assert.equal((els[0] as CodeElement).code, LOOKUP);
  assert.equal((els[0] as CodeElement).lang, 'python', 'the language comes off the info string');
});

test('fencedCode reads the fence and nothing else', () => {
  assert.deepEqual(fencedCode('```ts\nlet x = 1\n```'), { code: 'let x = 1', lang: 'ts' });
  // An info string with attributes after it still names the language.
  assert.equal(fencedCode('```js {1,3}\nx\n```')?.lang, 'js');
  // A bare fence is `text`, not a guess.
  assert.equal(fencedCode('```\nx = 1\n```')?.lang, 'text');
  // Prose that merely mentions code is not a listing. Deciding this on "looks like code"
  // would set an English sentence in monospace at forty columns.
  assert.equal(fencedCode('the code for a hash map lookup, highlighted'), undefined);
  assert.equal(fencedCode('use `hash(key)` to find the slot'), undefined);
  assert.equal(fencedCode('```\n\n```'), undefined, 'an empty fence carries no listing');
});

test('a code intent with no listing draws what was described, and does not invent code', () => {
  // The lane sets source; it does not write source from a description. Inventing the
  // listing would put a program on the board that nobody wrote and nobody ran.
  const els = codeElements(
    lessonWith({ describe: 'a function that hashes the key and walks the bucket', kind: 'code' }),
  );
  assert.equal(els.length, 0);
  // And the beat still draws something, so nothing is lost but the lane.
  const sb = compileLesson(
    lessonWith({ describe: 'a function that hashes the key and walks the bucket', kind: 'code' }),
    {},
  );
  assert.ok(sb.scenes[2]!.elements.length > 0);
});

/* --------------------------------- door two: a fenced block in a document */

test('the document parser keeps a fence verbatim and still collapses prose', () => {
  const doc = [
    '# Loops',
    '',
    'Two   spaces   in    prose   are   one.',
    '',
    '```python',
    'for batch in loader:',
    '    loss = model(batch).loss',
    '    loss.backward()',
    '```',
  ].join('\n');
  const blocks = parseBlocks(doc);
  const code = blocks.find((b) => b.kind === 'code');
  assert.ok(code && code.kind === 'code');
  // The four leading spaces are the block structure of the program. Collapsing them —
  // which `normalizeWhitespace` did to the whole document before this — is the defect.
  assert.equal(
    code.text,
    'for batch in loader:\n    loss = model(batch).loss\n    loss.backward()',
  );
  assert.equal(code.lang, 'python');
  const para = blocks.find((b) => b.kind === 'paragraph');
  assert.ok(para && para.kind === 'paragraph');
  assert.equal(para.text, 'Two spaces in prose are one.', 'prose is still collapsed');
});

test('a fenced block in an ingested document becomes a set listing', () => {
  const doc = [
    '# Buckets',
    '',
    'A hash map turns a key into an index and looks in exactly that slot, so a lookup',
    'does not search the table at all.',
    '',
    '## In code',
    '',
    '```python',
    LOOKUP,
    '```',
  ].join('\n');
  const sb = heuristicPlan({ title: 'Buckets', text: doc, sections: [] });
  const els = sb.scenes.flatMap((s) =>
    s.elements.flatMap((el) => (el.type === 'code' ? [el as CodeElement] : [])),
  );
  assert.equal(els.length, 1, 'the document path must reach the code lane');
  assert.equal((els[0] as CodeElement).code, LOOKUP);
  assert.equal((els[0] as CodeElement).lang, 'python');
  // It used to be a `stack` diagram of one node per line — each line of source in a
  // rounded box, lettered by hand at proportional widths, comments dropped upstream and
  // every line cut to twelve words. Nothing on this board is that any more.
  const stacks = sb.scenes.flatMap((s) =>
    s.elements.filter((el) => el.type === 'diagram' && el.layout === 'stack'),
  );
  for (const d of stacks) {
    assert.ok(d.type === 'diagram');
    assert.ok(
      !d.nodes.some((n) => n.label.includes('loader') || n.label.includes('hash(')),
      'source code is not a stack of handwritten boxes',
    );
  }
});

test('the heuristic will not take a listing this board cannot set', () => {
  // No author to warn on this path, so a block over the budget is not made a beat at all —
  // losing one beat beats a listing too small to read, or a strict render that fails on
  // somebody's README. See `CODE_MAX_LINES`.
  const fence = (body: string) => `# T\n\nSome prose about the thing, at length.\n\n\`\`\`python\n${body}\n\`\`\`\n`; // prettier-ignore
  const tooTall = Array.from({ length: CODE_MAX_LINES + 4 }, (_, i) => `x${i} = ${i}`).join('\n');
  const tooWide = `x = ${'y'.repeat(CODE_MAX_COLS + 10)}`;
  const fits = Array.from({ length: CODE_MAX_LINES }, (_, i) => `x${i} = ${i}`).join('\n');

  const shapes = (text: string) =>
    buildBeats({ title: 'T', text, sections: [] }, { maxWords: 34, minWords: 9 }).map(
      (b) => b.shape,
    );
  assert.ok(!shapes(fence(tooTall)).includes('code'), `${CODE_MAX_LINES + 4} lines is too tall`);
  assert.ok(!shapes(fence(tooWide)).includes('code'), 'one long line is too wide');
  assert.ok(shapes(fence(fits)).includes('code'), 'a listing inside the budget is a beat');
});
