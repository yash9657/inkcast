import assert from 'node:assert/strict';
import test from 'node:test';
import type { Element, Storyboard } from '@inkcast/core';
import {
  PIPELINE_VERSION,
  STAGE_CODE_VERSION,
  assetFingerprint,
  cacheKey,
  cacheSlot,
  compiledFingerprint,
  elementFingerprint,
  renderFingerprint,
  stageVersion,
  storyboardKey,
  visualsFingerprint,
  voiceFingerprint,
} from '../src/keys.js';
import { STAGES } from '../src/progress.js';

test('every stage declares a code version, and it is in its keys', () => {
  for (const s of STAGES) {
    assert.equal(typeof STAGE_CODE_VERSION[s], 'number');
    assert.ok(stageVersion(s).includes(`pipeline@${PIPELINE_VERSION}`));
    assert.ok(stageVersion(s).includes(`${s}@${STAGE_CODE_VERSION[s]}`));
  }
});

test('the same inputs under different stages hash differently', () => {
  // Otherwise a shared input would let one stage answer for another.
  assert.notEqual(cacheKey('voice', 'x'), cacheKey('visuals', 'x'));
});

test('cache slots are namespaced, and per-item slots are distinct', () => {
  assert.equal(cacheSlot('lesson'), 'pipeline.lesson');
  assert.equal(cacheSlot('voice', 'scene-2'), 'pipeline.voice.scene-2');
  assert.notEqual(cacheSlot('voice', 'a'), cacheSlot('voice', 'b'));
});

test('a code-version bump invalidates an unchanged input', () => {
  // This is the bug that bit us: a fixed stage kept serving the old artefact
  // because only the *inputs* were hashed. Simulated by hashing the version.
  const before = cacheKey('storyboard', 'lesson-content');
  const pretendBumped = cacheKey('storyboard', 'lesson-content', 'compiler@2');
  assert.notEqual(before, pretendBumped);
});

test('the storyboard key carries the board mode, and only when there is one', () => {
  const request = {
    compiler: 1,
    planner: 2,
    route: 'lesson',
    source: 'lesson-hash',
    meta: { aspect: '16:9' },
    preset: 'standard',
    seconds: 150,
    title: '',
  } as const;

  // A mode the compiler acted on has to divide the cache, or the run without the flag
  // is served the wiped storyboard and the run with it the accumulated one.
  assert.notEqual(storyboardKey({ ...request, board: 'wipe' }), storyboardKey(request));
  assert.notEqual(
    storyboardKey({ ...request, board: 'wipe' }),
    storyboardKey({ ...request, board: 'accumulate' }),
  );

  // And the default key does not move: byte-identical to what this stage hashed
  // before the field existed, so no project on disk recompiles for a mode nobody
  // asked for. `JSON.stringify` drops an undefined value, which is what makes the
  // field's home inside the format object load-bearing rather than tidy.
  assert.equal(
    storyboardKey(request),
    cacheKey(
      'storyboard',
      1,
      2,
      'lesson',
      'lesson-hash',
      { aspect: '16:9' },
      { preset: 'standard', seconds: 150, title: '' },
      '',
    ),
  );
  // The document route's planner is still part of it, in the same slot.
  assert.equal(
    storyboardKey({ ...request, route: 'document', documentPlanner: ['heuristic', ''] }),
    cacheKey(
      'storyboard',
      1,
      2,
      'document',
      'lesson-hash',
      { aspect: '16:9' },
      { preset: 'standard', seconds: 150, title: '' },
      ['heuristic', ''],
    ),
  );
});

const scene = { narration: 'The ground under you gets gentler.', hold: 0.4 };
const meta = { voice: 'af_heart', language: 'en' };

test('voice keys cover narration, silence, voice, language, provider and engine', () => {
  const base = voiceFingerprint(scene, meta, 'kokoro', '');
  assert.equal(base, voiceFingerprint({ ...scene }, { ...meta }, 'kokoro', ''));
  assert.notEqual(
    base,
    voiceFingerprint({ ...scene, narration: 'Different.' }, meta, 'kokoro', ''),
  );
  // `hold` is rendered as real silence inside the clip, so it changes the file.
  assert.notEqual(base, voiceFingerprint({ ...scene, hold: 1.2 }, meta, 'kokoro', ''));
  assert.notEqual(base, voiceFingerprint(scene, { ...meta, voice: 'am_puck' }, 'kokoro', ''));
  assert.notEqual(base, voiceFingerprint(scene, meta, 'elevenlabs', ''));
  // The engine, which is the field that was missing: two runs of one provider that
  // differ only in `ELEVENLABS_MODEL_ID` are different recordings of the same words.
  const flash = voiceFingerprint(scene, meta, 'elevenlabs', 'eleven_flash_v2_5');
  assert.notEqual(flash, voiceFingerprint(scene, meta, 'elevenlabs', 'eleven_multilingual_v2'));
  assert.notEqual(flash, voiceFingerprint(scene, meta, 'elevenlabs', ''));
});

test('asset keys cover the prompt, the seed, the ink style and the provider', () => {
  const art = { style: 'marker', palette: 'color' };
  const base = assetFingerprint(
    { kind: 'illustration', prompt: 'a hiker', seed: 7 },
    art,
    'builtin',
  );
  assert.notEqual(
    base,
    assetFingerprint({ kind: 'illustration', prompt: 'a hiker', seed: 8 }, art, 'builtin'),
  );
  assert.notEqual(
    base,
    assetFingerprint({ kind: 'illustration', prompt: 'a hiker', seed: 7 }, art, 'replicate'),
  );
  assert.notEqual(
    base,
    assetFingerprint(
      { kind: 'illustration', prompt: 'a hiker', seed: 7 },
      { ...art, style: 'chalk' },
      'builtin',
    ),
  );
});

const plot = (xMax: number): Element =>
  ({
    id: 'loss',
    type: 'plot',
    at: { x: 0, y: 0, w: 800, h: 500 },
    enter: { at: 0.2, duration: 0.8, style: 'draw' },
    persist: true,
    xDomain: [0, xMax],
    yDomain: [0, 10],
    axes: 'both',
    grid: false,
    ticks: false,
    curves: [{ id: 'c', fn: { name: 'parabola', params: [1] }, dashed: false, accent: 0 }],
    overlays: [],
  }) as unknown as Element;

test('element fingerprints ignore timing but not geometry', () => {
  const a = plot(5);
  const b = {
    ...(plot(5) as unknown as Record<string, unknown>),
    enter: { at: 0.9, duration: 0.2, style: 'draw' },
  } as unknown as Element;
  assert.deepEqual(elementFingerprint(a), elementFingerprint(b));
  assert.notDeepEqual(elementFingerprint(a), elementFingerprint(plot(9)));
});

function board(el: Element): Storyboard {
  return {
    version: 1,
    title: 'Gradient descent',
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
    scenes: [
      {
        id: 's1',
        narration: 'A bowl-shaped curve.',
        camera: { x: 0, y: 0, zoom: 1, transition: 0.9 },
        elements: [el],
        hold: 0.4,
      },
    ],
  } as unknown as Storyboard;
}

test('the visuals key follows an edited plot — the MVP hashed only diagrams', () => {
  assert.equal(visualsFingerprint(board(plot(5))), visualsFingerprint(board(plot(5))));
  assert.notEqual(visualsFingerprint(board(plot(5))), visualsFingerprint(board(plot(9))));
});

test('re-voicing does not invalidate the drawing', () => {
  const before = board(plot(5));
  const after = board(plot(5));
  // What the voice stage does: rewrites enter.at from a resolved cue.
  (after.scenes[0]!.elements[0] as { enter: { at: number } }).enter.at = 0.63;
  after.scenes[0]!.durationSec = 7.2;
  assert.equal(visualsFingerprint(before), visualsFingerprint(after));
  // The render, however, must follow the new timing exactly.
  assert.notEqual(renderFingerprint(before), renderFingerprint(after));
});

test('the compiled fingerprint sees a hand edit and not a stage doing its job', () => {
  // Plan 5.5 / audit A-1: `--force` recompiles the board from the lesson and used to
  // clobber a hand edit in silence. This is the test that decides what "diverged" means,
  // and getting it wrong in either direction makes the warning useless — noisy on every
  // narrated project, or quiet on the edit it exists to announce.
  const pristine = board(plot(5));

  // Everything three later stages legitimately write into the board in place.
  const enriched = board(plot(5));
  const scene = enriched.scenes[0]!;
  (scene.elements[0] as { enter: { at: number } }).enter.at = 0.63; // voice, from a cue
  scene.durationSec = 7.2;
  scene.audioPath = 'audio/s1.wav';
  scene.words = [{ word: 'A', start: 0, end: 0.2 }];
  enriched.title = 'A title the run passed with --title';
  enriched.meta = { ...enriched.meta, style: 'chalk' };
  enriched.assets = [];
  assert.equal(
    compiledFingerprint(pristine),
    compiledFingerprint(enriched),
    'voice, visuals and --title/--meta must not read as a hand edit',
  );

  // A human moving a curve, and a human retiming an entrance, both must.
  assert.notEqual(compiledFingerprint(pristine), compiledFingerprint(board(plot(9))));
  const retimed = board(plot(5));
  (retimed.scenes[0]!.elements[0] as { enter: { duration: number } }).enter.duration = 2.4;
  assert.notEqual(compiledFingerprint(pristine), compiledFingerprint(retimed));
  // And so must an edit to what is said, which no stage downstream of the compiler
  // touches — this is the `set-narration` op arriving through `inkcast edit`.
  const reworded = board(plot(5));
  reworded.scenes[0]!.narration = 'A valley, seen from the rim.';
  assert.notEqual(compiledFingerprint(pristine), compiledFingerprint(reworded));
});

test('a resolved asset is the visuals stage writing, not the board diverging', () => {
  // The other half of the same seam: `Asset.svg` and the pinned `ref.version` are
  // written into the board by the visuals stage, so a project that has been through it
  // once must not look edited on the next `--force`.
  const withAsset = (resolved: boolean): Storyboard => {
    const sb = board(plot(5));
    sb.assets = [
      {
        id: 'bulb',
        kind: 'icon',
        ref: { path: 'symbols/bulb', ...(resolved ? { version: 3 } : {}) },
        ...(resolved ? { svg: 'assets/bulb.svg' } : {}),
      },
    ] as unknown as Storyboard['assets'];
    return sb;
  };
  assert.equal(compiledFingerprint(withAsset(false)), compiledFingerprint(withAsset(true)));
});
