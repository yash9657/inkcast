/**
 * `shorten` — the cut that has to read as finished.
 *
 * The existing tests for it live in `compile.test.ts` alongside the compiler that calls it,
 * and they cover the original rule: never ellipsise, and drop a trailing function word. Its
 * extension for defect 0b needed a table rather than four more lines there, because the
 * whole risk of the change is *over*-trimming — a list that turns "the slope is steep" into
 * "the slope is" would trade a rare defect for a common one — so the negative cases are
 * worth as much as the positive ones and there are more of them.
 *
 * Every string here is either a real caption from a shipped board or a minimal variant of
 * one, and the word budgets are the real ones: `captionWords` is 9 on the standard preset
 * and 6 on the vertical presets, and diagram nodes are cut at 4 and 5.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { shorten } from '../src/text.js';

/* ------------------------------------------------ the shipped failure itself */

test('the caption that shipped defect 0b no longer ends on its adjective', () => {
  // The board said: "A charged battery is lithium held on the wrong". Nine words, from a
  // ten-word sentence, and the tenth was "side". Every word in it passed the old DANGLING
  // list, because "wrong" is not a function word — it is an adjective, and an adjective at
  // the end of a cut promises a noun exactly the way "of" promises an object.
  assert.equal(
    shorten('A charged battery is lithium held on the wrong side.', 9),
    'A charged battery is lithium held',
  );

  // And the retreat goes to the phrase boundary rather than one word back. "on the" is not
  // an ending either, so dropping "wrong" alone would have swapped one unkept promise for
  // a worse one.
  assert.ok(!shorten('A charged battery is lithium held on the wrong side.', 9).endsWith('on the'));
});

test('the one shipped storyboard this moves is the one that was broken', () => {
  // `longitude` at the `short` preset captioned a cell "Longitude is a difference between",
  // which is the same defect with a preposition instead of an adjective. Confirmed by
  // diffing the compiled storyboards: this label is the *only* byte that changes across
  // the whole film, which is why the pinned hash for that one lesson-preset pair moves and
  // the other three do not.
  assert.equal(
    shorten('Longitude is a difference between two clocks', 5),
    'Longitude is a difference',
  );
});

/* ------------------------------------------------------------- what must trim */

test('a cut never ends on a word that promises another one', () => {
  const cases: [string, number, string][] = [
    // Prepositions, including the ones the first version of the list happened to miss.
    ['the signal passes through the node', 5, 'the signal passes'],
    ['the current pushes against the field', 5, 'the current pushes'],
    ['a clock carried across the ocean', 5, 'a clock carried'],
    // Auxiliaries and modals: the verb they were waiting for is gone with the cut.
    ['the atrium has filled with blood', 3, 'the atrium'],
    ['the ventricle must contract from the base', 3, 'the ventricle'],
    // Determiners and quantifiers. Note what survives: "smaller" is predicative here
    // ("is smaller"), so only the comparative marker "than" is dropped.
    ['every step is smaller than the last', 5, 'every step is smaller'],
    // Relatives and subordinators.
    ['the slope tells you which way is down', 5, 'the slope tells'],
    ['the clock kept time because', 4, 'the clock kept time'],
    // Comparatives after a determiner are attributive, so the noun is missing — and note
    // that the retreat does not stop at the adjective. Dropping "lower" leaves "in the",
    // which promises just as much, so the whole prepositional phrase goes.
    ['it settles in the lower chamber', 5, 'it settles'],
    ['blood leaves through the larger vessel', 5, 'blood leaves'],
    // Ordinals and attributive-only modifiers, same retreat.
    ['the pendulum swings on its own axis', 6, 'the pendulum swings'],
    ['measure the difference at the same moment', 6, 'measure the difference'],
  ];
  for (const [input, max, want] of cases) {
    assert.equal(shorten(input, max), want, `shorten(${JSON.stringify(input)}, ${max})`);
  }
});

/* ---------------------------------------------------------- what must not trim */

test('a cut never orphans half of a correlative', () => {
  // The shipped defect, from `projects/deb81002b073` scene s4 — flagged by QC's
  // frame-vision on a strict-clean run. Every guard in this file passes it: the cut
  // fell on "and", which is a clause head, so the mid-phrase rule is off; the last
  // kept word is "pull", an ordinary noun. Nothing looking at the *end* of the
  // caption can see it, because the problem is "between", six words earlier.
  assert.equal(
    shorten('Falling is a tug of war between bigger pull and bigger inertia.', 9),
    'Falling is a tug of war',
  );
  assert.equal(
    shorten('Falling is a tug of war between a bigger pull and a bigger reluctance.', 9),
    'Falling is a tug of war',
  );
  // Cut exactly on the "to" that closes "from …": what is left says you can go from
  // somewhere and never says where to.
  assert.equal(shorten('You can go from London to Paris in two hours.', 5), 'You can go');
  // Cut past it, and the pair is intact — so nothing fires.
  assert.equal(
    shorten('You can go from London to Paris in two hours.', 8),
    'You can go from London to Paris',
  );

  // And it is narrow. "between two places" is an ordinary prepositional phrase whose
  // cut lands on a noun, not on a coordinator — firing there would shorten a caption
  // that reads perfectly well, and would move a pinned hash for nothing.
  assert.equal(
    shorten('Longitude is a difference between two places, measured in time.', 6),
    'Longitude is a difference between two',
  );
  // A correlative that is already closed inside the caption is not orphaned.
  assert.equal(
    // "is" is trimmed as a dangling auxiliary by the guard that was already here.
    shorten('The gap between anode and cathode is where the work happens.', 7),
    'The gap between anode and cathode',
  );
  // And a correlative that opens the phrase leaves nothing to fall back to. One word
  // is not a caption, so the broken cut is the better of two bad answers.
  assert.equal(
    shorten('Either the ball speeds up or the ground moves.', 5),
    'Either the ball speeds up',
  );
});

test('a finished phrase is left alone, adjective ending or not', () => {
  const cases: [string, number, string][] = [
    // Predicative adjectives are perfectly good endings, and there are far more of these
    // than there are dangling ones — a list that trimmed them would be a net regression.
    ['the ground under your feet is steep today', 7, 'the ground under your feet is steep'],
    ['the gap between the two clocks is wrong', 8, 'the gap between the two clocks is wrong'],
    ['the answer is wrong because the slope points uphill', 4, 'the answer is wrong'],
    // Adverbial comparatives: "climbs higher" is finished, and only the word *before*
    // "higher" tells it apart from "the higher chamber".
    ['the sun climbs higher every day', 4, 'the sun climbs higher'],
    ['the ball rolls faster down the slope', 4, 'the ball rolls faster'],
    // Nothing to do at all: under budget, or a clean punctuation break in range.
    ['The slope points uphill', 8, 'The slope points uphill'],
    ['Feel the ground, then step downhill', 4, 'Feel the ground'],
    // A cut that lands exactly at a clause boundary is already an ending, so the word it
    // dropped being "and" is the evidence that nothing needs trimming.
    ['the atria squeeze and the ventricles wait', 4, 'the atria squeeze'],
  ];
  for (const [input, max, want] of cases) {
    assert.equal(shorten(input, max), want, `shorten(${JSON.stringify(input)}, ${max})`);
  }
});

test('it never ellipsises and never empties the phrase', () => {
  // The original contract, re-asserted because the new loop is what could break it: a
  // string of nothing but function words would be popped down to nothing if the guard on
  // `kept.length > 1` were ever relaxed, and an empty caption is a blank cell on the board.
  const pathological = ['of the and to in on at by for from with', 'the the the the the'];
  for (const s of pathological) {
    for (const max of [1, 2, 4, 6, 9]) {
      const out = shorten(s, max);
      assert.ok(out.length > 0, `shorten(${JSON.stringify(s)}, ${max}) emptied the phrase`);
      assert.ok(!out.includes('…') && !out.includes('...'), `${out} ellipsised`);
    }
  }
});

test('trailing punctuation never survives the cut', () => {
  // A label ending in a comma reads as an unfinished list, which is the same broken promise
  // by a different route. Both exits from the function strip it — the punctuation break and
  // the word cut — and both are checked, because only one of them was for a while.
  assert.equal(shorten('the atrium fills, then squeezes', 3), 'the atrium fills');
  assert.equal(shorten('one clock at home; one at sea', 4), 'one clock at home');
  for (const out of [
    shorten('a step downhill — always downhill', 3),
    shorten('north is easy.', 2),
  ]) {
    assert.ok(!/[,;:.\-–—]$/.test(out), `${out} kept its punctuation`);
  }
});
