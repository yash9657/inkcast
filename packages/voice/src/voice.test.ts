/**
 * Real end-to-end coverage for the voice stage.
 *
 * The headline test drives `narrate()` through the **system provider** (macOS
 * `say`), which needs no model download, no network and no API key — so it runs
 * for real on a clean checkout and proves the thing that actually matters: a WAV
 * comes out, and its measured duration is plausible and non-zero.
 *
 * Run with:  pnpm --filter @inkcast/voice test
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { bareVoiceId, defaultChain, pinnedProvider } from './providers/index.js';

import { narrate, sceneAudioPath, sceneTimingPath, NARRATION_FILE } from './narrate.js';
import { measureDuration, readClipSamples, writeClipFromParts, writeSilenceWav } from './audio.js';
import {
  readWavInfo,
  encodeWav,
  silenceWav,
  findSpeechBounds,
  trimEdgeSilence,
  CLIP_SAMPLE_RATE,
} from './wav.js';
import {
  gapAfter,
  sentenceSpanWarnings,
  splitClauses,
  splitPhrases,
  PHRASE_GAP_SEC,
  SENTENCE_GAP_SEC,
} from './phrase.js';
import type { PhraseTiming } from './phrase.js';
import {
  MAX_DOMINANT_AT,
  MIN_TRAVEL,
  cueTokens,
  findCueSpan,
  matchTokens,
  resolveSceneCues,
  sceneTokenStream,
} from './cue.js';
import { mapToExpected, hypothesisFromChunks, requestedAlign } from './align.js';
import {
  pickTeachingVoice,
  rankTeachingVoices,
  speedForWpm,
  teachingScore,
  voiceProfile,
  KOKORO_VOICE_PROFILES,
  TEACHING_VOICE,
  TEACHING_WPM_MAX,
  TEACHING_WPM_MIN,
} from './voices.js';
import { parseSayVoices, pickSayVoice, sayRateForWpm } from './providers/system.js';
import {
  alignmentToWords,
  createElevenLabsProvider,
  elevenLabsCostUsd,
  elevenLabsCreditsPerChar,
  elevenLabsDelivery,
  elevenLabsModel,
  ELEVENLABS_FLASH_MODEL,
  ELEVENLABS_USD_PER_CREDIT,
} from './providers/elevenlabs.js';
import {
  moodCatalogueProblems,
  moodVoiceId,
  unverifiedMoods,
  voiceMood,
  DEFAULT_MOOD,
  VOICE_MOODS,
  VOICE_MOOD_IDS,
} from './moods.js';
import {
  chunkForKokoro,
  createKokoroProvider,
  KOKORO_MODEL_ID,
  KOKORO_VOICES,
} from './providers/kokoro.js';
import { failureReason, VoiceProviderError } from './providers/types.js';
import type { SynthesisRequest, VoiceProvider, VoiceProviderId } from './providers/types.js';
import type { Element, Scene, Storyboard } from '@inkcast/core';
// The normaliser lives in core since plan 4.1 — see `core/src/speech.ts`. What it
// does to *narration* is tested beside it (`core/test/speech.test.ts`); what it is
// used for here is phrasing, clip keys and cue placement.
import { normalizeNarration, speakInitialisms } from '@inkcast/core';

/* ------------------------------------------------------------------ fixtures */

type SceneSpec = {
  narration: string;
  hold?: number;
  elements?: Element[];
  cadence?: Scene['cadence'];
  emphasis?: string[];
};

function scene(spec: SceneSpec, i: number): Scene {
  return {
    id: `s${i + 1}`,
    narration: spec.narration,
    camera: { x: 960, y: 540, zoom: 1, transition: 0.9 },
    elements: spec.elements ?? [],
    hold: spec.hold ?? 0,
    emphasis: spec.emphasis ?? [],
    ...(spec.cadence ? { cadence: spec.cadence } : {}),
  };
}

function storyboard(input: Array<string | SceneSpec>): Storyboard {
  return {
    version: 1,
    title: 'Voice stage test',
    meta: {
      language: 'en',
      aspect: '16:9',
      palette: 'color',
      fps: 30,
      style: 'marker',
      voice: 'af_heart',
      outroSec: 1.2,
    },
    canvas: { x: 0, y: 0, w: 1920, h: 1080 },
    assets: [],
    scenes: input.map((spec, i) => scene(typeof spec === 'string' ? { narration: spec } : spec, i)),
  };
}

/** A text element carrying a cue, for cue-resolution tests. */
function cuedText(id: string, cue: string, at = 0): Element {
  return {
    type: 'text',
    id,
    text: id,
    role: 'body',
    align: 'left',
    at: { x: 0, y: 0, w: 400, h: 80 },
    enter: { at, cue, duration: 0.8, style: 'draw' },
    persist: true,
  };
}

/** Synthetic measured phrases, so cue placement can be tested without audio. */
function timings(
  spec: Array<[text: string, start: number, end: number, sentence?: number, ends?: boolean]>,
): PhraseTiming[] {
  return spec.map(([text, start, end, sentence = 0, ends = true]) => ({
    text,
    sentence,
    endsSentence: ends,
    sentenceWords: text.split(/\s+/).filter(Boolean).length,
    start,
    end,
  }));
}

async function withTempProject<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'inkcast-voice-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/* ---------------------------------------------------------------- wav module */

test('WAV round-trips through the encoder and reader', () => {
  const frames = 2400; // 0.1s at 24 kHz
  const pcm = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) pcm.writeInt16LE(Math.round(Math.sin(i / 20) * 8000), i * 2);

  const info = readWavInfo(encodeWav(pcm));
  assert.equal(info.sampleRate, CLIP_SAMPLE_RATE);
  assert.equal(info.channels, 1);
  assert.equal(info.bitsPerSample, 16);
  assert.equal(info.dataLength, pcm.length);
  assert.ok(Math.abs(info.durationSec - 0.1) < 1e-6);
});

test('silenceWav produces a readable clip of the requested length', () => {
  const info = readWavInfo(silenceWav(0.5));
  assert.ok(Math.abs(info.durationSec - 0.5) < 1e-3);
});

test('readWavInfo rejects non-WAV input rather than guessing', () => {
  assert.throws(() => readWavInfo(Buffer.from('not audio at all, really')), /not a WAV/);
});

/* ------------------------------------------------------------- provider bits */

test('say -v output parses into names and locales', () => {
  const sample = [
    'Albert              en_US    # Hello! My name is Albert.',
    'Daniel              en_GB    # Hello! My name is Daniel.',
    'Eddy (English (US)) en_US    # Hello! My name is Eddy.',
    'Kyoko               ja_JP    # こんにちは',
  ].join('\n');

  const voices = parseSayVoices(sample);
  assert.equal(voices.length, 4);
  assert.deepEqual(voices[2], { name: 'Eddy (English (US))', locale: 'en_US' });

  // Kokoro families map onto accent + gender.
  assert.equal(pickSayVoice('bm_george', voices), 'Daniel');
  assert.equal(pickSayVoice('Albert', voices), 'Albert');
  assert.equal(pickSayVoice('af_heart', voices), 'Albert'); // only en_US left
  assert.equal(pickSayVoice('af_heart', []), undefined);
});

test('the exposed Kokoro voice list is the 28 ids kokoro-js validates', () => {
  assert.equal(KOKORO_VOICES.length, 28);
  assert.ok(KOKORO_VOICES.includes('af_heart'));
  for (const id of KOKORO_VOICES) assert.match(id, /^[ab][fm]_[a-z]+$/);
});

test('long narration is chunked on sentence boundaries for Kokoro', () => {
  const sentence = 'This is a reasonably long sentence about gradient descent. ';
  const chunks = chunkForKokoro(sentence.repeat(12).trim(), 200);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.length <= 200 || chunk.includes('gradient'));
  assert.equal(
    chunks.join(' ').replace(/\s+/g, ' '),
    sentence.repeat(12).trim().replace(/\s+/g, ' '),
  );
});

test('character alignment folds into word timings', () => {
  const words = alignmentToWords({
    characters: ['H', 'i', ' ', 't', 'h', 'e', 'r', 'e', '.'],
    character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
    character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9],
  });
  assert.deepEqual(
    words.map((w) => w.word),
    ['Hi', 'there.'],
  );
  assert.equal(words[0]?.start, 0);
  assert.ok((words[1]?.end ?? 0) > (words[0]?.end ?? 0));
});

/* ------------------------------------------- the record of who actually spoke */

/**
 * A provider that speaks silence, or refuses to speak at all.
 *
 * The failover path decides both what `pipeline.json` records and what the run is
 * billed, and it cannot be exercised any other way: reproducing it for real needs a
 * paid key and a genuinely exhausted balance. `OpenChainOptions.create` is the seam.
 */
function stubProvider(
  id: VoiceProviderId,
  opts: {
    model?: string;
    fail?: VoiceProviderError;
    /**
     * Which calls `fail` applies to. Absent means all of them.
     *
     * A provider that dies *part-way* is a different failure from one that never
     * speaks, and only the first exercises the whole-film restart: the run has already
     * committed several scenes to a voice it is about to lose. See `sceneOfClip`.
     */
    failWhen?: (req: SynthesisRequest) => boolean;
    /** Every call that produced audio, in order — who spoke, and for which scene. */
    onSpoke?: (id: VoiceProviderId, req: SynthesisRequest) => void;
    /** What the call cost, when that is not `text.length`. See `SynthesisResult`. */
    billedChars?: (text: string) => number;
  } = {},
): VoiceProvider {
  return {
    id,
    label: `stub ${id}`,
    available: async () => true,
    voices: async () => ['stub'],
    resolveVoice: async () => `${id}-voice`,
    naturalWpm: () => 150,
    modelId: () => opts.model,
    synthesize: async (req) => {
      if (opts.fail && (opts.failWhen?.(req) ?? true)) throw opts.fail;
      opts.onSpoke?.(id, req);
      await writeSilenceWav(req.outPath, Math.max(0.4, req.text.length / 15));
      return opts.billedChars ? { billedChars: opts.billedChars(req.text) } : {};
    },
    dispose: async () => undefined,
  };
}

/**
 * Which scene a phrase clip belongs to, read back out of its scratch path.
 *
 * `synthesizeScene` writes `audio/.phrases/{scene}-{phrase}.wav`, and that is the only
 * thing in the request that says which beat is being spoken — the stage does not tell a
 * provider where it is in the film. It is enough to prove the property that matters:
 * that after a failover, every scene index is spoken again by the provider that took
 * over.
 */
function sceneOfClip(req: SynthesisRequest): number {
  return Number(path.basename(req.outPath).split('-')[0]);
}

/** Characters the stage will hand a provider for one narration, split as it splits. */
function phraseChars(narration: string): number {
  return splitPhrases(normalizeNarration(narration), { mode: 'clause' }).reduce(
    (n, p) => n + p.text.length,
    0,
  );
}

test('the record names the provider that actually spoke, not the one that was asked for', async () => {
  await withTempProject(async (dir) => {
    const lines = [
      'The heart has its own pacemaker, and it fires without being told to.',
      'The signal spreads through the atria, then waits at the gate.',
    ];
    const sb = storyboard(lines);

    const { storyboard: out, voice } = await narrate(sb, dir, {
      provider: 'elevenlabs',
      padSec: 0,
      align: 'off',
      createProvider: (id) =>
        id === 'elevenlabs'
          ? stubProvider(id, {
              model: ELEVENLABS_FLASH_MODEL,
              fail: new VoiceProviderError('ElevenLabs /text-to-speech -> 401', {
                provider: 'elevenlabs',
                reason: 'quota_exceeded',
                status: 401,
              }),
            })
          : stubProvider(id, { model: KOKORO_MODEL_ID }),
    });

    // The provider that spoke, and the engine it spoke with.
    assert.equal(voice.provider, 'kokoro');
    assert.equal(voice.model, KOKORO_MODEL_ID);
    assert.equal(voice.spoke, true);

    // Nothing is billed to the provider that refused. This is the $0.4286 defect.
    assert.equal(voice.charsByProvider.elevenlabs ?? 0, 0);
    assert.equal(
      voice.charsByProvider.kokoro,
      lines.reduce((n, l) => n + phraseChars(l), 0),
    );

    // The fallback is carried out of the stage in the shape `lessonProblems` uses. The
    // provider refused its very first phrase, so scene 1 was already being re-narrated
    // before anything was committed — hence a whole-film restart *and* its second line.
    assert.deepEqual(voice.problems, [
      'voice fell back to kokoro (elevenlabs: quota_exceeded)',
      'narrated locally: elevenlabs failed part-way through, so all 2 scenes were re-narrated ' +
        'with kokoro for one consistent voice, and the 0 discarded characters are billed at $0',
    ]);

    // And the failover cost the film nothing: every scene still has real audio.
    for (let i = 0; i < out.scenes.length; i++) {
      assert.equal(out.scenes[i]?.audioPath, sceneAudioPath(i));
      assert.ok((out.scenes[i]?.durationSec ?? 0) > 0.3);
    }
  });
});

/* ------------------------------------------- one film, one voice (A5, deliverable 2) */

/** Four beats, so a provider can die in the middle of the film rather than at its edge. */
const FOUR_BEATS = [
  'The heart has its own pacemaker, and it fires without being told to.',
  'The signal spreads across the atria, and they squeeze together.',
  'At the gate it waits, for a tenth of a second, while the ventricles fill.',
  'Then it runs down the bundle and the ventricles contract from the bottom up.',
];

test('a provider that dies mid-film sends the whole film back to scene 0 in one voice', async () => {
  await withTempProject(async (dir) => {
    const sb = storyboard(FOUR_BEATS);
    /** Who spoke, for which scene, in order. The record the assertions are made from. */
    const spoke: Array<{ id: VoiceProviderId; scene: number }> = [];
    const seen = (id: VoiceProviderId, req: SynthesisRequest) =>
      spoke.push({ id, scene: sceneOfClip(req) });

    const { storyboard: out, voice } = await narrate(sb, dir, {
      provider: 'elevenlabs',
      padSec: 0,
      align: 'off',
      createProvider: (id) =>
        id === 'elevenlabs'
          ? stubProvider(id, {
              model: ELEVENLABS_FLASH_MODEL,
              onSpoke: seen,
              // Two beats in the paid voice, then the balance runs out. This is the run
              // that produced `projects/cardiac8`: six scenes paid, four free, and a
              // narrator who changes person half way through the film.
              failWhen: (req) => sceneOfClip(req) >= 2,
              fail: new VoiceProviderError('ElevenLabs /text-to-speech -> 401', {
                provider: 'elevenlabs',
                reason: 'quota_exceeded',
                status: 401,
              }),
            })
          : stubProvider(id, { model: KOKORO_MODEL_ID, onSpoke: seen }),
    });

    // The paid provider really did speak first — otherwise this test is not exercising
    // a mid-film death at all, it is exercising the trivial "never available" path.
    const lastPaid = spoke.map((s) => s.id).lastIndexOf('elevenlabs');
    assert.ok(lastPaid >= 0, 'the paid provider must have spoken before it failed');
    assert.ok(
      spoke.slice(0, lastPaid + 1).some((s) => s.scene === 0),
      'and it must have committed at least scene 1 of the film',
    );

    // THE PROPERTY: everything after the last paid phrase is one provider, and it covers
    // every scene in the film. Not "the tail was re-done" — the whole film was.
    const after = spoke.slice(lastPaid + 1);
    assert.deepEqual(
      [...new Set(after.map((s) => s.id))],
      ['kokoro'],
      'the film after the failover must be spoken by exactly one provider',
    );
    assert.deepEqual(
      [...new Set(after.map((s) => s.scene))].sort((a, b) => a - b),
      [0, 1, 2, 3],
      'every scene must be re-synthesised, including the ones already finished',
    );

    // Provenance is returned, not inferred — the whole point of A5's second deliverable.
    assert.equal(voice.provider, 'kokoro');
    assert.equal(voice.fellBackFrom, 'elevenlabs');
    assert.equal(voice.model, KOKORO_MODEL_ID);
    assert.equal(voice.spoke, true);

    // The abandoned ElevenLabs partial is billed at zero, and the tally it was counted
    // in no longer mentions it at all — which is what makes the *pipeline's* cost line
    // zero without the pipeline knowing any of this happened.
    assert.equal(voice.charsByProvider.elevenlabs ?? 0, 0);
    assert.equal(voice.costUsd, 0);
    assert.equal(
      voice.chars,
      FOUR_BEATS.reduce((n, l) => n + phraseChars(l), 0),
    );
    assert.equal(voice.charsByProvider.kokoro, voice.chars);

    // But it is not hidden: the discarded audio is reported, with what it was worth.
    assert.ok((voice.abandonedChars ?? 0) > 0, 'discarded characters must be reported');
    assert.equal(
      voice.abandonedCostUsd,
      Math.round(elevenLabsCostUsd(voice.abandonedChars ?? 0, ELEVENLABS_FLASH_MODEL) * 10_000) /
        10_000,
    );

    // And the viewer is told, in the field the result UI reads.
    assert.ok(
      voice.problems.some((p) => p.startsWith('narrated locally:') && p.includes('all 4 scenes')),
      `expected a whole-film fallback line, got ${JSON.stringify(voice.problems)}`,
    );

    // The film itself is complete and playable.
    for (let i = 0; i < out.scenes.length; i++) {
      assert.equal(out.scenes[i]?.audioPath, sceneAudioPath(i));
      assert.ok((out.scenes[i]?.durationSec ?? 0) > 0.3);
    }
  });
});

test('the restart leaves a cache that describes the film that was actually made', async () => {
  await withTempProject(async (dir) => {
    const sb = storyboard(FOUR_BEATS);
    const quota = new VoiceProviderError('ElevenLabs /text-to-speech -> 401', {
      provider: 'elevenlabs',
      reason: 'quota_exceeded',
      status: 401,
    });

    await narrate(sb, dir, {
      provider: 'elevenlabs',
      padSec: 0,
      align: 'off',
      createProvider: (id) =>
        id === 'elevenlabs'
          ? stubProvider(id, {
              model: ELEVENLABS_FLASH_MODEL,
              failWhen: (req) => sceneOfClip(req) >= 2,
              fail: quota,
            })
          : stubProvider(id, { model: KOKORO_MODEL_ID }),
    });

    // The scenes the abandoned attempt had already finished are the ones a naive restart
    // gets wrong: their clips were written by the provider that quit, and if the restart
    // had marked them fresh, this second run would serve them and the film would be two
    // voices again — permanently, because nothing would ever look at them a third time.
    const spoke: Array<{ id: VoiceProviderId; scene: number }> = [];
    const second = await narrate(sb, dir, {
      provider: 'kokoro',
      padSec: 0,
      align: 'off',
      createProvider: (id) =>
        stubProvider(id, {
          model: KOKORO_MODEL_ID,
          onSpoke: (who, req) => spoke.push({ id: who, scene: sceneOfClip(req) }),
        }),
    });

    assert.deepEqual(spoke, [], 'every scene must already be cached under the voice that spoke it');
    assert.equal(second.voice.spoke, false);
    assert.equal(second.voice.chars, 0);
    assert.equal(second.voice.costUsd, 0);
    assert.equal(second.voice.fellBackFrom, undefined);
    assert.deepEqual(second.voice.problems, []);
  });
});

test('a film that stays on the paid provider is priced from what it actually spoke', async () => {
  await withTempProject(async (dir) => {
    const sb = storyboard(FOUR_BEATS);
    const { voice } = await narrate(sb, dir, {
      provider: 'elevenlabs',
      padSec: 0,
      align: 'off',
      createProvider: (id) => stubProvider(id, { model: ELEVENLABS_FLASH_MODEL }),
    });

    const chars = FOUR_BEATS.reduce((n, l) => n + phraseChars(l), 0);
    assert.equal(voice.fellBackFrom, undefined);
    assert.equal(voice.chars, chars);
    // Flash bills half a credit per character; the number is the tally, not the request.
    assert.equal(voice.costUsd, chars * 0.5 * ELEVENLABS_USD_PER_CREDIT);
    assert.equal(voice.abandonedChars, undefined);
  });
});

test('an engine with no published rate is priced at the ceiling, not discounted', () => {
  assert.equal(elevenLabsCreditsPerChar(ELEVENLABS_FLASH_MODEL), 0.5);
  assert.equal(elevenLabsCreditsPerChar('eleven_multilingual_v2'), 1);
  // `eleven_v3` is the A/B candidate in `docs/PLAN-LAUNCH.md` A5 and this repo has not
  // confirmed its rate. Guessing downwards under-states a real invoice.
  assert.equal(elevenLabsCreditsPerChar('eleven_v3'), 1);
  assert.equal(elevenLabsCreditsPerChar(undefined), 1);
  assert.equal(elevenLabsCostUsd(0, ELEVENLABS_FLASH_MODEL), 0);
  assert.equal(elevenLabsCostUsd(1000, ELEVENLABS_FLASH_MODEL), 1000 * 0.5 * 0.00022);
});

/* ------------------------------------------- the curated moods (A5, deliverable 1) */

test('every mood pins a voice pair the pipeline can actually deliver', () => {
  assert.deepEqual(moodCatalogueProblems(), []);
  assert.equal(VOICE_MOODS.length, VOICE_MOOD_IDS.length);
  assert.ok(VOICE_MOODS.length >= 3 && VOICE_MOODS.length <= 4, 'curate, do not enumerate');

  for (const mood of VOICE_MOODS) {
    // The twin has to be a voice kokoro-js will accept, or the fallback the whole
    // catalogue exists for lands on the global default and the mood is a lie.
    assert.ok(
      (KOKORO_VOICES as readonly string[]).includes(mood.kokoro),
      `${mood.id}: ${mood.kokoro} is not a kokoro-js voice`,
    );
    // And it has to be able to reach the teaching band without smearing consonants.
    assert.ok(speedForWpm(mood.kokoro) > 0.7, `${mood.id}: ${mood.kokoro} cannot be slowed enough`);
    assert.ok(voiceProfile(mood.kokoro), `${mood.id}: ${mood.kokoro} is unmeasured`);
  }
});

test('no mood claims to have been chosen by ear', () => {
  // The requirement is the honesty, not the flag: A5 asks for voices selected by
  // listening, nobody has listened, and every entry says so where a human will see it.
  assert.deepEqual(
    unverifiedMoods().map((m) => m.id),
    VOICE_MOODS.map((m) => m.id),
  );
  for (const mood of VOICE_MOODS) assert.equal(mood.verified, false);
});

test('a mood resolves from anything already stored on disk or in a UI', () => {
  assert.equal(voiceMood('calm')?.id, 'calm');
  assert.equal(voiceMood('Warm')?.id, 'warm');
  assert.equal(voiceMood('BRIGHT')?.id, 'bright');
  // Every storyboard written before the catalogue existed says `af_heart`, and it must
  // land on the mood that voice is the twin of rather than on nothing.
  assert.equal(voiceMood('af_heart')?.id, 'calm');
  assert.equal(voiceMood(TEACHING_VOICE)?.id, 'calm');
  assert.equal(voiceMood('21m00Tcm4TlvDq8ikWAM')?.id, 'calm');
  // A real voice that is not one of the four is not a mood, and must not be coerced
  // into one — the adapters still resolve it their own way.
  assert.equal(voiceMood('bm_fable'), undefined);
  assert.equal(voiceMood(undefined), undefined);
  assert.equal(voiceMood(''), undefined);
  assert.equal(DEFAULT_MOOD, 'calm');
});

test('a mood names one voice per provider, and Calm keeps the pinned teaching delivery', () => {
  const calm = voiceMood('calm')!;
  assert.equal(moodVoiceId(calm, 'elevenlabs'), calm.elevenlabs.voiceId);
  assert.equal(moodVoiceId(calm, 'kokoro'), calm.kokoro);
  // `system` and `silence` have no catalogue to map into, so they get the twin and let
  // their own `resolveVoice` do what it already did with a Kokoro id.
  assert.equal(moodVoiceId(calm, 'system'), calm.kokoro);
  // A5: "Calm = keep stability 0.55, style 0". Those live in the adapter, pinned for
  // every mood, and the delivery signature is what proves they are still in the key.
  assert.ok(elevenLabsDelivery().includes('pinned-settings'));
});

test('the adapters resolve a mood to its own pinned voice, without asking the network', async () => {
  const realFetch = globalThis.fetch;
  const realKey = process.env.ELEVENLABS_API_KEY;
  const realOverride = process.env.ELEVENLABS_VOICE_ID;
  process.env.ELEVENLABS_API_KEY = 'sk_test_never_spent';
  delete process.env.ELEVENLABS_VOICE_ID;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    throw new Error('the mood catalogue must not need the voice list');
  }) as typeof fetch;
  try {
    const el = createElevenLabsProvider();
    // The substantive part: resolution by *id*, so two accounts with different libraries
    // cast the same lesson identically. The old path asked `/voices` and matched names.
    assert.equal(await el.resolveVoice('warm'), voiceMood('warm')!.elevenlabs.voiceId);
    assert.equal(await el.resolveVoice('af_heart'), voiceMood('calm')!.elevenlabs.voiceId);
    assert.equal(calls, 0, 'a pinned mood must not cost a round trip');

    // And the local engine speaks the twin of the same mood rather than the default.
    const ko = createKokoroProvider();
    assert.equal(await ko.resolveVoice('warm'), voiceMood('warm')!.kokoro);
    assert.equal(await ko.resolveVoice('narrator'), voiceMood('narrator')!.kokoro);
    assert.equal(await ko.resolveVoice('af_nicole'), 'af_nicole');
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = realKey;
    if (realOverride !== undefined) process.env.ELEVENLABS_VOICE_ID = realOverride;
  }
});

test('a storyboard cast in a mood reports the mood it was cast in', async () => {
  await withTempProject(async (dir) => {
    const sb = storyboard(['A mood is what the person chose, and it has to survive the run.']);
    sb.meta.voice = 'narrator';
    const { voice } = await narrate(sb, dir, {
      provider: 'kokoro',
      padSec: 0,
      align: 'off',
      createProvider: (id) => stubProvider(id, { model: KOKORO_MODEL_ID }),
    });
    // Neither `provider` nor `voice` can be read back into the mood — "Narrator" is one
    // id on a paid run and another locally — so the choice is carried out explicitly.
    assert.equal(voice.mood, 'narrator');
  });
});

test('a run where nothing was synthesised does not claim anyone spoke', async () => {
  await withTempProject(async (dir) => {
    const sb = storyboard(['A cached scene is audio nobody paid for twice.']);
    const create = (id: VoiceProviderId) => stubProvider(id, { model: KOKORO_MODEL_ID });

    const first = await narrate(sb, dir, { provider: 'kokoro', padSec: 0, createProvider: create });
    assert.equal(first.voice.spoke, true);
    assert.ok((first.voice.charsByProvider.kokoro ?? 0) > 0);

    // The chain still resolves a provider on a cache hit — for ElevenLabs that is a
    // network call — so "who is active" must not be reported as "who spoke".
    const second = await narrate(sb, dir, {
      provider: 'kokoro',
      padSec: 0,
      createProvider: create,
    });
    assert.equal(second.voice.provider, 'kokoro');
    assert.equal(second.voice.spoke, false);
    assert.deepEqual(second.voice.charsByProvider, {});
  });
});

test('the ElevenLabs engine is flash, and its id is inside the clip key', () => {
  // Deliverable 3: flash bills half a credit per character where multilingual bills one.
  assert.equal(elevenLabsModel({} as NodeJS.ProcessEnv), ELEVENLABS_FLASH_MODEL);
  assert.equal(
    elevenLabsModel({ ELEVENLABS_MODEL_ID: 'eleven_multilingual_v2' } as NodeJS.ProcessEnv),
    'eleven_multilingual_v2',
  );

  // The delivery signature is hashed into every scene key, so changing the engine has
  // to change it — otherwise an existing project stays fresh and never hears flash.
  const flash = elevenLabsDelivery({ ELEVENLABS_MODEL_ID: ELEVENLABS_FLASH_MODEL } as never);
  const v2 = elevenLabsDelivery({ ELEVENLABS_MODEL_ID: 'eleven_multilingual_v2' } as never);
  assert.notEqual(flash, v2);
  assert.ok(flash.includes(ELEVENLABS_FLASH_MODEL));

  // The free provider names its engine too, so `charsByProvider` has something to label.
  assert.equal(createKokoroProvider().modelId?.(), KOKORO_MODEL_ID);
});

test('an exhausted balance is classified, not scraped out of the message', async () => {
  const realFetch = globalThis.fetch;
  const realKey = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = 'sk_test_never_spent';
  // A 401 is two different events: no credits left, and a key that is not valid. The
  // only machine-readable difference is `detail.status`, and the fallback line has to
  // name which one it was.
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ detail: { status: 'quota_exceeded', message: 'no credits' } }), {
      status: 401,
      statusText: 'Unauthorized',
    })) as typeof fetch;
  try {
    const el = createElevenLabsProvider();
    const err = await el
      .synthesize({
        text: 'one',
        voice: '21m00Tcm4TlvDq8ikWAM',
        speed: 1,
        language: 'en',
        outPath: path.join(os.tmpdir(), 'inkcast-never-written.wav'),
      })
      .then(() => undefined)
      .catch((e: unknown) => e);
    assert.ok(err instanceof VoiceProviderError, 'a provider failure must name itself');
    assert.equal(err.reason, 'quota_exceeded');
    assert.equal(err.status, 401);
    assert.equal(failureReason(new Error('anything else')), 'unknown');
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = realKey;
  }
});

test('a phrase the adapter generated twice is billed twice', async () => {
  // One `synthesize` is not one generation. `/with-timestamps` can answer 200 with no
  // `audio_base64` — audio that was made, charged and cannot be used — and the fall
  // through to plain TTS is a second full request for the same words. The tally is the
  // only record of what was spent, so it has to hear about the retry.
  const realFetch = globalThis.fetch;
  const realKey = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = 'sk_test_never_spent';
  const out = path.join(await mkdtemp(path.join(os.tmpdir(), 'inkcast-billing-')), 'clip.wav');
  const text = 'Two generations of the same sentence.';

  /** A run of the adapter where the timestamped attempt fails in the given way. */
  const attempt = async (first: () => Response) => {
    const calls: string[] = [];
    globalThis.fetch = (async (url: string | URL) => {
      const u = String(url);
      calls.push(u);
      if (u.includes('/with-timestamps')) return first();
      return new Response(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), { status: 200 });
    }) as typeof fetch;
    const result = await createElevenLabsProvider().synthesize({
      text,
      voice: '21m00Tcm4TlvDq8ikWAM',
      speed: 1,
      language: 'en',
      outPath: out,
    });
    return { result, calls };
  };

  try {
    // 200 with no audio: generated, billed, unusable. Two requests, two charges.
    const empty = await attempt(() => new Response(JSON.stringify({}), { status: 200 }));
    assert.equal(empty.calls.length, 2, 'the fall-through is a second full TTS request');
    assert.equal(empty.result.billedChars, text.length * 2);

    // A request the rate limiter refused never reached the engine, so the retry is the
    // only generation there was, and `text.length` — the caller's default — is right.
    const limited = await attempt(
      () => new Response('slow down', { status: 429, statusText: 'Too Many Requests' }),
    );
    assert.equal(limited.calls.length, 2);
    assert.equal(limited.result.billedChars, undefined);
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = realKey;
    await rm(path.dirname(out), { recursive: true, force: true });
  }
});

test('the stage tallies what the provider says it spent, not what it was handed', async () => {
  await withTempProject(async (dir) => {
    const line = 'The gate holds the signal back for a tenth of a second.';
    const sb = storyboard([line]);
    const { voice } = await narrate(sb, dir, {
      provider: 'elevenlabs',
      padSec: 0,
      align: 'off',
      // Every phrase generated twice, as the timestamped fall-through does it.
      createProvider: (id) =>
        stubProvider(id, { model: ELEVENLABS_FLASH_MODEL, billedChars: (t) => t.length * 2 }),
    });
    // Counting `phrase.text.length` per successful call under-reported by exactly the
    // retry, and this tally is now the sole source of the billed number.
    assert.equal(voice.charsByProvider.elevenlabs, phraseChars(line) * 2);
    assert.equal(voice.modelByProvider.elevenlabs, ELEVENLABS_FLASH_MODEL);
  });
});

/* ------------------------------------------------- end-to-end: system provider */

const darwin = process.platform === 'darwin';

test(
  'narrate() end-to-end on the system provider produces measurable WAV clips',
  { skip: darwin ? false : 'macOS `say` is only available on darwin' },
  async () => {
    await withTempProject(async (dir) => {
      const sb = storyboard([
        'Gradient descent walks downhill on the loss surface.',
        'Each step is scaled by the learning rate, e.g. 0.01.',
      ]);

      const progress: number[] = [];
      const { storyboard: out } = await narrate(sb, dir, {
        provider: 'system',
        padSec: 0.2,
        onProgress: (p) => progress.push(p.pct),
      });

      // Progress is reported and monotonic, ending at 100.
      assert.ok(progress.length >= 3);
      assert.equal(progress.at(-1), 100);
      assert.deepEqual(
        progress,
        [...progress].sort((a, b) => a - b),
      );

      let sum = 0;
      for (let i = 0; i < out.scenes.length; i++) {
        const scene = out.scenes[i]!;
        const rel = sceneAudioPath(i);

        assert.equal(scene.audioPath, rel, 'audioPath must be project-relative');
        const abs = path.resolve(dir, rel);
        assert.ok((await stat(abs)).size > 1000, 'clip should hold real samples');

        // A real WAV in the clip format.
        const info = readWavInfo(await readFile(abs));
        assert.equal(info.sampleRate, CLIP_SAMPLE_RATE);
        assert.equal(info.channels, 1);
        assert.equal(info.bitsPerSample, 16);

        // A plausible, non-zero, ffprobe-measured duration.
        const measured = await measureDuration(abs);
        assert.ok(measured > 0.5, `scene ${i} lasted only ${measured}s`);
        assert.ok(measured < 30, `scene ${i} lasted an implausible ${measured}s`);
        assert.ok(
          Math.abs((scene.durationSec ?? 0) - measured) < 0.05,
          `durationSec ${scene.durationSec} should match the measured ${measured}`,
        );
        assert.ok(Math.abs(info.durationSec - measured) < 0.05, 'header and ffprobe should agree');
        sum += measured;
      }

      // The assembled track is every clip plus the outro silence.
      const narrationAbs = path.resolve(dir, NARRATION_FILE);
      const trackInfo = readWavInfo(await readFile(narrationAbs));
      assert.equal(trackInfo.sampleRate, CLIP_SAMPLE_RATE);

      const trackDuration = await measureDuration(narrationAbs);
      const expected = sum + sb.meta.outroSec;
      assert.ok(
        Math.abs(trackDuration - expected) < 0.1,
        `narration.wav is ${trackDuration}s, expected about ${expected}s`,
      );
    });
  },
);

test(
  'a second narrate() run reuses the cache instead of re-synthesising',
  { skip: darwin ? false : 'macOS `say` is only available on darwin' },
  async () => {
    await withTempProject(async (dir) => {
      const sb = storyboard(['Caching means editing one scene is cheap.']);

      const { storyboard: first } = await narrate(sb, dir, { provider: 'system', padSec: 0 });
      const clip = path.resolve(dir, sceneAudioPath(0));
      const before = await stat(clip);

      const { storyboard: second } = await narrate(sb, dir, { provider: 'system', padSec: 0 });
      const after = await stat(clip);

      assert.equal(after.mtimeMs, before.mtimeMs, 'cached scene must not be rewritten');
      assert.equal(second.scenes[0]?.durationSec, first.scenes[0]?.durationSec);

      // Changing the narration invalidates only that scene.
      const edited = storyboard(['Editing the text must force a fresh clip.']);
      await narrate(edited, dir, { provider: 'system', padSec: 0 });
      assert.notEqual((await stat(clip)).mtimeMs, before.mtimeMs);
    });
  },
);

/* ------------------------------------------- end-to-end: never-crash fallback */

test('the silence provider keeps the pipeline alive with real, timed clips', async () => {
  await withTempProject(async (dir) => {
    const sb = storyboard([
      'One idea per scene keeps the board readable.',
      'The camera moves instead of wiping the canvas.',
    ]);

    const { storyboard: out } = await narrate(sb, dir, { provider: 'silence', padSec: 0 });

    for (let i = 0; i < out.scenes.length; i++) {
      const scene = out.scenes[i]!;
      assert.equal(scene.audioPath, sceneAudioPath(i));
      assert.ok((scene.durationSec ?? 0) > 1, 'estimated duration must be positive');
      const info = readWavInfo(await readFile(path.resolve(dir, sceneAudioPath(i))));
      assert.equal(info.sampleRate, CLIP_SAMPLE_RATE);
    }

    const track = await measureDuration(path.resolve(dir, NARRATION_FILE));
    const expected = out.scenes.reduce((a, s) => a + (s.durationSec ?? 0), 0) + sb.meta.outroSec;
    assert.ok(Math.abs(track - expected) < 0.1, `track ${track}s vs expected ${expected}s`);
  });
});

test('an empty narration still yields a positive duration and a clip', async () => {
  await withTempProject(async (dir) => {
    const { storyboard: out } = await narrate(storyboard(['   \n\n  ']), dir, {
      provider: 'silence',
      padSec: 0.3,
    });
    const scene = out.scenes[0]!;
    assert.ok((scene.durationSec ?? 0) > 0, 'durationSec must stay positive for the IR');
    assert.equal(scene.audioPath, sceneAudioPath(0));
  });
});

test('narrate() enriches a copy and leaves the input storyboard untouched', async () => {
  await withTempProject(async (dir) => {
    const sb = storyboard(['Stages enrich the storyboard, they do not reshape it.']);
    const { storyboard: out } = await narrate(sb, dir, { provider: 'silence', padSec: 0 });
    assert.equal(sb.scenes[0]?.durationSec, undefined);
    assert.equal(sb.scenes[0]?.audioPath, undefined);
    assert.ok(out.scenes[0]?.durationSec);
  });
});

/* ------------------------------------------------------------ phrase splitting */

test('clauses split only where both sides carry real weight', () => {
  // Both sides substantial -> a boundary worth measuring.
  assert.deepEqual(splitClauses('Feel which way is downhill, and take one small step that way.'), [
    'Feel which way is downhill,',
    'and take one small step that way.',
  ]);
  // A short apposition is punctuation, not a boundary.
  assert.deepEqual(splitClauses('The weight, w, controls the whole prediction.'), [
    'The weight, w, controls the whole prediction.',
  ]);
  // Semicolons and colons cut on the same rule.
  assert.equal(
    splitClauses('Here is the rule: always step downhill from where you are.').length,
    2,
  );
  assert.deepEqual(splitClauses(''), []);
});

test('phrase splitting keeps punctuation so prosody survives the cut', () => {
  const text = normalizeNarration(
    'Imagine a foggy hillside, and you want the valley below. You cannot see it.',
  );
  const phrases = splitPhrases(text);
  assert.ok(phrases.length >= 3, `expected clause-level phrases, got ${phrases.length}`);
  // The comma stays on the clause it closes: that is what preserves continuation
  // intonation instead of ending every clip on a terminal fall.
  assert.match(phrases[0]!.text, /,$/);
  assert.equal(phrases[0]!.endsSentence, false);
  assert.equal(phrases.at(-1)!.endsSentence, true);
  // Nothing is lost or duplicated.
  assert.equal(phrases.map((p) => p.text).join(' '), text);
});

test('sentence mode never cuts inside a sentence', () => {
  const text = normalizeNarration('One clause, then another clause here. And a second sentence.');
  const phrases = splitPhrases(text, { mode: 'sentence' });
  assert.equal(phrases.length, 2);
  for (const p of phrases) assert.equal(p.endsSentence, true);
});

test('gaps are longer between sentences than between clauses', () => {
  const [a, b, c] = splitPhrases(
    normalizeNarration(
      'Feel the ground beneath you, then take one step downhill. Then do it again.',
    ),
  );
  assert.ok(a && b && c, 'expected two clauses and a second sentence');
  assert.equal(a.sentence, 0);
  assert.equal(b.sentence, 0);
  assert.equal(c.sentence, 1);
  assert.equal(gapAfter(a, b), PHRASE_GAP_SEC);
  assert.equal(gapAfter(b, c), SENTENCE_GAP_SEC);
  assert.equal(gapAfter(c, undefined), 0, 'nothing follows the last phrase');
  assert.ok(SENTENCE_GAP_SEC > PHRASE_GAP_SEC);

  // A run of short sentences is one breath, not three stops. 35 uniform pauses in a
  // two-minute render is what "so many unnatural pauses" turned out to mean.
  const run = splitPhrases(normalizeNarration('Somewhere below is a valley. You have no map.'));
  assert.ok(run.length === 2);
  assert.ok(
    gapAfter(run[0]!, run[1]!) < SENTENCE_GAP_SEC,
    'a five-word sentence should not stop like a claim',
  );
  // A question gets the longest silence there is: the learner is meant to answer it.
  const asked = splitPhrases(normalizeNarration('You cannot see it. So how do you get down?'));
  const [claim, question] = asked;
  assert.ok(claim && question);
  assert.ok(
    gapAfter(question, claim) > SENTENCE_GAP_SEC,
    'a question needs more room than a statement',
  );
  // The length that matters is the sentence's, not this clause's: the closing phrase of a
  // long sentence still lands, even when it is three words on its own.
  assert.ok(b.sentenceWords >= 7 && b.text.split(/\s+/).length < 7);
});

test('a sentence split across scenes is reported, naming the scenes', () => {
  const warnings = sentenceSpanWarnings([
    'The ground under you gets gentler',
    'as you approach the valley floor.',
  ]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /scene 1/);
  assert.match(warnings[0]!, /scene 2/);
  assert.equal(sentenceSpanWarnings(['A whole sentence.', 'Another whole one.']).length, 0);
});

/* -------------------------------------------------------------- cue matching */

test('cue tokens are normalised the same way narration is', () => {
  assert.deepEqual(matchTokens('The  MINUS-sign, exactly!'), ['the', 'minus', 'sign', 'exactly']);
  // A cue quoted from the source still matches narration that has been expanded.
  assert.deepEqual(cueTokens('the rate is 0.1'), ['the', 'rate', 'is', 'zero', 'point', 'one']);
  assert.deepEqual(cueTokens('α'), ['alpha']);
});

test('cues match verbatim, tolerate drift, and fail loudly when absent', () => {
  const stream = sceneTokenStream(
    timings([
      ['Feel which way is downhill,', 0, 2, 0, false],
      ['and take one small step that way.', 2.1, 4.5, 0, true],
    ]),
  ).map((t) => t.token);

  const exact = findCueSpan(stream, 'take one small step');
  assert.ok(exact);
  assert.equal(exact.score, 1);
  assert.equal(stream[exact.index], 'take');

  // A cue whose tail has drifted still anchors on its opening words.
  const loose = findCueSpan(stream, 'feel which way is downhill from here');
  assert.ok(loose);
  assert.equal(loose.index, 0);
  assert.ok(loose.score < 1);

  assert.equal(findCueSpan(stream, 'a completely unrelated phrase entirely'), undefined);
  assert.equal(findCueSpan(stream, ''), undefined);
});

/* ------------------------------------------------------------ cue resolution */

test('cue resolution places a known phrase at a plausible offset', () => {
  // Three measured phrases spanning a 9-second scene.
  const phrases = timings([
    ['You are on a foggy hillside.', 0, 2.8, 0, true],
    ['You cannot see the valley below.', 3.05, 6, 1, true],
    ['So you feel the ground and step downhill.', 6.25, 9, 2, true],
  ]);
  const s = scene(
    {
      narration: 'irrelevant — timings are supplied',
      elements: [
        cuedText('hill', 'You are on a foggy hillside', 0.9),
        cuedText('valley', 'You cannot see the valley below', 0.1),
        cuedText('step', 'feel the ground and step downhill', 0),
        cuedText('missing', 'this phrase was never spoken at all', 0.42),
      ],
    },
    0,
  );

  const { resolved, warnings } = resolveSceneCues(s, { phrases, narrationSec: 9 });

  const at = (id: string): number => s.elements.find((e) => e.id === id)!.enter.at;

  // Each cue lands inside the phrase that actually contains it.
  assert.ok(at('hill') * 9 < 2.8, `hill landed at ${at('hill') * 9}s`);
  assert.ok(
    at('valley') * 9 >= 3.05 && at('valley') * 9 < 6,
    `valley landed at ${at('valley') * 9}s`,
  );
  const stepSec = at('step') * 9;
  assert.ok(stepSec >= 6.25 && stepSec < 9, `step landed at ${stepSec}s`);
  // "feel" is the third of nine tokens in its phrase, so it should be early in it.
  assert.ok(stepSec < 7.5, `step should land near the start of its phrase, got ${stepSec}s`);

  // An unmatched cue warns, names the scene and the phrase, and changes nothing.
  assert.equal(at('missing'), 0.42, 'unmatched cue must leave enter.at untouched');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /this phrase was never spoken at all/);
  assert.match(warnings[0]!, /s1/);

  assert.equal(resolved.length, 3);
  for (const r of resolved) assert.equal(r.source, 'phrase');
  // Fractions are what the renderer consumes, and they must stay inside the scene.
  for (const el of s.elements) assert.ok(el.enter.at >= 0 && el.enter.at <= 1);
});

test('word timings win over phrase interpolation when they line up', () => {
  const phrases = timings([['the gradient points uphill so subtract it', 0, 4, 0, true]]);
  const words = [
    { word: 'the', start: 0.0, end: 0.2 },
    { word: 'gradient', start: 0.2, end: 0.7 },
    { word: 'points', start: 0.7, end: 1.1 },
    { word: 'uphill', start: 1.1, end: 1.7 },
    { word: 'so', start: 2.4, end: 2.6 },
    { word: 'subtract', start: 2.6, end: 3.3 },
    { word: 'it', start: 3.3, end: 3.6 },
  ];
  const s = scene({ narration: 'x', elements: [cuedText('minus', 'so subtract it')] }, 0);

  const { resolved } = resolveSceneCues(s, { phrases, narrationSec: 4, words });
  assert.equal(resolved[0]?.source, 'words');
  // Exactly the word's own start, not a proportional guess (which would be ~2.3s).
  assert.ok(Math.abs(resolved[0]!.offsetSec - 2.4) < 1e-6, `got ${resolved[0]!.offsetSec}s`);

  // A word list that disagrees with the token stream is ignored rather than trusted.
  const s2 = scene({ narration: 'x', elements: [cuedText('minus', 'so subtract it')] }, 0);
  const { resolved: fallback } = resolveSceneCues(s2, {
    phrases,
    narrationSec: 4,
    words: words.slice(0, 3),
  });
  assert.equal(fallback[0]?.source, 'phrase');
});

test('a scene with no measured narration reports its cues instead of guessing', () => {
  const s = scene({ narration: 'x', elements: [cuedText('a', 'anything at all', 0.5)] }, 0);
  const { resolved, warnings } = resolveSceneCues(s, { phrases: [], narrationSec: 0 });
  assert.equal(resolved.length, 0);
  assert.equal(s.elements[0]!.enter.at, 0.5);
  assert.equal(warnings.length, 1);
});

test('a missed cue on the dominant visual is structured, not just a warning line', () => {
  // The D5 shape the strict gate blocks on: the beat's MAIN picture keeps an authored
  // fallback time while its cue matches nothing. A decoration's miss stays a warning.
  const phrases = timings([
    ['That hill is really a graph.', 0, 3, 0, true],
    ['So draw it as a curve.', 3, 6, 1, true],
  ]);
  const plot: Element = {
    type: 'plot',
    id: 'curve',
    at: { x: 0, y: 100, w: 800, h: 400 },
    enter: { at: 0.1, cue: 'a phrase nobody ever says', duration: 1, style: 'draw' },
    persist: true,
    xDomain: [-2, 4],
    yDomain: [0, 15],
    axes: 'both',
    grid: false,
    ticks: false,
    curves: [],
    overlays: [],
  };
  const s = scene(
    {
      narration: 'x',
      elements: [cuedText('idea', 'also never spoken anywhere', 0.2), plot],
    },
    0,
  );
  const { warnings, dominantMisses } = resolveSceneCues(s, { phrases, narrationSec: 6 });
  assert.equal(warnings.length, 2, 'both misses warn');
  assert.deepEqual(dominantMisses, [{ elementId: 'curve', cue: 'a phrase nobody ever says' }]);
});

test("a beat's main picture is not held back to the last clause", () => {
  // Verification of the gradient-descent benchmark: the lesson cued the loss curve
  // on "so draw it as a curve", the closing clause, and the resolver honoured it —
  // eight seconds of a caption alone in an empty frame before the picture arrived.
  const phrases = timings([
    ['That hill is really a graph.', 0, 3, 0, true],
    ['Height is just a number that depends on where you stand.', 3, 7, 1, true],
    ['So draw it as a curve.', 7, 10, 2, true],
  ]);
  const plot: Element = {
    type: 'plot',
    id: 'curve',
    at: { x: 0, y: 100, w: 800, h: 400 },
    enter: { at: 0, cue: 'draw it as a curve', duration: 1, style: 'draw' },
    persist: true,
    xDomain: [-2, 4],
    yDomain: [0, 15],
    axes: 'both',
    grid: false,
    ticks: false,
    curves: [],
    overlays: [],
  };
  const s = scene(
    { narration: 'x', elements: [cuedText('idea', 'That hill is really a graph', 0), plot] },
    0,
  );
  const { warnings } = resolveSceneCues(s, { phrases, narrationSec: 10 });

  const at = (id: string): number => s.elements.find((e) => e.id === id)!.enter.at;
  assert.equal(at('curve'), MAX_DOMINANT_AT, `the picture landed at ${at('curve')}`);
  assert.match(warnings.join('\n'), /main picture/);

  // A text label is exempt: writing a line exactly as it is spoken is the feature.
  const s2 = scene(
    {
      narration: 'x',
      elements: [cuedText('label', 'draw it as a curve', 0), { ...plot, enter: { ...plot.enter } }],
    },
    0,
  );
  resolveSceneCues(s2, { phrases, narrationSec: 10 });
  assert.ok(
    s2.elements.find((e) => e.id === 'label')!.enter.at > 0.6,
    'a cued line of text still lands on its own words',
  );
});

test("a mover's cue anchors the movement, and the movement gets room to run", () => {
  // The benchmark's descending ball: cued on "the step is smaller" at 90% of the
  // narration, with a motion window still sitting at 0.46–0.94 from the planner. It
  // popped in already 91% of the way down the curve and never visibly moved.
  const phrases = timings([
    ['You are at three and the slope is plus four.', 0, 6, 0, true],
    ['Again, and the step is smaller.', 6, 10, 1, true],
  ]);
  const ball: Element = {
    type: 'path',
    id: 'ball',
    at: { x: 900, y: 500, w: 34, h: 34 },
    enter: { at: 0.2, cue: 'the step is smaller', duration: 0.5, style: 'pop' },
    persist: true,
    points: [
      { x: 900, y: 500 },
      { x: 934, y: 534 },
    ],
    closed: true,
    fill: true,
    weight: 1,
    motion: {
      path: [
        { x: 917, y: 517 },
        { x: 800, y: 640 },
      ],
      from: 0.46,
      to: 0.94,
      easing: 'ease-out',
      trail: true,
    },
  };
  const s = scene({ narration: 'x', elements: [ball] }, 0);
  resolveSceneCues(s, { phrases, narrationSec: 10 });

  const el = s.elements[0]!;
  const motion = el.motion!;
  // The ball is drawn before it travels, and it travels for long enough to be seen.
  assert.ok(el.enter.at < motion.from, `entered at ${el.enter.at}, moves from ${motion.from}`);
  // It is the only ink in the beat, so its *entry* is also held early enough that
  // the frame is not empty; only the movement waits for the words.
  assert.ok(el.enter.at <= MAX_DOMINANT_AT, `entered at ${el.enter.at}`);
  assert.ok(
    motion.to - motion.from >= MIN_TRAVEL,
    `window is only ${motion.to - motion.from} of the beat`,
  );
  assert.ok(motion.to <= 0.99, 'movement finishes inside the narration');
  // Cue-shaped: anchored as late as the phrase allows, not reset to the beat start.
  assert.ok(motion.from > 0.4, `movement starts at ${motion.from}`);
});

test('elements with no cue are left exactly as authored', () => {
  const plain: Element = {
    type: 'text',
    id: 'plain',
    text: 'x',
    role: 'body',
    align: 'left',
    at: { x: 0, y: 0, w: 10, h: 10 },
    enter: { at: 0.37, duration: 0.8, style: 'draw' },
    persist: true,
  };
  const s = scene({ narration: 'x', elements: [plain] }, 0);
  resolveSceneCues(s, { phrases: timings([['anything', 0, 1]]), narrationSec: 1 });
  assert.equal(s.elements[0]!.enter.at, 0.37);
});

/* ------------------------------------------------------------- speech bounds */

test('speech bounds find the speech and keep a guard so nothing is clipped', () => {
  const rate = CLIP_SAMPLE_RATE;
  const samples = new Float32Array(rate); // 1s
  // Speech from 0.4s to 0.6s only.
  for (let i = Math.round(0.4 * rate); i < Math.round(0.6 * rate); i++) {
    samples[i] = Math.sin(i / 12) * 0.5;
  }

  const { start, end } = findSpeechBounds(samples, rate, { guardSec: 0.04 });
  assert.ok(start > 0.3 * rate && start <= 0.4 * rate, `start ${start / rate}s`);
  assert.ok(end >= 0.6 * rate && end < 0.7 * rate, `end ${end / rate}s`);
  // The guard means the bounds always contain the speech, never trim into it.
  assert.ok(start <= Math.round(0.4 * rate));
  assert.ok(end >= Math.round(0.6 * rate));

  const trimmed = trimEdgeSilence(samples, rate);
  assert.ok(trimmed.length < samples.length);
  assert.ok(trimmed.length > 0.2 * rate);

  // Pure silence is never destroyed: a hold must survive analysis untouched.
  const quiet = new Float32Array(rate);
  assert.deepEqual(findSpeechBounds(quiet, rate), { start: 0, end: rate });
});

/* ------------------------------------------------------------ clip assembly */

test('hold is written as real trailing silence and excluded from durationSec', async () => {
  await withTempProject(async (dir) => {
    const rate = CLIP_SAMPLE_RATE;
    const tone = new Float32Array(Math.round(0.5 * rate));
    for (let i = 0; i < tone.length; i++) tone[i] = Math.sin(i / 10) * 0.4;

    const file = path.join(dir, 'clip.wav');
    const assembled = await writeClipFromParts(
      file,
      [
        { samples: tone, gapSec: 0.2 },
        { samples: tone, gapSec: 0 },
      ],
      { padSec: 0.1, holdSec: 0.8, sampleRate: rate },
    );

    // narration = 0.5 + 0.2 + 0.5 + 0.1 pad
    assert.ok(Math.abs(assembled.narrationSec - 1.3) < 1e-9, `${assembled.narrationSec}`);
    assert.ok(Math.abs(assembled.holdSec - 0.8) < 1e-9);
    assert.ok(Math.abs(assembled.totalSec - 2.1) < 1e-9);

    // The gap really is between the parts.
    assert.ok(Math.abs(assembled.spans[0]!.end - 0.5) < 1e-9);
    assert.ok(Math.abs(assembled.spans[1]!.start - 0.7) < 1e-9);

    // The file on disk agrees, and its tail is digital silence — not dead air
    // that happens to look like a pause, actual zeroes we chose to write.
    const measured = await measureDuration(file);
    assert.ok(Math.abs(measured - 2.1) < 0.01, `measured ${measured}s`);

    const samples = await readClipSamples(file);
    const holdFrom = Math.round(assembled.narrationSec * rate);
    assert.ok(samples.length - holdFrom >= Math.round(0.8 * rate) - 2);
    for (let i = holdFrom; i < samples.length; i++) {
      assert.equal(samples[i], 0, `sample ${i} inside the hold is not silent`);
    }
    // The second part occupies 0.7-1.2s and survives intact; the 0.1s pad after
    // it (1.2-1.3s) is silence, and so is the gap at 0.5-0.7s.
    assert.ok(
      Math.max(
        ...Array.from(samples.slice(Math.round(0.7 * rate), Math.round(1.2 * rate))).map(Math.abs),
      ) > 0.3,
      'the second part must survive intact',
    );
    for (const t of [0.6, 1.25]) {
      assert.ok(Math.abs(samples[Math.round(t * rate)] ?? 0) < 1e-6, `${t}s should be silent`);
    }
  });
});

test('narrate() renders Scene.hold as real silence the timeline can rely on', async () => {
  await withTempProject(async (dir) => {
    const sb = storyboard([
      { narration: 'A question deserves a pause so the learner can attempt it.', hold: 1.5 },
      { narration: 'Then the answer arrives.', hold: 0 },
    ]);

    const { storyboard: out } = await narrate(sb, dir, { provider: 'silence', padSec: 0 });
    const first = out.scenes[0]!;
    const clip = path.resolve(dir, sceneAudioPath(0));

    // durationSec is the narration only; the clip is narration + hold.
    const measured = await measureDuration(clip);
    assert.ok(
      Math.abs(measured - ((first.durationSec ?? 0) + first.hold)) < 0.02,
      `clip ${measured}s vs durationSec ${first.durationSec} + hold ${first.hold}`,
    );
    assert.ok(measured - (first.durationSec ?? 0) > 1.4, 'the hold must be in the file');

    // The whole track is the timeline core derives from durationSec + hold.
    const track = await measureDuration(path.resolve(dir, NARRATION_FILE));
    const expected =
      out.scenes.reduce((a, s) => a + (s.durationSec ?? 0) + s.hold, 0) + sb.meta.outroSec;
    assert.ok(Math.abs(track - expected) < 0.05, `track ${track}s vs timeline ${expected}s`);
  });
});

/* --------------------------------------------------- cue resolution, for real */

test('narrate() resolves a cue to a plausible offset and writes it into enter.at', async () => {
  await withTempProject(async (dir) => {
    const sb = storyboard([
      {
        narration:
          'You are on a foggy hillside. You cannot see the valley below. So you feel the ground and step downhill.',
        elements: [
          cuedText('hill', 'You are on a foggy hillside', 0.95),
          cuedText('step', 'feel the ground and step downhill', 0.0),
          cuedText('nope', 'a phrase that is nowhere in this narration', 0.5),
        ],
      },
    ]);

    const { storyboard: out } = await narrate(sb, dir, { provider: 'silence', padSec: 0 });
    const s = out.scenes[0]!;
    const dur = s.durationSec ?? 0;
    const at = (id: string): number => s.elements.find((e) => e.id === id)!.enter.at;

    assert.ok(dur > 3, `scene should be several seconds, got ${dur}`);

    // The opening cue moved from the author's 0.95 to the top of the scene.
    assert.ok(at('hill') < 0.2, `hill resolved to ${at('hill')}`);
    // The third sentence sits in the last third of the scene.
    assert.ok(at('step') > 0.55, `step resolved to ${at('step')}`);
    assert.ok(at('step') < 1);
    // Ordering is preserved, which is the property a viewer actually perceives.
    assert.ok(at('hill') < at('step'));
    // An unmatched cue is left alone rather than silently relocated.
    assert.equal(at('nope'), 0.5);

    // The timing sidecar exists so a cached re-run can resolve cues too.
    const sidecar = JSON.parse(await readFile(path.resolve(dir, sceneTimingPath(0)), 'utf8')) as {
      phrases: PhraseTiming[];
      narrationSec: number;
    };
    assert.equal(sidecar.phrases.length, 3);
    assert.ok(sidecar.phrases[2]!.start > sidecar.phrases[0]!.end);

    // A cached second pass reaches the same conclusion.
    const { storyboard: again } = await narrate(sb, dir, { provider: 'silence', padSec: 0 });
    assert.equal(again.scenes[0]!.elements.find((e) => e.id === 'step')!.enter.at, at('step'));
  });
});

test(
  'cue resolution survives real synthesised speech',
  { skip: darwin ? false : 'macOS `say` is only available on darwin' },
  async () => {
    await withTempProject(async (dir) => {
      const sb = storyboard([
        {
          narration:
            'The gradient tells you which way is uphill. So to go downhill you subtract it, and that is why the update has a minus sign.',
          elements: [cuedText('minus', 'that is why the update has a minus sign', 0)],
        },
      ]);

      const { storyboard: out } = await narrate(sb, dir, {
        provider: 'system',
        padSec: 0.2,
        align: 'off',
      });
      const s = out.scenes[0]!;
      const el = s.elements[0]!;
      const offset = el.enter.at * (s.durationSec ?? 0);

      // The cue is the tail of the narration, so it must land late but still
      // leave room to draw before the scene ends.
      assert.ok(el.enter.at > 0.5, `resolved to ${el.enter.at}`);
      assert.ok(el.enter.at < 0.99);
      assert.ok(offset < (s.durationSec ?? 0), 'must start before the scene ends');
    });
  },
);

/* ------------------------------------------------------------------- pacing */

test('the teaching voice is the measured winner, not the package default', () => {
  // The audit is in voices.ts; this pins its conclusion so a future edit to the
  // scoring has to be deliberate.
  assert.equal(TEACHING_VOICE, 'af_heart');
  const ranked = rankTeachingVoices();
  assert.equal(ranked[0]?.id, 'af_heart');
  assert.ok(teachingScore(voiceProfile('af_heart')!) > teachingScore(voiceProfile('bm_fable')!));
  // The breathy ASMR voice is slow but must not win on that alone.
  assert.ok(teachingScore(voiceProfile('af_heart')!) > teachingScore(voiceProfile('af_nicole')!));
  // Every profile is a real Kokoro voice.
  for (const p of KOKORO_VOICE_PROFILES) assert.ok(KOKORO_VOICES.includes(p.id as never), p.id);
});

test('speed is derived so every profiled voice lands in the teaching band', () => {
  for (const p of KOKORO_VOICE_PROFILES) {
    const speed = speedForWpm(p.id, 150);
    const predicted = p.baselineWpm * speed;
    // Voices that cannot reach the band without distortion are clamped at 0.7,
    // which is the honest outcome — not a silent miss.
    if (speed > 0.7) {
      assert.ok(
        predicted >= TEACHING_WPM_MIN - 1 && predicted <= TEACHING_WPM_MAX + 1,
        `${p.id}: ${predicted.toFixed(0)} wpm at speed ${speed}`,
      );
    }
    assert.ok(speed >= 0.7 && speed <= 1.2);
  }
  // The MVP's pace was 193 wpm; the default must be materially slower.
  assert.ok(speedForWpm('af_heart') < 0.85);
  assert.equal(speedForWpm('not-a-voice'), 1);
});

test('the `say` fallback is rate-calibrated, not taken at face value', () => {
  // Measured: `-r 89` speaks at 153.9 wpm, `-r 150` at 195.7. Reading the flag
  // as literal words-per-minute is what made the fallback run 30% too fast.
  assert.equal(sayRateForWpm(150), 89);
  assert.ok(sayRateForWpm(150) < 150, 'the calibration must slow `say` down, not speed it up');
  assert.ok(sayRateForWpm(140) < sayRateForWpm(160), 'monotonic in the target rate');
  assert.ok(sayRateForWpm(20) >= 30, 'clamped to a rate `say` accepts');
});

test('voice preferences narrow the pick without losing the ranking', () => {
  assert.equal(pickTeachingVoice({ accent: 'en-gb' }).id, 'bf_emma');
  assert.equal(pickTeachingVoice({ gender: 'male' }).id, 'am_michael');
  assert.equal(pickTeachingVoice({ accent: 'en-gb', gender: 'male' }).accent, 'en-gb');
});

/* ---------------------------------------------------------------- alignment */

test('alignment mode resolves from options and env, defaulting to auto', () => {
  assert.equal(requestedAlign(), 'auto');
  assert.equal(requestedAlign('off'), 'off');
  assert.equal(requestedAlign('whisper'), 'whisper');
  assert.equal(requestedAlign('nonsense'), 'auto');
});

test('whisper chunks map onto our own tokens, monotonically', () => {
  const hypothesis = hypothesisFromChunks({
    chunks: [
      { text: ' The', timestamp: [0, 0.58] },
      { text: ' gradient', timestamp: [0.58, 0.96] },
      { text: ' points', timestamp: [0.96, 1.5] },
      { text: ' uphill.', timestamp: [1.5, 2.1] },
    ],
  });
  assert.equal(hypothesis.length, 4);

  // The aligner heard "points" where we asked for "goes": the unmatched token is
  // still timed, from the gap it occupies — and the fraction says one of four
  // tokens was interpolated rather than matched.
  const { words, fraction } = mapToExpected(['the', 'gradient', 'goes', 'uphill'], hypothesis);
  assert.equal(words.length, 4);
  assert.equal(fraction, 0.75);
  assert.equal(words[0]!.start, 0);
  assert.ok(Math.abs(words[1]!.start - 0.58) < 1e-9);
  assert.ok(words[2]!.start >= words[1]!.end - 1e-9, 'timings must not go backwards');
  assert.ok(Math.abs(words[3]!.start - 1.5) < 1e-9);
  for (let i = 1; i < words.length; i++) assert.ok(words[i]!.start >= words[i - 1]!.start);

  assert.deepEqual(mapToExpected([], hypothesis), { words: [], fraction: 0 });
  assert.deepEqual(mapToExpected(['a'], []), { words: [], fraction: 0 });
  assert.deepEqual(hypothesisFromChunks({ text: 'no chunks here' }), []);
});

test('an alignment that matched almost nothing reports its fraction, not fake exactness', () => {
  // Align text A against a transcript of text B: the edit-distance pairing finds
  // (nearly) nothing, and every timing would be interpolation between the clip's
  // endpoints wearing real-looking numbers — the audit's D8. The fraction is what
  // lets the aligner discard it so the measured-phrase fallback engages.
  const hypothesis = hypothesisFromChunks({
    chunks: [
      { text: ' Mitochondria', timestamp: [0, 0.7] },
      { text: ' synthesise', timestamp: [0.7, 1.3] },
      { text: ' adenosine', timestamp: [1.3, 1.9] },
      { text: ' triphosphate.', timestamp: [1.9, 2.6] },
    ],
  });
  const { words, fraction } = mapToExpected(
    ['the', 'gradient', 'points', 'downhill', 'from', 'here'],
    hypothesis,
  );
  // One timing per expected token by construction — which is exactly why the
  // count check alone was vacuous — but the fraction exposes the interpolation.
  assert.equal(words.length, 6);
  assert.ok(fraction < 0.5, `paired fraction ${fraction} should be under the honesty floor`);
});

/* ------------------------------------------------------------------- pacing */

test('a punchy beat is measurably faster than a slow_deliberate one', async () => {
  // The acceptance bar for the script stage, measured on assembled audio rather than
  // on the plan. Identical words in both scenes, so the only difference is delivery.
  const words =
    'The slope under your feet tells you which way the ground falls away, and that ' +
    'is the only thing you need in order to take a sensible step downhill.';

  await withTempProject(async (dir) => {
    const sb = storyboard([
      { narration: words, cadence: 'punchy' },
      { narration: words, cadence: 'slow_deliberate' },
      { narration: words },
    ]);
    const { storyboard: out } = await narrate(sb, dir, { provider: 'silence', padSec: 0 });

    const [punchy = 0, slow = 0, plain = 0] = out.scenes.map((s) => s.durationSec ?? 0);
    assert.ok(punchy > 0 && slow > 0 && plain > 0);

    // Faster is shorter, for the same words. The margin is the 140-vs-160 wpm the
    // cadence table sets, so it is real but deliberately not dramatic — this is a
    // change of delivery, not of speed-reading.
    assert.ok(slow > punchy, `slow ${slow.toFixed(2)}s must exceed punchy ${punchy.toFixed(2)}s`);
    const ratio = slow / punchy;
    assert.ok(ratio > 1.1 && ratio < 1.2, `expected ~1.14x, measured ${ratio.toFixed(3)}x`);

    // An uncadenced scene sits between them, because it uses the global target rate.
    assert.ok(plain > punchy && plain < slow, `plain ${plain.toFixed(2)}s must sit between`);
  });
});

test('cadence changes the audio, so it changes the cache key', async () => {
  // Re-pacing a lesson has to re-synthesise it. A cadence that was not in the key
  // would leave the old clip on disk and look like the change had no effect.
  await withTempProject(async (dir) => {
    const words = 'One idea per scene keeps the board readable enough to follow along.';
    const { storyboard: first } = await narrate(
      storyboard([{ narration: words, cadence: 'punchy' }]),
      dir,
      { provider: 'silence', padSec: 0 },
    );
    const { storyboard: second } = await narrate(
      storyboard([{ narration: words, cadence: 'slow_deliberate' }]),
      dir,
      { provider: 'silence', padSec: 0 },
    );
    assert.ok(
      (second.scenes[0]!.durationSec ?? 0) > (first.scenes[0]!.durationSec ?? 0),
      're-pacing reused the cached clip instead of re-synthesising',
    );
  });
});

test('an emphasised phrase is given more room than the same words unemphasised', async () => {
  // Emphasis is time, not volume: no local voice takes SSML, so the phrase carrying
  // the weight is slowed and given a beat after it — which is what a person does.
  await withTempProject(async (dir) => {
    const words = 'The slope points uphill. We want to go down, so we subtract it.';
    const sb = storyboard([
      { narration: words },
      { narration: words, emphasis: ['points uphill'] },
    ]);
    const { storyboard: out } = await narrate(sb, dir, { provider: 'silence', padSec: 0 });

    const [plain = 0, stressed = 0] = out.scenes.map((s) => s.durationSec ?? 0);
    assert.ok(
      stressed > plain,
      `emphasised ${stressed.toFixed(2)}s must exceed plain ${plain.toFixed(2)}s`,
    );
    // Small on purpose. This lands on a clause, so a heavy hand drags a sentence
    // rather than stressing a word.
    assert.ok(stressed - plain < 0.6, `emphasis added ${(stressed - plain).toFixed(2)}s`);
  });
});

/* ------------------------------------------------------------- initialisms */

test('an initialism is spoken as letters, not mumbled as a word', () => {
  // The bug this fixes was audible: the narrator said "ATP" as a syllable, and since
  // the board never writes the letters either, a listener had no way to recover what
  // was meant. Technical narration is full of these and every one is unintelligible
  // spoken as a blob.
  assert.equal(normalizeNarration('Stored in ATP.'), 'Stored in ay tee pee.');
  assert.equal(normalizeNarration('And NADPH.'), 'And en ay dee pee aitch.');
  // Digits inside an initialism are said, not spelled as letters.
  assert.equal(normalizeNarration('It makes G3P.'), 'It makes gee three pee.');
  assert.equal(normalizeNarration('Plants absorb CO2.'), 'Plants absorb see oh two.');
});

test('case carries meaning, and survives the sentence-caser', () => {
  // `tidy` capitalises the first letter of every sentence, which used to turn `mRNA`
  // into `MRNA` — destroying the one signal that says how to read it. Expansion has to
  // happen before that, and a single lowercase lead is enough to mark an initialism.
  assert.equal(normalizeNarration('mRNA is not DNA.'), 'Em are en ay is not dee en ay.');
  assert.equal(normalizeNarration('Measure the pH.'), 'Measure the pee aitch.');
  assert.match(normalizeNarration('mRNA carries it.'), /^Em are en ay/);
});

test('acronyms said as words, and shouted words, are left alone', () => {
  // Spelling is the default because unknown capitals are far more likely to be
  // technical initialisms in explanatory narration. These are the exceptions, and the
  // second group is the false positive that would actually hurt: a model that writes
  // "this is NOT the minimum" must not have it read out as "en oh tee".
  assert.equal(normalizeNarration('NASA used radar.'), 'NASA used radar.');
  assert.equal(normalizeNarration('This is NOT the minimum.'), 'This is NOT the minimum.');
  assert.equal(speakInitialisms('World War II ended.'), 'World War II ended.');
  // An ordinary capitalised word is never an initialism: it takes two capitals.
  assert.equal(speakInitialisms('The Calvin cycle turns.'), 'The Calvin cycle turns.');
});

test('a cue containing an initialism still finds its words', () => {
  // Both sides of cue matching run through the same normalisation, so expanding the
  // narration cannot silently orphan a cue that quotes it. This is the regression the
  // change could plausibly have caused.
  const narration = 'The energy is stored in ATP and NADPH, made in the light stage.';
  const spoken = matchTokens(normalizeNarration(narration));
  const span = findCueSpan(spoken, 'stored in ATP');
  assert.ok(span, 'the cue no longer locates in its own narration');
  assert.equal(span.score, 1, 'it should still be an exact match, not a salvaged prefix');
  // And the expansion is what it matched against, not the raw letters.
  assert.deepEqual(spoken.slice(span.index, span.index + span.length), [
    'stored',
    'in',
    'ay',
    'tee',
    'pee',
  ]);
});

test('the provider chain puts a paid key first, and a pin puts it back', () => {
  // `active()` walks this order and Kokoro is always available, so the order *is* the
  // decision. Local-first meant an ElevenLabs key was never reached.
  assert.deepEqual(defaultChain({}), ['kokoro', 'system', 'elevenlabs', 'silence']);
  assert.deepEqual(defaultChain({ ELEVENLABS_API_KEY: 'el' } as NodeJS.ProcessEnv), [
    'elevenlabs',
    'kokoro',
    'system',
    'silence',
  ]);
  // Kokoro stays directly behind the cloud, so an outage demotes to a real voice.
  assert.equal(defaultChain({ ELEVENLABS_API_KEY: 'el' } as NodeJS.ProcessEnv)[1], 'kokoro');

  // A pin overrides the environment, and the provider still gets a bare voice id.
  assert.equal(pinnedProvider('kokoro:af_heart'), 'kokoro');
  assert.equal(pinnedProvider('local:af_heart'), 'kokoro');
  assert.equal(pinnedProvider('elevenlabs:Rachel'), 'elevenlabs');
  assert.equal(pinnedProvider('say'), 'system');
  assert.equal(pinnedProvider('af_heart'), undefined, 'a voice name is not a provider');
  assert.equal(bareVoiceId('kokoro:af_heart'), 'af_heart');
  assert.equal(bareVoiceId('af_heart'), 'af_heart');
  assert.equal(bareVoiceId('say'), 'say');
});

test('the pause after a sentence is graduated by what the sentence was', () => {
  // Five lengths, and the reason is a viewer's: 35 identical 0.24s pauses in two minutes
  // reads as a machine. Measured on the same lesson, the graduated scale spends slightly
  // less total silence across five distinct lengths.
  const gap = (text: string): number => {
    const ps = splitPhrases(normalizeNarration(`${text} And then something else follows it.`));
    const i = ps.findIndex((p) => p.endsSentence);
    return gapAfter(ps[i]!, ps[i + 1]!);
  };
  const short = gap('You have no map.');
  const ordinary = gap('The slope under your feet tells you which way is down.');
  const landing = gap(
    'The slope only describes the ground right where you stand, so you shrink the move first.',
  );
  const question = gap('So how do you get down?');
  assert.ok(short < ordinary, 'a four-word line should not stop like a sentence');
  assert.equal(ordinary, SENTENCE_GAP_SEC, 'an ordinary sentence keeps the ordinary gap');
  assert.ok(landing > ordinary, 'a long sentence has more to land');
  assert.ok(question > landing, 'a question gets the most room of all');
  assert.ok(short > PHRASE_GAP_SEC, 'a sentence end is still audible');
});
