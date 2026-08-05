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

test('a paid voice key is actually used, and a pin is how you refuse it', () => {
  // The regression: a user pasted an ElevenLabs key and the render came back
  // `kokoro/af_heart`. Nothing failed — the old rule asked whether the *voice id* looked
  // local, and `af_heart` does, so a key was silently never reached. An id names a voice,
  // not a provider.
  const keyed: NodeJS.ProcessEnv = { ELEVENLABS_API_KEY: 'el-test' };
  const withKey = providers('af_heart', keyed).voice;
  assert.equal(withKey.name, 'elevenlabs');
  assert.equal(withKey.cloud, true);
  // The escape hatch has to be discoverable from the report itself.
  assert.match(withKey.why, /kokoro:af_heart/);

  // Pinned: free delivery despite the key, and the voice survives the prefix.
  const pinned = providers('kokoro:af_heart', keyed).voice;
  assert.equal(pinned.name, 'kokoro');
  assert.equal(pinned.cloud, false);
  assert.equal(pinned.model, 'af_heart');

  // No key, no cloud, whatever the id says.
  assert.equal(providers('rachel', noKeys).voice.name, 'kokoro');
  assert.equal(providers('rachel', noKeys).voice.cloud, false);
  // A bare provider name still names its provider — `--voice say` has always meant this.
  assert.equal(providers('say', keyed).voice.name, 'say');
  assert.equal(providers('say', keyed).voice.model, 'say');
});
