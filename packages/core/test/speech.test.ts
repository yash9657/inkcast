/**
 * The narration normaliser and the tokeniser of record (`core/src/speech.ts`).
 *
 * These tests moved here with the module in plan item 4.1: they were the voice
 * stage's, and the module stopped being the voice stage's the moment the planner
 * had to tokenise narration with it. What they assert has not changed — a
 * normaliser is only as good as the notation it has actually been pointed at, and
 * this is the list of notation an explainer video really contains.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cueTokens,
  cueWordIndex,
  matchTokens,
  narrationTokens,
  normalizeNarration,
  numberToWords,
  ordinalToWords,
  splitSentences,
  stripMarkdown,
  yearToWords,
} from '../src/speech.js';

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

/* ------------------------------------------------------- tokens and indices */

test('the tokeniser strips everything a match should not depend on', () => {
  assert.deepEqual(matchTokens("  It's THE  same-ish thing. "), [
    'its',
    'the',
    'same',
    'ish',
    'thing',
  ]);
  assert.deepEqual(matchTokens('...'), []);
});

test('narration is tokenised as it will be spoken, not as it was written', () => {
  // One written token becomes three spoken ones, which is the whole reason an
  // index has to be taken after normalisation rather than before it.
  assert.deepEqual(narrationTokens('Use 0.1 here.'), ['use', 'zero', 'point', 'one', 'here']);
  assert.deepEqual(cueTokens('0.1'), ['zero', 'point', 'one']);
});

test('a cue becomes the index of its first spoken word', () => {
  const narration = 'Somewhere below is a valley. You have no map, so use the slope.';
  const tokens = narrationTokens(narration);
  const at = cueWordIndex(narration, 'use the slope');
  assert.equal(typeof at, 'number');
  assert.equal(tokens[at!], 'use');
  assert.deepEqual(tokens.slice(at!, at! + 3), ['use', 'the', 'slope']);
});

test('an index is only ever taken from an exact match', () => {
  const narration = 'The learning rate is 0.1, which sets the step.';
  // Normalisation is applied to both sides, so a cue quoting the source digits
  // still lands on the spoken words.
  assert.equal(narrationTokens(narration)[cueWordIndex(narration, 'is 0.1')!], 'is');
  // A cue that drifted from the narration gets no index at all: the voice stage's
  // fuzzy search may still place it, but nothing pretends a number was derived.
  assert.equal(cueWordIndex(narration, 'that learning rate'), undefined);
  assert.equal(cueWordIndex(narration, '   '), undefined);
  assert.equal(cueWordIndex(narration, undefined), undefined);
});

test('a repeated cue resolves to its first occurrence, once and in the open', () => {
  const narration = 'The step is smaller. Then the step is smaller again.';
  assert.equal(cueWordIndex(narration, 'the step is smaller'), 0);
});
