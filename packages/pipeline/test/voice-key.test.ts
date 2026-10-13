/**
 * The seam between the two caches that decide whether a scene is re-recorded.
 *
 * The voice stage keys each clip on its own inputs, the adapter's delivery signature
 * among them; the pipeline keys the *decision to call the stage at all* on
 * `voiceFingerprint`. Both were tested, and the defect lived between them: the delivery
 * signature carried the engine and this key did not, so
 * `ELEVENLABS_MODEL_ID=eleven_multilingual_v2` on a keyed project left every scene
 * fresh, `cast()` skipped the stage, `narrate` was never called, and the film kept its
 * flash audio with nothing said. `voice.test.ts` asserts the signature carries the model
 * and passed throughout — it never crosses to this side.
 *
 * So these tests drive `markVoiceFresh` and `staleVoiceScenes` — both sides of the key,
 * and the functions `cast()` and `rerender()` themselves call — against a real project
 * directory.
 */
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { type Storyboard } from '@inkcast/core';
import {
  ELEVENLABS_FLASH_MODEL,
  ELEVENLABS_MULTILINGUAL_MODEL,
  ELEVENLABS_QUALITY_MODEL,
  elevenLabsModel,
} from '@inkcast/voice';
import { markVoiceFresh, staleVoiceScenes } from '../src/cast.js';
import { ELEVENLABS_DEFAULT_MODEL, voiceEngine } from '../src/providers.js';
import type { ResolvedVoice } from '../src/stages.js';

/** A keyed environment on the default engine, which is multilingual v2. */
const DEFAULT_ENV: NodeJS.ProcessEnv = { ELEVENLABS_API_KEY: 'sk_test' };
/** The same environment with the engine overridden — the knob that had no effect. */
const FLASH: NodeJS.ProcessEnv = { ...DEFAULT_ENV, ELEVENLABS_MODEL_ID: ELEVENLABS_FLASH_MODEL };

function board(): Storyboard {
  return {
    version: 1,
    title: 'Voice key fixture',
    meta: {
      language: 'en',
      aspect: '16:9',
      palette: 'color',
      fps: 30,
      style: 'marker',
      voice: 'af_heart',
      outroSec: 1,
    },
    canvas: { x: 0, y: 0, w: 1920, h: 1080 },
    assets: [],
    scenes: [
      {
        id: 's0',
        narration: 'The ground under you gets gentler.',
        camera: { x: 960, y: 540, zoom: 1, transition: 0.9 },
        elements: [],
        hold: 0.4,
        emphasis: [],
        durationSec: 4,
        audioPath: 'audio/scene-000.wav',
      },
      {
        id: 's1',
        narration: 'So you step, and you feel it again.',
        camera: { x: 960, y: 540, zoom: 1, transition: 0.9 },
        elements: [],
        hold: 0.4,
        emphasis: [],
        durationSec: 5,
        audioPath: 'audio/scene-001.wav',
      },
    ],
  };
}

/** What the stage reports when it demoted: Kokoro finished, ElevenLabs was asked for. */
const FELL_BACK: ResolvedVoice = {
  provider: 'kokoro',
  label: 'Kokoro',
  voice: 'af_heart',
  model: 'onnx-community/Kokoro-82M-v1.0-ONNX',
  charsByProvider: { elevenlabs: 33, kokoro: 35 },
  modelByProvider: { elevenlabs: 'eleven_flash_v2_5' },
  spoke: true,
  problems: ['voice fell back to kokoro (elevenlabs: quota_exceeded)'],
};

/**
 * A project cached exactly as a run that reported `resolved` would have left it.
 *
 * Written through `markVoiceFresh`, the function the pipeline itself calls, so the test
 * exercises the write side rather than a restatement of it. The audio files are real
 * (if empty) because `isFresh` checks the artefacts exist: an entry pointing at nothing
 * is stale however well its hash matches.
 */
async function cachedProject(
  sb: Storyboard,
  resolved: ResolvedVoice | undefined,
  requested: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'inkcast-voice-key-'));
  for (const scene of sb.scenes) {
    scene.audioPath = path.basename(scene.audioPath!);
    await writeFile(path.resolve(dir, scene.audioPath), '');
  }
  await markVoiceFresh(dir, sb, resolved, requested, env);
  return dir;
}

/** The stage's report when the requested provider spoke the whole film. */
function spokenBy(provider: string, model?: string): ResolvedVoice {
  return {
    provider,
    label: provider,
    voice: 'af_heart',
    ...(model ? { model } : {}),
    charsByProvider: { [provider]: 68 },
    modelByProvider: model ? { [provider]: model } : {},
    spoke: true,
    problems: [],
  };
}

test('the pipeline and the adapter agree on which engine is in force', () => {
  // Mirrored rather than imported — `providers.ts` must decide whether to run the voice
  // stage before it has loaded the voice stage — so the copy is pinned against the
  // original here. Drift is a cache that never invalidates, which is invisible.
  assert.equal(ELEVENLABS_DEFAULT_MODEL, ELEVENLABS_QUALITY_MODEL);
  assert.equal(voiceEngine('elevenlabs', DEFAULT_ENV), elevenLabsModel(DEFAULT_ENV));
  assert.equal(voiceEngine('elevenlabs', FLASH), elevenLabsModel(FLASH));
  assert.equal(voiceEngine('elevenlabs', FLASH), ELEVENLABS_FLASH_MODEL);

  // Only ElevenLabs runs more than one engine, and a provider with one has no business
  // adding an empty field to every other project's key.
  assert.equal(voiceEngine('kokoro', FLASH), '');
  assert.equal(voiceEngine('say', FLASH), '');
});

test('changing the engine makes every scene stale, so the stage is actually re-run', async () => {
  const sb = board();
  const dir = await cachedProject(
    sb,
    spokenBy('elevenlabs', ELEVENLABS_MULTILINGUAL_MODEL),
    'elevenlabs',
    DEFAULT_ENV,
  );

  // The same environment: nothing to do, which is the property the cache exists for.
  assert.deepEqual([...(await staleVoiceScenes(dir, sb, 'elevenlabs', { env: DEFAULT_ENV }))], []);

  // The override. Before the engine entered this key the set came back empty, `cast()`
  // reported `voice cached`, and the request was ignored in silence.
  assert.deepEqual(
    [...(await staleVoiceScenes(dir, sb, 'elevenlabs', { env: FLASH }))],
    ['s0', 's1'],
    'ELEVENLABS_MODEL_ID did not reach the decision to re-record',
  );
});

test('a demotion is not permanent: the free take does not satisfy the paid request', async () => {
  // The write side of the same key. The stage demoted to kokoro; the requested provider
  // is still elevenlabs. Filing the free audio under the *requested* fingerprint made
  // the fallback permanent — top the balance back up, re-run, every scene reads fresh,
  // and the kokoro take is the film forever, with only `--force` to escape it.
  const sb = board();
  const dir = await cachedProject(sb, FELL_BACK, 'elevenlabs', FLASH);

  assert.deepEqual(
    [...(await staleVoiceScenes(dir, sb, 'elevenlabs', { env: FLASH }))],
    ['s0', 's1'],
    'the fallback take satisfied a request for the paid provider',
  );

  // And it is genuinely cached for the provider that made it, so a project pinned to
  // the local voice is not re-recorded on every run: the invalidation is specific to
  // the demotion, not a cache that never hits.
  assert.deepEqual([...(await staleVoiceScenes(dir, sb, 'kokoro', { env: FLASH }))], []);
});

test('force re-records regardless of any of it', async () => {
  const sb = board();
  const dir = await cachedProject(
    sb,
    spokenBy('elevenlabs', 'eleven_flash_v2_5'),
    'elevenlabs',
    FLASH,
  );
  assert.deepEqual(
    [...(await staleVoiceScenes(dir, sb, 'elevenlabs', { env: FLASH, force: true }))],
    ['s0', 's1'],
  );
});
