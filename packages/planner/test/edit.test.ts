import assert from 'node:assert/strict';
import test from 'node:test';
import { parseStoryboard } from '@inkcast/core';
import { buildDoc, htmlToMarkdownFallback, reflow } from '../src/ingest.js';
import { editStoryboardDetailed } from '../src/edit.js';
import { heuristicPlan } from '../src/heuristic.js';
import { overlaps } from '../src/layout.js';
import { GRADIENT_DESCENT } from './fixture.js';

// These tests cover the no-API-key path, which is the only path CI can rely on.
const base = heuristicPlan(buildDoc(GRADIENT_DESCENT, 'markdown'));
const noKey = { adapter: 'heuristic' as const };

test('deterministic edits change exactly what was asked for', async () => {
  const { storyboard, report } = await editStoryboardDetailed(
    base,
    'retitle to "Downhill"; make it vertical; use voice am_michael; mono palette; 24 fps; pencil style; outro 2s',
    noKey,
  );
  parseStoryboard(storyboard);
  assert.equal(storyboard.title, 'Downhill');
  assert.equal(storyboard.meta.aspect, '9:16');
  assert.equal(storyboard.meta.voice, 'am_michael');
  assert.equal(storyboard.meta.palette, 'mono');
  assert.equal(storyboard.meta.fps, 24);
  assert.equal(storyboard.meta.style, 'pencil');
  assert.equal(storyboard.meta.outroSec, 2);
  assert.equal(report.applied.length, 7, JSON.stringify(report));
  assert.deepEqual(report.unsupported, []);
  // The original is untouched: edits are pure.
  assert.equal(base.title, 'Gradient Descent');
  assert.equal(base.meta.aspect, '16:9');
});

test('changing the aspect re-lays out the canvas without overlaps', async () => {
  const { storyboard } = await editStoryboardDetailed(base, 'make it square', noKey);
  assert.equal(storyboard.meta.aspect, '1:1');
  assert.notEqual(storyboard.canvas.w, base.canvas.w);
  for (const scene of storyboard.scenes) {
    const els = scene.elements.filter((e) => e.type !== 'emphasis');
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        assert.ok(!overlaps(els[i]!.at, els[j]!.at, 1), `${els[i]!.id} overlaps ${els[j]!.id}`);
      }
    }
  }
});

test('removing a scene keeps the storyboard valid and drops dead annotations', async () => {
  const { storyboard, report } = await editStoryboardDetailed(base, 'remove scene 3', noKey);
  parseStoryboard(storyboard);
  assert.equal(storyboard.scenes.length, base.scenes.length - 1);
  assert.match(report.applied[0] ?? '', /removed scene 3/);
  const ids = new Set(storyboard.scenes.flatMap((s) => s.elements.map((e) => e.id)));
  for (const scene of storyboard.scenes) {
    for (const el of scene.elements) {
      if (el.type === 'emphasis') assert.ok(ids.has(el.targetId));
    }
  }
});

test('pacing edits scale the beat they name and nothing else', async () => {
  const { storyboard } = await editStoryboardDetailed(base, 'slower scene 2', noKey);
  const before = base.scenes[1]!.elements[0]!.enter.duration;
  const after = storyboard.scenes[1]!.elements[0]!.enter.duration;
  assert.ok(after > before, `${after} should exceed ${before}`);
  assert.equal(
    storyboard.scenes[0]!.elements[0]!.enter.duration,
    base.scenes[0]!.elements[0]!.enter.duration,
  );
});

test('an instruction that needs a model is reported, not silently dropped', async () => {
  const { storyboard, report } = await editStoryboardDetailed(
    base,
    'rewrite the narration of scene 2 to be funnier',
    noKey,
  );
  assert.deepEqual(report.applied, []);
  assert.equal(report.needsKey.length, 1);
  assert.deepEqual(storyboard.scenes.length, base.scenes.length);
});

test('gibberish is reported as unsupported', async () => {
  const { report } = await editStoryboardDetailed(base, 'xyzzy plugh', noKey);
  assert.deepEqual(report.applied, []);
  assert.equal(report.unsupported.length, 1);
});

test('the dependency-free HTML fallback keeps headings and lists', () => {
  const md = htmlToMarkdownFallback(
    '<nav>skip me</nav><h1>Ink &amp; Paper</h1><p>Hello there.</p><ul><li>one</li><li>two</li></ul>',
  );
  assert.ok(!md.includes('skip me'));
  assert.ok(md.includes('# Ink & Paper'));
  assert.ok(md.includes('- one'));
  const doc = buildDoc(md, 'html');
  assert.equal(doc.title, 'Ink & Paper');
  assert.ok(doc.sections.length >= 1);
});

test('PDF-style hard-wrapped text is reflowed into paragraphs', () => {
  const flowed = reflow('Gradient descent walks\ndownhill on the loss sur-\nface.\n\n• first bullet\n• second');
  assert.ok(flowed.includes('Gradient descent walks downhill on the loss surface.'));
  assert.ok(flowed.includes('- first bullet'));
});
