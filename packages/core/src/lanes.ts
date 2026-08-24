/**
 * What this pipeline cannot draw, said out loud (plan item 6.1; audit S5-a).
 *
 * The asset router serves text, equations, shapes, arrows, diagrams, plots, paths,
 * emphasis, icons, characters and two generated-picture lanes. Four topic classes have
 * no lane at all, and the audit's finding was not that they are missing — a curated
 * library with hard quality floors is a deliberate wager against nine loosely wired
 * renderers — but that **the fallback for them is a confidently wrong picture**. A
 * lesson asking for the structure of aspirin gets an image generator's idea of a
 * molecule: plausible, decorative, and chemically false, with nothing anywhere saying
 * so. That is the same defect class as the mangled equation D1: output that looks
 * correct and is not.
 *
 * So this is the guard that ships before the lanes do. It converts confidently-wrong
 * into honestly-limited, which is worth something on the day it lands and costs
 * nothing:
 *
 *  - **chemistry** — a structure renderer (SMILES → skeletal formula).
 *  - **circuits** — schematic symbols wired by a netlist, and timing diagrams.
 *  - **geography** — real coastlines, borders and positions.
 *
 * There were four. **Code came out when the code lane landed** (plan item 6.2): it is
 * monospace, syntax-highlighted and revealed in document order, in `visuals/src/code.ts`.
 * Taking the entry out is part of shipping a lane rather than a follow-up, and it is not
 * left to anyone's memory — `auditcheck.mts` fails if a lane is still declared unserved
 * once the library named in its `renderer` field is a dependency of this repo.
 *
 * ## Three decisions that shape every rule below
 *
 * **1. Detect the notation, not the topic.** A lesson can be *about* chemistry and draw
 * nothing this pipeline gets wrong: the shipped lithium-ion film draws an atom as a
 * nucleus with electron dots, and a battery as two stacks with a wire and a bulb, and
 * both are right. What no lane can draw is the *notation* — a skeletal formula, a
 * schematic, a coastline, a highlighted listing. So `benzene ring` fires and `molecule`
 * does not; `circuit with a resistor` fires and `battery, wire, bulb` does not; a
 * coastline fires and a globe does not (a circle with meridians on it is drawable, and
 * the film that draws one is fine). Every signal below was written against the 79
 * distinct pictures the corpus asks for, and none of them fires on any of them.
 *
 * **2. Precision over recall, because this is also a demand signal.** Plan 6.3 says the
 * lanes get built in the order real lessons ask for them, and the frequency of these
 * findings is how that is measured. A false positive is therefore not merely noise: it
 * is a vote for building a lane nobody needs. A false negative costs one wrong picture,
 * which is what ships today anyway. Where a rule could go either way it stays quiet, and
 * the known blind spots are named in the tests rather than papered over.
 *
 * **3. It warns; it does not refuse to draw.** The gap is reported to the person who can
 * act on it — rewrite the beat, or wait for the lane — and the picture is still drawn.
 * Suppressing it would trade a wrong picture for a missing one, which is a *quality*
 * decision that wants frames looked at, and it belongs with the lane that replaces the
 * fallback (6.2/6.3), not with the sentence that admits the gap. Nothing here is a gate.
 *
 * This lives in `@inkcast/core` rather than beside the routing in `@inkcast/planner`,
 * where `sniffMath` lives, and the difference is what the function *does*: `sniffMath`
 * makes a routing decision inside the compiler, while this makes none at all — it is a
 * judgement about a `Lesson`, like `critiqueLesson` and `lessonOrderAdvisories`, read by
 * the pipeline that reports it, the studio that shows it, and one day the brief that
 * warns the author off. Core is the only package all three can depend on.
 */

import { lessonBeats, type Lesson, type VisualIntent } from './lesson.js';

/** A class of picture no renderer in this repo can draw. */
export type Lane = 'chemistry' | 'circuits' | 'geography';

/** One request this pipeline cannot honour, and the words that gave it away. */
export type LaneGap = {
  lane: Lane;
  /** The beat that asked — a `lessonBeats` id, or `topic` for the lesson's own subject. */
  where: string;
  /** The text that fired, verbatim (trimmed), so a reader can judge the call. */
  quote: string;
  /** Which lane it will fall through to instead. Absent when the topic fired. */
  kind?: VisualIntent['kind'];
};

/**
 * What each missing lane would be, in the words the guard says out loud.
 *
 * `needs` names the notation rather than the subject, per decision 1: it is what the
 * message has to say for "this needs a lane we don't have" to be actionable instead of
 * merely discouraging. `renderer` is the library that would supply it, and it is here
 * because `auditcheck.mts` reads it — the day one of those turns up in the tree, the
 * lane exists and its entry has to come out of this table.
 */
export const UNSERVED: Record<Lane, { needs: string; renderer: string }> = {
  chemistry: { needs: 'chemical structure notation', renderer: 'rdkit' },
  circuits: { needs: 'circuit schematics and timing diagrams', renderer: 'schemdraw' },
  geography: { needs: 'geographically accurate maps', renderer: 'topojson' },
};

/**
 * A signal that a piece of text is asking for a lane that does not exist.
 *
 * Two strengths, and the threshold is sniffMath's: one `strong` phrase fires alone
 * because it can only mean the notation, and two distinct `weak` ones fire together
 * because either alone is ordinary English about an ordinary picture. "A circuit"
 * is a word; "a circuit with a resistor" is a schematic.
 */
type Signal = {
  re: RegExp;
  strong?: true;
  /**
   * Only meaningful in prose. One signal — a place name after "map of" — reads
   * capitalisation, and capitalisation says nothing in a title, where "A Map of the Human
   * Genome" capitalises its abstraction like every other word. Skipped when the text is a
   * title; the caller is the only one that knows which is which.
   */
  sentenceCased?: true;
};

const SIGNALS: Record<Lane, Signal[]> = {
  chemistry: [
    // Named as a notation, not as a verb: a figure in a narrative lesson smiles, and
    // a describe that SHOUTS is still describing a face. The strings themselves are
    // caught by `looksLikeSmiles` below, so nothing rests on this line alone.
    { re: /\bSMILES (string|notation|code|formula|line)\b/, strong: true },
    { re: /\b(skeletal|structural|condensed|displayed|lewis|dot-and-cross)[ -](formula|structure|diagram)/i, strong: true }, // prettier-ignore
    { re: /\b(molecular|chemical)[ -](structure|formula|skeleton|geometry)/i, strong: true },
    { re: /\bbenzene ring\b|\baromatic ring\b/i, strong: true },
    { re: /\bfunctional groups?\b/i, strong: true },
    { re: /\bball[ -]and[ -]stick\b|\bspace[ -]filling model\b/i, strong: true },
    { re: /\bbenzene\b/i },
    { re: /\bmolecul(e|es|ar)\b/i },
    { re: /\b(hydrocarbons?|alkanes?|alkenes?|alkynes?|isomers?|polymer chains?)\b/i },
    { re: /\bcarbon (chain|backbone|skeleton|ring)\b/i },
    { re: /\bdouble bonds?\b|\btriple bonds?\b/i },
  ],
  circuits: [
    { re: /\bcircuit (diagram|schematic)\b/i, strong: true },
    { re: /\btiming diagram\b|\bwaveforms?\b/i, strong: true },
    { re: /\blogic gates?\b/i, strong: true },
    // Uppercase, because "the fence and gate" is a sentence and "AND gate" is a symbol.
    { re: /\b(AND|OR|NOT|NAND|NOR|XOR) gates?\b/, strong: true },
    { re: /\bbreadboard\b|\bnetlist\b|\boscilloscope\b/i, strong: true },
    { re: /\bop[ -]?amps?\b|\boperational amplifiers?\b/i, strong: true },
    { re: /\bcircuits?\b/i },
    { re: /\bschematics?\b/i },
    { re: /\bresistors?\b/i },
    { re: /\bcapacitors?\b/i },
    { re: /\binductors?\b|\btransformers? coil\b/i },
    { re: /\btransistors?\b|\bdiodes?\b/i },
    { re: /\bammeters?\b|\bvoltmeters?\b|\bmultimeters?\b/i },
  ],
  geography: [
    { re: /\bworld maps?\b/i, strong: true },
    // A map *of* somewhere: a named place (capitalised), or a kind of place. The
    // metaphor — "a map of the analogy onto the abstraction" — matches neither.
    { re: /\bmaps? of (?:the )?(?:world|globe|earth|ocean|sea|coast|country|continent|region|city|island)/i, strong: true }, // prettier-ignore
    { re: /\bmaps? of (?:the )?[A-Z]/, strong: true, sentenceCased: true },
    { re: /\bcoast ?lines?\b/i, strong: true },
    { re: /\b(country|national|state|county|political) (borders?|boundaries)\b/i, strong: true },
    { re: /\btopographic\b|\bcartograph/i, strong: true },
    { re: /\bsatellite (view|image|photo)\b/i, strong: true },
    { re: /\bmaps?\b/i },
    { re: /\batlas\b/i },
    { re: /\bcontinents?\b/i },
    { re: /\bislands?\b|\bpeninsulas?\b|\barchipelago\b/i },
    { re: /\bborders?\b|\bboundar(y|ies)\b/i },
    { re: /\bcountr(y|ies)\b|\bnations?\b/i },
  ],
};

/**
 * Characters a SMILES string is made of, restricted to the organic subset.
 *
 * The restriction does half the work. SMILES is written in the same alphabet as English,
 * so a permissive class matches "(learning" and every other parenthesised word; allowing
 * only the letters of the organic subset and the halogens (B C N O P S F I H, plus the
 * lowercase aromatics and the `l`/`r` of Cl and Br) rules out any word with a vowel other
 * than `o`. It is not enough on its own — `cocoons` and `spoons` are spelled entirely out
 * of this set — which is what the structure test below is for.
 */
const SMILES_CHARS = /^[BCNOPSFIHbcnopsrl0-9@+\-[\]()=#$%/\\.]+$/;
/** Four element letters in a row — the `cccc` of benzene, the `CCCC` of cyclohexane. */
const ELEMENT_RUN = /[BCNOPSFIHbcnops]{4}/;

/**
 * Is this token a SMILES string?
 *
 * Four conditions, and each one is there to kill a specific false positive measured
 * against the corpus and the examples:
 *
 *  - **only organic-subset characters**, so ordinary words cannot qualify;
 *  - **at least six characters**, because `CCO` (ethanol) is indistinguishable from an
 *    initialism and this guard would rather miss it than fire on `SA`, `AV` or `ATP` —
 *    a documented blind spot, and the cheaper of the two errors (decision 2);
 *  - **at least two element letters**, so a bare `(1)` or `0.1` cannot;
 *  - **structure, not spelling** — a branch or bond (`()[]=#`), or a ring digit closing
 *    a run of elements (`c1ccccc1`, `C1CCCCC1`). This is the condition that separates a molecule from
 *    a word made of the same nine letters (`cocoons`, `spoons`) and from a chemical
 *    *formula*: `CO2/H2O` is two formulas and the equation lane sets them; `CC(=O)O` is
 *    a structure, and there is no lane that draws one. An unbranched chain written
 *    without a ring (`CCCCCC`, hexane) is missed, and cheaply: a plain zigzag is one of
 *    the few structures the drawing lane really can compose.
 */
export function looksLikeSmiles(token: string): boolean {
  if (token.length < 6 || !SMILES_CHARS.test(token)) return false;
  if ((token.match(/[BCNOPSFIHbcnops]/g) ?? []).length < 2) return false;
  if (/[()[\]=#]/.test(token)) return true;
  return /[0-9]/.test(token) && ELEMENT_RUN.test(token);
}

/**
 * Which lanes this text asks for: one strong signal, or two distinct weak ones.
 *
 * `title` says the text is a lesson's own subject rather than a description of a picture,
 * which turns off the one signal that reads capitalisation. See `Signal.sentenceCased`.
 */
function lanesIn(text: string, title = false): Lane[] {
  const out: Lane[] = [];
  for (const [lane, signals] of Object.entries(SIGNALS) as [Lane, Signal[]][]) {
    let weak = 0;
    let fired = false;
    for (const s of signals) {
      if (title && s.sentenceCased) continue;
      if (!s.re.test(text)) continue;
      if (s.strong) {
        fired = true;
        break;
      }
      weak++;
    }
    if (fired || weak >= 2) out.push(lane);
  }
  if (!out.includes('chemistry') && text.split(/\s+/).some(looksLikeSmiles)) {
    out.push('chemistry');
  }
  return out;
}

/** Cut a long describe down to the sentence-sized quote a warning can carry. */
function quote(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length <= 96 ? t : `${t.slice(0, 93)}…`;
}

/**
 * Every picture in this lesson that needs a lane this pipeline does not have.
 *
 * Reads what the film will *draw* — each visual's `describe`, and the `underlay.prompt`
 * that goes to an image generator verbatim — plus the lesson's own subject, since a
 * bare-topic run can name a molecule the author then never mentions in a describe. The
 * subject is reported only when no picture in that lane already was: the beat is the
 * more useful thing to be told about, and saying both would double every finding.
 */
export function unservedLanes(l: Lesson): LaneGap[] {
  const gaps: LaneGap[] = [];
  for (const beat of lessonBeats(l)) {
    for (const v of beat.step.visuals) {
      for (const text of [v.describe, v.underlay?.prompt]) {
        if (!text) continue;
        for (const lane of lanesIn(text)) {
          gaps.push({ lane, where: beat.id, quote: quote(text), kind: v.kind });
        }
      }
    }
  }
  const covered = new Set(gaps.map((g) => g.lane));
  const subject = `${l.topic} ${l.objective}`;
  for (const lane of lanesIn(subject, true)) {
    if (!covered.has(lane)) gaps.push({ lane, where: 'topic', quote: quote(l.topic) });
  }
  return gaps;
}

/** The lanes named, deduped, in the order this table declares them. */
export function lanesMissing(gaps: readonly LaneGap[]): Lane[] {
  const named = new Set(gaps.map((g) => g.lane));
  return (Object.keys(UNSERVED) as Lane[]).filter((lane) => named.has(lane));
}

/**
 * One line per gap, for `qc.json` and the CLI.
 *
 * Says what was asked for, where, and what will happen instead — because "we can't draw
 * this" without "so here is what you will get" is a complaint rather than a warning.
 */
export function laneGapLines(gaps: readonly LaneGap[]): string[] {
  return gaps.map((g) => {
    const { needs } = UNSERVED[g.lane];
    const where = g.where === 'topic' ? 'this lesson’s subject asks' : `beat ${g.where} asks`;
    const instead =
      g.kind === undefined
        ? 'whatever the beats ask for will be drawn by a lane that can only approximate it'
        : `it is drawn by the ${g.kind} lane, which will draw something plausible rather than something correct`;
    return `${where} for ${needs}, which inkcast has no lane for — "${g.quote}": ${instead}`;
  });
}
