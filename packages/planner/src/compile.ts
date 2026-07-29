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
  Asset,
  DiagramElement,
  Element,
  Lesson,
  LessonStep,
  Scene,
  Storyboard,
  TextElement,
  VisualIntent,
} from '@inkcast/core';
import { lessonBeats, logger, parseStoryboard, report } from '@inkcast/core';
import { deriveCues, preferredCue } from './cues.js';
import { round } from './curves.js';
import type { Box } from './elements.js';
import { makeAsset, makeDiagram, makeText } from './elements.js';
import {
  blobPath,
  bowlPath,
  chevronPath,
  fogPaths,
  hillPath,
  hillPoint,
  walkerPaths,
} from './figures.js';
import { matchIcons } from './icons.js';
import type { BeatRole } from './regions.js';
import { planBoard } from './regions.js';
import { buildPlot, plotHints, trim } from './plots.js';
import { adaptLesson, resolvePreset } from './presets.js';
import type { Preset } from './presets.js';
import { shorten, stripMarkdown, wordCount } from './text.js';
import type { CompileOptions } from './types.js';

const log = logger('planner:compile');

/** Bump when compiled output changes in a way that should invalidate caches. */
export const COMPILER_VERSION = 1;

/* ------------------------------------------------------------------ assets */

type Registry = { use(slug: string, prompt: string, kind: Asset['kind']): string; list(): Asset[] };

function registry(): Registry {
  const map = new Map<string, Asset>();
  return {
    use(slug, prompt, kind) {
      const existing = map.get(slug);
      if (existing) return existing.id;
      map.set(slug, {
        id: slug,
        kind,
        prompt,
        seed: seedOf(slug),
        source: kind === 'icon' ? 'builtin' : 'generated',
      });
      return slug;
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
  const reuse = findReuse(beats);
  if (reuse.bridge) {
    log.info(
      `beat ${reuse.bridge.beat} turns beat ${reuse.bridge.host}'s drawing into a plot — morphing in place`,
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

  // Who divides each shared cell's text zone, in beat order. The host is first,
  // because it is the beat that draws the picture the others are talking about.
  const sharers = new Map<number, number[]>();
  for (const [beat, host] of reuse.annotates) {
    const group = sharers.get(host) ?? [host];
    group.push(beat);
    sharers.set(host, group);
  }
  const bands = new Map<number, { bands: number; band: number }>();
  for (const group of sharers.values()) {
    const ordered = [...group].sort((a, b) => a - b);
    ordered.forEach((beat, k) => bands.set(beat, { bands: ordered.length, band: k }));
  }

  const assets = registry();
  const memory: BoardMemory = {};

  const scenes: Scene[] = beats.map(({ step, role }, i) => {
    const cell = inset(board.cellOf(i), 10);
    const share = bands.get(i);
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
    });
    const scene: Scene = {
      id: `s${i}`,
      narration: step.narration.trim(),
      camera: board.cameraFor(i, role),
      elements: built,
      region: board.regionOf(i).key,
      role,
      hold: holdFor(step, role, preset),
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
      // Long enough that the final board is still on screen after the last word.
      outroSec: preset.vertical ? 1 : 1.6,
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

/* --------------------------------------------------- the abstraction's arrival */

/**
 * The beat that claims the concrete thing *is* the abstract one.
 *
 * "The hillside is a graph of how wrong you are." "Plot every setting against its
 * number and the hillside becomes a curve." This is the sentence on which the whole
 * lesson turns, and the brief is explicit that it has to be *shown*: the anchor
 * morphing into the plot, in place, rather than a second picture appearing elsewhere
 * while the narrator asserts they are the same thing.
 *
 * Matched as a becoming-verb followed by the vocabulary of a plot, in one clause, so
 * an ordinary mention of a curve somewhere else in the lesson does not qualify.
 */
const BECOMES_A_PLOT =
  /\b(?:is|are|becomes?|become|turns? into|turn into|is really|really is|same as|is just)\b[^.!?]{0,60}?\b(?:graph|curve|plot|axes|axis|function)\b/i;

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
 * Deliberately conservative. At most one bridge per lesson; it must be a `step` that
 * actually asks for a `plot`, it must say the concrete thing *is* the abstract one,
 * and there must be a drawing before it to grow out of. Anything less certain draws
 * normally, which is what every lesson did before this existed.
 */
export type BoardReuse = {
  /** `beat -> host beat` for every beat that draws onto an earlier drawing. */
  annotates: Map<number, number>;
  /** The beat whose plot replaces the host's drawing, and that host. */
  bridge: { beat: number; host: number } | null;
};

export function findReuse(beats: { step: LessonStep; role: BeatRole }[]): BoardReuse {
  const annotates = new Map<number, number>();
  /** The beat that owns the setup's drawing — the first one to make it, not the last. */
  let owner: number | null = null;
  let bridge: { beat: number; host: number } | null = null;

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
    if (bridge || role !== 'step' || owner === null) continue;
    if (!step.visuals.some((v) => v.kind === 'plot')) continue;
    if (!BECOMES_A_PLOT.test(`${step.idea} ${step.narration}`)) continue;
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
function holdFor(step: LessonStep, role: BeatRole, preset: Preset): number {
  const asks = /[?]\s*$/.test(step.narration.trim());
  const base = step.hold + preset.holdBonus;
  // A question the learner is meant to attempt needs real silence, not a beat.
  const bonus = asks ? 1 : role === 'misconception' ? 0.4 : 0;
  return round(Math.min(3, base + bonus), 2);
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

  /* --- the caption that names this cell --- */
  const captionText = captionFor(step, role, preset);
  const caption = makeText(eid('idea'), captionText, preset.captionRole, {
    maxWidth: cell.w,
    align: 'center',
  });

  /* --- text notes: the model's own text intents, plus worked arithmetic --- */
  const { notes, figures } = partition(step);
  const noteEls: TextElement[] = notes.map((intent, k) => {
    const el = makeText(
      eid(`note${k}`),
      noteText(intent.describe),
      preset.vertical ? 'heading' : 'body',
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
      makeText(eid('sum'), sum, preset.vertical ? 'heading' : 'heading', {
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
  const texts: TextElement[] = [caption, ...noteEls];
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

  /* --- the figure area: the rest of the cell, and never less than half of it --- */
  // The text budget above caps words at 40% of the cell, so this is always the
  // larger share. Clamping to the cell rather than taking a minimum height is
  // what keeps every element provably inside its own cell, and therefore inside
  // its region: an element that overflowed downwards would collide with the beat
  // below it, which is the one thing region sharing must never do.
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
    h: round(Math.max(60, cell.y + cell.h - figureTop), 2),
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

  for (const el of elements) {
    const wantedCue = cueOf.get(el.id);
    if (wantedCue) el.enter = { ...el.enter, cue: wantedCue };
  }
  return elements;
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
  const sign = slope < 0 ? '+' : '−';
  return `w ← ${trim(start)} ${sign} ${trim(lr)} × ${trim(Math.abs(slope))} = ${trim(next)}`;
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
  switch (intent.kind) {
    case 'plot': {
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
      return buildAsset(describe, intent.kind, ctx);
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

function buildAsset(
  describe: string,
  kind: 'icon' | 'illustration',
  ctx: IntentContext,
): Element[] {
  const match = matchIcons(describe, 1)[0];
  const size = Math.min(ctx.box.w, ctx.box.h) * 0.82;
  if (match) {
    const assetId = ctx.assets.use(match.slug, match.prompt, 'icon');
    const el = makeAsset(ctx.id, assetId, size);
    el.at = centre(el.at, ctx.box);
    el.enter = { ...el.enter, at: 0.08 };
    return [el];
  }
  if (kind === 'illustration') {
    // No key means no text-to-image, and the visuals stage says so loudly. The
    // prompt is still recorded, so the same project renders properly the moment
    // a provider is configured — nothing here is a placeholder.
    const slug = slugOf(describe);
    const assetId = ctx.assets.use(
      slug,
      `${stripMarkdown(describe)}, hand-drawn line art, marker on whiteboard`,
      'illustration',
    );
    const el = makeAsset(ctx.id, assetId, size);
    el.at = centre(el.at, ctx.box);
    el.enter = { ...el.enter, at: 0.08 };
    log.debug(
      `illustration "${slug}" needs an image provider; it degrades to a placeholder without one`,
    );
    return [el];
  }
  return buildFreeform(describe, ctx);
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
