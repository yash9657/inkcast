import assert from 'node:assert/strict';
import test from 'node:test';
import { degradations, formatDegradation } from '../src/degrade.js';
import { providers } from '../src/providers.js';

const noKeys: NodeJS.ProcessEnv = {};

test('a zero-key run names the lesson stage as the major loss, with a fix', () => {
  const found = degradations(providers('af_heart', noKeys));
  const lesson = found.find((d) => d.stage === 'lesson');
  assert.ok(lesson, 'the lesson stage must report itself as degraded without a key');
  assert.equal(lesson.severity, 'major');
  assert.equal(lesson.fix, 'inkcast keys set anthropic');
  // Every entry carries exactly one runnable command.
  for (const d of found) {
    assert.match(d.fix, /^inkcast /);
    assert.ok(d.effect.length > 20, 'say what is lost, not just that something is');
  }
});

test('Kokoro is a minor note, not a failure — but `say` is major', () => {
  const kokoro = degradations(providers('af_heart', noKeys)).find((d) => d.stage === 'voice');
  assert.equal(kokoro?.severity, 'minor');
  const say = degradations(providers('say', noKeys)).find((d) => d.stage === 'voice');
  assert.equal(say?.severity, 'major');
  assert.match(say!.effect, /build-verification/);
});

test('keys silence the stages they upgrade', () => {
  const env = {
    ANTHROPIC_API_KEY: 'sk-ant-test',
    ELEVENLABS_API_KEY: 'el-test',
    REPLICATE_API_TOKEN: 'r8-test',
  } as NodeJS.ProcessEnv;
  const found = degradations(providers('rachel', env));
  assert.deepEqual(found, []);
});

test('the document route does not blame a missing key for not teaching', () => {
  const found = degradations(providers('af_heart', noKeys), { via: 'document' });
  assert.equal(
    found.find((d) => d.stage === 'lesson'),
    undefined,
  );
});

test('a degradation formats as one readable line ending in the fix', () => {
  const [first] = degradations(providers('af_heart', noKeys));
  const line = formatDegradation(first!);
  assert.ok(line.startsWith('lesson: '));
  assert.ok(line.includes('Fix: inkcast keys set anthropic'));
});
