import test from 'node:test';
import assert from 'node:assert/strict';
import { describeQc, qcCheck, qcReport, qcSkip } from '../src/qc.js';

test('renderability does not claim skipped visual or semantic validation passed', () => {
  const report = qcReport('strict', [
    qcCheck('layout', []),
    qcSkip('frame-vision', 'provider unavailable', 2),
  ]);
  assert.equal(report.ok, true);
  assert.equal(report.verification?.state, 'incomplete');
  assert.equal(report.verification?.semantics, 'not-checked');
  assert.match(describeQc(report), /did not run/);
  assert.doesNotMatch(describeQc(report), /passed every/);
});

test('a failed check cannot be described as verified', () => {
  const report = qcReport('strict', [qcCheck('labels', ['wrong target'])]);
  assert.equal(report.ok, false);
  assert.equal(report.verification?.state, 'failed');
});
