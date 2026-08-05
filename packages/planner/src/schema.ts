/**
 * JSON Schema for the Storyboard, derived from the zod schema in
 * `@inkcast/core` so the two can never drift.
 *
 * `packages/core` is on zod 3, which has no `z.toJSONSchema`, so this goes
 * through `zod-to-json-schema` — an optional dependency, because the schema is
 * only needed by the opt-in Anthropic adapter.
 */
import { Lesson, Mark, Storyboard } from '@inkcast/core';
import { z } from 'zod';
import { optionalImport } from './optional.js';

/** Keys tool-use / structured-output schemas do not support. */
const UNSUPPORTED = new Set([
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minItems',
  'maxItems',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  '$schema',
  'markdownDescription',
]);

/** Fields a later stage owns; the planner must not be asked to invent them. */
const STAGE_OWNED = ['durationSec', 'audioPath', 'words', 'svg'];

type Json = Record<string, unknown>;

function prune(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(prune);
  if (!node || typeof node !== 'object') return node;
  const out: Json = {};
  for (const [k, v] of Object.entries(node as Json)) {
    if (UNSUPPORTED.has(k)) continue;
    if (k === 'properties' && v && typeof v === 'object') {
      const props: Json = {};
      for (const [pk, pv] of Object.entries(v as Json)) {
        if (STAGE_OWNED.includes(pk)) continue;
        props[pk] = prune(pv);
      }
      out[k] = props;
      continue;
    }
    if (k === 'required' && Array.isArray(v)) {
      out[k] = v.filter((r) => typeof r === 'string' && !STAGE_OWNED.includes(r));
      continue;
    }
    out[k] = prune(v);
  }
  return out;
}

type Mod = {
  zodToJsonSchema(schema: unknown, opts?: { target?: string; $refStrategy?: string }): Json;
};

async function toJsonSchema(schema: unknown, why: string): Promise<Json | undefined> {
  const mod = await optionalImport<Mod>('zod-to-json-schema', why);
  if (!mod) return undefined;
  // `$refStrategy: 'none'` inlines every definition. The schema is bigger, but a
  // tool schema full of `$ref` pointers measurably degrades what models emit.
  const raw = mod.zodToJsonSchema(schema, { target: 'jsonSchema7', $refStrategy: 'none' });
  const pruned = prune(raw) as Json;
  delete pruned.$schema;
  return pruned;
}

/**
 * The Storyboard as a JSON Schema an LLM can be forced to emit, or `undefined`
 * when `zod-to-json-schema` is not installed (callers fall back to heuristics).
 */
export async function storyboardJsonSchema(): Promise<Json | undefined> {
  return toJsonSchema(Storyboard, 'the Anthropic planner needs it to describe the Storyboard');
}

/**
 * The Lesson as a JSON Schema, for the forced tool call in the lesson stage.
 *
 * The point of forcing the tool is that the *shape* of good teaching is not
 * optional: a hook, an anchor, ordered steps, a worked example, the misconception
 * and a recap are required fields, so a model cannot quietly hand back a summary
 * with a title on it.
 */
export async function lessonJsonSchema(): Promise<Json | undefined> {
  return toJsonSchema(Lesson, 'the Anthropic lesson author needs it to describe a Lesson');
}

/**
 * A drawing — a list of marks — as a JSON Schema for the drawing author's forced tool.
 *
 * Derived here rather than hand-written next to the brief for the reason this file
 * exists at all: a second copy of the mark vocabulary would drift from the first, and
 * the compiler would then be reading fields the author was never told to emit.
 */
export async function drawingJsonSchema(): Promise<Json | undefined> {
  return toJsonSchema(
    z.object({ elements: z.array(Mark) }),
    'the drawing author needs it to describe a drawing',
  );
}
