/**
 * Beat detection — deciding *what each scene is about* and *what shape it is*.
 *
 * One idea per scene. The document's own structure supplies the ideas; this
 * module classifies each one so the planner can choose a visual that fits:
 * a bullet list is a stack, a numbered list is a flow, "X whereas Y" is two
 * side-by-side panels, "X is a Y" is a titled card, and a paragraph full of
 * measurements is a labelled figure.
 */
import type { Block } from './blocks.js';
import { parseBlocks } from './blocks.js';
import { keyTerms, sentences, shorten, stripMarkdown, wordCount } from './text.js';
import type { SourceDoc } from './types.js';

export type BeatShape =
  | 'title'
  | 'section'
  | 'statement'
  | 'definition'
  | 'list'
  | 'steps'
  | 'comparison'
  | 'numbers'
  | 'quote'
  | 'code'
  | 'table'
  | 'annotate'
  | 'recap';

export type NumberFact = { value: string; label: string };

export type Beat = {
  shape: BeatShape;
  /** Sentences this beat narrates from. */
  source: string;
  /** Section this beat belongs to, for context and asset reuse. */
  heading: string;
  sectionIndex: number;
  /** How much this beat matters, used when trimming to `maxScenes`. */
  weight: number;
  /* shape-specific payload */
  items?: string[];
  term?: string;
  definition?: string;
  panels?: [{ title: string; point: string }, { title: string; point: string }];
  facts?: NumberFact[];
  code?: { lang: string; lines: string[] };
  table?: { header: string[]; rows: string[][] };
  lead?: string;
  /** For `annotate`: which slot of the previous scene to mark up. */
  annotate?: { slot: string; effect: 'circle' | 'underline' | 'pulse' };
};

/* ------------------------------------------------------------- classifiers */

const DEFINITION =
  /^(?:\s*)([A-Z][\w'’+.-]*(?:\s+[\w'’+.-]+){0,4}?)\s+(?:is|are)\s+(?:(?:an|a|the|simply|just|basically)\s+)?(.{12,})$/;
const DEFINITION_VERB =
  /^(?:\s*)([A-Z][\w'’+.-]*(?:\s+[\w'’+.-]+){0,4}?)\s+(?:refers to|means|is defined as|describes|stands for)\s+(.{8,})$/i;
const BOLD_TERM = /^\*\*([^*]{2,48})\*\*\s*[:—-]\s*(.{12,})$/;
const CONTRAST =
  /\b(?:whereas|versus|vs\.?|compared (?:to|with)|unlike|in contrast(?: to)?|on the other hand|rather than|instead of)\b/i;
const STEP_WORDS = /\b(?:first|then|next|after that|finally|step \d|begin by|start by)\b/i;

const NUMBER =
  /(?:[$£€]\s?)?\d[\d,]*(?:\.\d+)?\s?(?:%|percent|×|x\b|times|ms\b|milliseconds?|seconds?|secs?\b|minutes?|mins?\b|hours?|days?|weeks?|months?|years?|[kmgt]b\b|bytes?|bits?\b|billion|million|trillion|thousand|degrees?|dollars?|euros?|pounds?|people|users|customers|words|tokens|params?|parameters|layers?|fps\b|[kmg]?hz\b|kg\b|km\b|cm\b|mm\b|miles?|metres?|meters?|feet|watts?|volts?)?/gi;

const UNIT_REQUIRED =
  /(?:%|percent|×|x$|times|ms|milliseconds?|seconds?|secs?|minutes?|mins?|hours?|days?|weeks?|months?|years?|[kmgt]b|bytes?|bits?|billion|million|trillion|thousand|degrees?|dollars?|euros?|pounds?|people|users|customers|words|tokens|params?|parameters|layers?|fps|[kmg]?hz|kg|km|cm|mm|miles?|metres?|meters?|feet|watts?|volts?)$/i;

/** Pull `{value, label}` pairs out of a passage of prose. */
export function extractFacts(text: string, limit = 3): NumberFact[] {
  const clean = stripMarkdown(text);
  const out: NumberFact[] = [];
  for (const m of clean.matchAll(NUMBER)) {
    const value = m[0].trim().replace(/\s+/g, ' ');
    if (!value || !/\d/.test(value)) continue;
    const hasUnit = UNIT_REQUIRED.test(value) || /[$£€%]/.test(value);
    const digits = value.replace(/\D/g, '').length;
    if (!hasUnit && digits < 3) continue;
    const after = clean.slice((m.index ?? 0) + value.length);
    const before = clean.slice(0, m.index ?? 0);
    const tail = after.split(/[.,;:()]/)[0] ?? '';
    const lead =
      before
        .trim()
        .split(/[.,;:()]/)
        .pop() ?? '';
    const label =
      shorten(tail, 5).replace(/^(?:of|in|for|to|and|the|a|an)\s+/i, '') || shorten(lead, 5);
    out.push({ value, label: label || 'measured' });
    if (out.length >= limit) break;
  }
  return out;
}

function splitContrast(text: string): Beat['panels'] | undefined {
  const clean = stripMarkdown(text);
  const m = clean.match(CONTRAST);
  if (!m || m.index === undefined) return undefined;
  const left = clean.slice(0, m.index).trim().replace(/[,;]$/, '');
  const right = clean
    .slice(m.index + m[0].length)
    .trim()
    .replace(/^[,;]\s*/, '');
  if (wordCount(left) < 4 || wordCount(right) < 4) return undefined;
  return [panel(left), panel(right)];
}

/** A panel is a short title plus the part of the clause the title does not say. */
function panel(clause: string): { title: string; point: string } {
  const title = shorten(subjectOf(clause), 4);
  const bare = title.replace(/…$/, '');
  const rest = clause.toLowerCase().startsWith(bare.toLowerCase())
    ? clause.slice(bare.length).trim()
    : clause;
  // Cutting a clause after its subject leaves the joining punctuation behind, so
  // the panel read ", and the loss climbs" on the board. A comma is not how a
  // label starts, and a dangling conjunction is not how one reads.
  const tidy = rest
    .replace(/^[\s,;:—–-]+/, '')
    .replace(/^(?:and|but|so|then|which|that|while|whereas)\s+/i, '')
    .trim();
  return { title, point: shorten(tidy || rest || clause, 9) };
}

const VERBISH =
  /^(?:is|are|was|were|has|have|had|does|do|did|can|could|will|would|should|may|might|must|uses|use|needs|need|costs|cost|requires|require|gives|give|takes|take|works|work|makes|make|runs|run|scales|scale|beats|beat|wins|win|fails|fail|tends|tend|relies|rely)$/i;

/** The noun phrase a clause is about — its first few words up to the verb. */
export function subjectOf(clause: string): string {
  const w = stripMarkdown(clause).split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const word of w) {
    if (out.length && VERBISH.test(word.replace(/[^\w]/g, ''))) break;
    out.push(word);
    if (out.length >= 5) break;
  }
  return out.join(' ').replace(/[,;:.]$/, '');
}

/**
 * "The size of that step is …" is a sentence, not a definition. A definable term
 * is a short noun phrase with no prepositions or demonstratives in it.
 */
function plausibleTerm(term: string): boolean {
  const t = term.trim();
  if (!t || wordCount(t) > 4) return false;
  return !/\b(?:of|in|on|for|with|that|this|these|those|which|when|there|it)\b/i.test(t);
}

export function definitionOf(text: string): { term: string; definition: string } | undefined {
  const bold = text.match(BOLD_TERM);
  if (bold?.[1] && bold[2]) return { term: bold[1].trim(), definition: stripMarkdown(bold[2]) };
  const first = sentences(stripMarkdown(text))[0];
  if (!first) return undefined;
  const verb = first.match(DEFINITION_VERB);
  if (verb?.[1] && verb[2] && plausibleTerm(verb[1]))
    return { term: verb[1].trim(), definition: verb[2].trim() };
  const be = first.match(DEFINITION);
  if (be?.[1] && be[2] && plausibleTerm(be[1]))
    return { term: be[1].trim(), definition: be[2].trim() };
  return undefined;
}

/* ----------------------------------------------------------- beat building */

type Section = { heading: string; level: number; blocks: Block[] };

function sectionsOfBlocks(blocks: Block[]): Section[] {
  const out: Section[] = [{ heading: '', level: 0, blocks: [] }];
  for (const b of blocks) {
    if (b.kind === 'heading') {
      out.push({ heading: b.text, level: b.level, blocks: [] });
      continue;
    }
    out[out.length - 1]!.blocks.push(b);
  }
  return out.filter((s) => s.heading !== '' || s.blocks.length > 0);
}

export type BeatOptions = {
  /** Word budget per beat, derived from the pacing target. */
  maxWords?: number;
  minWords?: number;
};

/** Split a document into beats: the ordered list of ideas the video explains. */
export function buildBeats(doc: SourceDoc, opts: BeatOptions = {}): Beat[] {
  const maxWords = opts.maxWords ?? 30;
  const minWords = opts.minWords ?? 11;
  const blocks = parseBlocks(doc.text);
  const sections = sectionsOfBlocks(blocks);
  const beats: Beat[] = [];

  /* --- opening: the title card narrates the document's first sentence --- */
  const firstPara = blocks.find((b) => b.kind === 'paragraph');
  const hookBlock = firstPara?.kind === 'paragraph' ? firstPara : undefined;
  const hook = hookBlock ? firstFew(hookBlock.text, maxWords) : doc.title;
  beats.push({
    shape: 'title',
    source: `${doc.title}. ${hook}`,
    heading: doc.title,
    sectionIndex: -1,
    weight: 100,
    lead: hook,
  });

  sections.forEach((section, si) => {
    const paras = section.blocks;
    let openerUsed = false;

    const leadBlock = paras.find((b) => b.kind === 'paragraph');
    const leadText = leadBlock?.kind === 'paragraph' ? leadBlock.text : '';
    // A one-sentence lead that is *itself* a comparison, a definition or a set of
    // figures must not be eaten by the section card — its shape is the scene.
    const strongLead =
      leadText !== '' &&
      sentences(stripMarkdown(leadText)).length <= 2 &&
      (splitContrast(leadText) !== undefined ||
        definitionOf(leadText) !== undefined ||
        extractFacts(leadText).length >= 2);

    // A section card only earns its own scene when there is prose to say over
    // it. A heading followed straight by a list or a code block is better folded
    // into that beat than given a two-word scene of its own.
    if (section.heading && !strongLead && wordCount(leadText) >= 8) {
      beats.push({
        shape: 'section',
        source: `${section.heading}. ${firstFew(leadText, maxWords)}`,
        heading: section.heading,
        sectionIndex: si,
        weight: 80 - section.level * 5,
      });
      openerUsed = true;
    }

    for (const block of paras) {
      switch (block.kind) {
        case 'paragraph': {
          const isLead = block === leadBlock;
          const hookConsumed = block === hookBlock;
          const text =
            isLead && openerUsed
              ? dropFirst(block.text, maxWords)
              : hookConsumed
                ? dropFirst(block.text, 0, sentences(stripMarkdown(hook)).length)
                : block.text;
          if (wordCount(text) < 4) break;
          beats.push(...paragraphBeats(text, section.heading, si, maxWords, minWords));
          break;
        }
        case 'list': {
          const items = block.items.map((i) => shorten(i, 9)).filter(Boolean);
          if (!items.length) break;
          const stepsy =
            block.ordered || items.some((i) => STEP_WORDS.test(i)) || /step/i.test(section.heading);
          // Four items is the most a single beat can name inside 12 seconds.
          for (const chunk of chunkItems(items, 4)) {
            beats.push({
              shape: stepsy ? 'steps' : 'list',
              source: chunk.join('. '),
              heading: section.heading,
              sectionIndex: si,
              weight: 70,
              items: chunk,
              lead: section.heading || undefined,
            });
          }
          break;
        }
        case 'quote':
          if (wordCount(block.text) < 4) break;
          beats.push({
            shape: 'quote',
            source: block.text,
            heading: section.heading,
            sectionIndex: si,
            weight: 55,
          });
          break;
        case 'code': {
          const lines = block.text
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith('//') && !l.startsWith('#'))
            .slice(0, 4);
          if (!lines.length) break;
          beats.push({
            shape: 'code',
            // Nobody wants source code read aloud; say what it does instead.
            source: `Here's the same idea written out in code. ${lines.length} ${
              lines.length === 1 ? 'line does' : 'lines do'
            } the whole job.`,
            heading: section.heading,
            sectionIndex: si,
            weight: 50,
            code: { lang: block.lang, lines: lines.map((l) => shorten(l, 12)) },
          });
          break;
        }
        case 'table': {
          const twoCol = block.header.length === 2 && block.rows.length <= 4;
          if (twoCol && block.rows.length >= 2) {
            const a = block.header[0] ?? 'A';
            const b = block.header[1] ?? 'B';
            beats.push({
              shape: 'comparison',
              source: `${a} against ${b}. ${block.rows
                .map((r) => `${r[0] ?? ''} versus ${r[1] ?? ''}`)
                .join('. ')}`,
              heading: section.heading,
              sectionIndex: si,
              weight: 70,
              panels: [
                {
                  title: shorten(a, 4),
                  point: shorten(block.rows.map((r) => r[0] ?? '').join(', '), 10),
                },
                {
                  title: shorten(b, 4),
                  point: shorten(block.rows.map((r) => r[1] ?? '').join(', '), 10),
                },
              ],
            });
            break;
          }
          beats.push({
            shape: 'table',
            source: [
              block.header.join(', '),
              ...block.rows.slice(0, 3).map((r) => r.join(', ')),
            ].join('. '),
            heading: section.heading,
            sectionIndex: si,
            weight: 60,
            table: { header: block.header, rows: block.rows.slice(0, 3) },
          });
          break;
        }
        case 'image':
        case 'heading':
          break;
      }
    }
  });

  /* --- closing recap, when there is enough structure to recap --- */
  const headings = sections.map((s) => s.heading).filter(Boolean);
  if (headings.length >= 3) {
    // Spoken mid-sentence, so a leading capital would read as a proper noun.
    const spoken = headings
      .slice(0, 4)
      .map((h) => h.replace(/^([A-Z])(?=[a-z])/, (c) => c.toLowerCase()));
    const listed =
      spoken.length > 1
        ? `${spoken.slice(0, -1).join(', ')} and ${spoken[spoken.length - 1]}`
        : (spoken[0] ?? '');
    beats.push({
      shape: 'recap',
      source: `That's the whole picture. We covered ${listed}.`,
      heading: doc.title,
      sectionIndex: sections.length,
      weight: 90,
      items: headings.slice(0, 5).map((h) => shorten(h, 5)),
    });
  }

  return beats;
}

/** One paragraph becomes one, two or three beats depending on its shape. */
function paragraphBeats(
  text: string,
  heading: string,
  sectionIndex: number,
  maxWords: number,
  minWords: number,
): Beat[] {
  const clean = stripMarkdown(text);
  const out: Beat[] = [];

  const def = definitionOf(text);
  if (def && wordCount(def.definition) >= 4) {
    const rest = dropFirst(clean, 0, 1);
    out.push({
      shape: 'definition',
      source: `${def.term} is ${def.definition}`,
      heading,
      sectionIndex,
      weight: 85,
      term: def.term,
      definition: shorten(def.definition, 16),
    });
    if (wordCount(rest) >= minWords) {
      out.push({
        shape: 'annotate',
        source: rest,
        heading,
        sectionIndex,
        weight: 45,
        annotate: { slot: 'term', effect: 'underline' },
      });
      return out;
    }
    return out;
  }

  const panels = splitContrast(clean);
  if (panels) {
    out.push({
      shape: 'comparison',
      source: clean,
      heading,
      sectionIndex,
      weight: 80,
      panels,
    });
    return out;
  }

  const facts = extractFacts(clean);
  const shortEnough = sentences(clean).length <= 3;
  if (facts.length >= 2 || (facts.length === 1 && shortEnough)) {
    out.push({
      shape: 'numbers',
      source: clean,
      heading,
      sectionIndex,
      weight: 75,
      facts: facts.slice(0, 3),
    });
    return out;
  }

  // Plain prose: chop into beats of one idea each, by sentence budget.
  const sents = sentences(clean);
  let bucket: string[] = [];
  let count = 0;
  const flush = () => {
    if (!bucket.length) return;
    const source = bucket.join(' ');
    out.push({
      shape: 'statement',
      source,
      heading,
      sectionIndex,
      weight: 60 + Math.min(15, keyTerms(source).length),
    });
    bucket = [];
    count = 0;
  };
  for (const s of sents) {
    const n = wordCount(s);
    if (count > 0 && count + n > maxWords) flush();
    bucket.push(s);
    count += n;
    if (count >= maxWords) flush();
  }
  flush();
  return out;
}

/* -------------------------------------------------------------- small util */

function chunkItems(items: string[], size: number): string[][] {
  if (items.length <= size) return [items];
  const out: string[][] = [];
  // Balance the chunks rather than leaving a lonely tail item.
  const chunks = Math.ceil(items.length / size);
  const per = Math.ceil(items.length / chunks);
  for (let i = 0; i < items.length; i += per) out.push(items.slice(i, i + per));
  return out;
}

/** The first sentences of `text` that fit in `budget` words. */
function firstFew(text: string, budget: number): string {
  const out: string[] = [];
  let n = 0;
  for (const s of sentences(stripMarkdown(text))) {
    const c = wordCount(s);
    if (n > 0 && n + c > budget) break;
    out.push(s);
    n += c;
    if (n >= budget) break;
  }
  return out.join(' ');
}

/** `text` minus the sentences a previous beat already used. */
function dropFirst(text: string, budget: number, count?: number): string {
  const sents = sentences(stripMarkdown(text));
  if (count !== undefined) return sents.slice(count).join(' ');
  let n = 0;
  let i = 0;
  for (; i < sents.length; i++) {
    const c = wordCount(sents[i]!);
    if (n > 0 && n + c > budget) break;
    n += c;
    if (n >= budget) {
      i++;
      break;
    }
  }
  return sents.slice(i).join(' ');
}
