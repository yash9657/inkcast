/**
 * `@inkcast/planner` — the front half of the Inkcast compiler.
 *
 * ```ts
 * import { ingest, teachLesson, compileLesson, editLesson } from '@inkcast/planner';
 *
 * const doc    = await ingest({ filePath: 'examples/gradient-descent.md' });
 * const lesson = await teachLesson(doc, { objective: 'explain why the update has a minus sign' });
 * const sb     = compileLesson(lesson, { preset: 'standard' });
 * const better = await editLesson(lesson, 'spend longer on the tangent; drop step 4');
 * ```
 *
 * ## The pipeline this package owns
 *
 *     ingest -> lesson -> storyboard
 *
 * The middle stage is the product. `plan()` used to go straight from document to
 * storyboard, which made it a summariser: it chopped prose into beats and read
 * them aloud. Teaching is a different algorithm — anchor the abstraction in
 * something concrete, introduce one idea at a time, justify rather than assert,
 * consolidate with real numbers, name the wrong belief the learner just formed —
 * and it has to happen before anything is drawn. See `docs/LESSON-ENGINE.md`.
 *
 * - **`teachLesson(input, opts)` → `Lesson`**
 *   `input` is a `SourceDoc` or a bare topic string. With `ANTHROPIC_API_KEY` set,
 *   Claude writes the lesson through a forced tool call against the Lesson schema
 *   and then has to survive `critiqueLesson()`; problems are fed back for one
 *   revision pass. With no key, a lesson is *derived* from document structure —
 *   real, renderable, and clearly logged as the lesser path.
 *
 * - **`compileLesson(lesson, opts)` → `Storyboard`**
 *   One scene per beat, carrying its `role` and `hold`. Visual intents become real
 *   elements: `plot` intents produce genuine `PlotElement`s with derived domains,
 *   named functions and overlays that serve the idea (tangents where slope is
 *   explained, real gradient-descent steps where descent is shown, a second
 *   shallower well for local minima); `path` intents produce drawn ink. Beats
 *   share regions so the board accumulates, and the camera frames the growing
 *   union instead of one patch at a time.
 *
 * - **`editLesson(lesson, instruction, opts)` → `Lesson`**
 *   Revise the teaching rather than the drawing. With a key Claude patches the
 *   lesson under the same brief; without one, pacing, silence, dropping a beat,
 *   reordering steps, the jargon budget, the objective and a vertical refit are all
 *   local, and anything needing new prose is reported as needing a key.
 *
 * ## The original entry points
 *
 * - **`ingest({ text?, filePath?, url? })` → `SourceDoc`**
 *   Reads raw text, `.md`, `.txt`, `.pdf`, `.docx`, `.html` or an `http(s)` URL
 *   and returns `{ title, text, sections, images? }`. `text` is canonical
 *   markdown, so headings and lists survive — they are the video's outline.
 *   PDF (`unpdf`), docx (`mammoth`) and URL (`cheerio` + `turndown`) support is
 *   lazily loaded; a missing package degrades with a warning instead of crashing,
 *   and URL ingest has a dependency-free HTML fallback.
 *
 * - **`plan(doc, opts)` → `Storyboard`**
 *   The pipeline's stage entry: `teachLesson` then `compileLesson`, validated with
 *   zod before it returns. `via: 'document'` selects the MVP's summarising path
 *   instead, which is kept as the renderer's zero-key CI fixture. `lesson:` takes a
 *   `Lesson` or a path to one, so a hand-authored lesson can be rendered directly.
 *
 * - **`editStoryboard(sb, instruction)` → `Storyboard`**
 *   Natural-language editing. With a key, Claude patches the IR. Without one, a
 *   deterministic parser handles retitling, voice, palette, aspect, ink style,
 *   language, fps, outro, per-scene pacing and scene removal, and warns clearly
 *   when an instruction needs a model.
 *
 * ## What the planner guarantees
 *
 * 1. One idea per scene, 4–12 seconds of narration each, written to be *spoken*.
 * 2. Every element has a box on **one persistent canvas** and **no two elements
 *    in a region overlap**. Consecutive scenes occupy adjacent regions, so the
 *    camera pans instead of teleporting, and annotated elements persist.
 * 3. `enter.at` is a fraction of the beat, staggered so an element appears on the
 *    words that introduce it — `write` for text, `draw` for shapes and assets.
 * 4. Assets are declared once in `storyboard.assets` and referenced by id, using
 *    the built-in icon vocabulary so they resolve with no API key.
 *
 * Element `at` boxes are measured at the planner's own type scale (see
 * `FONT` in `./elements.ts`); the renderer owns the typeface, so it should fit
 * text to its box rather than assume a font size.
 */

/* ------------------------------------------------------------ stage entries */
export { ingest, buildDoc, htmlToMarkdown, htmlToMarkdownFallback, reflow } from './ingest.js';
export { plan, resolveAdapter, resolveRoute, PLANNER_VERSION } from './plan.js';
export { teachLesson, resolveLessonAdapter, LESSON_VERSION } from './lesson.js';
export { compileLesson, updateLine, assignTiming, nodesFrom, COMPILER_VERSION } from './compile.js';
export { editStoryboard, editStoryboardDetailed, splitInstructions } from './edit.js';
export { editLesson, editLessonDetailed, splitLessonInstructions } from './lesson-edit.js';

/* -------------------------------------------------------------- lesson bits */
export { deriveLesson } from './lesson-derive.js';
export {
  anthropicLesson,
  anthropicLessonEdit,
  lessonModel,
  CAST_POSES,
  DEFAULT_LESSON_MODEL,
} from './lesson-anthropic.js';

/* ------------------------------------------------------------- the drawing lane */
export {
  buildDrawing,
  cleanMarks,
  fitDrawing,
  markBounds,
  repairLabels,
  MAX_MARKS,
} from './drawing.js';
export { drawLesson, drawOne, drawKey, drawModel, DEFAULT_DRAW_MODEL } from './draw-anthropic.js';
export { LESSON_FILE, loadLesson, parseLesson, readLessonFile, saveLesson } from './lesson-io.js';
export {
  PRESETS,
  adaptLesson,
  clampNarration,
  critiqueFor,
  lessonSeconds,
  pickVisuals,
  resolvePreset,
} from './presets.js';
export type { Preset, PresetName, PresetInput } from './presets.js';
export { deriveCues, cueResolves, preferredCue } from './cues.js';

/* ------------------------------------------------------------ plots + ink */
export {
  buildPlot,
  makePlot,
  deriveBowl,
  plotHints,
  axisLabels,
  recipeFor,
  recipeChosen,
  worthPlotting,
  describesAPlot,
  trim,
} from './plots.js';
export type { PlotHints, PlotContext } from './plots.js';
export {
  curveParams,
  curveY,
  curvePath,
  descend,
  evalFn,
  fitYDomain,
  sampleCurve,
  slopeAt,
  stepPath,
  dataToCanvas,
} from './curves.js';
export {
  makePath,
  boundsOf,
  ballPath,
  blobPath,
  bowlPath,
  chevronPath,
  circlePoints,
  fogPaths,
  hillPath,
  hillPoint,
  hillProfile,
  walkerPaths,
} from './figures.js';
export { planBoard, groupIntoRegions, cellBoxes, cellGrid, phaseOf, unionBox } from './regions.js';
export type { Board, BoardOptions, RegionSpec, BeatRole } from './regions.js';

/* ---------------------------------------------------------------- adapters */
export { heuristicPlan, pacing } from './heuristic.js';
export {
  anthropicAvailable,
  anthropicClient,
  anthropicPlan,
  anthropicEdit,
  callTool,
  errorDetail,
  plannerModel,
  DEFAULT_MODEL,
} from './anthropic.js';
export { storyboardJsonSchema, lessonJsonSchema } from './schema.js';

/* ------------------------------------------------------- layout + building */
export {
  layoutStoryboard,
  scheduleEntrances,
  regionGrid,
  regionBox,
  frameSpan,
  overlaps,
  sceneBoxes,
} from './layout.js';
export type { Hints, PlacementHint, LayoutOptions, Span, Grid } from './layout.js';
export type { Box, Point } from './elements.js';
export {
  FONT,
  charWidth,
  wrapText,
  measureText,
  diagramSize,
  makeText,
  makeShape,
  makeAsset,
  makeArrow,
  makeDiagram,
  makeEmphasis,
} from './elements.js';

/* ------------------------------------------------- document analysis pieces */
export { parseBlocks, inferHeadings, looksLikeMarkdown, blockText } from './blocks.js';
export type { Block } from './blocks.js';
export { serializeBlock, serializeBlocks } from './serialize.js';
export { buildBeats, extractFacts, subjectOf } from './beats.js';
export type { Beat, BeatShape, BeatOptions, NumberFact } from './beats.js';
export {
  writeNarration,
  speakify,
  splitLong,
  clampSentence,
  mentionFraction,
} from './narration.js';
export type { NarrationOptions } from './narration.js';
export { ICONS, iconFor, matchIcons } from './icons.js';
export type { IconEntry } from './icons.js';
export {
  sentences,
  words,
  wordCount,
  keywords,
  keyTerms,
  shorten,
  slugify,
  stripMarkdown,
  estimateDurationSec,
} from './text.js';

/* -------------------------------------------------------------------- types */
export type {
  SourceDoc,
  SourceSection,
  SourceImage,
  SourceKind,
  IngestInput,
  PlanOptions,
  PlannerAdapter,
  EditOptions,
  EditReport,
  CompileOptions,
  FormatOptions,
  LessonEditReport,
  LessonInput,
  LessonOptions,
} from './types.js';
