/**
 * What `pipeline.json` is allowed to say about the voice.
 *
 * The block exists because the file could not previously tell "ElevenLabs spoke" from
 * "an ElevenLabs key was set": every keyed project on disk records
 * `voice: elevenlabs/af_heart` — a *voice* id in the model slot — and `cardiac8` was
 * spoken by the free local engine and billed $0.4286 for it. So the two halves that
 * matter are which fields are observed, and which of them may survive a run that
 * observed nothing.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { voiceRecordOf } from '../src/cast.js';
import type { VoiceRecord } from '../src/state.js';

const REQUESTED = 'elevenlabs';

/** A run that fell back, as the stage reports it. */
const FELL_BACK = {
  provider: 'kokoro',
  label: 'Kokoro',
  voice: 'af_heart',
  model: 'onnx-community/Kokoro-82M-v1.0-ONNX',
  charsByProvider: { elevenlabs: 412, kokoro: 1536 },
  modelByProvider: { elevenlabs: 'eleven_flash_v2_5', kokoro: 'onnx-community/Kokoro-82M-v1.0' },
  spoke: true,
  problems: ['voice fell back to kokoro (elevenlabs: quota_exceeded)'],
};

test('a run that spoke is recorded exactly as the stage reported it', () => {
  const record = voiceRecordOf(FELL_BACK, undefined, REQUESTED, { voiceId: 'af_heart' });
  assert.equal(record.provider, 'kokoro');
  assert.equal(record.requested, 'elevenlabs');
  assert.equal(record.observed, true);
  // Both providers, because the film really is part paid and part free.
  assert.deepEqual(record.chars, { elevenlabs: 412, kokoro: 1536 });
  assert.deepEqual(record.problems, FELL_BACK.problems);
});

test('a cached run keeps who spoke and drops what happened', () => {
  const previous: VoiceRecord = voiceRecordOf(FELL_BACK, undefined, REQUESTED, {
    voiceId: 'af_heart',
  });
  const cached = voiceRecordOf(undefined, previous, REQUESTED, { voiceId: 'af_heart' });

  // Durable: the audio on disk is still the audio the previous run made.
  assert.equal(cached.provider, 'kokoro');
  assert.equal(cached.model, previous.model);
  assert.equal(cached.requested, 'elevenlabs');

  // An event, not a property. Inheriting these printed "voice fell back to kokoro
  // (elevenlabs: quota_exceeded)" on every later cached run of a project that was no
  // longer in that state, and booked its characters again on a run that synthesised
  // nothing.
  assert.deepEqual(cached.problems, []);
  assert.deepEqual(cached.chars, {});
  assert.equal(cached.observed, false);
});

test('a project with no record yet reports the request, and claims nothing', () => {
  // Files written before the block existed. The environment is the only thing left to
  // read, so it is read — but `observed: false` is what stops it becoming a bill.
  const cached = voiceRecordOf(undefined, undefined, REQUESTED, { voiceId: 'af_heart' });
  assert.deepEqual(cached, {
    provider: 'elevenlabs',
    voiceId: 'af_heart',
    requested: 'elevenlabs',
    observed: false,
    chars: {},
    problems: [],
  });
});
