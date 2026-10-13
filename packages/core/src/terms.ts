/**
 * The technical vocabulary in a passage of speech.
 *
 * A chalkboard explanation writes the word as it says it. That is not decoration:
 * a term the learner has only *heard* is a term they cannot look up, cannot spell
 * and will not recognise the next time it goes past. Measured on a photosynthesis
 * render, eleven of fourteen technical terms were spoken and never written — the
 * board carried 51 words against 203 spoken, and those 51 were beat headings.
 *
 * So both lesson authors need to be able to name the vocabulary a beat introduces,
 * and the quality gate needs to be able to notice when one does not. This module is
 * the shared definition of what counts, and it is deliberately conservative: three
 * rules, each about the *form* of the word rather than about a list of subjects,
 * because a topic list would only ever cover the topics someone thought of.
 *
 *  - **An initialism or a formula** — two or more capitals in one token: ATP, NADPH,
 *    G3P, RuBisCO, CO₂, mRNA. The airtight case, and the one that matters most now
 *    that the voice stage spells initialisms out letter by letter: "ay tee pee" is
 *    unrecoverable unless the letters are also on the board.
 *  - **A name used as a term** — a capitalised word mid-sentence, with the noun it
 *    qualifies when there is one: "the Calvin cycle", "Napoleon". Sentence-initial
 *    capitals are excluded, because that is just how sentences start.
 *  - **A long content word** — seven letters or more, not everyday English. This is
 *    the recall rule and the loose one, which is why callers rank and cap: see
 *    `technicalTerms`.
 *
 * Verbatim throughout. Every consumer has to *find* these words again — the voice
 * stage aligns a cue to them, the board searches its own text for them — so a term
 * is returned exactly as the passage wrote it, plural and all. Singularising
 * "thylakoids" would produce a word the narration never says.
 */

/** A word or short phrase the passage introduces, and why it counts as one. */
export type Term = {
  /** Verbatim from the passage, so a cue built from it resolves. */
  text: string;
  /**
   * Which rule caught it. `initialism` and `name` are certain enough to be
   * *required* on the board (see `critiqueLesson`); `word` is a suggestion.
   */
  kind: 'initialism' | 'name' | 'word';
  /** Character offset of its first occurrence, so callers can keep spoken order. */
  at: number;
};

/**
 * Long everyday words, so the third rule does not offer "important" as vocabulary.
 *
 * Only words of seven letters or more are here, because shorter ones can never be
 * candidates. This is not `STOPWORDS` in `@inkcast/planner` and should not be merged
 * with it: that list removes function words when *scoring* content, and it is made of
 * exactly the short words this one cannot contain. Two lists, no overlap, different
 * jobs.
 */
const EVERYDAY = new Set(
  (
    'because therefore however although through without another something anything ' +
    'everything nothing someone somebody everyone anybody yourself himself herself ' +
    'themselves ourselves different difference important example examples actually ' +
    'together usually probably possible possibly particular especially generally ' +
    'sometimes question questions problem problems several various further instead ' +
    'already whether between against certain suppose consider continue explain ' +
    'produce provide receive require include picture imagine believe thought ' +
    'otherwise whatever whenever wherever anywhere nowhere everywhere numbers amounts ' +
    'exactly percent million billion minutes seconds version process system systems ' +
    'sentence purpose reason reasons obvious enough direction directions measure ' +
    // Words about the explanation rather than about the subject. A board draws an
    // equation; writing the word "equation" next to it teaches nobody anything.
    'equation equations summary details ' +
    // Third-person verb forms, which the inflection rule below cannot see: it catches
    // "releasing" and "released" and has no way to catch "releases". Listing the
    // common ones is the honest patch for a known gap in that rule.
    'become becomes contains consists depends appears remains follows reaches ' +
    'happens measures requires includes provides produces suggests explains'
  ).split(' '),
);

/**
 * Word forms that are not vocabulary whatever their length: adverbs, participles and
 * superlatives. "Interesting", "released" and "steepest" are how a sentence is built,
 * not what it is about.
 */
const INFLECTED = /(?:ly|ing|ed|est)$/;

/** Enough of a word for the term rules to be about the word rather than about noise. */
const MIN_WORD = 7;
/** A noun a name may qualify has to be a word, not "a" or "of". */
const MIN_QUALIFIED = 4;

const TOKEN = /[\p{L}\p{N}][\p{L}\p{N}'’₀-₉-]*/gu;

type Token = { word: string; start: number; end: number; opensSentence: boolean };

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(TOKEN)) {
    if (m.index === undefined) continue;
    const before = text.slice(0, m.index);
    // A sentence opens the passage, or follows terminal punctuation — and an opening
    // quote or bracket does not change that.
    const opensSentence = /(?:^|[.!?][\s"'“”()]*)$/.test(before);
    out.push({ word: m[0], start: m.index, end: m.index + m[0].length, opensSentence });
  }
  return out;
}

function capitals(word: string): number {
  return (word.match(/\p{Lu}/gu) ?? []).length;
}

/**
 * A capitalised word with an ordinary lowercase tail: `Calvin`, not `NADPH`.
 *
 * Singular and at least four letters, both learned from false positives on a real
 * derived narration. "Six molecules of carbon dioxide" offered `Six molecules`, and a
 * heading run into the following sentence offered `Chemists write` — a plural common
 * noun that was only capitalised because it began a sentence somewhere upstream. A
 * name that names something is singular: the Calvin cycle, the Doppler effect,
 * Napoleon.
 */
function isName(word: string): boolean {
  return /^\p{Lu}\p{Ll}{3,}$/u.test(word) && !word.endsWith('s');
}

/**
 * Seven letters or more of ordinary word, not everyday English.
 *
 * A hyphenated compound counts only when one of its own parts is a long word:
 * `self-attention` yes, `one-line` and `five-carbon` no. Measured together the
 * compound clears the length bar while being a description rather than a term, which
 * is how "the one-line version" offered itself as vocabulary.
 */
function isLongWord(word: string): boolean {
  const plain = word.toLowerCase();
  if (EVERYDAY.has(plain)) return false;
  if (INFLECTED.test(plain)) return false;
  const letters = (s: string): number => s.replace(/[^\p{L}]/gu, '').length;
  const parts = plain.split('-');
  return Math.max(...parts.map(letters)) >= MIN_WORD;
}

/**
 * Whether two terms are the same word for the purpose of writing it down.
 *
 * A substring test in both directions, case-insensitively, so "molecule" and
 * "molecules" are one term and so are "membrane" and "membranes". Exact-string
 * deduplication is not enough: a real derived beat offered both forms of *molecule* and
 * a board that writes both has written nothing twice. Every consumer of a term list
 * needs this test — the detector within one passage, the compiler across a whole lesson
 * — so it lives with the terms.
 */
export function sameTerm(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x.includes(y) || y.includes(x);
}

/**
 * Every candidate term in a passage, in the order it is spoken, with the forms of one
 * word collapsed to the first one said.
 */
export function findTerms(text: string): Term[] {
  const tokens = tokenize(text);
  const out: Term[] = [];
  const keep = (term: Term): void => {
    if (out.some((seen) => sameTerm(seen.text, term.text))) return;
    out.push(term);
  };

  tokens.forEach((t, i) => {
    if (capitals(t.word) >= 2) {
      keep({ text: t.word, kind: 'initialism', at: t.start });
      return;
    }
    if (!t.opensSentence && isName(t.word)) {
      // A name is often a name *for* something — the Calvin cycle, the Doppler effect,
      // the British fleet — and the noun it qualifies is the half the learner needs.
      //
      // It pairs only after an article, because "the X y" is the form in which a name
      // names a thing. Without that guard the next word is as likely to be a verb: the
      // shipped longitude lesson offered `London says`, which is a sentence, not
      // vocabulary. Unqualified, the name stands alone — which is right for a person
      // ("Harrison", "Napoleon"), where the name *is* the term.
      const previous = tokens[i - 1]?.word.toLowerCase();
      const next = tokens[i + 1];
      const qualifies =
        (previous === 'the' || previous === 'a' || previous === 'an') &&
        next !== undefined &&
        next.start === t.end + 1 &&
        /^\p{Ll}/u.test(next.word) &&
        next.word.length >= MIN_QUALIFIED &&
        !EVERYDAY.has(next.word.toLowerCase()) &&
        !INFLECTED.test(next.word.toLowerCase());
      keep({
        text: qualifies ? text.slice(t.start, next.end) : t.word,
        kind: 'name',
        at: t.start,
      });
      return;
    }
    if (isLongWord(t.word)) keep({ text: t.word, kind: 'word', at: t.start });
  });

  return out;
}

/**
 * The best few terms in a passage, in spoken order.
 *
 * Ranked before it is capped, because the cap is what makes the loose third rule
 * safe: a beat that says both "chlorophyll" and "surface" writes chlorophyll. An
 * initialism outranks a name, a name outranks a long word, and a longer word
 * outranks a shorter one — length being the only honest proxy for "the learner has
 * probably not met this" that does not need a corpus.
 *
 * The survivors come back in the order they are *said*, not in rank order, so the
 * board can write them left to right as the narrator reaches them.
 */
export function technicalTerms(text: string, limit = 3): string[] {
  const rank: Record<Term['kind'], number> = { initialism: 0, name: 1, word: 2 };
  return findTerms(text)
    .slice()
    .sort((a, b) => rank[a.kind] - rank[b.kind] || b.text.length - a.text.length || a.at - b.at)
    .slice(0, Math.max(0, limit))
    .sort((a, b) => a.at - b.at)
    .map((t) => t.text);
}
