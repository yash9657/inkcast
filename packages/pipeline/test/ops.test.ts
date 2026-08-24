/**
 * Editing narration keeps the cue indices honest (plan item 4.1).
 *
 * `enter.cueWord` is an index into the *spoken* words of a scene's narration, so
 * rewriting that narration is precisely the event that makes it false. An edit is
 * also the one place a human hand reaches into the IR, so it is where a stale index
 * would be manufactured — and a stale index that still resolves is the failure this
 * whole item exists to end: a reveal landing on the wrong word with nothing in the
 * log about it.
 *
 * So `set-narration` re-takes every index in the scene it touched. A cue that still
 * occurs keeps word-exact placement; one that no longer does loses its index and is
 * reported by `critiqueStoryboard` as a cue naming words its scene no longer says.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { narrationTokens, parseStoryboard, type Storyboard } from '@inkcast/core';
import { applyOps } from '../src/ops.js';

const NARRATION = 'Feel which way is downhill, and take one small step that way.';

function board(): Storyboard {
  return parseStoryboard({
    version: 1,
    title: 'a board',
    canvas: { x: 0, y: 0, w: 1920, h: 1080 },
    scenes: [
      {
        id: 's1',
        narration: NARRATION,
        camera: { x: 960, y: 540, zoom: 1 },
        elements: [
          {
            id: 'step',
            type: 'text',
            text: 'one small step',
            at: { x: 100, y: 100, w: 600, h: 120 },
            enter: { at: 0.5, cue: 'take one small step', cueWord: 6 },
          },
        ],
      },
    ],
  }) as Storyboard;
}

/** Where the one element's cue index sits after an edit. */
function indexOf(sb: Storyboard): number | undefined {
  return sb.scenes[0]!.elements[0]!.enter.cueWord;
}

test('the fixture is what the compiler would have written', () => {
  // The guard that keeps the rest of this file meaningful: if word 6 were not
  // where the cue starts, every assertion below would be about a stale index
  // testing a stale index.
  assert.equal(narrationTokens(NARRATION)[6], 'take');
});

test('rewriting narration re-takes the cue index that still resolves', () => {
  const { storyboard, applied, problems } = applyOps(board(), [
    {
      op: 'set-narration',
      scene: 's1',
      text: `Now then. ${NARRATION}`,
    },
  ]);
  // Two words earlier in the text means two words later in the index.
  assert.equal(indexOf(storyboard), 8);
  assert.equal(narrationTokens(storyboard.scenes[0]!.narration)[8], 'take');
  assert.ok(
    applied.some((line) => /re-cued scene s1/.test(line)),
    applied.join('\n'),
  );
  // Nothing dangles: the cue is still in the narration, at a known word.
  assert.deepEqual(problems, []);
});

test('a cue the new narration no longer contains loses its index rather than keeping a wrong one', () => {
  const { storyboard, problems } = applyOps(board(), [
    { op: 'set-narration', scene: 's1', text: 'The slope tells you which way to go.' },
  ]);
  assert.equal(indexOf(storyboard), undefined);
  // And the cue itself is reported, which is the pre-existing critique doing its
  // job — the reveal falls back to its authored fraction, loudly.
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /is cued to "take one small step"/);
});

test('an edit that does not touch narration leaves the indices alone', () => {
  const { storyboard, applied } = applyOps(board(), [{ op: 'set-title', title: 'a new title' }]);
  assert.equal(indexOf(storyboard), 6);
  assert.ok(!applied.some((line) => /re-cued/.test(line)));
});
