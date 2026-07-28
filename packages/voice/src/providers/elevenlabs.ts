/**
 * ElevenLabs — opt-in cloud upgrade, active only when `ELEVENLABS_API_KEY` is set.
 *
 * Two reasons it is worth an adapter despite the cost:
 *
 * 1. voice quality, and
 * 2. **character-level alignment**, which is the only place in the pipeline where
 *    real timings come back from the provider. Those characters are folded into
 *    words and stored on `scene.words`, letting the renderer highlight text as it
 *    is spoken without a forced aligner.
 *
 * `output_format=pcm_24000` returns headerless 24 kHz mono 16-bit PCM — exactly
 * the clip format — so we wrap it in a WAV header and never touch ffmpeg.
 * No npm dependency: Node 22's global `fetch` is enough.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '@inkcast/core';
import { CLIP_SAMPLE_RATE, encodeWav } from '../wav.js';
import type { SynthesisRequest, SynthesisResult, VoiceProvider, WordTiming } from './types.js';

const log = logger('voice:elevenlabs');

const API = 'https://api.elevenlabs.io/v1';
const DEFAULT_MODEL = 'eleven_multilingual_v2';
/** "Rachel" — the long-standing default voice, used if `/v1/voices` is unreachable. */
const FALLBACK_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';

/** Preferred stock voices per Kokoro voice family (accent + gender). */
const PREFERENCES: Record<string, readonly string[]> = {
  af: ['Rachel', 'Sarah', 'Jessica', 'Aria', 'Matilda'],
  am: ['Adam', 'Brian', 'Bill', 'Roger', 'Eric'],
  bf: ['Alice', 'Charlotte', 'Lily', 'Dorothy'],
  bm: ['George', 'Daniel', 'Charlie', 'Callum'],
};

function apiKey(): string | undefined {
  return process.env.ELEVENLABS_API_KEY || undefined;
}

/** ElevenLabs voice ids are 20-character base62 strings. */
function looksLikeVoiceId(value: string): boolean {
  return /^[A-Za-z0-9]{20}$/.test(value);
}

type VoiceRecord = { voice_id: string; name: string };

type AlignmentPayload = {
  characters?: unknown;
  character_start_times_seconds?: unknown;
  character_end_times_seconds?: unknown;
};

/**
 * Fold ElevenLabs' per-character alignment into the IR's word timings.
 *
 * A word runs from the start of its first non-space character to the end of its
 * last, which is precisely what a karaoke-style highlight needs.
 */
export function alignmentToWords(alignment: AlignmentPayload | undefined): WordTiming[] {
  const chars = alignment?.characters;
  const starts = alignment?.character_start_times_seconds;
  const ends = alignment?.character_end_times_seconds;
  if (!Array.isArray(chars) || !Array.isArray(starts) || !Array.isArray(ends)) return [];

  const words: WordTiming[] = [];
  let current = '';
  let start = 0;
  let end = 0;

  const flush = () => {
    const trimmed = current.trim();
    if (trimmed && /[A-Za-z0-9]/.test(trimmed)) words.push({ word: trimmed, start, end });
    current = '';
  };

  for (let i = 0; i < chars.length; i++) {
    const ch = typeof chars[i] === 'string' ? (chars[i] as string) : '';
    const s = Number(starts[i]);
    const e = Number(ends[i]);
    if (!ch || /\s/.test(ch)) {
      flush();
      continue;
    }
    if (!current) start = Number.isFinite(s) ? s : end;
    current += ch;
    if (Number.isFinite(e)) end = e;
  }
  flush();
  return words;
}

async function request(
  urlPath: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const key = apiKey();
  if (!key) throw new Error('ELEVENLABS_API_KEY is not set');
  const { timeoutMs = 120_000, headers, ...rest } = init;
  const res = await fetch(`${API}${urlPath}`, {
    ...rest,
    headers: { 'xi-api-key': key, ...(headers as Record<string, string> | undefined) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 400);
    throw new Error(`ElevenLabs ${urlPath} -> ${res.status} ${res.statusText}${body ? `: ${body}` : ''}`);
  }
  return res;
}

export function createElevenLabsProvider(): VoiceProvider {
  let catalogue: Promise<VoiceRecord[]> | undefined;

  const loadCatalogue = (): Promise<VoiceRecord[]> => {
    catalogue ??= (async () => {
      try {
        const res = await request('/voices', { timeoutMs: 30_000 });
        const json = (await res.json()) as { voices?: unknown };
        if (!Array.isArray(json.voices)) return [];
        return json.voices.flatMap((v): VoiceRecord[] => {
          const rec = v as { voice_id?: unknown; name?: unknown };
          return typeof rec.voice_id === 'string' && typeof rec.name === 'string'
            ? [{ voice_id: rec.voice_id, name: rec.name }]
            : [];
        });
      } catch (err) {
        log.warn('could not list ElevenLabs voices — using the default voice id', err);
        return [];
      }
    })();
    return catalogue;
  };

  const body = (req: SynthesisRequest): string => {
    const settings: Record<string, unknown> = {};
    if (req.speed !== 1) settings.speed = Math.max(0.7, Math.min(1.2, req.speed));
    return JSON.stringify({
      text: req.text,
      model_id: process.env.ELEVENLABS_MODEL_ID || DEFAULT_MODEL,
      ...(Object.keys(settings).length ? { voice_settings: settings } : {}),
    });
  };

  const headers = { 'content-type': 'application/json', accept: 'application/json' };
  const query = `?output_format=pcm_${CLIP_SAMPLE_RATE}`;

  return {
    id: 'elevenlabs',
    label: 'ElevenLabs (cloud)',

    async available() {
      if (!apiKey()) {
        log.debug('ELEVENLABS_API_KEY not set — cloud voice disabled');
        return false;
      }
      return true;
    },

    async voices() {
      return (await loadCatalogue()).map((v) => v.name);
    },

    async resolveVoice(requested: string) {
      const override = process.env.ELEVENLABS_VOICE_ID;
      if (override) return override;
      if (looksLikeVoiceId(requested)) return requested;

      const list = await loadCatalogue();
      if (!list.length) return FALLBACK_VOICE_ID;

      const byName = new Map(list.map((v) => [v.name.toLowerCase(), v.voice_id]));
      const exact = byName.get(requested.toLowerCase());
      if (exact) return exact;

      const family = /^([ab])([fm])_/.exec(requested);
      const key = family ? `${family[1]}${family[2]}` : 'af';
      for (const candidate of PREFERENCES[key] ?? []) {
        const hit = byName.get(candidate.toLowerCase());
        if (hit) {
          log.info(`voice "${requested}" mapped to the ElevenLabs voice "${candidate}"`);
          return hit;
        }
      }
      const first = list[0];
      if (first) {
        log.info(`voice "${requested}" not found — using "${first.name}"`);
        return first.voice_id;
      }
      return FALLBACK_VOICE_ID;
    },

    async synthesize(req: SynthesisRequest): Promise<SynthesisResult> {
      await mkdir(path.dirname(req.outPath), { recursive: true });
      const payload = body(req);

      // Preferred: the timestamped endpoint, which also gives us word timings.
      try {
        const res = await request(`/text-to-speech/${encodeURIComponent(req.voice)}/with-timestamps${query}`, {
          method: 'POST',
          headers,
          body: payload,
        });
        const json = (await res.json()) as { audio_base64?: unknown; alignment?: AlignmentPayload; normalized_alignment?: AlignmentPayload };
        if (typeof json.audio_base64 !== 'string' || !json.audio_base64) {
          throw new Error('ElevenLabs returned no audio_base64');
        }
        await writeFile(req.outPath, encodeWav(Buffer.from(json.audio_base64, 'base64')));
        const words = alignmentToWords(json.alignment ?? json.normalized_alignment);
        return words.length ? { words } : {};
      } catch (err) {
        log.warn('timestamped synthesis failed — retrying without word timings', err);
      }

      const res = await request(`/text-to-speech/${encodeURIComponent(req.voice)}${query}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'audio/basic' },
        body: payload,
      });
      const pcm = Buffer.from(await res.arrayBuffer());
      if (!pcm.length) throw new Error('ElevenLabs returned an empty audio body');
      await writeFile(req.outPath, encodeWav(pcm));
      return {};
    },

    async dispose() {
      catalogue = undefined;
    },
  };
}
