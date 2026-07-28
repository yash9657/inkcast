/**
 * `@inkcast/planner` — the front half of the Inkcast compiler.
 *
 * ```ts
 * import { ingest, plan, editStoryboard } from '@inkcast/planner';
 *
 * const doc = await ingest({ filePath: 'examples/gradient-descent.md' });
 * const sb  = await plan(doc, { dir: 'projects/abc' });
 * const v2  = await editStoryboard(sb, 'retitle to "Downhill" and make it vertical');
 * ```
 *
 * ## The two entry points
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
 *   Compiles a document into the IR from `@inkcast/core`: beats, spoken
 *   narration, visual elements, asset references, layout and camera. Validated
 *   with zod before it returns. Adapter selection:
 *   `heuristic` (default, zero keys, zero network) or `anthropic`
 *   (`ANTHROPIC_API_KEY` set, or `adapter: 'anthropic'`), which asks Claude for
 *   the plan through a forced tool call and falls back to the heuristic planner
 *   on any failure.
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
export { plan, resolveAdapter, PLANNER_VERSION } from './plan.js';
export { editStoryboard, editStoryboardDetailed, splitInstructions } from './edit.js';

/* ---------------------------------------------------------------- adapters */
export { heuristicPlan, pacing } from './heuristic.js';
export {
  anthropicAvailable,
  anthropicPlan,
  anthropicEdit,
  plannerModel,
  DEFAULT_MODEL,
} from './anthropic.js';
export { storyboardJsonSchema } from './schema.js';

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
export type { Box } from './elements.js';
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
} from './types.js';
