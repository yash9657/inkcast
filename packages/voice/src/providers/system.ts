/**
 * macOS `say` — the zero-download, zero-network safety net.
 *
 * Quality is well below Kokoro's, so this is never the default. What it is, is
 * *always there*: no weights, no npm package, no ffmpeg. When the Kokoro download
 * fails or has not happened yet, this is what keeps `pnpm cast` working on a
 * fresh clone with no API keys.
 *
 * `say --file-format=WAVE --data-format=LEI16@24000` writes exactly the clip
 * format the rest of the stage expects in one step, so no conversion is needed.
 * (The default `-o out.aiff` form writes compressed AIFF-C, and pairing
 * `--data-format=LEI16@…` with an `.aiff` extension fails outright — little-endian
 * PCM cannot live in an AIFF container.)
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '@inkcast/core';
import { CLIP_SAMPLE_RATE } from '../wav.js';
import { run } from '../audio.js';
import type { SynthesisRequest, SynthesisResult, VoiceProvider } from './types.js';

const log = logger('voice:system');

export const SAY_BIN = '/usr/bin/say';
const BASE_WPM = 175;

/** Preference order per Kokoro voice family, best-sounding first. */
const PREFERENCES: Record<string, readonly string[]> = {
  af: ['Samantha', 'Ava', 'Allison', 'Susan', 'Kathy', 'Victoria', 'Nicky', 'Zoe'],
  am: ['Alex', 'Tom', 'Aaron', 'Nathan', 'Evan', 'Reed (English (US))', 'Eddy (English (US))', 'Fred'],
  bf: ['Serena', 'Kate', 'Stephanie', 'Fiona', 'Shelley (English (UK))', 'Flo (English (UK))'],
  bm: ['Daniel', 'Oliver', 'Arthur', 'Malcolm', 'Rocko (English (UK))', 'Reed (English (UK))'],
};

export type SayVoice = { name: string; locale: string };

/** Parse `say -v '?'`. Names contain spaces and parentheses, so anchor on the locale. */
export function parseSayVoices(stdout: string): SayVoice[] {
  const voices: SayVoice[] = [];
  for (const line of stdout.split('\n')) {
    const m = /^(.+?)\s+([a-z]{2}[_-][A-Za-z]{2,})\s+#/.exec(line.trim());
    if (!m) continue;
    const [, name, locale] = m;
    if (name && locale) voices.push({ name: name.trim(), locale });
  }
  return voices;
}

let voiceList: Promise<SayVoice[]> | undefined;

function listVoices(): Promise<SayVoice[]> {
  // Generous timeout: enumerating ~180 installed voices takes several seconds
  // the first time the speech service is touched after boot.
  voiceList ??= run(SAY_BIN, ['-v', '?'], 60_000).then(
    ({ stdout }) => parseSayVoices(stdout),
    (err: unknown) => {
      log.debug('say -v ? failed', err);
      return [];
    },
  );
  return voiceList;
}

/**
 * Map a storyboard voice id onto an installed `say` voice.
 *
 * Storyboard voices are Kokoro ids (`af_heart`), so the family prefix carries the
 * accent and gender: `a`/`b` = American/British, `f`/`m` = female/male.
 */
export function pickSayVoice(requested: string, installed: SayVoice[]): string | undefined {
  if (!installed.length) return undefined;
  const byName = new Map(installed.map((v) => [v.name.toLowerCase(), v.name]));

  // An explicit macOS voice name wins outright.
  const exact = byName.get(requested.toLowerCase());
  if (exact) return exact;

  const family = /^([ab])([fm])_/.exec(requested);
  const key = family ? `${family[1]}${family[2]}` : 'af';
  for (const candidate of PREFERENCES[key] ?? []) {
    const hit = byName.get(candidate.toLowerCase());
    if (hit) return hit;
  }

  // Nothing preferred is installed: settle for the right accent, then anything.
  const wantGb = key.startsWith('b');
  const english = installed.filter((v) => v.locale.toLowerCase().startsWith('en'));
  const accent = english.filter((v) => (wantGb ? /gb/i.test(v.locale) : /us/i.test(v.locale)));
  return accent[0]?.name ?? english[0]?.name ?? installed[0]?.name;
}

export function createSystemProvider(): VoiceProvider {
  let availability: Promise<boolean> | undefined;

  return {
    id: 'system',
    label: 'macOS say (offline)',

    available() {
      availability ??= (async () => {
        if (process.platform !== 'darwin') {
          log.debug('system voice provider is macOS-only');
          return false;
        }
        const voices = await listVoices();
        if (!voices.length) {
          log.warn('`say` produced no voices — skipping the system provider');
          return false;
        }
        return true;
      })();
      return availability;
    },

    async voices() {
      return (await listVoices()).filter((v) => /^en/i.test(v.locale)).map((v) => v.name);
    },

    async resolveVoice(requested: string) {
      const override = process.env.INKCAST_SAY_VOICE;
      const installed = await listVoices();
      const picked = pickSayVoice(override ?? requested, installed);
      if (!picked) throw new Error('no macOS voices are installed');
      if (picked.toLowerCase() !== (override ?? requested).toLowerCase()) {
        log.info(`voice "${requested}" mapped to the macOS voice "${picked}"`);
      }
      return picked;
    },

    async synthesize(req: SynthesisRequest): Promise<SynthesisResult> {
      await mkdir(path.dirname(req.outPath), { recursive: true });

      // Pass the text via a file: scene narration can exceed argv limits and this
      // sidesteps every quoting question at once.
      const textPath = `${req.outPath}.say.txt`;
      await writeFile(textPath, req.text, 'utf8');

      const wpm = Math.round(Math.max(90, Math.min(400, BASE_WPM * req.speed)));
      try {
        await run(
          SAY_BIN,
          [
            '-v', req.voice,
            '-r', String(wpm),
            '-f', textPath,
            '--file-format=WAVE',
            `--data-format=LEI16@${CLIP_SAMPLE_RATE}`,
            '-o', req.outPath,
          ],
          180_000,
        );
      } finally {
        await rm(textPath, { force: true });
      }
      return {};
    },

    async dispose() {
      // Nothing to release — `say` is a one-shot subprocess.
    },
  };
}
