import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STAGES,
  STAGE_BLURB,
  STAGE_LABEL,
  STAGE_WEIGHT,
  progressBus,
  stageBase,
  type PipelineProgress,
  type StageName,
} from '../src/progress.js';

test('the stage order puts the lesson before anything visual, and voice before both', () => {
  assert.deepEqual([...STAGES], ['ingest', 'lesson', 'storyboard', 'voice', 'visuals', 'render']);
  const at = (s: StageName) => STAGES.indexOf(s);
  assert.ok(at('lesson') < at('storyboard'), 'what to teach is decided before how to draw it');
  assert.ok(at('voice') < at('visuals'), 'cues must resolve before anything is drawn');
  assert.ok(at('voice') < at('render'), 'durations must be measured before frames are captured');
});

test('weights cover exactly 100 and render dominates', () => {
  const total = STAGES.reduce((n, s) => n + STAGE_WEIGHT[s], 0);
  assert.equal(total, 100);
  const heaviest = [...STAGES].sort((a, b) => STAGE_WEIGHT[b] - STAGE_WEIGHT[a])[0];
  assert.equal(heaviest, 'render');
  // The lesson stage is a model round trip plus a revision pass: real, but small.
  assert.ok(STAGE_WEIGHT.lesson > STAGE_WEIGHT.storyboard);
  assert.ok(STAGE_WEIGHT.lesson < STAGE_WEIGHT.voice);
});

test('every stage has a label and a blurb', () => {
  for (const s of STAGES) {
    assert.ok(STAGE_LABEL[s]?.length, `${s} needs a label`);
    assert.ok(STAGE_BLURB[s]?.length, `${s} needs a blurb`);
  }
});

test('stage bands are contiguous and start at zero', () => {
  let expected = 0;
  for (const s of STAGES) {
    assert.equal(stageBase(s), expected);
    expected += STAGE_WEIGHT[s];
  }
  assert.equal(expected, 100);
});

test('overall progress is monotonic and never rewinds when a stage restarts', () => {
  const seen: PipelineProgress[] = [];
  const bus = progressBus((p) => seen.push(p as PipelineProgress));
  bus.stage('ingest', 50);
  bus.done('ingest');
  bus.done('lesson', 'cached');
  bus.done('storyboard');
  bus.stage('voice', 10);
  bus.stage('voice', 5); // a stage package reporting a lower number
  bus.done('render');

  const pcts = seen.map((p) => p.pct);
  for (let i = 1; i < pcts.length; i++) {
    assert.ok(pcts[i]! >= pcts[i - 1]!, `pct went backwards: ${pcts[i - 1]} -> ${pcts[i]}`);
  }
  assert.equal(pcts.at(-1), 100);
  // The stage-local number is preserved even when the overall one is clamped.
  assert.equal(seen.at(-2)!.stagePct, 5);
});

test('a child reporter is stamped with the band it was handed, not the note it carries', () => {
  const seen: PipelineProgress[] = [];
  const bus = progressBus((p) => seen.push(p as PipelineProgress));
  // Stage packages predate the lesson/storyboard split and still say `plan`.
  bus.child('storyboard')({ stage: 'plan', pct: 60, note: '8 beats' });
  assert.equal(seen[0]!.stage, 'storyboard');
  assert.equal(seen[0]!.note, '8 beats');
  assert.equal(seen[0]!.stagePct, 60);
  assert.equal(seen[0]!.pct, Math.round(stageBase('storyboard') + 0.6 * STAGE_WEIGHT.storyboard));
});
