/**
 * Four voices, not twenty-eight.
 *
 * The studio's voice picker offered every id `kokoro-js` validates — 28 of them,
 * grouped by accent and register, named after the file on disk (`af_heart`,
 * `bm_fable`). That list is an *enumeration of an implementation*, and it fails the
 * person it is shown to twice over: nobody choosing a narrator for a lesson on the
 * cardiac conduction system knows what `am_fenrir` sounds like, and 24 of the 28
 * are voices `voices.ts` measured and then advised against — `af_aoede` cannot
 * reach the teaching band at all without smearing consonants, `bm_fable` has nearly
 * triple the pitch range of the calmest voice measured. An option the repo's own
 * audit rejects is not a choice, it is a trap with a nice name.
 *
 * So the picker becomes a *mood*: what the film should sound like, chosen from a
 * short list, with the engine underneath it decided by what the run can reach. Each
 * mood pins one ElevenLabs voice id **and** the Kokoro voice that stands in for it,
 * so the same mood is a coherent instruction whether the run is paid or local — and
 * so a whole-film failover (see `narrate()`) changes the engine without changing
 * what the user asked for.
 *
 * ## Nobody has heard these
 *
 * `verified: false` on every entry, and it is not a formality. `voices.ts` earned its
 * Kokoro table by synthesising a fixed 63-word paragraph in every candidate and
 * measuring it; there is no equivalent here, because the ElevenLabs side cannot be
 * measured without spending a paid key's characters, and the *decision* — "does this
 * sound like a teacher" — is not a measurement at all. What this file actually
 * contains is: ElevenLabs voice ids that are widely documented and long-lived (all
 * four are from the original default library, so the ids are as stable as anything
 * this provider has), paired with the Kokoro voice our own measured table names for
 * that accent, register and temperament. That is a defensible starting point and
 * nothing more. A human must listen to all four, in a finished film, before launch —
 * `docs/PLAN-LAUNCH.md` A5 says "select 2 candidate voice ids by listening, not by
 * docs", and this file is the honest admission that the listening has not happened.
 * Flip `verified` when it has, and say in the commit who listened.
 *
 * ## Why delivery settings are not per mood
 *
 * They are pinned once, for everyone, in `providers/elevenlabs.ts`
 * (`stability: 0.55, style: 0`) — chosen because a scene here is ten clause-length
 * generations concatenated and an expressive setting re-rolls its range on every
 * one. Giving each mood its own `stability` would be exactly the unheard taste claim
 * this file exists to avoid: the four moods differ by *voice*, which is a fact about
 * the catalogue, not by numbers someone guessed at. When a person has listened,
 * per-mood settings are the obvious next lever.
 */
import { speedForWpm, voiceProfile } from './voices.js';

/** The moods the picker offers. Ordered calmest first, which is also the default. */
export const VOICE_MOOD_IDS = ['calm', 'warm', 'bright', 'narrator'] as const;
export type VoiceMoodId = (typeof VOICE_MOOD_IDS)[number];

export function isVoiceMoodId(value: unknown): value is VoiceMoodId {
  return typeof value === 'string' && (VOICE_MOOD_IDS as readonly string[]).includes(value);
}

export type VoiceMood = {
  id: VoiceMoodId;
  /** Title case, as the picker shows it. */
  label: string;
  /** One line under the label. What the listener gets, not which engine speaks. */
  hint: string;
  /**
   * The pinned ElevenLabs voice, by id.
   *
   * By id and never by name, because the name is not stable: the voice at
   * `EXAVITQu4vr4xnSDxMaL` was published as "Bella" for years and appears as "Sarah"
   * in the current default library. Resolution goes straight to the id, so a rename
   * cannot silently re-cast a film — but `name` here may be stale, and is only ever
   * used in a log line.
   */
  elevenlabs: { voiceId: string; name: string };
  /**
   * The Kokoro voice that speaks this mood when the cloud one cannot.
   *
   * Chosen from `KOKORO_VOICE_PROFILES` on the measured note, not by ear: same
   * accent and register as the paid voice, and the entry whose note describes the
   * same temperament. A twin has to be able to *reach* the teaching band, so
   * `speedForWpm(twin) > 0.7` for all four — the point below which the duration
   * predictor smears consonants — and that is asserted in the tests.
   */
  kokoro: string;
  accent: 'en-us' | 'en-gb';
  register: 'female' | 'male';
  /**
   * False on every entry until a human has listened to a finished film in it.
   *
   * Read by the CLI and the studio so the admission is visible where the choice is
   * made rather than buried in a comment. See the module note above.
   */
  verified: boolean;
  /** Why this pairing, and what is unknown about it. */
  note: string;
};

export const VOICE_MOODS: readonly VoiceMood[] = [
  {
    id: 'calm',
    label: 'Calm',
    hint: 'Even and unhurried — the default for teaching',
    elevenlabs: { voiceId: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel' },
    kokoro: 'af_heart',
    accent: 'en-us',
    register: 'female',
    verified: false,
    note:
      'Rachel is the oldest and most documented narration voice ElevenLabs publishes, and was ' +
      'already this adapter’s hard-coded fallback id. Its twin is the flagship Kokoro voice ' +
      'the audit picked on measurement (grade A, steadiest level of the top tier), so the mood ' +
      'reads the same free or paid. This is the one pairing where the local half is measured.',
  },
  {
    id: 'warm',
    label: 'Warm',
    hint: 'Closer and more expressive, for stories and analogies',
    elevenlabs: { voiceId: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella / Sarah' },
    kokoro: 'af_bella',
    accent: 'en-us',
    register: 'female',
    verified: false,
    note:
      'Documented as the soft, warm voice of the original default library; renamed at some ' +
      'point, hence the double name — the id is what is pinned. The twin is Kokoro’s own ' +
      'af_bella (grade A-), which the audit measured as the widest level swing of the whole ' +
      'set and rejected as the *teaching* default for exactly that reason. Warm is where that ' +
      'energy belongs, but it is also the entry most likely to be wrong by ear.',
  },
  {
    id: 'bright',
    label: 'Bright',
    hint: 'Lighter and quicker, for short explainers',
    elevenlabs: { voiceId: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli' },
    kokoro: 'af_sarah',
    accent: 'en-us',
    register: 'female',
    verified: false,
    note:
      'Elli is documented as the young, emotive voice of the default library. Its twin is the ' +
      'voice our own table calls "even and clear, but bright with it" — a literal match, and ' +
      'the closest thing to a measured justification any of these pairings has. af_sarah needs ' +
      'the most slowing of the four twins (0.717) and so sits nearest the consonant-smear floor.',
  },
  {
    id: 'narrator',
    label: 'Narrator',
    hint: 'Lower and more formal, for documentary framing',
    elevenlabs: { voiceId: 'pNInz6obpgDQGcFmaJgB', name: 'Adam' },
    kokoro: 'am_michael',
    accent: 'en-us',
    register: 'male',
    verified: false,
    note:
      'Adam is the most-cited male narration id ElevenLabs has, and am_michael is what our own ' +
      'table names as "the pick when a male voice is wanted" — warmest and slowest of the ' +
      'male set, inside both calm bands. No British option ships in this list on purpose: four ' +
      'moods is the point, and an accent is the first thing to add once a human has listened.',
  },
];

/** Calmest first, and the one a storyboard gets when nothing asked for a mood. */
export const DEFAULT_MOOD: VoiceMoodId = 'calm';

const BY_ID = new Map<string, VoiceMood>(VOICE_MOODS.map((m) => [m.id, m]));

/**
 * The mood a requested voice names, if any.
 *
 * Accepts three things, because all three are already in the wild: a mood id
 * (`calm`), its label (`Calm`, from a UI that stored what it displayed), and either
 * pinned voice id — the ElevenLabs id or the Kokoro twin. That last one is what
 * keeps every storyboard already on disk working: `meta.voice` has defaulted to
 * `af_heart` since the first commit, and it resolves here to `calm` rather than to
 * nothing.
 *
 * Returns `undefined` for a voice id that is a real voice but not one of the four
 * (`bm_fable`, a cloned id). Those still work — the adapters fall through to their
 * own resolution — they simply are not a mood.
 */
export function voiceMood(requested: string | undefined): VoiceMood | undefined {
  if (!requested) return undefined;
  const key = requested.trim().toLowerCase();
  const direct = BY_ID.get(key);
  if (direct) return direct;
  return VOICE_MOODS.find(
    (m) =>
      m.label.toLowerCase() === key ||
      m.kokoro.toLowerCase() === key ||
      m.elevenlabs.voiceId.toLowerCase() === key,
  );
}

/**
 * The provider-native voice id this mood speaks with on the given provider.
 *
 * `system` and `silence` have no catalogue worth mapping into — `say` picks by
 * platform voice name and silence speaks nothing — so they get the Kokoro twin and
 * let their own `resolveVoice` do what it already does with it.
 */
export function moodVoiceId(mood: VoiceMood, provider: string): string {
  return provider === 'elevenlabs' ? mood.elevenlabs.voiceId : mood.kokoro;
}

/**
 * Moods no human has confirmed by ear yet — every one of them, today.
 *
 * A function rather than a constant so the answer changes the moment an entry is
 * flipped, and so a caller that wants to warn does not have to know how the flag is
 * stored.
 */
export function unverifiedMoods(): VoiceMood[] {
  return VOICE_MOODS.filter((m) => !m.verified);
}

/** The sentence the CLI and the studio print while `verified` is still false. */
export const MOODS_UNVERIFIED_NOTE =
  'these voices were selected from documentation, not by listening — a human must confirm them before launch';

/**
 * Everything wrong with the catalogue that can be checked without listening.
 *
 * Kept as runnable code rather than a comment because it is the only part of this
 * file that *is* verifiable: a twin the pipeline cannot slow into the teaching band
 * is a defect that ships as a mid-render warning and a fast, hard-to-follow film.
 * The tests call this; so can a human after editing the table.
 *
 * It deliberately checks the twins against `voices.ts`'s *measured* profiles rather
 * than against `KOKORO_VOICES`, which would make this module import the provider that
 * is about to import it. Membership in the id list kokoro-js validates is asserted in
 * the tests, where both sides can be seen at once.
 */
export function moodCatalogueProblems(): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const mood of VOICE_MOODS) {
    if (!voiceProfile(mood.kokoro))
      problems.push(`${mood.id}: "${mood.kokoro}" has no measured profile in voices.ts`);
    else if (!(speedForWpm(mood.kokoro) > 0.7))
      problems.push(
        `${mood.id}: "${mood.kokoro}" cannot reach the teaching band — it needs ${speedForWpm(
          mood.kokoro,
        )}, at or past the 0.7 floor where consonants smear`,
      );
    if (!/^[A-Za-z0-9]{20}$/.test(mood.elevenlabs.voiceId))
      problems.push(`${mood.id}: "${mood.elevenlabs.voiceId}" is not an ElevenLabs voice id`);
    if (seen.has(mood.elevenlabs.voiceId))
      problems.push(`${mood.id}: reuses the ElevenLabs voice ${mood.elevenlabs.voiceId}`);
    seen.add(mood.elevenlabs.voiceId);
    if (seen.has(mood.kokoro)) problems.push(`${mood.id}: reuses the Kokoro voice ${mood.kokoro}`);
    seen.add(mood.kokoro);
  }
  return problems;
}
