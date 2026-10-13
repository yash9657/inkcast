/**
 * `critiqueStoryboard` — the board graph's own critique (plan 3.2, audit S3-c).
 *
 * Every test here seeds exactly one dangling reference into a board that is
 * otherwise well formed, because that is the failure mode the function exists for:
 * the storyboard still parses, the render still succeeds, and the move the beat was
 * about is silently missing from the film. The green case at the top is the guard
 * against a critique that fires on everything — a check that fails the corpus is a
 * check nobody can turn on.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { critiqueStoryboard, parseStoryboard, type Storyboard } from '../src/index.js';

/** A two-scene board with a morph, an emphasis, an asset and a plot — all resolved. */
function board(patch: (sb: Storyboard) => void = () => undefined): Storyboard {
  const sb = parseStoryboard({
    version: 1,
    title: 'a board',
    canvas: { x: 0, y: 0, w: 1920, h: 1080 },
    assets: [{ id: 'rover', kind: 'illustration', prompt: 'a rover' }],
    scenes: [
      {
        id: 's1',
        narration: 'Here is the hillside, and here is the rover parked on it.',
        camera: { x: 960, y: 540, zoom: 1 },
        elements: [
          {
            id: 'hill',
            type: 'path',
            at: { x: 100, y: 600, w: 600, h: 200 },
            points: [
              { x: 100, y: 700 },
              { x: 700, y: 620 },
            ],
            enter: { cue: 'the hillside' },
          },
          {
            id: 'rover-pic',
            type: 'asset',
            assetId: 'rover',
            at: { x: 800, y: 600, w: 200, h: 200 },
            enter: { cue: 'the rover' },
          },
        ],
      },
      {
        id: 's2',
        narration: 'The same slope, read as a loss curve, with its minimum marked.',
        camera: { x: 960, y: 540, zoom: 1 },
        elements: [
          {
            id: 'loss',
            type: 'plot',
            at: { x: 100, y: 200, w: 800, h: 500 },
            xDomain: [0, 10],
            yDomain: [0, 10],
            curves: [{ id: 'bowl', fn: { name: 'parabola', params: [1] } }],
            overlays: [{ kind: 'point', curveId: 'bowl', x: 5, label: 'minimum' }],
            morph: { fromId: 'hill' },
            enter: { cue: 'a loss curve' },
          },
          {
            id: 'ring',
            type: 'emphasis',
            targetId: 'loss',
            at: { x: 400, y: 400, w: 200, h: 120 },
          },
        ],
      },
    ],
  }) as Storyboard;
  patch(sb);
  // Re-parsed after the patch so a hand-seeded element carries the same zod defaults
  // a real storyboard on disk would — a patch that writes `{ fromId }` and nothing
  // else is testing a shape the loader never produces.
  return parseStoryboard(sb);
}

/** The one problem a seeded board produces, asserted to be the only one. */
function onlyProblem(sb: Storyboard): string {
  const problems = critiqueStoryboard(sb);
  assert.equal(problems.length, 1, `expected exactly one problem, got:\n${problems.join('\n')}`);
  return problems[0] as string;
}

test('a well-formed board has nothing to say about it', () => {
  assert.deepEqual(critiqueStoryboard(board()), []);
});

test('a morph out of an element that does not exist is caught', () => {
  const p = onlyProblem(
    board((sb) => {
      (sb.scenes[1]!.elements[0]! as { morph?: { fromId: string } }).morph = { fromId: 'hillside' };
    }),
  );
  assert.match(p, /morphs out of "hillside"/);
  assert.match(p, /not an element on this board/);
});

test('a morph out of ink drawn later is a forward reference, not a morph', () => {
  const p = onlyProblem(
    board((sb) => {
      // s1's path grows out of s2's plot — backwards in time.
      (sb.scenes[0]!.elements[0]! as { morph?: { fromId: string } }).morph = { fromId: 'loss' };
      delete (sb.scenes[1]!.elements[0]! as { morph?: unknown }).morph;
    }),
  );
  assert.match(p, /is not drawn until scene s2/);
  assert.match(p, /nothing may forward-reference/);
});

test('on a wiping board a morph out of expired ink is as dangling as a missing id', () => {
  const p = onlyProblem(
    board((sb) => {
      sb.meta.board = 'wipe';
      // The hill is one card's ink and goes out with its own scene; the plot in the
      // next scene still says it grows out of it.
      const hill = sb.scenes[0]!.elements[0]!;
      hill.persist = false;
      for (const el of sb.scenes[1]!.elements) el.persist = false;
    }),
  );
  assert.match(p, /whose ink left the board after scene s1/);
});

test('a wiping board that names the scene the card goes out on is fine', () => {
  assert.deepEqual(
    critiqueStoryboard(
      board((sb) => {
        sb.meta.board = 'wipe';
        for (const scene of sb.scenes) {
          for (const el of scene.elements) {
            el.persist = false;
            el.persistUntil = 's2';
          }
        }
      }),
    ),
    [],
  );
});

test('an emphasis around nothing is caught', () => {
  const p = onlyProblem(
    board((sb) => {
      (sb.scenes[1]!.elements[1]! as { targetId: string }).targetId = 'lost';
    }),
  );
  assert.match(p, /emphasises "lost"/);
});

test('an asset element whose asset was never declared is caught', () => {
  const p = onlyProblem(
    board((sb) => {
      sb.assets = [];
    }),
  );
  assert.match(p, /draws asset "rover", which this storyboard does not declare/);
});

test('a persistUntil naming no scene is caught, and so is one that comes too early', () => {
  // On the rover, which nothing else on the board points at — so the seeded defect is
  // the only problem and the assertion is about it alone.
  const missing = onlyProblem(
    board((sb) => {
      sb.scenes[0]!.elements[1]!.persist = false;
      sb.scenes[0]!.elements[1]!.persistUntil = 's9';
    }),
  );
  assert.match(missing, /persists until scene "s9", which does not exist/);

  const backwards = onlyProblem(
    board((sb) => {
      sb.meta.board = 'wipe';
      const ring = sb.scenes[1]!.elements[1]!;
      ring.persist = false;
      ring.persistUntil = 's1';
    }),
  );
  assert.match(backwards, /comes before the scene that draws it/);
});

test('persist and persistUntil together is a contradiction, and named as one', () => {
  const p = onlyProblem(
    board((sb) => {
      sb.scenes[0]!.elements[0]!.persistUntil = 's2';
    }),
  );
  assert.match(p, /is persistent and also names persistUntil/);
});

test('a cue that is not in its own narration cannot be placed on a word', () => {
  const p = onlyProblem(
    board((sb) => {
      sb.scenes[1]!.elements[0]!.enter.cue = 'the gradient of the bowl';
    }),
  );
  assert.match(p, /is cued to "the gradient of the bowl"/);
  assert.match(p, /not in its scene's narration/);
});

test('a plot overlay on a curve the plot does not draw is caught', () => {
  const p = onlyProblem(
    board((sb) => {
      const plot = sb.scenes[1]!.elements[0]! as { overlays: { curveId?: string }[] };
      plot.overlays[0]!.curveId = 'parabola';
    }),
  );
  assert.match(p, /point overlay on curve "parabola"/);
});

test('a diagram edge to a node the diagram has not got is caught', () => {
  const p = onlyProblem(
    board((sb) => {
      sb.scenes[1]!.elements.push({
        id: 'flow',
        type: 'diagram',
        layout: 'flow',
        at: { x: 1000, y: 200, w: 400, h: 300 },
        nodes: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
        edges: [{ from: 'a', to: 'c' }],
        enter: { at: 0, duration: 0.8, style: 'draw' },
        persist: true,
      } as never);
    }),
  );
  assert.match(p, /edge to node "c"/);
});

test('two elements sharing an id is caught — the board keys geometry by id', () => {
  const p = onlyProblem(
    board((sb) => {
      sb.scenes[1]!.elements[1]!.id = 'hill';
      (sb.scenes[1]!.elements[0]! as { morph?: { fromId: string } }).morph = { fromId: 'hill' };
      (sb.scenes[1]!.elements[1]! as { targetId: string }).targetId = 'loss';
    }),
  );
  assert.match(p, /two elements share the id "hill"/);
});

test('two scenes sharing an id is caught — every reference to it is ambiguous', () => {
  const p = onlyProblem(
    board((sb) => {
      sb.scenes[1]!.id = 's1';
    }),
  );
  assert.match(p, /two scenes share the id "s1"/);
});

test('a cue index that no longer names its own cue is caught before any audio (4.1)', () => {
  const p = onlyProblem(
    board((sb) => {
      // "the hillside" starts on word 2 of this narration; 0 is "here".
      sb.scenes[0]!.elements[0]!.enter.cueWord = 0;
    }),
  );
  assert.match(p, /cued at word 0, which is "here"/);
  assert.match(p, /starts on "the"/);
  assert.match(p, /narration changed after it was compiled/);
});

test('a cue index past the end of the narration is caught', () => {
  const p = onlyProblem(
    board((sb) => {
      sb.scenes[0]!.elements[0]!.enter.cueWord = 99;
    }),
  );
  assert.match(p, /is cued at word 99/);
  assert.match(p, /spoken words/);
});

test('a cue index that is right is silent — the check must pass the corpus', () => {
  assert.deepEqual(
    critiqueStoryboard(
      board((sb) => {
        // Where "the hillside" and "the rover" actually start, counted the way the
        // compiler counts: normalise the narration, then tokenise.
        sb.scenes[0]!.elements[0]!.enter.cueWord = 2;
        sb.scenes[0]!.elements[1]!.enter.cueWord = 7;
      }),
    ),
    [],
  );
});
