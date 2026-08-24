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
 *
 * The renderer draws onto ONE persistent canvas. Scenes that share `Scene.region`
 * accumulate on the same board and the camera frames the union of what has been
 * drawn there so far, pulling back over everything on a `recap`. `seek(t)` in the
 * page is a pure function of time — no clock, no randomness, no rAF — which is what
 * makes concurrent capture and the studio preview agree to the pixel.
 */
export { render } from './render.js';
export { buildPageHtml, buildPreviewHtml } from './html.js';
export type { PageOptions, PreviewOptions } from './html.js';
export { compileBoard, compilePlan, cueFraction, sceneDuration } from './compile.js';
export type { BoardReport, CompileOptions } from './compile.js';
export { check, QC_FILE } from './check.js';
export type { CheckOptions, InheritedProblems } from './check.js';
export {
  captureSamples,
  inkFloorViolations,
  inkNote,
  ocrDiff,
  sampleTimes,
  textAt,
  visionViolations,
  MIN_INK_SHARE,
  SAMPLES,
} from './tier2.js';
export type { FrameSample, FrameVerdict, VisionPass } from './tier2.js';
export { inkShare, statFrame, rawFrames } from './ink.js';
export {
  densityWarnings,
  dwellFloor,
  dwellWarnings,
  glyphFloorViolations,
  inkOnInkViolations,
  offFrameViolations,
  overrunViolations,
  realizedTextViolations,
  MAX_REVEALS_PER_SCENE,
  MIN_GLYPH_PX,
} from './boardcheck.js';
export type { BoardViolation, RealizedReport, TimedItem } from './boardcheck.js';
export { chromiumAvailable, CHROMIUM_HINT } from './browser.js';
export { captureStill, openStills } from './still.js';
export type { StillOptions, StillSession } from './still.js';
export { ensureFfmpeg, probeMedia, probeDuration } from './ffmpeg.js';
export type { MediaInfo } from './ffmpeg.js';
export { resolveFont, fontSearchPaths } from './font.js';
export type { ResolvedFont } from './font.js';
export { paletteFor, inkStyle, penArt, TYPE_SCALE } from './palette.js';
export type { Palette, InkStyle, TextRole } from './palette.js';
export { layoutDiagram } from './layout.js';
export type { LaidDiagram, LaidEdge, LaidNode } from './layout.js';

/* Board accumulation and framing — useful to anything that wants to know what a
 * scene will actually look like without rendering it. */
/* The camera and the board's scale now live in `@inkcast/core`, because the visuals
 * stage needs them to resolve geometry at the size it will actually be drawn at —
 * that placement was the last live half of root cause 1. Re-exported here so a
 * consumer of `@inkcast/render` still finds them where they have always been. */
export {
  boardMetrics,
  contentFill,
  elementBounds,
  fitCamera,
  medianOf,
  resolveFraming,
  safeInsets,
  unitsPerPixel,
  viewRect,
} from '@inkcast/core';
export type { BoardMetrics, FrameSize, Insets, ResolvedCamera, SceneFraming } from '@inkcast/core';

/* Plot timing and packaging.
 *
 * The geometry itself — the frame, the gutters, the sampling, the label solver and
 * the named functions `Curve.fn` accepts — belongs to `@inkcast/visuals`, which is
 * authoritative for it. The renderer reads that geometry through `openVisuals`; the
 * curve maths is re-exported so a consumer still has one place to reach for it. */
export { curveTrace, plotArea, plotPhases } from './plot.js';
export type { PlotContext, PlotPhase } from './plot.js';
export { openVisuals } from './visuals.js';
export type { EquationSource, PlotSource, VisualsBridge } from './visuals.js';
export {
  CURVE_FUNCTIONS,
  curveEval,
  describeCurveFunctions,
  niceStep,
  plotFrame,
  resolvePlot,
  tickValues,
} from '@inkcast/visuals';
export type { CurveEval, CurveFnName, PlotFrame, PlotLayout, ResolvedPlot } from '@inkcast/visuals';

/* Arc-length geometry: motion paths, dashes, and SVG path measurement. */
export {
  boundsOfPoints,
  circlePath,
  clipSegment,
  cumulativeLengths,
  dashAlong,
  easeFn,
  flattenPathData,
  pointAtLength,
  polylineLength,
  resampleEven,
  unionArea,
  unionRects,
} from './geom.js';
export type { EasingName, Pt } from './geom.js';

export type {
  EnterStyle,
  GeomPrim,
  MotionTrack,
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
