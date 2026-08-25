/**
 * Narration as it will be spoken: normalisation, tokenisation, and locating a
 * phrase in the words.
 *
 * Narration arrives from the planner as prose that may still carry markdown,
 * maths symbols, currency and bare digits. Every TTS engine we support reads
 * that badly — Kokoro's phonemiser and macOS `say` will happily say "dollar
 * five" or spell out an asterisk — so quality lives or dies here, before a
 * single sample is generated.
 *
 * The pipeline is deliberately ordered:
 *
 *   1. `foldScripts`          Unicode sub/superscripts -> notation later rules read
 *   2. `stripLatex`           `$…$` and `\command{…}` -> the glyphs and arithmetic
 *                             the symbol and number tables already speak
 *   3. `stripMarkdown`        structure -> plain sentences with real punctuation
 *   4. `expandAbbreviations`  removes the internal full stops ("e.g.") that
 *                             would otherwise fool the sentence splitter
 *   5. `speakInitialisms`     ATP -> "ay tee pee", with an exception list
 *   6. `splitSentences`       so each sentence can be normalised and terminated
 *                             independently, giving the engine clean prosody
 *   7. `speakSymbols`         maths/typography -> words
 *   8. `speakNumbers`         digits, money, units, ranges -> words
 *   9. `tidy`                 whitespace, punctuation, capitalisation
 *
 * Steps 1 and 2 arrived with plan item 4.4, which closed the gaps the audit found
 * by pointing this module at real notation (S2-c/S6-c). Their position in front of
 * the markdown stripper is load-bearing, and `normalizeNarrationDetailed` says why.
 *
 * Everything is pure and deterministic, which matters: the normalised string is
 * what gets hashed into the per-scene cache key.
 *
 * ## Why this lives in core
 *
 * It was the voice stage's `text.ts` until plan item 4.1, and moved for the same
 * reason `fontmetrics.ts` and `palette.ts` did: two stages were about to measure
 * one thing. `Enter.cueWord` is an index into *this* module's token stream, and
 * the planner is what writes it — so the planner has to tokenise narration with
 * the very function the voice stage will later count with. A second normaliser in
 * the planner would be a second opinion about which word is word seven, which is
 * exactly the ambiguity the index exists to remove.
 *
 * So the bottom half of this file is the tokeniser of record: `matchTokens`,
 * `narrationTokens` (normalise, then tokenise — the stream indices are into), and
 * `cueWordIndex`, which is how an authored phrase becomes a number. Placement —
 * turning that number into a second of audio — stays in `voice/src/cue.ts`, where
 * the measurements are.
 */

/* ------------------------------------------------- sub- and superscripts */

/** Subscript codepoints, in the order of `SUBSCRIPT_PLAIN`. */
const SUBSCRIPTS = '₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ';
const SUBSCRIPT_PLAIN = '0123456789+-=()aehijklmnoprstuvx';
/** Superscripts, minus ² and ³ — see `foldScripts`. */
const SUPERSCRIPTS = '⁰¹⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ';
const SUPERSCRIPT_PLAIN = '01456789+-=()ni';

/**
 * Fold Unicode sub- and superscripts into notation the rest of the pipeline
 * already speaks.
 *
 * The gap this closes was found by pointing the normaliser at real notation
 * (audit S2-c): `H₂O` came out of it as "H₂O", because a subscript digit is not
 * a digit to any regex here and not a letter to the initialism speller either.
 * The engine then said whatever it says about an unknown glyph — for the one
 * formula in a chemistry explainer that the board never writes down.
 *
 * Two rules, and the second is the interesting one:
 *
 * - A superscript becomes `^n`, which `speakSymbols` already turns into "to the
 *   power of n". **² and ³ are deliberately left alone**: `SYMBOLS` reads them as
 *   "squared" and "cubed", which is how a person says them, and folding them here
 *   would put a second opinion about `x²` in a second place.
 * - A subscript digit after a capital stays *attached* — `H₂O` → `H2O`, which the
 *   initialism speller then reads out as "aitch two oh", the way a chemist reads
 *   it. After a lowercase identifier the same digit becomes its own word — `x₁` →
 *   `x 1` → "x one" — because that is an index, not part of a name.
 */
export function foldScripts(input: string): string {
  let s = input;
  // A whole run at a time, so `C₆H₁₂O₆` is three folds and not five: matching one
  // digit with its predecessor would take the second digit of `₁₂` for the start
  // of a new run and hand it no predecessor at all.
  s = s.replace(/([A-Za-z0-9)\]])?([₀-₉]+)/gu, (_m, before: string | undefined, run: string) => {
    const plain = [...run].map((ch) => SUBSCRIPT_PLAIN[SUBSCRIPTS.indexOf(ch)] ?? '').join('');
    // A formula's subscript belongs to the token before it; an index does not.
    const attached = /[A-Z0-9]/.test(before ?? '');
    return `${before ?? ''}${attached ? '' : ' '}${plain}`;
  });
  s = s.replace(
    new RegExp(`[${SUBSCRIPTS}]`, 'gu'),
    (ch) => SUBSCRIPT_PLAIN[SUBSCRIPTS.indexOf(ch)] ?? '',
  );
  s = s.replace(new RegExp(`[${SUPERSCRIPTS}]+`, 'gu'), (run) => {
    const plain = [...run].map((ch) => SUPERSCRIPT_PLAIN[SUPERSCRIPTS.indexOf(ch)] ?? '').join('');
    return plain ? `^${plain}` : '';
  });
  return s;
}

/* --------------------------------------------------------------------- LaTeX */

/**
 * LaTeX commands worth keeping, mapped to the glyph `SYMBOLS` already speaks.
 *
 * One catalogue, not two: `\alpha` resolves to `α` and the Greek table below
 * decides what that sounds like, so a voice that learns to say a symbol learns it
 * once. Anything not here is dropped by the sweep at the end of `stripLatex` —
 * an unknown command name read aloud is noise, and the argument it wraps is
 * usually the part that meant something.
 */
const LATEX_GLYPHS: Array<readonly [string, string]> = [
  ['alpha', 'α'],
  ['beta', 'β'],
  ['gamma', 'γ'],
  ['delta', 'δ'],
  ['Delta', 'Δ'],
  ['epsilon', 'ε'],
  ['varepsilon', 'ε'],
  ['eta', 'η'],
  ['theta', 'θ'],
  ['Theta', 'Θ'],
  ['lambda', 'λ'],
  ['Lambda', 'Λ'],
  ['mu', 'μ'],
  ['pi', 'π'],
  ['Pi', 'Π'],
  ['rho', 'ρ'],
  ['sigma', 'σ'],
  ['Sigma', 'Σ'],
  ['tau', 'τ'],
  ['phi', 'φ'],
  ['Phi', 'Φ'],
  ['omega', 'ω'],
  ['Omega', 'Ω'],
  ['times', '×'],
  ['cdot', '×'],
  ['div', '÷'],
  ['pm', '±'],
  ['approx', '≈'],
  ['neq', '≠'],
  ['ne', '≠'],
  ['leq', '≤'],
  ['le', '≤'],
  ['geq', '≥'],
  ['ge', '≥'],
  ['infty', '∞'],
  ['partial', '∂'],
  ['nabla', '∇'],
  ['sum', '∑'],
  ['prod', '∏'],
  ['int', '∫'],
  ['in', '∈'],
  ['forall', '∀'],
  ['exists', '∃'],
  ['emptyset', '∅'],
  ['rightarrow', '→'],
  ['Rightarrow', '⇒'],
  ['to', '→'],
  ['leftarrow', '←'],
  ['langle', '⟨'],
  ['rangle', '⟩'],
];

/**
 * True when a `$…$` span is maths rather than two prices in one sentence.
 *
 * "It costs $5 to $10" contains a perfectly good `$…$` match, and reading it as
 * maths would delete both dollar signs and turn money into bare numbers. A LaTeX
 * span, by contrast, always carries LaTeX: a backslash, a script marker, or a
 * brace. That is the whole test, and it is why this exists instead of a bare
 * `$…$` strip.
 */
function looksLikeMath(inner: string): boolean {
  return /[\\^_{}]/.test(inner);
}

/**
 * Remove the LaTeX a model leaves in prose it was asked to write for the ear.
 *
 * The audit found `\frac{1}{2} of $x^2$` reaching the engine verbatim — "backslash
 * frac one two of dollar x squared dollar", or whatever a phonemiser makes of it.
 * The defence that matters is elsewhere and is real: notation belongs in an
 * element's `tex` field, which is *drawn*, so narration should not be carrying it
 * at all. This is what happens when it does anyway.
 *
 * The order is the design. Fractions and roots become the arithmetic the number
 * and symbol tables already read; known commands become their glyph; scripts lose
 * their braces so `x^{2}` is the `x^2` the symbol table knows; and only then is
 * every surviving command dropped. Running the general sweep first would eat
 * `\frac` and leave "one two".
 */
export function stripLatex(input: string): string {
  let s = input;

  // Display and inline maths: keep the contents, drop the delimiters.
  s = s.replace(/\$\$([\s\S]*?)\$\$/g, (m, inner: string) =>
    looksLikeMath(inner) ? ` ${inner} ` : m,
  );
  s = s.replace(/\$([^$\n]*)\$/g, (m, inner: string) => (looksLikeMath(inner) ? ` ${inner} ` : m));

  // Structures that carry meaning in their arguments, before the sweep that
  // drops command names.
  s = s.replace(/\\d?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, ' $1/$2 ');
  s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, ' √$1 ');
  s = s.replace(
    /\\(?:text|mathrm|mathbf|mathit|mathbb|mathcal|operatorname)\s*\{([^{}]*)\}/g,
    ' $1 ',
  );
  for (const [name, glyph] of LATEX_GLYPHS) {
    s = s.replace(new RegExp(`\\\\${name}(?![A-Za-z])`, 'g'), glyph);
  }

  // `x^{2}` is the `x^2` the symbol table reads; `x_{i}` is the `x_i` it reads.
  s = s.replace(/([\^_])\s*\{([^{}]*)\}/g, '$1$2');
  // A LaTeX line break is a pause, not a word.
  s = s.replace(/\\\\/g, ', ');
  // Everything still wearing a backslash. See the module comment on LATEX_GLYPHS.
  s = s.replace(/\\[A-Za-z]+\*?/g, ' ');
  s = s.replace(/\\([%$&#_{}])/g, '$1');
  return s;
}

/* ------------------------------------------------------------------ markdown */

/** True for markdown table delimiter rows and horizontal rules. */
function isRuleOrDelimiter(line: string): boolean {
  return /^[\s|:*_-]+$/.test(line) && /[-*_|]/.test(line);
}

/**
 * Reduce markdown to speakable prose.
 *
 * Blocks (separated by blank lines) are treated as units: lines inside a block
 * are joined with a space, because hard-wrapped prose must not gain a full stop
 * mid-sentence. Headings and list items *do* get a terminating full stop, since
 * they are standalone utterances and TTS needs the pause.
 */
export function stripMarkdown(input: string): string {
  let s = input.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n');

  s = s.replace(/```[\s\S]*?(?:```|$)/g, ' '); // fenced code
  s = s.replace(/~~~[\s\S]*?(?:~~~|$)/g, ' ');
  s = s.replace(/`([^`]*)`/g, '$1'); // inline code
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1'); // images -> alt text
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'); // links -> link text
  s = s.replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1'); // reference links
  s = s.replace(/\[\^[^\]]*\]/g, ''); // footnote markers
  s = s.replace(/<[^<>\s][^<>]*>/g, ' '); // raw HTML / autolinks

  const blocks = s.split(/\n[ \t]*\n+/);
  const out: string[] = [];

  for (const block of blocks) {
    const lines: string[] = [];
    for (const raw of block.split('\n')) {
      let line = raw.trim();
      if (!line || isRuleOrDelimiter(line)) continue;

      const heading = /^#{1,6}\s+/.test(line);
      line = line.replace(/^#{1,6}\s+/, '');
      line = line.replace(/^>+\s?/, ''); // blockquote
      const bullet = /^(?:[-*+]\s+|\d+[.)]\s+)/.test(line);
      line = line.replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, '');
      line = line.replace(/^\[[ xX]\]\s*/, ''); // task list checkbox

      // Table row -> comma-separated clause.
      if (line.startsWith('|')) {
        line = line
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .replace(/\s*\|\s*/g, ', ');
      }

      line = line.replace(/(\*\*|__)(.+?)\1/g, '$2'); // bold
      line = line.replace(/(\*|_)(?=\S)([^*_]+?)(?<=\S)\1/g, '$2'); // emphasis
      line = line.replace(/~~(.+?)~~/g, '$1'); // strikethrough
      line = line.trim();
      if (!line) continue;

      if ((heading || bullet) && !/[.!?;:,]["')\]]?$/.test(line)) line += '.';
      lines.push(line);
    }
    if (!lines.length) continue;

    let text = lines.join(' ').trim();
    if (!/[.!?]["')\]]?$/.test(text)) text += '.';
    out.push(text);
  }

  return out
    .join(' ')
    .replace(/[^\S\n]{2,}/g, ' ')
    .trim();
}

/* ------------------------------------------------------------- abbreviations */

/**
 * Expanded before sentence splitting, precisely because most of these contain a
 * full stop that would otherwise be read as a sentence boundary.
 */
export const ABBREVIATIONS: Array<readonly [RegExp, string]> = [
  [/\be\.\s?g\.\s*,?/gi, 'for example,'],
  [/\bi\.\s?e\.\s*,?/gi, 'that is,'],
  [/\ba\.\s?k\.\s?a\.?/gi, 'also known as'],
  [/\bet\s+al\./gi, 'and others'],
  [/\betc\.?(?=$|[\s,;:!?])/gi, 'and so on'],
  [/\bcf\./gi, 'compare'],
  [/\bvs\.?(?=$|[\s,;:!?])/gi, 'versus'],
  [/\bapprox\./gi, 'approximately'],
  [/\bavg\./gi, 'average'],
  [/\bmin\.(?=$|[\s,;:!?])/gi, 'minimum'],
  [/\bmax\.(?=$|[\s,;:!?])/gi, 'maximum'],
  [/\bfig\./gi, 'figure'],
  [/\beq\./gi, 'equation'],
  [/\bch\./gi, 'chapter'],
  [/\bp\.\s?p\./gi, 'pages'],
  [/\bno\.\s*(?=\d)/gi, 'number '],
  [/\bPh\.?\s?D\.?/g, 'PhD'],
  [/\bDr\./g, 'Doctor'],
  [/\bProf\./g, 'Professor'],
  [/\bMrs\./g, 'Missus'],
  [/\bMr\./g, 'Mister'],
  [/\bMs\./g, 'Miz'],
  [/\bSt\./g, 'Saint'],
  [/\bU\.\s?S\.\s?A\./g, 'United States'],
  [/\bU\.\s?S\.(?=$|[\s,;:!?])/g, 'United States'],
  [/\bU\.\s?K\.(?=$|[\s,;:!?])/g, 'United Kingdom'],
  [/\bE\.\s?U\.(?=$|[\s,;:!?])/g, 'European Union'],
  [/\ba\.\s?m\.(?=$|[\s,;:!?])/gi, 'in the morning'],
  [/\bp\.\s?m\.(?=$|[\s,;:!?])/gi, 'in the afternoon'],
  [/\bw\/o\b/gi, 'without'],
  [/\bw\/\s/gi, 'with '],
  // Arrows are expanded here too: they are punctuation-like glue between
  // clauses and reading them as words keeps sentence splitting honest.
  [/<=>|<->|↔|⇔/g, ' is equivalent to '],
  [/=>|->|→|⟶|⇒/g, ' leads to '],
  [/<=|<-|←|⟵/g, ' comes from '],
];

export function expandAbbreviations(input: string): string {
  let s = input;
  for (const [re, replacement] of ABBREVIATIONS) s = s.replace(re, replacement);
  return s;
}

/* ------------------------------------------------------------- initialisms */

/**
 * How each letter is said aloud.
 *
 * Spelled phonetically rather than handed to the engine as spaced capitals
 * ("A T P"), because what an engine does with a bare capital is its own business
 * and varies by voice: Kokoro is a phoneme model, so the reliable way to get
 * "ay tee pee" is to write the sounds. This is what makes the fix engine-independent
 * instead of tuned to one provider's letter handling.
 */
const LETTER_SOUNDS: Record<string, string> = {
  a: 'ay',
  b: 'bee',
  c: 'see',
  d: 'dee',
  e: 'ee',
  f: 'eff',
  g: 'gee',
  h: 'aitch',
  i: 'eye',
  j: 'jay',
  k: 'kay',
  l: 'ell',
  m: 'em',
  n: 'en',
  o: 'oh',
  p: 'pee',
  q: 'cue',
  r: 'are',
  s: 'ess',
  t: 'tee',
  u: 'you',
  v: 'vee',
  w: 'double you',
  x: 'ex',
  y: 'why',
  z: 'zee',
};

const DIGIT_SOUNDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
];

/**
 * Capitalised runs that are said as *words*, not spelled out.
 *
 * Two kinds, and both have to be here or the rule below does real damage.
 *
 * **Acronyms pronounced as words.** NASA is "nassa", not "en ay ess ay". There is no
 * way to derive this — English simply decided — so it is a list, and it is meant to be
 * extended when a topic needs it.
 *
 * **Words a writer might capitalise for emphasis.** "This is NOT the minimum" must not
 * become "en oh tee". This is the false positive that matters, because narration is
 * written by a model that may well shout. It is a smaller risk than it looks — the
 * lesson schema has a real `emphasis` field now, so shouting is not the sanctioned way
 * to stress a word — but it costs nothing to guard.
 */
const SAID_AS_WORDS = new Set([
  // pronounced as words
  'NASA',
  'LASER',
  'RADAR',
  'SONAR',
  'SCUBA',
  'NATO',
  'UNESCO',
  'UNICEF',
  'OPEC',
  'AIDS',
  'RAM',
  'ROM',
  'PIN',
  'GIF',
  'JPEG',
  'PNG',
  'WYSIWYG',
  'MODEM',
  'COVID',
  // capitalised for emphasis
  'NOT',
  'ALL',
  'ONE',
  'TWO',
  'NOW',
  'NEW',
  'YES',
  'NO',
  'BUT',
  'AND',
  'THE',
  'YOU',
  'WE',
  'IT',
  'IS',
  'ARE',
  'WAS',
  'ANY',
  'EVERY',
  'NEVER',
  'ALWAYS',
  'ONLY',
  'MUST',
  'THIS',
  'THAT',
  'WHY',
  'HOW',
  'WHAT',
  'SAME',
  'REAL',
  'BEST',
  'WORST',
  'OK',
  // roman numerals a title might carry ("World War II")
  'II',
  'III',
  'IV',
  'VI',
  'VII',
  'VIII',
  'IX',
  'XI',
  'XII',
]);

/**
 * An initialism, in two shapes: a lowercase letter followed by capitals (`mRNA`,
 * `pH`), or two or more capitals with optional digits (`ATP`, `CO2`). The second
 * shape needs two capitals or every ordinary capitalised word would match; the first
 * needs only one, because the lowercase lead is itself the signal.
 */
const INITIALISM = /\b(?:([a-z])([A-Z][A-Z0-9]{0,7})|()([A-Z][A-Z0-9]{1,7}))\b/g;

/**
 * Say initialisms as letters rather than as words.
 *
 * The bug this fixes was audible and specific: the narrator said "ATP" as a syllable,
 * and a listener who cannot see the letters written anywhere — the board never writes
 * them — has no way to recover what was meant. Technical narration is full of these
 * (ATP, NADPH, G3P, mRNA, pH, DNA), and every one of them is unintelligible spoken as
 * a blob.
 *
 * The default is to **spell**, with an explicit list of exceptions, rather than the
 * other way around. That is deliberate: this stage exists for explanatory narration,
 * where an unknown capitalised run is far more likely to be a technical initialism
 * than an acronym-word, and being wrong by spelling out "NASA" is a smaller failure
 * than being wrong by mumbling "NADPH".
 *
 * Case is meaningful and is preserved: `mRNA` is "em are en ay", not "MRNA" — which is
 * what `tidy` used to turn it into at the start of a sentence, destroying the one
 * signal that said how to read it.
 */
export function speakInitialisms(input: string): string {
  return input.replace(INITIALISM, (whole, l1: string, b1: string, l2: string, b2: string) => {
    const lead = l1 ?? l2 ?? '';
    const body = b1 ?? b2;
    if (!lead && SAID_AS_WORDS.has(body)) return whole;
    const letters = `${lead}${body}`
      .split('')
      .map((ch) => {
        const lower = ch.toLowerCase();
        if (LETTER_SOUNDS[lower]) return LETTER_SOUNDS[lower];
        const digit = Number.parseInt(ch, 10);
        return Number.isNaN(digit) ? ch : DIGIT_SOUNDS[digit];
      })
      .join(' ');
    return letters;
  });
}

/* ---------------------------------------------------------------- sentences */

/**
 * Split on terminal punctuation that is followed by whitespace or end-of-input.
 *
 * Requiring the trailing whitespace is what makes decimals ("3.14"), version
 * strings ("1.2.3") and file names safe without a lookahead table. Single
 * initials ("J. Smith") are the one remaining trap, so they are guarded.
 */
export function splitSentences(input: string): string[] {
  const s = input.trim();
  if (!s) return [];

  const parts: string[] = [];
  let start = 0;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '.' && c !== '!' && c !== '?') continue;

    // Absorb trailing terminators and closing quotes/brackets.
    let end = i + 1;
    while (end < s.length && /["'”’)\]}.!?]/.test(s[end] ?? '')) end++;

    const next = s[end];
    if (next !== undefined && !/\s/.test(next)) continue; // mid-token dot

    // "J. Smith" — a lone capital before the dot is an initial, not an end.
    if (
      c === '.' &&
      end === i + 1 &&
      /[A-Z]/.test(s[i - 1] ?? '') &&
      !/[A-Za-z]/.test(s[i - 2] ?? '')
    ) {
      continue;
    }

    const piece = s.slice(start, end).trim();
    if (piece) parts.push(piece);
    start = end;
    i = end - 1;
  }

  const tail = s.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

/* ------------------------------------------------------------------ numbers */

const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES = ['', 'thousand', 'million', 'billion', 'trillion'];

function under100(n: number): string {
  if (n < 20) return ONES[n] ?? '';
  const t = Math.floor(n / 10);
  const r = n % 10;
  return r ? `${TENS[t] ?? ''} ${ONES[r] ?? ''}` : (TENS[t] ?? '');
}

function under1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} hundred`);
  if (r) parts.push(under100(r));
  return parts.join(' ');
}

/** Speak each digit separately — for ids, and for anything past `trillion`. */
export function digitsToWords(digits: string): string {
  return digits
    .replace(/\D/g, '')
    .split('')
    .map((d) => ONES[Number(d)] ?? '')
    .join(' ')
    .trim();
}

/** Cardinal number in words. Integers up to just under 10^15. */
export function numberToWords(value: number): string {
  if (!Number.isFinite(value)) return '';
  if (value < 0) return `minus ${numberToWords(-value)}`;
  if (!Number.isInteger(value)) return decimalToWords(String(value));

  let n = Math.round(value);
  if (n === 0) return 'zero';
  if (n >= 1e15) return digitsToWords(String(n));

  const groups: string[] = [];
  let scale = 0;
  while (n > 0) {
    const g = n % 1000;
    if (g) {
      const name = SCALES[scale];
      groups.unshift(name ? `${under1000(g)} ${name}` : under1000(g));
    }
    n = Math.floor(n / 1000);
    scale++;
  }
  return groups.join(' ');
}

/** "3.14" -> "three point one four". Digits after the point are spoken singly. */
export function decimalToWords(text: string): string {
  const negative = text.startsWith('-');
  const [whole = '0', frac] = text.replace(/^[-+]/, '').split('.');
  const head = numberToWords(Number(whole));
  const body = frac ? `${head} point ${digitsToWords(frac)}` : head;
  return negative ? `minus ${body}` : body;
}

/** Ordinals: 1 -> first, 22 -> twenty second. */
export function ordinalToWords(n: number): string {
  const irregular: Record<number, string> = {
    1: 'first',
    2: 'second',
    3: 'third',
    5: 'fifth',
    8: 'eighth',
    9: 'ninth',
    12: 'twelfth',
  };
  if (irregular[n]) return irregular[n];
  if (n < 20) return `${ONES[n] ?? ''}th`;
  if (n % 10 === 0 && n < 100) return `${(TENS[n / 10] ?? '').replace(/y$/, 'ieth')}`;
  if (n < 100) return `${TENS[Math.floor(n / 10)] ?? ''} ${ordinalToWords(n % 10)}`;
  const head = numberToWords(n - (n % 100));
  return n % 100 ? `${head} ${ordinalToWords(n % 100)}` : `${head}th`;
}

/** Years read the way people say them: 1999 -> "nineteen ninety nine". */
export function yearToWords(n: number): string {
  if (n % 1000 === 0) return numberToWords(n);
  if (n % 100 === 0) return `${under100(Math.floor(n / 100))} hundred`;
  if (n >= 2000 && n < 2010) return `two thousand ${ONES[n % 100] ?? ''}`.trim();
  const century = under100(Math.floor(n / 100));
  const rest = n % 100;
  return rest < 10 ? `${century} oh ${ONES[rest] ?? ''}` : `${century} ${under100(rest)}`;
}

const MAGNITUDES: Record<string, string> = {
  k: 'thousand',
  K: 'thousand',
  M: 'million',
  B: 'billion',
  T: 'trillion',
  bn: 'billion',
};

const FRACTIONS: Record<string, string> = {
  '1/2': 'one half',
  '1/3': 'one third',
  '2/3': 'two thirds',
  '1/4': 'one quarter',
  '3/4': 'three quarters',
  '1/5': 'one fifth',
  '1/8': 'one eighth',
  '1/10': 'one tenth',
};

/**
 * Units worth expanding. Deliberately conservative: single-letter units must be
 * space-separated, and ambiguous ones ("in", "a", "b") are left out entirely so
 * "1 in 10" never becomes "one inch ten".
 */
const UNITS: Array<readonly [string, string, string, boolean]> = [
  // [token, singular, plural, may attach without a space]
  ['ms', 'millisecond', 'milliseconds', true],
  ['sec', 'second', 'seconds', true],
  ['secs', 'second', 'seconds', true],
  ['mins', 'minute', 'minutes', true],
  ['min', 'minute', 'minutes', true],
  ['hrs', 'hour', 'hours', true],
  ['hr', 'hour', 'hours', true],
  ['kg', 'kilogram', 'kilograms', true],
  ['mg', 'milligram', 'milligrams', true],
  ['km', 'kilometre', 'kilometres', true],
  ['cm', 'centimetre', 'centimetres', true],
  ['mm', 'millimetre', 'millimetres', true],
  ['KB', 'kilobyte', 'kilobytes', true],
  ['MB', 'megabyte', 'megabytes', true],
  ['GB', 'gigabyte', 'gigabytes', true],
  ['TB', 'terabyte', 'terabytes', true],
  ['GHz', 'gigahertz', 'gigahertz', true],
  ['MHz', 'megahertz', 'megahertz', true],
  ['kHz', 'kilohertz', 'kilohertz', true],
  ['Hz', 'hertz', 'hertz', true],
  ['fps', 'frame per second', 'frames per second', true],
  ['px', 'pixel', 'pixels', true],
  ['s', 'second', 'seconds', false],
  ['m', 'metre', 'metres', false],
  ['g', 'gram', 'grams', false],
];

function plural(word: string, qty: number): string {
  return Math.abs(qty) === 1 ? word : `${word}s`;
}

function money(amount: string, currency: string): string {
  const [whole = '0', cents] = amount.split('.');
  const wholeN = Number(whole.replace(/,/g, ''));
  const names: Record<string, [string, string]> = {
    $: ['dollar', 'cent'],
    '£': ['pound', 'pence'],
    '€': ['euro', 'cent'],
    '¥': ['yen', 'sen'],
  };
  const [major = 'dollar', minor = 'cent'] = names[currency] ?? [];
  const centsN = cents ? Number(cents.padEnd(2, '0').slice(0, 2)) : 0;

  if (wholeN === 0 && centsN > 0) return `${numberToWords(centsN)} ${plural(minor, centsN)}`;
  const head = `${numberToWords(wholeN)} ${plural(major, wholeN)}`;
  if (!centsN) return head;
  return `${head} and ${numberToWords(centsN)} ${plural(minor, centsN)}`;
}

/**
 * Turn digits, currency, units and ranges into words.
 *
 * The rule order matters and is the whole design: the most specific pattern
 * ("$1.2M") must win before the generic one ("1.2") ever sees the text.
 */
export function speakNumbers(input: string): string {
  let s = input;

  // Scientific notation: 1e-3 -> one times ten to the power of minus three
  s = s.replace(
    /(?<!\w)(\d+(?:\.\d+)?)[eE]([-+]?\d+)(?!\w)/g,
    (_m, mantissa: string, exp: string) => {
      const power = exp.startsWith('-')
        ? `minus ${numberToWords(Number(exp.slice(1)))}`
        : numberToWords(Number(exp.replace('+', '')));
      return ` ${decimalToWords(mantissa)} times ten to the power of ${power} `;
    },
  );

  // $1.2M -> one point two million dollars
  s = s.replace(
    /([$£€¥])\s?(\d+(?:,\d{3})*(?:\.\d+)?)\s?(bn|[kKMBT])\b/g,
    (_m, cur: string, num: string, mag: string) => {
      const scale = MAGNITUDES[mag] ?? '';
      const spoken = decimalToWords(num.replace(/,/g, ''));
      const unit = cur === '£' ? 'pounds' : cur === '€' ? 'euros' : cur === '¥' ? 'yen' : 'dollars';
      return ` ${spoken} ${scale} ${unit} `;
    },
  );

  // $5 / $5.50 / $1
  s = s.replace(
    /([$£€¥])\s?(\d+(?:,\d{3})*(?:\.\d+)?)/g,
    (_m, cur: string, num: string) => ` ${money(num.replace(/,/g, ''), cur)} `,
  );

  // 50% / 12.5 %
  s = s.replace(
    /(-?\d+(?:,\d{3})*(?:\.\d+)?)\s?%/g,
    (_m, num: string) => ` ${decimalToWords(num.replace(/,/g, ''))} percent `,
  );

  // 3x / 2.5x / 10×  (multipliers, not the letter x in an identifier)
  s = s.replace(
    /(?<![\w.])(\d+(?:\.\d+)?)\s?[x×](?![\w])/g,
    (_m, num: string) => ` ${decimalToWords(num)} times `,
  );

  // 1st, 22nd, 3rd, 14th
  s = s.replace(/\b(\d+)(st|nd|rd|th)\b/g, (_m, num: string) => ` ${ordinalToWords(Number(num))} `);

  // 3:30 -> three thirty ; 3:05 -> three oh five
  s = s.replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g, (_m, h: string, mm: string) => {
    const minutes = Number(mm);
    const spoken =
      minutes === 0 ? "o'clock" : minutes < 10 ? `oh ${ONES[minutes]}` : under100(minutes);
    return ` ${numberToWords(Number(h))} ${spoken} `;
  });

  // Common fractions read as names, then any other a/b as "a over b".
  s = s.replace(/\b\d+\/\d+\b/g, (m) => {
    const named = FRACTIONS[m];
    return named ? ` ${named} ` : m;
  });
  s = s.replace(
    /\b(\d+)\s?\/\s?(\d+)\b/g,
    (_m, a: string, b: string) => ` ${numberToWords(Number(a))} over ${numberToWords(Number(b))} `,
  );

  // Number + unit.
  for (const [token, singular, plurals, attachable] of UNITS) {
    const gap = attachable ? '\\s?' : '\\s';
    const re = new RegExp(`(-?\\d+(?:,\\d{3})*(?:\\.\\d+)?)${gap}${token}(?![\\w])`, 'g');
    s = s.replace(re, (_m, num: string) => {
      const clean = num.replace(/,/g, '');
      const qty = Number(clean);
      return ` ${decimalToWords(clean)} ${Math.abs(qty) === 1 ? singular : plurals} `;
    });
  }

  // 5M / 3k / 2.4B (no currency)
  s = s.replace(
    /(?<![\w.])(-?\d+(?:\.\d+)?)\s?(bn|[kKMBT])\b/g,
    (_m, num: string, mag: string) => ` ${decimalToWords(num)} ${MAGNITUDES[mag] ?? ''} `,
  );

  // A range that carries a unit ("10-20 °C") must be matched as a whole, or the
  // range rule eats the numbers and abandons the unit.
  s = s.replace(
    /(\d+(?:\.\d+)?)\s?[-–—]\s?(\d+(?:\.\d+)?)\s?°\s?([CF])?/g,
    (_m, a: string, b: string, scale: string | undefined) => {
      const suffix = scale === 'C' ? ' Celsius' : scale === 'F' ? ' Fahrenheit' : '';
      return ` ${decimalToWords(a)} to ${decimalToWords(b)} degrees${suffix} `;
    },
  );

  // Degrees, before ranges for the same reason.
  s = s.replace(
    /(-?\d+(?:\.\d+)?)\s?°\s?C\b/g,
    (_m, n: string) => ` ${decimalToWords(n)} degrees Celsius `,
  );
  s = s.replace(
    /(-?\d+(?:\.\d+)?)\s?°\s?F\b/g,
    (_m, n: string) => ` ${decimalToWords(n)} degrees Fahrenheit `,
  );
  s = s.replace(/(-?\d+(?:\.\d+)?)\s?°/g, (_m, n: string) => ` ${decimalToWords(n)} degrees `);

  // 10-20 / 10–20 -> ten to twenty
  s = s.replace(
    /(?<!\w)(\d+(?:\.\d+)?)\s?[-–—]\s?(\d+(?:\.\d+)?)(?!\w|\.\d)/g,
    (_m, a: string, b: string) => ` ${decimalToWords(a)} to ${decimalToWords(b)} `,
  );

  // Dotted sequences (versions, section numbers): 1.2.3
  s = s.replace(
    /\b\d+(?:\.\d+){2,}\b/g,
    (m) =>
      ` ${m
        .split('.')
        .map((p) => numberToWords(Number(p)))
        .join(' point ')} `,
  );

  // Comma-grouped integers.
  s = s.replace(
    /\b\d{1,3}(?:,\d{3})+\b/g,
    (m) => ` ${numberToWords(Number(m.replace(/,/g, '')))} `,
  );

  // Years, before generic integers so 1999 does not become "one thousand ...".
  // The trailing guard allows a sentence-final full stop but not "1999.5".
  s = s.replace(
    /(?<!\w|\d\.|[$:])(1[89]\d{2}|20[0-3]\d)(?!\w|[:%]|\.\d)/g,
    (m) => ` ${yearToWords(Number(m))} `,
  );

  // Decimals, then anything left. Both guards tolerate a following full stop.
  s = s.replace(/(?<!\w|\d\.)-?\d+\.\d+(?!\w|\.?\d)/g, (m) => ` ${decimalToWords(m)} `);
  s = s.replace(/(?<!\w|\d\.)-?\d+(?!\w|\.\d)/g, (m) => ` ${numberToWords(Number(m))} `);

  // Any degree sign that survived (e.g. "° of freedom").
  s = s.replace(/°/g, ' degrees ');

  return s;
}

/* ------------------------------------------------------------------ symbols */

/** Maths and typography that TTS engines either skip or mispronounce. */
export const SYMBOLS: Array<readonly [RegExp, string]> = [
  [/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/gu, ' '], // emoji & dingbats
  // Dirac notation, before the rules that read `|` as a pause and `⟨⟩` as
  // comparison. `α|0⟩` used to come out as "Alpha, zero ⟩" — a raw bracket handed
  // to a phonemiser, in the one class of lesson (quantum states) that cannot be
  // taught without it. Said the way a physicist says it.
  [/⟨\s*([^|⟨⟩]{1,24})\s*\|\s*([^|⟨⟩]{1,24})\s*⟩/g, ' the inner product of $1 and $2 '],
  [/\|\s*([^|⟨⟩]{1,24})\s*⟩/g, ' ket $1 '],
  [/⟨\s*([^|⟨⟩]{1,24})\s*\|/g, ' bra $1 '],
  [/[⟨⟩]/g, ' '],
  // A stage direction is an instruction to the narrator, not a word for them to
  // read. Square brackets are markup wherever they survive `stripMarkdown`, so a
  // single bracketed word goes; parentheses are ordinary prose ("the slope
  // (gradient) tells you"), so only the known directions go.
  [/\[\s*[A-Za-z]{1,16}\s*\]/g, ' '],
  [
    /\(\s*(?:pause|beat|laughs?|laughter|sighs?|breath|breathes|silence|whispers?|aside|slowly|softly|smiles?|smiling|chuckles?)\s*\)/gi,
    ' ',
  ],
  [/[“”«»„]/g, '"'],
  [/[‘’‚]/g, "'"],
  [/\u00a0/g, ' '],
  [/\s*\.\.\.\s*|…/g, ', '],
  [/\s*(--|[–—])\s*/g, ', '],
  // "2048-dimensional" reads better with the hyphen gone than as a range.
  [/(?<=\d)-(?=[A-Za-z])/g, ' '],
  [/(?<=[A-DF-Za-df-z])-(?=\d)/g, ' '], // keeps '1e-3' intact
  // A spaced hyphen between two short tokens is arithmetic ("w - lr"); anywhere
  // else it is being used as a dash, which is a pause.
  [/(?<=(?:^|\s)[\w.]{1,3})\s-\s(?=[\w.]{1,3}(?:[\s,.;:]|$))/g, ' minus '],
  [/\s-\s/g, ', '],
  [/²/g, ' squared'],
  [/³/g, ' cubed'],
  [/(\w)\s?\^\s?2(?!\w)/g, '$1 squared'],
  [/(\w)\s?\^\s?3(?!\w)/g, '$1 cubed'],
  [/\s?\^\s?/g, ' to the power of '],
  [/(?<=[\w\s)])\+(?=[\w\s(])/g, ' plus '],
  [/≈|~=/g, ' approximately '],
  [/≠|!=/g, ' is not equal to '],
  [/≤|<=/g, ' is less than or equal to '],
  [/≥|>=/g, ' is greater than or equal to '],
  [/==/g, ' equals '],
  [/(?<=[\w\s)])=(?=[\s\w(-])/g, ' equals '],
  [/</g, ' less than '],
  [/>/g, ' greater than '],
  [/±/g, ' plus or minus '],
  [/×/g, ' times '],
  [/÷/g, ' divided by '],
  [/√/g, ' square root of '],
  [/∫/g, ' the integral of '],
  [/∑|Σ/g, ' the sum of '],
  [/∏|Π/g, ' the product of '],
  [/∂/g, ' partial '],
  [/∇/g, ' gradient '],
  [/∞/g, ' infinity '],
  [/∈/g, ' in '],
  [/∀/g, ' for all '],
  [/∃/g, ' there exists '],
  [/∅/g, ' the empty set '],
  [/α/g, ' alpha '],
  [/β/g, ' beta '],
  [/γ/g, ' gamma '],
  [/δ/g, ' delta '],
  [/Δ/g, ' delta '],
  [/ε/g, ' epsilon '],
  [/η/g, ' eta '],
  [/θ|Θ/g, ' theta '],
  [/λ|Λ/g, ' lambda '],
  [/μ/g, ' mu '],
  [/π/g, ' pi '],
  [/ρ/g, ' rho '],
  [/σ/g, ' sigma '],
  [/τ/g, ' tau '],
  [/φ|Φ/g, ' phi '],
  [/ω|Ω/g, ' omega '],
  [/&/g, ' and '],
  [/\band\/or\b/gi, 'and or'],
  [/#(?=\d)/g, 'number '],
  [/(?<=\w)@(?=\w)/g, ' at '],
  [/(?<=[\w\s])\*(?=[\w\s])/g, ' times '], // survivor of markdown stripping
  [/(?<=[a-zA-Z0-9])_(?=[a-zA-Z0-9])/g, ' '], // snake_case
  [/~(?=\d)/g, 'about '],
  [/\|/g, ', '],
  [/["`]/g, ''],
  [/[{}[\]]/g, ' '],
];

export function speakSymbols(input: string): string {
  let s = input;
  for (const [re, replacement] of SYMBOLS) s = s.replace(re, replacement);
  return s;
}

/* --------------------------------------------------------------------- tidy */

/** Collapse whitespace, repair punctuation, guarantee a terminator. */
export function tidy(input: string): string {
  let s = input
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,;:])(?=\S)/g, '$1 ')
    .replace(/(,\s*){2,}/g, ', ')
    .replace(/\.{2,}/g, '.')
    .replace(/,\s*\./g, '.')
    .replace(/^[\s,;:.]+/, '')
    .trim();

  if (!s) return '';
  if (!/[.!?]["')\]]?$/.test(s)) s += '.';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A sentence is worth synthesising only if something in it can be spoken. */
export function hasSpeakableContent(text: string): boolean {
  return /[A-Za-z0-9]/.test(text);
}

/* ------------------------------------------------------------------- public */

export type NormalizeResult = {
  /** The string handed to the TTS engine. */
  text: string;
  /** The normalised sentences, in order — used to chunk long narration. */
  sentences: string[];
};

/**
 * Full pipeline, returning both the joined text and its sentences.
 *
 * `foldScripts` and `stripLatex` run **before** `stripMarkdown`, which looks like
 * the wrong order and is not. Markdown's emphasis rule reads a pair of
 * underscores as italics, and `a_{1} + b_{2}` is a pair of underscores — so a
 * subscripted expression left for markdown to see comes back as `a{1} + b{2}`
 * with the subscripts silently deleted. And a fold has to precede
 * `speakInitialisms` in any case: `H₂O` is only "aitch two oh" if it is `H2O` by
 * the time the initialism speller reaches it.
 */
export function normalizeNarrationDetailed(input: string): NormalizeResult {
  const expanded = speakInitialisms(
    expandAbbreviations(stripMarkdown(stripLatex(foldScripts(input)))),
  );
  const sentences = splitSentences(expanded)
    .map((sentence) => tidy(speakNumbers(speakSymbols(sentence))))
    .filter(hasSpeakableContent);
  return { text: sentences.join(' '), sentences };
}

/**
 * Normalise one scene's narration into speakable text.
 *
 * Deterministic, so it is safe to fold into the per-scene cache key.
 */
export function normalizeNarration(input: string): string {
  return normalizeNarrationDetailed(input).text;
}

/**
 * Letters a voice will actually pronounce in this text.
 *
 * **The unit the length estimate is measured in, and the reason it stopped being words.**
 * Words a second is not a property of this pipeline — it is a property of the film's
 * vocabulary. Measured across four cast films (`qc0-doc`, `qc0-hashmap`, `qc65-longitude`,
 * `qc64-gd`, 1,010 words of narration and 106 timed phrases): delivered **words** a second
 * spans 1.98–2.50, a ±11% spread, while spoken **letters** a second spans 9.50–9.90 —
 * **±2.1%**. The engine speaks at a near-constant rate and long words simply take longer,
 * so a photosynthesis lesson (4.86 letters a word) delivers 21% fewer words a second than
 * a gradient-descent one (3.79) while both speak at the same speed. See `DELIVERED_LPS`.
 *
 * Counted on the *normalised* text because that is the text the engine is handed:
 * `1707` is four characters and thirty-one spoken letters, and an estimator that could not
 * tell them apart would under-predict a beat with a number in it by twenty seconds. The
 * shipped corpus has only 8 digits in 4,048 characters, which is exactly why this hazard
 * would have gone unnoticed until the first lesson that quoted a date.
 *
 * In `@inkcast/core` because two packages must agree about it to the letter: the planner
 * estimates with it (`lessonSeconds`) and `measureDrift` checks the estimate against the
 * audio. `drift.ts`'s header states that rule — a comparison between two conventions is not
 * a measurement — and this is the second counter it names.
 */
export function spokenLetters(input: string): number {
  return normalizeNarration(input).replace(/[^\p{L}]/gu, '').length;
}

/**
 * Spoken letters per word, pooled over the corpus (4,272 letters, 1,010 words).
 *
 * The bridge between the two units, and it exists because one caller genuinely cannot
 * count letters: `teachingBrief` states a word budget to an author that has not written
 * anything yet. Everything downstream of a written lesson counts letters instead.
 *
 * Beside `spokenLetters` rather than in `presets.ts` with the pace constant, because three
 * packages have to agree on it to the digit — the planner converts the budget with it,
 * `measureDrift` converts a preset's `wordsPerSecond` into the rate it judges against, and
 * the pipeline hands the second to the first. It was briefly duplicated in two of them,
 * which is the same two-catalogues-of-one-fact mistake `CADENCE` and `Preset.maxHold`
 * already have a comment about.
 *
 * The per-film band is 3.79–4.86, so a *word* budget is inherently ±15% where a letter
 * budget is ±2%. That is the cost of asking for words up front, not an error in the
 * number, and it is why `adaptLesson` re-checks the finished lesson in letters.
 */
export const LETTERS_PER_WORD = 4.23;

/**
 * Rough spoken length, used only when no TTS engine is reachable at all.
 *
 * Defaults to the teaching pace so a keyless, engineless render has the same
 * timing as a spoken one — see `TEACHING_WPM_TARGET`.
 */
export function estimateSpokenSeconds(text: string, wordsPerMinute = 150): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  if (!words) return 0;
  return (words / wordsPerMinute) * 60;
}

/* --------------------------------------------------------------- tokenising */

/**
 * Words reduced to a comparable form: lower case, no punctuation, no runs of
 * whitespace. Digits survive because the text pipeline has already spoken them.
 *
 * The one tokeniser. Both ends of the cue contract count with it — the planner
 * to write an index, the voice stage to read one — and the invariant that makes
 * an index mean anything is that punctuation always *separates* tokens here. The
 * voice stage builds its stream per measured phrase, and phrases are cut at
 * commas, semicolons, colons and sentence ends, so a cut can never merge two
 * tokens into one or split one into two. `narrationTokens` below is therefore
 * the same list of words the clips are made of, in the same order.
 */
export function matchTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/**
 * The token stream a scene's cue indices are indices into: normalise, then
 * tokenise.
 *
 * Normalisation first is the whole point. A cue is authored against narration
 * that still says "0.1" and "α", and what gets spoken is "zero point one" and
 * "alpha" — three tokens where the source had one. An index into the *source*
 * words would name a different word than the one the listener hears, which is
 * the class of bug the index was introduced to end.
 */
export function narrationTokens(narration: string): string[] {
  return matchTokens(normalizeNarration(narration));
}

/**
 * Tokenise a cue the way the narration was tokenised.
 *
 * The cue goes through `normalizeNarration` first: it is authored against the
 * *source* text, so it may contain markdown, symbols or digits that the narration
 * no longer contains. Normalising both sides is what makes "α" match "alpha" and
 * "0.1" match "zero point one".
 */
export function cueTokens(cue: string): string[] {
  const direct = matchTokens(cue);
  const normalised = matchTokens(normalizeNarration(cue));
  // Prefer the normalised form, but keep the raw one when normalisation has
  // eaten everything (a cue of pure symbols, say).
  return normalised.length ? normalised : direct;
}

/** Exact contiguous match of `needle` inside `haystack` at or after `from`, or -1. */
export function findTokens(
  haystack: readonly string[],
  needle: readonly string[],
  from = 0,
): number {
  if (!needle.length || needle.length > haystack.length) return -1;
  outer: for (let i = Math.max(0, from); i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * Which word of the narration a cue starts on, or `undefined` if it is not in it.
 *
 * This is the authoring half of `Enter.cueWord` (PIPELINE.md step 8's
 * `entersAtWord`), and it is deliberately **exact only**: no prefix match, no
 * fuzzy window. The voice stage's search has those tolerances because it is
 * handed a phrase and has to make the best of it; the planner is handed the
 * narration itself and can simply choose a cue that occurs in it. An index
 * derived from a 60%-confident window would be a guess wearing the costume of a
 * fact, and the record would no longer be able to tell the two apart.
 *
 * A phrase that occurs twice resolves to its **first** occurrence, which is what
 * the search resolved it to as well. The difference is that the choice is now
 * made once, in the open, by the stage that picked the words — rather than
 * re-derived per render by a matcher that could pick the other one after an edit.
 */
export function cueWordIndex(narration: string, cue: string | undefined): number | undefined {
  if (!cue?.trim()) return undefined;
  const needle = cueTokens(cue);
  if (!needle.length) return undefined;
  const at = findTokens(narrationTokens(narration), needle);
  return at < 0 ? undefined : at;
}
