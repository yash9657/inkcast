/**
 * The zero-key lesson author.
 *
 * Without an API key we cannot invent an anchor, a hook or a misconception — those
 * are acts of teaching, and a regex cannot perform them. What we *can* do is read
 * the document's structure honestly: put its most concrete claim first as a
 * question, use the document's own analogy if it has one, use its own justifying
 * sentences for `because`, promote the passage with the most numbers to the worked
 * example, and find the sentence where the author already warns about a common
 * mistake.
 *
 * The result is a real lesson with real visuals that renders with no key and no
 * network — and it is meaningfully worse than the model path. That is stated
 * plainly in a warning rather than papered over: the honest fallback is the point,
 * not a claim of equivalence.
 */
import type { Lesson, LessonStep, VisualIntent } from '@inkcast/core';
import { Lesson as LessonSchema, findTerms, logger, technicalTerms } from '@inkcast/core';
import type { Beat } from './beats.js';
import { buildBeats, definitionOf, extractFacts } from './beats.js';
import { worthPlotting } from './plots.js';
import { clampNarration, lessonSeconds } from './presets.js';
import type { Preset } from './presets.js';
import { composeItems, speakify, writeNarration } from './narration.js';
import { capitalize, keyTerms, sentences, shorten, stripMarkdown, wordCount } from './text.js';
import type { LessonOptions, SourceDoc } from './types.js';

const log = logger('planner:lesson:derive');

/**
 * The vocabulary a derived beat writes on the board.
 *
 * This is the one thing on this path that is not a compromise. Naming the terms a beat
 * introduces is not an act of teaching — it is a property of the words, which is exactly
 * what a heuristic can read — so `technicalTerms` does here what it does for the model:
 * the board writes ATP as the narrator says ATP, with no key and no network.
 *
 * Certainty first, then a little recall. Every initialism and name a beat says is written,
 * up to the schema's ceiling of three: those are the ones with no argument about them, and
 * an initialism especially, because the voice stage spells it out letter by letter and
 * nothing recovers "H₂O" from "aitch two oh". A beat with fewer than two of those tops up
 * with its best long words, and stops at two — this author reads prose rather than
 * choosing what to teach, so its third-best guess at what is vocabulary is its worst one.
 *
 * Terms are deduplicated across the whole lesson downstream (`planVocabulary`), so a beat
 * whose offers are all already on the board writes nothing, which is correct.
 */
function vocabulary(narration: string): string[] {
  const certain = findTerms(narration)
    .filter((t) => t.kind !== 'word')
    .map((t) => t.text);
  // `technicalTerms` ranks initialisms and names above long words, so asking it for two
  // returns the certain one plus the best word when there is only one certain term.
  return certain.length >= 2 ? certain.slice(0, 3) : technicalTerms(narration, 2);
}

/**
 * The grounding every heuristic beat gets, and why it is the same one every time.
 *
 * `given` rather than `derived`, because this author has no model of how one beat
 * follows from another: it lifts the document's own justifying sentence into `because`
 * and stops there, so it cannot honestly name the earlier beats a claim rests on.
 * `given` rather than `asserted`, because that sentence is a real reason the learner
 * can check, not a bare statement.
 *
 * A function rather than a shared constant so no two beats alias one `derivedFrom`.
 */
function grounded(): Pick<LessonStep, 'from' | 'derivedFrom' | 'emphasis'> {
  // No emphasis, and no `cadence` either: this author lifts the document's own
  // sentences and has no opinion about which words carry a beat or how it should be
  // delivered. Leaving `cadence` unset is not a shrug — `cadenceFor` reads it off the
  // beat's role and shape, so a no-key lesson is still paced beat by beat rather than
  // flat. Guessing emphasis from prose would be the other thing: a heuristic dressed
  // as intent, which is what `lesson-derive` exists to avoid claiming.
  return { from: 'given', derivedFrom: [], emphasis: [] };
}

/* -------------------------------------------------------------- doc reading */

const ANALOGY = /\b(?:like|similar to|think of|imagine|as if|analogous to|much as|just as)\b/i;
const JUSTIFY =
  /\b(?:because|since|so that|which means|the reason|that is why|this is why|as a result)\b/i;
const WRONG =
  /\b(?:misconception|common mistake|people (?:often|sometimes|usually) (?:think|assume|believe)|a common error|it is tempting to|does not mean|is not (?:the same|a)|contrary to|but it does not|not guaranteed)\b/i;

function docSentences(doc: SourceDoc): string[] {
  return sentences(stripMarkdown(doc.text)).filter((s) => wordCount(s) >= 6);
}

/** The sentence that carries the most information, by content words and numbers. */
function strongest(candidates: string[]): string | undefined {
  let best: { s: string; score: number } | undefined;
  for (const s of candidates) {
    const w = wordCount(s);
    if (w < 6 || w > 40) continue;
    const numbers = (s.match(/\d/g) ?? []).length;
    const score = keyTerms(s, 12).length + Math.min(4, numbers) * 0.8 - Math.abs(w - 18) * 0.05;
    if (!best || score > best.score) best = { s, score };
  }
  return best?.s;
}

/**
 * The subject of a document title, without its subtitle.
 *
 * "Photosynthesis, one step at a time" is a headline, not a subject, and reading
 * it into a sentence produces "how photosynthesis, one step at a time works".
 */
function subject(topic: string): string {
  const head = topic.replace(/[.?!]+$/, '').split(/\s*[:—–,]\s*/)[0] ?? topic;
  const t = head.trim() || topic.trim();
  return `${t.charAt(0).toLowerCase()}${t.slice(1)}`;
}

/** A question that opens on the topic without becoming a preamble. */
function hookQuestion(topic: string): string {
  return `How does ${subject(topic)} actually work?`;
}

/** The document's own justification for a claim, if it states one nearby. */
function reasonNear(source: string, avoid: string): string | undefined {
  const parts = sentences(stripMarkdown(source));
  const pick = parts.find(
    (s) => JUSTIFY.test(s) && !echoes(s, avoid) && wordCount(s) >= 6 && wordCount(s) <= 34,
  );
  return pick ? speakify(pick) : undefined;
}

function echoes(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, '')
      .trim();
  return norm(a) === norm(b);
}

/**
 * How much two beats say the same thing, as a fraction of the shorter one.
 *
 * The hook and the anchor mine the whole document for its strongest sentences, so
 * without this a later step happily narrates a sentence the learner already heard
 * two beats ago — which reads as a stuck record and is the most obvious tell that
 * nobody is really teaching.
 */
function saysAgain(a: string, b: string): number {
  const words = (s: string) => new Set(keyTerms(s, 40));
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const w of A) if (B.has(w)) hit++;
  return hit / Math.min(A.size, B.size);
}

/* ------------------------------------------------------------------ visuals */

const PLOT_SHAPES: [RegExp, string][] = [
  [
    /\b(?:loss|error|cost) (?:curve|surface|landscape|function)\b|gradient descent|minimi[sz]e/i,
    'a bowl-shaped loss curve with the lowest point marked',
  ],
  [
    /\bcompound|exponential|doubl(?:e|ing)|grows? (?:fast|quickly)\b/i,
    'an exponential curve of value against time, running away at the right',
  ],
  [
    /\bdiminishing returns|logarithm|levels? off|plateau/i,
    'a logarithm curve of value against effort, flattening to the right',
  ],
  [
    /\bprobability|sigmoid|logistic|saturat/i,
    'a sigmoid curve of probability against input, flat at both ends',
  ],
  [/\bdistribution|average|standard deviation|spread\b/i, 'a bell curve with the middle shaded'],
  [
    /\bovertfit|overfit|training (?:and|versus|vs) (?:test|validation)/i,
    'two curves: training error falling, unseen-data error turning back up',
  ],
  [
    // The pairing, not the lone word — "an energy supply" is not a demand curve.
    /supply and demand|(?:supply|demand) curve|\bprices?\b/i,
    'supply and demand as two crossing straight lines, with the crossing point marked',
  ],
  [/\boscillat|wave|periodic/i, 'a sine wave over time'],
  [/\bthreshold|cutoff|switch(?:es)? on/i, 'a threshold: flat, then a step up'],
  [/\brate|per second|per year|over time|speed\b/i, 'a straight line of value against time'],
];

/** A drawing instruction derived from what a passage is actually about. */
function visualFor(beat: Beat, doc: SourceDoc): VisualIntent[] {
  const text = `${beat.heading} ${beat.source}`;

  // A shape keyword says *which* plot; it cannot say whether a plot is the right drawing,
  // and this table was being asked both questions. `worthPlotting` asks the second one —
  // is there a quantity here, and does anything happen to it — so a passage that merely
  // contains the word does not get axes. See `worthPlotting` for the failure this
  // removes.
  for (const [re, describe] of PLOT_SHAPES) {
    if (!re.test(text)) continue;
    if (worthPlotting(text)) return [{ describe, kind: 'plot' }];
    log.debug(
      `beat "${beat.heading}" matched a plot shape but states no quantity — not drawing axes`,
      describe,
    );
    break;
  }

  if ((beat.shape === 'steps' || beat.shape === 'list') && beat.items?.length) {
    const joiner = beat.shape === 'steps' ? ' → ' : ', ';
    return [
      {
        describe: `${beat.shape === 'steps' ? 'a flow' : 'a list'} of ${beat.items
          .map((i) => shorten(i, 4))
          .join(joiner)}`,
        kind: 'diagram',
      },
    ];
  }
  if (beat.shape === 'comparison' && beat.panels) {
    return [
      {
        describe: `two panels side by side: ${shorten(beat.panels[0].title, 4)}, ${shorten(beat.panels[1].title, 4)}`,
        kind: 'diagram',
      },
    ];
  }
  if (beat.shape === 'numbers' && beat.facts?.length) {
    const fact = beat.facts[0]!;
    return [
      { describe: `${fact.value} written large, labelled ${shorten(fact.label, 4)}`, kind: 'text' },
    ];
  }
  if (/\bhill|downhill|uphill|slope|terrain|walk\b/i.test(text)) {
    return [
      {
        describe: 'a drawn hillside falling to a valley, with a figure standing on it',
        kind: 'path',
      },
    ];
  }
  const terms = keyTerms(`${beat.heading} ${beat.source}`, 3);
  return [{ describe: `${terms.join(' ') || doc.title} drawn as a simple object`, kind: 'icon' }];
}

/* -------------------------------------------------------------------- steps */

/**
 * The one line this beat writes on the board, and never a line another beat wrote.
 *
 * A document's section becomes several beats, so reaching for the heading first — which
 * is what this did — captions all of them the same thing. Measured on the photosynthesis
 * document, three of eight cells said "The one-line version" and two more said "Where it
 * happens": a third of the board's words were one string repeated, and the accumulated
 * board is supposed to *be* the summary.
 *
 * So the heading is the first *preference*, not the answer, and a beat whose turn at it
 * has already been taken falls through to a sentence of its own. `used` is the ideas
 * already claimed, and it is mutated here so the next beat sees this one's choice.
 */
function ideaFor(beat: Beat, source: string, used: Set<string>): string {
  const def = definitionOf(source);
  const candidates = [
    def?.term ? `${def.term}: ${def.definition}` : undefined,
    beat.heading,
    strongest(sentences(source)),
    // Last resort, and never a repeat: the beat's own opening sentence.
    sentences(source)[0],
    source,
  ];
  for (const candidate of candidates) {
    const idea = shorten(candidate ?? '', 12);
    if (!idea) continue;
    const key = idea.toLowerCase();
    if (used.has(key)) continue;
    used.add(key);
    return idea;
  }
  return shorten(candidates.find(Boolean) ?? '', 12);
}

function stepFrom(
  beat: Beat,
  doc: SourceDoc,
  preset: Preset,
  index: number,
  used: Set<string>,
): LessonStep | undefined {
  const source = stripMarkdown(beat.source);
  const narration = clampNarration(
    (beat.shape === 'list' || beat.shape === 'steps') && beat.items?.length
      ? composeItems(beat.items, beat.shape === 'steps', beat.lead, preset.maxWordsPerBeat)
      : writeNarration(source, { index, maxWords: preset.maxWordsPerBeat, minWords: 14 }),
    preset.maxWordsPerBeat,
  );
  if (wordCount(narration) < 5) return undefined;

  const def = definitionOf(source);
  const idea = ideaFor(beat, source, used);
  const because =
    reasonNear(source, idea) ??
    (def?.definition ? speakify(`it is ${def.definition}`) : undefined) ??
    speakify(
      strongest(sentences(source).slice(1)) ??
        `this follows from ${shorten(beat.heading || doc.title, 6)}`,
    );

  return {
    idea: capitalize(idea),
    because,
    ...grounded(),
    narration,
    terms: vocabulary(narration),
    visuals: visualFor(beat, doc),
    hold: 0.4,
  };
}

/* -------------------------------------------------------------------- public */

/**
 * Derive a lesson from a document's structure, or from a bare topic.
 *
 * Always returns something renderable. Always logs that the result is limited.
 */
export function deriveLesson(
  input: SourceDoc | string,
  opts: LessonOptions,
  preset: Preset,
): Lesson {
  const doc: SourceDoc =
    typeof input === 'string'
      ? { title: input, text: input, sections: [{ heading: '', level: 0, text: input }] }
      : input;

  const all = docSentences(doc);
  const opening = strongest(all.slice(0, 8)) ?? all[0] ?? doc.title;
  const analogy = all.find((s) => ANALOGY.test(s) && wordCount(s) <= 34);
  const wrong = all.find((s) => WRONG.test(s) && wordCount(s) <= 34);

  const beats = buildBeats(doc, { maxWords: preset.maxWordsPerBeat, minWords: 14 }).filter(
    (b) => !['title', 'recap', 'annotate', 'quote', 'code', 'table'].includes(b.shape),
  );

  const factBeat = [...beats].sort(
    (a, b) => extractFacts(b.source, 4).length - extractFacts(a.source, 4).length,
  )[0];

  const steps: LessonStep[] = [];
  // The hook and the anchor have already spoken; a step that repeats one of them
  // is dropped rather than aired twice.
  const spoken: string[] = [speakify(opening), speakify(analogy ?? opening)];
  const drawn: string[] = [];
  const anchorSource = analogy ?? opening;
  // The two captions the setup will write, settled before the steps so no step can
  // caption its cell with a line the hook or the anchor is already going to write.
  // With no document, `opening` is only the topic — and the topic is already the video's
  // title, so captioning the hook with it says nothing and collides with the one step a
  // bare topic produces. The question the hook asks is what that beat actually
  // contributes, so it is the honest caption. A real document has a sentence to use.
  const hookIdea = capitalize(
    shorten(opening === doc.title ? hookQuestion(doc.title) : opening, 10),
  );
  const anchorIdea = capitalize(
    shorten(analogy ? anchorSource : `start from what ${doc.title} is for`, 10),
  );
  const captions = new Set([hookIdea.toLowerCase(), anchorIdea.toLowerCase()]);
  beats.forEach((beat, i) => {
    if (steps.length >= 5) return;
    if (factBeat && beat === factBeat && extractFacts(beat.source, 4).length >= 2) return;
    const step = stepFrom(beat, doc, preset, i, captions);
    if (!step) return;
    if (spoken.some((prior) => saysAgain(step.narration, prior) > 0.6)) return;
    // Two beats in a row asking for the same picture is how the MVP ended up
    // looking like a slideshow of one drawing. The second one gets an icon of its
    // own subject instead — less ambitious, but it is a different cell.
    const describe = step.visuals[0]?.describe;
    if (describe && describe === drawn[drawn.length - 1]) {
      step.visuals = [
        {
          describe: `${keyTerms(`${beat.heading} ${beat.source}`, 3).join(' ') || doc.title} drawn as a simple object`,
          kind: 'icon',
        },
      ];
    }
    drawn.push(step.visuals[0]?.describe ?? '');
    spoken.push(step.narration);
    steps.push(step);
  });
  if (!steps.length) {
    const narration = clampNarration(
      writeNarration(doc.text || doc.title, { maxWords: preset.maxWordsPerBeat }),
      preset.maxWordsPerBeat,
    );
    steps.push({
      idea: capitalize(shorten(opening, 12)),
      because: speakify(all[1] ?? opening),
      ...grounded(),
      narration,
      terms: vocabulary(narration),
      visuals: [
        {
          describe: `${keyTerms(doc.text, 3).join(' ') || doc.title} drawn as a simple object`,
          kind: 'icon',
        },
      ],
      hold: 0.4,
    });
  }

  const hookNarration = clampNarration(
    `${hookQuestion(doc.title)} ${speakify(opening)}`,
    preset.maxWordsPerBeat + 6,
  );
  const hook: LessonStep = {
    idea: hookIdea,
    // The hook is the one beat `critiqueLesson` does not require a reason for:
    // a question does not need justifying, it needs answering.
    because: '',
    ...grounded(),
    narration: hookNarration,
    terms: vocabulary(hookNarration),
    visuals: [
      {
        describe: `${keyTerms(`${doc.title} ${opening}`, 3).join(' ') || doc.title} drawn as a simple object, with a question mark beside it`,
        kind: 'icon',
      },
    ],
    // Long enough for the learner to actually attempt an answer.
    hold: 1.4,
  };

  const anchorNarration = clampNarration(speakify(anchorSource), preset.maxWordsPerBeat);
  const anchor: LessonStep = {
    idea: anchorIdea,
    because:
      reasonNear(doc.text, anchorSource) ??
      speakify(all.find((s) => s !== anchorSource && wordCount(s) >= 8) ?? anchorSource),
    ...grounded(),
    narration: anchorNarration,
    terms: vocabulary(anchorNarration),
    visuals: analogy
      ? [
          {
            describe: `${shorten(stripMarkdown(anchorSource), 8)}, drawn as a simple scene`,
            kind: 'illustration',
          },
        ]
      : [
          {
            describe: `${keyTerms(anchorSource, 3).join(' ')} drawn as a simple object`,
            kind: 'icon',
          },
        ],
    hold: 0.5,
  };

  const lesson: Lesson = {
    version: 1,
    topic: doc.title,
    audience: opts.audience ?? 'a curious beginner with no background',
    objective:
      opts.objective ??
      `explain in your own words how ${subject(doc.title)} works, and why each step of it is needed`,
    // What this author can and cannot honestly claim about its own pedagogy.
    //
    // `kind` and `strategy` stay at the strictest reading rather than guessing: it has
    // no way to tell a proof from a story, and `first-principles` with every beat
    // `given` is the one combination it can actually satisfy.
    //
    // `analogy` is deliberately absent. A mapping table is a set of claims about what
    // stands for what, and inferring those from prose is precisely the guessing this
    // stage replaced — so the abstraction does not morph out of the anchor on this
    // path. It used to, whenever a document happened to put a becoming-verb near the
    // word "curve", which was luck dressed as pedagogy.
    kind: 'stem',
    strategy: 'first-principles',
    // The document's strongest opening claim. Not an insight it worked out, just the
    // most load-bearing sentence the author already wrote.
    coreInsight: speakify(opening),
    jargonBudget: [],
    // No cast: this author derives from a document and has no way to know who, if
    // anyone, the topic is about. A narrative lesson comes from a model, not here.
    cast: [],
    hook,
    anchor,
    steps,
    recap: {
      idea: 'The chain, end to end',
      because: '',
      ...grounded(),
      // No terms: the recap adds nothing new, and every word it says has been said
      // before — so anything it could write is already on the board.
      terms: [],
      narration: clampNarration(
        composeItems(
          [anchor.idea, ...steps.map((s) => s.idea)].map((s) => shorten(s, 6).replace(/…$/, '')),
          true,
          'So, in one breath',
          preset.maxWordsPerBeat,
        ),
        preset.maxWordsPerBeat,
      ),
      visuals: [],
      hold: 0.6,
    },
  };

  if (factBeat && extractFacts(factBeat.source, 4).length >= 2) {
    const facts = extractFacts(factBeat.source, 3);
    const worked = stepFrom(factBeat, doc, preset, steps.length, captions);
    if (worked) {
      lesson.worked = {
        ...worked,
        idea: `The numbers: ${facts.map((f) => f.value).join(', ')}`,
        visuals: [
          {
            describe: `${facts.map((f) => `${f.value} ${shorten(f.label, 3)}`).join(', ')} written out`,
            kind: 'text',
          },
        ],
        hold: 0.6,
      };
    }
  }

  if (wrong) {
    const narration = clampNarration(speakify(wrong), preset.maxWordsPerBeat);
    lesson.misconception = {
      idea: capitalize(shorten(wrong, 10)),
      because: speakify(wrong),
      ...grounded(),
      narration,
      terms: vocabulary(narration),
      visuals: [
        {
          describe: `${keyTerms(wrong, 3).join(' ')} drawn as a simple object, crossed out`,
          kind: 'icon',
        },
      ],
      hold: 0.8,
    };
  }

  // Trim to the runtime budget from the back of the argument, keeping the spine.
  while (
    lessonSeconds(lesson, preset.wordsPerSecond) > preset.maxSeconds &&
    lesson.steps.length > 1
  ) {
    lesson.steps = lesson.steps.slice(0, -1);
  }

  // Which of the two reasons we are here matters to the user: "set a key" is bad
  // advice for someone who set one and had it rejected. Verification with a
  // deliberately invalid key hit exactly that — the 401 was reported correctly one
  // line above, and then this line told them they had no key at all.
  const why = process.env.ANTHROPIC_API_KEY
    ? 'the Anthropic key did not work, so this lesson was derived from the document structure rather than taught.'
    : 'no ANTHROPIC_API_KEY, so this lesson was derived from the document structure rather than taught.';
  log.warn(
    why,
    'It keeps the shape of a lesson (hook, anchor, steps, recap) but it cannot invent an anchor, a worked example or the misconception a learner actually forms. A working key is what makes this good.',
  );
  return LessonSchema.parse(lesson);
}
