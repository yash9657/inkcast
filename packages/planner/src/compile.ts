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
  AssetElement,
  BoardMode,
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
  cueWordIndex,
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
import { boxAt, buildDrawing, fitCanvas } from './drawing.js';
import { readInkBox, underlayAsset } from './underlay.js';
import { round } from './curves.js';
import type { Box } from './elements.js';
import {
  FONT,
  makeAsset,
  makeCode,
  makeDiagram,
  makeEmphasis,
  makeEquation,
  makeText,
  setPlannerHand,
} from './elements.js';
import {
  blobPath,
  bowlPath,
  chevronPath,
  fogPaths,
  hillPath,
  hillPoint,
  makePath,
  walkerPaths,
} from './figures.js';
import type { BeatRole, Board } from './regions.js';
import { planBoard } from './regions.js';
import type { Recall, Referral } from './refer.js';
import { findReferrals, nameOf, referTo, sameName, subjectOf } from './refer.js';
import { buildPlot, describesAPlot, plotHints, recipeChosen, trim } from './plots.js';
import { adaptLesson, resolvePreset } from './presets.js';
import type { Preset } from './presets.js';
import { shorten, stripMarkdown, wordCount } from './text.js';
import type { CompileOptions } from './types.js';

const log = logger('planner:compile');

/**
 * Bump when compiled output changes in a way that should invalidate caches.
 *
 * 2: labels are placed and measured at the footprint the board really writes them in
 * (`draw-geom.ts`'s `labelFootprint`), so every cached storyboard with a drawing beat in
 * it has its names in the old, wrong places — including the `cardiac8` frame that reads
 * "atria (spark spreadsspark starts here". `cast.ts`'s `boardKey` is the only thing that
 * reaches those caches, and this constant is the only part of it the planner controls;
 * without this the repair is real and no existing project ever sees it.
 *
 * 3: a subject drawn once is referred to afterwards rather than drawn again (`./refer.ts`).
 * A beat whose picture is an earlier beat's picture takes that beat's cell and points at
 * the picture already there instead of minting a second one, and a recap that would
 * re-label the board circles the names where they already are. Every board with two
 * pictures of one subject in it therefore has a different number of cells, a smaller
 * canvas and one fewer generated image — `cardiac8f` goes from 10 cells and 4 generated
 * pictures to 8 and 2 — and no cached storyboard would show any of it without this.
 *
 * 4: every cue leaves with the index of the word it starts on (`enter.cueWord`, plan item
 * 4.1). A cached board has to be recompiled to gain the indices, and without this bump the
 * voice stage would spend a release reporting the phrase-search fallback on every project
 * on disk while the fix sat here in the compiler.
 *
 * 5: version 3 above shipped the *decision* half of `./refer.js` and none of the build
 * half. `buildBeat` never read `recalls` or `refers` — `BeatContext` did not declare
 * either, and TypeScript is silent about an excess property that arrives by spread — so a
 * recap that had been given an earlier beat's cell built its picture into that cell
 * anyway, on top of the picture already there. `projects/deb81002b073` is what that looks
 * like from the gate: six ink-on-ink overlaps and a label shrunk to 9.8px, in a recap
 * whose whole point was to draw nothing. A recall recap now emits one emphasis circle per
 * recalled name, around the element that already carries it, and a picture-referring beat
 * keeps its own cell until the drawing lane can compose its added marks over the host's
 * picture. Every cached storyboard whose recap triggered recall has the overlap baked in
 * and only a recompile removes it.
 *
 * 6: the trimmer stopped cutting the payload (plan 5.1). A misconception derived from the
 * worked example is now the *last* droppable beat rather than the first, so a lesson that
 * overruns loses a step it can spare instead of the correction to the error it just made.
 * The bump is needed because `adaptLesson` runs inside `compileLesson`: a cached
 * storyboard for an over-budget lesson has the wrong beat already deleted, and no later
 * stage can put it back. Boards that were never trimmed, and boards whose misconception
 * cites steps rather than `worked`, compile byte-identically — which is why the six pinned
 * hashes below do not move for this one.
 *
 * The constant is a cache key and nothing else — it is never written into the storyboard —
 * so bumping it may not itself move a pinned hash. What moves a hash is the change the
 * bump exists to ship, and version 4 is the first that did:
 * `npx tsx packages/pipeline/src/sbhash.mts gradient-descent longitude` reads
 * d3f35564b27b / e3a1f7338b26 / 417495edcde8 / 01b682decdbd.
 *
 * A third lesson joined the pins on 2026-08-24 rather than moving them:
 * `sbhash.mts hash-map` reads 6534c50131fa / 66cb5a33474b. Its `short` pin was re-pinned
 * later the same day from 5a5362c4fd0a, alone among the six, when `lessonSeconds` began
 * counting spoken letters instead of words (`DELIVERED_LPS` in `presets.ts`): hash-map is
 * the shortest-worded lesson we ship, the old estimate over-charged it by 8%, and the
 * vertical preset had been dropping its collision beat to fit a budget it was not really
 * over. It is the corpus's only film
 * with a listing on the board, so it is the only one whose bytes move if `codeBox`'s
 * reservation or `FONT.label` does (plan item 6.2). The four above did not move for it and
 * could not have — the code lane adds a member to the element union and a ninth
 * `VisualIntent.kind`, and neither shipped lesson uses either.
 *
 * All four were re-pinned 2026-08-24 (from e1212df828d0 / 6b03be35c3c6 / a8c3f262502a /
 * f03df5431b68) for the cue indices of version 4 above: a purely additive diff, 30/23/47/38
 * added `"cueWord"` lines and no other changed line in any of the four boards. All four
 * were re-pinned 2026-08-23 (from 2a014f1e2eae / 0670ab50fe80 / a750d3d78b5e /
 * e6e5e7d6e6b2) when the recap chain became a column instead of a row — see `recapChain`
 * below for the measurement, and `test/pinned-hashes.test.ts` for the frames. Earlier the
 * same day all four moved (from b6ed04d68aaa / 4aa467530110 / a9b5b8960ed0 /
 * 882002cbf24c) when the planner's text metrics moved from the chars × 0.52 estimate to
 * the real advance table (plan item 2.1) — every reserved box tightened a few percent
 * and two headings re-wrapped honestly. Before that, longitude/short was `c0f2ccc5024c`
 * until 2026-08-22, when `text.ts`'s `DANGLING` list learned the word `between` and
 * shortened exactly one caption. The reasoning and the frame evidence for every re-pin
 * are in `test/pinned-hashes.test.ts`, which asserts this comment and that list agree.
 */
export const COMPILER_VERSION = 6;

/* ------------------------------------------------------------------ assets */

type Registry = {
  use(slug: string, prompt: string, kind: Asset['kind']): string;
  /** A hybrid drawing's underlay: an illustration whose box is exact. See `buildUnderlay`. */
  underlay(id: string, prompt: string): string;
  /** A colour teaching figure: shown as a raster, never traced. See `Asset.kind`. */
  figure(id: string, prompt: string): string;
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

    underlay(id, prompt) {
      return mint(id, {
        id,
        kind: 'illustration',
        prompt,
        seed: seedOf(id),
        source: 'generated',
        // The marks on top of this were aimed at a picture measured into one exact box.
        // Four percent of the visuals stage's usual breathing room is enough to take a
        // leader arrow off the structure it names. See `Asset.fit`.
        fit: 'exact',
      });
    },

    figure(id, prompt) {
      return mint(id, {
        id,
        kind: 'figure',
        prompt,
        seed: seedOf(id),
        source: 'generated',
        // No `fit: 'exact'` here, and that is the difference. An underlay's box was
        // measured from a trace of its own ink so that marks could be aimed into it; a
        // figure carries its own mechanism, is never traced, and simply takes the space
        // it is given. `figureRaster` centres the raster's real aspect inside that box.
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

/**
 * The seed an asset id locks its artwork to.
 *
 * Exported because the hybrid lane's seam has to generate an underlay under the same seed
 * the registry will mint for it — otherwise a project whose raster cache has been cleared
 * regenerates a *different* picture, and the marks in `lesson.json` are left annotating one
 * nobody can see any more.
 */
export function assetSeed(s: string): number {
  return seedOf(s);
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
 *
 * `board` is taken here rather than on `FormatOptions` because this is the only
 * function that can honour it: the document planners compose their own boards and
 * would silently ignore it, and offering a lane that is not there is the failure
 * this repo keeps paying for.
 */
export function compileLesson(
  lesson: Lesson,
  opts: CompileOptions & { board?: BoardMode } = {},
): Storyboard {
  // Every measurement below reserves with the face this board will letter with.
  setPlannerHand(opts.style ?? 'marker');
  const preset = resolvePreset(opts);
  // `opts` carries `onProblem`, so a beat the budget deletes reaches `qc.json` instead of
  // a debug line (plan 5.3; audit S1-c). The compiler is the only caller that knows both
  // the lesson and the preset, which is why the reporting seam is here.
  const shaped = adaptLesson(lesson, preset, opts);
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
  // Which beats point back at a drawing this lesson already has, instead of drawing it a
  // second time. A separate decision from `findReuse` above, and deliberately so: that one
  // asks where the *abstraction* arrives and reads the analogy to answer it, which is the
  // decision the two pinned lessons are hashed on. This one asks whether a *subject* is
  // being drawn twice and reads the pictures the beats ask for. Neither shipped lesson asks
  // for a generated picture at all, so nothing here can reach them.
  const referrals = findReferrals(beats, preset.board);
  for (const [beat, r] of referrals.pictures) {
    log.info(
      `beat ${beat} draws the same subject beat ${r.host} drew, in a cell of its own`,
      `both ask for "${r.subject.split('/')[1]}" in the same box. The cell is deliberately ` +
        `not shared: sharing it would have this beat redraw its whole picture on top of ` +
        `the host's, because reusing the host's picture and drawing only what this beat ` +
        `adds is the drawing lane's work and is not built yet — see \`BeatContext.refers\`. ` +
        `Only two beats asking in the *same words* share one generated image; the registry ` +
        `keys on the prompt, not on the subject`,
    );
  }
  if (referrals.recall) {
    log.info(
      `the recap re-reads the board instead of redrawing it in a panel of its own`,
      `${referrals.recall.names.length} of the names it would have written are already on ` +
        `the board (${referrals.recall.names.join(', ')}) — it circles them where they are`,
    );
  }

  // Every beat that builds on an earlier drawing shares that drawing's cell — words
  // included. A caption in a cell of its own, describing a picture in a different
  // cell, is what pulled the camera wide over an almost-empty panel.
  //
  // `referrals.pictures` is deliberately **not** in here. Putting a picture-referring beat
  // in its host's cell is only half of referring: the other half is that it then draws
  // only what it adds, and `buildBeat` has no way to do that — it would build its whole
  // picture again, in the host's cell, on top of the host's. That is ink on ink, and the
  // strict gate is right to refuse it. Until the drawing lane can compose a beat's added
  // marks over an existing picture, such a beat draws in its own cell exactly as it did
  // before `refer.ts` landed. The saving that never depended on the cell is untouched:
  // `registry.mint` keys on the prompt, so two beats asking in the same words still share
  // one image. Two beats asking for the same *subject* in different words are two images
  // and always were — that gap is what `subjectOf` exists to name, and closing it is the
  // same drawing-lane work.
  const shares = new Map<number, number>(reuse.annotates);
  if (referrals.recall) shares.set(referrals.recall.beat, referrals.recall.host);
  const board = referTo(
    planBoard(
      beats.map((b) => b.role),
      {
        aspect: preset.aspect,
        maxPerRegion: preset.maxPerRegion,
        sharesCellWith: shares,
        board: preset.board,
      },
    ),
    shares,
  );

  // Which beats draw into each cell, in beat order. The host is first, because it is
  // the beat that draws the picture the others are talking about — and a cell nobody
  // shares is a group of one, which is why both of the divisions below can be read off
  // this single map.
  const cells = new Map<number, number[]>();
  beats.forEach((_, i) => {
    const host = shares.get(i) ?? i;
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
  // Only the anchor. An interrupted edit initialised `pictures` and `names` here as well,
  // meaning them to carry a subject -> asset and a name -> element index forward so that a
  // referring beat could reuse the host's picture; both were written and never read, and
  // `BoardMemory` never declared them, which is the TS2353 this file shipped with. They are
  // gone rather than added to the type, because the identity they were going to track is
  // already tracked, one layer down and unconditionally: `registry().mint` keys on the
  // content-derived slug (`slugOf(describe)`, `underlayAsset(prompt)`), never on the beat,
  // so two beats asking for the same subject resolve to one `Asset` and the generator is
  // paid once — which is exactly the guarantee `findReferrals`' header claims for `wipe`
  // mode, where there is no shared cell to lean on. `referTo` above supplies the other
  // half, the shared cell. Adding two members nothing consults would have been the
  // written-and-never-read pattern this repo has now paid for three times (sketch.ts's
  // brand mark, the visuals stage's unread roughjs SVGs, defect 9). `written` below is
  // the one member that earns its place: it is filled after each beat builds and read
  // by the recall recap in the same pass, and without it the recap has names but no
  // elements to circle.
  const memory: BoardMemory = { written: [] };

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
      ...(referrals.pictures.get(i) ? { refers: referrals.pictures.get(i) } : {}),
      ...(referrals.recall?.beat === i ? { recalls: referrals.recall } : {}),
      cellBands: share?.bands ?? 1,
      cellBand: share?.band ?? 0,
      terms: vocab[i] ?? [],
      termRows: strip?.rows ?? 0,
      termRow: strip?.row ?? 0,
    });
    // What this beat just wrote down, for a later beat to point at. Recorded here rather
    // than inside `buildBeat` so that the beat doing the pointing cannot find its own
    // labels: by the time the recap builds, this holds every earlier beat's names and
    // none of its own. Only persistent text — a label that leaves the board with the card
    // that drew it is not there to be circled.
    for (const el of built) {
      if (el.type !== 'text' || el.persist === false) continue;
      const name = nameOf(el.text);
      if (name.length >= 3) memory.written?.push({ id: el.id, name });
    }
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
    assignTiming(scene, built, {
      ...(preset.maxGestures ? { maxGestures: preset.maxGestures } : {}),
    });
    return scene;
  });

  // One card at a time, and the ink goes out with the narration that earned it.
  if (preset.board === 'wipe') applyBoardMode(scenes, cells);

  // A pan inside one region is a nudge; a pan to a new region is a move; the
  // recap's pull-back is the slowest shot in the video because it is the one the
  // learner is meant to read the whole board from.
  //
  // Under `wipe` the recap has no board behind it — it draws a card like every
  // other beat — so it takes the ordinary pan instead of spending 1.3s crossfading
  // between two shots of the same empty cell. (`camera.ts` raises a recap to at
  // least 1.1s for the same reason and is gated the same way.)
  const slowRecap = preset.board !== 'wipe';
  scenes.forEach((scene, i) => {
    const prev = scenes[i - 1];
    scene.camera.transition =
      i === 0
        ? 0
        : scene.role === 'recap' && slowRecap
          ? 1.3
          : prev?.region === scene.region
            ? 0.45
            : 0.95;
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
      // A conditional spread rather than a field, because absent *is* `accumulate`
      // everywhere that reads it: at the default this adds no key and moves no byte
      // of `JSON.stringify(sb)`, which is what the pinned lessons are hashed on.
      ...(preset.board === 'wipe' ? { board: 'wipe' as const } : {}),
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

/* ------------------------------------------------------------- the wiped board */

/**
 * Mark a compiled board's ink non-persistent — in one pass, here, and nowhere else.
 *
 * Not in `elements.ts`: `persist: o.persist ?? true` on the element factories is
 * shared with the heuristic planner (whose tests assert annotated elements persist),
 * with `figures.ts`, `plots.ts` and the two offline sheets, none of which knows a
 * preset exists. Changing the default would wipe boards nobody asked to wipe.
 *
 * The hard part is not the flag, it is what a card *is*. Several beats can draw one
 * card — the anchor walking down the hook's hillside, the bridge beat growing a plot
 * out of it — and `morph.fromId` reshapes ink drawn two scenes earlier. Fading every
 * element at its own scene's end passes every existing test and produces a morph out
 * of nothing: the runtime dutifully bends a shape whose alpha is already zero.
 * `gradient-descent` at the standard preset has exactly that chain. So an element
 * stays up until the last scene that still needs it, named explicitly by
 * `persistUntil`, and the last scene that needs it is the later of:
 *
 * - the last beat that shares its cell (`cells`, the host → sharers map), because
 *   they are all drawing one picture; and
 * - the last beat that *points* at it — an `emphasis.targetId`, a `morph.fromId`,
 *   or an id in `morph.retires`.
 *
 * The last card of the film is the exception and keeps `persist: true`. A wipe makes
 * room for the next card; there is no next card, so wiping it spends the closing hold
 * and the whole `outroSec` on an empty board. Caught by rendering it: the recap frame
 * at 105.0s of a 107.3s wipe of `gradient-descent` was a summary at a third of its
 * alpha, mid-fade, with nothing to follow it.
 *
 * Exported for its own test, as `findReuse` above is, and for the same kind of reason:
 * the case that broke here — ink a *later* card points back at — cannot be built
 * through `compileLesson` at all today, because the only beat that points backwards is
 * the bridge and `findReuse` will only make a `step` the bridge, never the recap. A
 * defect no lesson can reach is one no test of the compiler can reach either.
 */
export function applyBoardMode(scenes: Scene[], cells: ReadonlyMap<number, number[]>): void {
  /** Last scene index that names an element, for elements named by another. */
  const pointedAt = new Map<string, number>();
  const needs = (id: string | undefined, i: number): void => {
    if (!id) return;
    pointedAt.set(id, Math.max(pointedAt.get(id) ?? -1, i));
  };
  scenes.forEach((scene, i) => {
    for (const el of scene.elements) {
      if (el.type === 'emphasis') needs(el.targetId, i);
      if (el.morph) {
        needs(el.morph.fromId, i);
        for (const id of el.morph.retires ?? []) needs(id, i);
      }
    }
  });

  /** Last beat of the cell each beat draws into — a cell nobody shares is a group of one. */
  const cellEnds = new Map<number, number>();
  for (const group of cells.values()) {
    const last = group[group.length - 1] ?? 0;
    for (const beat of group) cellEnds.set(beat, last);
  }

  const last = scenes.length - 1;
  scenes.forEach((scene, i) => {
    for (const el of scene.elements) {
      const until = Math.max(i, cellEnds.get(i) ?? i, pointedAt.get(el.id) ?? i);
      // The closing card stays: there is nothing to make room for. Which card this is,
      // not how far its keep-set reaches — `until >= last` said the same thing for the
      // last beat and something else entirely for every other one, keeping *any* ink a
      // later card names up for the rest of the film. A recap whose `emphasis.targetId`
      // or `morph.fromId` cites beat 2 would pin beat 2's drawing across every card
      // between them, and hand it to core's framing history with `until: Infinity` —
      // the stale accumulation and the widening frame this mode exists to remove.
      if (i === last) continue;
      el.persist = false;
      // Absent means "goes out with its own scene", which is what `persist: false`
      // has always meant — so the field only appears where it changes something.
      if (until > i) el.persistUntil = scenes[until]?.id;
    }
  });
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
  /**
   * Every name the board has written down, in write order: the element carrying it, and
   * the name normalised the way `refer.ts` compares names.
   *
   * Read by the recall recap and by nothing else. `findRecall` decides from the lesson's
   * *marks* that the recap is re-writing names the board already carries; this is the
   * other half of that sentence — which element on the board is carrying each one — and
   * it can only be known after the beats are built, because the id belongs to the built
   * element. Recorded after each beat returns, so the recap never finds itself.
   */
  written?: Array<{ id: string; name: string }>;
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

/**
 * The weight a beat's own name is written at.
 *
 * Two steps heavier than the caption it replaces, and clamped to `heading` rather than
 * `title`: with the camera now holding one cell to the frame, a `title` set across the
 * width of a card is enormous, and the words are meant to name the picture rather than
 * to be the picture. `weightUp` still applies on top for a beat carrying emphasis, which
 * is the one case that reaches `title`.
 */
function titleRole(preset: Preset, stressed: boolean): TextElement['role'] {
  const i = TEXT_WEIGHT.indexOf(preset.captionRole);
  const base = TEXT_WEIGHT[Math.max(1, i - 2)] ?? 'heading';
  return weightUp(base, stressed);
}

/**
 * The flourish under a title, as one hand-drawn stroke.
 *
 * A rule rather than a box or a border: it is drawn by the same pen, in the same pass,
 * and the renderer's roughening makes it a line someone pulled under the words. It is
 * what turns a line of text into a heading you have been *shown*, and it is the second
 * half of the pattern every competing scene opens with — write the name, underline it,
 * then draw.
 *
 * Sized to the words and not to the cell: a rule the full width of a card under three
 * short words reads as a divider across the board rather than as an underline.
 */
// Only the box is read, so a caption the math sniffer promoted to an equation
// still gets its underline.
function titleRule(id: string, title: Pick<TextElement, 'at'>): Element {
  const w = Math.min(title.at.w, Math.max(120, title.at.w * 0.82));
  const cx = title.at.x + title.at.w / 2;
  const y = round(title.at.y + title.at.h + 10, 2);
  const el = makePath(
    id,
    [
      { x: round(cx - w / 2, 2), y },
      { x: round(cx + w / 2, 2), y },
    ],
    { weight: 0.9 },
  );
  el.tone = 'accent';
  return el;
}

function holdFor(
  step: LessonStep,
  role: BeatRole,
  preset: Preset,
): { cadence: Cadence; hold: number } {
  const asks = /[?]\s*$/.test(step.narration.trim());
  const bonus = preset.holdBonus + (asks ? 1 : role === 'misconception' ? 0.4 : 0);
  const paced = holdForCadence(step, role, bonus);
  /*
   * The other half of `Preset.maxHold`, which that field's own comment has been
   * asking for by name.
   *
   * `trimStep` caps what the *author* asks for, which makes the ceiling binding on
   * the length estimate and on nothing else: `holdForCadence` then takes
   * `max(CADENCE[c].hold, step.hold)` and adds `bonus`, so a `slow_deliberate` beat
   * floored at 0.9s and a beat ending in a question adding its full second both
   * walked straight past a 0.8s ceiling. A 75-second film cannot afford a
   * three-second pause and a two-and-a-half-minute one can — that is the whole
   * reason the number is a property of the format — and a cap applied to the
   * estimate but not to the film is a cap that only makes the estimate wrong.
   *
   * A preset with no ceiling is unchanged, byte for byte: `standard` has none, and
   * the two shipped lessons pin compiles against it.
   */
  const hold = Math.min(paced.hold, preset.maxHold ?? Infinity);
  return { cadence: paced.cadence, hold: round(hold, 2) };
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
  /**
   * This recap re-reads the board instead of drawing its picture again: it circles the
   * names where the earlier beats wrote them. See `findRecall` in `./refer.ts`.
   */
  recalls?: Recall;
  /**
   * This beat's picture is an earlier beat's picture. **Decided but not consumed** — the
   * build half needs the drawing lane to compose only this beat's *added* marks over the
   * host's picture, which does not exist yet. Until it does, `compileLesson` deliberately
   * keeps such a beat in its own cell (see the referral log there), so nothing reads this.
   */
  refers?: Referral;
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

  /* --- the title that names this card --- */
  //
  // A beat announces itself before it draws anything. This was a small caption in the
  // same weight as a note, and the film opened straight into ink with nothing telling a
  // viewer what they were about to look at — the loudest complaint about the first
  // watchable render, and the one thing every Golpo scene does that we did not do at all
  // (`docs/research/golpo-video-craft.md`: the title is written first, then underlined,
  // then the content is drawn beneath it).
  //
  // So it is a heading rather than a label, it is written at `at: 0` before any part of
  // the picture, and `titleRule` below draws the flourish under it. The preset still owns
  // how many words it may have; what changed is its weight, its order and its rule.
  const captionText = captionFor(step, role, preset);
  const caption = makeText(eid('idea'), captionText, titleRole(preset, carries(captionText)), {
    maxWidth: cell.w,
    align: 'center',
  });

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
  // A composed drawing labels its own parts, so the words above it are doing less work
  // and can have less of the cell. This is where the frame fill of a drawn board comes
  // from: the figure box was two and a half times wider than it was tall, so a picture
  // fitted into it by height left a third of the cell blank on either side.
  const drawn = step.visuals.some((v) => v.marks?.length);
  const share = ctx.preset.vertical ? (drawn ? 0.28 : 0.34) : drawn ? 0.26 : 0.4;
  const zone = cell.h * share;
  const budget = Math.min(wanted, zone / bands);
  const scale = wanted > budget ? budget / wanted : 1;
  let y = cell.y + (zone / bands) * Math.min(ctx.cellBand, bands - 1);
  texts.forEach((t, k) => {
    const h = round(t.at.h * scale, 2);
    t.at = { x: round(cell.x + (cell.w - t.at.w) / 2, 2), y: round(y, 2), w: t.at.w, h };
    y += h + 16 * scale;
    // The title names the card before anything is drawn under it, so it is pinned to the
    // very start of the beat and given no cue — a cue would resolve it to whatever phrase
    // it happened to match and put the name of the beat halfway through the beat. A note
    // is a line the narrator reaches later, so it is written when they get there.
    if (k === 0) t.enter = { ...t.enter, at: 0, style: 'write' };
    else t.enter = { ...t.enter, at: round(Math.min(0.8, 0.34 + (k - 1) * 0.12), 3) };
    elements.push(t);
  });
  // Underlined the moment the words are finished, before the picture starts — but not
  // pushed yet. `buildIntent` is handed `elements` as the ink already on the board, and
  // the lanes read it: a `motion` intent with nothing of its own looks there for
  // something to travel along, and a rule is a `path`, so the mover rode the underline
  // and the beat drew no scene at all. Furniture is not content, and the figure lanes
  // must not be able to see it. Pushed below, once they have all run.
  const rule = titleRule(eid('rule'), caption);
  rule.enter = { ...rule.enter, at: 0.05, duration: 0.35 };
  y += 14 * scale;

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

  // A recall recap draws no picture at all: `findRecall` established that its marks
  // re-label parts the board is already carrying, and it has been given the cell of the
  // beat that carries most of them. Building its figures here would put a second picture
  // on top of the host's — six overlaps and one 9.8px label, in the render that made this
  // branch necessary. What it does instead is below: one circle per recalled name, around
  // the element that already holds it, under the recap's own pull-back over the board.
  if (!ctx.recalls) {
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
        cues: cueOf,
      });
      for (const el of made) {
        if (el.type === 'plot') lastPlotId = el.id;
        elements.push(el);
      }
      // One picture, one moment. Every stroke of this intent that did not claim a word of
      // its own is drawn on the intent's cue, so the parts of a drawing arrive together as
      // a gesture instead of being scattered across the beat by a guess.
      //
      // This is the join the shipped render got wrong. The lesson asked for one picture —
      // "a hillside, a figure, thick fog" — on one cue, and the compiler exploded it into
      // nine strokes and invented a cue for each: the fog landed on a sentence about a
      // valley, two strokes landed in the silence between sentences, and the figure's legs
      // arrived on the word "down". The author's single cue was thrown away.
      if (intent.cue) {
        for (const el of made) if (!cueOf.has(el.id)) cueOf.set(el.id, intent.cue);
      }
    });
  }

  /* --- the recall recap: circle the names, where the board already wrote them --- */
  //
  // One circle per repeated name, in the recap's own order, so the summary is delivered
  // as a tour of the board rather than as a fresh panel. `makeEmphasis`'s placeholder box
  // is left as it is: both stages that need the ring's geometry take it from the target
  // instead — the visuals stage draws around `targetBox` (`visuals/src/resolve.ts`) and
  // `elementBounds` measures the target (`core/src/camera.ts`) — so the ring is wherever
  // the ink it circles is.
  //
  // Transient by default, and rightly: the ring is an annotation on someone else's ink,
  // and the thing it circled stays. `needs(el.targetId, i)` below keeps each target alive
  // to the moment it is circled.
  if (ctx.recalls) {
    /** Elements already circled, so three names do not all ring the same label. */
    const circled = new Set<string>();
    ctx.recalls.names.forEach((name, k) => {
      // Whole-token containment means one label can answer to two names: this lesson's
      // "more stuff, more inertia" is matched by both `more stuff` and `more inertia`,
      // and circling it twice would show the learner two of the three places they were
      // promised. So an element nobody has circled yet wins, and the first match is only
      // taken when the board really has written that name in one place.
      const written = ctx.memory.written ?? [];
      const hit =
        written.find((w) => sameName(w.name, name) && !circled.has(w.id)) ??
        written.find((w) => sameName(w.name, name));
      if (!hit) {
        // `findRecall` matched this name against an earlier beat's *marks*, and a mark
        // that writes a name becomes a text element, so the two passes disagreeing means
        // one of them changed. Loud, because the recap silently circling fewer parts than
        // it names is exactly the amnesia this whole feature exists to remove.
        log.warn(
          `beat ${index} recalls "${name}" but no element on the board carries it — ` +
            "no circle drawn (the lesson's marks and the built board have drifted)",
        );
        return;
      }
      const circle = makeEmphasis(eid(`recall${k}`), hit.id, 'circle', {
        enter: { at: Math.min(0.85, 0.2 + k * 0.12) },
      });
      // The name is a thing the narrator says, so the ring lands on it being said. It is
      // the *normalised* name, so a name that lost a word to normalisation ("law of
      // inertia" -> "law inertia") will not be found in the narration — and that is
      // handled where every authored cue is: `preferredCue` drops a cue the narration
      // does not carry and the ring takes its derived phrase instead, in the order the
      // `at` above puts it. A guess would be worse than the fallback.
      circle.enter = { ...circle.enter, cue: name };
      circled.add(hit.id);
      elements.push(circle);
    });
  }

  /* --- a recap with no visuals still gets the chain drawn --- */
  //
  // Under a wiping board this stops being a fallback and becomes the recap's whole
  // job: an accumulating recap can pull back over the board and let the board be the
  // summary, a wiped one has nothing behind it. It needs no widening to do that. Every
  // lane returns at least one element for every intent it is given — not because no
  // lane can come back empty (`buildDrawing` returns `[]` in nine places) but because
  // `buildIntent` guards the one that can: marks that draw nothing fall through
  // `if (drawn.length)` to the lane the intent's `kind` names. So "asked for no
  // picture" and "drew no picture" are the same beat, and a recap that did ask draws
  // that picture as its card. Both shipped lessons take this branch in both modes;
  // what changes under `wipe` is on the camera side, where there is no board to pull
  // back over.
  if (role === 'recap' && !figures.length && !ctx.recalls) {
    const chain = recapChain(ctx.lesson, eid('chain'), figureArea, ctx.preset);
    if (chain) elements.push(chain);
  }

  /* --- nothing to look at at all: draw the idea big rather than small --- */
  // Both fallbacks are unreachable for a recall recap by arithmetic — it has figures, and
  // it has just pushed a circle for each of them — but they are gated on it explicitly
  // rather than on that arithmetic, so a recall whose lesson carries no figures at all
  // cannot fall through into drawing the panel this branch exists to avoid.
  if (elements.length === 1 && !figures.length && !noteEls.length && !ctx.recalls) {
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
  // The title's rule joins them here for the same reason — every count of "did this beat
  // draw anything" above is a count of *content*, and furniture must not satisfy it.
  elements.push(rule, ...termEls);

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
  // Terms are vocabulary — the brief says "words, not numbers or whole phrases" — so
  // a term the math sniffer promotes to an equation is an authoring defect. It is
  // dropped loudly rather than carried: the row's whole mechanism (cued to the spoken
  // word, sized as a label) is text-shaped.
  const made = ctx.terms
    .map((term, k) =>
      makeText(eid(`term${k}`), term, TERM_ROLE, { maxWidth: cell.w, align: 'center' }),
    )
    .filter((el): el is TextElement => {
      if (el.type === 'text') return true;
      log.warn(
        `beat ${ctx.index} names a term that reads as mathematics — dropped from the ` +
          "vocabulary row; notation belongs in the beat's visual, not its terms",
      );
      return false;
    });
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

/**
 * The words that name a cell on the finished board.
 *
 * The author's own `title` first, because that is the only source that contains a
 * *name*. Everything below it is a sentence being cut down, and a sentence cut to a
 * word count promises nouns it never writes: "Falling is a tug of war between a
 * bigger pull and a bigger reluctance" at nine words came out as "Falling is a tug
 * of war between bigger pull", which frame-vision flagged on a shipped film. See
 * `LessonStep.title`.
 *
 * The fallback is still `shorten`, which now refuses to leave a correlative unpaired
 * (see `unpaired`) — that is the mechanical half of the same defect, and the half a
 * shortener can actually fix. The half it cannot is an `idea` that is *itself* an
 * unfinished sentence: "Air is what makes a feather lose" is seven words at a
 * nine-word budget, so nothing was cut at all and the board wrote it as it stood.
 * Only a title can fix that one.
 */
function captionFor(step: LessonStep, role: BeatRole, preset: Preset): string {
  const authored = stripMarkdown(step.title ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (authored) return authored;
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

/**
 * Claims an element's cue slot while asking for no cue at all.
 *
 * The blanket assignment tests `has`, and the application tests truthiness, so an empty
 * string means "this element has already been decided about, and the decision was a fixed
 * fraction of the beat". The only thing that wants it is the hybrid lane's generated
 * picture, which must be on the board before anything annotates it.
 */
const NO_CUE = '';

type IntentContext = BeatContext & {
  id: string;
  box: Box;
  /** A plot already built in this beat, for a `motion` intent to ride. */
  hostPlotId?: string;
  existing: Element[];
  /**
   * `element id -> the phrase it should be drawn on`, written by the builders.
   *
   * A builder knows something the compiler cannot recover afterwards: *why* a stroke
   * exists. `buildFreeform` draws fog because the instruction said "fog", so the fog
   * belongs on the word **fog** if the narration says it. Recording that here is what
   * replaced guessing a cue per element out of the narration's rarest words — which put
   * the fog of a foggy hillside on the phrase "Somewhere below there's a valley".
   */
  cues: Map<string, string>;
};

function buildIntent(intent: VisualIntent, ctx: IntentContext): Element[] {
  const describe = intent.describe || ctx.step.idea;
  // Naming a cast member settles what to draw, so it outranks `kind` — which
  // defaults to `plot` and would otherwise turn "draw Mara, walking" into a graph
  // for any author who wrote the character and left the kind alone.
  if (intent.character) return buildAsset(describe, 'illustration', ctx, intent.character);
  // Marks outrank every other lane, whatever `kind` says. An author who placed the
  // strokes has already answered the question every lane below is guessing at, and the
  // guess cannot beat the answer.
  if (intent.marks?.length) {
    // The picture these marks were composed on top of, if there is one. `inkBox` is
    // written by the drawing stage from a trace of the image it generated, so its
    // presence is also the evidence that a real image exists to place — an `underlay`
    // with no box is a prompt nothing was ever generated for.
    const ink = readInkBox(intent.underlay?.inkBox);
    const underlay =
      intent.underlay && ink
        ? {
            ink,
            prompt: intent.underlay.prompt,
            ...(intent.underlay.kind ? { kind: intent.underlay.kind } : {}),
          }
        : undefined;
    const drawn = buildDrawing(intent.marks, {
      id: ctx.id,
      box: ctx.box,
      narration: ctx.step.narration,
      ...(underlay ? { underlay: true } : {}),
    });
    if (drawn.length) {
      // A part that found its own words keeps them. Registering the cue here is what
      // stops the blanket assignment below from replacing it with the intent's single
      // cue — which is the right answer for a picture whose parts the narration never
      // names, and the wrong one for the thirty-mark cross-section it was measured on.
      for (const el of drawn) if (el.enter.cue) ctx.cues.set(el.id, el.enter.cue);
      if (!underlay) return drawn;
      const picture = buildUnderlay(underlay, ctx);
      // **The form is not cued, and has to be exempted to stay that way.** Every element
      // this intent makes that has not claimed a cue of its own is handed the intent's
      // blanket cue further down, and the voice stage then overwrites `at` with wherever
      // that phrase lands — which put the heart on the board at 0.150 of the beat instead
      // of 0.02, and on one measured beat at 0.87, after every mark that annotates it.
      // A leader arrow arriving before the thing it points at is the defect this element's
      // early `at` exists to prevent, so `NO_CUE` claims the slot and asks for nothing.
      ctx.cues.set(picture.id, NO_CUE);
      return [picture, ...drawn];
    }
    log.warn(
      `beat ${ctx.index} carries ${intent.marks.length} marks that draw nothing`,
      'falling back to the lane its kind names',
    );
  }
  // A listing outranks `kind` for the same reason marks do: it is the answer, not a
  // description of one. An author who pasted six lines of Python has settled what goes on
  // the board, and a fenced block in a `describe` is that same paste arriving by the other
  // door — which is how it comes in from an ingested document (`ingest.ts` keeps fences
  // intact), and how a model that was told about the lane but not about the field writes it.
  const listing = codeListing(intent);
  if (listing || intent.kind === 'code') return buildCode(listing, describe, ctx);
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
            'as the thing it describes instead. Say what is on each axis, or ask for a ' +
            'different kind.',
        );
        return buildFallback(describe, ctx);
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
    // A `draw` intent with no marks got as far as here because the drawing author was
    // not available — no key, or the call failed. The instruction is still a drawing
    // instruction, so it goes to whichever free lane can hold it.
    case 'draw':
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

/**
 * The entire vocabulary of the `path` lane, one regex per shape it can make.
 *
 * There are six, and there is no seventh: `figures.ts` holds a hillside, a bowl, a
 * container blob, a stick figure, fog and a chevron stride, so a `path` intent that
 * names none of them has asked for something this lane cannot draw. The regexes are
 * deliberately tighter than the ones they replace, because those were answering the
 * wrong question — see `drawsAsFreeform`.
 */
const PART = {
  hill: /\bhill(?:side|s)?\b|\bmountain(?:side|s)?\b|\bslopes?\b|\bterrain\b|\blandscape\b|\bdownhill\b|\buphill\b/i,
  bowl: /\bbowls?\b|\bbowl[- ]shaped\b|\bvalleys?\b|\bbasins?\b|\bu[- ]shaped?\b/i,
  container:
    /\bblobs?\b|\bcontainers?\b|\bcircled? around\b|\beverything inside\b|\bgrouped together\b/i,
  figure:
    /\bstick figures?\b|\bfigures?\b|\bpersons?\b|\bpeople\b|\bwalkers?\b|\bhikers?\b|\bstanding\b/i,
  fog: /\bfog\w*\b|\bmist\w*\b/i,
  steps: /\bsteps?\b|\bstrides?\b|\bfootsteps?\b|\bone step at a time\b/i,
} as const;

type FreeformParts = Record<keyof typeof PART, boolean>;

function freeformParts(describe: string): FreeformParts {
  return {
    hill: PART.hill.test(describe),
    bowl: PART.bowl.test(describe),
    container: PART.container.test(describe),
    figure: PART.figure.test(describe),
    fog: PART.fog.test(describe),
    steps: PART.steps.test(describe),
  };
}

/**
 * Whether the `path` lane can draw this instruction at all.
 *
 * The question this file kept failing to ask. `PART` answers *which* of six shapes an
 * instruction wants; it was also being read as *whether* freeform ink was the right
 * lane, which it cannot answer — every instruction that matched nothing fell through to
 * a hillside. So a battery lesson asking for "a left rectangular stack and a right
 * rectangular stack with a damp gap between them" got terrain, and so did a ship heading
 * for the rocks. Same shape as `worthPlotting` in `./plots.ts`, and the same fix.
 *
 * A base shape (hillside, bowl, blob) qualifies, and so does a figure or fog, which are
 * drawable on their own. `steps` alone does not: chevrons need a slope to walk down, and
 * "the three steps of glycolysis" is a process, not a hillside.
 */
export function drawsAsFreeform(describe: string): boolean {
  const p = freeformParts(describe);
  return p.hill || p.bowl || p.container || p.figure || p.fog;
}

/**
 * Freeform ink: the escape hatch that lets a lesson open with something concrete.
 *
 * Keyword-driven on purpose — a hillside, a walker, fog and three steps down are
 * the vocabulary an anchor actually needs, and each one is real geometry rather
 * than a placeholder rectangle. What it is *not* is a general drawing lane: an
 * instruction naming none of the six goes to `buildFallback` rather than being
 * approximated by terrain.
 *
 * Matched on the drawing instruction alone. Reading the beat's `idea` and narration too
 * is how a stick figure ended up in a lithium-ion misconception — the narration said
 * "you" — and how any beat that mentioned a hill in passing acquired one.
 */
function buildFreeform(describe: string, ctx: IntentContext): Element[] {
  if (!drawsAsFreeform(describe)) {
    log.warn(
      `beat ${ctx.index} asked for freeform ink: "${describe}"`,
      'the path lane draws six shapes — a hillside, a bowl, a container blob, a stick ' +
        'figure, fog, and steps down a slope — and nothing else, so this would come out as ' +
        'a hillside. Drawing it with a lane that can draw the thing itself instead.',
    );
    return buildFallback(describe, ctx);
  }
  const parts = freeformParts(describe);
  const box = ctx.box;
  const out: Element[] = [];

  const timed = (el: Element, at: number): Element => {
    el.enter = { ...el.enter, at: round(at, 3) };
    return el;
  };

  /**
   * Draw this part on the word that asked for it, when the narration says that word.
   *
   * The parts of a freeform drawing exist *because* of words in the instruction — fog
   * because it said fog, a figure because it said figure — so each part has a natural
   * moment, and it is the moment the narrator says the same thing. Anything with no such
   * word joins the intent's own cue, so it arrives with the drawing rather than at a
   * guessed point of its own.
   */
  const onWord = (el: Element, words: RegExp): Element => {
    const m = words.exec(ctx.step.narration);
    if (m?.[0]) ctx.cues.set(el.id, m[0]);
    return el;
  };

  if (parts.bowl && !parts.hill) {
    out.push(timed(bowlPath(ctx.id, inset(box, 12)), 0.08));
    return out;
  }
  if (parts.container && !parts.hill) {
    out.push(timed(blobPath(ctx.id, inset(box, 16), ctx.index + 1), 0.08));
    return out;
  }

  // A hillside, when the instruction asks for one — and when it asks for strides
  // without one, because a chevron walks *down* something and there has to be a slope
  // under it. A lone figure or lone bank of fog gets no terrain: inventing a hillside
  // under every freeform intent is the defect this lane is being cured of.
  //
  // If the setup already drew one, this beat annotates *that* hill rather than
  // drawing a second one beside it. Two hillsides side by side is the failure this
  // guards against: the anchor's job is to walk down the hill the hook established,
  // and a fresh drawing silently tells the learner it is a different hill.
  const remembered = ctx.memory.anchor;
  const annotate = ctx.annotatesEarlier && remembered !== undefined;
  const wantsHill = parts.hill || parts.steps;
  const hillBox: Box | undefined = annotate
    ? remembered.box
    : wantsHill
      ? { x: box.x + 8, y: box.y + box.h * 0.12, w: box.w - 16, h: box.h * 0.74 }
      : undefined;
  if (annotate) {
    log.debug(`beat ${ctx.index} annotates the hill drawn as "${remembered.id}"`);
  } else if (hillBox) {
    out.push(onWord(timed(hillPath(ctx.id, hillBox), 0.08), /\bhill\w*|\bslope\b|\bground\b/i));
    // Remembered for the beat that turns it into a plot, and for any later beat
    // that wants to stand another figure on the same slope.
    if (ctx.role === 'hook' || ctx.role === 'anchor') {
      ctx.memory.anchor = { id: ctx.id, box: hillBox, ink: [] };
    }
  }
  if (parts.fog) {
    fogPaths(`${ctx.id}_fog`, box, ctx.preset.vertical ? 2 : 3).forEach((el, k) =>
      out.push(onWord(timed(el, 0.2 + k * 0.04), /\bfog\w*|\bmist\w*|\bcloud\w*/i)),
    );
  }
  if (parts.figure) {
    // A walker stands *up* from whatever they are standing on — the hillside if there
    // is one, the floor of the cell otherwise — so the space above their feet is the
    // real constraint: sized off the box alone they would grow out of the cell and
    // collide with the beat above.
    const feet = hillBox
      ? hillPoint(hillBox, 0.18)
      : { x: box.x + box.w * 0.5, y: box.y + box.h * 0.9 };
    const headroom = Math.max(40, (feet.y - box.y) / 0.9);
    const height = Math.min(150, box.h * 0.3, headroom);
    // The strokes of one figure arrive together: a head, then a spine, then legs,
    // over about a tenth of the beat, which is how a person draws a person.
    walkerPaths(`${ctx.id}_you`, feet, height, 1).forEach((el, k) =>
      out.push(onWord(timed(el, 0.34 + k * 0.025), /\byou\b|\byou'?re\b|\bfigure\b|\bstand\w*/i)),
    );
  }
  if (parts.steps && hillBox) {
    // Three strides down the hill, each drawn on its own cue: feel, step, repeat.
    const ts = [0.34, 0.5, 0.66];
    ts.forEach((t, k) => {
      const from = hillPoint(hillBox, t - 0.09);
      const to = hillPoint(hillBox, t);
      const step = chevronPath(`${ctx.id}_step${k}`, from, to);
      step.enter = { at: round(0.5 + k * 0.14, 3), duration: 0.5, style: 'draw' };
      out.push(onWord(step, /\bsteps?\b|\bstride\w*|\brepeat\w*|\bagain\b/i));
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

/* ------------------------------------------------------- the drawing of last resort */

/**
 * Whether an instruction names *parts in a relationship* rather than one thing to draw.
 *
 * Asked when a lane has refused an intent and something else has to draw it. A flow of
 * named nodes is a diagram; a described object is a picture, and what separates them is
 * that the pieces of a diagram are short *names*. "input → encoder → output" is three
 * names. "Harrison standing on a deck, sextant raised to a sun overhead" is a scene that
 * a splitting node extractor happily turned into two labelled boxes — two captions where
 * the beat asked for a drawing.
 *
 * So the separator alone does not decide it, which is the same mistake in miniature as
 * the one this whole change is about: "the same cross-section twice, **then** an arrow to
 * the second" contains a flow word and is still a picture. Every piece has to be short
 * enough to be a label.
 */
export function readsStructural(describe: string): boolean {
  const clean = stripMarkdown(describe);
  const body = clean.includes(':') ? clean.slice(clean.indexOf(':') + 1) : clean;
  const parts = body
    .split(/\s*(?:→|->|=>|\bthen\b|\bfollowed by\b|[;,])\s*/i)
    .map((s) => s.replace(/^(?:a|an|the)\s+/i, '').trim())
    .filter(Boolean);
  return parts.length >= 2 && parts.every((p) => wordCount(p) <= 3);
}

/**
 * What draws an instruction the lane it was addressed to cannot draw.
 *
 * Named parts go to the diagram lane; anything else goes to the illustration lane,
 * which is the only lane that can draw a specific thing — a battery cross-section, a
 * ship, a chloroplast. It mints an entity and routes nothing: the single asset router
 * in the visuals stage decides between the curated library, a generated drawing, a
 * matched icon and, last, a lettered card, and it is the only place that knows which of
 * those are available on this machine.
 */
function buildFallback(describe: string, ctx: IntentContext): Element[] {
  return readsStructural(describe)
    ? buildDiagram(describe, ctx)
    : buildAsset(describe, 'illustration', ctx);
}

/* ---------------------------------------------------------------------- code */

/**
 * A fenced block, as the code lane wants it: the listing and the language it declares.
 *
 * Only a fence counts. "Looks like code" is a judgement — `sniffMath` makes one and gets
 * to, because promoting prose to the equation lane is recoverable — while this decides
 * whether a *paragraph* is set as a program, and a false positive there sets an English
 * sentence in monospace at 40 columns. A triple backtick is the author saying so, and
 * nothing else is.
 *
 * The info string's first word is the language when it looks like a grammar id, so
 * ```` ```python ```` and ```` ```ts {1,3} ```` both work and ```` ``` ```` is `text`.
 */
export function fencedCode(text: string): { code: string; lang: string } | undefined {
  const m = /```([^\n`]*)\n([\s\S]*?)(?:```|$)/.exec(text);
  if (!m) return undefined;
  const body = (m[2] ?? '').replace(/\s+$/, '');
  if (body.trim() === '') return undefined;
  const info = (m[1] ?? '').trim().split(/\s+/)[0] ?? '';
  const lang = /^[A-Za-z][\w+#-]*$/.test(info) ? info.toLowerCase() : 'text';
  return { code: body, lang };
}

/** The listing this intent carries, whether by field or by fence. */
function codeListing(intent: VisualIntent): { code: string; lang: string } | undefined {
  // The field wins: an author who filled it in was not guessing about the boundaries of
  // the listing, and a `describe` may legitimately quote a second fence as an aside.
  if (intent.code && intent.code.trim() !== '') {
    return { code: intent.code, lang: intent.lang?.trim() || 'text' };
  }
  const fenced = fencedCode(intent.describe);
  if (!fenced) return undefined;
  return { code: fenced.code, lang: intent.lang?.trim() || fenced.lang };
}

/**
 * Set a listing on the board (plan item 6.2).
 *
 * The `code` intent's whole job is to carry a listing, so an intent with none is an
 * author describing code in prose — "a function that hashes the key and walks the bucket".
 * There is nothing here to quote, and inventing the code from the description would put a
 * program on the board that nobody wrote and nobody ran. So it goes loudly to whichever
 * lane can draw what was actually described, exactly as a `plot` intent that names no
 * quantity does.
 */
function buildCode(
  listing: { code: string; lang: string } | undefined,
  describe: string,
  ctx: IntentContext,
): Element[] {
  if (!listing) {
    log.warn(
      `beat ${ctx.index} asked for code but carries no listing: "${describe}"`,
      'the code lane sets source, not descriptions of source — put the lines in `code` ' +
        '(or in a fenced block) and they will be set as written. Drawing what you described ' +
        'instead.',
    );
    return buildFallback(describe, ctx);
  }
  const el = makeCode(ctx.id, listing.code, listing.lang, { maxWidth: ctx.box.w });
  /**
   * The box is the listing's own extent, centred in the cell — not the cell.
   *
   * A `code` element's box is solid content (`boardcheck.ts`'s `SOLID` set), so a box
   * bigger than the listing would claim board the listing does not occupy: the overlap
   * sweep would report collisions with the caption above it and the fill statistic would
   * count whitespace as ink. It is the same reasoning `assetViewBox` gives for an `exact`
   * asset — a margin baked inside the element travels with it — and it makes the visuals
   * stage's fit an identity rather than a second, invisible scaling.
   *
   * `makeCode` already clamped the width to the cell; the height can still overrun a short
   * cell, so the grid is scaled down whole. Scaling it, rather than dropping lines, is the
   * lane's rule: a listing is set smaller or it is refused, never cut.
   */
  const shrink = Math.min(1, ctx.box.w / el.at.w, ctx.box.h / el.at.h);
  const w = el.at.w * shrink;
  const h = el.at.h * shrink;
  el.at = {
    x: round(ctx.box.x + (ctx.box.w - w) / 2, 2),
    y: round(ctx.box.y + (ctx.box.h - h) / 2, 2),
    w: round(w, 2),
    h: round(h, 2),
  };
  // The listing is what the beat is showing, so it is cued like any other picture: the
  // blanket cue the caller assigns lands it on the phrase that introduces it.
  el.enter = { ...el.enter, at: 0.08 };
  return [el];
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
  // One node is not a diagram, it is a subject — so draw the subject. Writing it out as
  // a centred line of body text is how a beat that asked for a picture ended up as one
  // more caption on a board that already has too many.
  if (labels.length < 2) return buildAsset(describe, 'illustration', ctx);
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

/**
 * The recap's chain of ideas, when the beat has no visuals of its own.
 *
 * **A column, not a row, and the layout is the whole of it.** These labels are
 * sentences — a beat's `idea` is a clause, six or seven words — and a `flow` diagram
 * reads left to right, so four of them divide the recap's cell into four columns about
 * 160 units wide. A sentence has nowhere to go in 160 units: the browser wraps it to
 * five lines, finds five lines do not fit either, and shrinks the type until they do.
 * Measured on the shipped `longitude` lesson, that is 31 canvas units asked for and
 * **16.3 delivered — 7.2 output pixels**, against a 10px legibility floor. Four boxes
 * of grey mush at the foot of the board, under a heading that says "From a wreck to a
 * watch", on a board with an empty middle. It is the one defect in that film a viewer
 * cannot miss, and it survived every check in the repo until the realized-layout sweep
 * (plan 2.7) read what the browser had really done.
 *
 * A `stack` gives each idea the cell's full width — 860 units, room for the whole
 * clause on one line at the size it asked for — and the edges still chain them, so the
 * argument reads top to bottom instead of not reading at all. The word budget rises
 * with the width for the same reason: at seven words the labels were truncated
 * mid-thought ("A carpenter built the clock the astronomers"), which a recap of the
 * argument can least afford, and a full-width row fits the sentence that finishes it.
 */
function recapChain(lesson: Lesson, id: string, box: Box, preset: Preset): Element | undefined {
  const words = preset.vertical ? 6 : 10;
  const ideas = lesson.steps.map((s) => shorten(stripMarkdown(s.idea), words));
  const nodes = [shorten(stripMarkdown(lesson.anchor.idea), words), ...ideas]
    .filter(Boolean)
    .slice(0, preset.vertical ? 4 : 6)
    .map((label, k) => ({ id: `r${k}`, label }));
  if (nodes.length < 2) return undefined;
  const edges = nodes.slice(1).map((n, k) => ({ from: nodes[k]!.id, to: n.id }));
  const el = makeDiagram(id, 'stack', nodes, edges, { w: box.w, h: box.h });
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

/**
 * The generated picture a beat's marks are drawn on top of, as the element that draws it.
 *
 * Two decisions live here and both are load-bearing.
 *
 * **One transform.** The element's box is the canvas fit's own picture of the box the
 * marks were composed against — the same `Fit` `buildDrawing` used a line earlier, applied
 * to the ink box the drawing stage measured. If the picture and the marks went through two
 * transforms they would not line up, and every leader arrow would point a little way off
 * the structure it names, which is the failure this whole lane is one long argument about.
 * `fit: 'exact'` is the other half: it tells the visuals stage this box is not a suggestion.
 *
 * **It is drawn first, and almost immediately.** `at: 0.02` puts the form on the board
 * before anything annotates it, because a leader arrow arriving before the thing it points
 * at is a viewer watching an arrow point at nothing. The marks follow from 0.06, each on
 * the words that name it.
 */
function buildUnderlay(
  underlay: { ink: Box; prompt: string; kind?: 'form' | 'figure' },
  ctx: IntentContext,
): AssetElement {
  const { id, prompt } = underlayAsset(underlay.prompt);
  // A figure and a form are two different assets resolved by two different lanes, and the
  // kind has to travel from the lesson to the registry or the author's choice is discarded
  // here in silence. Measured: a lesson that asked for two figures minted zero, because
  // this line always said `underlay`.
  const assetId =
    underlay.kind === 'figure' ? ctx.assets.figure(id, prompt) : ctx.assets.underlay(id, prompt);
  const el = makeAsset(`${ctx.id}_underlay`, assetId, 100);
  el.at = boxAt(fitCanvas(ctx.box), underlay.ink);
  el.enter = { ...el.enter, at: 0.02 };
  return el;
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
 *
 * "Otherwise" used to mean a lone chevron sliding across empty board. A motion
 * instruction almost always describes a scene *and* the movement in it — "the two stacks
 * with a wire looping over the top through a bulb; electrons travel along the wire" — so
 * when the beat has drawn nothing else, the scene is drawn first and the mover travels
 * over it. A dot moving across nothing is not a picture of a circuit.
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
  // Anything already drawn in this beat is the scene the mover moves through; if there
  // is nothing, the instruction is the only description of the scene there will be.
  const drawn = ctx.existing.some(
    (el) => el.type !== 'text' && el.type !== 'equation' && el.type !== 'code',
  );
  const scene = drawn ? [] : buildFallback(describe, { ...ctx, id: `${ctx.id}_scene` });
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
  return [...scene, mover];
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
 *
 * Each cue also leaves with a **word index** (`enter.cueWord`, plan item 4.1):
 * which word of the spoken narration it starts on, counted by `@inkcast/core`'s
 * `cueWordIndex` — the same tokeniser the voice stage resolves with. This is the
 * one place in the pipeline that has both the narration and the cue in hand, so it
 * is the only place the number can honestly be taken; downstream it is read, never
 * re-derived. A cue that does not survive normalisation exactly gets no index and
 * falls to the phrase search, which is the honest outcome rather than a guessed
 * number.
 */
export function assignTiming(
  scene: Scene,
  elements: Element[],
  opts: { maxGestures?: number } = {},
): void {
  const n = elements.length;
  if (!n) return;
  const ordered = elements
    .map((el, i) => ({ el, i, at: el.enter.at }))
    .sort((a, b) => a.at - b.at || a.i - b.i);
  const cues = deriveCues(scene.narration, n);

  const timed = ordered.map((entry, k) => {
    const derived = cues[k];
    const cue = preferredCue(scene.narration, entry.el.enter.cue, derived);
    const at = entry.at > 0 ? entry.at : k === 0 ? 0 : 0.06 + (k * 0.72) / Math.max(1, n - 1);
    return { entry, cue, at };
  });

  // Coalesce the beat's reveals into gestures, when its format asks for that. Absent
  // `maxGestures` this is the identity, so `standard` — which every pinned hash is
  // taken against — compiles byte for byte as it did.
  const starts = gestureStarts(timed, opts.maxGestures);

  let previous = -1;
  let head = timed[0];
  timed.forEach((slot, k) => {
    if (starts.has(k)) head = slot;
    // Every mark of one gesture leaves on the same word, and `serializePen` draws
    // them back to back from there. The `+0.04` below only separates *gestures*: it
    // is what stops two consecutive starts collapsing onto one fraction, and inside
    // a gesture it would be reintroducing the stagger the ceiling exists to remove.
    const source = head ?? slot;
    let at = source.at;
    if (starts.has(k) && at <= previous) at = previous + 0.04;
    at = Math.min(0.92, Math.max(0, at));
    if (starts.has(k)) {
      previous = at;
      source.at = at;
    }
    const cue = source.cue;
    const cueWord = cue === undefined ? undefined : cueWordIndex(scene.narration, cue);
    slot.entry.el.enter = {
      at: round(at, 3),
      duration: slot.entry.el.enter.duration,
      style: slot.entry.el.enter.style,
      ...(cue ? { cue } : {}),
      ...(cueWord === undefined ? {} : { cueWord }),
    };
    if (slot.entry.el.motion) {
      const start = Math.min(0.9, Math.max(slot.entry.el.motion.from, at + 0.06));
      slot.entry.el.motion = {
        ...slot.entry.el.motion,
        from: round(start, 3),
        to: round(Math.max(start + 0.05, slot.entry.el.motion.to), 3),
      };
    }
  });
}

/**
 * Which reveals of a beat are the *start of a gesture*, and which join the one before.
 *
 * Every reveal starts its own gesture until the ceiling bites, which is what makes
 * the absent-ceiling case exactly today's behaviour. Past the ceiling, gestures are
 * merged into their predecessor smallest-first — the plan's "merge the smallest
 * labels into the drawing's own gesture" — so what disappears is a lone leader
 * arrow's separate moment, never a picture's.
 *
 * Ties go to the later index, which keeps the *opening* of the beat granular: the
 * first thing a beat does is establish what it is about, and collapsing the title and
 * the first stroke into one moment is the merge with the worst reading of the two.
 */
function gestureStarts(slots: readonly { at: number }[], ceiling: number | undefined): Set<number> {
  const starts = new Set(slots.map((_, k) => k));
  if (!ceiling || ceiling < 1 || slots.length <= ceiling) return starts;

  /** Reveals currently in each gesture, by the index that starts it. */
  const size = new Map<number, number>([...starts].map((k) => [k, 1]));
  while (size.size > ceiling) {
    // The smallest gesture that has something in front of it to join. Index 0 is
    // never a candidate: there is nothing before it, and a beat has to start.
    let victim = -1;
    let smallest = Infinity;
    for (const [k, count] of size) {
      if (k === 0) continue;
      if (count <= smallest) {
        victim = k;
        smallest = count;
      }
    }
    if (victim < 0) break;
    // Its predecessor absorbs it.
    const keys = [...size.keys()].sort((a, b) => a - b);
    const before = keys[keys.indexOf(victim) - 1] as number;
    size.set(before, (size.get(before) as number) + (size.get(victim) as number));
    size.delete(victim);
    starts.delete(victim);
  }
  return starts;
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
