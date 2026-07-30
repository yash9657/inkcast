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

import { narrate, sceneAudioPath, sceneTimingPath, NARRATION_FILE } from './narrate.js';
import { measureDuration, readClipSamples, writeClipFromParts } from './audio.js';
import {
  readWavInfo,
  encodeWav,
  silenceWav,
  findSpeechBounds,
  trimEdgeSilence,
  CLIP_SAMPLE_RATE,
} from './wav.js';
import {
  normalizeNarration,
  numberToWords,
  ordinalToWords,
  splitSentences,
  stripMarkdown,
  yearToWords,
} from './text.js';
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
import { alignmentToWords } from './providers/elevenlabs.js';
import { chunkForKokoro, KOKORO_VOICES } from './providers/kokoro.js';
import type { Element, Scene, Storyboard } from '@inkcast/core';

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
  assert.match(
    normalizeNarration('Inkcast - an open compiler - is free.'),
    /Inkcast, an open compiler, is free/,
  );
  // A unit attached to a range must survive the range rule.
  assert.match(normalizeNarration('It ranged 10-20 °C.'), /ten to twenty degrees Celsius/);
  // Scientific notation and powers.
  assert.match(normalizeNarration('Stop below 1e-3.'), /one times ten to the power of minus three/);
  assert.match(normalizeNarration('Minimise x^2 + y^2.'), /x squared plus y squared/i);
  // Hyphenated dimensions are not a range, and are not a year either.
  assert.match(
    normalizeNarration('A 2048-dimensional vector.'),
    /two thousand forty eight dimensional/,
  );
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
  assert.equal(plain.includes(']('), false);
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

    const out = await narrate(sb, dir, { provider: 'silence', padSec: 0 });
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

    const out = await narrate(sb, dir, { provider: 'silence', padSec: 0 });
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
    const again = await narrate(sb, dir, { provider: 'silence', padSec: 0 });
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

      const out = await narrate(sb, dir, { provider: 'system', padSec: 0.2, align: 'off' });
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
  // still timed, from the gap it occupies.
  const words = mapToExpected(['the', 'gradient', 'goes', 'uphill'], hypothesis);
  assert.equal(words.length, 4);
  assert.equal(words[0]!.start, 0);
  assert.ok(Math.abs(words[1]!.start - 0.58) < 1e-9);
  assert.ok(words[2]!.start >= words[1]!.end - 1e-9, 'timings must not go backwards');
  assert.ok(Math.abs(words[3]!.start - 1.5) < 1e-9);
  for (let i = 1; i < words.length; i++) assert.ok(words[i]!.start >= words[i - 1]!.start);

  assert.deepEqual(mapToExpected([], hypothesis), []);
  assert.deepEqual(mapToExpected(['a'], []), []);
  assert.deepEqual(hypothesisFromChunks({ text: 'no chunks here' }), []);
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
    const out = await narrate(sb, dir, { provider: 'silence', padSec: 0 });

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
    const first = await narrate(storyboard([{ narration: words, cadence: 'punchy' }]), dir, {
      provider: 'silence',
      padSec: 0,
    });
    const second = await narrate(
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
    const out = await narrate(sb, dir, { provider: 'silence', padSec: 0 });

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
