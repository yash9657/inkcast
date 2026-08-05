/**
 * Stage 3 — compile. `Lesson` in, `Storyboard` out.
 *
 * The lesson decided *what to teach*; this decides *what gets drawn*, and it is
 * the join where a good plan either becomes a picture or degenerates into
 * captions. Four things it must get right:
 *
 * 1. **One scene per beat**, carrying the beat's `role` and its `hold`, so the
 *    pedagogy survives into the render and silence is deliberate rather than
 *    accidental dead air.
 * 2. **Real elements from every visual intent.** A `plot` intent becomes a real
 *    `PlotElement` with a sensible domain, the right named function and overlays
 *    that serve the idea (see `./plots.ts`); a `path` intent becomes drawn ink
 *    (see `./figures.ts`). Nothing is allowed to fall back to a caption.
 * 3. **Regions that accumulate.** Consecutive beats share a region and fill its
 *    cells, and the camera frames what has been drawn so far — so the board grows
 *    into a summary instead of wiping every eight seconds (see `./regions.ts`).
 * 4. **Cues over guesses.** Every element lands on a phrase from its own beat's
 *    narration wherever one can be found, so visuals arrive on the words that
 *    introduce them (see `./cues.ts`).
 *
 * Layout is geometric rather than iterative: each beat owns a disjoint cell, and
 * inside that cell text stacks above a figure area that is never smaller than
 * half the cell. Non-overlap is therefore a property of the construction, not
 * something a repair pass hopes to achieve.
 */
import type {
  Analogy,
  Asset,
  Cadence,
  CastMember,
  DiagramElement,
  Element,
  EquationElement,
  Lesson,
  LessonStep,
  Scene,
  Storyboard,
  TextElement,
  VisualIntent,
} from '@inkcast/core';
import {
  holdForCadence,
  lessonBeats,
  logger,
  parseStoryboard,
  report,
  resolveEmphasis,
  resolveTerms,
  sameTerm,
} from '@inkcast/core';
import { deriveCues, preferredCue } from './cues.js';
import { round } from './curves.js';
import type { Box } from './elements.js';
import { FONT, makeAsset, makeDiagram, makeEquation, makeText } from './elements.js';
import {
  blobPath,
  bowlPath,
  chevronPath,
  fogPaths,
  hillPath,
  hillPoint,
  walkerPaths,
} from './figures.js';
import type { BeatRole } from './regions.js';
import { planBoard } from './regions.js';
import { buildPlot, describesAPlot, plotHints, recipeChosen, trim } from './plots.js';
import { adaptLesson, resolvePreset } from './presets.js';
import type { Preset } from './presets.js';
import { shorten, stripMarkdown, wordCount } from './text.js';
import type { CompileOptions } from './types.js';

const log = logger('planner:compile');

/** Bump when compiled output changes in a way that should invalidate caches. */
export const COMPILER_VERSION = 1;

/* ------------------------------------------------------------------ assets */

type Registry = {
  use(slug: string, prompt: string, kind: Asset['kind']): string;
  cast(ref: NonNullable<VisualIntent['character']>, cast: CastMember[]): string;
  list(): Asset[];
};

function registry(): Registry {
  const map = new Map<string, Asset>();
  const mint = (id: string, asset: Asset): string => {
    const existing = map.get(id);
    if (existing) return existing.id;
    map.set(id, asset);
    return id;
  };
  return {
    use(slug, prompt, kind) {
      return mint(slug, {
        id: slug,
        kind,
        prompt,
        seed: seedOf(slug),
        source: kind === 'icon' ? 'builtin' : 'generated',
      });
    },

    /**
     * A cast member in one pose, as a library reference.
     *
     * The id carries the pose because the pose is part of what gets drawn: one asset id
     * is resolved once, so `explorer` in three poses has to be three entries or the
     * second beat silently redraws the first beat's pose. Identity survives that,
     * because a rig seeds its ink from the rig and the part — not from the asset id —
     * which is the whole reason `character.ts` refuses to seed per asset.
     *
     * No `version`: a reference goes in unpinned and comes out pinned by the visuals
     * stage, so inventing one here would freeze the storyboard against a library the
     * compiler never read.
     */
    cast(ref, cast) {
      const member = cast.find((c) => c.id === ref.id);
      const id = ref.pose ? `${ref.id}-${ref.pose}` : ref.id;
      return mint(id, {
        id,
        kind: 'illustration',
        prompt: member?.look || `${member?.name || ref.id}, hand-drawn line art`,
        ref: {
          path: `characters/${ref.id}`,
          ...(ref.pose ? { variant: ref.pose } : {}),
        },
        seed: seedOf(id),
        source: 'library',
      });
    },

    list: () => [...map.values()],
  };
}

function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 2147483647;
}

/* ------------------------------------------------------------------- public */

/**
 * Compile a `Lesson` into a `Storyboard`.
 *
 * Deterministic: the same lesson and options produce a byte-identical storyboard,
 * which is what lets the pipeline cache renders and lets tests pin the geometry.
 */
export function compileLesson(lesson: Lesson, opts: CompileOptions = {}): Storyboard {
  const preset = resolvePreset(opts);
  const shaped = adaptLesson(lesson, preset);
  const beats = lessonBeats(shaped);
  report(opts, { stage: 'plan', pct: 60, note: `${beats.length} beats → ${preset.name}` });

  // The abstraction has to arrive *out of* the concrete drawing, which means the
  // beat that plots it gives up its own cell and takes the drawing's place.
  const reuse = findReuse(beats, shaped.analogy);
  if (reuse.bridge) {
    log.info(
      `beat ${reuse.bridge.beat} turns beat ${reuse.bridge.host}'s drawing into a plot — morphing in place`,
      `${shaped.analogy?.maps.length ?? 0} mapped correspondences say they are the same thing`,
    );
  }
  // Every beat that builds on an earlier drawing shares that drawing's cell — words
  // included. A caption in a cell of its own, describing a picture in a different
  // cell, is what pulled the camera wide over an almost-empty panel.
  const board = planBoard(
    beats.map((b) => b.role),
    {
      aspect: preset.aspect,
      maxPerRegion: preset.maxPerRegion,
      sharesCellWith: reuse.annotates,
    },
  );

  // Which beats draw into each cell, in beat order. The host is first, because it is
  // the beat that draws the picture the others are talking about — and a cell nobody
  // shares is a group of one, which is why both of the divisions below can be read off
  // this single map.
  const cells = new Map<number, number[]>();
  beats.forEach((_, i) => {
    const host = reuse.annotates.get(i) ?? i;
    const group = cells.get(host) ?? [];
    group.push(i);
    cells.set(host, group);
  });

  // Who divides each cell's text zone, and who gets which row of its vocabulary strip.
  // Both are settled here, before any beat is built, for the same reason: a beat that
  // draws a picture has to leave room for words a *later* beat has not written yet.
  const vocab = planVocabulary(beats, preset);
  const bands = new Map<number, { bands: number; band: number }>();
  const strips = new Map<number, { rows: number; row: number }>();
  for (const group of cells.values()) {
    group.forEach((beat, k) => bands.set(beat, { bands: group.length, band: k }));
    // Only beats that actually write a term claim a row, so a cell whose sharers have
    // no vocabulary loses no drawing space to an empty strip.
    const writers = group.filter((beat) => (vocab[beat]?.length ?? 0) > 0);
    writers.forEach((beat, k) => strips.set(beat, { rows: writers.length, row: k }));
  }

  const assets = registry();
  const memory: BoardMemory = {};

  const scenes: Scene[] = beats.map(({ step, role }, i) => {
    const cell = inset(board.cellOf(i), 10);
    const share = bands.get(i);
    const strip = strips.get(i);
    const built = buildBeat({
      step,
      role,
      index: i,
      cell,
      preset,
      lesson: shaped,
      assets,
      memory,
      annotatesEarlier: reuse.annotates.has(i),
      morphsAnchor: reuse.bridge?.beat === i,
      cellBands: share?.bands ?? 1,
      cellBand: share?.band ?? 0,
      terms: vocab[i] ?? [],
      termRows: strip?.rows ?? 0,
      termRow: strip?.row ?? 0,
    });
    // Pacing is one decision. `cadence` sets this scene's speech rate (read later by
    // the voice stage) and bounds its trailing silence, so the two are settled here
    // together rather than by two stages that never meet.
    const paced = holdFor(step, role, preset);
    const emphasis = resolveEmphasis(step);
    for (const phrase of emphasis.missing) {
      log.warn(
        `beat ${i} emphasises "${phrase}", which is not in its narration — dropped ` +
          `(emphasis is located by text, so a phrase that is not there cannot be spoken ` +
          `or drawn differently)`,
      );
    }
    const scene: Scene = {
      id: `s${i}`,
      narration: step.narration.trim(),
      camera: board.cameraFor(i, role),
      elements: built,
      region: board.regionOf(i).key,
      role,
      hold: paced.hold,
      cadence: paced.cadence,
      emphasis: emphasis.found,
    };
    assignTiming(scene, built);
    return scene;
  });

  // A pan inside one region is a nudge; a pan to a new region is a move; the
  // recap's pull-back is the slowest shot in the video because it is the one the
  // learner is meant to read the whole board from.
  scenes.forEach((scene, i) => {
    const prev = scenes[i - 1];
    scene.camera.transition =
      i === 0 ? 0 : scene.role === 'recap' ? 1.3 : prev?.region === scene.region ? 0.45 : 0.95;
  });

  const sb: Storyboard = {
    version: 1,
    title: opts.title ?? shaped.topic,
    meta: {
      language: opts.language ?? 'en',
      aspect: preset.aspect,
      palette: opts.palette ?? 'color',
      fps: opts.fps ?? 30,
      style: opts.style ?? 'marker',
      voice: opts.voice ?? 'af_heart',
      // Long enough that the final board is still on screen after the last word. The
      // preset owns it, because the length estimate has to be able to count it.
      outroSec: preset.outroSec,
    },
    canvas: board.canvas,
    assets: assets.list(),
    scenes,
  };

  log.info(`compiled "${sb.title}"`, {
    scenes: scenes.length,
    regions: board.regions.length,
    canvas: `${board.canvas.w}x${board.canvas.h}`,
    preset: preset.name,
  });
  report(opts, { stage: 'plan', pct: 100, note: `${scenes.length} scenes` });
  return parseStoryboard(sb);
}

/* ------------------------------------------------------------- the vocabulary */

/**
 * Most terms one beat may write. A beat with a fourth term is a glossary, and the fix
 * for a glossary is more beats, not smaller handwriting.
 */
const MAX_TERMS = 3;

/**
 * Which term each beat writes on the board, settled for the whole lesson at once.
 *
 * Two decisions, and both need the whole lesson in view:
 *
 *  - **A term is written once.** The board never wipes, so the beat that introduces a
 *    term writes it and every later beat that says it again leaves it alone. Writing
 *    ATP three times in three cells does not teach it three times; it reads as three
 *    different things called ATP.
 *  - **A beat does not write what some cell already says.** A beat captioned "ATP: the
 *    cell's energy currency" has already written the word, so the strip does not draw it
 *    again — and neither does any later beat, because that caption is still up there.
 *
 * The captions counted are the ones the cells will really carry: `captionFor` shortens a
 * beat's `idea` to the preset's word budget, and the tail it cuts is not on the board.
 * The difference is load-bearing — the longitude anchor's idea names both latitude and
 * longitude, its caption keeps only the first nine words, and testing against the idea
 * would decide that "longitude" had been written when it had been cut.
 *
 * Every test uses `sameTerm`, so they hold for the *forms* of a word rather than for
 * exact strings: a beat whose caption says "molecules" does not also write "molecule".
 *
 * Returned per beat in spoken order, which is the order the strip writes them.
 */
export function planVocabulary(
  beats: { step: LessonStep; role: BeatRole }[],
  preset: Preset,
): string[][] {
  const written = beats.map(({ step, role }) => captionFor(step, role, preset)).filter(Boolean);
  return beats.map(({ step }) => {
    const out: string[] = [];
    for (const term of resolveTerms(step).found) {
      if (out.length >= MAX_TERMS) break;
      if (!term || written.some((seen) => sameTerm(seen, term))) continue;
      written.push(term);
      out.push(term);
    }
    return out;
  });
}

/**
 * How far through a beat's words a term is first spoken, as a fraction.
 *
 * The cue is what actually lands the word on the voice — resolved to a real timestamp,
 * word-exactly — so this is only the fallback for a beat that was never narrated. It is
 * still worth deriving honestly rather than spacing the terms evenly: `assignTiming`
 * orders elements by this number, and a term written before the figure it belongs to
 * would be drawn in the wrong order on a silent render.
 */
function spokenAt(narration: string, term: string): number {
  const at = narration.toLowerCase().indexOf(term.toLowerCase());
  if (at < 0) return 0;
  const before = wordCount(narration.slice(0, at));
  const total = Math.max(1, wordCount(narration));
  return Math.min(0.92, before / total);
}

/* --------------------------------------------------- the abstraction's arrival */

/**
 * Which beats build on an earlier beat's freeform drawing rather than making one of
 * their own.
 *
 * Two kinds, and the difference is how much they give up:
 *
 *  - **annotations** draw onto the host's picture while keeping their own cell for
 *    their own words. The anchor walking down the hill the hook drew is this: one
 *    hillside with a figure on it, not two hillsides side by side.
 *  - the **bridge** additionally gives up its cell, because it is not annotating the
 *    drawing but *replacing* it — the hill becoming the plot has to happen where the
 *    hill is.
 *
 * At most one bridge per lesson; it must be a `step` that actually asks for a `plot`,
 * there must be a drawing before it to grow out of, and the lesson must have declared
 * an analogy with at least one correspondence. Anything less certain draws normally,
 * which is what every lesson did before this existed.
 */
export type BoardReuse = {
  /** `beat -> host beat` for every beat that draws onto an earlier drawing. */
  annotates: Map<number, number>;
  /** The beat whose plot replaces the host's drawing, and that host. */
  bridge: { beat: number; host: number } | null;
};

/**
 * Where the abstraction arrives, derived from the lesson's own analogy rather than
 * detected in its prose.
 *
 * This used to be a regex over `idea` and `narration` looking for a becoming-verb near
 * the vocabulary of a plot — "the hill *is really a graph*". It worked on the shipped
 * lesson and was luck everywhere else: it fired on any passing mention of a curve and
 * missed every lesson that made the same move in different words, so whether the
 * abstraction was *shown* or merely asserted came down to phrasing.
 *
 * The mapping table replaces the guess. A lesson that declares `analogy.maps` has said,
 * structurally, that this concrete thing stands for that abstract one; so the first
 * `step` that draws a plot after the concrete thing was drawn *is* the moment the
 * abstraction arrives, and it arrives by growing out of the drawing already there.
 *
 * Deliberately no text matching of any kind, not even against the mapping's own terms.
 * That was tried and it is wrong here: the benchmark lesson keeps `loss`, `parameter`
 * and `gradient` in its `jargonBudget` and never says them at the bridge, so matching
 * `to` terms against the narration finds nothing and the shipped lesson stops morphing.
 * Wording is the thing being removed from this decision, and that has to include the
 * wording of the map.
 */
export function findReuse(
  beats: { step: LessonStep; role: BeatRole }[],
  analogy?: Analogy,
): BoardReuse {
  const annotates = new Map<number, number>();
  /** The beat that owns the setup's drawing — the first one to make it, not the last. */
  let owner: number | null = null;
  let bridge: { beat: number; host: number } | null = null;
  /** No declared correspondences, no claim that the two things are the same thing. */
  const mapped = (analogy?.maps.length ?? 0) > 0;

  for (let i = 0; i < beats.length; i++) {
    const { step, role } = beats[i]!;
    if (role === 'hook' || role === 'anchor') {
      // Only a freeform drawing can be annotated or reshaped; a beat whose visuals
      // are words or a diagram has nothing another beat can stand on.
      if (!step.visuals.some((v) => v.kind === 'path')) continue;
      if (owner === null) owner = i;
      else annotates.set(i, owner);
      continue;
    }
    if (bridge || !mapped || role !== 'step' || owner === null) continue;
    if (!step.visuals.some((v) => v.kind === 'plot')) continue;
    bridge = { beat: i, host: owner };
    annotates.set(i, owner);
  }
  return { annotates, bridge };
}

/**
 * What earlier beats left on the board for later ones to build on.
 *
 * Only the anchor's drawing so far, and only because the morph needs it: the beat
 * that draws the plot has to know where the hillside is and what it is called, which
 * is not something a beat can work out from its own step.
 */
type BoardMemory = {
  /**
   * The concrete freeform drawing the setup established.
   *
   * `id` and `box` are the stroke the abstraction is reshaped out of. `ink` is every
   * element that belongs to that same drawing — the fog across the hillside, the
   * figure standing on it, the strides down it — because when the hill becomes a
   * graph those have to go with it. Left up, the fog lies across the finished axes
   * and the walker stands in mid-air where the slope used to be.
   */
  anchor?: { id: string; box: Box; ink: string[] };
};

/** Seconds of silence after a beat: a breath, and longer after a question. */
/**
 * This beat's cadence and the silence that follows it, settled together.
 *
 * The pedagogical bonuses are unchanged — a question the learner is meant to attempt
 * needs real silence, and a misconception needs a moment to land — but they are now
 * *requests* rather than the last word. `holdForCadence` adds them to the cadence's
 * baseline and clamps the result to what that cadence permits, so a beat delivered
 * as a quick aside cannot come out with two seconds of dead air after it. That was
 * previously possible and had no way of being noticed: the hold was decided here and
 * the speech rate was decided in the voice stage, from a global setting.
 */
/**
 * Text roles in descending visual weight — the renderer owns the type scale, so this
 * is the order, not the sizes.
 */
const TEXT_WEIGHT: TextElement['role'][] = ['title', 'heading', 'body', 'label', 'caption'];

/**
 * One step up the type scale, when this text carries the beat's emphasis.
 *
 * One step and no more. Emphasis that jumps a caption to `title` stops being emphasis
 * and becomes a different layout — and the planner has already measured the cell for
 * the role it chose.
 */
function weightUp(role: TextElement['role'], stressed: boolean): TextElement['role'] {
  if (!stressed) return role;
  const i = TEXT_WEIGHT.indexOf(role);
  return i > 0 ? TEXT_WEIGHT[i - 1]! : role;
}

function holdFor(
  step: LessonStep,
  role: BeatRole,
  preset: Preset,
): { cadence: Cadence; hold: number } {
  const asks = /[?]\s*$/.test(step.narration.trim());
  const bonus = preset.holdBonus + (asks ? 1 : role === 'misconception' ? 0.4 : 0);
  const paced = holdForCadence(step, role, bonus);
  return { cadence: paced.cadence, hold: round(paced.hold, 2) };
}

/* --------------------------------------------------------------- one beat */

type BeatContext = {
  step: LessonStep;
  role: BeatRole;
  index: number;
  cell: Box;
  preset: Preset;
  lesson: Lesson;
  assets: Registry;
  /** Mutable: what the setup drew, so a later beat can reshape it. */
  memory: BoardMemory;
  /** This beat draws onto the remembered drawing instead of making its own. */
  annotatesEarlier: boolean;
  /** This beat's plot grows out of the remembered drawing, replacing it. */
  morphsAnchor: boolean;
  /** How many beats divide this cell's text zone between them. 1 when it is ours. */
  cellBands: number;
  /** Which of those bands this beat's words go in, from the top. */
  cellBand: number;
  /** Vocabulary this beat writes, in spoken order. See `planVocabulary`. */
  terms: string[];
  /** Rows the cell's vocabulary strip holds, across every beat sharing the cell. */
  termRows: number;
  /** Which of those rows is this beat's, from the top. */
  termRow: number;
};

/** Which intents want a figure box, and which are text notes. */
function partition(step: LessonStep): { notes: VisualIntent[]; figures: VisualIntent[] } {
  const notes = step.visuals.filter((v) => v.kind === 'text');
  const figures = step.visuals.filter((v) => v.kind !== 'text');
  return { notes, figures };
}

function buildBeat(ctx: BeatContext): Element[] {
  const { step, role, index, cell, preset } = ctx;
  const eid = (name: string) => `b${index}_${name}`;
  const cueOf = new Map<string, string>();
  const elements: Element[] = [];

  /**
   * The other half of `emphasis`: words the beat leans on are drawn heavier.
   *
   * Only where the emphasised words are *actually on the board*. Emphasis names
   * phrases of the narration, and most of what is said is never written down — so
   * this promotes the elements that happen to carry those words and silently leaves
   * the rest, rather than inventing a mark for something the learner cannot see.
   */
  const stressed = resolveEmphasis(step).found;
  const carries = (text: string): boolean => {
    if (!stressed.length) return false;
    const haystack = text.toLowerCase();
    return stressed.some((e) => haystack.includes(e.toLowerCase()));
  };

  /* --- the caption that names this cell --- */
  const captionText = captionFor(step, role, preset);
  const caption = makeText(
    eid('idea'),
    captionText,
    weightUp(preset.captionRole, carries(captionText)),
    {
      maxWidth: cell.w,
      align: 'center',
    },
  );

  /* --- text notes: the model's own text intents, plus worked arithmetic --- */
  const { notes, figures } = partition(step);
  const noteEls: Array<TextElement | EquationElement> = notes.map((intent, k) => {
    const body = noteText(intent.describe);
    const el = makeText(
      eid(`note${k}`),
      body,
      weightUp(preset.vertical ? 'heading' : 'body', carries(body)),
      {
        maxWidth: cell.w,
        align: 'center',
      },
    );
    if (intent.cue) cueOf.set(el.id, intent.cue);
    return el;
  });
  const sum = updateLine(step, role);
  if (sum) {
    noteEls.push(
      makeEquation(eid('sum'), sum, 'heading', {
        maxWidth: cell.w,
        align: 'center',
      }),
    );
  }

  /* --- how much room the words may take before the picture wins --- */
  //
  // Several beats can draw into one cell — the anchor walking down the hook's hill,
  // the step that turns it into a plot — and when they do, the cell's text zone is
  // divided between them in advance. Doing it in advance is the point: the beat that
  // draws the picture has to leave room for words a later beat has not written yet,
  // or the second caption lands on the drawing.
  //
  // Every one of them keeps its words in the *same* cell as the drawing they are
  // talking about. Giving an annotating beat its own cell for a caption is what
  // dragged the camera wide over an almost-empty panel and put the frame fill at 16%.
  const bands = Math.max(1, ctx.cellBands);
  const texts: Array<TextElement | EquationElement> = [caption, ...noteEls];
  const wanted = texts.reduce((h, t) => h + t.at.h, 0) + texts.length * 16;
  const zone = cell.h * (ctx.preset.vertical ? 0.34 : 0.4);
  const budget = Math.min(wanted, zone / bands);
  const scale = wanted > budget ? budget / wanted : 1;
  let y = cell.y + (zone / bands) * Math.min(ctx.cellBand, bands - 1);
  texts.forEach((t, k) => {
    const h = round(t.at.h * scale, 2);
    t.at = { x: round(cell.x + (cell.w - t.at.w) / 2, 2), y: round(y, 2), w: t.at.w, h };
    y += h + 16 * scale;
    // The caption names the cell from the start; a note is a line the narrator
    // reaches later, so it is written when they get there rather than up front.
    if (k > 0) t.enter = { ...t.enter, at: round(Math.min(0.8, 0.34 + (k - 1) * 0.12), 3) };
    elements.push(t);
  });

  /* --- the vocabulary, along the foot of the cell --- */
  //
  // A row at the bottom rather than another line in the text stack above, for two
  // reasons. The stack is measured against a budget and scaled down when it overflows,
  // so putting terms in it would shrink the caption of every beat that has any — and
  // the terms are the one thing on this board the learner has to be able to read. And
  // the strip reaches the bottom edge of the cell, so a beat with one small figure
  // stops leaving the bottom third of its cell blank.
  const stripH = ctx.termRows * TERM_ROW_H;
  const termEls = ctx.terms.length
    ? termRow(ctx, cell, cell.y + cell.h - stripH + ctx.termRow * TERM_ROW_H, eid)
    : [];

  /* --- the figure area: the rest of the cell, above the vocabulary --- */
  // The text budget above caps words at 40% of the cell and the strip below takes one
  // short row per beat writing into it, so the picture keeps the larger share of every
  // cell either shipped lesson produces. Clamping to the cell rather than taking a
  // minimum height is what keeps every element provably inside its own cell, and
  // therefore inside its region: an element that overflowed downwards would collide
  // with the beat below it, which is the one thing region sharing must never do.
  //
  // With the cell to itself, the picture starts right under this beat's own words,
  // so short text means a bigger drawing. With the cell shared it starts under the
  // *whole* text zone instead, because the bands below this one belong to captions
  // later beats have not written yet.
  const figureTop = bands === 1 ? y : cell.y + zone;
  const figureArea: Box = {
    x: cell.x,
    y: round(figureTop, 2),
    w: cell.w,
    h: round(Math.max(60, cell.y + cell.h - stripH - figureTop), 2),
  };

  // A `motion` intent alongside a `plot` intent rides that plot instead of
  // claiming a box of its own — the ball belongs *on* the curve, not next to it.
  const ridesAPlot = (v: VisualIntent) =>
    v.kind === 'motion' && figures.some((f) => f.kind === 'plot');
  const boxed = figures.filter((v) => !ridesAPlot(v));
  const boxes = figureBoxes(figureArea, Math.max(1, boxed.length), ctx.preset);
  let cursor = 0;
  let lastPlotId: string | undefined;

  figures.forEach((intent, k) => {
    const merged = ridesAPlot(intent) && lastPlotId !== undefined;
    // The plot recipes already put a ball on the curve where the beat is about
    // descent, so an explicit `motion` intent alongside one must not draw a
    // second ball. It re-cues the existing one instead: the thing that was
    // already moving now starts on the words that announce the movement.
    if (merged) {
      const moving = elements.find((el) => el.motion !== undefined);
      if (moving) {
        if (intent.cue) cueOf.set(moving.id, intent.cue);
        return;
      }
    }
    const box = merged ? figureArea : (boxes[Math.min(cursor, boxes.length - 1)] ?? figureArea);
    if (!merged) cursor += 1;
    const made = buildIntent(intent, {
      ...ctx,
      id: eid(`v${k}`),
      box,
      hostPlotId: lastPlotId,
      existing: elements,
    });
    for (const el of made) {
      if (el.type === 'plot') lastPlotId = el.id;
      elements.push(el);
    }
    const first = made[0];
    if (first && intent.cue) cueOf.set(first.id, intent.cue);
  });

  /* --- a recap with no visuals still gets the chain drawn --- */
  if (role === 'recap' && !figures.length) {
    const chain = recapChain(ctx.lesson, eid('chain'), figureArea, ctx.preset);
    if (chain) elements.push(chain);
  }

  /* --- nothing to look at at all: draw the idea big rather than small --- */
  if (elements.length === 1 && !figures.length && !noteEls.length) {
    const big = makeText(eid('point'), captionText, 'title', {
      maxWidth: figureArea.w,
      align: 'center',
    });
    big.at = {
      x: round(figureArea.x + (figureArea.w - big.at.w) / 2, 2),
      y: round(figureArea.y + (figureArea.h - big.at.h) / 2, 2),
      w: big.at.w,
      h: big.at.h,
    };
    elements.push(big);
  }

  // Last, so that a beat drawing nothing but words still counts as having nothing to
  // look at above: the vocabulary is what the narrator says, not the beat's picture.
  elements.push(...termEls);

  for (const el of elements) {
    const wantedCue = cueOf.get(el.id);
    if (wantedCue) el.enter = { ...el.enter, cue: wantedCue };
  }
  return elements;
}

/* --------------------------------------------------------- the vocabulary strip */

/** Type scale for a written term. */
const TERM_ROLE: TextElement['role'] = 'label';
/** Space between two terms on the same row, so they read as separate words. */
const TERM_GAP = 44;
/** One row of the strip, including the air above it. */
const TERM_ROW_H = round(FONT[TERM_ROLE] * 1.34 + 14, 2);

/**
 * The terms a beat writes, laid out as one row along the foot of its cell.
 *
 * Each term is its own element because each lands on its own word: the term is the cue,
 * so the voice stage resolves it to the moment the narrator says it and the board writes
 * it there. One element holding "ATP · NADPH" could only arrive once, which is the
 * difference between vocabulary appearing as it is taught and a caption listing it.
 *
 * A row that does not fit is cut from the end rather than shrunk — the terms are set at
 * the size the rest of the board's labels are, and a term too small to read is not
 * written. The cut is logged, because a silently dropped term reads as a term the lesson
 * never named.
 */
function termRow(
  ctx: BeatContext,
  cell: Box,
  top: number,
  eid: (name: string) => string,
): TextElement[] {
  const made = ctx.terms.map((term, k) =>
    makeText(eid(`term${k}`), term, TERM_ROLE, { maxWidth: cell.w, align: 'center' }),
  );
  const fits: TextElement[] = [];
  let used = 0;
  for (const el of made) {
    const width = used === 0 ? el.at.w : used + TERM_GAP + el.at.w;
    if (width > cell.w) break;
    used = width;
    fits.push(el);
  }
  if (fits.length < made.length) {
    log.warn(
      `beat ${ctx.index} names ${made.length} terms and its cell has room for ${fits.length}`,
      `dropped ${made
        .slice(fits.length)
        .map((el) => `"${el.text}"`)
        .join(', ')} — say fewer terms per beat, or split the beat`,
    );
  }

  let x = cell.x + (cell.w - used) / 2;
  for (const el of fits) {
    el.at = { x: round(x, 2), y: round(top, 2), w: el.at.w, h: el.at.h };
    x += el.at.w + TERM_GAP;
    // The cue is the term itself, verbatim, which is as exact as a cue gets: the board
    // writes the word on the word.
    el.enter = {
      ...el.enter,
      at: round(spokenAt(ctx.step.narration, el.text), 3),
      cue: el.text,
    };
  }
  return fits;
}

/** The words that name a cell on the finished board. */
function captionFor(step: LessonStep, role: BeatRole, preset: Preset): string {
  const idea = stripMarkdown(step.idea).replace(/\s+/g, ' ').trim();
  const text = shorten(idea, preset.captionWords);
  if (text) return text;
  return shorten(stripMarkdown(step.narration), preset.captionWords) || role;
}

function noteText(describe: string): string {
  return shorten(stripMarkdown(describe).replace(/^(?:write|show|draw|display)\s+/i, ''), 12);
}

/**
 * The update line for a worked example, built from the numbers the beat states.
 *
 * The arithmetic on the board is *computed*, not copied: if the intent says
 * w = 3, slope = +4, lr = 0.1, the line reads `w ← 3 − 0.1 × 4 = 2.6` because
 * 3 − 0.4 really is 2.6. A learner who checks the sum is rewarded, which is the
 * entire point of a worked example.
 *
 * **This returns TeX, and the compiler emits it as an `equation`.** It used to return a
 * Unicode string for a `text` element, which is the "arithmetic as text" defect step 3
 * of `PIPELINE.md` exists to remove: `←` and `−` were whatever the handwriting font had
 * for them — often a hyphen standing in for a minus — and nothing here could ever have
 * written a fraction. The numbers are the one thing on the board a learner is invited to
 * check, so they are now set as real mathematics.
 */
export function updateLine(step: LessonStep, role: BeatRole): string | undefined {
  if (role !== 'worked') return undefined;
  const hints = plotHints(step.visuals.map((v) => v.describe).join(' '), step.narration, step.idea);
  const { start, slope, lr, next: claimed } = hints;
  if (start === undefined || slope === undefined || lr === undefined) return undefined;
  const next = round(start - lr * slope, 4);
  if (claimed !== undefined && Math.abs(claimed - next) > 0.05) {
    // The board shows the arithmetic, so the lesson cannot be allowed to disagree
    // with it silently: a learner who checks the sum is the whole audience here.
    log.warn(
      `the worked example says ${claimed} but ${trim(start)} − ${trim(lr)} × ${trim(slope)} = ${trim(next)}`,
      'the drawn number is the computed one — fix the lesson, not the picture',
    );
  }
  const sign = slope < 0 ? '+' : '-';
  return `w \\leftarrow ${trim(start)} ${sign} ${trim(lr)} \\times ${trim(Math.abs(slope))} = ${trim(next)}`;
}

/** Split a figure area between several figures. */
function figureBoxes(area: Box, n: number, preset: Preset): Box[] {
  if (n <= 1) return [area];
  const gap = 30;
  // Vertical output stacks: side-by-side figures in a 1080-wide frame are too
  // small to read, which is exactly the crop-not-redesign failure we are avoiding.
  if (preset.vertical || n > 3) {
    const h = (area.h - gap * (n - 1)) / n;
    return Array.from({ length: n }, (_, i) => ({
      x: area.x,
      y: round(area.y + i * (h + gap), 2),
      w: area.w,
      h: round(h, 2),
    }));
  }
  const w = (area.w - gap * (n - 1)) / n;
  return Array.from({ length: n }, (_, i) => ({
    x: round(area.x + i * (w + gap), 2),
    y: area.y,
    w: round(w, 2),
    h: area.h,
  }));
}

/* ------------------------------------------------------------ visual intents */

type IntentContext = BeatContext & {
  id: string;
  box: Box;
  /** A plot already built in this beat, for a `motion` intent to ride. */
  hostPlotId?: string;
  existing: Element[];
};

function buildIntent(intent: VisualIntent, ctx: IntentContext): Element[] {
  const describe = intent.describe || ctx.step.idea;
  // Naming a cast member settles what to draw, so it outranks `kind` — which
  // defaults to `plot` and would otherwise turn "draw Mara, walking" into a graph
  // for any author who wrote the character and left the kind alone.
  if (intent.character) return buildAsset(describe, 'illustration', ctx, intent.character);
  switch (intent.kind) {
    case 'plot': {
      // An author said `plot` — or said nothing, since `plot` is the schema's default —
      // and described something with no quantity, no axis and no shape in it. No recipe
      // matched, so what would be drawn is the fallback: a parabola labelled `w` and
      // `loss`, which is gradient descent's vocabulary appearing in a lesson about
      // something else. Drawing the words is worse than a good picture and better than a
      // false one, so the intent goes to the diagram lane instead, and loudly.
      if (!recipeChosen(describe, ctx.step.narration) && !describesAPlot(describe)) {
        log.warn(
          `beat ${ctx.index} asked for a plot of "${describe}", which names no quantity`,
          'a plot needs something measurable and something it varies against — drawing it ' +
            'as a diagram instead. Say what is on each axis, or ask for a different kind.',
        );
        return buildDiagram(describe, ctx);
      }
      // The one plot that is not drawn but *grown*: it takes the anchor's box so the
      // axes appear around the shape already there, and names it so the renderer can
      // bend one into the other. This is the moment the abstraction earns its keep,
      // and it is the difference between showing that the hill and the graph are the
      // same thing and merely saying so.
      const grow = ctx.morphsAnchor ? ctx.memory.anchor : undefined;
      const built = buildPlot(
        {
          id: ctx.id,
          box: grow ? grow.box : ctx.box,
          narration: ctx.step.narration,
          vertical: ctx.preset.vertical,
        },
        intent,
      );
      if (grow) {
        for (const el of built) {
          if (el.type !== 'plot') continue;
          el.morph = {
            fromId: grow.id,
            from: 0.12,
            to: 0.62,
            easing: 'ease',
            retire: true,
            // The rest of the hillside goes with it. Everything in `ink` was drawn
            // onto the slope, so once the slope is a curve none of it means anything.
            retires: [...grow.ink],
          };
        }
      }
      return built;
    }
    case 'path':
      return buildFreeform(describe, ctx);
    case 'diagram':
      return buildDiagram(describe, ctx);
    case 'icon':
    case 'illustration':
      return buildAsset(describe, intent.kind, ctx, intent.character);
    case 'motion':
      return buildMotion(describe, ctx);
    default:
      return buildFreeform(describe, ctx);
  }
}

/* ------------------------------------------------------------------ freeform */

const HILL = /hill|hillside|mountain|terrain|slope of|walk(?:ing)? down|foggy|landscape/i;
const BOWL = /bowl|valley|u[- ]shape|basin|dip|cross[- ]section/i;
const CONTAINER = /blob|cloud|container|group|everything inside|circle around/i;
const FIGURE = /figure|person|walker|hiker|someone|you (?:are|stand)|standing/i;
const FOG = /fog|mist|cloud|cannot see|can't see|blind/i;
const STEPS = /steps?|stride|footstep|one step at a time|repeat/i;

/**
 * Freeform ink: the escape hatch that lets a lesson open with something concrete.
 *
 * Keyword-driven on purpose — a hillside, a walker, fog and three steps down are
 * the vocabulary an anchor actually needs, and each one is real geometry rather
 * than a placeholder rectangle.
 */
function buildFreeform(describe: string, ctx: IntentContext): Element[] {
  const text = `${describe} ${ctx.step.idea}`;
  const box = ctx.box;
  const out: Element[] = [];

  const timed = (el: Element, at: number): Element => {
    el.enter = { ...el.enter, at: round(at, 3) };
    return el;
  };

  if (BOWL.test(text) && !HILL.test(text)) {
    out.push(timed(bowlPath(ctx.id, inset(box, 12)), 0.08));
    return out;
  }
  if (CONTAINER.test(text) && !HILL.test(text)) {
    out.push(timed(blobPath(ctx.id, inset(box, 16), ctx.index + 1), 0.08));
    return out;
  }

  // Default to a hillside: it is the shape almost every "concrete before
  // abstract" anchor reaches for, and the one the loss curve later becomes.
  //
  // If the setup already drew one, this beat annotates *that* hill rather than
  // drawing a second one beside it. Two hillsides side by side is the failure this
  // guards against: the anchor's job is to walk down the hill the hook established,
  // and a fresh drawing silently tells the learner it is a different hill.
  const remembered = ctx.memory.anchor;
  const annotate = ctx.annotatesEarlier && remembered !== undefined;
  const hillBox: Box = annotate
    ? remembered.box
    : { x: box.x + 8, y: box.y + box.h * 0.12, w: box.w - 16, h: box.h * 0.74 };
  if (annotate) {
    log.debug(`beat ${ctx.index} annotates the hill drawn as "${remembered.id}"`);
  } else {
    out.push(timed(hillPath(ctx.id, hillBox), 0.08));
    // Remembered for the beat that turns it into a plot, and for any later beat
    // that wants to stand another figure on the same slope.
    if (ctx.role === 'hook' || ctx.role === 'anchor') {
      ctx.memory.anchor = { id: ctx.id, box: hillBox, ink: [] };
    }
  }
  if (FOG.test(text)) {
    fogPaths(`${ctx.id}_fog`, box, ctx.preset.vertical ? 2 : 3).forEach((el, k) =>
      out.push(timed(el, 0.2 + k * 0.04)),
    );
  }
  if (FIGURE.test(text) || /you\b/i.test(ctx.step.narration)) {
    // A walker stands *up* from the hill, so the space above their feet is the
    // real constraint — sized off the box alone they would grow out of the cell
    // and collide with the beat above.
    const feet = hillPoint(hillBox, 0.18);
    const headroom = Math.max(40, (feet.y - box.y) / 0.9);
    const height = Math.min(150, box.h * 0.3, headroom);
    // The strokes of one figure arrive together: a head, then a spine, then legs,
    // over about a tenth of the beat, which is how a person draws a person.
    walkerPaths(`${ctx.id}_you`, feet, height, 1).forEach((el, k) =>
      out.push(timed(el, 0.34 + k * 0.025)),
    );
  }
  if (STEPS.test(text)) {
    // Three strides down the hill, each drawn on its own cue: feel, step, repeat.
    const ts = [0.34, 0.5, 0.66];
    ts.forEach((t, k) => {
      const from = hillPoint(hillBox, t - 0.09);
      const to = hillPoint(hillBox, t);
      const step = chevronPath(`${ctx.id}_step${k}`, from, to);
      step.enter = { at: round(0.5 + k * 0.14, 3), duration: 0.5, style: 'draw' };
      out.push(step);
    });
  }

  // Everything drawn onto the slope — fog across it, a figure on it, strides down
  // it — is part of the same picture as the slope itself, whichever beat added it.
  // The beat that turns the slope into a graph retires the lot, because none of it
  // means anything once the slope is a curve.
  const drawing = ctx.memory.anchor;
  if (drawing) {
    for (const el of out) if (el.id !== drawing.id) drawing.ink.push(el.id);
  }
  return out;
}

/* ------------------------------------------------------------------ diagrams */

/** Node labels out of a drawing instruction: "A → B → C", or a comma list. */
export function nodesFrom(describe: string, max = 6): string[] {
  const clean = stripMarkdown(describe);
  const body = clean.includes(':') ? clean.slice(clean.indexOf(':') + 1) : clean;
  const parts = body
    .split(/\s*(?:→|->|=>|\bthen\b|;|,)\s*/i)
    .map((s) => s.replace(/^(?:a|an|the)\s+/i, '').trim())
    .filter((s) => wordCount(s) >= 1)
    .map((s) => shorten(s, 5));
  return parts.slice(0, max);
}

function buildDiagram(describe: string, ctx: IntentContext): Element[] {
  const labels = nodesFrom(describe);
  if (labels.length < 2) {
    const el = makeText(ctx.id, shorten(stripMarkdown(describe), 12), 'body', {
      maxWidth: ctx.box.w,
      align: 'center',
    });
    el.at = centre(el.at, ctx.box);
    return [el];
  }
  const ordered = /→|->|=>|\bthen\b|\bstep\b|first|finally|pipeline|flow/i.test(describe);
  const nodes = labels.map((label, k) => ({ id: `n${k}`, label }));
  const edges = ordered ? nodes.slice(1).map((n, k) => ({ from: nodes[k]!.id, to: n.id })) : [];
  const el: DiagramElement = makeDiagram(ctx.id, ordered ? 'flow' : 'stack', nodes, edges, {
    w: ctx.box.w,
    h: ctx.box.h,
  });
  el.at = { x: ctx.box.x, y: ctx.box.y, w: ctx.box.w, h: ctx.box.h };
  el.enter = { ...el.enter, at: 0.08 };
  return [el];
}

function recapChain(lesson: Lesson, id: string, box: Box, preset: Preset): Element | undefined {
  const ideas = lesson.steps.map((s) => shorten(stripMarkdown(s.idea), preset.vertical ? 5 : 7));
  const nodes = [shorten(stripMarkdown(lesson.anchor.idea), 5), ...ideas]
    .filter(Boolean)
    .slice(0, preset.vertical ? 4 : 6)
    .map((label, k) => ({ id: `r${k}`, label }));
  if (nodes.length < 2) return undefined;
  const edges = nodes.slice(1).map((n, k) => ({ from: nodes[k]!.id, to: n.id }));
  const el = makeDiagram(id, 'flow', nodes, edges, { w: box.w, h: box.h });
  el.at = { x: box.x, y: box.y, w: box.w, h: box.h };
  el.enter = { ...el.enter, at: 0.12 };
  return el;
}

/* -------------------------------------------------------------------- assets */

/**
 * An `icon` or `illustration` intent: mint the entity, and route nothing.
 *
 * This used to match lucide here and mint the *icon* — id `rocket`, prompt "a rocket
 * taking off" — which destroyed the only evidence of what the beat asked for before
 * any better lane could see it. "Odysseus tied to the mast of his ship" drew a rocket,
 * and nothing downstream could recover, because the library was asked about a rocket.
 *
 * There is exactly one asset router and it lives in the visuals stage
 * (`resolveAsset`): inline → library → generate → lucide → letter. It is a superset of
 * what was here — lane 3 runs the same lucide match on the id and the prompt — so this
 * loses no icon that used to resolve; it just stops jumping the queue in front of the
 * library. Same shape as step 1's dead plot solver: two implementations of one
 * decision, the earlier and worse one running first.
 *
 * A cast member takes the earlier branch instead: the lesson named who this is, so the
 * intent carries a library path and there is nothing to route.
 */
function buildAsset(
  describe: string,
  kind: 'icon' | 'illustration',
  ctx: IntentContext,
  character?: VisualIntent['character'],
): Element[] {
  const size = Math.min(ctx.box.w, ctx.box.h) * 0.82;

  const assetId = character
    ? ctx.assets.cast(character, ctx.lesson.cast)
    : ctx.assets.use(
        slugOf(describe),
        kind === 'illustration'
          ? `${stripMarkdown(describe)}, hand-drawn line art, marker on whiteboard`
          : stripMarkdown(describe),
        kind,
      );

  const el = makeAsset(ctx.id, assetId, size);
  el.at = centre(el.at, ctx.box);
  el.enter = { ...el.enter, at: 0.08 };
  return [el];
}

function slugOf(describe: string): string {
  const words = stripMarkdown(describe)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 4);
  return words.join('-') || 'illustration';
}

/* -------------------------------------------------------------------- motion */

/**
 * A `motion` intent: something that moves, because movement is most of what makes
 * an explanation legible.
 *
 * When the beat already drew a plot, the moving thing rides that plot's curve —
 * the ball really does follow the loss surface, at the x values gradient descent
 * actually produces. Otherwise it travels across the figure box, which is enough
 * for "a token flows through the pipeline".
 */
function buildMotion(describe: string, ctx: IntentContext): Element[] {
  const host = ctx.existing.find((el) => el.id === ctx.hostPlotId && el.type === 'plot');
  if (host && host.type === 'plot') {
    const intent: VisualIntent = { describe, kind: 'plot' };
    // Reuse the descent recipe against the host plot's own box, then keep only
    // the moving element: the curve is already on the board.
    const rebuilt = buildPlot(
      {
        id: `${ctx.id}_m`,
        box: host.at,
        narration: ctx.step.narration,
        vertical: ctx.preset.vertical,
      },
      intent,
    );
    const mover = rebuilt.find((el) => el.motion !== undefined);
    if (mover) return [mover];
  }
  const from = { x: ctx.box.x + ctx.box.w * 0.08, y: ctx.box.y + ctx.box.h * 0.28 };
  const to = { x: ctx.box.x + ctx.box.w * 0.92, y: ctx.box.y + ctx.box.h * 0.72 };
  const mover = chevronPath(ctx.id, from, to);
  mover.motion = {
    path: [from, { x: (from.x + to.x) / 2, y: from.y + (to.y - from.y) * 0.35 }, to],
    from: 0.3,
    to: 0.9,
    easing: 'ease',
    trail: true,
  };
  return [mover];
}

/* -------------------------------------------------------------------- timing */

/**
 * Give every element a time to arrive.
 *
 * Elements are ordered by whatever time their builder asked for, then cued from
 * successive slices of the narration, so the drawing order and the spoken order
 * agree. A builder's deliberate fraction is preserved as the fallback the voice
 * stage uses if the phrase cannot be found — the two are complementary, not
 * alternatives.
 */
export function assignTiming(scene: Scene, elements: Element[]): void {
  const n = elements.length;
  if (!n) return;
  const ordered = elements
    .map((el, i) => ({ el, i, at: el.enter.at }))
    .sort((a, b) => a.at - b.at || a.i - b.i);
  const cues = deriveCues(scene.narration, n);
  let previous = -1;
  ordered.forEach((entry, k) => {
    const derived = cues[k];
    const cue = preferredCue(scene.narration, entry.el.enter.cue, derived);
    let at = entry.at > 0 ? entry.at : k === 0 ? 0 : 0.06 + (k * 0.72) / Math.max(1, n - 1);
    if (at <= previous) at = previous + 0.04;
    at = Math.min(0.92, Math.max(0, at));
    previous = at;
    entry.el.enter = {
      at: round(at, 3),
      duration: entry.el.enter.duration,
      style: entry.el.enter.style,
      ...(cue ? { cue } : {}),
    };
    if (entry.el.motion) {
      const start = Math.min(0.9, Math.max(entry.el.motion.from, at + 0.06));
      entry.el.motion = {
        ...entry.el.motion,
        from: round(start, 3),
        to: round(Math.max(start + 0.05, entry.el.motion.to), 3),
      };
    }
  });
}

/* ------------------------------------------------------------------- helpers */

function inset(box: Box, by: number): Box {
  return {
    x: round(box.x + by, 2),
    y: round(box.y + by, 2),
    w: round(Math.max(24, box.w - by * 2), 2),
    h: round(Math.max(24, box.h - by * 2), 2),
  };
}

function centre(size: Box, box: Box): Box {
  const w = Math.min(size.w, box.w);
  const h = Math.min(size.h, box.h);
  return {
    x: round(box.x + (box.w - w) / 2, 2),
    y: round(box.y + (box.h - h) / 2, 2),
    w: round(w, 2),
    h: round(h, 2),
  };
}
