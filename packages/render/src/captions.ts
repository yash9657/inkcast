/**
 * Captions — `captions.srt` and `captions.vtt`, written beside `out.mp4`.
 *
 * This is the cheapest quality win in the repo and it was sitting on the floor: the
 * voice stage already measures where every word lands (`audio/scene-NNN.timing.json`,
 * and the same array copied onto `Scene.words`), because cue resolution needs word-exact
 * placement to start a stroke on the word it illustrates. A subtitle file is that same
 * data written in a different syntax. Nothing here calls a provider, nothing here needs a
 * key, and nothing here re-measures anything — if the captions disagree with the film it
 * is because the timings do, and then the film is out of sync too.
 *
 * Two decisions are worth defending, because the naive versions are both wrong:
 *
 * 1. **The text comes from the narration, the times come from the words.** The timing
 *    sidecar's `words` are normalised for the aligner — lowercased, punctuation stripped,
 *    "Here's" recorded as `heres` and "non-conducting" as `non` + `conducting`. Emitting
 *    those verbatim produces a caption track that reads like a transcript of a robot.
 *    So the display text is the authored `narration` (properly capitalised and punctuated)
 *    and the timing words are consumed in order underneath it, tolerating the 1:N and N:1
 *    mismatches the normalisation creates. Alignment is a forward-only cursor, which is
 *    what makes monotonicity structural rather than something we assert and hope for.
 *
 * 2. **A cue is a readable unit, not a word.** One word per cue is trivially "synced" and
 *    unwatchable. The convention every broadcaster converged on — ≤2 lines, ≤42
 *    characters a line, broken at clause boundaries — is what this packs to, and when a
 *    cue has to be cut because the next word will not fit, it is cut back to the last
 *    clause boundary rather than mid-phrase. Cues are built per scene and clamped to the
 *    scene's own span, so a caption can never survive the beat it belongs to; on a wiping
 *    board that would mean words hanging over a blank card.
 *
 * Burned-in captions are a separate, opt-in ffmpeg pass (`burnCaptions`). They are off by
 * default because burning re-encodes the video — the whole point of the segment-copy mux
 * in `ffmpeg.ts` is that the film is encoded exactly once — and because a 16:9 film played
 * with a real subtitle track wants no pixels burned into it. Vertical is the exception
 * worth paying for: TikTok/Reels/Shorts autoplay muted, so a 9:16 rendition with no
 * visible words is a silent film.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '@inkcast/core';
import type { Storyboard } from '@inkcast/core';
import { run } from './ffmpeg.js';
import type { RenderPlan } from './types.js';

const log = logger('render:captions');

/** A word as the voice stage measured it. Times are relative to its own scene clip. */
export type CaptionWord = { word: string; start: number; end: number };

/**
 * One beat's narration, already positioned on the film's timeline.
 *
 * `end` is the whole span the scene owns (narration plus `hold`), and it is the hard
 * clamp: a cue may linger into the deliberate silence — nothing else is being said, and
 * the extra half second is free reading time — but it may not cross into the next beat.
 */
export type CaptionScene = {
  /** Absolute second the narration starts. */
  start: number;
  /** Absolute second the scene stops owning the screen. */
  end: number;
  /** Absolute second the narration itself stops. */
  speechEnd: number;
  text: string;
  /** Scene-relative word timings, when the voice stage measured any. */
  words?: readonly CaptionWord[];
};

export type CaptionCue = {
  /** 1-based, in emission order — the SRT sequence number. */
  index: number;
  /** Absolute seconds. */
  start: number;
  end: number;
  /** One or two lines, already wrapped. */
  lines: string[];
  /** Which scene this cue came from. Kept so a clamp failure is debuggable. */
  scene: number;
};

export type CaptionLayout = {
  /** Characters per line. 42 is the broadcast convention. */
  maxChars?: number;
  /** Lines per cue. More than two covers the frame. */
  maxLines?: number;
  /** A cue is held at least this long even if its words are quicker. */
  minSec?: number;
  /**
   * A cue is cut once it has been up this long, so a slow sentence still turns over. The
   * cut is noticed on the word that trips it and honours clause boundaries, so a cue can
   * overshoot by a word or two rather than break somewhere unreadable.
   */
  maxSec?: number;
  /** Minimum blank between adjacent cues; keeps players from merging them. */
  gapSec?: number;
  /** A pause at least this long ends the cue — a breath is a punctuation mark. */
  splitGapSec?: number;
};

type Layout = Required<CaptionLayout>;

/**
 * Defaults are the BBC/Netflix subtitle convention, not invented here: two lines of 42,
 * a second on screen minimum so a short cue is readable at all, six seconds maximum so a
 * long slow sentence still turns over.
 */
const DEFAULT_LAYOUT: Layout = {
  maxChars: 42,
  maxLines: 2,
  minSec: 1.0,
  maxSec: 6.0,
  gapSec: 0.08,
  splitGapSec: 0.45,
};

/**
 * How full a cue must be before a clause boundary is allowed to end it early.
 *
 * Without a floor here every comma starts a new cue and the track flickers; with it, short
 * clauses ride along with their neighbours and the break lands where the sentence breathes.
 */
const EARLY_CUT_FILL = 0.55;

/** Fraction of the capacity a retro-break must keep, or it is not worth rewinding for. */
const REWIND_FILL = 0.45;

/* --------------------------------------------------------------- tokenising */

type Boundary = 0 | 1 | 2;

type Token = {
  /** As written, punctuation and capitals intact. */
  text: string;
  /** Letters and digits only — what the aligner's words normalise to. */
  key: string;
  start: number;
  end: number;
  /** 2 = sentence end, 1 = clause end, 0 = mid-clause. */
  boundary: Boundary;
};

const SENTENCE_END = /[.!?…][")'\]»]*$/u;
const CLAUSE_END = /[,;:—–)\]"»][")'\]»]*$/u;

function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function boundaryOf(text: string): Boundary {
  if (SENTENCE_END.test(text)) return 2;
  if (CLAUSE_END.test(text)) return 1;
  return 0;
}

/**
 * Walks the aligner's word list once, handing out spans for display tokens.
 *
 * The two mismatches this exists for are both real and both observed in
 * `projects/cardiac8f`: "non-conducting" is two aligner words, so a token may need to
 * swallow several; and "Here's" is the single word `heres`, so a token can also be a
 * *prefix* of what the aligner recorded — in which case the word's span is split by
 * character fraction and the remainder is left for the next token. When neither holds the
 * cursor resyncs by consuming exactly one word, because a caption two words adrift is
 * survivable and a caption that gives up is not.
 */
class WordCursor {
  private i = 0;
  /** Characters of `words[i]` already claimed by earlier tokens. */
  private used = 0;

  constructor(private readonly words: readonly CaptionWord[]) {}

  get exhausted(): boolean {
    return this.i >= this.words.length;
  }

  take(key: string): { start: number; end: number } | null {
    if (key === '') return null;
    let remaining = key;
    let start: number | null = null;
    let end: number | null = null;

    while (remaining !== '' && this.i < this.words.length) {
      const w = this.words[this.i] as CaptionWord;
      const norm = normalizeKey(w.word);
      const rest = norm.slice(this.used);
      if (rest === '') {
        this.i += 1;
        this.used = 0;
        continue;
      }
      const span = Math.max(0, w.end - w.start);
      const at = (chars: number): number =>
        norm.length > 0 ? w.start + (span * chars) / norm.length : w.start;
      if (start === null) start = at(this.used);

      if (remaining.startsWith(rest)) {
        // The rest of this aligner word belongs to this token; move on.
        remaining = remaining.slice(rest.length);
        end = w.end;
        this.i += 1;
        this.used = 0;
      } else if (rest.startsWith(remaining)) {
        // This aligner word covers the token and keeps going ("heres" for "Here's" is
        // the whole word; a run-together pair is not).
        this.used += remaining.length;
        end = at(this.used);
        remaining = '';
      } else {
        // Drifted. Take one word for one token and carry on rather than abandoning
        // the rest of the scene.
        end = w.end;
        this.i += 1;
        this.used = 0;
        remaining = '';
      }
    }

    if (start === null || end === null) return null;
    return { start, end: Math.max(end, start) };
  }
}

/**
 * True when a word list is usable. The local aligner returns every word at `0 → 0` when
 * it cannot find the speech (`voice/src/align.ts`), and those timings would pile every
 * caption in the film onto the first frame — worse than having none.
 */
function usableWords(words: readonly CaptionWord[] | undefined): words is readonly CaptionWord[] {
  if (!words || words.length === 0) return false;
  const last = words[words.length - 1] as CaptionWord;
  return last.end > 0 && words.every((w) => Number.isFinite(w.start) && Number.isFinite(w.end));
}

/**
 * Tokens with absolute times.
 *
 * With no usable word timings the scene's span is shared out by character count — the
 * same approximation the planner makes for an un-voiced storyboard. It is visibly worse
 * than measured words and much better than nothing, and it never lies about which beat
 * a line belongs to.
 */
function tokensOf(scene: CaptionScene): Token[] {
  const raw = scene.text.split(/\s+/u).filter((t) => t !== '');
  if (raw.length === 0) return [];
  const speech = Math.max(0, scene.speechEnd - scene.start);

  if (!usableWords(scene.words)) {
    const total = raw.reduce((n, t) => n + t.length + 1, 0);
    let at = scene.start;
    return raw.map((text) => {
      const share = total > 0 ? (speech * (text.length + 1)) / total : 0;
      const tok: Token = {
        text,
        key: normalizeKey(text),
        start: at,
        end: at + share,
        boundary: boundaryOf(text),
      };
      at += share;
      return tok;
    });
  }

  const cursor = new WordCursor(scene.words);
  const out: Token[] = [];
  let cursorEnd = scene.start;
  for (const text of raw) {
    const span = cursor.take(normalizeKey(text));
    const start = span ? scene.start + span.start : cursorEnd;
    const end = span ? scene.start + span.end : cursorEnd;
    // Forward-only: a drifted alignment must never hand back a time that goes backwards.
    const s = Math.max(start, cursorEnd);
    const e = Math.max(end, s);
    out.push({ text, key: normalizeKey(text), start: s, end: e, boundary: boundaryOf(text) });
    cursorEnd = e;
  }
  return out;
}

/* ------------------------------------------------------------------ wrapping */

/** Greedy fill, then a balanced re-split when it lands on exactly two lines. */
function wrapLines(words: readonly string[], max: number, maxLines: number): string[] | null {
  if (words.length === 0) return null;
  const joined = words.join(' ');
  if (joined.length <= max) return [joined];
  if (maxLines < 2) return null;

  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const cand = cur === '' ? w : `${cur} ${w}`;
    if (cand.length <= max || cur === '') cur = cand;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur !== '') lines.push(cur);
  if (lines.length > maxLines) return null;
  // A single word longer than the line budget is allowed to overflow: splitting a word
  // across lines is the one thing a caption may never do.
  if (lines.some((l) => l.length > max && l.includes(' '))) return null;

  if (lines.length !== 2) return lines;

  // Balance the two lines, but prefer a break where the sentence itself breaks. Greedy
  // fill alone produced "You are on a hillside in thick / fog. You want the valley floor."
  // on projects/final-916 — a line ending on "thick" when "fog." was one word later and
  // both halves still fit. The bonuses are how much imbalance a boundary is worth in
  // characters; a wildly lopsided break loses to a tidy one even at a full stop.
  const SENTENCE_BONUS = 18;
  const CLAUSE_BONUS = 12;
  let best: [string, string] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    const aOk = a.length <= max || !a.includes(' ');
    const bOk = b.length <= max || !b.includes(' ');
    if (!aOk || !bOk) continue;
    const boundary = boundaryOf(words[i - 1] as string);
    const bonus = boundary === 2 ? SENTENCE_BONUS : boundary === 1 ? CLAUSE_BONUS : 0;
    const score = Math.abs(a.length - b.length) - bonus;
    if (score < bestScore) {
      bestScore = score;
      best = [a, b];
    }
  }
  return best ? [best[0], best[1]] : lines;
}

function fits(words: readonly string[], layout: Layout): boolean {
  return wrapLines(words, layout.maxChars, layout.maxLines) !== null;
}

/* ------------------------------------------------------------------- packing */

type Group = { tokens: Token[]; scene: number };

/**
 * Pack one scene's tokens into cue-sized groups.
 *
 * Four things end a group: a sentence or clause boundary with the cue already fuller than
 * `EARLY_CUT_FILL`; a silence longer than `splitGapSec`, which is how the film's own
 * pauses become the caption's punctuation; the next word not fitting; and the cue having
 * been up for `maxSec`, so a slow sentence still turns over.
 *
 * The last two are *involuntary* closes and both go through `flushKeepingClause`, because
 * the first version of this only rewound on the capacity close and the duration cap then
 * produced "The doorway holds the signal for one hundred. Ninety is less than a" / "hundred,
 * so the top finishes…" on `projects/cardiac8f`. A break inside "less than a hundred" is
 * exactly the kind of thing a reader trips over, and the sentence boundary it should have
 * used was four words back.
 */
function packScene(tokens: readonly Token[], scene: number, layout: Layout): Group[] {
  const capacity = layout.maxChars * layout.maxLines;
  const groups: Group[] = [];
  let cur: Token[] = [];

  const flush = (): void => {
    if (cur.length > 0) groups.push({ tokens: cur, scene });
    cur = [];
  };

  /** End the cue at the last clause boundary that still leaves it reasonably full. */
  const flushKeepingClause = (): void => {
    for (let j = cur.length - 2; j >= 0; j--) {
      if ((cur[j] as Token).boundary === 0) continue;
      const kept = cur.slice(0, j + 1);
      if (kept.map((t) => t.text).join(' ').length < capacity * REWIND_FILL) break;
      groups.push({ tokens: kept, scene });
      cur = cur.slice(j + 1);
      return;
    }
    flush();
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i] as Token;
    const candidate = [...cur, tok];
    if (
      cur.length > 0 &&
      !fits(
        candidate.map((t) => t.text),
        layout,
      )
    ) {
      flushKeepingClause();
      // The rewind hands back a remainder, and the remainder plus this word can still
      // overflow. Then the boundary is not affordable and the plain cut stands.
      if (
        cur.length > 0 &&
        !fits(
          [...cur, tok].map((t) => t.text),
          layout,
        )
      )
        flush();
    }
    cur.push(tok);

    const chars = cur.map((t) => t.text).join(' ').length;
    const first = cur[0] as Token;
    const gapNext = i + 1 < tokens.length ? (tokens[i + 1] as Token).start - tok.end : 0;
    const longEnough = chars >= capacity * EARLY_CUT_FILL;
    if (
      (tok.boundary === 2 && longEnough) ||
      (tok.boundary === 1 && chars >= capacity * 0.8) ||
      gapNext >= layout.splitGapSec
    ) {
      flush();
    } else if (tok.end - first.start >= layout.maxSec) {
      flushKeepingClause();
    }
  }
  flush();
  return groups;
}

/**
 * Cues for a whole film.
 *
 * Times are only ever pulled forward here, never pushed back: a cue is held longer when
 * the next one is not waiting, and clamped hard by its own scene. That combination is
 * what makes the two properties players actually care about — monotone starts and zero
 * overlap — provable rather than probable.
 */
export function buildCues(
  scenes: readonly CaptionScene[],
  layout: CaptionLayout = {},
): CaptionCue[] {
  const lay: Layout = { ...DEFAULT_LAYOUT, ...layout };
  const groups: Array<Group & { bound: number }> = [];
  scenes.forEach((scene, i) => {
    for (const g of packScene(tokensOf(scene), i, lay)) {
      groups.push({ ...g, bound: scene.end });
    }
  });

  const cues: CaptionCue[] = [];
  groups.forEach((g, gi) => {
    const lines = wrapLines(
      g.tokens.map((t) => t.text),
      lay.maxChars,
      lay.maxLines,
    ) ??
      // Unwrappable only when a lone word is longer than the whole cue budget; show it.
      [g.tokens.map((t) => t.text).join(' ')];
    const first = g.tokens[0] as Token;
    const last = g.tokens[g.tokens.length - 1] as Token;
    const prev = cues[cues.length - 1];
    const start = Math.max(first.start, prev ? prev.end + lay.gapSec : 0);
    const nextStart = groups[gi + 1]?.tokens[0]?.start ?? Number.POSITIVE_INFINITY;
    const ceiling = Math.min(g.bound, nextStart - lay.gapSec);
    const end = Math.min(Math.max(last.end, start + lay.minSec), Math.max(start, ceiling));
    if (end - start < 0.05) return;
    cues.push({ index: cues.length + 1, start, end, lines, scene: g.scene });
  });
  return cues;
}

/* ------------------------------------------------------------- serialisation */

function stamp(sec: number, msSep: ',' | '.'): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const rest = ms % 1000;
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}${msSep}${pad(rest, 3)}`;
}

export function toSrt(cues: readonly CaptionCue[]): string {
  return cues
    .map(
      (c) => `${c.index}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${c.lines.join('\n')}\n`,
    )
    .join('\n');
}

/** WebVTT is HTML-ish, so the three characters that would become markup are escaped. */
function vttText(line: string): string {
  return line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function toVtt(cues: readonly CaptionCue[]): string {
  const body = cues
    .map(
      (c) =>
        `${c.index}\n${stamp(c.start, '.')} --> ${stamp(c.end, '.')}\n${c.lines
          .map(vttText)
          .join('\n')}\n`,
    )
    .join('\n');
  return `WEBVTT\n\n${body}`;
}

/* -------------------------------------------------------- reading the timings */

type TimingSidecar = { words?: CaptionWord[] };

/**
 * Word timings for a scene, preferring the storyboard and falling back to the sidecar.
 *
 * `Scene.words` is the same array the voice stage wrote next to the clip, but a
 * storyboard authored before that field existed — or one hand-edited — will not have it,
 * and `audio/scene-NNN.timing.json` still will. Neither is required: with no timings at
 * all the cues fall back to proportional spacing (see `tokensOf`).
 */
async function sceneWords(
  sb: Storyboard,
  dir: string,
  index: number,
): Promise<readonly CaptionWord[] | undefined> {
  const inline = sb.scenes[index]?.words;
  if (usableWords(inline)) return inline;
  const audio = sb.scenes[index]?.audioPath;
  const rel = audio
    ? audio.replace(/\.wav$/i, '.timing.json')
    : `audio/scene-${String(index).padStart(3, '0')}.timing.json`;
  try {
    const parsed = JSON.parse(await readFile(path.resolve(dir, rel), 'utf8')) as TimingSidecar;
    return usableWords(parsed.words) ? parsed.words : undefined;
  } catch {
    return undefined;
  }
}

/** The film's narration, scene by scene, on the plan's absolute timeline. */
export async function captionScenes(
  sb: Storyboard,
  plan: RenderPlan,
  dir: string,
): Promise<CaptionScene[]> {
  const out: CaptionScene[] = [];
  for (let i = 0; i < plan.scenes.length; i++) {
    const ps = plan.scenes[i];
    const text = sb.scenes[i]?.narration ?? '';
    if (!ps || text.trim() === '') continue;
    const words = await sceneWords(sb, dir, i);
    out.push({
      start: ps.start,
      end: Math.min(ps.start + ps.dur, plan.duration),
      speechEnd: ps.start + (ps.speech > 0 ? ps.speech : ps.dur),
      text,
      ...(words ? { words } : {}),
    });
  }
  return out;
}

/* --------------------------------------------------------------- the emitter */

export type CaptionSettings = {
  srtName?: string;
  vttName?: string;
  /** Re-encode the video with the captions painted in. Off unless asked. */
  burnIn?: boolean;
  burnInName?: string;
  layout?: CaptionLayout;
  /** Encoder settings for the burn-in pass only; the caption files are free. */
  crf?: number;
  preset?: string;
};

/** What a render's captions ended up as. Paths are absolute. */
export type CaptionResult = {
  srtPath: string;
  vttPath: string;
  cues: number;
  /** Present only when a burn-in pass ran or was already up to date. */
  burnedInPath?: string;
  /** The exact ffmpeg invocation that burned them, for the record. */
  burnCommand?: string;
};

/**
 * Resolve the settings for this render.
 *
 * The typed option is authoritative; the environment is the escape hatch for the paths
 * that cannot pass one yet (the pipeline reaches the renderer through a structural type
 * in `pipeline/src/stages.ts`, which does not carry this field). `INKCAST_CAPTIONS=off`
 * suppresses the files entirely; `INKCAST_BURN_CAPTIONS=1` asks for the vertical burn.
 */
export function captionSettings(opts?: {
  captions?: false | CaptionSettings;
}): CaptionSettings | null {
  const explicit = opts?.captions;
  if (explicit === false) return null;
  if ((process.env.INKCAST_CAPTIONS ?? '').toLowerCase() === 'off') return null;
  const burnEnv = /^(1|true|yes|on)$/i.test(process.env.INKCAST_BURN_CAPTIONS ?? '');
  const base = explicit ?? {};
  return burnEnv && base.burnIn === undefined ? { ...base, burnIn: true } : base;
}

/**
 * Write `captions.srt` + `captions.vtt` into `dir`, and burn them in when asked.
 *
 * Called on both of `render()`'s exits, the cache hit included: the files are a pure
 * function of the storyboard and cost milliseconds, so a project rendered before captions
 * existed acquires them on its next `rerender` instead of staying half-finished forever.
 * Nothing here is allowed to fail a render — a film with no caption file is a smaller
 * problem than a film that did not encode — so the whole body is guarded and reports.
 */
export async function emitCaptions(
  sb: Storyboard,
  plan: RenderPlan,
  dir: string,
  opts?: { captions?: false | CaptionSettings; force?: boolean },
  videoName = 'out.mp4',
): Promise<CaptionResult | null> {
  const settings = captionSettings(opts);
  if (!settings) return null;
  try {
    const scenes = await captionScenes(sb, plan, dir);
    const cues = buildCues(scenes, settings.layout ?? {});
    if (cues.length === 0) {
      log.warn('no narration to caption — skipping captions.srt/.vtt');
      return null;
    }
    const srtName = settings.srtName ?? 'captions.srt';
    const vttName = settings.vttName ?? 'captions.vtt';
    const srtPath = path.resolve(dir, srtName);
    const vttPath = path.resolve(dir, vttName);
    await writeFile(srtPath, toSrt(cues), 'utf8');
    await writeFile(vttPath, toVtt(cues), 'utf8');
    const spoken = cues[cues.length - 1] as CaptionCue;
    log.info(`wrote ${srtName} + ${vttName} — ${cues.length} cues over ${spoken.end.toFixed(1)}s`);

    const result: CaptionResult = { srtPath, vttPath, cues: cues.length };
    if (settings.burnIn) {
      const burned = await burnCaptions({
        dir,
        video: videoName,
        srt: srtName,
        out: settings.burnInName ?? burnedName(videoName),
        frame: plan.frame,
        ...(settings.crf === undefined ? {} : { crf: settings.crf }),
        ...(settings.preset === undefined ? {} : { preset: settings.preset }),
        ...(opts?.force === undefined ? {} : { force: opts.force }),
      });
      if (burned) {
        result.burnedInPath = burned.path;
        result.burnCommand = burned.command;
      }
    }
    return result;
  } catch (err) {
    log.warn('captions could not be written', err);
    return null;
  }
}

/** `out.mp4` → `out.captioned.mp4`; the original is never overwritten. */
export function burnedName(videoName: string): string {
  const ext = path.extname(videoName);
  return `${videoName.slice(0, videoName.length - ext.length)}.captioned${ext || '.mp4'}`;
}

/* ------------------------------------------------------------- burning them in */

export type BurnOptions = {
  /** Project directory. ffmpeg runs here, so every path below is a bare filename. */
  dir: string;
  video: string;
  srt: string;
  out: string;
  frame: { w: number; h: number };
  crf?: number;
  preset?: string;
  /** Re-burn even when the existing file is newer than both inputs. */
  force?: boolean;
};

export type BurnResult = {
  path: string;
  /** Copy-pasteable, for STATUS and for anyone reproducing the pass. */
  command: string;
  cached: boolean;
};

/**
 * The subtitles filter needs its argument escaped twice over — once for the filter
 * parameter, once for the filtergraph — which is why `burnCaptions` runs ffmpeg with the
 * project directory as its cwd and passes a bare `captions.srt`. An absolute macOS path
 * is harmless; an absolute Windows path (`C:\…`) is a colon inside a filter argument, and
 * that has broken this filter for everyone who has ever typed it. Escaping is still
 * applied, because the caller may name the file.
 */
function escapeFilterArg(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/([:,'[\]])/g, '\\$1');
}

/**
 * The filter string, in the one form ffmpeg 8 actually accepts.
 *
 * Every tutorial writes `subtitles=file.srt:force_style='…'` with the filename as the
 * implicit first option, and on ffmpeg 8.1.2 that is a parse error — measured, not
 * guessed: "No option name near 'captions.srt:force_style=Alignment=2,…'". Once the
 * quoted `force_style` value is in play the parser will not take the positional filename,
 * so `filename=` has to be spelled out. With that one word added the same graph parses.
 */
function subtitlesFilter(srt: string, frame: { w: number; h: number }): string {
  return `subtitles=filename=${escapeFilterArg(srt)}:force_style='${forceStyle(frame)}'`;
}

let filterProbe: boolean | undefined;

/**
 * Whether this ffmpeg can render subtitles at all.
 *
 * It is asked because a build without libass does not fail in any way a user can act on:
 * the filtergraph reports `No such filter: 'subtitles'` and the render looks broken. The
 * ffmpeg on the machine this was written on — Homebrew 8.1.2, `--enable-gpl --enable-libx264
 * …` and nothing else — is exactly that build, with neither libass nor libfreetype, so
 * neither `subtitles` nor `drawtext` exists. Debian's ffmpeg (what the launch container
 * installs) and Homebrew's default bottle both carry libass.
 */
async function subtitlesFilterAvailable(): Promise<boolean> {
  if (filterProbe === undefined) {
    const r = await run('ffmpeg', ['-hide_banner', '-filters']);
    filterProbe = r.code === 0 && /^\s*\S+\s+subtitles\s/m.test(r.stdout);
  }
  return filterProbe;
}

/**
 * Style for burned captions, derived from the frame so 9:16 and 16:9 both land right.
 *
 * `subtitles` converts SRT to ASS on an ASS canvas whose height is the video's, so a font
 * size quoted as a fraction of the frame height is stable across aspects and resolutions.
 * `BorderStyle=3` is the opaque box behind the text rather than a per-glyph outline: on a
 * whiteboard film the background is white, and white text with a thin outline over white
 * paper is unreadable — measured by burning both and looking at the frame. The box is the
 * board's ink colour at ~73% so the paper still shows through.
 */
function forceStyle(frame: { w: number; h: number }): string {
  const size = Math.max(16, Math.round(frame.h * 0.038));
  const marginV = Math.max(24, Math.round(frame.h * 0.06));
  const marginH = Math.max(24, Math.round(frame.w * 0.06));
  return [
    'Alignment=2',
    `FontSize=${size}`,
    'PrimaryColour=&H00FFFFFF',
    'OutlineColour=&H40000000',
    'BackColour=&H40000000',
    'BorderStyle=3',
    'Outline=3',
    'Shadow=0',
    'Bold=1',
    `MarginV=${marginV}`,
    `MarginL=${marginH}`,
    `MarginR=${marginH}`,
  ].join(',');
}

/** Shell-quoted rendering of the invocation, purely so it can be pasted back in. */
function quoted(cmd: string, args: readonly string[]): string {
  return [cmd, ...args]
    .map((a) => (/[^\w./=:-]/.test(a) ? `'${a.replace(/'/g, "'\\''")}'` : a))
    .join(' ');
}

/**
 * Re-encode `video` with `srt` painted into the pixels. Audio is stream-copied.
 *
 * Returns `null` and warns on failure rather than throwing: the un-burned film and its
 * sidecar caption files are already on disk and are the deliverable. Nothing about a
 * cosmetic second rendition is worth losing a completed render over.
 */
export async function burnCaptions(o: BurnOptions): Promise<BurnResult | null> {
  const videoAbs = path.resolve(o.dir, o.video);
  const srtAbs = path.resolve(o.dir, o.srt);
  const outAbs = path.resolve(o.dir, o.out);
  if (!existsSync(videoAbs) || !existsSync(srtAbs)) {
    log.warn(`cannot burn captions: ${existsSync(videoAbs) ? o.srt : o.video} is missing`);
    return null;
  }
  if (!(await subtitlesFilterAvailable())) {
    log.warn(
      'this ffmpeg has no `subtitles` filter (built without libass), so captions cannot be ' +
        'burned in. The sidecar captions.srt/.vtt are written and complete. Install an ffmpeg ' +
        'with libass — `brew install ffmpeg` (default bottle) or Debian/Ubuntu `apt install ffmpeg` — ' +
        'and re-run to burn them.',
    );
    return null;
  }

  const args = [
    '-y',
    '-v',
    'error',
    '-i',
    o.video,
    '-vf',
    subtitlesFilter(o.srt, o.frame),
    '-c:v',
    'libx264',
    '-preset',
    o.preset ?? 'medium',
    '-crf',
    String(o.crf ?? 20),
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'copy',
    '-movflags',
    '+faststart',
    o.out,
  ];
  const command = `cd ${o.dir} && ${quoted('ffmpeg', args)}`;

  if (!o.force && (await isNewer(outAbs, [videoAbs, srtAbs]))) {
    log.debug(`${o.out} is up to date — skipping the burn-in pass`);
    return { path: outAbs, command, cached: true };
  }

  const t0 = Date.now();
  const code = await new Promise<number>((resolve) => {
    const child = spawn('ffmpeg', args, { cwd: o.dir, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr?.on('data', (d: Buffer) => {
      err = (err + d.toString()).slice(-2000);
    });
    child.on('error', (e) => {
      log.warn(`could not start ffmpeg for the burn-in pass: ${e.message}`);
      resolve(-1);
    });
    child.on('close', (c) => {
      if (c !== 0 && err.trim() !== '') log.warn(`burn-in ffmpeg said: ${err.trim()}`);
      resolve(c ?? -1);
    });
  });
  if (code !== 0) {
    log.warn(`burn-in pass failed (${code}) — ${o.video} and the sidecar captions are intact`);
    return null;
  }
  log.info(`burned captions into ${o.out} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return { path: outAbs, command, cached: false };
}

/** True when `file` exists and is at least as new as everything in `inputs`. */
async function isNewer(file: string, inputs: readonly string[]): Promise<boolean> {
  try {
    const target = await stat(file);
    for (const i of inputs) {
      const s = await stat(i);
      if (s.mtimeMs > target.mtimeMs) return false;
    }
    return true;
  } catch {
    return false;
  }
}
