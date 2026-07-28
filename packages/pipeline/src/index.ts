/**
 * @inkcast/pipeline — the orchestrator.
 *
 * ```ts
 * import { cast, rerender, editStoryboard } from '@inkcast/pipeline';
 *
 * const { projectId, videoPath } = await cast(
 *   { filePath: 'examples/gradient-descent.md' },
 *   { onProgress: (p) => console.log(p.stage, `${p.pct}%`) },
 * );
 * await editStoryboard(projectId, 'scene 2 narration: keep it shorter');
 * await rerender(projectId);
 * ```
 *
 * Everything here works with no API keys. Cloud providers are opt-in upgrades
 * chosen by env var (see `providers()`), and a missing key degrades to the local
 * default with a warning rather than an error.
 */

export { cast, rerender } from './cast.js';
export type { CastInput, CastOptions, CastResult } from './cast.js';

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

export { STAGES, STAGE_LABEL, STAGE_WEIGHT, stageBase, progressBus } from './progress.js';
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
export type { PipelineState, ProjectSummary, SourceRef } from './state.js';
