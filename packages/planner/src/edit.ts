import { providerEnv } from '@inkcast/core';
import { textProvider } from '@inkcast/core';
/**
 * Natural-language editing of a storyboard.
 *
 * With `ANTHROPIC_API_KEY` set, the instruction goes to Claude, which returns a
 * patched storyboard that is re-validated against the IR.
 *
 * Without a key this is still genuinely useful: a deterministic parser handles
 * the instructions that are mechanical rather than creative — retitling, voice,
 * palette, aspect, ink style, language, fps, outro length, per-scene pacing and
 * scene removal. Anything that needs new prose or new visuals is reported as
 * "needs a key" with a clear warning instead of being silently ignored.
 */
import type { Storyboard } from '@inkcast/core';
import { logger, parseStoryboard, styleIds } from '@inkcast/core';
import { anthropicEdit } from './anthropic.js';
import { layoutStoryboard } from './layout.js';
import type { EditOptions, EditReport } from './types.js';

const log = logger('planner:edit');

/** Instructions that plainly require the model to write something new. */
const NEEDS_MODEL =
  /\b(rewrite|reword|rephrase|shorten the narration|expand|explain|add a scene|new scene|split scene|merge scene|make it funnier|friendlier|more formal|simpler|translate|change the wording|say instead|mention|different visual|use a diagram|redraw)\b/i;

const LANGUAGES: Record<string, string> = {
  english: 'en',
  spanish: 'es',
  french: 'fr',
  german: 'de',
  italian: 'it',
  portuguese: 'pt',
  dutch: 'nl',
  japanese: 'ja',
  korean: 'ko',
  chinese: 'zh',
  mandarin: 'zh',
  hindi: 'hi',
  arabic: 'ar',
  russian: 'ru',
  polish: 'pl',
  turkish: 'tr',
  swedish: 'sv',
};

/** Split a multi-part instruction into single actions. */
export function splitInstructions(instruction: string): string[] {
  return instruction
    .split(/[;\n]+|\band then\b|\balso,\s*|\band make\b/gi)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

/* --------------------------------------------------------------- the parser */

type Applied = { sb: Storyboard; note: string; structural?: boolean } | undefined;

function applyOne(sb: Storyboard, raw: string): Applied {
  const s = raw.trim();
  const lower = s.toLowerCase();

  /* --- title --- */
  const title =
    s.match(
      /\b(?:retitle|rename|title)\b[^"'\w]*(?:it|the video|this)?\s*(?:to|as|:)?\s*["“']([^"”']+)["”']/i,
    ) ??
    s.match(/\b(?:retitle|rename)\b(?:\s+(?:it|the video|this))?\s+(?:to|as)\s+(.+)$/i) ??
    s.match(/^\s*title\s*[:=]\s*(.+)$/i) ??
    s.match(/\bcall it\s+["“']?([^"”']+)["”']?$/i);
  if (title?.[1]) {
    const next = title[1].trim().replace(/[.]$/, '');
    if (next) {
      sb.title = next;
      return { sb, note: `title set to "${next}"` };
    }
  }

  /* --- voice --- */
  const voice =
    s.match(/\bvoice\b\s*(?:to|=|:)?\s*([a-z]{2}_[a-z]+)/i) ??
    s.match(/\buse\s+([a-z]{2}_[a-z]+)\b/i);
  if (voice?.[1]) {
    sb.meta.voice = voice[1].toLowerCase();
    return { sb, note: `voice set to ${sb.meta.voice}` };
  }

  /* --- palette --- */
  if (/\b(mono|monochrome|black and white|greyscale|grayscale|no colour|no color)\b/i.test(lower)) {
    sb.meta.palette = 'mono';
    return { sb, note: 'palette set to mono' };
  }
  if (
    /\b(colour|color|colourful|colorful)\b/i.test(lower) &&
    /\b(add|use|make|switch|change|in)\b/i.test(lower)
  ) {
    sb.meta.palette = 'color';
    return { sb, note: 'palette set to color' };
  }

  /* --- aspect --- */
  if (/\b(9:16|vertical|portrait|tiktok|reels?|shorts?)\b/i.test(lower)) {
    const changed = sb.meta.aspect !== '9:16';
    sb.meta.aspect = '9:16';
    return { sb, note: 'aspect set to 9:16', structural: changed };
  }
  if (/\b(1:1|square)\b/i.test(lower)) {
    const changed = sb.meta.aspect !== '1:1';
    sb.meta.aspect = '1:1';
    return { sb, note: 'aspect set to 1:1', structural: changed };
  }
  if (/\b(16:9|landscape|widescreen|horizontal)\b/i.test(lower)) {
    const changed = sb.meta.aspect !== '16:9';
    sb.meta.aspect = '16:9';
    return { sb, note: 'aspect set to 16:9', structural: changed };
  }

  /* --- ink style --- */
  // From `styles/` (plan 7.3), not a literal: this path is what a keyless edit falls back
  // to, and it would silently ignore "make it modern-minimal" for a pack that exists.
  const style = lower.match(new RegExp(`\\b(${styleIds().join('|')})\\b`));
  if (style?.[1] && /\b(style|look|draw|drawn|use|switch|change|make)\b/.test(lower)) {
    sb.meta.style = style[1] as Storyboard['meta']['style'];
    return { sb, note: `ink style set to ${style[1]}` };
  }

  /* --- language --- */
  const langCode = s.match(/\blanguage\b\s*(?:to|=|:)?\s*([a-z]{2}(?:-[A-Za-z]{2})?)\b/i);
  if (langCode?.[1]) {
    sb.meta.language = langCode[1].toLowerCase();
    return { sb, note: `language set to ${sb.meta.language}` };
  }
  for (const [name, code] of Object.entries(LANGUAGES)) {
    if (new RegExp(`\\b(?:in|to|into)\\s+${name}\\b`, 'i').test(lower)) {
      sb.meta.language = code;
      return { sb, note: `language set to ${code}` };
    }
  }

  /* --- fps --- */
  const fps = s.match(/\b(\d{1,3})\s*fps\b/i) ?? s.match(/\bfps\b\s*(?:to|=|:)?\s*(\d{1,3})/i);
  if (fps?.[1]) {
    const n = Number(fps[1]);
    if (n >= 1 && n <= 120) {
      sb.meta.fps = Math.round(n);
      return { sb, note: `fps set to ${sb.meta.fps}` };
    }
  }

  /* --- outro --- */
  const outro = s.match(/\boutro\b[^\d]{0,12}(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds)?/i);
  if (outro?.[1]) {
    const n = Number(outro[1]);
    if (Number.isFinite(n) && n >= 0 && n <= 10) {
      sb.meta.outroSec = n;
      return { sb, note: `outro set to ${n}s` };
    }
  }

  /* --- remove a scene --- */
  const remove = s.match(/\b(?:remove|delete|drop|cut)\b\s*(?:the\s*)?scene\s*#?(\d{1,3})/i);
  if (remove?.[1]) {
    const idx = Number(remove[1]) - 1;
    if (idx < 0 || idx >= sb.scenes.length) return undefined;
    if (sb.scenes.length === 1) {
      log.warn('refusing to remove the only scene');
      return undefined;
    }
    const doomed = sb.scenes[idx]!;
    const goneIds = new Set(doomed.elements.map((e) => e.id));
    sb.scenes.splice(idx, 1);
    // An annotation pointing at something that no longer exists is dead weight.
    for (const scene of sb.scenes) {
      scene.elements = scene.elements.filter(
        (el) => el.type !== 'emphasis' || !goneIds.has(el.targetId),
      );
    }
    sb.scenes = sb.scenes.filter((sc) => sc.elements.length > 0 || sc.narration.trim().length > 0);
    return { sb, note: `removed scene ${idx + 1} (${doomed.id})`, structural: true };
  }

  /* --- pacing --- */
  const pace = lower.match(/\b(slower|faster|slow down|speed up)\b/);
  if (pace) {
    const much = /\b(much|a lot|way|significantly)\b/.test(lower);
    const slower = pace[1] === 'slower' || pace[1] === 'slow down';
    const factor = slower ? (much ? 1.5 : 1.25) : much ? 0.66 : 0.8;
    const sceneMatch = lower.match(/\bscene\s*#?(\d{1,3})/);
    const targets =
      sceneMatch?.[1] !== undefined
        ? [Number(sceneMatch[1]) - 1].filter((i) => i >= 0 && i < sb.scenes.length)
        : sb.scenes.map((_, i) => i);
    if (!targets.length) return undefined;
    for (const i of targets) {
      const scene = sb.scenes[i]!;
      if (scene.durationSec !== undefined) {
        scene.durationSec = Math.max(0.5, Math.round(scene.durationSec * factor * 100) / 100);
      }
      scene.camera.transition = Math.round(scene.camera.transition * factor * 100) / 100;
      for (const el of scene.elements) {
        el.enter.duration = Math.max(0.15, Math.round(el.enter.duration * factor * 100) / 100);
      }
    }
    const scope = sceneMatch?.[1] !== undefined ? `scene ${sceneMatch[1]}` : 'every scene';
    log.info(
      `${slower ? 'slowed' : 'sped up'} ${scope}; the final runtime is set by the measured narration, so re-run the voice stage to hear it`,
    );
    return { sb, note: `${slower ? 'slowed' : 'sped up'} ${scope} by ${factor}x` };
  }

  return undefined;
}

/* ------------------------------------------------------------------ public */

/**
 * Apply `instruction` to `sb` and return the updated storyboard, plus a report
 * of what happened. Never throws for an unrecognised instruction — it says so.
 */
export async function editStoryboardDetailed(
  sb: Storyboard,
  instruction: string,
  opts: EditOptions = {},
): Promise<{ storyboard: Storyboard; report: EditReport }> {
  const adapter = textProvider(providerEnv(), opts.adapter);

  if (adapter !== 'heuristic') {
    const patched = await anthropicEdit(sb, instruction, opts);
    if (patched) {
      const out =
        opts.relayout === false
          ? patched
          : layoutStoryboard(patched, { aspect: patched.meta.aspect });
      return {
        storyboard: parseStoryboard(out),
        report: { applied: [instruction], needsKey: [], unsupported: [] },
      };
    }
    log.warn('the Anthropic edit did not succeed — trying the deterministic editor');
  }

  const draft = structuredClone(sb);
  const report: EditReport = { applied: [], needsKey: [], unsupported: [] };
  let structural = false;

  for (const part of splitInstructions(instruction)) {
    const result = applyOne(draft, part);
    if (result) {
      report.applied.push(result.note);
      structural = structural || result.structural === true;
      continue;
    }
    if (NEEDS_MODEL.test(part)) report.needsKey.push(part);
    else report.unsupported.push(part);
  }

  if (report.needsKey.length) {
    log.warn(
      `set FIREWORKS_API_KEY or ANTHROPIC_API_KEY to apply: ${report.needsKey.join(' | ')} — these need a model to write new content`,
    );
  }
  if (report.unsupported.length) {
    log.warn(`did not understand: ${report.unsupported.join(' | ')}`);
  }
  if (report.applied.length) log.info(`applied: ${report.applied.join('; ')}`);

  const out =
    structural && opts.relayout !== false
      ? layoutStoryboard(draft, { aspect: draft.meta.aspect })
      : draft;
  return { storyboard: parseStoryboard(out), report };
}

/** Apply a natural-language edit and return the updated storyboard. */
export async function editStoryboard(
  sb: Storyboard,
  instruction: string,
  opts: EditOptions = {},
): Promise<Storyboard> {
  const { storyboard } = await editStoryboardDetailed(sb, instruction, opts);
  return storyboard;
}
