/**
 * The quality gate as a stage (plan 3.1).
 *
 * Three things are being asserted, and they are the three the done-bar names: a
 * corpus-shaped board passes and leaves a `qc.json` behind; a board with something
 * genuinely wrong with it fails, and fails *before* anything is encoded; and the
 * split between what blocks and what is merely said out loud holds — a crowded beat
 * and a lesson critique must not stop a render, or nobody will leave the gate on.
 *
 * Every board goes through `withVisuals` first, because that is the board the stage
 * really judges: the gate sits after the visuals stage, and a plot whose geometry was
 * never resolved is a different (and wrongly sized) piece of ink.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parseStoryboard, type QcReport, type Storyboard } from '@inkcast/core';
import { MAX_REVEALS_PER_SCENE } from './boardcheck.js';
import { check, QC_FILE } from './check.js';
import { lessonStoryboard, withVisuals } from './fixture.js';

/** A loose JSON copy of the fixture, for seeding one defect and re-parsing. */
function loose(): Record<string, any> {
  return JSON.parse(JSON.stringify(lessonStoryboard())) as Record<string, any>;
}

/** The report the stage left on disk, which is the artefact that has to be right. */
async function onDisk(at: string): Promise<QcReport> {
  return JSON.parse(await readFile(path.resolve(at, QC_FILE), 'utf8')) as QcReport;
}

async function ready(sb: Storyboard): Promise<{ sb: Storyboard; dir: string }> {
  return withVisuals(sb);
}

test('a corpus-shaped board passes, and the verdict is on disk', async () => {
  const { sb, dir } = await ready(lessonStoryboard());
  const report = await check(sb, dir, { gates: 'strict' });
  assert.equal(report.ok, true, report.problems.join('\n'));
  assert.deepEqual(report.problems, []);

  const saved = await onDisk(dir);
  assert.deepEqual(saved, report, 'qc.json must be exactly what the stage returned');
  assert.equal(saved.gates, 'strict');
  assert.ok(saved.checks.length >= 10, 'every check is recorded, passing ones included');
  // The one check that opens a browser. It has to have actually run here, or this
  // test is asserting that nine cheap checks passed and calling that a clean board.
  assert.equal(saved.checks.find((c) => c.id === 'realized-layout')?.status, 'pass');
  assert.ok(
    saved.checks.every((c) => c.status !== 'fail'),
    'no check may fail on a board shaped like the ones the corpus ships',
  );
  // The fill numbers are recorded whether or not they breached anything: a report
  // that only carries failures cannot answer "how close was this board to the floor".
  assert.ok((saved.fill ?? []).length > 0);
  assert.match(saved.checks.find((c) => c.id === 'vacant')?.note ?? '', /mean content fill/);
});

test('a dangling morph fails the gate, and under strict it stops the run', async () => {
  const raw = loose();
  // Point a morph at ink that does not exist. The renderer's own behaviour here is to
  // skip the morph and draw the element from nothing, which is a film missing the one
  // move the beat was about — and nothing in the log says so at info level.
  raw.scenes[1].elements[0].morph = { fromId: 'no-such-ink' };
  const { sb, dir } = await ready(parseStoryboard(raw));

  const degraded = await check(sb, dir, { gates: 'degrade', layout: false });
  assert.equal(degraded.ok, false);
  assert.equal(degraded.checks.find((c) => c.id === 'storyboard')?.status, 'fail');
  assert.match(degraded.problems.join('\n'), /no-such-ink/);
  // Written even when it fails — especially then: the file is how the failure is
  // read back after the terminal has scrolled.
  assert.equal((await onDisk(dir)).ok, false);

  await assert.rejects(() => check(sb, dir, { gates: 'strict', layout: false }), /no-such-ink/);
  await assert.rejects(
    () => check(sb, dir, { gates: 'strict', layout: false }),
    /strict quality gate/,
  );
});

test('a crowded beat is a warning, not a refusal to draw the board', async () => {
  const raw = loose();
  // Inside the hillside's own box and transient, so every *other* check still passes:
  // nested boxes are annotation rather than collision, non-persistent ink is not swept
  // for overlap at all, and the region's ink — and therefore the derived camera, the
  // fill and the type size — is exactly where it was. The only thing wrong with this
  // beat is how much of it there is, which is the point.
  for (let i = 0; i <= MAX_REVEALS_PER_SCENE; i++) {
    raw.scenes[0].elements.push({
      id: `crowd-${i}`,
      type: 'text',
      text: 'one',
      role: 'label',
      at: { x: 220, y: 440 + i * 45, w: 160, h: 40 },
      persist: false,
      enter: { at: 0.5, duration: 0.2, style: 'write' },
    });
  }
  const { sb, dir } = await ready(parseStoryboard(raw));

  const report = await check(sb, dir, { gates: 'strict', layout: false });
  const crowded = report.checks.find((c) => c.id === 'crowded');
  assert.equal(crowded?.status, 'warn');
  assert.match(crowded?.findings.join('\n') ?? '', /distinct things at once/);
  assert.equal(report.ok, true, 'taste does not block: a warning must not stop a render');
  assert.ok(report.advisories.length > 0);
});

test("an earlier stage's problems join the report without blocking it", async () => {
  const { sb, dir } = await ready(lessonStoryboard());
  const report = await check(sb, dir, {
    gates: 'strict',
    layout: false,
    inherited: [
      { id: 'lesson', findings: ['step "why" asserts without justifying it'] },
      { id: 'stages', findings: [] },
    ],
  });
  assert.equal(report.ok, true);
  assert.equal(report.checks.find((c) => c.id === 'lesson')?.status, 'warn');
  assert.equal(report.checks.find((c) => c.id === 'stages')?.status, 'pass');
  assert.match(report.advisories.join('\n'), /asserts without justifying/);
});

/* ------------------------------------------------- Tier 2: the frames (plan 3.3) */

test('the pixel half of Tier 2 always runs; the keyed half says it did not', async () => {
  const { sb, dir } = await ready(lessonStoryboard());
  const report = await check(sb, dir, { gates: 'strict' });

  const ink = report.checks.find((c) => c.id === 'ink-floor');
  assert.equal(ink?.tier, 2);
  assert.equal(ink?.status, 'pass', ink?.findings.join('\n'));
  // Ink is measured whether or not anything failed: "how close was this board to the
  // floor" is the question a bare pass cannot answer.
  assert.match(ink?.note ?? '', /frames sampled: mean ink [\d.]+% of pixels/);

  // No key in the test environment, so the two model-backed checks skip — and a skip
  // carries its reason, because a report that could not look must never read as one
  // that looked and found nothing.
  for (const id of ['frame-vision', 'ocr-diff']) {
    const c = report.checks.find((x) => x.id === id);
    assert.equal(c?.status, 'skip', `${id} must skip without a vision pass`);
    assert.match(c?.note ?? '', /needs a key/);
  }
  assert.match(report.tier2 ?? '', /pixels only/);
  assert.equal(report.ok, true);
});

test("a vision pass's findings are advisory, and its answers reach the report", async () => {
  const { sb, dir } = await ready(lessonStoryboard());
  const report = await check(sb, dir, {
    gates: 'strict',
    // A stub standing in for the model: the seam is what is being tested, and a real
    // call would need a key and would answer differently every time.
    vision: (frames) =>
      Promise.resolve([
        { index: 0, clipped: 'the heading runs out of its box on the right' },
        { index: 1, overlap: 'the caption is written across the hillside' },
        // A frame with nothing wrong says nothing, which is the contract the prompt
        // states — an absent field is "no complaint", not "not asked".
        { index: 2 },
        { index: frames.length - 1, empty: 'one line of text on an otherwise blank board' },
      ]),
  });
  const vision = report.checks.find((c) => c.id === 'frame-vision');
  assert.equal(vision?.status, 'warn', 'advisory for one release, per the plan');
  assert.equal(vision?.findings.length, 3);
  assert.match(vision?.findings.join('\n') ?? '', /clipped or cut-off text/);
  assert.match(vision?.findings.join('\n') ?? '', /ink written through other ink/);
  // Every finding says which second of which beat to go and look at.
  assert.match(vision?.findings[0] ?? '', /at \d+\.\ds \(scene \w+\)/);
  assert.equal(report.ok, true, 'an unmeasured false-positive rate may not block a render');
  assert.match(report.tier2 ?? '', /^run: \d+ frames sampled/);
});

test('the OCR diff reports board text a reader of the frame could not find', async () => {
  const { sb, dir } = await ready(lessonStoryboard());
  const report = await check(sb, dir, {
    gates: 'strict',
    // The model read one word of a board that carries whole sentences.
    vision: () => Promise.resolve([{ index: 0, read: ['which'] }]),
  });
  const ocr = report.checks.find((c) => c.id === 'ocr-diff');
  assert.equal(ocr?.status, 'warn');
  assert.equal(ocr?.findings.length, 1);
  assert.match(ocr?.findings[0] ?? '', /could not find those words on it/);
});

test('a vision pass that throws costs the verdicts, not the run', async () => {
  const { sb, dir } = await ready(lessonStoryboard());
  const report = await check(sb, dir, {
    gates: 'strict',
    vision: () => Promise.reject(new Error('402 insufficient credit')),
  });
  assert.equal(report.ok, true);
  const vision = report.checks.find((c) => c.id === 'frame-vision');
  assert.equal(vision?.status, 'skip');
  // The *real* reason, not "no key": those send a reader of qc.json to two different
  // places, and the one that had happened was being reported as the other.
  assert.match(vision?.note ?? '', /402 insufficient credit/);
  // And the free half is unaffected: the frames were still captured and measured.
  assert.equal(report.checks.find((c) => c.id === 'ink-floor')?.status, 'pass');
});
