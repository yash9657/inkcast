/**
 * The four keys Inkcast can use, what each one unlocks, and what happens without
 * it.
 *
 * This module is the single source of truth for both sides of the wire: the API
 * routes under `app/api/keys/**` read `envVar` and `looksLike` from here, and the
 * settings UI reads the prose from here. Keeping them together is what stops the
 * page promising a capability the pipeline does not actually gain.
 *
 * It is deliberately free of React, of `node:*` and of any secret: only names,
 * copy and shape rules. That is why a route handler can import it.
 *
 * The ordering is the recommendation. `anthropic` is first because it is not a
 * peer of the other three — it is the difference between a video that teaches and
 * a video that reads a document aloud.
 */

export const PROVIDER_IDS = ['fireworks', 'anthropic', 'elevenlabs', 'replicate', 'fal'] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

/** Which pipeline stage a key changes. Mirrors `Providers` in @inkcast/pipeline. */
export type ProviderStage = 'plan' | 'voice' | 'images';

export type ShapeRule = {
  /** Expected leading characters, when the provider commits to one. */
  prefix?: string;
  /** Shortest a real key of this kind has ever been, minus a safety margin. */
  minLength: number;
  /** Plain-language description of the shape, shown under the paste field. */
  describe: string;
};

export type ProviderInfo = {
  id: ProviderId;
  /** Company name, as they spell it. */
  label: string;
  /**
   * The canonical environment variable the pipeline reads. Shown to the user and
   * written when a stored key is injected.
   */
  envVar: string;
  /**
   * Every variable that may hold this key, in precedence order, canonical first.
   * Mirrors `PROVIDER_SPECS[...].envVars` in `@inkcast/keyvault` — `fal` has two
   * because `FAL_API_KEY` is fal's older name and still turns up in shells.
   */
  envVars: readonly string[];
  stage: ProviderStage;
  /** One line: the job this key does. */
  role: string;
  /** What the pipeline can do once the key is present. */
  unlocks: string;
  /** What the pipeline does instead when it is absent. Never "it breaks". */
  without: string;
  /**
   * How much this key changes the output. `1` is the quality lever; `2` is a
   * clear improvement; `3` is optional polish.
   */
  rank: 1 | 2 | 3;
  /** Where to get one. */
  console: { href: string; label: string };
  /** Rough per-video cost, stated as a number rather than an adjective. */
  cost: string;
  looksLike: ShapeRule;
  /** Set with a sibling, and only one of them is used. */
  alternativeTo?: ProviderId;
};

export const PROVIDERS: readonly ProviderInfo[] = [
  {
    id: 'fireworks',
    label: 'Fireworks',
    envVar: 'FIREWORKS_API_KEY',
    envVars: ['FIREWORKS_API_KEY'],
    stage: 'plan',
    role: 'Plans, draws and reviews',
    unlocks:
      'Open-weight models write lessons, compose vector diagrams and review rendered frames. Preferred when configured. Pair with local Kokoro speech; raster illustration generation needs a separate image provider.',
    without: 'Uses another configured planning provider, or the limited local document planner.',
    rank: 1,
    console: {
      href: 'https://app.fireworks.ai/settings/users/api-keys',
      label: 'app.fireworks.ai',
    },
    cost: 'Depends on model, tokens and revision count',
    looksLike: { minLength: 20, describe: 'your Fireworks API key' },
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    envVar: 'ANTHROPIC_API_KEY',
    envVars: ['ANTHROPIC_API_KEY'],
    stage: 'plan',
    role: 'Plans the lesson',
    unlocks:
      'Claude writes the lesson before anything is drawn: a hook, an everyday anchor for the idea, one new step at a time with a reason for each, a worked example with real numbers, and the wrong belief a learner usually forms, named and refuted. It also handles plain-language edits to a finished storyboard.',
    without:
      'The local planner splits the document into beats and narrates them in order. It is deterministic, free and instant, and it summarises rather than teaches — the video will describe your document instead of building an idea in the viewer.',
    rank: 1,
    console: {
      href: 'https://console.anthropic.com/settings/keys',
      label: 'console.anthropic.com',
    },
    cost: 'a few cents per video',
    looksLike: {
      prefix: 'sk-ant-',
      minLength: 40,
      describe: 'starts with sk-ant- and is about 100 characters',
    },
  },
  {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    envVar: 'ELEVENLABS_API_KEY',
    envVars: ['ELEVENLABS_API_KEY'],
    stage: 'voice',
    role: 'Speaks the narration',
    unlocks:
      'Narration in a voice a learner will sit through for three minutes, with word-level timings so a diagram lands on the exact word that names it — and the other fifteen languages the studio offers.',
    without:
      'Kokoro synthesises the narration on this machine, in English, for nothing. Its better voices are listenable; none of them are as good as a cloud voice for something you intend to publish.',
    rank: 2,
    console: { href: 'https://elevenlabs.io/app/settings/api-keys', label: 'elevenlabs.io' },
    cost: 'about $0.10 per minute',
    looksLike: { minLength: 24, describe: '32 hex characters, or a key beginning sk_' },
  },
  {
    id: 'replicate',
    label: 'Replicate',
    envVar: 'REPLICATE_API_TOKEN',
    envVars: ['REPLICATE_API_TOKEN'],
    stage: 'images',
    role: 'Draws the illustrations',
    unlocks:
      'Drawn objects, characters and scenes — a hillside with a figure on it, a laptop, a leaf — synthesised once, vectorised, roughened to match the ink, then reused by id everywhere they appear.',
    without:
      'Visuals come from the built-in icon set and procedural diagram layout. Roughened line icons in boxes are honest and free, and they are not a visual language.',
    rank: 3,
    console: { href: 'https://replicate.com/account/api-tokens', label: 'replicate.com' },
    cost: 'about $0.01 per illustration',
    looksLike: { prefix: 'r8_', minLength: 20, describe: 'starts with r8_' },
    alternativeTo: 'fal',
  },
  {
    id: 'fal',
    label: 'fal',
    envVar: 'FAL_KEY',
    envVars: ['FAL_KEY', 'FAL_API_KEY'],
    stage: 'images',
    role: 'Draws the illustrations',
    unlocks:
      'The same drawn-illustration lane as Replicate, usually faster. Set one of the two, not both — Replicate wins if you set them both.',
    without:
      'Visuals come from the built-in icon set and procedural diagram layout, exactly as with no image key at all.',
    rank: 3,
    console: { href: 'https://fal.ai/dashboard/keys', label: 'fal.ai' },
    cost: 'about $0.01 per illustration',
    looksLike: { minLength: 20, describe: 'a key id and secret joined by a colon' },
    alternativeTo: 'replicate',
  },
];

const BY_ID = new Map<ProviderId, ProviderInfo>(PROVIDERS.map((p) => [p.id, p]));

export function providerInfo(id: ProviderId): ProviderInfo {
  const found = BY_ID.get(id);
  // `id` is a literal union, so this is unreachable by construction. It exists
  // because a route can be handed anything until zod has narrowed it.
  if (!found) throw new Error(`unknown provider "${String(id)}"`);
  return found;
}

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && (PROVIDER_IDS as readonly string[]).includes(value);
}

/** Every environment variable the vault is allowed to manage. */
export const MANAGED_ENV_VARS: readonly string[] = PROVIDERS.flatMap((p) => [...p.envVars]);

/* --------------------------------------------------------------- key shapes */

export type ShapeVerdict =
  /** Usable. `warning` is set when it does not look like this provider's format. */
  | { ok: true; warning?: string }
  /** Structurally unusable — worth refusing before it reaches a provider. */
  | { ok: false; problem: string };

/**
 * Judge a pasted key on shape alone.
 *
 * The split matters. Whitespace and length are *refusals*: a key with a space in
 * it is a mis-paste every time, and telling the user immediately beats a 401 ten
 * seconds later. A wrong prefix is only a *warning*, because providers change
 * their formats and a schema that refuses tomorrow's valid key is worse than one
 * that lets it through with a note.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export function judgeKeyShape(id: ProviderId, key: string): ShapeVerdict {
  const info = providerInfo(id);
  if (key === '') return { ok: false, problem: 'The field is empty.' };
  if (/\s/.test(key)) {
    return {
      ok: false,
      problem:
        'That contains a space or a line break, so something extra came along with the paste.',
    };
  }
  if (key.length < info.looksLike.minLength) {
    return {
      ok: false,
      problem: `That is only ${key.length} characters. A ${info.label} key is at least ${info.looksLike.minLength} — ${info.looksLike.describe}.`,
    };
  }
  if (info.looksLike.prefix && !key.startsWith(info.looksLike.prefix)) {
    return {
      ok: true,
      warning: `Saved, but a ${info.label} key normally ${info.looksLike.describe}. Validate it to be sure.`,
    };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ masking */

/**
 * Prefixes that identify a provider and carry no secret material — every key
 * from that provider has them, so showing one in full reveals nothing.
 *
 * Kept identical to `PUBLIC_PREFIXES` in `@inkcast/keyvault`'s `mask.ts`, because
 * a mask is stored beside the ciphertext: if the two algorithms disagreed, every
 * preview written before the studio adopts that package would render differently
 * from every preview written after it.
 */
const PUBLIC_PREFIXES = [
  'sk-ant-api03-',
  'sk-ant-api',
  'sk-ant-oat01-',
  'sk-ant-oat',
  'sk-ant-',
  'sk-proj-',
  'sk_live_',
  'sk_test_',
  'sk-',
  'sk_',
  'r8_',
  'hf_',
  'ghp_',
] as const;

const MASK_LEAD = 2;
const MASK_TAIL = 4;
/** Below this, showing six characters of the body reveals too much of it. */
const MASK_MIN_BODY = 10;

/**
 * A preview that identifies a key without being one.
 *
 * The public prefix is shown in full because it is what makes the preview legible
 * at a glance; of the remaining body only two leading and four trailing
 * characters appear, and only when the body is long enough for the middle to stay
 * hidden. The invariant: no contiguous run from the middle of the key is ever
 * rendered.
 */
export function maskSecret(raw: string | undefined | null): string {
  const key = (raw ?? '').trim();
  if (key.length === 0) return '';

  const prefix = PUBLIC_PREFIXES.find((candidate) => key.startsWith(candidate)) ?? '';
  const body = key.slice(prefix.length);

  if (body.length < MASK_MIN_BODY) return `${prefix}${'\u2022'.repeat(6)}`;
  return `${prefix}${body.slice(0, MASK_LEAD)}\u2026${body.slice(-MASK_TAIL)}`;
}

/* ------------------------------------------------- how a stage is described */

export const STAGE_LABEL: Record<ProviderStage, string> = {
  plan: 'Lesson planning',
  voice: 'Narration',
  images: 'Illustration',
};
