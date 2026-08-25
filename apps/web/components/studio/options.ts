/**
 * The choices the create flow offers.
 *
 * Every list here mirrors something the pipeline genuinely accepts:
 *  - aspects and palettes are the enums in `StoryboardMeta`;
 *  - ink styles are the packs in `styles/` — a directory, not an enum, since plan item
 *    7.3. The four below are the ones this repo ships, and they are mirrored here for the
 *    same reason the voices are: the loader reads the filesystem and cannot be imported
 *    into a browser bundle. **A pack a user drops into `styles/` therefore works through
 *    the API and the CLI but does not appear in this picker** — closing that gap means
 *    serving `styleIds()` from a route, which nothing does yet;
 *  - voices are the 28 ids `kokoro-js` validates (`KOKORO_VOICES` in
 *    `@inkcast/voice`) — that package cannot be imported into a browser bundle,
 *    so the ids are mirrored, and the *shape* is derived rather than retyped;
 *  - languages are the ones `@inkcast/planner`'s edit vocabulary understands.
 *
 * Nothing is offered that the pipeline would reject.
 */
import type { Aspect, InkStyle, Palette } from '@/lib/api';

/* ------------------------------------------------------------------ aspects */

export type AspectOption = {
  value: Aspect;
  label: string;
  hint: string;
  /** Proportional glyph for the visual picker, on the 4px scale. */
  glyph: string;
};

export const ASPECTS: AspectOption[] = [
  { value: '16:9', label: 'Landscape', hint: 'YouTube, slides, docs', glyph: 'h-7 w-12' },
  { value: '9:16', label: 'Vertical', hint: 'Shorts, Reels, TikTok', glyph: 'h-9 w-5' },
  { value: '1:1', label: 'Square', hint: 'Feeds, embeds', glyph: 'h-8 w-8' },
];

/* ------------------------------------------------------------------- styles */

export type StyleOption = { value: InkStyle; label: string; hint: string };

export const INK_STYLES: StyleOption[] = [
  { value: 'marker', label: 'Marker', hint: 'Confident whiteboard strokes' },
  { value: 'pencil', label: 'Pencil', hint: 'Lighter, sketchier lines' },
  { value: 'chalk', label: 'Chalk', hint: 'Dusty, softer edges' },
  { value: 'ink', label: 'Ink', hint: 'Fine pen, technical' },
];

export type PaletteOption = { value: Palette; label: string; hint: string };

export const PALETTES: PaletteOption[] = [
  { value: 'color', label: 'Colour', hint: 'Six marker hues' },
  { value: 'mono', label: 'Mono', hint: 'One black marker' },
];

/* ---------------------------------------------------------------- languages */

export type LanguageOption = { value: string; label: string };

/** English first; the rest are what the planner's language vocabulary knows. */
export const LANGUAGES: LanguageOption[] = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'it', label: 'Italian' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'nl', label: 'Dutch' },
  { value: 'pl', label: 'Polish' },
  { value: 'sv', label: 'Swedish' },
  { value: 'tr', label: 'Turkish' },
  { value: 'ru', label: 'Russian' },
  { value: 'ar', label: 'Arabic' },
  { value: 'hi', label: 'Hindi' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
];

/** The local voice model only speaks these; anything else needs a cloud key. */
export const LOCAL_LANGUAGES = new Set(['en']);

/* ------------------------------------------------------------------- voices */

/**
 * The ids `kokoro-js` validates. `a` = American English, `b` = British English;
 * the second letter is the voice's register (`f`/`m`). Mirrors
 * `KOKORO_VOICES` in `packages/voice/src/providers/kokoro.ts`.
 */
const KOKORO_VOICE_IDS = [
  'af_heart',
  'af_alloy',
  'af_aoede',
  'af_bella',
  'af_jessica',
  'af_kore',
  'af_nicole',
  'af_nova',
  'af_river',
  'af_sarah',
  'af_sky',
  'am_adam',
  'am_echo',
  'am_eric',
  'am_fenrir',
  'am_liam',
  'am_michael',
  'am_onyx',
  'am_puck',
  'am_santa',
  'bf_emma',
  'bf_isabella',
  'bf_alice',
  'bf_lily',
  'bm_george',
  'bm_lewis',
  'bm_daniel',
  'bm_fable',
] as const;

export const DEFAULT_VOICE = 'af_heart';

export type VoiceOption = {
  value: string;
  /** `Heart` */
  name: string;
  /** `American · female` */
  group: string;
};

export const VOICES: VoiceOption[] = KOKORO_VOICE_IDS.map((value) => {
  const accent = value.startsWith('b') ? 'British' : 'American';
  const register = value[1] === 'm' ? 'male' : 'female';
  const bare = value.slice(3);
  return {
    value,
    name: bare.charAt(0).toUpperCase() + bare.slice(1),
    group: `${accent} · ${register}`,
  };
});

/** Voice groups in a stable order, for the select's `SelectGroup`s. */
export const VOICE_GROUPS: { group: string; voices: VoiceOption[] }[] = [
  'American · female',
  'American · male',
  'British · female',
  'British · male',
].map((group) => ({ group, voices: VOICES.filter((v) => v.group === group) }));

export function voiceLabel(id: string): string {
  const found = VOICES.find((v) => v.value === id);
  if (!found) return id;
  const accent = found.group.split(' · ')[0] ?? found.group;
  return `${found.name} · ${accent}`;
}

/* ----------------------------------------------------------------- examples */

export type Example = { id: string; label: string; title: string; text: string };

/**
 * One click fills the paste box. These are source documents, not prompts — the
 * planner reads structure, so a few real paragraphs demonstrate the product far
 * better than a one-line instruction would.
 */
export const EXAMPLES: Example[] = [
  {
    id: 'gradient-descent',
    label: 'Gradient descent',
    title: 'How gradient descent finds a minimum',
    text: `# Gradient descent

Training a model means finding the parameters that make its error as small as possible. The error, plotted against the parameters, is a surface with hills and valleys. We want the bottom of a valley.

## The step

At any point on that surface the gradient points in the direction the error rises fastest. So we move the opposite way, by a small amount called the learning rate:

    w := w - lr * dE/dw

## Why the learning rate matters

Too small and training crawls. Too large and each step overshoots the valley, bouncing up the far wall and diverging. The usual practice is to start larger and decay it as the surface flattens out.

## Where it gets stuck

Real surfaces are not one clean bowl. Saddle points flatten the gradient in one direction while it still falls in another, and momentum is what carries a step through them.`,
  },
  {
    id: 'https',
    label: 'How HTTPS works',
    title: 'What happens when you open an https:// link',
    text: `# What happens when you open an https:// link

Your browser has to find the server, prove it is really that server, and agree on a secret — before a single byte of the page is sent.

## 1. Find it

DNS turns the hostname into an IP address. The answer is cached at several layers, which is why the second visit feels instant.

## 2. Prove it

The server sends a certificate: its public key plus a signature from a certificate authority your browser already trusts. If the name on the certificate does not match the name you typed, the connection stops here.

## 3. Agree on a secret

Browser and server each generate a key pair, exchange public halves, and derive the same shared secret without ever sending it. That secret encrypts the rest of the session with a fast symmetric cipher.

## 4. Then, finally, the request

Only now does the browser send GET / — inside the encrypted tunnel.`,
  },
  {
    id: 'photosynthesis',
    label: 'Photosynthesis',
    title: 'Photosynthesis, from photon to sugar',
    text: `# Photosynthesis

A leaf turns light, water and carbon dioxide into sugar. It happens in two connected stages, and only the first one needs light.

## Light reactions

In the thylakoid membrane, chlorophyll absorbs a photon and loses an electron. Water is split to replace it, releasing oxygen as a by-product. The electron falls down a transport chain, and the energy it gives up pumps protons across the membrane. The proton gradient drives ATP synthase.

## The Calvin cycle

In the stroma, the ATP and NADPH from stage one are spent fixing carbon dioxide onto a five-carbon sugar. Six turns of the cycle build one glucose, and the five-carbon acceptor is regenerated each time so the cycle can continue.

## The trade-off

Opening stomata to let carbon dioxide in also lets water out. Every land plant is managing that trade-off.`,
  },
  {
    id: 'staging-deploy',
    label: 'Onboarding doc',
    title: 'Deploying to staging',
    text: `# Deploying to staging

Every change goes to staging before production. The whole path is four steps and one gate.

1. Open a pull request. CI runs the unit tests and the type check on every push.
2. When CI is green, a reviewer approves. One approval is enough for staging.
3. Merging to main builds a container image tagged with the commit sha and pushes it to the registry.
4. The deploy job rolls that image out to staging, one pod at a time, and waits for health checks between pods.

The gate: staging shares its database schema with production, so a migration must be backwards compatible. Add columns, do not rename them. If a rename is unavoidable, ship it as add, backfill, switch reads, drop — four deploys, not one.`,
  },
];

/* ----------------------------------------------------------------- uploads */

/**
 * Extensions the ingest stage can read. Mirrors `UPLOAD_EXTENSIONS` in
 * `app/api/_lib/schemas.ts`, which is what actually accepts or rejects the part.
 */
export const ACCEPTED_EXTENSIONS = [
  '.pdf',
  '.docx',
  '.md',
  '.markdown',
  '.txt',
  '.html',
  '.rtf',
  '.json',
] as const;

export const ACCEPT_ATTRIBUTE =
  '.pdf,.docx,.md,.markdown,.txt,.text,.html,.htm,.rtf,.json,application/pdf,text/markdown,text/plain,text/html';

/** 32 MB, matching the endpoint's own ceiling. */
export const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

/** Files the browser can read itself, so they go up as plain text. */
const TEXTUAL = new Set(['.md', '.markdown', '.txt', '.text']);

/** The endpoint's floor: below this the planner has nothing to structure. */
export const MIN_SOURCE_CHARS = 20;

/** The endpoint's ceiling on a pasted source. */
export const MAX_SOURCE_CHARS = 500_000;

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
}

export function isAcceptedFile(name: string): boolean {
  return (ACCEPTED_EXTENSIONS as readonly string[]).includes(extensionOf(name));
}

export function isTextualFile(name: string): boolean {
  return TEXTUAL.has(extensionOf(name));
}

/** Look up an example by the id used in `/studio?example=…`. */
export function findExample(id: string | null | undefined): Example | undefined {
  if (!id) return undefined;
  return EXAMPLES.find((e) => e.id === id);
}
