/**
 * Lazy loaders for the four stage packages.
 *
 * The signatures below are the ones fixed by `docs/CONTRACT.md`. They are
 * declared here rather than imported as types because the pipeline must be able
 * to start, print help, list projects and serve a preview even while a stage
 * package is still being installed — and because a missing package should
 * produce one actionable sentence, not a module-resolution stack trace.
 *
 * Each stage is reached through a **literal** `import()` inside a thunk. The
 * laziness is what matters — nothing pulls in Playwright or an ONNX runtime until
 * the stage that needs it actually runs — and a thunk gives that without hiding
 * the specifier. An earlier version held the specifiers in variables, which also
 * hid them from every bundler: the studio's Next build could not follow
 * `import(spec)`, so the four stage packages were left out of the server bundle
 * and every render died with a module-resolution error at request time. Keep
 * these literal.
 */

import type { OnProgress, Storyboard, StoryboardMeta } from '@inkcast/core';
import { StageError } from './errors.js';
import type { StageName } from './progress.js';

export type IngestInput = { text?: string; filePath?: string; url?: string };

/**
 * What `ingest` returns. The planner owns the real type; the pipeline only
 * needs it to be a JSON-serialisable object so it can be cached on disk, plus
 * an optional title to fall back on.
 */
export type SourceDoc = { title?: string; text?: string } & Record<string, unknown>;

export type PlanOptions = {
  title?: string;
  meta?: Partial<StoryboardMeta>;
  onProgress?: OnProgress;
  force?: boolean;
} & Record<string, unknown>;

export type StageOpts = { onProgress?: OnProgress; force?: boolean } & Record<string, unknown>;

type PlannerModule = {
  ingest(input: IngestInput): Promise<SourceDoc>;
  plan(doc: SourceDoc, opts: PlanOptions): Promise<unknown>;
};

type VoiceModule = {
  narrate(sb: Storyboard, dir: string, opts?: StageOpts): Promise<unknown>;
};

type VisualsModule = {
  resolveVisuals(sb: Storyboard, dir: string, opts?: StageOpts): Promise<unknown>;
};

type RenderModule = {
  render(sb: Storyboard, dir: string, opts?: StageOpts): Promise<{ videoPath: string }>;
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
  plan: PLANNER,
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
export async function loadPlanner(stage: 'ingest' | 'plan' = 'plan'): Promise<PlannerModule> {
  return (await load(stage, ['ingest', 'plan'])) as unknown as PlannerModule;
}

export async function loadVoice(): Promise<VoiceModule> {
  return (await load('voice', ['narrate'])) as unknown as VoiceModule;
}

export async function loadVisuals(): Promise<VisualsModule> {
  return (await load('visuals', ['resolveVisuals'])) as unknown as VisualsModule;
}

export async function loadRender(): Promise<RenderModule> {
  return (await load('render', ['render'])) as unknown as RenderModule;
}
