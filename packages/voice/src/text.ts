/**
 * Sentence-aware text normalisation for TTS.
 *
 * Narration arrives from the planner as prose that may still carry markdown,
 * maths symbols, currency and bare digits. Every TTS engine we support reads
 * that badly — Kokoro's phonemiser and macOS `say` will happily say "dollar
 * five" or spell out an asterisk — so quality lives or dies here, before a
 * single sample is generated.
 *
 * The pipeline is deliberately ordered:
 *
 *   1. `stripMarkdown`        structure -> plain sentences with real punctuation
 *   2. `expandAbbreviations`  removes the internal full stops ("e.g.") that
 *                             would otherwise fool the sentence splitter
 *   3. `splitSentences`       so each sentence can be normalised and terminated
 *                             independently, giving the engine clean prosody
 *   4. `speakSymbols`         maths/typography -> words
 *   5. `speakNumbers`         digits, money, units, ranges -> words
 *   6. `tidy`                 whitespace, punctuation, capitalisation
 *
 * Everything is pure and deterministic, which matters: the normalised string is
 * what gets hashed into the per-scene cache key.
 */

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

  return out.join(' ').replace(/[^\S\n]{2,}/g, ' ').trim();
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
    if (c === '.' && end === i + 1 && /[A-Z]/.test(s[i - 1] ?? '') && !/[A-Za-z]/.test(s[i - 2] ?? '')) {
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
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
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
    1: 'first', 2: 'second', 3: 'third', 5: 'fifth', 8: 'eighth', 9: 'ninth', 12: 'twelfth',
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
  k: 'thousand', K: 'thousand', M: 'million', B: 'billion', T: 'trillion', bn: 'billion',
};

const FRACTIONS: Record<string, string> = {
  '1/2': 'one half', '1/3': 'one third', '2/3': 'two thirds', '1/4': 'one quarter',
  '3/4': 'three quarters', '1/5': 'one fifth', '1/8': 'one eighth', '1/10': 'one tenth',
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
  s = s.replace(/(?<!\w)(\d+(?:\.\d+)?)[eE]([-+]?\d+)(?!\w)/g, (_m, mantissa: string, exp: string) => {
    const power = exp.startsWith('-')
      ? `minus ${numberToWords(Number(exp.slice(1)))}`
      : numberToWords(Number(exp.replace('+', '')));
    return ` ${decimalToWords(mantissa)} times ten to the power of ${power} `;
  });

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
  s = s.replace(/([$£€¥])\s?(\d+(?:,\d{3})*(?:\.\d+)?)/g, (_m, cur: string, num: string) =>
    ` ${money(num.replace(/,/g, ''), cur)} `,
  );

  // 50% / 12.5 %
  s = s.replace(/(-?\d+(?:,\d{3})*(?:\.\d+)?)\s?%/g, (_m, num: string) =>
    ` ${decimalToWords(num.replace(/,/g, ''))} percent `,
  );

  // 3x / 2.5x / 10×  (multipliers, not the letter x in an identifier)
  s = s.replace(/(?<![\w.])(\d+(?:\.\d+)?)\s?[x×](?![\w])/g, (_m, num: string) =>
    ` ${decimalToWords(num)} times `,
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
  s = s.replace(/\b(\d+)\s?\/\s?(\d+)\b/g, (_m, a: string, b: string) =>
    ` ${numberToWords(Number(a))} over ${numberToWords(Number(b))} `,
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
  s = s.replace(/(?<![\w.])(-?\d+(?:\.\d+)?)\s?(bn|[kKMBT])\b/g, (_m, num: string, mag: string) =>
    ` ${decimalToWords(num)} ${MAGNITUDES[mag] ?? ''} `,
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
  s = s.replace(/(-?\d+(?:\.\d+)?)\s?°\s?C\b/g, (_m, n: string) => ` ${decimalToWords(n)} degrees Celsius `);
  s = s.replace(/(-?\d+(?:\.\d+)?)\s?°\s?F\b/g, (_m, n: string) => ` ${decimalToWords(n)} degrees Fahrenheit `);
  s = s.replace(/(-?\d+(?:\.\d+)?)\s?°/g, (_m, n: string) => ` ${decimalToWords(n)} degrees `);

  // 10-20 / 10–20 -> ten to twenty
  s = s.replace(/(?<!\w)(\d+(?:\.\d+)?)\s?[-–—]\s?(\d+(?:\.\d+)?)(?!\w|\.\d)/g, (_m, a: string, b: string) =>
    ` ${decimalToWords(a)} to ${decimalToWords(b)} `,
  );

  // Dotted sequences (versions, section numbers): 1.2.3
  s = s.replace(/\b\d+(?:\.\d+){2,}\b/g, (m) =>
    ` ${m.split('.').map((p) => numberToWords(Number(p))).join(' point ')} `,
  );

  // Comma-grouped integers.
  s = s.replace(/\b\d{1,3}(?:,\d{3})+\b/g, (m) => ` ${numberToWords(Number(m.replace(/,/g, '')))} `);

  // Years, before generic integers so 1999 does not become "one thousand ...".
  // The trailing guard allows a sentence-final full stop but not "1999.5".
  s = s.replace(/(?<!\w|\d\.|[$:])(1[89]\d{2}|20[0-3]\d)(?!\w|[:%]|\.\d)/g, (m) =>
    ` ${yearToWords(Number(m))} `,
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

/** Full pipeline, returning both the joined text and its sentences. */
export function normalizeNarrationDetailed(input: string): NormalizeResult {
  const expanded = expandAbbreviations(stripMarkdown(input));
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

/** Rough spoken length, used only when no TTS engine is reachable at all. */
export function estimateSpokenSeconds(text: string, wordsPerMinute = 155): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  if (!words) return 0;
  return (words / wordsPerMinute) * 60;
}
