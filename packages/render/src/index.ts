/**
 * @inkcast/render — the deterministic animation engine and video encoder.
 *
 * ```ts
 * import { render, buildPreviewHtml } from '@inkcast/render';
 *
 * const { videoPath } = await render(storyboard, 'projects/abc');   // -> out.mp4
 * const html = buildPreviewHtml(storyboard, 'projects/abc');        // instant preview
 * ```
 *
 * Everything runs with zero API keys and zero network. The two external tools it
 * needs are ffmpeg (on PATH) and Playwright's Chromium; both are detected up
 * front and reported with an actionable message rather than a stack trace.
 */
export { render } from './render.js';
export { buildPageHtml, buildPreviewHtml } from './html.js';
export type { PageOptions, PreviewOptions } from './html.js';
export { compilePlan, sceneDuration } from './compile.js';
export type { CompileOptions } from './compile.js';
export { chromiumAvailable, CHROMIUM_HINT } from './browser.js';
export { ensureFfmpeg, probeMedia, probeDuration } from './ffmpeg.js';
export type { MediaInfo } from './ffmpeg.js';
export { resolveFont, fontSearchPaths } from './font.js';
export type { ResolvedFont } from './font.js';
export { paletteFor, inkStyle, penArt, TYPE_SCALE } from './palette.js';
export type { Palette, InkStyle, TextRole } from './palette.js';
export { layoutDiagram } from './layout.js';
export type { LaidDiagram, LaidEdge, LaidNode } from './layout.js';
export type {
  EnterStyle,
  GeomPrim,
  PenArt,
  PlanItem,
  PlanPrim,
  PlanScene,
  Rect,
  RenderOptions,
  RenderPlan,
  RenderResult,
  StyleName,
  SvgPrim,
  TextPrim,
} from './types.js';
