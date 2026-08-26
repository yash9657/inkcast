/**
 * Which provider each stage will actually use, decided from env only.
 *
 * The rule the whole project obeys: **local is the default**. A cloud provider
 * is chosen only when its key is present *and* the user asked for it. This
 * module is the single place that decision is described, so the cost report and
 * the CLI's provider table can never drift from what the stages do.
 */

/**
 * Ids that pin a voice to a local provider whatever key is present.
 *
 * A provider *name* — bare or as a prefix — pins; a voice name does not. That is the whole
 * correction here: `af_heart` names a voice and used to be read as "stay local".
 */
const PINNED_LOCAL = /^(kokoro|local|say|system)(:|$)/i;

export type ProviderChoice = {
  /** Provider id, e.g. `heuristic`, `anthropic`, `kokoro`, `elevenlabs`. */
  name: string;
  /** True when the work leaves the machine and can cost money. */
  cloud: boolean;
  /** Human-readable reason for this choice — printed by `inkcast providers`. */
  why: string;
  /** Model / voice id passed to the provider, when it has one. */
  model?: string;
};

export type Providers = {
  planner: ProviderChoice;
  voice: ProviderChoice;
  images: ProviderChoice;
};

const CLAUDE_DEFAULT = 'claude-opus-5';

export function plannerProvider(env: NodeJS.ProcessEnv = process.env): ProviderChoice {
  const want = (env.INKCAST_PLANNER ?? '').trim();
  const key = Boolean(env.ANTHROPIC_API_KEY);
  if (want === 'local' || want === 'heuristic') {
    return { name: 'heuristic', cloud: false, why: 'INKCAST_PLANNER=local' };
  }
  if (!key) {
    return {
      name: 'heuristic',
      cloud: false,
      why: want
        ? `INKCAST_PLANNER=${want} but ANTHROPIC_API_KEY is unset`
        : 'ANTHROPIC_API_KEY is unset',
    };
  }
  const model = want === '' || want === 'anthropic' || want === 'claude' ? CLAUDE_DEFAULT : want;
  return { name: 'anthropic', cloud: true, why: 'ANTHROPIC_API_KEY is set', model };
}

/**
 * Which voice a render will use — and this mirrors `defaultChain` in `@inkcast/voice`
 * deliberately, because a report that disagrees with the stage is worse than no report.
 *
 * **A present key wins.** The old rule asked whether the *voice id* looked local, and the
 * id defaults to `af_heart`, which does — so a user who pasted an ElevenLabs key was told
 * "voice af_heart is a local voice" and got the free model for a paid key. The id names a
 * voice, not a provider; the ElevenLabs adapter maps a Kokoro family onto a stock voice of
 * the same accent and gender (`af_heart` → Rachel), so a bare id is no reason to refuse the
 * better provider. Pin the free one explicitly with `kokoro:` or `local:`.
 */
export function voiceProvider(
  voiceId: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ProviderChoice {
  const id = (voiceId ?? env.INKCAST_VOICE ?? 'af_heart').trim();
  const key = Boolean(env.ELEVENLABS_API_KEY);
  const pinned = PINNED_LOCAL.exec(id)?.[1]?.toLowerCase() ?? '';
  if (pinned || !key) {
    return {
      name: pinned === 'say' || pinned === 'system' ? 'say' : 'kokoro',
      cloud: false,
      why: pinned ? `voice "${id}" is pinned to a local provider` : 'ELEVENLABS_API_KEY is unset',
      // A bare provider name is its own model id; a prefixed one carries the voice after it.
      model: id.replace(/^(?:kokoro|local|say|system):/i, '') || id,
    };
  }
  return {
    name: 'elevenlabs',
    cloud: true,
    why: `ELEVENLABS_API_KEY is set — pin \`kokoro:${id}\` to stay local`,
    model: id.replace(/^elevenlabs:/i, ''),
  };
}

/**
 * The ElevenLabs engine this environment will speak with. `''` for every other provider.
 *
 * **Mirrored** from `elevenLabsModel()` in `@inkcast/voice`, and the duplication is
 * deliberate for the same reason `voiceProvider` mirrors `defaultChain`: the pipeline
 * decides whether to run the voice stage *before* it has loaded the voice stage (see
 * the header of `stages.ts` — a static import here would turn "that package is still
 * installing" into a module-resolution stack trace), and the engine has to be inside
 * that decision. `test/voice-key.test.ts` pins the two constants against each other,
 * so the mirror fails a test rather than silently drifting into a stale cache.
 *
 * It is read from the environment rather than observed because it is used to decide
 * whether anything needs re-recording, which is a question that has to be answerable
 * before a single character is spoken.
 */
export const ELEVENLABS_DEFAULT_MODEL = 'eleven_multilingual_v2';

export function voiceEngine(provider: string, env: NodeJS.ProcessEnv = process.env): string {
  if (provider !== 'elevenlabs') return '';
  return env.ELEVENLABS_MODEL_ID || ELEVENLABS_DEFAULT_MODEL;
}

/**
 * The choice as the run turned out, which is the only one anybody may be billed for.
 *
 * `voiceProvider` above answers "what will this environment reach for" — a prediction
 * made before a single character is spoken. The chain can demote mid-run (an expired
 * key, a rate limit, an exhausted balance) and then the prediction is simply wrong.
 *
 * `projects/cardiac8` is that case, reconstructed rather than assumed, because a
 * future session will otherwise re-derive it from the pipeline.json alone and get it
 * backwards. The file books a $0.4286 ElevenLabs line and the film is Kokoro:
 *
 *  - The keyed chain — a present `ELEVENLABS_API_KEY` puts ElevenLabs *first* — landed
 *    in `86ae285` on 2026-08-05. `cardiac8` was cast on 2026-08-07, so ElevenLabs was
 *    reached, not skipped.
 *  - All ten of its `voice:scene:N` cache entries recompute exactly as
 *    `kokoro`/`af_heart` under the stage's own key inputs (sha256 over narration,
 *    provider, voice, speed, split, delivery). Kokoro spoke the whole film.
 *  - Scene 0's entry was keyed with the *clause* split and scenes 1-9 with the
 *    *sentence* split, and the clips agree: run `splitPhrases(normalizeNarration(…))`
 *    over each narration and only scene 0's `audio/scene-000.timing.json` matches
 *    `clause`, while 1-9 match `sentence`. That split comes from the active provider's
 *    `preferredSplit`: sentence is Kokoro's, and ElevenLabs declares none, so it gets
 *    the `clause` default. ElevenLabs was active when scene 0 began and was gone by
 *    scene 1 — a demotion, at the first request, on an exhausted quota
 *    (`docs/PLAN-GOLPO-PARITY.md`).
 *
 * So the demotion is the demonstrated event, and the $0.4286 is what it cost to derive
 * the record from the environment instead of asking the stage.
 *
 * `cloud` is the field that matters. It is the one thing standing between a kokoro run
 * and a bill, so it is derived here from the provider that spoke and from nothing else.
 */
export function resolvedVoiceChoice(
  resolved: { provider: string; model?: string; voice: string },
  requested: ProviderChoice,
): ProviderChoice {
  const name = resolved.provider === 'system' ? 'say' : resolved.provider;
  return {
    name,
    cloud: resolved.provider === 'elevenlabs',
    why:
      name === requested.name ? requested.why : `requested ${requested.name}, resolved to ${name}`,
    // The engine, and *only* the engine. This slot used to fall back to the voice id,
    // which reproduced the very string this phase exists to correct: on a cached
    // re-run nothing resolves a model, so `elevenlabs` + `af_heart` was written back
    // to disk as `elevenlabs/af_heart` — a voice where a model belongs, disagreeing
    // with the terminal, which prints the engine or nothing.
    ...(resolved.model ? { model: resolved.model } : {}),
  };
}

/**
 * The choice the **bill** is computed from, which is not always the one that finished.
 *
 * A mid-run demotion produces a genuinely mixed film: exhaustion is only discovered at
 * the first request that fails, so the scenes before it were spoken by the paid
 * provider and really were billed. Reporting only who finished would under-state that
 * run to zero — the same defect as `cardiac8`, pointing the other way.
 *
 * `engine` is what the paid provider was running when it spent that money, measured by
 * the stage (`ResolvedVoice.modelByProvider`) rather than inferred. It has to be passed
 * in because `resolved` describes the provider that *finished*, whose engine is the
 * wrong one to price with: leaving it unnamed bills at the full credit rate, and flash
 * costs half — a 2× over-charge on exactly the run this function exists for.
 */
export function billedVoiceChoice(
  resolved: { provider: string; model?: string; voice: string },
  paidChars: number,
  requested: ProviderChoice,
  engine?: string,
): ProviderChoice {
  const choice = resolvedVoiceChoice(resolved, requested);
  if (paidChars <= 0 || choice.cloud) return choice;
  return {
    name: 'elevenlabs',
    cloud: true,
    why: `${paidChars} characters were spoken by elevenlabs before it fell back to ${choice.name}`,
    // Absent when the stage could not name it, and an unnamed engine is billed at the
    // full rate (`cost.ts`) — failing expensive is the safe direction for a number
    // someone reconciles against an invoice.
    ...(engine ? { model: engine } : {}),
  };
}

export function imageProvider(env: NodeJS.ProcessEnv = process.env): ProviderChoice {
  if (env.REPLICATE_API_TOKEN) {
    return { name: 'replicate', cloud: true, why: 'REPLICATE_API_TOKEN is set' };
  }
  if (env.FAL_KEY) return { name: 'fal', cloud: true, why: 'FAL_KEY is set' };
  return { name: 'builtin', cloud: false, why: 'no image provider key set' };
}

export function providers(voiceId?: string, env: NodeJS.ProcessEnv = process.env): Providers {
  return {
    planner: plannerProvider(env),
    voice: voiceProvider(voiceId, env),
    images: imageProvider(env),
  };
}

export function fullyLocal(p: Providers): boolean {
  return !p.planner.cloud && !p.voice.cloud && !p.images.cloud;
}
