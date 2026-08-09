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
  OnProgress,
  Storyboard,
  StoryboardMeta,
} from '@inkcast/core';
import { StageError } from './errors.js';
import type { StageName } from './progress.js';

export type IngestInput = { text?: string; filePath?: string; url?: string };

/**
 * What `ingest` returns. The planner owns the real type; the pipeline only
 * needs it to be a JSON-serialisable object so it can be cached on disk, plus
 * an optional title to fall back on.
 */
export type SourceDoc = { title?: string; text?: string } & Record<string, unknown>;

/** Output format presets, mirrored from the planner so nothing imports it eagerly. */
export type PresetName = 'standard' | 'short' | 'square';

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
  onProgress?: OnProgress;
  force?: boolean;
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
};

export type PlanOptions = {
  title?: string;
  meta?: Partial<StoryboardMeta>;
  onProgress?: OnProgress;
  force?: boolean;
} & Record<string, unknown>;

export type StageOpts = { onProgress?: OnProgress; force?: boolean } & Record<string, unknown>;

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
  }): PresetShape;
  resolveLessonAdapter(opts: LessonStageOptions): 'anthropic' | 'heuristic';
  readLessonFile(file: string): Promise<Lesson>;
  parseLesson(input: unknown): Lesson;
  saveLesson(dir: string, lesson: Lesson): Promise<string>;
  loadLesson(dir: string): Promise<Lesson>;
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
  voice: string;
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
  }): Promise<{ png: Buffer } | undefined>;
  tracedInkBox(png: Buffer): Promise<{ x: number; y: number; w: number; h: number } | undefined>;
};

/** A still session, as `@inkcast/render` offers it. See `render/src/still.ts`. */
export type StillSession = {
  capture(sb: Storyboard, dir: string, opts?: { t?: number }): Promise<Uint8Array>;
  close(): Promise<void>;
};

type RenderModule = {
  render(sb: Storyboard, dir: string, opts?: StageOpts): Promise<{ videoPath: string }>;
  /** One frame without an encode. `undefined` when Chromium is not installed. */
  openStills(): Promise<StillSession | undefined>;
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
  return (await load('visuals', ['illustrationRaster', 'tracedInkBox'])) as unknown as ImageModule;
}

/** The underlay's placement rules, which the planner owns so both sides cannot drift. */
export async function loadUnderlay(): Promise<UnderlayModule> {
  return (await load('lesson', [
    'underlayAsset',
    'underlayInkBox',
    'assetSeed',
  ])) as unknown as UnderlayModule;
}

export async function loadRender(): Promise<RenderModule> {
  return (await load('render', ['render', 'openStills'])) as unknown as RenderModule;
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
