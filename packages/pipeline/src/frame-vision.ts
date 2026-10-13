import type { ModelText, ModelImage } from '@inkcast/core';
/**
 * The keyed half of Tier 2: a model looks at the frames (plan item 3.3).
 *
 * `@inkcast/render` samples the film and measures its ink — that half is free and needs
 * no key — and then asks *this* for the half a measurement cannot do. The seam is the
 * same one the drawing critic uses in the other direction (`draw-preview.ts`): the
 * package that owns Chromium must not acquire a model provider, and the package that
 * owns the providers must not acquire a browser, so whichever caller has both passes one
 * down. Here that caller is the pipeline.
 *
 * ## The questions are fixed, and that is the design
 *
 * Four questions, from the audit's own spec, asked of every frame in the same words:
 * is any text clipped or cut off, is ink written through other ink, is any region too
 * small or faint to read, is the board mostly empty. Plus one instruction that is not a
 * question — read the text back — which is what makes the OCR diff possible.
 *
 * A fixed rubric rather than "what is wrong with this frame" for two reasons. It is
 * comparable across runs, so a regression is visible as a count going up rather than as
 * prose changing; and it is comparable across *films*, which is what the bake-off needs
 * (plan 8.2) — the same five questions are asked of Golpo's frames, where there is no IR
 * to check anything against.
 *
 * ## Cost, and why it is one call
 *
 * Eight 1920×1080 frames is roughly 12k input tokens, so one call is a few cents and
 * eight calls are not eight times better: a model shown the whole set can say "this
 * caption is clipped in every frame after the third", which is the useful form of that
 * finding. The answer is cached on the frames' own bytes, so a re-render of an unchanged
 * film pays nothing, and the spend is reported so it appears in the cost report like
 * every other call (plan 3.5).
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { cacheDir, hash, logger, type ModelSpend } from '@inkcast/core';
import { plannerProvider } from './providers.js';

const log = logger('pipeline:frame-vision');

/**
 * Bump when the questions change: the answers are cached on it, and an answer to a
 * different question is not an answer.
 */
const VISION_VERSION = 1;

/** Mirrored from `@inkcast/render`, for the reason `stages.ts` mirrors every signature. */
export type FrameSample = {
  index: number;
  at: number;
  sceneId: string;
  png: Uint8Array;
  ink?: number;
  text: string[];
};

export type FrameVerdict = {
  index: number;
  clipped?: string;
  overlap?: string;
  illegible?: string;
  empty?: string;
  read?: string[];
};

/** The shape the gate stage takes as `vision`. */
export type VisionPass = (frames: readonly FrameSample[]) => Promise<FrameVerdict[]>;

export type FrameVisionHandle = {
  /** Pass to the gate stage as `vision`. */
  vision: VisionPass;
};

const SYSTEM = `You are a quality inspector for hand-drawn whiteboard explainer videos. You are shown frames from one film, in order, and you answer the same five questions about each one. You are looking for defects a viewer would notice, not for ways the drawing could be prettier.

Answer only about what is visible. Say nothing about a frame you have no complaint about — an absent field means "nothing wrong here", and inventing a complaint to seem thorough makes the whole report useless.

The board is deliberately hand-drawn: wobbly strokes, uneven letter spacing and a sketchy line are the style and are never defects. Empty paper around a small drawing is not a defect either unless the frame is mostly empty.`;

const QUESTIONS = [
  'clipped: text that is cut off — running out of its box, off the edge of the frame, or with a word broken across lines mid-word. Quote the text.',
  'overlap: ink written through other ink so that either becomes hard to read. Name both things.',
  'illegible: a region of text too small or too faint to read at this size. Quote it or describe where it is.',
  'empty: the frame is mostly blank paper with almost nothing on it. Say what little is there.',
  'read: every word of text you can read on the board, as a list. Read it as written, do not correct or complete it.',
].join('\n- ');

const TOOL = 'report_frames';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['frames'],
  properties: {
    frames: {
      type: 'array',
      description: 'One entry per frame you were shown, in the same order.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index'],
        properties: {
          index: { type: 'integer', description: '0-based position of the frame shown.' },
          clipped: { type: 'string', description: 'Text that is cut off. Omit if none.' },
          overlap: { type: 'string', description: 'Ink written through ink. Omit if none.' },
          illegible: { type: 'string', description: 'A region too small to read. Omit if none.' },
          empty: { type: 'string', description: 'Why it reads as empty. Omit if it does not.' },
          read: {
            type: 'array',
            items: { type: 'string' },
            description: 'Every word of board text you can read.',
          },
        },
      },
    },
  },
} as const;

/**
 * A vision pass, or `undefined` when there is no key to make one with.
 *
 * `undefined` rather than a function that always fails, so the gate records the honest
 * skip reason ("Tier 2 needs a key") instead of a provider error — the same posture as
 * every other keyed lane in this repo.
 */
export function openFrameVision(
  opts: { onSpend?: (s: ModelSpend) => void } = {},
): FrameVisionHandle | undefined {
  const planner = plannerProvider();
  if (!planner.cloud) return undefined;
  const model = planner.model ?? 'claude-opus-5';

  const vision = async (frames: readonly FrameSample[]): Promise<FrameVerdict[]> => {
    if (frames.length === 0) return [];
    // Keyed on the pixels themselves, not on the storyboard: two runs that produce the
    // same frames deserve the same answer for free, and a frame that changed by one
    // stroke is a different question.
    const key = hash(
      VISION_VERSION,
      planner.name,
      model,
      frames.map((f) => hash(Buffer.from(f.png).toString('base64'))),
    );
    const file = path.join(cacheDir('frame-vision'), `${key}.json`);
    const cached = await readJson(file);
    if (cached) {
      log.debug(`frame verdicts served from the cache (${frames.length} frames)`);
      return cached;
    }

    const { anthropicClient } = await import('@inkcast/planner');
    const client = await anthropicClient();
    if (!client) throw new Error('No model provider is available for frame review');

    const content: (ModelText | ModelImage)[] = [];
    for (const f of frames) {
      content.push({
        type: 'text',
        text: `Frame ${f.index} — ${f.at.toFixed(1)}s, scene ${f.sceneId}.`,
      });
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: Buffer.from(f.png).toString('base64'),
        },
      });
    }
    content.push({
      type: 'text',
      text:
        `Answer these for each of the ${frames.length} frames above, by calling ${TOOL} once ` +
        `with one entry per frame:\n- ${QUESTIONS}`,
    });

    const res = await client.messages.create({
      model,
      max_tokens: 4096,
      system: SYSTEM,
      messages: [{ role: 'user', content }],
      tools: [
        { name: TOOL, description: 'Report what is wrong with each frame.', input_schema: SCHEMA },
      ],
      tool_choice: { type: 'tool', name: TOOL },
    });
    opts.onSpend?.({
      lane: 'frame-vision',
      provider: client.provider ?? 'anthropic',
      model,
      inTokens: res.usage?.input_tokens ?? 0,
      outTokens: res.usage?.output_tokens ?? 0,
    });

    const block = res.content.find((b) => b.type === 'tool_use');
    const verdicts = coerce(block?.input, frames.length);
    // Written only once it parsed: a cache entry for an answer nobody could read would
    // make the failure permanent and free.
    await writeJson(file, verdicts);
    return verdicts;
  };

  return { vision };
}

/**
 * The model's answer, defensively.
 *
 * Every field optional and every entry droppable: this is advisory for a release
 * precisely because nobody has measured how often it is wrong, and a malformed answer
 * must cost the verdicts rather than the render.
 */
function coerce(input: unknown, count: number): FrameVerdict[] {
  const frames = (input as { frames?: unknown })?.frames;
  if (!Array.isArray(frames)) return [];
  const out: FrameVerdict[] = [];
  for (const raw of frames) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const index = typeof r.index === 'number' ? Math.trunc(r.index) : NaN;
    if (!Number.isInteger(index) || index < 0 || index >= count) continue;
    const str = (v: unknown): string | undefined =>
      typeof v === 'string' && v.trim() ? v.trim() : undefined;
    out.push({
      index,
      ...(str(r.clipped) === undefined ? {} : { clipped: str(r.clipped) as string }),
      ...(str(r.overlap) === undefined ? {} : { overlap: str(r.overlap) as string }),
      ...(str(r.illegible) === undefined ? {} : { illegible: str(r.illegible) as string }),
      ...(str(r.empty) === undefined ? {} : { empty: str(r.empty) as string }),
      ...(Array.isArray(r.read)
        ? { read: r.read.filter((w): w is string => typeof w === 'string') }
        : {}),
    });
  }
  return out;
}

async function readJson(file: string): Promise<FrameVerdict[] | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
    return Array.isArray(parsed) ? (parsed as FrameVerdict[]) : undefined;
  } catch {
    return undefined;
  }
}

async function writeJson(file: string, verdicts: FrameVerdict[]): Promise<void> {
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(verdicts, null, 2));
  } catch (err) {
    log.debug('could not cache the frame verdicts', err);
  }
}

/** The slice of the Anthropic SDK this file uses, so the import can stay dynamic. */
type AnthropicLike = {
  messages: {
    create(body: unknown): Promise<{
      content: Array<{ type: string; input?: unknown }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    }>;
  };
};
