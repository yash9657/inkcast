/**
 * What a run is allowed to be billed for.
 *
 * These are pins on a defect with a number attached: `projects/cardiac8/pipeline.json`
 * records a $0.4286 voice line for 1,948 characters that were spoken by the free local
 * engine, because the cost input was the provider the environment *asked for* rather
 * than the one that spoke. Every case here is that same 1,948 characters, priced from
 * a different resolved provider.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Storyboard } from '@inkcast/core';
import { costOf } from '../src/cost.js';
import {
  billedVoiceChoice,
  providers,
  resolvedVoiceChoice,
  voiceProvider,
} from '../src/providers.js';

/** The cardiac script's length, from the recorded run. */
const CARDIAC_CHARS = 1948;

/** One scene long enough that `perMinuteUsd` is a real division. */
function board(): Storyboard {
  return {
    version: 1,
    title: 'Cost fixture',
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
        id: 's1',
        narration: 'One scene, ninety seconds of it.',
        camera: { x: 960, y: 540, zoom: 1, transition: 0.9 },
        elements: [],
        hold: 0,
        emphasis: [],
        durationSec: 90,
      },
    ],
  };
}

/** A keyed environment: the case where a wrong answer costs money. */
const KEYED: NodeJS.ProcessEnv = { ELEVENLABS_API_KEY: 'sk_test', PATH: process.env.PATH };

function bill(
  resolved: { provider: string; model?: string; voice: string },
  chars = CARDIAC_CHARS,
) {
  const requested = voiceProvider('af_heart', KEYED);
  return costOf(board(), {
    providers: {
      ...providers('af_heart', KEYED),
      voice: resolvedVoiceChoice(resolved, requested),
    },
    sourceChars: 0,
    storyboardChars: 0,
    narratedChars: chars,
  });
}

test('a manifest that says kokoro bills zero, however many characters it spoke', () => {
  // The environment asked for the paid provider — the key is set and `voiceProvider`
  // says `cloud: true` — and the free one answered.
  assert.equal(voiceProvider('af_heart', KEYED).cloud, true);

  const report = bill({
    provider: 'kokoro',
    model: 'onnx-community/Kokoro-82M-v1.0-ONNX',
    voice: 'af_heart',
  });
  assert.deepEqual(
    report.lines.filter((l) => l.stage === 'voice'),
    [],
    'a local voice may not produce a cost line at all',
  );
  assert.equal(report.usd, 0);
  assert.equal(report.local, true);
});

test('flash bills half of what the recorded cardiac run was charged', () => {
  const v2 = bill({ provider: 'elevenlabs', model: 'eleven_multilingual_v2', voice: 'Rachel' });
  const flash = bill({ provider: 'elevenlabs', model: 'eleven_flash_v2_5', voice: 'Rachel' });

  // The number in projects/cardiac8/pipeline.json, reproduced to the cent.
  assert.equal(v2.lines.find((l) => l.stage === 'voice')?.usd, 0.4286);
  assert.equal(flash.lines.find((l) => l.stage === 'voice')?.usd, 0.2143);

  const line = flash.lines.find((l) => l.stage === 'voice');
  assert.equal(line?.provider, 'elevenlabs/eleven_flash_v2_5');
  assert.match(line?.basis ?? '', /0\.5 credits\/char/);
});

test('an unknown model is billed at the full rate', () => {
  // A pricing table that silently discounts what it does not recognise fails in the
  // direction nobody notices until the invoice arrives.
  const report = bill({ provider: 'elevenlabs', model: 'eleven_something_new', voice: 'Rachel' });
  assert.equal(report.lines.find((l) => l.stage === 'voice')?.usd, 0.4286);
});

test('the resolved choice says who spoke and why it differs from the request', () => {
  const requested = voiceProvider('af_heart', KEYED);
  const fell = resolvedVoiceChoice(
    { provider: 'kokoro', model: 'kokoro-82m', voice: 'af_heart' },
    requested,
  );
  assert.equal(fell.cloud, false);
  assert.equal(fell.name, 'kokoro');
  assert.equal(fell.why, 'requested elevenlabs, resolved to kokoro');

  // When the request was honoured, the original reason is kept rather than reworded.
  const kept = resolvedVoiceChoice(
    { provider: 'elevenlabs', model: 'eleven_flash_v2_5', voice: 'Rachel' },
    requested,
  );
  assert.equal(kept.cloud, true);
  assert.equal(kept.why, requested.why);
  assert.equal(kept.model, 'eleven_flash_v2_5');

  // The system voice reports under the name the rest of the pipeline speaks.
  assert.equal(
    resolvedVoiceChoice({ provider: 'system', voice: 'Samantha' }, requested).name,
    'say',
  );

  // A provider that named no engine leaves the slot empty. Filling it from the voice id
  // is how every keyed project on disk came to record `elevenlabs/af_heart` — a voice
  // where a model belongs — while the terminal, which prints the engine or nothing,
  // said plain `elevenlabs` for the same run.
  const unnamed = resolvedVoiceChoice({ provider: 'elevenlabs', voice: 'af_heart' }, requested);
  assert.equal(unnamed.model, undefined);
  assert.equal(`${unnamed.name}${unnamed.model ? `/${unnamed.model}` : ''}`, 'elevenlabs');
});

test('a run that ran out of credits half way through is still billed for the half it spent', () => {
  // Exhaustion is discovered at the first request that fails, so the scenes before it
  // were spoken by the paid provider and really were charged. Billing only the
  // provider that finished would under-state that run to zero.
  const requested = voiceProvider('af_heart', KEYED);
  // The engine comes from `ResolvedVoice.modelByProvider`, keyed by the provider that
  // spent the money — `model` on the resolved choice is Kokoro's, because Kokoro is who
  // finished.
  const resolved = {
    provider: 'kokoro',
    model: 'onnx-community/Kokoro-82M-v1.0-ONNX',
    voice: 'af_heart',
  };
  const choice = billedVoiceChoice(resolved, 900, requested, 'eleven_flash_v2_5');
  assert.equal(choice.cloud, true);
  assert.equal(choice.name, 'elevenlabs');
  assert.match(
    choice.why,
    /900 characters were spoken by elevenlabs before it fell back to kokoro/,
  );
  assert.equal(choice.model, 'eleven_flash_v2_5');

  const usdFor = (voice: ReturnType<typeof billedVoiceChoice>) =>
    costOf(board(), {
      providers: { ...providers('af_heart', KEYED), voice },
      sourceChars: 0,
      storyboardChars: 0,
      narratedChars: 900,
    }).lines.find((l) => l.stage === 'voice')?.usd;

  // 900 × 0.5 credits × $0.00022. The engine was measured and the paid half of the run
  // is charged at what it really cost; billing the same run without it charged $0.198,
  // which is the full-credit rate — double, on precisely the scenario this path exists
  // for.
  assert.equal(usdFor(choice), 0.099);
  assert.equal(usdFor(billedVoiceChoice(resolved, 900, requested)), 0.198);

  // And a run where nothing was billed to the cloud is untouched by any of this.
  assert.equal(
    billedVoiceChoice({ provider: 'kokoro', voice: 'af_heart' }, 0, requested).cloud,
    false,
  );
});

test('nothing synthesised is nothing billed, even on the paid provider', () => {
  const report = bill({ provider: 'elevenlabs', model: 'eleven_flash_v2_5', voice: 'Rachel' }, 0);
  assert.deepEqual(
    report.lines.filter((l) => l.stage === 'voice'),
    [],
  );
});

/* ------------------------------------------- the drawing lane's own bill (3.5) */

/**
 * The lane that used to be free by construction.
 *
 * `projects/cardiac8f` is the film these numbers are shaped like: twelve drawings, each
 * composed by Opus and five of them looked at again by the critic. None of that touched
 * a quantity the pipeline could see from outside the lesson stage, so the report showed
 * a lesson line, a voice line, and nothing at all for the expensive half of the run.
 */
const LOCAL: NodeJS.ProcessEnv = { PATH: process.env.PATH };

function drawn(spend: Parameters<typeof costOf>[1]['spend']) {
  return costOf(board(), {
    providers: providers('af_heart', LOCAL),
    sourceChars: 0,
    storyboardChars: 0,
    narratedChars: 0,
    spend,
  });
}

test('the drawing lane is billed from the tokens the API reported, not from characters', () => {
  const report = drawn([
    {
      lane: 'drawing',
      provider: 'anthropic',
      model: 'claude-opus-5',
      inTokens: 4000,
      outTokens: 2000,
    },
    {
      lane: 'drawing',
      provider: 'anthropic',
      model: 'claude-opus-5',
      inTokens: 6000,
      outTokens: 3000,
    },
  ]);
  const line = report.lines.find((l) => l.stage === 'drawing');
  assert.ok(line, 'two composed drawings must produce a drawing line');
  // Two calls, summed into one line: 10k in at $5/MTok + 5k out at $25/MTok.
  assert.equal(line.usd, 0.175);
  assert.match(line.basis, /2 calls, 10000 in \+ 5000 out tokens as reported by the API/);
  // The one place in this file where a quantity is not a guess, and it says so.
  assert.equal(line.estimated, false);
  assert.equal(report.local, false);
});

test('the critic is a lane of its own, so what looking at the render costs is answerable', () => {
  const report = drawn([
    {
      lane: 'drawing',
      provider: 'anthropic',
      model: 'claude-opus-5',
      inTokens: 4000,
      outTokens: 2000,
    },
    {
      lane: 'drawing-fix',
      provider: 'anthropic',
      model: 'claude-opus-5',
      inTokens: 9000,
      outTokens: 2000,
    },
  ]);
  const author = report.lines.find((l) => l.stage === 'drawing');
  const critic = report.lines.find((l) => l.stage === 'drawing-fix');
  assert.ok(author && critic, 'the two halves of the lane are priced separately');
  // The correction is the more expensive call per picture — it sends the render.
  assert.ok(critic.usd > author.usd);
  // And the total moves when a drawing is corrected, which is 3.5's done-bar.
  const uncorrected = drawn([
    {
      lane: 'drawing',
      provider: 'anthropic',
      model: 'claude-opus-5',
      inTokens: 4000,
      outTokens: 2000,
    },
  ]);
  assert.ok(report.usd > uncorrected.usd);
});

test('a generated underlay is billed once and a cached one is free', () => {
  const paid = drawn([{ lane: 'underlay', provider: 'fal', images: 1 }]);
  const line = paid.lines.find((l) => l.stage === 'underlay');
  assert.ok(line);
  assert.match(line.basis, /1 image generated/);
  // Cache hits never reach this channel at all — `illustrationRaster` reports a spend only
  // where it really calls a provider — so an empty tally is a free run and not a missing
  // measurement.
  assert.equal(drawn([]).local, true);
  assert.equal(drawn(undefined).local, true);
});

/* --------------------------------------------- the image lane's own bill (X-e) */

/** A run with an image key set: `images.cloud` is true and drew nothing. */
const IMAGE_KEYED: NodeJS.ProcessEnv = { FAL_KEY: 'fal_test', PATH: process.env.PATH };

test('a configured image key is not evidence that an image was drawn', () => {
  // The defect this replaces: `generatedAssets` counted assets the finished board marked
  // `generated`, which describes where a picture came from *originally* and stays true on
  // every later run that serves it from a cache. `projects/qc64-hashmap` measures four such
  // assets, zero provider calls, the machine cache unchanged at 42 files afterwards — and
  // `visuals fal $0.0120` on the report. There is no board-derived image line any more, so
  // a run that drew nothing cannot produce one.
  const report = costOf(board(), {
    providers: providers('af_heart', IMAGE_KEYED),
    sourceChars: 0,
    storyboardChars: 0,
    narratedChars: 0,
    spend: [],
  });
  assert.equal(providers('af_heart', IMAGE_KEYED).images.cloud, true, 'the key is really set');
  assert.deepEqual(report.lines, []);
  assert.equal(report.local, true);
});

test('the two raster lanes are billed separately, from the calls they made', () => {
  // Grouped by (lane, provider, model), exactly as the drawing author and the underlay
  // already were — so "what did the figures cost" is a question the report answers.
  const report = costOf(board(), {
    providers: providers('af_heart', IMAGE_KEYED),
    sourceChars: 0,
    storyboardChars: 0,
    narratedChars: 0,
    spend: [
      { lane: 'illustration', provider: 'fal', images: 1 },
      { lane: 'illustration', provider: 'fal', images: 1 },
      { lane: 'figure', provider: 'fal', images: 1 },
    ],
  });
  const forms = report.lines.find((l) => l.stage === 'illustration');
  const figures = report.lines.find((l) => l.stage === 'figure');
  assert.ok(forms && figures);
  assert.match(forms.basis, /2 images generated/);
  assert.match(figures.basis, /1 image generated/);
  // Three images at the same list rate, whichever lane asked for them.
  assert.equal(forms.usd, 2 * figures.usd);
  assert.equal(report.usd, Math.round((forms.usd + figures.usd) * 1e4) / 1e4);
});

test('a spend entry with no tokens and no images cannot invent a line', () => {
  // The defensive floor this whole file is about, one field over: a response whose
  // `usage` block was missing reports zeroes, and zero tokens is not a bill.
  const report = drawn([{ lane: 'drawing', provider: 'anthropic', model: 'claude-opus-5' }]);
  assert.deepEqual(report.lines, []);
  assert.equal(report.local, true);
});

test('Fireworks uses its own token rates and does not double-count authored lesson estimates', () => {
  const p = providers(undefined, { FIREWORKS_API_KEY: 'fake', ELEVENLABS_API_KEY: 'also-fake' });
  assert.equal(p.planner.name, 'fireworks');
  assert.equal(p.voice.name, 'kokoro');
  const cost = costOf(board(), {
    providers: p,
    sourceChars: 10000,
    storyboardChars: 8000,
    narratedChars: 0,
    lessonAuthored: true,
    spend: [
      {
        lane: 'lesson',
        provider: 'fireworks',
        model: p.planner.model,
        inTokens: 1000,
        outTokens: 1000,
      },
    ],
  });
  assert.equal(cost.lines.length, 1);
  assert.equal(cost.usd, 0.0015);
  assert.equal(cost.estimated, true, 'list-price estimates are not invoices');
});

test('unknown Fireworks pricing remains unpriced even without token telemetry', () => {
  const p = providers(undefined, {
    FIREWORKS_API_KEY: 'fake',
    INKCAST_FIREWORKS_MODEL: 'accounts/custom/models/new',
  });
  const report = costOf(board(), {
    providers: p,
    sourceChars: 1000,
    storyboardChars: 2000,
    narratedChars: 0,
    lessonAuthored: true,
  });
  assert.equal(report.lines[0]?.unpriced, true);
  assert.equal(report.usd, 0);
  assert.equal(report.local, false);
});
