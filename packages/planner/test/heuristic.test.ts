import assert from 'node:assert/strict';
import test from 'node:test';
import { Storyboard, parseStoryboard, totalDuration } from '@inkcast/core';
import { buildDoc } from '../src/ingest.js';
import { heuristicPlan, pacing } from '../src/heuristic.js';
import { estimateDurationSec, wordCount } from '../src/text.js';
import { DEFINITION_DOC, GRADIENT_DESCENT, PLAIN_TEXT } from './fixture.js';

const doc = buildDoc(GRADIENT_DESCENT, 'markdown');
const sb = heuristicPlan(doc, { wordsPerSecond: 2.6 });

test('ingest recovers the document outline', () => {
  assert.equal(doc.title, 'Gradient Descent');
  const headings = doc.sections.map((s) => s.heading).filter(Boolean);
  assert.ok(headings.includes('The update rule'), headings.join(' | '));
  assert.ok(headings.includes('Batch size matters'));
  assert.ok(doc.text.includes('1. Compute the loss'), 'ordered list survives');
});

test('ingest infers headings from unstructured plain text', () => {
  const plain = buildDoc(PLAIN_TEXT, 'txt');
  assert.equal(plain.title, 'Photosynthesis');
  assert.ok(
    plain.sections.some((s) => s.heading === 'Why it matters'),
    JSON.stringify(plain.sections.map((s) => s.heading)),
  );
});

test('the heuristic plan parses against the Storyboard schema', () => {
  const parsed = parseStoryboard(JSON.parse(JSON.stringify(sb)));
  assert.equal(parsed.version, 1);
  assert.equal(parsed.title, 'Gradient Descent');
  assert.ok(parsed.scenes.length >= 8, `only ${parsed.scenes.length} scenes`);
  // Round-tripping through the schema must not change anything.
  assert.deepEqual(parsed, Storyboard.parse(sb));
});

test('the planner is deterministic', () => {
  const again = heuristicPlan(buildDoc(GRADIENT_DESCENT, 'markdown'), { wordsPerSecond: 2.6 });
  assert.deepEqual(again, sb);
});

test('every scene narrates one idea at a speakable pace', () => {
  for (const s of sb.scenes) {
    assert.ok(s.narration.trim().length > 0, `${s.id} has no narration`);
    const secs = estimateDurationSec(s.narration, 2.6);
    assert.ok(secs >= 1.2 && secs <= 13.5, `${s.id}: ${secs}s — "${s.narration}"`);
    assert.ok(wordCount(s.narration) <= 40, `${s.id} is too wordy: "${s.narration}"`);
  }
  const long = pacing(sb).filter((p) => p.verdict === 'long');
  assert.equal(long.length, 0, `scenes over 12s: ${JSON.stringify(long)}`);
});

test('narration sounds spoken, not written', () => {
  const all = sb.scenes.map((s) => s.narration).join(' ');
  for (const banned of [
    'It should be noted',
    'as shown in Figure',
    'utilise',
    'utilize',
    'in order to',
    'Additionally',
    'Furthermore',
  ]) {
    assert.ok(!all.includes(banned), `narration still contains "${banned}"`);
  }
  assert.ok(
    /\b(it's|that's|don't|isn't|here's|we'll|you'll|can't)\b/i.test(all),
    'no contractions',
  );
});

test('entrances are staggered and use the right ink', () => {
  for (const s of sb.scenes) {
    let prev = -1;
    for (const el of s.elements) {
      assert.ok(el.enter.at >= 0 && el.enter.at <= 0.9, `${el.id} enters at ${el.enter.at}`);
      assert.ok(el.enter.at >= prev, `${s.id}: entrances out of order`);
      if (el.enter.at > 0) assert.ok(el.enter.at - prev >= 0.049, `${s.id}: entrances bunched up`);
      prev = el.enter.at;
      if (el.type === 'text') assert.equal(el.enter.style, 'write', `${el.id} should be written`);
      if (el.type === 'shape' || el.type === 'asset' || el.type === 'diagram') {
        assert.equal(el.enter.style, 'draw', `${el.id} should be drawn`);
      }
    }
    if (s.elements.length > 1) {
      const spread = s.elements[s.elements.length - 1]!.enter.at;
      assert.ok(spread > 0, `${s.id} drops everything at once`);
    }
  }
});

test('element and scene ids are unique, and asset references resolve', () => {
  const sceneIds = new Set<string>();
  const elementIds = new Set<string>();
  const assetIds = new Set(sb.assets.map((a) => a.id));
  assert.equal(assetIds.size, sb.assets.length, 'duplicate asset definitions');
  for (const s of sb.scenes) {
    assert.ok(!sceneIds.has(s.id), `duplicate scene id ${s.id}`);
    sceneIds.add(s.id);
    for (const el of s.elements) {
      assert.ok(!elementIds.has(el.id), `duplicate element id ${el.id}`);
      elementIds.add(el.id);
      if (el.type === 'asset') assert.ok(assetIds.has(el.assetId), `unknown asset ${el.assetId}`);
    }
  }
  for (const s of sb.scenes) {
    for (const el of s.elements) {
      if (el.type === 'emphasis') {
        assert.ok(elementIds.has(el.targetId), `emphasis targets missing ${el.targetId}`);
      }
    }
  }
});

test('annotated elements persist so later scenes can mark them up', () => {
  const targets = new Set(
    sb.scenes.flatMap((s) =>
      s.elements.filter((e) => e.type === 'emphasis').map((e) => e.targetId),
    ),
  );
  for (const s of sb.scenes) {
    for (const el of s.elements) {
      if (targets.has(el.id))
        assert.equal(el.persist, true, `${el.id} is annotated but not persistent`);
    }
  }
  // Assets are declared once and reused, never redefined per scene.
  for (const a of sb.assets) assert.ok(a.seed !== undefined, `${a.id} has no locked seed`);
});

test('a definition becomes a titled card that a later scene annotates', () => {
  const board = heuristicPlan(buildDoc(DEFINITION_DOC, 'markdown'));
  parseStoryboard(board);
  const term = board.scenes
    .flatMap((s) => s.elements)
    .find((el) => el.type === 'text' && el.role === 'heading' && /cache/i.test(el.text));
  assert.ok(term, 'the term should be drawn as a titled card');
  const marks = board.scenes.flatMap((s) =>
    s.elements.filter((el) => (el.type === 'emphasis' ? el.targetId === term.id : false)),
  );
  assert.equal(marks.length, 1, 'the follow-up scene should annotate the term');
  const markScene = board.scenes.find((s) => s.elements.some((e) => e.id === marks[0]!.id))!;
  const termScene = board.scenes.find((s) => s.elements.some((e) => e.id === term.id))!;
  // Annotating means staying put: same region, so the earlier ink is still visible.
  assert.deepEqual(
    { x: markScene.camera.x, y: markScene.camera.y },
    { x: termScene.camera.x, y: termScene.camera.y },
  );
  assert.equal(term.persist, true);
});

test('the planner chooses visuals that match the content shape', () => {
  const layouts = sb.scenes.flatMap((s) =>
    s.elements
      .filter((e) => e.type === 'diagram')
      .map((e) => (e.type === 'diagram' ? e.layout : '')),
  );
  assert.ok(layouts.includes('flow'), 'the numbered list should become a flow diagram');
  assert.ok(layouts.includes('stack'), 'the bullet list should become a stack diagram');
  const comparison = sb.scenes.find(
    (s) => s.elements.filter((e) => e.type === 'diagram').length === 2,
  );
  assert.ok(comparison, 'the "whereas" paragraph should become two side-by-side panels');
  const figures = sb.scenes.some((s) =>
    s.elements.some((e) => e.type === 'text' && e.role === 'title' && /\d/.test(e.text)),
  );
  assert.ok(figures, 'the numbers paragraph should become a labelled figure');
});

test('voice-stage fields are left for the voice stage', () => {
  for (const s of sb.scenes) {
    assert.equal(s.durationSec, undefined);
    assert.equal(s.audioPath, undefined);
    assert.equal(s.words, undefined);
  }
  assert.equal(totalDuration(sb), sb.meta.outroSec);
});

test('maxScenes is respected', () => {
  const small = heuristicPlan(doc, { maxScenes: 6 });
  assert.ok(small.scenes.length <= 6, `${small.scenes.length} scenes`);
  assert.equal(small.scenes[0]!.id, 's0');
  parseStoryboard(small);
});

test('a one-line document still produces a valid video plan', () => {
  const tiny = heuristicPlan(buildDoc('Ink dries fast.', 'text'));
  parseStoryboard(tiny);
  assert.equal(tiny.scenes.length >= 1, true);
  assert.ok(tiny.scenes[0]!.narration.length > 0);
});
