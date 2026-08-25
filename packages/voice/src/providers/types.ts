/** The one interface every TTS backend implements. */
import type { Scene } from '@inkcast/core';
import type { PhraseSplit } from '../phrase.js';

/** Word timing as the Storyboard IR wants it. */
export type WordTiming = NonNullable<Scene['words']>[number];

/**
 * Selection order is also the fallback order. Kokoro is the documented local
 * default; `system` is the safety net that needs no download at all;
 * `elevenlabs` is an opt-in cloud upgrade; `silence` is the last resort that
 * keeps a render alive (timed, silent clips) when nothing else can speak.
 */
export const VOICE_PROVIDER_IDS = ['kokoro', 'system', 'elevenlabs', 'silence'] as const;
export type VoiceProviderId = (typeof VOICE_PROVIDER_IDS)[number];

export function isVoiceProviderId(value: unknown): value is VoiceProviderId {
  return typeof value === 'string' && (VOICE_PROVIDER_IDS as readonly string[]).includes(value);
}

export type SynthesisRequest = {
  /** Already normalised by `normalizeNarration`. */
  text: string;
  /** Provider-native voice id, produced by `resolveVoice`. */
  voice: string;
  /**
   * The narration on either side of `text`, for engines that can read it.
   *
   * **Context, never content.** These are not spoken and do not appear in the returned
   * audio: they tell an engine where in a sentence this clip sits, so it can choose an
   * intonation contour that continues from what came before and leads into what comes
   * after. Nothing else in the request changes.
   *
   * This exists because of how the stage synthesises: a scene is cut into clauses and
   * each clause is its own generation (see `phrase.ts` — it is the only way to know
   * *when* a phrase is spoken without a forced aligner). An engine handed four words
   * with no context has no way to know they are the middle of a thought, so it reads
   * them as a complete utterance: a fresh onset, a terminal fall, and its own pitch
   * range. Ten of those concatenated is a voice that lands hard on every clause and
   * resets between them — the flat, effortful delivery that has to be worked at to
   * follow. Handing over the neighbours costs nothing and no extra audio, and it is
   * the difference between one person talking and ten clips of them.
   *
   * Providers that cannot use them ignore them.
   */
  previousText?: string;
  nextText?: string;
  /**
   * Multiplier on the provider's natural rate, already corrected for the voice's
   * measured baseline by the voice stage. 1 = natural.
   */
  speed: number;
  /**
   * The words-per-minute the stage is aiming for (140–160 for teaching).
   *
   * Providers that can be given an absolute rate — `say -r` is the obvious one —
   * should use this in preference to `speed`, because it is the actual target
   * rather than a multiplier derived from someone else's baseline.
   */
  targetWpm?: number;
  /** BCP-47-ish language tag from `storyboard.meta.language`. */
  language: string;
  /**
   * Absolute destination. The provider MUST write a WAV in `CLIP_FORMAT`
   * (24 kHz mono 16-bit) so per-scene clips concatenate losslessly.
   */
  outPath: string;
};

export type SynthesisResult = {
  /** Only when the provider genuinely supplies timings. */
  words?: WordTiming[];
  /**
   * Characters this call will be **billed** for, when that is not `text.length`.
   *
   * One `synthesize` is not always one generation. The ElevenLabs adapter asks the
   * timestamped endpoint first and falls through to a plain TTS request when that
   * answers without usable audio, so a single phrase can be generated — and charged —
   * twice. The stage tallies `charsByProvider` from these calls and that tally is now
   * the sole source of the billed number, so a provider that spends twice has to say
   * so here or the bill under-reports by exactly the retry.
   *
   * Omitted by every provider whose call maps one-to-one onto one generation.
   */
  billedChars?: number;
  /**
   * The voice that actually spoke, when it is not the one the adapter was handed.
   *
   * A provider can be unable to use a voice it resolved perfectly well. The measured
   * case is ElevenLabs' free plan: `resolveVoice` maps the `calm` mood to Rachel by
   * pinned id — correctly, offline, with no round trip — and then the plan answers
   * 402 `paid_plan_required` for that library voice while every voice in the
   * account's own list works. The adapter substitutes and the film is fine; the
   * *record* was not, because the substitution lived in a `Map` in the adapter's
   * closure and `pipeline.json` went on naming Rachel. Somebody reading that file
   * later has no way to learn which voice they are listening to.
   *
   * Reported per call and folded up by the chain, rather than returned once, because
   * the adapter only learns it from a refusal — there is no earlier moment to ask.
   */
  substitution?: {
    /** The voice that spoke. */
    voice: string;
    /** Its display name, when the provider knows one. */
    name?: string;
    /** The voice that was asked for and refused. */
    from: string;
    /** One clause naming why, for the line the user reads. */
    why: string;
  };
};

/**
 * Why a provider stopped speaking, in the vocabulary the record uses.
 *
 * Named rather than described because the reason is reported to the user and written
 * into `pipeline.json`: "the ElevenLabs key ran out of credits mid-run" and "the key
 * was rejected" are different problems with different fixes, and both arrive as a 401.
 */
export type VoiceFailureReason =
  | 'quota_exceeded'
  /** The plan, not the balance: this account's tier cannot make this request at all. */
  | 'payment_required'
  | 'unauthorized'
  | 'rate_limited'
  | 'network'
  | 'unknown';

/**
 * A provider failure that names itself.
 *
 * The alternative — scraping a reason back out of the message string — is a
 * measurement the provider can silently break: ElevenLabs may reword its error copy
 * at any time, and the fallback line would quietly go from naming the cause to
 * saying `unknown` with nothing to indicate it had stopped working. Adapters
 * classify at the point where the status code is still in scope; everyone else
 * reads `reason`.
 */
export class VoiceProviderError extends Error {
  readonly provider: VoiceProviderId;
  readonly reason: VoiceFailureReason;
  readonly status?: number;

  constructor(
    message: string,
    init: {
      provider: VoiceProviderId;
      reason: VoiceFailureReason;
      status?: number;
      cause?: unknown;
    },
  ) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = 'VoiceProviderError';
    this.provider = init.provider;
    this.reason = init.reason;
    if (init.status !== undefined) this.status = init.status;
  }
}

/** The reason a failure carries, or `unknown` for a throw from anywhere else. */
export function failureReason(err: unknown): VoiceFailureReason {
  return err instanceof VoiceProviderError ? err.reason : 'unknown';
}

export type VoiceProvider = {
  readonly id: VoiceProviderId;
  /** Human-readable, used in log lines. */
  readonly label: string;
  /** Cheap check with no side effects and no model download. */
  available(): Promise<boolean>;
  /**
   * Why `available()` would say no, in one clause a person can act on.
   *
   * A boolean is enough for the chain — it just walks to the next link — but it is
   * not enough for the *record*, and the record is where this was costing real
   * money. A user who pasted an ElevenLabs key and got a Kokoro film had exactly
   * one trace of the decision: a `log.debug` line, in a stage whose output nobody
   * reads at debug level, saying the key was not set. The film, the summary and
   * `pipeline.json` all said nothing at all.
   *
   * So the head of the chain has to be able to explain itself, and the sentence
   * has to name the fixable thing — an environment variable, not "unavailable".
   * Only consulted when a link is actually rejected; a provider that never
   * refuses need not implement it.
   */
  unavailableReason?(): string | undefined;
  /** Voice ids this provider accepts. */
  voices(): Promise<string[]>;
  /** Best provider-native match for a requested storyboard voice. */
  resolveVoice(requested: string): Promise<string>;
  /**
   * Measured words per minute this voice speaks at `speed: 1`, if the provider
   * knows. The voice stage divides its target rate by this to get `speed`, which
   * is the only way a "140–160 wpm" instruction can be honoured rather than
   * hoped for. Return `undefined` when the rate is not characterised.
   */
  naturalWpm?(voice: string): number | undefined;
  /**
   * The largest unit this engine needs in order to sound like a person.
   *
   * Prosody is a property of the whole utterance handed to the engine: intonation rises
   * and falls across a sentence, and an engine given four words at a time has no sentence
   * to shape. It renders each fragment cold — flat pitch, a hard onset, a hard stop — and
   * the assembled scene is a run of abrupt little statements with silence between them.
   * That is not a gap-length problem and no amount of gap tuning fixes it.
   *
   * `clause` is only safe for an engine that is *told* what surrounds the fragment
   * (ElevenLabs takes `previous_text`/`next_text`, so it can shape a clause as part of the
   * sentence it came from). A local engine with no context window must be given whole
   * sentences. Return `undefined` to accept the caller's choice.
   */
  preferredSplit?(): PhraseSplit | undefined;
  /**
   * The engine that will actually speak, when the provider runs more than one.
   *
   * Reported because the record has to name it: `pipeline.json` said
   * `elevenlabs/af_heart` for every keyed project on disk — a *voice* id in the model
   * slot — while the model in force was whatever `ELEVENLABS_MODEL_ID` happened to
   * resolve to, and the bill was priced as if it were the expensive one. A provider
   * with one engine returns its id; one with none returns `undefined`.
   */
  modelId?(): string | undefined;
  /**
   * Everything about delivery this adapter decides and the stage cannot see.
   *
   * The stage's cache key hashes the narration, the voice and the pacing — all of
   * which it owns. It cannot see that an adapter pinned `stability`, or started
   * sending the surrounding clauses as context, or switched engines, and every one of
   * those is different audio for words that never moved. Fold them into a string here
   * and the clip key invalidates exactly when the audio would.
   */
  deliverySignature?(): string;
  synthesize(req: SynthesisRequest): Promise<SynthesisResult>;
  /** Release any cached handles. Must be safe to call twice. */
  dispose(): Promise<void>;
};
