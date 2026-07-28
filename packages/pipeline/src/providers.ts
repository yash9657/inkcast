/**
 * Which provider each stage will actually use, decided from env only.
 *
 * The rule the whole project obeys: **local is the default**. A cloud provider
 * is chosen only when its key is present *and* the user asked for it. This
 * module is the single place that decision is described, so the cost report and
 * the CLI's provider table can never drift from what the stages do.
 */

const LOCAL_VOICE = /^(af_|am_|bf_|bm_|kokoro|say)/i;

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

export function voiceProvider(
  voiceId: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ProviderChoice {
  const id = (voiceId ?? env.INKCAST_VOICE ?? 'af_heart').trim();
  const key = Boolean(env.ELEVENLABS_API_KEY);
  if (LOCAL_VOICE.test(id) || !key) {
    return {
      name: id.toLowerCase().startsWith('say') ? 'say' : 'kokoro',
      cloud: false,
      why: key ? `voice "${id}" is a local voice` : 'ELEVENLABS_API_KEY is unset',
      model: id,
    };
  }
  return {
    name: 'elevenlabs',
    cloud: true,
    why: `ELEVENLABS_API_KEY is set and voice "${id}" is not a local voice`,
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
