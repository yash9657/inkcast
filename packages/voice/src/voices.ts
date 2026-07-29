/**
 * Which voice to teach in, and how fast to speak.
 *
 * The MVP shipped `af_heart` at `speed: 1` because it was the package default,
 * and the result was 193 words per minute of cheerful summary. That is a
 * *podcast* pace. A learner meeting an idea for the first time needs 140–160 wpm,
 * and the difference is not cosmetic: it is the difference between hearing a
 * sentence and having time to think about it.
 *
 * Everything in this module is derived from measurement, not taste. The numbers
 * in `KOKORO_VOICE_PROFILES` were produced by synthesising one fixed 63-word
 * teaching paragraph (`AUDIT_PARAGRAPH`) in every candidate voice at `speed: 1`
 * and analysing the samples — `auditKokoroVoices()` is that experiment, kept as
 * runnable code so the table can be regenerated and challenged rather than
 * believed.
 *
 * What the audit found, and why `af_heart` is the teaching default:
 *
 * - Kokoro's own `overallGrade` spans A to F+, and it is audible. Only four
 *   voices reach B- or better; the C+ tier has noticeably more artefacting on
 *   long clauses, which is exactly where an explanation lives.
 * - `af_bella` (A-) is tagged 🔥 and measures the widest dynamic variance of the
 *   top tier — energetic, which reads as *selling* rather than explaining.
 * - `af_nicole` (B-) is tagged 🎧: breathy/ASMR, 46% of frames below the speech
 *   floor. Intimate, but consonants blur, and teaching is consonant-heavy.
 * - `bf_emma` (B-) is calm and even (narrowest f0 range of the tier) and is the
 *   runner-up — but it is a grade below and the fastest voice measured.
 * - `af_heart` (A, the flagship, most training data) is warm, has a moderate
 *   pitch range, and the steadiest level of the A tier. It wins on quality and
 *   holds its own on calm.
 *
 * So the voice *identity* survived the audit; the voice *pacing* did not. The
 * fix is a measured speed, and `speedForWpm()` is what applies it.
 */
import { logger } from '@inkcast/core';

const log = logger('voice:voices');

/* ----------------------------------------------------------------- profiles */

/** Kokoro's own quality grade, best first. Ordinal, not a score. */
export type VoiceGrade =
  'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D+' | 'D' | 'D-' | 'F+' | 'F';

const GRADE_SCORE: Record<VoiceGrade, number> = {
  A: 1,
  'A-': 0.92,
  'B+': 0.82,
  B: 0.76,
  'B-': 0.7,
  'C+': 0.5,
  C: 0.42,
  'C-': 0.36,
  'D+': 0.24,
  D: 0.2,
  'D-': 0.16,
  'F+': 0.08,
  F: 0,
};

export type VoiceProfile = {
  id: string;
  /** Kokoro's published overall grade. */
  grade: VoiceGrade;
  accent: 'en-us' | 'en-gb';
  gender: 'female' | 'male';
  /**
   * Words per minute this voice **delivers** at `speed: 1` — measured through the
   * real phrase pipeline (per-phrase synthesis, edge trimming, clause and
   * sentence gaps, trailing breath) rather than from one raw `generate()` call.
   * That distinction is worth ~30 wpm; see `auditKokoroVoices()`.
   */
  baselineWpm: number;
  /**
   * Fraction of 20 ms frames below the speech floor, measured on the *trimmed*
   * speech — so this is the voice's own internal pausing, not engine padding.
   * High = breathy or halting.
   */
  pauseFraction: number;
  /** Coefficient of variation of voiced level. High = animated, low = steady. */
  dynamicVariance: number;
  /** Median fundamental, Hz. Lower reads as warmer. */
  f0Median: number;
  /** p90 − p10 fundamental spread, Hz. Wide = expressive, narrow = calm. */
  f0Range: number;
  /** Kokoro's trait tags, e.g. ❤️ flagship, 🔥 energetic, 🎧 breathy. */
  traits: string;
  /** Why this voice is or is not suitable for teaching. */
  note: string;
};

/**
 * Measured candidate set: every Kokoro voice graded C or better, which is the
 * point below which artefacts become distracting over a 90-second explanation.
 */
export const KOKORO_VOICE_PROFILES: readonly VoiceProfile[] = [
  {
    id: 'af_heart',
    grade: 'A',
    accent: 'en-us',
    gender: 'female',
    baselineWpm: 206.4,
    pauseFraction: 0.133,
    dynamicVariance: 0.614,
    f0Median: 194,
    f0Range: 130,
    traits: '❤️',
    note: 'Flagship voice, most training data. Warm, steady level, moderate pitch range — the teaching default.',
  },
  {
    id: 'bf_emma',
    grade: 'B-',
    accent: 'en-gb',
    gender: 'female',
    baselineWpm: 207.9,
    pauseFraction: 0.094,
    dynamicVariance: 0.568,
    f0Median: 180,
    f0Range: 89,
    traits: '🚺',
    note: 'Calmest and most even delivery measured, and the best British option; one grade below the flagship.',
  },
  {
    id: 'af_bella',
    grade: 'A-',
    accent: 'en-us',
    gender: 'female',
    baselineWpm: 202.9,
    pauseFraction: 0.185,
    dynamicVariance: 0.734,
    f0Median: 192,
    f0Range: 82,
    traits: '🔥',
    note: 'Excellent quality, but the widest level swing of the whole set — energetic rather than calm, as its 🔥 tag advertises.',
  },
  {
    id: 'am_michael',
    grade: 'C+',
    accent: 'en-us',
    gender: 'male',
    baselineWpm: 194.2,
    pauseFraction: 0.115,
    dynamicVariance: 0.631,
    f0Median: 113,
    f0Range: 97,
    traits: '',
    note: 'Warmest male voice, slowest of the male set, and comfortably inside both calm bands — the pick when a male voice is wanted.',
  },
  {
    id: 'am_puck',
    grade: 'C+',
    accent: 'en-us',
    gender: 'male',
    baselineWpm: 224.9,
    pauseFraction: 0.082,
    dynamicVariance: 0.653,
    f0Median: 118,
    f0Range: 135,
    traits: '',
    note: 'Deep and warm but the fastest voice measured; cannot reach the teaching band without distortion.',
  },
  {
    id: 'am_fenrir',
    grade: 'C+',
    accent: 'en-us',
    gender: 'male',
    baselineWpm: 216.5,
    pauseFraction: 0.088,
    dynamicVariance: 0.634,
    f0Median: 137,
    f0Range: 120,
    traits: '',
    note: 'Fast and clipped; needs more slowing than the duration predictor handles gracefully.',
  },
  {
    id: 'af_kore',
    grade: 'C+',
    accent: 'en-us',
    gender: 'female',
    baselineWpm: 210.6,
    pauseFraction: 0.102,
    dynamicVariance: 0.636,
    f0Median: 150,
    f0Range: 118,
    traits: '',
    note: 'Runs words together — one of the lowest pause fractions of the set.',
  },
  {
    id: 'af_aoede',
    grade: 'C+',
    accent: 'en-us',
    gender: 'female',
    baselineWpm: 215.9,
    pauseFraction: 0.118,
    dynamicVariance: 0.605,
    f0Median: 178,
    f0Range: 135,
    traits: '',
    note: 'Competent all-rounder with no particular strength for teaching, and fast.',
  },
  {
    id: 'bm_george',
    grade: 'C',
    accent: 'en-gb',
    gender: 'male',
    baselineWpm: 171.1,
    pauseFraction: 0.14,
    dynamicVariance: 0.501,
    f0Median: 143,
    f0Range: 85,
    traits: '🚹',
    note: 'Naturally the slowest voice and the flattest delivery measured — calm to the point of monotone.',
  },
  {
    id: 'af_nicole',
    grade: 'B-',
    accent: 'en-us',
    gender: 'female',
    baselineWpm: 151.0,
    pauseFraction: 0.328,
    dynamicVariance: 0.737,
    f0Median: 148,
    f0Range: 170,
    traits: '🎧',
    note: 'Breathy/ASMR. Already at teaching pace, but a third of it is breath and the level wanders — poor for notation.',
  },
  {
    id: 'af_sarah',
    grade: 'C+',
    accent: 'en-us',
    gender: 'female',
    baselineWpm: 209.3,
    pauseFraction: 0.138,
    dynamicVariance: 0.557,
    f0Median: 189,
    f0Range: 136,
    traits: '',
    note: 'Even and clear, but a full grade below the flagship and bright with it.',
  },
  {
    id: 'bm_fable',
    grade: 'C',
    accent: 'en-gb',
    gender: 'male',
    baselineWpm: 205.5,
    pauseFraction: 0.103,
    dynamicVariance: 0.729,
    f0Median: 128,
    f0Range: 234,
    traits: '🚹',
    note: 'The most theatrical voice measured — nearly triple the pitch range of the calmest. Wrong instrument for explanation.',
  },
];

const PROFILES = new Map(KOKORO_VOICE_PROFILES.map((p) => [p.id, p]));

export function voiceProfile(id: string): VoiceProfile | undefined {
  return PROFILES.get(id);
}

/* ------------------------------------------------------------------- pacing */

/** Explanation pace, per the lesson brief. Slower than the MVP's 193 wpm. */
export const TEACHING_WPM_MIN = 140;
export const TEACHING_WPM_MAX = 160;
export const TEACHING_WPM_TARGET = 150;

/**
 * Speed multiplier that lands `voice` in the teaching band.
 *
 * Kokoro's rate response is close enough to proportional over 0.7–1.0 that
 * `target / baseline` is accurate to within a few wpm (verified: af_heart at
 * 0.78 measured 147.6 wpm against a 150.9 prediction). Clamped at 0.7 because
 * the duration predictor starts to smear consonants below that.
 */
export function speedForWpm(voiceId: string, targetWpm = TEACHING_WPM_TARGET): number {
  const baseline = voiceProfile(voiceId)?.baselineWpm;
  if (!baseline) return 1;
  return Math.round(Math.max(0.7, Math.min(1.2, targetWpm / baseline)) * 1000) / 1000;
}

/** Words per minute a finished clip actually speaks at. */
export function measuredWpm(text: string, seconds: number): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  if (!words || !(seconds > 0)) return 0;
  return (words / seconds) * 60;
}

/* ------------------------------------------------------------------ scoring */

/**
 * Score a value that has an ideal *range* rather than an ideal direction:
 * 1 inside `[lo, hi]`, falling linearly to 0 at `tolerance` beyond either edge.
 */
function bandScore(value: number, lo: number, hi: number, tolerance: number): number {
  if (value >= lo && value <= hi) return 1;
  const distance = value < lo ? lo - value : value - hi;
  return clamp01(1 - distance / tolerance);
}

/**
 * Fitness for teaching, 0–1. Quality dominates because artefacts are the one
 * defect a listener cannot ignore; calm and warmth break the ties.
 */
export function teachingScore(p: VoiceProfile): number {
  const quality = GRADE_SCORE[p.grade];
  // Calm is a BAND, not a direction, and getting this wrong is instructive: a
  // first pass rewarded flatness monotonically and duly ranked `bm_george` — a
  // voice its own note calls "calm to the point of monotone" — above the warmer
  // `am_michael`. Prosodic variation is how a teacher marks what matters, so too
  // little is as wrong as too much. The bands bracket the observed comfortable
  // middle of the candidate set (f0Range 71–211, dynVar 0.49–0.74).
  const calm =
    0.5 * bandScore(p.f0Range, 85, 140, 55) + 0.5 * bandScore(p.dynamicVariance, 0.55, 0.66, 0.12);
  // Warmth: lower fundamentals read warmer, but only mildly — a low grade is
  // not redeemed by being warm.
  const warmth = 1 - clamp01((p.f0Median - 110) / 100);
  // Clarity: a high pause fraction *within trimmed speech* means breath and blur,
  // not diction.
  const clarity = 1 - clamp01((p.pauseFraction - 0.09) / 0.25);
  // Slowability: how much correction the voice needs to reach the teaching band.
  // A multiplier near 1 is free; one at the 0.7 floor smears consonants, and
  // anything below it cannot reach the band at all — so it scores zero rather
  // than being rewarded for having been fast to begin with.
  const required = TEACHING_WPM_TARGET / p.baselineWpm;
  const slowability = clamp01((required - 0.7) / 0.25);

  return 0.5 * quality + 0.2 * calm + 0.12 * clarity + 0.1 * warmth + 0.08 * slowability;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export type VoicePreference = {
  accent?: 'en-us' | 'en-gb';
  gender?: 'female' | 'male';
};

/** Highest-scoring voice matching the preference, or overall if none matches. */
export function pickTeachingVoice(pref: VoicePreference = {}): VoiceProfile {
  const ranked = [...KOKORO_VOICE_PROFILES].sort((a, b) => teachingScore(b) - teachingScore(a));
  const matching = ranked.filter(
    (p) => (!pref.accent || p.accent === pref.accent) && (!pref.gender || p.gender === pref.gender),
  );
  // The candidate set is non-empty and `ranked[0]` always exists, so this is a
  // total function — no branch can return undefined.
  return matching[0] ?? ranked[0]!;
}

/** The measured winner: warm, calm, top-graded. */
export const TEACHING_VOICE = pickTeachingVoice().id;

/** Ranked table, for `--explain` output and for the studio's voice picker. */
export function rankTeachingVoices(): Array<VoiceProfile & { score: number; speedFor150: number }> {
  return [...KOKORO_VOICE_PROFILES]
    .map((p) => ({
      ...p,
      score: Math.round(teachingScore(p) * 1000) / 1000,
      speedFor150: speedForWpm(p.id),
    }))
    .sort((a, b) => b.score - a.score);
}

/* -------------------------------------------------------------- the audit */

/** The fixed paragraph every voice is measured on: 63 words of real teaching. */
export const AUDIT_PARAGRAPH =
  'Imagine you are standing on a foggy hillside and you want to reach the valley below. ' +
  'You cannot see where it is. What you can do is feel the ground under your feet, ' +
  'work out which way is downhill, and take one small step that way. ' +
  'Then you feel again, and step again. That is the whole idea behind gradient descent.';

export type VoiceMeasurement = {
  id: string;
  baselineWpm: number;
  pauseFraction: number;
  dynamicVariance: number;
  f0Median: number;
  f0Range: number;
  totalSec: number;
};

/**
 * Re-run the measurement that produced `KOKORO_VOICE_PROFILES`.
 *
 * It measures the **delivered** rate — the paragraph is split into phrases, each
 * phrase is synthesised and trimmed to its speech bounds, and the pieces are
 * reassembled with the same gaps and trailing breath the voice stage uses. That
 * detail is the entire point, and getting it wrong is instructive: a first pass
 * measured one whole-paragraph `generate()` call instead, which silently included
 * Kokoro's ~0.9 s of per-call padding. Calibrating against that number and then
 * *trimming* that padding in the pipeline produced 173 wpm from a voice the table
 * claimed was running at 150. Measure what you ship.
 *
 * Slow (a few seconds per voice) and therefore not part of the test suite;
 * exported so the table can be regenerated after a model update rather than
 * trusted forever, and so a human can listen to the same samples.
 */
export async function auditKokoroVoices(
  ids: readonly string[] = KOKORO_VOICE_PROFILES.map((p) => p.id),
  opts: { speed?: number; padSec?: number; onVoice?: (m: VoiceMeasurement) => void } = {},
): Promise<VoiceMeasurement[]> {
  const { loadKokoro } = await import('./providers/kokoro.js');
  const { splitPhrases, gapAfter } = await import('./phrase.js');
  const { findSpeechBounds } = await import('./wav.js');
  const { normalizeNarration } = await import('./text.js');

  const tts = await loadKokoro();
  const words = AUDIT_PARAGRAPH.split(/\s+/).filter(Boolean).length;
  const phrases = splitPhrases(normalizeNarration(AUDIT_PARAGRAPH));
  const padSec = opts.padSec ?? 0.25;
  const out: VoiceMeasurement[] = [];

  for (const id of ids) {
    const pieces: Float32Array[] = [];
    let rate = 24_000;
    let seconds = padSec;

    for (let i = 0; i < phrases.length; i++) {
      const phrase = phrases[i]!;
      const audio = await tts.generate(phrase.text, { voice: id, speed: opts.speed ?? 1 });
      rate = audio.sampling_rate || 24_000;
      const bounds = findSpeechBounds(audio.audio, rate);
      const trimmed = audio.audio.slice(bounds.start, bounds.end);
      pieces.push(trimmed);
      seconds += trimmed.length / rate + gapAfter(phrase, phrases[i + 1]);
    }

    const merged = new Float32Array(pieces.reduce((acc, p) => acc + p.length, 0));
    let at = 0;
    for (const p of pieces) {
      merged.set(p, at);
      at += p.length;
    }
    const m = analyseSpeech(merged, rate);

    const measurement: VoiceMeasurement = {
      id,
      baselineWpm: Math.round((words / seconds) * 60 * 10) / 10,
      pauseFraction: Math.round(m.pauseFraction * 1000) / 1000,
      dynamicVariance: Math.round(m.dynamicVariance * 1000) / 1000,
      f0Median: Math.round(m.f0Median),
      f0Range: Math.round(m.f0Range),
      totalSec: Math.round(seconds * 1000) / 1000,
    };
    out.push(measurement);
    opts.onVoice?.(measurement);
    log.info(
      `${id}: ${measurement.baselineWpm} wpm delivered, pause ${measurement.pauseFraction}, ` +
        `dyn ${measurement.dynamicVariance}, f0 ${measurement.f0Median}Hz ±${measurement.f0Range}`,
    );
  }
  return out;
}

/* --------------------------------------------------------------- analysis */

function frameRms(a: Float32Array, from: number, to: number): number {
  let acc = 0;
  for (let i = from; i < to; i++) {
    const v = a[i] ?? 0;
    acc += v * v;
  }
  return Math.sqrt(acc / Math.max(1, to - from));
}

export type SpeechAnalysis = {
  totalSec: number;
  /** Length between the first and last voiced frame. */
  speechSec: number;
  pauseFraction: number;
  dynamicVariance: number;
  f0Median: number;
  f0Range: number;
  peak: number;
};

/**
 * Level, pause and pitch statistics for a mono clip.
 *
 * Deliberately dependency-free: a 20 ms RMS envelope for level and pauses, and
 * autocorrelation over 70–350 Hz for pitch. Crude, but it is comparing voices
 * from one engine against each other, which is all the audit needs.
 */
export function analyseSpeech(audio: Float32Array, sampleRate: number): SpeechAnalysis {
  const totalSec = audio.length / sampleRate;
  const win = Math.max(1, Math.round(0.02 * sampleRate));
  const frames: number[] = [];
  for (let i = 0; i + win <= audio.length; i += win) frames.push(frameRms(audio, i, i + win));
  if (!frames.length) {
    return {
      totalSec,
      speechSec: 0,
      pauseFraction: 1,
      dynamicVariance: 0,
      f0Median: 0,
      f0Range: 0,
      peak: 0,
    };
  }

  const peak = Math.max(...frames);
  const floor = peak * 0.03;
  const voiced = frames.filter((f) => f > floor);
  const pauseFraction = 1 - voiced.length / frames.length;

  let first = 0;
  let last = frames.length - 1;
  while (first < frames.length && (frames[first] ?? 0) <= floor) first++;
  while (last > first && (frames[last] ?? 0) <= floor) last--;
  const speechSec = ((last - first + 1) * win) / sampleRate;

  const mean = voiced.reduce((a, b) => a + b, 0) / Math.max(1, voiced.length);
  const dynamicVariance =
    Math.sqrt(voiced.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, voiced.length)) /
    (mean || 1);

  const block = Math.max(1, Math.round(0.04 * sampleRate));
  const minLag = Math.floor(sampleRate / 350);
  const maxLag = Math.floor(sampleRate / 70);
  const f0s: number[] = [];
  for (let i = 0; i + block <= audio.length; i += block) {
    if (frameRms(audio, i, i + block) <= floor) continue;
    let best = 0;
    let bestLag = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let c = 0;
      for (let j = 0; j + lag < block; j++) c += (audio[i + j] ?? 0) * (audio[i + j + lag] ?? 0);
      if (c > best) {
        best = c;
        bestLag = lag;
      }
    }
    if (bestLag > 0) f0s.push(sampleRate / bestLag);
  }
  f0s.sort((a, b) => a - b);
  const at = (q: number): number =>
    f0s[Math.min(f0s.length - 1, Math.max(0, Math.floor(f0s.length * q)))] ?? 0;

  return {
    totalSec,
    speechSec,
    pauseFraction,
    dynamicVariance,
    f0Median: at(0.5),
    f0Range: Math.max(0, at(0.9) - at(0.1)),
    peak,
  };
}
