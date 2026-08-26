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
import { voiceMood } from '../moods.js';
import { CLIP_SAMPLE_RATE, encodeWav } from '../wav.js';
import type {
  SynthesisRequest,
  SynthesisResult,
  VoiceFailureReason,
  VoiceProvider,
  WordTiming,
} from './types.js';
import { VoiceProviderError } from './types.js';

const log = logger('voice:elevenlabs');

const API = 'https://api.elevenlabs.io/v1';

/**
 * The engine this adapter speaks with. One credit per character.
 *
 * **The listening note came back negative.** `ELEVENLABS_FLASH_MODEL` below is the
 * latency-optimised engine, and it was chosen for the only reason anything is chosen
 * on price: voice was 86% of the last full keyed bill, flash halves it, and no tool
 * in this repo can hear the difference. The comment that switched it said so in as
 * many words — "a person has to" — and left the debt standing. A person has now
 * listened to a finished film in it and the answer is that flash's prosody across
 * concatenated fragments is choppy, which is the "no proper cadence" the dissection
 * of `projects/deb81002b073` names.
 *
 * The arithmetic, stated once so nobody re-litigates it: ~1300 characters a film at 1
 * credit rather than 0.5, at $0.00022 a credit, is **$0.29 a film against $0.14**.
 * Fifteen cents. The film is the product.
 */
export const ELEVENLABS_MULTILINGUAL_MODEL = 'eleven_multilingual_v2';

/**
 * The latency-optimised engine, at half the credits — no longer the default.
 *
 * Kept, and kept exported, for two reasons: `ELEVENLABS_MODEL_ID` still selects it
 * for anyone who wants the cheaper film, and `CREDITS_PER_CHAR` below has to be able
 * to price the projects on disk that were spoken with it.
 */
export const ELEVENLABS_FLASH_MODEL = 'eleven_flash_v2_5';

/**
 * The engine in force, resolving the override in one place.
 *
 * `ELEVENLABS_MODEL_ID` appeared in no cache key, no log line and no record: it was
 * read inline where the request body is built, so two machines with different values
 * produced different audio for the same lesson and nothing could tell. Everything
 * that needs to name the model — the clip key, the delivery signature, the record in
 * `pipeline.json` — asks here.
 */
export function elevenLabsModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.ELEVENLABS_MODEL_ID || ELEVENLABS_MULTILINGUAL_MODEL;
}
/** "Rachel" — the long-standing default voice, used if `/v1/voices` is unreachable. */
const FALLBACK_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';

/* ------------------------------------------------------------------- pricing */

/**
 * What a credit costs, and how many credits a character costs.
 *
 * Here rather than only in `@inkcast/pipeline`'s `cost.ts` because the voice stage now
 * returns what the film cost as part of its provenance, and it cannot ask the pipeline
 * — that would be a cycle. The adapter is also the honest owner of the second number:
 * credits-per-character is a property of the *engine*, and this file is the one that
 * decides which engine speaks (`elevenLabsModel`). `cost.ts` still carries its own copy
 * of the table for the pipeline's cost lines; the two must agree, and the intended end
 * state is that it reads this one. Until then, changing a rate means changing both.
 */
export const ELEVENLABS_USD_PER_CREDIT = 0.00022;

const CREDITS_PER_CHAR: Record<string, number> = {
  eleven_multilingual_v2: 1,
  eleven_turbo_v2_5: 0.5,
  eleven_flash_v2_5: 0.5,
};

/**
 * Credits one character costs on `model`, defaulting to the full rate.
 *
 * An unrecognised engine — `eleven_v3` today, whose per-character rate this repo has
 * not confirmed — is billed at 1 credit rather than guessed at downwards. The wrong
 * direction to fail is the cheap one: a table that silently discounts what it does not
 * know under-states a real bill and nobody finds out until the invoice arrives.
 */
export function elevenLabsCreditsPerChar(model: string | undefined): number {
  return (model === undefined ? undefined : CREDITS_PER_CHAR[model]) ?? 1;
}

/** List-price cost of `chars` characters spoken by `model`, in USD. */
export function elevenLabsCostUsd(chars: number, model: string | undefined): number {
  if (!(chars > 0)) return 0;
  return chars * elevenLabsCreditsPerChar(model) * ELEVENLABS_USD_PER_CREDIT;
}

/**
 * Delivery, pinned per request rather than inherited from the voice.
 *
 * Every stock and cloned voice carries its own stored settings, set by whoever made it
 * and changeable from a web UI this repo has never seen. Left unsent, they are what
 * speaks — so the same lesson, the same key and the same voice id can deliver
 * differently on two machines, and no cache key here can know. Sending them makes the
 * render a function of this file.
 *
 * The values are chosen for a *teacher*, and the one that matters is `stability`. It
 * trades consistency against emotional range, and a scene here is not one generation but
 * ten clause-length ones concatenated: an expressive setting re-rolls that range on every
 * clip, so the pitch and pace of one sentence shift between its own clauses. That is
 * heard as strain rather than as expression. `style` is exaggeration on top of it and is
 * off for the same reason — an explanation is delivered calmly or it is performed, and a
 * performance is what makes a hard idea harder to hold on to.
 */
const VOICE_SETTINGS = {
  stability: 0.55,
  similarity_boost: 0.75,
  style: 0,
  use_speaker_boost: true,
} as const;

/**
 * Bumped when anything above changes the audio for an unchanged phrase.
 *
 * The stage's cache key hashes the narration, the voice and the pacing — everything it
 * owns. It cannot see a delivery decision made inside an adapter, so a change here would
 * otherwise serve clips recorded under the old one for the life of the project.
 *
 * v3 folds in the effective model id, which is the field that was missing: switching
 * from multilingual to flash is a different recording of the same words, and until it
 * entered this string an existing project stayed fresh and never heard the new engine.
 *
 * v4 is the speed clamp (`elevenLabsSpeed`). The stage hashes the speed it *asked*
 * for, not the one this adapter sends, so a clamp applied here is invisible to the
 * clip key by construction — and a phrase that used to be stretched to 0.81 and is
 * now sent at 0.9 is different audio for narration that never moved.
 */
export function elevenLabsDelivery(env: NodeJS.ProcessEnv = process.env): string {
  return `el/v4:${elevenLabsModel(env)}+context+pinned-settings+speed-clamped`;
}

/**
 * Words per minute this provider **delivers** at `speed: 1`.
 *
 * Without a number here the voice stage skips its rate correction entirely — `speed`
 * stays at 1 and "140–160 wpm for teaching" becomes a target nothing aims at. That is
 * what was happening: a nine-beat lesson on the cardiac conduction system came out at
 * **185 wpm**, a fifth faster than the top of the band, and the stage could only notice
 * afterwards and warn. Every Kokoro voice has carried a measured baseline since the voice
 * audit; the cloud provider was added later and never got one.
 *
 * Measured the same way theirs were, which is the only way the two are comparable: the
 * rate delivered through the *real* phrase pipeline — per-phrase synthesis, edge
 * trimming, clause and sentence gaps — and not from one raw call. `narrate()` reports
 * exactly this quantity at the end of every run, which is where the number comes from.
 *
 * One measurement of one voice, and that is its honest limit: ElevenLabs voices differ
 * from each other more than Kokoro's do, and a cloned voice could be anywhere. It is
 * still far better than the 1.0 it replaces, and the stage keeps warning when the
 * delivered rate misses the band — so a voice this is wrong for reports itself.
 */
export const ELEVENLABS_BASELINE_WPM = 193;

/*
 * **Re-measured 2026-08-25 under multilingual + sentence split, and read the caveat.**
 *
 * 185 came off `eleven_flash_v2_5` splitting at clauses. This adapter now speaks
 * `eleven_multilingual_v2` in whole sentences, and both change the delivered rate — fewer
 * inter-fragment gaps alone makes a scene faster. `projects/f3ac9c760194`, the acceptance
 * film of `docs/PLAN-WATCHABILITY.md`, delivered **158 words over 54.6s = 173.6 wpm**
 * across eight scenes (per scene: 168, 209, 173, 188, 174, 152, 178, 176).
 *
 * ## Why the constant is 193 and not 173.6
 *
 * Because 173.6 is what came back at `speed 0.9`, not at 1.0. This constant means "the
 * engine's rate when it is not being pushed", and the whole film ran at the clamp: the
 * teaching target is ~150 wpm, 150/185 is 0.81, and `elevenLabsSpeed` floors that at 0.9.
 * 173.6 / 0.9 = 192.9, so 193 — **on the assumption that ElevenLabs `speed` scales the
 * delivered rate linearly**, which is plausible, is what the parameter claims to do, and
 * has not been verified here. A clean measurement wants one run with `speed` pinned to
 * 1.0; nothing in this repo currently asks for that, so it has not been done.
 *
 * ## Which is why moving it changes no audio today, and that is worth knowing
 *
 * The clamp binds either way: 150/185 = 0.81 and 150/193 = 0.78 both floor to 0.9. This
 * constant only starts affecting what is spoken when it comes within 10% of the target
 * rate — a much slower voice, or a much faster target. So this edit is truth-in-reporting,
 * not a change to the film, and a re-cast should sound byte-identical.
 *
 * What makes the residual uncertainty survivable is that same clamp: a baseline wrong by
 * 20% used to become a 20% stretch on every phrase, and now becomes at most 10% with the
 * delivered rate reported against the teaching band on every run.
 */

/**
 * How far the engine's own rate may be stretched, either way.
 *
 * The stage divides its target rate by the baseline above and hands the result over
 * as `speed`, which is right in principle and was audibly wrong in practice: 185
 * against a 150 wpm target is **0.81 on every phrase**, and a voice slowed by a fifth
 * for its whole runtime does not sound calm, it sounds like a recording being played
 * back slowly. That is the "drags" half of the dissection's voice finding.
 *
 * So the correction is a nudge rather than a lever. Inside ±10% the engine's own
 * prosody survives; outside it, the honest conclusion is that the *baseline* is wrong
 * for this voice, and `narrate()` already reports the delivered rate against the
 * teaching band on every run so that shows up as a measurement rather than as a
 * permanent stretch nobody can hear the cause of.
 */
const MAX_SPEED_CORRECTION = 0.1;

/** The `speed` this adapter will actually send for a requested one. */
export function elevenLabsSpeed(requested: number): number {
  if (!Number.isFinite(requested) || requested <= 0) return 1;
  return (
    Math.round(clamp(requested, 1 - MAX_SPEED_CORRECTION, 1 + MAX_SPEED_CORRECTION) * 1000) / 1000
  );
}

const clampSpeed = elevenLabsSpeed;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

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

export type VoiceRecord = { voice_id: string; name: string };

/**
 * Index a voice catalogue by name, for the preference matching in `resolveVoice`.
 *
 * ElevenLabs renamed its premade voices from bare names to descriptive ones —
 * "Sarah" became "Sarah - Mature, Reassuring, Confident" — which silently broke
 * every entry in `PREFERENCES`: an exact match on "sarah" found nothing, and the
 * fallthrough handed `af_heart` to whatever voice happened to be listed first,
 * gender and accent unregarded. So each voice is indexed under its full name *and*
 * under the part before the " - ", with the full name winning a collision because
 * it is the more deliberate ask.
 */
export function catalogueIndex(list: readonly VoiceRecord[]): Map<string, string> {
  const byName = new Map<string, string>();
  for (const v of list) {
    const full = v.name.toLowerCase();
    if (!byName.has(full)) byName.set(full, v.voice_id);
  }
  for (const v of list) {
    const short = v.name.toLowerCase().split(' - ')[0]!.trim();
    if (short && !byName.has(short)) byName.set(short, v.voice_id);
  }
  return byName;
}

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

/**
 * What an HTTP failure means, from the status and the machine-readable status field.
 *
 * A 401 is two different events here: an account with no credits left and a key that
 * is not valid. ElevenLabs distinguishes them only in the body, as
 * `detail.status: "quota_exceeded"` — a field name, not error copy, which is why it
 * is safe to match on. Anything unrecognised stays `unknown` rather than being
 * guessed at, because a wrong reason in the record is worse than no reason.
 */
export function classify(status: number, body: string): VoiceFailureReason {
  if (status === 429) return 'rate_limited';
  // Seen in the wild as `detail.code: "paid_plan_required"` when a free-plan
  // account asks for a library voice via the API. Not a quota problem — the
  // account had thousands of characters left — so it must not share a name with
  // one: the remedy is a different voice or a different plan, not a refill.
  if (status === 402) return 'payment_required';
  if (status === 401 || status === 403) {
    let detail: unknown;
    try {
      detail = (JSON.parse(body) as { detail?: unknown }).detail;
    } catch {
      detail = undefined;
    }
    const named = (detail as { status?: unknown } | undefined)?.status;
    if (named === 'quota_exceeded' || body.includes('quota_exceeded')) return 'quota_exceeded';
    return 'unauthorized';
  }
  return 'unknown';
}

async function request(
  urlPath: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const key = apiKey();
  if (!key) throw new Error('ELEVENLABS_API_KEY is not set');
  const { timeoutMs = 120_000, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`${API}${urlPath}`, {
      ...rest,
      headers: { 'xi-api-key': key, ...(headers as Record<string, string> | undefined) },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    throw new VoiceProviderError(`ElevenLabs ${urlPath} could not be reached`, {
      provider: 'elevenlabs',
      reason: 'network',
      cause,
    });
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 400);
    // The message text is unchanged on purpose: it is what today's log lines say, and
    // the classification is carried beside it rather than instead of it.
    throw new VoiceProviderError(
      `ElevenLabs ${urlPath} -> ${res.status} ${res.statusText}${body ? `: ${body}` : ''}`,
      { provider: 'elevenlabs', reason: classify(res.status, body), status: res.status },
    );
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

  /**
   * Voice substitutions forced by the account's plan: blocked id → usable id.
   *
   * The free plan returns 402 `paid_plan_required` for library voices via the API
   * — measured, not assumed: Rachel, the calm mood's pin, 402s on a free account
   * with 8 000 characters of quota left, while every voice in that account's own
   * `/voices` list synthesises fine. Populated only by a real 402, so a paid
   * account never pays a probing round trip and a pinned mood still resolves
   * offline; once a substitution is learned, every later phrase uses it directly
   * so the film speaks with one voice.
   */
  const planSwap = new Map<string, SynthesisResult['substitution']>();

  /**
   * The closest voice this account can use to the one its plan just refused:
   * the refused pin's own mood names a Kokoro twin (`af_heart`, `bm_george`, …)
   * whose accent+gender family picks the preference list, matched against the
   * account's catalogue — which is exactly the set its API calls may use.
   */
  const planSubstitute = async (blocked: string): Promise<VoiceRecord | undefined> => {
    const list = await loadCatalogue();
    if (!list.length) return undefined;
    const byName = catalogueIndex(list);
    const family = /^([ab][fm])_/.exec(voiceMood(blocked)?.kokoro ?? '')?.[1] ?? 'af';
    for (const candidate of PREFERENCES[family] ?? []) {
      const hit = byName.get(candidate.toLowerCase());
      if (hit && hit !== blocked) return list.find((v) => v.voice_id === hit);
    }
    return list.find((v) => v.voice_id !== blocked);
  };

  /**
   * Learn a plan refusal from the account's own catalogue instead of from a 402.
   *
   * The substitution in `synthesize` below is correct and costs a round trip to
   * discover: the request goes out, the plan refuses that voice, and a second request
   * goes out with a voice the account can use. `/voices` is the account's *own* list,
   * which is exactly the set its API calls may use and a free metadata call, so a
   * voice that is not in it is a refusal already known.
   *
   * Four things it deliberately does not do.
   *
   * It does not run in `resolveVoice`. A mood pin resolves by id, offline, on every
   * run including a fully cached one — that is what makes two accounts cast the same
   * lesson identically, and it is asserted by a test that counts `fetch` calls. This
   * runs once, immediately before the first generation, so a film whose every clip is
   * cached still costs nothing.
   *
   * It does not change what `resolveVoice` returned. That value is a clip cache-key
   * input (`ActiveProvider.voice`); moving it would re-key a whole film for a decision
   * about *this account*. The substitute travels on `SynthesisResult.substitution`,
   * the same way the 402's does.
   *
   * It does not substitute when the catalogue could not be read: an empty list means
   * "we could not ask", not "the account has no voices". And it never fires twice —
   * one GET per provider instance, whatever happens.
   */
  let preflighted = false;
  const preflightVoice = async (voiceId: string): Promise<void> => {
    if (preflighted) return;
    preflighted = true;
    if (planSwap.has(voiceId)) return;
    let list: VoiceRecord[];
    try {
      list = await loadCatalogue();
    } catch {
      return;
    }
    if (!list.length || list.some((v) => v.voice_id === voiceId)) return;
    const substitute = await planSubstitute(voiceId);
    if (!substitute) return;
    const named = voiceMood(voiceId)?.elevenlabs.name;
    const why =
      `this plan cannot use ${named ? `"${named}" ` : ''}${voiceId} via the API ` +
      "(it is not in the account's own voice list)";
    log.warn(`${why} — substituting "${substitute.name}" (${substitute.voice_id})`);
    planSwap.set(voiceId, {
      voice: substitute.voice_id,
      name: substitute.name,
      from: voiceId,
      why,
    });
  };

  const body = (req: SynthesisRequest): string => {
    const settings: Record<string, unknown> = { ...VOICE_SETTINGS };
    const speed = clampSpeed(req.speed);
    if (speed !== 1) settings.speed = speed;
    return JSON.stringify({
      text: req.text,
      model_id: elevenLabsModel(),
      voice_settings: settings,
      // The neighbours, so a clause is read as the middle of a sentence rather than as
      // a sentence. Documented by the provider for exactly this — concatenating several
      // generations — and it is context only: neither string is spoken, and the audio
      // that comes back is still just `text`. See `SynthesisRequest`.
      ...(req.previousText ? { previous_text: req.previousText } : {}),
      ...(req.nextText ? { next_text: req.nextText } : {}),
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

    // Named rather than described, because this exact sentence is what a user gets
    // when they asked for this provider and did not get it: the variable, and the
    // fact that the vault populates it. A film narrated locally with a key in the
    // vault is the failure this string exists to make impossible to miss.
    unavailableReason() {
      if (apiKey()) return undefined;
      return 'ELEVENLABS_API_KEY is not set in this process (a key stored in the vault only counts once it has been hydrated into the environment)';
    },

    async voices() {
      return (await loadCatalogue()).map((v) => v.name);
    },

    naturalWpm() {
      return ELEVENLABS_BASELINE_WPM;
    },

    /**
     * Whole sentences, not clauses.
     *
     * The clause split was chosen for cue precision and it did buy that — but the
     * precision does not come from the split. Word timings come back from the
     * timestamped endpoint whatever size the request was, so cue resolution stays
     * word-exact on sentences; what the split decides is how much text the *engine*
     * gets to shape a contour across.
     *
     * `previous_text`/`next_text` were the argument for keeping clauses safe, and
     * they help. They are not enough: a scene delivered as four to ten separate
     * generations, edge-trimmed and concatenated with modelled gaps, still lands
     * slightly differently on each fragment — a new onset, a fresh pitch range — and
     * ten of those in a row is the choppiness the dissection of
     * `projects/deb81002b073` heard and called "no proper cadence". Kokoro reached
     * the same conclusion for a different reason (no context window at all) and this
     * is `VoiceProvider.preferredSplit`'s whole purpose: the engine says how much
     * text it needs to sound like a person.
     */
    preferredSplit() {
      return 'sentence';
    },

    modelId() {
      return elevenLabsModel();
    },

    deliverySignature() {
      return elevenLabsDelivery();
    },

    async resolveVoice(requested: string) {
      const override = process.env.ELEVENLABS_VOICE_ID;
      if (override) return override;
      if (looksLikeVoiceId(requested)) return requested;

      // A curated mood pins its ElevenLabs voice by id, so it resolves here and stops:
      // no `/voices` call, no name matching, and no dependence on what the account
      // happens to have in its library. That last part is the substantive fix — the
      // path below resolves `af_heart` by *name preference* against whatever the key
      // can see, so two accounts could cast the same lesson with two different voices
      // and the record would look identical. See `moods.ts`. A pin the account's
      // *plan* cannot use is handled where the refusal actually happens — the 402
      // substitution in `synthesize` — so this stays free of round trips.
      const mood = voiceMood(requested);
      if (mood) {
        log.info(
          `mood "${mood.label}" → ElevenLabs ${mood.elevenlabs.name} (${mood.elevenlabs.voiceId})` +
            (mood.verified ? '' : ' · unheard: a human has not confirmed this voice yet'),
        );
        return mood.elevenlabs.voiceId;
      }

      const list = await loadCatalogue();
      if (!list.length) return FALLBACK_VOICE_ID;

      const byName = catalogueIndex(list);
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
      // Once per run, before a single character is generated. See `preflightVoice`.
      await preflightVoice(req.voice);
      // Every return path carries the substitution, not just the one that learned it.
      // The learning happens on phrase 0 and the film has hundreds; a result shape
      // that only described the first would leave the record dependent on which clip
      // the cache happened to miss.
      const swapped = planSwap.get(req.voice);
      if (swapped) {
        return { ...(await speak({ ...req, voice: swapped.voice })), substitution: swapped };
      }
      try {
        return await speak(req);
      } catch (err) {
        // A 402 is the plan refusing this *voice*, not this account being out of
        // anything — the same request with a voice from the account's own list
        // succeeds. Demoting to the local engine here would throw away a working
        // paid provider over a fixable voice choice, so substitute and continue;
        // every failure that is actually about the account still propagates.
        if (!(err instanceof VoiceProviderError && err.reason === 'payment_required')) throw err;
        const substitute = await planSubstitute(req.voice);
        if (!substitute) throw err;
        const blocked = voiceMood(req.voice)?.elevenlabs.name;
        const substitution = {
          voice: substitute.voice_id,
          name: substitute.name,
          from: req.voice,
          why: `this plan cannot use ${blocked ? `"${blocked}" ` : ''}${req.voice} via the API (402 payment_required)`,
        };
        log.warn(
          `${substitution.why} — substituting "${substitute.name}" (${substitute.voice_id}), ` +
            'which this account can use',
        );
        planSwap.set(req.voice, substitution);
        return { ...(await speak({ ...req, voice: substitute.voice_id })), substitution };
      }
    },

    async dispose() {
      catalogue = undefined;
      planSwap.clear();
    },
  };

  async function speak(req: SynthesisRequest): Promise<SynthesisResult> {
    await mkdir(path.dirname(req.outPath), { recursive: true });
    const payload = body(req);
    /**
     * Whether the timestamped attempt has already cost a generation.
     *
     * The fall-through below is a *second* full TTS request for the same phrase, and
     * the first one is not necessarily free: `/with-timestamps` can answer 200 with
     * no `audio_base64` at all, which is audio that was generated and billed and
     * that we cannot use. Only the failures that never reached the engine are free —
     * no response at all (`network`), and a request the rate limiter refused before
     * it ran (`rate_limited`). Everything else is counted, because over-stating a
     * bill by one phrase is the safe direction and under-stating it is the one
     * nobody notices until the invoice arrives.
     */
    let firstAttemptBilled = false;

    // Preferred: the timestamped endpoint, which also gives us word timings.
    try {
      const res = await request(
        `/text-to-speech/${encodeURIComponent(req.voice)}/with-timestamps${query}`,
        {
          method: 'POST',
          headers,
          body: payload,
        },
      );
      const json = (await res.json()) as {
        audio_base64?: unknown;
        alignment?: AlignmentPayload;
        normalized_alignment?: AlignmentPayload;
      };
      if (typeof json.audio_base64 !== 'string' || !json.audio_base64) {
        throw new Error('ElevenLabs returned no audio_base64');
      }
      await writeFile(req.outPath, encodeWav(Buffer.from(json.audio_base64, 'base64')));
      const words = alignmentToWords(json.alignment ?? json.normalized_alignment);
      return words.length ? { words } : {};
    } catch (err) {
      // An exhausted balance, a rejected key or a plan-gated voice is not fixed by
      // asking for less: the retry would spend another round trip to fail
      // identically, and its warning ("retrying without word timings") describes a
      // problem this is not. Let the classified failure through — the chain demotes
      // on the account failures, and `synthesize` substitutes on the plan gate.
      if (
        err instanceof VoiceProviderError &&
        (err.reason === 'quota_exceeded' ||
          err.reason === 'unauthorized' ||
          err.reason === 'payment_required')
      ) {
        throw err;
      }
      const reason = err instanceof VoiceProviderError ? err.reason : 'unknown';
      firstAttemptBilled = reason !== 'network' && reason !== 'rate_limited';
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
    // Two generations of the same phrase when the first one was reached — see
    // `firstAttemptBilled`. The stage's tally is the only record of what was spent.
    return firstAttemptBilled ? { billedChars: req.text.length * 2 } : {};
  }
}
