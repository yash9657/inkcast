/**
 * JSON Schema for the Storyboard, derived from the zod schema in
 * `@inkcast/core` so the two can never drift.
 *
 * `packages/core` is on zod 3, which has no `z.toJSONSchema`, so this goes
 * through `zod-to-json-schema` — an optional dependency, because the schema is
 * only needed by the opt-in Anthropic adapter.
 */
import { Storyboard } from '@inkcast/core';
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

/**
 * The Storyboard as a JSON Schema an LLM can be forced to emit, or `undefined`
 * when `zod-to-json-schema` is not installed (callers fall back to heuristics).
 */
export async function storyboardJsonSchema(): Promise<Json | undefined> {
  type Mod = {
    zodToJsonSchema(
      schema: unknown,
      opts?: { target?: string; $refStrategy?: string },
    ): Json;
  };
  const mod = await optionalImport<Mod>(
    'zod-to-json-schema',
    'the Anthropic planner needs it to describe the Storyboard',
  );
  if (!mod) return undefined;
  const raw = mod.zodToJsonSchema(Storyboard, { target: 'jsonSchema7', $refStrategy: 'none' });
  const pruned = prune(raw) as Json;
  delete pruned.$schema;
  return pruned;
}
