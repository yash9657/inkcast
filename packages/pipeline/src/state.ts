/**
 * `projects/<id>/pipeline.json` — the pipeline's own bookkeeping.
 *
 * `cache.json` (from @inkcast/core) answers "is this stage's work still valid?".
 * This file answers "what is this project, what did it cost, where is the mp4?"
 * so `inkcast list` and the studio's library can be rebuilt from disk alone,
 * which is what makes a finished video impossible to lose.
 */

import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { PROJECTS_ROOT, loadStoryboard, totalDuration, type Storyboard } from '@inkcast/core';
import type { CostReport } from './cost.js';
import { emptyCost } from './cost.js';
import type { StageName } from './progress.js';

export type SourceRef = { kind: 'text' | 'url' | 'file'; ref: string };

export type PipelineState = {
  projectId: string;
  title: string;
  /** Project-relative path of the finished video, when there is one. */
  videoPath?: string;
  /** Absent for projects whose storyboard was written by hand. */
  source?: SourceRef;
  createdAt: string;
  updatedAt: string;
  durationSec: number;
  timings: Partial<Record<StageName, number>>;
  skipped: StageName[];
  cost: CostReport;
  providers: Record<string, string>;
};

const FILE = 'pipeline.json';

export async function readState(dir: string): Promise<PipelineState | undefined> {
  try {
    const raw = await readFile(path.resolve(dir, FILE), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as PipelineState;
  } catch {
    /* a project without state is fine — it just has less to show */
  }
  return undefined;
}

export async function writeState(dir: string, state: PipelineState): Promise<void> {
  await writeFile(path.resolve(dir, FILE), `${JSON.stringify(state, null, 2)}\n`);
}

export type ProjectSummary = {
  id: string;
  dir: string;
  title: string;
  scenes: number;
  durationSec: number;
  /** Absolute path to the video, if it exists on disk right now. */
  videoPath?: string;
  updatedAt: string;
  cost: CostReport;
  source?: SourceRef;
};

/** Every project on disk, newest first. Tolerates half-finished directories. */
export async function listProjects(root: string = PROJECTS_ROOT): Promise<ProjectSummary[]> {
  const abs = path.resolve(root);
  let entries: string[];
  try {
    entries = (await readdir(abs, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }

  const out: ProjectSummary[] = [];
  for (const id of entries) {
    const dir = path.join(abs, id);
    const state = await readState(dir);
    let sb: Storyboard | undefined;
    try {
      sb = await loadStoryboard(dir);
    } catch {
      sb = undefined;
    }
    if (!sb && !state) continue;

    const video = await findVideo(dir, state?.videoPath);
    const updatedAt = state?.updatedAt ?? (await mtime(dir));
    out.push({
      id,
      dir,
      title: sb?.title ?? state?.title ?? id,
      scenes: sb?.scenes.length ?? 0,
      durationSec: sb ? totalDuration(sb) : (state?.durationSec ?? 0),
      ...(video ? { videoPath: video } : {}),
      updatedAt,
      cost: state?.cost ?? emptyCost(),
      ...(state?.source ? { source: state.source } : {}),
    });
  }
  out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return out;
}

/** The project's video: the recorded path if present, else the conventional one. */
export async function findVideo(dir: string, recorded?: string): Promise<string | undefined> {
  const candidates = [recorded, 'out.mp4'].filter((c): c is string => Boolean(c));
  for (const c of candidates) {
    const abs = path.isAbsolute(c) ? c : path.resolve(dir, c);
    if (existsSync(abs)) return abs;
  }
  return undefined;
}

async function mtime(dir: string): Promise<string> {
  try {
    return (await stat(dir)).mtime.toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}
