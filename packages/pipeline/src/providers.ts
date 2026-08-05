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
