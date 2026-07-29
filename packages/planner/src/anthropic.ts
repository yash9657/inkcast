/**
 * The opt-in Anthropic planner adapter.
 *
 * Selected only when `ANTHROPIC_API_KEY` is set. It asks Claude for a
 * scene-by-scene plan through a **forced tool call** whose `input_schema` is the
 * Storyboard schema itself, so the model cannot reply with prose. zod is still
 * the gate: on a validation failure we retry once with the errors fed back, and
 * if that also fails the caller falls back to the heuristic planner. A missing
 * key, a missing SDK, a rate limit or a bad response can therefore never crash
 * the pipeline — they only cost you the upgrade.
 */
import type { Asset, Storyboard } from '@inkcast/core';
import { logger, parseStoryboard, report } from '@inkcast/core';
import { ICONS } from './icons.js';
import { optionalImport } from './optional.js';
import { storyboardJsonSchema } from './schema.js';
import type { PlanOptions, SourceDoc } from './types.js';

const log = logger('planner:anthropic');

export const DEFAULT_MODEL = 'claude-opus-5';
const MAX_INPUT_CHARS = 60_000;
const TOOL = 'emit_storyboard';

/* ------------------------------------------------------------- SDK surface */

type ContentBlock = { type: string; name?: string; input?: unknown; text?: string };
type MessageResponse = { content: ContentBlock[]; stop_reason?: string | null };
export type Message = { role: 'user' | 'assistant'; content: string };
type CreateBody = {
  model: string;
  max_tokens: number;
  system: string;
  messages: Message[];
  tools: {
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }[];
  tool_choice: { type: 'tool'; name: string };
};
export type Client = { messages: { create(body: CreateBody): Promise<MessageResponse> } };
type AnthropicCtor = new (opts: { apiKey: string }) => Client;

/** True when the cloud planner can be used at all. */
export function anthropicAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function plannerModel(opts?: { model?: string }): string {
  return opts?.model ?? process.env.INKCAST_PLANNER_MODEL ?? DEFAULT_MODEL;
}

/**
 * A constructed Anthropic client, or `undefined` when the key or the SDK is
 * missing. Shared with the lesson adapter so there is one place that decides
 * whether the cloud path is available at all.
 */
export async function anthropicClient(): Promise<Client | undefined> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return undefined;
  const mod = await optionalImport<{ default: AnthropicCtor } | AnthropicCtor>(
    '@anthropic-ai/sdk',
    'falling back to the heuristic planner',
  );
  if (!mod) return undefined;
  const Ctor = (mod as { default?: AnthropicCtor }).default ?? (mod as AnthropicCtor);
  try {
    return new Ctor({ apiKey: key });
  } catch (err) {
    log.warn('could not construct the Anthropic client', err as Error);
    return undefined;
  }
}

/* -------------------------------------------------------------- the prompt */

const ICON_LIST = ICONS.map((i) => i.slug).join(', ');

function systemPrompt(opts: PlanOptions): string {
  const wps = opts.wordsPerSecond ?? 2.6;
  const maxWords = Math.round(wps * 10.5);
  return `You are the planning stage of Inkcast, a compiler that turns documents into hand-drawn whiteboard explainer videos. You emit a Storyboard IR; a renderer draws it. Emit it by calling the ${TOOL} tool exactly once.

HOW THE CANVAS WORKS
- There is ONE large persistent canvas, not slides. Each scene moves a camera to a region of it.
- Elements default to persist: true and stay on the board, so a later scene can annotate an earlier one with an "emphasis" element targeting its id. Use that: it is the single biggest quality difference from slide-based tools.
- Give every element an "at" box in canvas units and never overlap two elements in the same area. A downstream layout pass will tidy placement, so prioritise sensible grouping and reading order over exact pixels.
- camera.x / camera.y is the centre of the framed region; camera.zoom > 1 zooms in. Consecutive scenes should sit in ADJACENT regions so the camera pans a short distance.

SCENES
- One idea per scene. ${opts.maxScenes ?? 24} scenes maximum.
- narration is SPOKEN text: contractions, short clauses, no citations, no "as shown in Figure 2", no bullet-point voice. Roughly ${Math.max(10, Math.round(wps * 4))}–${maxWords} words per scene, which is 4–12 seconds of speech.
- Write narration from the document's own facts. Compress; never paste a sentence verbatim if it reads like prose written for the eye.
- enter.at is a FRACTION (0–1) of the scene, not seconds. Stagger elements so each one appears on the words that introduce it. Use style "write" for text and "draw" for shapes, assets and diagrams.

VISUAL VOCABULARY — choose the form that matches the content
- a list of peers -> diagram, layout "stack"
- an ordered process -> diagram, layout "flow", with edges chaining the nodes
- a comparison -> two side-by-side stacks or panels
- a definition -> a heading with the term plus a body line, and an underline shape
- a measurement or statistic -> a large "title" text of the number with a "label" text under it
- a hierarchy -> diagram, layout "tree"
- emphasis on something already drawn -> an "emphasis" element with targetId

ASSETS
- storyboard.assets is an entity library. Reference an entity from an element with assetId, and define it ONCE in assets. Never define the same entity twice.
- Prefer these built-in icon ids, which render with no network and no API key: ${ICON_LIST}.
- If you genuinely need something outside that list, invent a slug id, set kind "illustration" and write a short prompt describing it in a hand-drawn line-art style.

Return only the tool call. Be concrete, be brief, and make the video teach.`;
}

function userPrompt(doc: SourceDoc, opts: PlanOptions): string {
  const outline = doc.sections
    .filter((s) => s.heading)
    .map((s) => `${'  '.repeat(Math.max(0, s.level - 1))}- ${s.heading}`)
    .join('\n');
  const text =
    doc.text.length > MAX_INPUT_CHARS
      ? `${doc.text.slice(0, MAX_INPUT_CHARS)}\n…[truncated]`
      : doc.text;
  return [
    `TITLE: ${doc.title}`,
    outline ? `OUTLINE:\n${outline}` : '',
    opts.brief ? `EXTRA DIRECTION: ${opts.brief}` : '',
    `meta must be: language ${opts.language ?? 'en'}, aspect ${opts.aspect ?? '16:9'}, palette ${opts.palette ?? 'color'}, style ${opts.style ?? 'marker'}, voice ${opts.voice ?? 'af_heart'}, fps ${opts.fps ?? 30}.`,
    'DOCUMENT:',
    text,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/* ------------------------------------------------------------------ calling */

/**
 * One forced tool call.
 *
 * `tool_choice` pins the model to the tool, and the tool's `input_schema` is our
 * zod schema rendered as JSON Schema, so the model cannot answer with prose and
 * cannot invent a shape. zod still validates what comes back: a forced tool call
 * constrains the structure, not the semantics.
 */
export async function callTool(
  c: Client,
  model: string,
  system: string,
  messages: Message[],
  schema: Record<string, unknown>,
  tool: { name: string; description: string } = {
    name: TOOL,
    description: 'Emit the finished storyboard for this document.',
  },
  maxTokens = 16000,
): Promise<unknown> {
  const res = await c.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages,
    tools: [
      {
        name: tool.name,
        description: tool.description,
        input_schema: schema,
      },
    ],
    tool_choice: { type: 'tool', name: tool.name },
  });
  const block = res.content.find((b) => b.type === 'tool_use' && b.name === tool.name);
  if (!block || block.input === undefined) {
    throw new Error(
      `model returned no ${tool.name} tool call (stop_reason: ${res.stop_reason ?? '?'})`,
    );
  }
  return block.input;
}

/** zod issues (or any error) as a short list a model can act on. */
export function errorDetail(err: unknown): string {
  const e = err as { issues?: { path?: unknown[]; message?: string }[]; message?: string };
  if (Array.isArray(e.issues)) {
    return e.issues
      .slice(0, 12)
      .map((i) => `${(i.path ?? []).join('.') || '(root)'}: ${i.message ?? 'invalid'}`)
      .join('\n');
  }
  return e.message ?? String(err);
}

/**
 * Ask Claude for a storyboard. Returns `undefined` on any failure — the caller
 * (`plan()`) then uses the heuristic planner, which is always available.
 */
export async function anthropicPlan(
  doc: SourceDoc,
  opts: PlanOptions = {},
): Promise<Storyboard | undefined> {
  const c = await anthropicClient();
  if (!c) return undefined;
  const schema = await storyboardJsonSchema();
  if (!schema) return undefined;

  const model = plannerModel(opts);
  const system = systemPrompt(opts);
  const messages: Message[] = [{ role: 'user', content: userPrompt(doc, opts) }];

  report(opts, { stage: 'plan', pct: 15, note: `asking ${model}` });
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: unknown;
    try {
      raw = await callTool(c, model, system, messages, schema);
    } catch (err) {
      log.warn(`Anthropic request failed (attempt ${attempt + 1})`, err as Error);
      return undefined;
    }
    report(opts, { stage: 'plan', pct: 55, note: 'validating storyboard' });
    try {
      const sb = parseStoryboard(normalise(raw, doc, opts));
      log.info(`${model} planned ${sb.scenes.length} scenes`);
      return sb;
    } catch (err) {
      const detail = errorDetail(err);
      log.warn(`storyboard failed validation (attempt ${attempt + 1})`, detail);
      if (attempt === 1) return undefined;
      messages.push(
        { role: 'assistant', content: JSON.stringify(raw).slice(0, 60_000) },
        {
          role: 'user',
          content: `That storyboard failed schema validation:\n${detail}\n\nCall ${TOOL} again with the whole storyboard corrected. Keep everything that was already valid.`,
        },
      );
    }
  }
  return undefined;
}

/**
 * Apply a natural-language edit with Claude, returning a validated storyboard or
 * `undefined` if the model or the key is unavailable.
 */
export async function anthropicEdit(
  sb: Storyboard,
  instruction: string,
  opts: { model?: string } = {},
): Promise<Storyboard | undefined> {
  const c = await anthropicClient();
  if (!c) return undefined;
  const schema = await storyboardJsonSchema();
  if (!schema) return undefined;

  const model = plannerModel(opts);
  const system = `You edit an existing Inkcast Storyboard. Apply the user's instruction and emit the COMPLETE updated storyboard by calling ${TOOL} once.

Rules:
- Change only what the instruction asks for. Preserve every scene id, element id and asset id you are not asked to change.
- Keep the IR's invariants: enter.at is a fraction of the scene (0–1); elements default to persist: true; assets are defined once and referenced by assetId; one idea per scene; narration is spoken language.
- Do not fill in durationSec, audioPath or words — later stages own those.
- If the instruction asks for something impossible, make the closest sensible change and keep the storyboard valid.`;

  const messages: Message[] = [
    {
      role: 'user',
      content: `INSTRUCTION: ${instruction}\n\nCURRENT STORYBOARD:\n${JSON.stringify(sb)}`,
    },
  ];

  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: unknown;
    try {
      raw = await callTool(c, model, system, messages, schema);
    } catch (err) {
      log.warn('Anthropic edit request failed', err as Error);
      return undefined;
    }
    try {
      return parseStoryboard(carryOver(raw, sb));
    } catch (err) {
      const detail = errorDetail(err);
      log.warn(`edited storyboard failed validation (attempt ${attempt + 1})`, detail);
      if (attempt === 1) return undefined;
      messages.push(
        { role: 'assistant', content: JSON.stringify(raw).slice(0, 60_000) },
        {
          role: 'user',
          content: `That failed validation:\n${detail}\n\nCall ${TOOL} again with the corrected complete storyboard.`,
        },
      );
    }
  }
  return undefined;
}

/* ------------------------------------------------------- response repair */

type Loose = Record<string, unknown>;

/**
 * Small, honest repairs to model output before zod sees it: fill the fields the
 * caller already decided (title, meta), and make sure every `assetId` an element
 * references actually exists in the asset library. Anything structurally wrong is
 * left alone so validation catches it and the retry can fix it properly.
 */
function normalise(raw: unknown, doc: SourceDoc, opts: PlanOptions): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const sb = { ...(raw as Loose) };
  sb.version = 1;
  if (typeof sb.title !== 'string' || !sb.title.trim()) sb.title = doc.title;
  sb.meta = {
    ...(typeof sb.meta === 'object' && sb.meta ? (sb.meta as Loose) : {}),
    language: opts.language ?? 'en',
    aspect: opts.aspect ?? '16:9',
    palette: opts.palette ?? 'color',
    style: opts.style ?? 'marker',
    voice: opts.voice ?? 'af_heart',
    fps: opts.fps ?? 30,
  };
  ensureAssets(sb);
  return sb;
}

function carryOver(raw: unknown, previous: Storyboard): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const sb = { ...(raw as Loose) };
  sb.version = 1;
  if (typeof sb.title !== 'string' || !sb.title.trim()) sb.title = previous.title;
  if (typeof sb.canvas !== 'object' || !sb.canvas) sb.canvas = previous.canvas;
  ensureAssets(sb);
  return sb;
}

/** Every referenced assetId must exist in the library, or the visuals stage stalls. */
function ensureAssets(sb: Loose): void {
  const assets: Asset[] = Array.isArray(sb.assets) ? (sb.assets as Asset[]) : [];
  const known = new Set(assets.filter((a) => a && typeof a.id === 'string').map((a) => a.id));
  const builtin = new Set(ICONS.map((i) => i.slug));
  const scenes = Array.isArray(sb.scenes) ? (sb.scenes as Loose[]) : [];
  for (const scene of scenes) {
    const elements = Array.isArray(scene?.elements) ? (scene.elements as Loose[]) : [];
    for (const el of elements) {
      if (el?.type !== 'asset') continue;
      const id = el.assetId;
      if (typeof id !== 'string' || !id || known.has(id)) continue;
      known.add(id);
      assets.push({
        id,
        kind: builtin.has(id) ? 'icon' : 'illustration',
        prompt: id.replace(/[-_]+/g, ' '),
        source: builtin.has(id) ? 'builtin' : 'generated',
      });
      log.debug(`added missing asset "${id}" referenced by an element`);
    }
  }
  sb.assets = assets;
}
