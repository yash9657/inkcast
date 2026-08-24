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

/**
 * What a project was made from.
 *
 * `topic` and `lesson` exist because a document is no longer the normal input: a
 * topic string ("gradient descent") goes straight into the lesson stage, and a
 * hand-authored `*.lesson.json` skips it altogether.
 */
export type SourceRef = { kind: 'text' | 'url' | 'file' | 'topic' | 'lesson'; ref: string };

/**
 * What the facts in this film rest on (plan item 5.1; audit S0-a).
 *
 * The audit's finding was not that bare-topic lessons are bad — they are the primary way
 * people use this — but that nothing on disk said which kind of film you were looking at.
 * "There is no source document. Teach it from first principles, from what you know to be
 * true" is what the lesson author is told for a bare topic, and every claim in the result
 * is then the model's recollection: unsourced, unverifiable by anything downstream, and
 * indistinguishable in the finished mp4 from a film built out of a document the user
 * supplied. The critique gate polices pedagogy, not facts, and it cannot police facts
 * without a source to police them against.
 *
 * So this records which it was. It is deliberately not a quality score and not a warning:
 * `parametric` is the normal, intended case, and the honest thing to do about it is to say
 * so where a reader will see it rather than to refuse the run.
 *
 *  - `document` — an ingested `SourceDoc` was in front of the author (`source.json` is on
 *    disk, and `LessonStep.sourceRef` can point back into it — plan 5.2).
 *  - `parametric` — a bare topic. The model's own knowledge is the only source there was.
 *  - `supplied` — a ready-made `*.lesson.json`. Whoever wrote it grounded it however they
 *    grounded it; this pipeline did not, and must not claim to have.
 *
 * Retrieval — a search lane that would turn a bare topic into a `document` run — is
 * deliberately not here: it is a design decision with its own doc
 * (`docs/PLAN-RETRIEVAL.md`), and shipping the honesty first is what stops that decision
 * blocking it.
 */
export type Grounding = 'document' | 'parametric' | 'supplied';

/** Enough of the lesson to show in a library listing without reading `lesson.json`. */
export type LessonSummary = {
  topic: string;
  objective: string;
  beats: number;
  /** `critiqueLesson()` output at the time of the run. Empty means it passed. */
  problems: string[];
  /**
   * Who actually wrote it — the observed author, not the configured one.
   *
   * Here rather than only in `providers.lesson` because `lesson.json` itself carries no
   * byline, so a run that reuses a cached lesson has no other way to answer the question.
   * Without it the second cast of a project re-derives the answer from the environment,
   * and the environment has changed: a lesson derived on a creditless run reports
   * `anthropic` the moment a working key is present, and the bill follows the label.
   *
   * Absent on files written before this was recorded. Absent is not `heuristic` — it means
   * nobody wrote it down, exactly as a missing `grounding` does.
   */
  author?: 'anthropic' | 'heuristic' | 'supplied';
};

/**
 * Which voice was actually used, as opposed to which one was configured.
 *
 * `providers.voice` is a display string the studio and older files on disk both
 * speak, and it cannot carry the distinction that matters: every keyed project in
 * `projects/` records `elevenlabs/af_heart` — a requested provider and a *voice* id
 * where a model belongs — and `cardiac8` was voiced entirely by the free local engine
 * after ElevenLabs demoted on its first request, and billed $0.4286 for it (the
 * reconstruction is in `providers.ts`'s `resolvedVoiceChoice`). This block is the
 * observed version, and `observed` is the field that says whether anything was spoken
 * at all.
 */
export type VoiceRecord = {
  /** The provider that spoke, or the one that resolved when nothing was synthesised. */
  provider: string;
  /** The engine, when the provider names one. */
  model?: string;
  /** The provider-native voice id in force. */
  voiceId: string;
  /** What the environment asked for, kept so a fallback is legible from the file alone. */
  requested: string;
  /** False when every scene was cached — nobody spoke, so nobody may be billed. */
  observed: boolean;
  /**
   * Characters synthesised per provider this run, and the evidence for the bill.
   *
   * Per provider because a run really can be part paid and part free: an exhausted
   * balance is discovered at the first request, so the scenes before it are billed and
   * the ones after it are not. One label could not describe that film.
   */
  chars: Record<string, number>;
  /**
   * Fallbacks **this run** hit, in the same `string[]` shape as `LessonSummary.problems`.
   *
   * Cleared, not inherited, on a run that synthesised nothing — for the same reason
   * `chars` is. A demotion is an event, and a project that was cached this time did not
   * have one; carrying the sentence forward made the CLI print "voice fell back to
   * kokoro (elevenlabs: quota_exceeded)" on every later run of a project that was no
   * longer in that state. What survives is the durable fact: `provider` beside
   * `requested`.
   */
  problems: string[];
};

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
  /** What the voice stage resolved to. Absent on files written before it was recorded. */
  voice?: VoiceRecord;
  /** Absent on the `via: 'document'` route, which has no lesson. */
  lesson?: LessonSummary;
  /**
   * What this film's facts rest on. See `Grounding`.
   *
   * Absent on files written before plan 5.1, and absent is not `parametric`: an older
   * project may well have been cast from a document, and the honest reading of a missing
   * field is "nobody recorded it", which is why nothing here defaults it.
   */
  grounding?: Grounding;
  /**
   * Which classes of picture this film asked for and could not be given (plan item
   * 6.1; audit S5-a). See `unservedLanes` in `@inkcast/core`.
   *
   * Names only — the beats and the quotes are in `qc.json`, under `lane-coverage`. This
   * is the summary a listing can show and the studio can turn into one sentence, and it
   * is durable in the way the finding is: the film on disk contains an approximated
   * benzene ring for as long as the file exists, however the run that made it went.
   *
   * Absent means the lesson asked for nothing this pipeline lacks — or that it was cast
   * before 6.1, which is the same silence the older fields carry and for the same
   * reason: nothing here invents an answer for a run that never asked the question.
   */
  lanes?: { unserved: string[] };
  /**
   * The quality-gate posture the run was made under. `degrade` is the fact that
   * matters: this film may carry defects its own pipeline detected and was told
   * to render anyway. Absent on files written before gates existed (equivalent
   * to `degrade` — nothing blocked back then).
   */
  gates?: 'strict' | 'degrade';
  /**
   * Gate messages the renderer carried through under `degrade` — board
   * assertions, the fill floor. This is what `--degrade` costs: the film shipped,
   * and the defects it shipped with are on the record. Absent on a clean board.
   */
  render?: { problems: string[] };
  /**
   * What the quality gate found (plan 3.1). The full report is `qc.json`; this is
   * the line a library listing needs — did it pass, and if not, what failed.
   *
   * Under `strict` a failing gate stops the run before this file is written, so a
   * recorded `ok: false` can only mean a `degrade` run: the film exists, and the
   * problems it exists with are named here rather than only in a log.
   */
  qc?: { ok: boolean; problems: string[] };
  /**
   * Length as measured against the length that was planned (plan item 4.3).
   *
   * `durationSec` above already says how long the film is; this says whether that
   * was what the pipeline *intended*, and — the half the audit (S6-d) actually asked
   * for — whether `DELIVERED_WPS`, the constant every length decision upstream is
   * made with, still describes the voice this film was spoken in. It was measured
   * once, from one film, and re-measuring it was a comment rather than a mechanism.
   *
   * Kept per run because that is the only way the question can be answered: one
   * film's rate is a data point, and the calibration is the trend across them.
   * Absent on files written before 4.3.
   */
  drift?: {
    measuredSec: number;
    spokenSec: number;
    words: number;
    wps: number;
    wpsDrift: number;
    expectedWps: number;
    budgetSec?: number;
    budgetRatio?: number;
  };
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
  /** What the project teaches, when it was built through the lesson stage. */
  lesson?: LessonSummary;
  /** What its facts rest on, when a run recorded it. See `Grounding`. */
  grounding?: Grounding;
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
      ...(state?.lesson ? { lesson: state.lesson } : {}),
      ...(state?.grounding ? { grounding: state.grounding } : {}),
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
