/**
 * Lazy loaders for the stage packages.
 *
 * The signatures below are declared here rather than imported as types because
 * the pipeline must be able to start, print help, list projects, print a lesson
 * and serve a preview even while a stage package is still being installed — and
 * because a missing package should produce one actionable sentence, not a
 * module-resolution stack trace.
 *
 * Each stage is reached through a **literal** `import()` inside a thunk. The
 * laziness is what matters — nothing pulls in Playwright or an ONNX runtime until
 * the stage that needs it actually runs — and a thunk gives that without hiding
 * the specifier. An earlier version held the specifiers in variables, which also
 * hid them from every bundler: the studio's Next build could not follow
 * `import(spec)`, so the stage packages were left out of the server bundle and
 * every render died with a module-resolution error at request time. Keep these
 * literal.
 */

import type {
  BoardMode,
  Element,
  Lesson,
  ModelSpend,
  OnProgress,
  OnSpend,
  QcReport,
  Storyboard,
  StoryboardMeta,
} from '@inkcast/core';
import { StageError } from './errors.js';
// A type-only import, so this file still pulls in no stage package: `frame-vision.ts`
// depends on core and `providers.ts` alone, and the SDK inside it is dynamic.
import type { VisionPass } from './frame-vision.js';
import type { StageName } from './progress.js';

export type IngestInput = { text?: string; filePath?: string; url?: string };

/**
 * What `ingest` returns. The planner owns the real type; the pipeline only
 * needs it to be a JSON-serialisable object so it can be cached on disk, plus
 * an optional title to fall back on.
 *
 * `sections` joined it for plan 5.2: a beat's `sourceRef` names one of these headings, and
 * `critiqueLesson` is handed the list to check the refs against. Structurally optional
 * here because this mirror describes anything the ingest stage may hand back — including
 * a `source.json` written before sections were recorded.
 */
export type SourceDoc = {
  title?: string;
  text?: string;
  sections?: { heading?: string }[];
} & Record<string, unknown>;

/**
 * Output format presets, mirrored from the planner so nothing imports it eagerly.
 *
 * `explainer` was added to `planner/src/PRESETS` and never added here, and a drifted
 * mirror is worse than no mirror because it fails at the one boundary that matters. The
 * consequence, measured: `CastInput.preset` is this type, so `preset: 'explainer'` was not
 * *assignable* — the studio's whole hosted format cap (`hostedFormat()` in
 * `apps/web/lib/jobs.ts`, exported and unit-tested for a day) could not be handed to
 * `cast()` at all, and `pnpm --filter @inkcast/web typecheck` is where it finally said so.
 * Nobody caught it earlier because nobody had tried to pass the value; a preset the
 * pipeline cannot name is a preset that only exists in the planner's own tests.
 *
 * Still a mirror rather than `import type { PresetName } from '@inkcast/planner'`, for the
 * reason this file's header gives: the signatures here are declared, not imported, so the
 * CLI can print help and list projects while a stage package is half-installed. What is
 * new is that the mirror is no longer guarded by hope — `test/preset-mirror.test.ts`
 * asserts this union is exactly `Object.keys(PRESETS)`, in both directions, so the next
 * preset cannot be added on one side only.
 */
export type PresetName = 'standard' | 'short' | 'square' | 'explainer' | 'deepdive';

/** Format options every lesson-shaped stage understands. */
export type FormatOptions = {
  preset?: PresetName;
  aspect?: StoryboardMeta['aspect'];
  palette?: StoryboardMeta['palette'];
  style?: StoryboardMeta['style'];
  voice?: string;
  language?: string;
  fps?: number;
  maxSeconds?: number;
  wordsPerSecond?: number;
  /**
   * The voice provider that will speak this film, threaded into the *length estimate*.
   *
   * Not the voice id (`voice` above). The lesson's word budget is seconds × a rate,
   * and the rate is a property of the engine: see `DELIVERED_LPS_BY_PROVIDER` in the
   * planner. Mirrored here for the reason this file's header gives.
   */
  voiceProvider?: string;
};

export type LessonStageOptions = FormatOptions & {
  adapter?: 'auto' | 'anthropic' | 'heuristic';
  model?: string;
  audience?: string;
  objective?: string;
  brief?: string;
  /** True when an image provider is configured; lets the brief offer `illustration`. */
  illustrations?: boolean;
  /**
   * How to render a drawing so the drawing author can be shown its own work.
   *
   * The planner cannot make one of these — rendering is Chromium and roughjs, which it
   * depends on neither of — so the pipeline passes one down. See `draw-preview.ts`.
   */
  drawPreview?: (
    marks: unknown[],
    opts?: { underlay?: boolean },
  ) => Promise<Uint8Array | undefined>;
  /**
   * How to generate the picture a drawing is composed on top of, for a beat that names a
   * real object whose form matters. Needs an image provider, the vectoriser and Chromium,
   * so it comes from here for the same reason `drawPreview` does. See `draw-underlay.ts`.
   */
  drawUnderlay?: (prompt: string) => Promise<{ png: Uint8Array; inkBox: number[] } | undefined>;
  /**
   * The same thing for the figure lane: the beat's colour picture, drawn at the box it
   * will really occupy, so the marks are composed against what the viewer will see.
   *
   * A figure is never traced, so unlike an underlay there is no ink to measure and
   * nothing to hand back but the board itself. See `openDrawUnderlay`'s `figure`.
   */
  drawFigure?: (
    prompt: string,
    box: { x: number; y: number; w: number; h: number },
  ) => Promise<Uint8Array | undefined>;
  onProgress?: OnProgress;
  force?: boolean;
  /**
   * Where the stage records something it did worse than it should have — `OnProblem`
   * in `@inkcast/core`. The run collects these and the gate stage (plan 3.1) writes
   * them into `qc.json`, which is what makes a degradation outlive its log line.
   */
  onProblem?: (problem: string) => void;
  /**
   * Where the stage records a billable call it made — `ModelSpend` in `@inkcast/core`.
   * The drawing author and its critic run inside this stage, and until they reported
   * through here the expensive half of a keyed run appeared in no total (plan 3.5).
   */
  onSpend?: (spend: ModelSpend) => void;
  /**
   * Where the stage says which author **turned out** to write the lesson.
   *
   * `resolveLessonAdapter` below answers a different question — which adapter would run in
   * this environment — and the two part company exactly where the money is: a key that is
   * set but out of credit resolves to `anthropic`, the request comes back 402, and the
   * derived author writes the lesson. Everything downstream reported Claude and a
   * Claude-sized bill for a lesson Claude never saw (`projects/qc53-doc`).
   */
  onAuthor?: (author: 'anthropic' | 'heuristic') => void;
};

export type CompileStageOptions = FormatOptions & {
  title?: string;
  /**
   * What the board does between beats — `accumulate` (the default) or `wipe`.
   *
   * On this bag and not on `FormatOptions` above, mirroring the planner's own split:
   * `FormatOptions` is shared with the lesson stage, which composes no board and would
   * take the option and drop it. `compileLesson` is the one stage that can honour it.
   */
  board?: BoardMode;
  onProgress?: OnProgress;
  force?: boolean;
  /**
   * Where the compiler records something the format cost this lesson — `OnProblem` in
   * `@inkcast/core`, same channel and same destination as the lesson stage's.
   *
   * It exists for `adaptLesson`'s cuts (plan 5.3; audit S1-c). Trimming a beat out of an
   * argument to fit a runtime is the most consequential thing the compiler does, and it
   * was a `log.debug` — so a film that lost its misconception to a 60-second budget could
   * not say so an hour later. Now it can, in `qc.json`.
   */
  onProblem?: (problem: string) => void;
};

export type PlanOptions = {
  title?: string;
  meta?: Partial<StoryboardMeta>;
  onProgress?: OnProgress;
  force?: boolean;
} & Record<string, unknown>;

export type StageOpts = {
  onProgress?: OnProgress;
  force?: boolean;
  /** Quality-gate posture; each stage documents what it promotes. See `@inkcast/core`. */
  gates?: 'strict' | 'degrade';
} & Record<string, unknown>;

/** The subset of `Preset` the pipeline reads. */
export type PresetShape = {
  name: PresetName;
  aspect: StoryboardMeta['aspect'];
  maxSeconds: number;
  wordsPerSecond: number;
  vertical: boolean;
  maxBeats: number;
};

type PlannerModule = {
  ingest(input: IngestInput): Promise<SourceDoc>;
  plan(doc: SourceDoc, opts: PlanOptions): Promise<unknown>;
};

/**
 * The lesson + storyboard half of `@inkcast/planner`.
 *
 * The pipeline drives `teachLesson` and `compileLesson` separately rather than
 * calling `plan()`, because they are two stages now: the lesson is a first-class
 * artefact that gets persisted, inspected, hand-edited and cached on its own key,
 * and the compile step has to be re-runnable against an edited `lesson.json`
 * without re-authoring anything.
 */
type LessonStageModule = {
  teachLesson(input: SourceDoc | string, opts: LessonStageOptions): Promise<Lesson>;
  compileLesson(lesson: Lesson, opts: CompileStageOptions): unknown;
  resolvePreset(opts: {
    preset?: PresetName;
    aspect?: StoryboardMeta['aspect'];
    maxSeconds?: number;
    wordsPerSecond?: number;
    /** The engine that will speak — the length estimate is per provider. */
    voiceProvider?: string;
  }): PresetShape;
  resolveLessonAdapter(opts: LessonStageOptions): 'anthropic' | 'heuristic';
  readLessonFile(file: string): Promise<Lesson>;
  parseLesson(input: unknown): Lesson;
  saveLesson(dir: string, lesson: Lesson): Promise<string>;
  loadLesson(dir: string): Promise<Lesson>;
  /**
   * Every drawing in a finished lesson that still has something measurably wrong with
   * it, one line each (plan 3.4). Optional and read defensively — see `versionOf`.
   */
  lessonDrawingDefects?: unknown;
  /**
   * The cut-payload lines out of a stage's problem list (plan 5.1). Optional and read
   * defensively — see `versionOf` — and the planner owns it because the planner owns the
   * sentence it matches. See `misconceptionIsPayload` in `planner/src/presets.ts`.
   */
  misconceptionCutProblems?: unknown;
  /** Version constants, read defensively — see `versionOf`. */
  LESSON_VERSION?: unknown;
  COMPILER_VERSION?: unknown;
  PLANNER_VERSION?: unknown;
};

/**
 * What the voice stage resolved to, mirrored from `@inkcast/voice`'s `ResolvedVoice`.
 *
 * Mirrored rather than imported for the reason at the top of this file, and the shape
 * is deliberately loose about *which* provider — this file must not grow an opinion
 * about the voice package's union of ids.
 */
export type ResolvedVoice = {
  /** The provider that actually spoke, or the one that resolved when nothing did. */
  provider: string;
  label: string;
  /** The provider-native voice that actually spoke. */
  voice: string;
  /**
   * The voice that was resolved and then refused, when `voice` is a substitute.
   *
   * Mirrors `ResolvedVoice.substitutedFrom` in `@inkcast/voice`. Absent on ordinary
   * runs; present when a plan gate forced the adapter to speak with a different
   * voice than the one the record would otherwise have named.
   */
  substitutedFrom?: string;
  /** The engine, when the provider names one. */
  model?: string;
  /** Characters synthesised per provider this run. Empty when everything was cached. */
  charsByProvider: Partial<Record<string, number>>;
  /** The engine each of those providers was running — what the bill has to be priced at. */
  modelByProvider: Partial<Record<string, string>>;
  /** True when at least one character was actually synthesised. */
  spoke: boolean;
  /** Fallbacks, in the `string[]` shape `LessonSummary.problems` uses. */
  problems: string[];
};

/**
 * `narrate` returns the storyboard *and* what spoke.
 *
 * Typed here rather than left as `Promise<unknown>` because the pipeline's only check
 * on the storyboard half is `parseStoryboard`, which would have gone on accepting the
 * new wrapper object and thrown at runtime on a shape it cannot parse. The compiler is
 * the thing that has to notice a call site that was not updated.
 */
type VoiceModule = {
  narrate(
    sb: Storyboard,
    dir: string,
    opts?: StageOpts,
  ): Promise<{ storyboard: unknown; voice: ResolvedVoice }>;
};

type VisualsModule = {
  resolveVisuals(sb: Storyboard, dir: string, opts?: StageOpts): Promise<Storyboard>;
};

/**
 * The image lane, for the hybrid drawing lane's underlay (`draw-underlay.ts`).
 *
 * Separate from `VisualsModule` because it is loaded for a different reason: not to resolve
 * a storyboard, but to generate one picture and measure where its ink is, before any
 * storyboard exists.
 */
type ImageModule = {
  illustrationRaster(args: {
    id: string;
    prompt: string;
    dir: string;
    seed?: number;
    /** `form` (line art, to be traced) or `figure` (a colour teaching picture). */
    kind?: 'form' | 'figure';
    /** Width over height of the box this raster will fill. Defaults to square. */
    aspect?: number;
    /** Which cost lane its provider calls are filed under. See the visuals package. */
    lane?: string;
    /** Where a real provider call is billed, one entry per call. */
    onSpend?: OnSpend;
  }): Promise<
    | {
        png: Buffer;
        /** True when nothing was generated — the picture came from a cache and is free. */
        cached?: boolean;
        /** The provider that drew it, for the cost line (plan 3.5). */
        provider?: string;
      }
    | undefined
  >;
  tracedInkBox(png: Buffer): Promise<{ x: number; y: number; w: number; h: number } | undefined>;
  /** Where a raster's `<image>` goes inside the box the board reserved for it. */
  figureImageRect(
    box: { w: number; h: number },
    size: { w: number; h: number },
  ): { x: number; y: number; w: number; h: number };
};

/** A still session, as `@inkcast/render` offers it. See `render/src/still.ts`. */
export type StillSession = {
  capture(sb: Storyboard, dir: string, opts?: { t?: number }): Promise<Uint8Array>;
  close(): Promise<void>;
};

/**
 * The quality gate (plan 3.1), which lives in `@inkcast/render`.
 *
 * Two stages out of one package, like `ingest`/`lesson`/`storyboard` out of the
 * planner, and for the same kind of reason: the checks are arithmetic over the
 * renderer's own compiled geometry, and a second implementation of them anywhere else
 * would be a second truth about what the board looks like — the A-4 defect plan 2.1
 * exists to have deleted. Loading the package is cheap; it is `launchChromium` that
 * costs, and the gate never calls it.
 */
type CheckModule = {
  check(
    sb: Storyboard,
    dir: string,
    opts?: {
      gates?: 'strict' | 'degrade';
      inherited?: { id: string; findings: string[]; severity?: 'fail' | 'warn'; note?: string }[];
      /** Tier 2's keyed half — see `frame-vision.ts`. Absent means it is skipped. */
      vision?: VisionPass;
    },
  ): Promise<QcReport>;
};

type RenderModule = {
  render(
    sb: Storyboard,
    dir: string,
    opts?: StageOpts,
  ): Promise<{ videoPath: string; problems?: string[] }>;
  /** One frame without an encode. `undefined` when Chromium is not installed. */
  openStills(): Promise<StillSession | undefined>;
  /** `--emit-plan`: write the compiled timeline to `<dir>/plan.json` (plan 7.2). */
  emitPlan(sb: Storyboard, dir: string): Promise<string>;
};

/**
 * The part of the drawing lane the pipeline drives directly: marks into elements.
 *
 * Needed because the pipeline is what owns the renderer, and the drawing critic's preview
 * has to compile a drawing the same way the compiler will (`planner/src/drawing.ts`) or it
 * would be showing the model a picture the film is not going to draw.
 */
type DrawingModule = {
  buildDrawing(
    marks: unknown[],
    ctx: {
      id: string;
      box: { x: number; y: number; w: number; h: number };
      /** Fit the whole authoring canvas rather than the marks' own bounds. */
      underlay?: boolean;
    },
  ): Element[];
};

/** Where a hybrid drawing's generated picture goes on the canvas. See `planner/underlay.ts`. */
type UnderlayModule = {
  underlayAsset(prompt: string): { id: string; prompt: string };
  underlayInkBox(ink: { w: number; h: number }): { x: number; y: number; w: number; h: number };
  assetSeed(id: string): number;
};

type StagePackage = {
  readonly name: string;
  readonly load: () => Promise<unknown>;
};

const PLANNER: StagePackage = {
  name: '@inkcast/planner',
  load: () => import('@inkcast/planner'),
};

const PACKAGES = {
  ingest: PLANNER,
  lesson: PLANNER,
  storyboard: PLANNER,
  voice: { name: '@inkcast/voice', load: () => import('@inkcast/voice') },
  visuals: { name: '@inkcast/visuals', load: () => import('@inkcast/visuals') },
  check: { name: '@inkcast/render', load: () => import('@inkcast/render') },
  render: { name: '@inkcast/render', load: () => import('@inkcast/render') },
} as const satisfies Record<StageName, StagePackage>;

const loaded = new Map<string, Record<string, unknown>>();

async function load(stage: StageName, fns: string[]): Promise<Record<string, unknown>> {
  const pkg: StagePackage = PACKAGES[stage];
  const spec = pkg.name;
  let mod = loaded.get(spec);
  if (!mod) {
    try {
      mod = (await pkg.load()) as Record<string, unknown>;
    } catch (cause) {
      throw new StageError(
        stage,
        `cannot load ${spec}. Run \`pnpm install\` at the repo root, then retry.`,
        { cause },
      );
    }
    loaded.set(spec, mod);
  }
  for (const fn of fns) {
    if (typeof mod[fn] !== 'function') {
      throw new StageError(stage, `${spec} does not export ${fn}() — the stage contract changed.`);
    }
  }
  return mod;
}

/** `stage` only decides which stage name a load failure is reported against. */
export async function loadPlanner(
  stage: 'ingest' | 'lesson' | 'storyboard' = 'storyboard',
): Promise<PlannerModule> {
  return (await load(stage, ['ingest', 'plan'])) as unknown as PlannerModule;
}

export async function loadLessonStage(
  stage: 'lesson' | 'storyboard' = 'lesson',
): Promise<LessonStageModule> {
  return (await load(stage, [
    'teachLesson',
    'compileLesson',
    'resolvePreset',
    'resolveLessonAdapter',
    'readLessonFile',
    'parseLesson',
    'saveLesson',
    'loadLesson',
  ])) as unknown as LessonStageModule;
}

export async function loadVoice(): Promise<VoiceModule> {
  return (await load('voice', ['narrate'])) as unknown as VoiceModule;
}

export async function loadVisuals(): Promise<VisualsModule> {
  return (await load('visuals', ['resolveVisuals'])) as unknown as VisualsModule;
}

/** The image lane on its own, for generating and measuring a drawing's underlay. */
export async function loadImages(): Promise<ImageModule> {
  return (await load('visuals', [
    'illustrationRaster',
    'tracedInkBox',
    'figureImageRect',
  ])) as unknown as ImageModule;
}

/** The underlay's placement rules, which the planner owns so both sides cannot drift. */
export async function loadUnderlay(): Promise<UnderlayModule> {
  return (await load('lesson', [
    'underlayAsset',
    'underlayInkBox',
    'assetSeed',
  ])) as unknown as UnderlayModule;
}

/** The quality gate. Reported against its own stage, so a failure names `check`. */
export async function loadCheck(): Promise<CheckModule> {
  return (await load('check', ['check'])) as unknown as CheckModule;
}

export async function loadRender(): Promise<RenderModule> {
  return (await load('render', ['render', 'openStills', 'emitPlan'])) as unknown as RenderModule;
}

/** The drawing compiler, for the critic's preview. Reported against the lesson stage. */
export async function loadDrawing(): Promise<DrawingModule> {
  return (await load('lesson', ['buildDrawing'])) as unknown as DrawingModule;
}

/**
 * A stage package's own version constant, or 0 when it does not publish one.
 *
 * Read defensively on purpose: these numbers go into cache keys, and a package
 * that drops or renames its constant must degrade to "no extra invalidation"
 * rather than crash a run that would otherwise have worked.
 */
export function versionOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
