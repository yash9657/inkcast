/**
 * The caps on what a request may carry — the half of plan item D2 that is not
 * the rate limiter.
 *
 * The limiter bounds how *often* the box is asked to work; these bound how much
 * work one accepted request can ask for. Both were written together and only one
 * of them had a test, which is the reason this file exists: `MAX_UPLOAD_BYTES`
 * and `MAX_HOSTED_SOURCE_CHARS` are two numbers that a later "let's relax this"
 * commit could move with nothing objecting, and the second one is the one
 * standing between a 500 000-character paste and a lesson-stage prompt we pay
 * for by the character.
 *
 * Three things are worth pinning and the rest of `schemas.ts` is zod:
 *
 *  1. **The boundary is where it claims to be.** Exactly at the cap is allowed,
 *     one over is refused. An off-by-one here is invisible in use and is exactly
 *     what a hand-written cap gets wrong.
 *  2. **The refusal says the numbers out loud.** The copy is the whole point of
 *     returning a message rather than a boolean — a user told "too long" with no
 *     figure cannot act, and the two limits must not describe themselves
 *     differently in two places.
 *  3. **The unit of measurement matches `SourceText`'s.** Both count UTF-16
 *     code units, so a document that passes the schema's 500 000 ceiling cannot
 *     be counted differently by the hosted cap. Astral characters (emoji,
 *     CJK extension B) are where a `[...text].length` "fix" would silently make
 *     the two disagree.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_HOSTED_SOURCE_CHARS,
  MAX_UPLOAD_BYTES,
  hostedSourceProblem,
  safeUploadName,
} from './schemas.js';

/* ------------------------------------------------- the hosted source ceiling */

test('the hosted source cap is 20 000 characters and sits beside the 32 MB body cap', () => {
  // Both numbers are asserted rather than described: D2 asks for "a 20 k-char
  // cap on hosted source text alongside the existing 32 MB body caps", and a
  // test that only checked the relationship between them would pass after
  // somebody halved both.
  assert.equal(MAX_HOSTED_SOURCE_CHARS, 20_000);
  assert.equal(MAX_UPLOAD_BYTES, 32 * 1024 * 1024);
});

test('exactly at the cap is accepted and one character over is refused', () => {
  assert.equal(hostedSourceProblem('a'.repeat(MAX_HOSTED_SOURCE_CHARS)), undefined);
  assert.notEqual(hostedSourceProblem('a'.repeat(MAX_HOSTED_SOURCE_CHARS + 1)), undefined);
});

test('a source that is absent or comfortably short is not a problem', () => {
  // `undefined` is the url/filePath/upload case: there are no characters to
  // count, and returning a complaint there would refuse every non-paste source.
  assert.equal(hostedSourceProblem(undefined), undefined);
  assert.equal(hostedSourceProblem(''), undefined);
  assert.equal(hostedSourceProblem('the sinoatrial node fires first'), undefined);
});

test('the refusal names both the overage and the ceiling', () => {
  const message = hostedSourceProblem('a'.repeat(31_500));
  assert.ok(message, 'a 31 500-character paste must be refused');
  // Thousands separators included: the message is rendered straight into the
  // studio, and "31500" beside "20000" is the kind of wall of digits a reader
  // has to count. If the formatting changes, the copy has changed.
  assert.match(message, /31,500/);
  assert.match(message, /20,000/);
});

test('the cap counts the same units as the SourceText ceiling', () => {
  // Astral plane: one code point, two UTF-16 units. `String.length` — which is
  // what zod's `.max()` on `SourceText` measures — sees 2 per emoji, so 10 000
  // of them is exactly the cap and 10 001 is over it. Counting code points here
  // instead would admit a paste the schema itself would then have to reject.
  const emoji = '🫀';
  assert.equal(emoji.length, 2, 'the premise of this test is a surrogate pair');
  assert.equal(hostedSourceProblem(emoji.repeat(MAX_HOSTED_SOURCE_CHARS / 2)), undefined);
  assert.notEqual(hostedSourceProblem(emoji.repeat(MAX_HOSTED_SOURCE_CHARS / 2 + 1)), undefined);
});

test('leading and trailing whitespace does not smuggle a paste past the cap', () => {
  // The route hands `hostedSourceProblem` the *parsed* field, and `SourceText`
  // is `.trim()`ed by zod before the ceiling applies — so padding is gone by
  // then. This asserts the shape of the pair rather than the trimming: a string
  // whose non-space content is over the cap is refused however it is padded.
  const overflowing = ` ${'a'.repeat(MAX_HOSTED_SOURCE_CHARS + 1)} `;
  assert.notEqual(hostedSourceProblem(overflowing.trim()), undefined);
});

/* ------------------------------------------------------------ upload filenames */

test('an uploaded filename cannot escape the project directory', () => {
  // The other half of the body caps: a 32 MB limit is no protection at all if
  // the bytes can be written outside the project directory. The extension has
  // to survive because `ingest` dispatches on it.
  assert.equal(safeUploadName('../../etc/passwd.md'), 'passwd.md');
  assert.equal(safeUploadName('C:\\Users\\me\\notes on the heart!.md'), 'notes-on-the-heart.md');
  assert.equal(safeUploadName('.md'), 'upload.md');
  assert.equal(safeUploadName('....'), 'upload.txt');
});
