/**
 * The lane guard — what this pipeline says when it cannot draw what it was asked for
 * (plan item 6.1; audit S5-a).
 *
 * A detector like this is worth exactly what its false-positive rate is worth, so the
 * tests are shaped as two lists rather than as a feature tour: pictures that must raise
 * the warning, and pictures that must not. The second list is the important one, and
 * every entry in it is a real describe — or a near-miss of one — from a film this repo
 * has shipped and watched: a lithium atom, a wire through a bulb, water molecules in
 * ice, a globe with meridians, a loss *function*, a map *of an analogy*. Each was drawn
 * correctly by the lanes that exist, and a guard that flagged them would be voting to
 * build a renderer nobody needs (see the module header's decision 2).
 *
 * The blind spots are asserted too, at the foot of the file, so that "this is missed"
 * is a recorded decision rather than something to be discovered as a surprise.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Lesson as LessonSchema,
  UNSERVED,
  laneGapLines,
  lanesMissing,
  looksLikeSmiles,
  unservedLanes,
  type Lane,
  type Lesson,
} from '../src/index.js';

/** The schema is the parser here: `parseLesson` lives in the planner, which core cannot see. */
const parseLesson = (input: unknown): Lesson => LessonSchema.parse(input);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** A lesson whose pictures are exactly the describes given. */
function lessonOf(topic: string, describes: string[]): Lesson {
  const step = (describe: string) => ({
    idea: 'an idea',
    because: 'a reason',
    narration: 'some narration.',
    visuals: [{ describe, kind: 'illustration' as const }],
  });
  return parseLesson({
    version: 1,
    topic,
    objective: 'do the thing',
    hook: step(describes[0] ?? 'a hook picture'),
    anchor: step(describes[1] ?? 'an anchor picture'),
    steps: (describes.length > 2 ? describes.slice(2) : ['a plain picture']).map(step),
    recap: step('the chain retraced'),
  });
}

function lanesFor(topic: string, describes: string[]): Lane[] {
  return lanesMissing(unservedLanes(lessonOf(topic, describes)));
}

/* ------------------------------------------------------ what must be reported */

const REPORTED: [Lane, string, string][] = [
  // The plan's own done-bar: a SMILES-bearing prompt, and a "draw a map of" prompt.
  ['chemistry', 'Why aspirin works: CC(=O)OC1=CC=CC=C1C(=O)O', 'a plain picture'],
  ['chemistry', 'caffeine', 'draw CN1C=NC2=C1C(=O)N(C)C(=O)N2C at the centre of the board'],
  ['geography', 'the trade winds', 'draw a map of the Atlantic with the wind belts marked'],

  ['chemistry', 'aromatic compounds', 'a benzene ring with its alternating double bonds'],
  ['chemistry', 'esters', 'the skeletal formula of ethyl acetate, drawn large'],
  ['geography', 'plate tectonics', 'the coastline of South America beside the coast of Africa'],
  ['geography', 'the union', 'a map showing the member countries shaded'],
  ['circuits', 'ohm’s law', 'a circuit diagram: battery, resistor and ammeter in series'],
  ['circuits', 'filters', 'a circuit with a resistor and a capacitor in series'],
  ['circuits', 'flip-flops', 'a timing diagram of the clock line against the output'],
];

for (const [lane, topic, describe] of REPORTED) {
  test(`${lane}: "${describe.slice(0, 52)}…" is reported`, () => {
    assert.deepEqual(lanesFor(topic, [describe]), [lane]);
  });
}

/* --------------------------------------------------- what must stay quiet */

const QUIET: [string, string][] = [
  // Every one of these is a picture the shipped corpus draws, or one word away from it.
  ['How a lithium-ion battery charges', 'two stacks with a wire looping over the top through a small bulb'], // prettier-ignore
  ['How a lithium-ion battery charges', 'a single lithium atom drawn as a nucleus circle with two dots close in and one far out on an orbit ring'], // prettier-ignore
  ['why ice floats', 'water molecules held apart in a hexagonal lattice by hydrogen bonds'],
  ['How a clock solved longitude', 'a globe with meridian lines drawn on it and a ship on the ocean'], // prettier-ignore
  ['gradient descent', 'a map of the analogy onto the abstraction, each part joined by an arrow'], // prettier-ignore
  ['gradient descent', 'a bowl-shaped loss function with the lowest point marked'],
  ['sorting', 'the algorithm drawn as numbered boxes being swapped, with no code on the board'], // prettier-ignore
  ['the cardiac conduction system', 'the heart outline with a shaded oval high in the right atrium, labelled SA node'], // prettier-ignore
  ['photosynthesis', 'a leaf cell with chloroplasts, water arriving from the roots and CO2 from the air'], // prettier-ignore
  ['confidence', 'a figure who SMILES at the reader'],
];

for (const [topic, describe] of QUIET) {
  test(`quiet: "${describe.slice(0, 52)}…"`, () => {
    assert.deepEqual(lanesFor(topic, [describe]), []);
  });
}

test('both shipped lessons ask for nothing this pipeline cannot draw', () => {
  const dir = path.join(ROOT, 'examples/lessons');
  const files = readdirSync(dir).filter((f) => f.endsWith('.lesson.json'));
  assert.ok(files.length >= 2, 'the shipped lessons are the fixture');
  for (const f of files) {
    const lesson = parseLesson(JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
    assert.deepEqual(unservedLanes(lesson), [], `${f} raised a lane gap`);
  }
});

/* ------------------------------------------------------------ what it says */

test('a gap names the beat, quotes the words, and says what happens instead', () => {
  const lesson = lessonOf('aromatic compounds', [
    'a hook picture',
    'a benzene ring with its alternating double bonds',
  ]);
  const gaps = unservedLanes(lesson);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0]!.where, 'anchor');
  assert.equal(gaps[0]!.kind, 'illustration');
  const [line] = laneGapLines(gaps);
  assert.match(line!, /beat anchor asks for chemical structure notation/);
  assert.match(line!, /"a benzene ring with its alternating double bonds"/);
  assert.match(line!, /drawn by the illustration lane/);
});

test('the underlay prompt is read too — it goes to an image generator verbatim', () => {
  const lesson = parseLesson({
    version: 1,
    topic: 'esters',
    objective: 'name one',
    hook: {
      idea: 'i',
      because: 'b',
      narration: 'n.',
      visuals: [
        {
          describe: 'label the two ends of the molecule',
          kind: 'draw',
          underlay: { prompt: 'the skeletal formula of ethyl acetate, flat line art' },
        },
      ],
    },
    anchor: { idea: 'i', because: 'b', narration: 'n.', visuals: [] },
    steps: [{ idea: 'i', because: 'b', narration: 'n.', visuals: [] }],
    recap: { idea: 'i', because: 'b', narration: 'n.', visuals: [] },
  });
  const gaps = unservedLanes(lesson);
  assert.deepEqual(
    gaps.map((g) => [g.lane, g.where]),
    [['chemistry', 'hook']],
  );
});

test('the subject is reported only when no picture already was', () => {
  // The topic names a molecule and so does a beat: one finding, on the beat.
  const both = unservedLanes(lessonOf('the benzene molecule', ['the skeletal formula of benzene']));
  assert.deepEqual(
    both.map((g) => g.where),
    ['hook'],
  );
  // The topic alone: the pictures never say so, and the film is still one we cannot draw.
  const topicOnly = unservedLanes(lessonOf('drawing CC(=O)OC1=CC=CC=C1C(=O)O', []));
  assert.deepEqual(
    topicOnly.map((g) => [g.lane, g.where]),
    [['chemistry', 'topic']],
  );
  assert.match(laneGapLines(topicOnly)[0]!, /this lesson’s subject asks/);
});

test('one lesson can want two lanes, and each is named once', () => {
  const gaps = unservedLanes(
    lessonOf('earth science', [
      'a circuit diagram with two resistors',
      'the coastline of Norway with its fjords',
      'a second circuit diagram, this time with a capacitor',
    ]),
  );
  assert.equal(gaps.length, 3);
  assert.deepEqual(lanesMissing(gaps), ['circuits', 'geography']);
});

test('the code lane exists now, so nothing apologises for it', () => {
  // Plan item 6.2 built it (`visuals/src/code.ts`), so the guard has nothing to say about
  // a listing any more: it is set in monospace, highlighted, and revealed in document
  // order. Deleting the entry is part of shipping the lane, and `auditcheck.mts` fails if
  // a lane is still declared unserved once its named renderer is a dependency — which is
  // what forced this row out.
  assert.deepEqual(lanesFor('hash maps', ['a code snippet of the lookup function']), []);
  assert.deepEqual(
    lanesFor('recursion', ['show def factorial(n): return n * factorial(n - 1) on the board']),
    [],
  );
  assert.ok(!('code' in UNSERVED));
});

/* ------------------------------------------------------------------ SMILES */

test('a title-cased subject does not fire the place-name signal', () => {
  // In a title every word is capitalised, including the abstraction: the capital after
  // "map of" means something in a describe and nothing here.
  assert.deepEqual(lanesFor('A Map of the Human Genome', ['a plain picture']), []);
  // The same words in a picture, sentence-cased, are a request for a real map.
  assert.deepEqual(lanesFor('genomics', ['a map of the Balkans, borders marked']), ['geography']);
});

test('a SMILES string is told from a word, a formula and an initialism', () => {
  for (const yes of ['c1ccccc1', 'CC(=O)O', 'CN1C=NC2=C1C(=O)N(C)C(=O)N2C', 'C1CCCCC1']) {
    assert.ok(looksLikeSmiles(yes), `${yes} is a molecule`);
  }
  for (const no of [
    'cocoons', // spelled entirely out of the organic subset — no ring, no branch
    'spoons',
    '(learning', // a parenthesised English word
    'CO2/H2O', // formulas, which the equation lane sets
    'H2O',
    '0.1',
    'SA',
  ]) {
    assert.ok(!looksLikeSmiles(no), `${no} is not a molecule`);
  }
});

/* ------------------------------------------- the blind spots, on the record */

test('short SMILES and unbranched chains are missed, deliberately', () => {
  // `CCO` is ethanol and also three capitals; `CCCCCC` is hexane and also a zigzag the
  // drawing lane can genuinely compose. Both are cheaper to miss than `ATP` is to flag.
  assert.ok(!looksLikeSmiles('CCO'));
  assert.ok(!looksLikeSmiles('CCCCCC'));
});

test('one component is not a circuit', () => {
  // A lone resistor is a zigzag. Two components wired together is a schematic.
  assert.deepEqual(lanesFor('resistance', ['one resistor drawn as a zigzag with two leads']), []);
});
