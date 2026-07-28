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

import { narrate, sceneAudioPath, NARRATION_FILE } from './narrate.js';
import { measureDuration } from './audio.js';
import { readWavInfo, encodeWav, silenceWav, CLIP_SAMPLE_RATE } from './wav.js';
import {
  normalizeNarration,
  numberToWords,
  ordinalToWords,
  splitSentences,
  stripMarkdown,
  yearToWords,
} from './text.js';
import { parseSayVoices, pickSayVoice } from './providers/system.js';
import { alignmentToWords } from './providers/elevenlabs.js';
import { chunkForKokoro, KOKORO_VOICES } from './providers/kokoro.js';
import type { Storyboard } from '@inkcast/core';

/* ------------------------------------------------------------------ fixtures */

function storyboard(narrations: string[]): Storyboard {
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
    scenes: narrations.map((narration, i) => ({
      id: `s${i + 1}`,
      narration,
      camera: { x: 960, y: 540, zoom: 1, transition: 0.9 },
      elements: [],
    })),
  };
}

async function withTempProject<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'inkcast-voice-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------- text: numbers */

test('numberToWords covers the scale boundaries', () => {
  assert.equal(numberToWords(0), 'zero');
  assert.equal(numberToWords(7), 'seven');
  assert.equal(numberToWords(19), 'nineteen');
  assert.equal(numberToWords(42), 'forty two');
  assert.equal(numberToWords(100), 'one hundred');
  assert.equal(numberToWords(305), 'three hundred five');
  assert.equal(numberToWords(1000), 'one thousand');
  assert.equal(numberToWords(1234), 'one thousand two hundred thirty four');
  assert.equal(numberToWords(2_500_000), 'two million five hundred thousand');
  assert.equal(numberToWords(-3), 'minus three');
});

test('ordinals and years read the way people say them', () => {
  assert.equal(ordinalToWords(1), 'first');
  assert.equal(ordinalToWords(3), 'third');
  assert.equal(ordinalToWords(20), 'twentieth');
  assert.equal(ordinalToWords(22), 'twenty second');
  assert.equal(yearToWords(1999), 'nineteen ninety nine');
  assert.equal(yearToWords(2000), 'two thousand');
  assert.equal(yearToWords(2005), 'two thousand five');
  assert.equal(yearToWords(2026), 'twenty twenty six');
  assert.equal(yearToWords(1905), 'nineteen oh five');
});

/* --------------------------------------------------------- text: the pipeline */

test('normalizeNarration makes money, multipliers and abbreviations speakable', () => {
  const text = normalizeNarration('It costs $5 and runs 3x faster, e.g. on a laptop.');
  assert.match(text, /five dollars/);
  assert.match(text, /three times/);
  assert.match(text, /for example/);
  assert.doesNotMatch(text, /\$/);
  assert.doesNotMatch(text, /\d/);
  assert.doesNotMatch(text, /e\.g\./);
});

test('normalizeNarration handles cents, percentages and units', () => {
  assert.match(normalizeNarration('It is $5.50 today.'), /five dollars and fifty cents/);
  assert.match(normalizeNarration('Only $0.99!'), /ninety nine cents/);
  assert.match(normalizeNarration('Accuracy hit 92%.'), /ninety two percent/);
  assert.match(normalizeNarration('It took 250 ms.'), /two hundred fifty milliseconds/);
  assert.match(normalizeNarration('We store 4GB of weights.'), /four gigabytes/);
  assert.match(normalizeNarration('That is $1.2M in revenue.'), /one point two million dollars/);
});

test('normalizeNarration handles the notation an explainer video actually contains', () => {
  // Arithmetic minus vs. a dash used as a pause.
  assert.match(normalizeNarration('Then w = w - lr * grad.'), /w equals w minus lr times grad/);
  assert.match(normalizeNarration('Inkcast - an open compiler - is free.'), /Inkcast, an open compiler, is free/);
  // A unit attached to a range must survive the range rule.
  assert.match(normalizeNarration('It ranged 10-20 °C.'), /ten to twenty degrees Celsius/);
  // Scientific notation and powers.
  assert.match(normalizeNarration('Stop below 1e-3.'), /one times ten to the power of minus three/);
  assert.match(normalizeNarration('Minimise x^2 + y^2.'), /x squared plus y squared/i);
  // Hyphenated dimensions are not a range, and are not a year either.
  assert.match(normalizeNarration('A 2048-dimensional vector.'), /two thousand forty eight dimensional/);
});

test('normalizeNarration speaks maths symbols instead of skipping them', () => {
  const text = normalizeNarration('The gradient ∇f ≈ 0 means θ is optimal, and x^2 grows.');
  assert.match(text, /gradient/);
  assert.match(text, /approximately/);
  assert.match(text, /theta/);
  assert.match(text, /squared/);
});

test('markdown is stripped down to prose with real sentence punctuation', () => {
  const md = [
    '# Gradient Descent',
    '',
    'An _iterative_ optimisation algorithm with a `learning_rate`.',
    '',
    '- Compute the gradient',
    '- Step downhill',
    '',
    '```',
    'w = w - lr * grad',
    '```',
    '',
    'See [the docs](https://example.com/docs).',
  ].join('\n');

  const plain = stripMarkdown(md);
  assert.equal(plain.includes('#'), false);
  assert.equal(plain.includes('```'), false);
  assert.equal(plain.includes('](' ), false);
  assert.match(plain, /Gradient Descent\./);
  assert.match(plain, /iterative optimisation algorithm/);
  assert.match(plain, /Compute the gradient\. Step downhill\./);
  assert.match(plain, /See the docs\./);
});

test('sentence splitting survives decimals, initials and abbreviations', () => {
  assert.deepEqual(splitSentences('One. Two! Three?'), ['One.', 'Two!', 'Three?']);
  assert.deepEqual(splitSentences('Pi is 3.14 exactly.'), ['Pi is 3.14 exactly.']);
  assert.equal(splitSentences('Ask J. Smith about it. Then go.').length, 2);
  assert.equal(splitSentences('').length, 0);
});

test('every normalised sentence ends in terminal punctuation', () => {
  const text = normalizeNarration('first thought\n\nsecond thought');
  for (const sentence of splitSentences(text)) {
    assert.match(sentence, /[.!?]$/, `"${sentence}" has no terminator`);
  }
});

test('normalisation is deterministic, so it is safe as a cache key', () => {
  const input = '## Step 1\n\nRun it **10x** faster for $2.50, i.e. cheaply.';
  assert.equal(normalizeNarration(input), normalizeNarration(input));
});

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
  assert.equal(chunks.join(' ').replace(/\s+/g, ' '), sentence.repeat(12).trim().replace(/\s+/g, ' '));
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
      const out = await narrate(sb, dir, {
        provider: 'system',
        padSec: 0.2,
        onProgress: (p) => progress.push(p.pct),
      });

      // Progress is reported and monotonic, ending at 100.
      assert.ok(progress.length >= 3);
      assert.equal(progress.at(-1), 100);
      assert.deepEqual(progress, [...progress].sort((a, b) => a - b));

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

      const first = await narrate(sb, dir, { provider: 'system', padSec: 0 });
      const clip = path.resolve(dir, sceneAudioPath(0));
      const before = await stat(clip);

      const second = await narrate(sb, dir, { provider: 'system', padSec: 0 });
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

    const out = await narrate(sb, dir, { provider: 'silence', padSec: 0 });

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
    const out = await narrate(storyboard(['   \n\n  ']), dir, { provider: 'silence', padSec: 0.3 });
    const scene = out.scenes[0]!;
    assert.ok((scene.durationSec ?? 0) > 0, 'durationSec must stay positive for the IR');
    assert.equal(scene.audioPath, sceneAudioPath(0));
  });
});

test('narrate() enriches a copy and leaves the input storyboard untouched', async () => {
  await withTempProject(async (dir) => {
    const sb = storyboard(['Stages enrich the storyboard, they do not reshape it.']);
    const out = await narrate(sb, dir, { provider: 'silence', padSec: 0 });
    assert.equal(sb.scenes[0]?.durationSec, undefined);
    assert.equal(sb.scenes[0]?.audioPath, undefined);
    assert.ok(out.scenes[0]?.durationSec);
  });
});
