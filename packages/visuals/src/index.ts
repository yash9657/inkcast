/**
 * @inkcast/visuals — resolve a Storyboard's elements into hand-drawn SVG.
 *
 * The stage entry point is `resolveVisuals(sb, dir, opts)`. Everything else is
 * exported because the renderer needs the same primitives (path measurement,
 * reveal masks, the serialiser) and because the studio wants to preview a single
 * element without running the whole stage.
 *
 * Lanes, in order of preference for a given element:
 *   plot      — cartesian frames, curves, tangents, overlays (offline, free)
 *   path      — smoothed freeform strokes                    (offline, free)
 *   geometry  — roughjs shapes, arrows, emphasis marks        (offline, free)
 *   icon      — lucide-static, roughened                      (offline, free)
 *   diagram   — dagre + deterministic layouts                 (offline, free)
 *   text      — real handwriting with per-line reveal masks    (offline, free)
 *   image     — flux-schnell + vtracer illustrations           (needs a key)
 *
 * `motion` is not a lane but a layer over any of them: it turns a path into
 * arc-length-even positions so a ball descending a curve moves at one speed.
 */

/* ---- the stage ---------------------------------------------------------- */
export { resolveVisuals, type ResolveVisualsOptions } from './resolve.js';

/* ---- ink personality ---------------------------------------------------- */
export {
  inkColour,
  inkStyleFor,
  roleFontSize,
  strokeWidthFor,
  styleFingerprint,
  type InkRole,
  type InkStyle,
  type InkStyleName,
  type Palette,
  type TextRole,
} from './style.js';

/* ---- geometry lane ------------------------------------------------------ */
export {
  arrowMidpoint,
  arrowPaths,
  createGenerator,
  ctxFor,
  emphasisPaths,
  inkPaths,
  polylineArrowPaths,
  roughenPathData,
  seedFrom,
  shapePaths,
  type DrawContext,
  type EmphasisKind,
  type InkMode,
  type InkPath,
  type ShapeKind,
  type StrokeWeight,
} from './geometry.js';

/* ---- plot lane ---------------------------------------------------------- */
export {
  CURVE_FUNCTIONS,
  DEFAULT_SAMPLES,
  curveEval,
  curveInk,
  describeCurveFunctions,
  niceStep,
  plotFrame,
  resolvePlot,
  tickValues,
  type CurveEval,
  type CurveFnDoc,
  type CurveFnName,
  type PlotCurveTrace,
  type PlotFrame,
  type PlotLayout,
  type PlotMark,
  type PlotPart,
  type PlotPartKind,
  type PlotPartRecord,
  type PlotTypeSizes,
  type ResolvedPlot,
  type ResolvePlotOptions,
} from './plot.js';

/* ---- equation lane ------------------------------------------------------ */
export {
  equationEngineReady,
  resolveEquation,
  type EquationLayout,
  type EquationSpec,
  type ResolveEquationOptions,
  type ResolvedEquation,
} from './equation.js';

/* ---- path lane ---------------------------------------------------------- */
export {
  CATMULL_ROM_ALPHA,
  catmullRomBeziers,
  catmullRomPath,
  clipPolylineToBox,
  clipPolylineToRange,
  clipSegmentToBox,
  cubicAt,
  cubicDerivativeAt,
  dedupePoints,
  flattenCubics,
  resolvePath,
  simplifyPolyline,
  type CubicSeg,
  type PathSpec,
  type ResolvedPath,
} from './path.js';

/* ---- motion helpers ----------------------------------------------------- */
export {
  MOTION_SAMPLES,
  ease,
  fractionAtLength,
  motionAt,
  motionPath,
  polylineLength,
  resamplePolyline,
  resolveMotion,
  type Easing,
  type MotionLayout,
  type MotionPath,
  type MotionSample,
} from './motion.js';

/* ---- character rigs (one person, several poses) ------------------------- */
export {
  composePose,
  inkParts,
  loadRig,
  plausibilityGate,
  posePath,
  resetPoseNotice,
  resetRigCache,
  resolveGeneratedPose,
  type CharacterRig,
  type ComposedPart,
  type GeneratedPose,
  type PoseGate,
  type PoseGenerator,
  type RigPart,
  type RigPose,
} from './character.js';

/* ---- the asset library (first stop; the things we chose) ---------------- */
export {
  LIBRARY_MANIFEST,
  defaultLibraryDirs,
  libraryAvailable,
  libraryFile,
  libraryFingerprint,
  libraryPaths,
  loadLibrary,
  matchLibrary,
  resetLibraryCache,
  type Library,
  type LibraryEntry,
  type LibraryMatch,
  type LibraryResult,
} from './library.js';

/* ---- icon lane (the fallback provider; the things we settle for) -------- */
export {
  FALLBACK_ICON,
  ICON_KEYWORDS,
  iconPathData,
  iconPaths,
  iconsAvailable,
  matchAsset,
  matchIcon,
  readIconSvg,
  type IconMatch,
  type IconResult,
} from './icons.js';

/* ---- diagram lane ------------------------------------------------------- */
export {
  diagramItems,
  layoutDiagram,
  resolveDiagram,
  type DiagramEdgeLayout,
  type DiagramEdgeSpec,
  type DiagramKind,
  type DiagramLayout,
  type DiagramNodeLayout,
  type DiagramNodeSpec,
  type LayoutDiagramOptions,
  type Lifeline,
} from './diagram.js';

/* ---- handwriting lane --------------------------------------------------- */
export {
  layoutText,
  revealMaskAt,
  scaleTextLayout,
  textSvg,
  wordAt,
  type LayoutTextOptions,
  type LineLayout,
  type TextLayout,
  type WordSpan,
} from './text.js';
export {
  builtinMetrics,
  defaultFontDirs,
  findFontFile,
  loadFontMetrics,
  parseFontMetrics,
  type FontMetrics,
} from './fontmetrics.js';
export {
  formatGlyphViolation,
  glyphViolations,
  handwrittenStrings,
  type GlyphViolation,
} from './glyphgate.js';

/* ---- illustration lane (needs REPLICATE_API_TOKEN or FAL_KEY) ----------- */
export {
  ILLUSTRATION_DIR,
  detectImageProvider,
  extractPathData,
  figurePrompt,
  figureRaster,
  generateIllustration,
  illustrationKey,
  illustrationPaths,
  illustrationPrompt,
  illustrationRaster,
  resetIllustrationCache,
  resetImageProviderNotice,
  shapePrompt,
  tracedInkBox,
  vectoriseToInk,
  type IllustrationRaster,
  type ImageKind,
  type ImageProvider,
} from './image.js';

/* ---- SVG helpers the renderer needs ------------------------------------ */
export {
  applyM,
  arcToCubics,
  boxCentre,
  clamp,
  clipToBox,
  containsBox,
  el,
  escapeAttr,
  escapeText,
  fitMatrix,
  flipXM,
  identity,
  multiply,
  n,
  padBox,
  parsePath,
  pathBBox,
  pathLength,
  pathToString,
  pointsBBox,
  samplePath,
  rotateM,
  scaleM,
  segsBBox,
  segsLength,
  serialiseSvg,
  svgChildren,
  svgDocument,
  svgViewBox,
  SVG_NS,
  transformPath,
  transformSegs,
  translateM,
  unionBox,
  type Attrs,
  type Box,
  type Matrix,
  type Pt,
  type Seg,
  type SvgChild,
  type SvgNode,
} from './svg.js';

/* ---- output records ---------------------------------------------------- */
export {
  MANIFEST_PATH,
  MANIFEST_VERSION,
  loadVisualManifest,
  manifestFile,
  saveVisualManifest,
  toViewBox,
  type AssetVisual,
  type ElementVisual,
  type RevealStyle,
  type ViewBox,
  type VisualManifest,
  type VisualSpace,
} from './manifest.js';
export {
  pathItem,
  pathItems,
  sanitiseId,
  textItem,
  totalStrokeLength,
  writeElementSvg,
  type InkItem,
  type InkStroke,
  type WriteElementResult,
} from './writer.js';
