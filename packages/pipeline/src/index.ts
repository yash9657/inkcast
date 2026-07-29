/**
 * @inkcast/pipeline — the orchestrator.
 *
 *     ingest -> lesson -> storyboard -> voice -> visuals -> render
 *
 * ```ts
 * import { teach, cast, designLesson, rerender } from '@inkcast/pipeline';
 *
 * // The normal case: no document, no key required, teach a thing.
 * const { videoPath } = await teach('gradient descent', { preset: 'short' });
 *
 * // A document, or a hand-authored lesson that needs no planner at all.
 * await cast({ filePath: 'examples/gradient-descent.md', depth: 'deep' });
 * await cast({ lesson: 'examples/lessons/gradient-descent.lesson.json' });
 *
 * // Review the teaching before paying for a render.
 * const { lesson, problems } = await designLesson({ topic: 'entropy' });
 * ```
 *
 * Three things are worth knowing before you call any of this.
 *
 * **The lesson is a stage, and an artefact.** It is written to
 * `projects/<id>/lesson.json`, criticised by `critiqueLesson()`, and hashed into
 * the storyboard stage's cache key — so you can edit it by hand and re-cast to
 * get a new board without re-authoring the teaching. Summarising a document was
 * the wrong model; see `docs/LESSON-ENGINE.md`.
 *
 * **Voice runs before visuals and render.** It measures real audio and resolves
 * every `Enter.cue` into a real fraction of a scene, and neither drawing nor
 * rendering may happen against unresolved timing.
 *
 * **Everything works with no API keys, and says what that costs.** Cloud
 * providers are opt-in upgrades chosen by env var (see `providers()`); a missing
 * key degrades to the local default and reports itself through `degradations()`
 * with the one command that fixes it.
 */

export { cast, teach, designLesson, rerender, sourceRef, briefFor } from './cast.js';
export type { CastInput, CastOptions, CastResult, LessonResult } from './cast.js';

export {
  DEPTHS,
  LESSON_FILE,
  beatCount,
  isDepth,
  lessonHash,
  loadLessonFrom,
  parseLesson,
  projectLesson,
  readLessonFile,
  saveLessonFile,
  targetSeconds,
} from './lesson.js';
export type { Depth, ProjectLesson } from './lesson.js';

export { degradations, formatDegradation } from './degrade.js';
export type { Degradation } from './degrade.js';

export {
  PIPELINE_VERSION,
  STAGE_CODE_VERSION,
  assetFingerprint,
  cacheKey,
  cacheSlot,
  elementFingerprint,
  renderFingerprint,
  stageVersion,
  visualsFingerprint,
  voiceFingerprint,
} from './keys.js';

export { editStoryboard, editProject } from './edit.js';
export type { EditResult } from './edit.js';

export {
  applyOps,
  coerceOps,
  parseInstruction,
  EditError,
  EDIT_OPS_SCHEMA,
  EDIT_USAGE_HINT,
} from './ops.js';
export type { ApplyResult, EditOp, SceneRef } from './ops.js';

export { StageError, rootCauseMessage } from './errors.js';

export {
  STAGES,
  STAGE_BLURB,
  STAGE_LABEL,
  STAGE_WEIGHT,
  stageBase,
  progressBus,
} from './progress.js';
export type { PipelineProgress, ProgressBus, StageName } from './progress.js';

export {
  providers,
  plannerProvider,
  voiceProvider,
  imageProvider,
  fullyLocal,
} from './providers.js';
export type { ProviderChoice, Providers } from './providers.js';

export { costOf, emptyCost, formatCost } from './cost.js';
export type { CostInputs, CostLine, CostReport } from './cost.js';

export { listProjects, readState, findVideo } from './state.js';
export type { LessonSummary, PipelineState, ProjectSummary, SourceRef } from './state.js';

export type { PresetName, PresetShape, SourceDoc } from './stages.js';
