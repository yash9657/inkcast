import { FIREWORKS_DEFAULT_MODEL } from './model-provider.js';

/** Minimal shared tool-call contract, independent of any provider SDK. */
export type ModelText = { type: 'text'; text: string };
export type ModelImage = {
  type: 'image';
  source: { type: 'base64'; media_type: 'image/png'; data: string };
};
export type ModelMessage = {
  role: 'user' | 'assistant';
  content: string | (ModelText | ModelImage)[];
};
export type ModelRequest = {
  model: string;
  max_tokens: number;
  system: string;
  messages: ModelMessage[];
  tools: { name: string; description: string; input_schema: Record<string, unknown> }[];
  tool_choice: { type: 'tool'; name: string };
};
export type ModelResponse = {
  content: { type: string; name?: string; input?: unknown; text?: string }[];
  stop_reason?: string | null;
  /** Sanitized transport/decoding failure, with any earlier billed usage preserved. */
  failure?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
};
export type ModelClient = {
  provider?: 'anthropic' | 'fireworks';
  messages: { create(body: ModelRequest): Promise<ModelResponse> };
};

/** Bump when request budgets change, so cached generation uses the new policy. */
export const FIREWORKS_GENERATION_POLICY = 'large-output-v1';
const DEFAULT_MODEL_OUTPUT_CEILING = 131_072;

/** Chat Completions only: no persistent Responses conversations or training uploads. */
export function fireworksClient(key: string, request: typeof fetch = fetch): ModelClient {
  return {
    provider: 'fireworks',
    messages: {
      async create(body) {
        const knownModel = body.model === FIREWORKS_DEFAULT_MODEL;
        const floor = knownModel
          ? body.tool_choice.name === 'emit_lesson'
            ? 65_536
            : body.tool_choice.name === 'emit_drawing'
              ? 32_768
              : 8192
          : 8192;
        let budget = Math.max(body.max_tokens, floor);
        if (knownModel) budget = Math.min(budget, DEFAULT_MODEL_OUTPUT_CEILING);
        const usage = { input_tokens: 0, output_tokens: 0 };
        // One fresh, larger attempt. Never append incomplete JSON to the conversation.
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const res = await request('https://api.fireworks.ai/inference/v1/chat/completions', {
              method: 'POST',
              signal: AbortSignal.timeout(
                Math.max(300_000, Math.ceil(budget / 100) * 1000 + 60_000),
              ),
              headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: body.model,
                max_tokens: budget,
                // A context overflow must not silently shrink the output or discard facts.
                context_length_exceeded_behavior: 'error',
                reasoning_effort: process.env.INKCAST_FIREWORKS_REASONING
                  ? /^\d+$/.test(process.env.INKCAST_FIREWORKS_REASONING)
                    ? Number(process.env.INKCAST_FIREWORKS_REASONING)
                    : process.env.INKCAST_FIREWORKS_REASONING
                  : body.model.includes('deepseek-v4p1')
                    ? 4096
                    : 'low',
                messages: [
                  { role: 'system', content: body.system },
                  ...body.messages.map((m) => ({
                    role: m.role,
                    content:
                      typeof m.content === 'string'
                        ? m.content
                        : m.content.map((p) =>
                            p.type === 'text'
                              ? p
                              : {
                                  type: 'image_url',
                                  image_url: {
                                    url: `data:${p.source.media_type};base64,${p.source.data}`,
                                  },
                                },
                          ),
                  })),
                ],
                tools: body.tools.map((t) => ({
                  type: 'function',
                  function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.input_schema,
                  },
                })),
                tool_choice: { type: 'function', function: { name: body.tool_choice.name } },
              }),
            });
            // Never include provider bodies: they may echo customer documents or credentials.
            if (!res.ok)
              throw new Error(
                `Fireworks HTTP ${res.status}: ${res.status === 401 ? 'check FIREWORKS_API_KEY' : res.status === 402 ? 'account credits required' : res.status === 429 ? 'rate or quota limit' : 'generation failed'}`,
              );
            const data = (await res.json()) as {
              choices?: {
                finish_reason?: string;
                message?: { tool_calls?: { function?: { name?: string; arguments?: string } }[] };
              }[];
              usage?: { prompt_tokens?: number; completion_tokens?: number };
            };
            usage.input_tokens += data.usage?.prompt_tokens ?? 0;
            usage.output_tokens += data.usage?.completion_tokens ?? 0;
            const choice = data.choices?.[0];
            if (choice?.finish_reason === 'length') {
              if (knownModel && attempt === 0 && budget < DEFAULT_MODEL_OUTPUT_CEILING) {
                budget = DEFAULT_MODEL_OUTPUT_CEILING;
                continue;
              }
              return {
                content: [],
                stop_reason: 'length',
                failure: `Fireworks output limit reached (${budget} tokens, ${attempt + 1} attempt${attempt ? 's' : ''}); incomplete output rejected`,
                usage,
              };
            }
            const calls = choice?.message?.tool_calls ?? [];
            let content: ModelResponse['content'];
            try {
              content = calls.map((t) => ({
                type: 'tool_use',
                name: t.function?.name,
                input: t.function?.arguments ? JSON.parse(t.function.arguments) : undefined,
              }));
            } catch {
              return { content: [], failure: 'Fireworks returned malformed tool arguments', usage };
            }
            return { content, stop_reason: choice?.finish_reason, usage };
          } catch (err) {
            // Retain the first attempt's cost if the retry fails. Never echo provider
            // bodies or parser errors, which can contain customer documents.
            const message =
              err instanceof Error && /^Fireworks HTTP \d+:/.test(err.message)
                ? err.message
                : 'Fireworks request failed or timed out';
            return { content: [], failure: message, usage };
          }
        }
        throw new Error('unreachable Fireworks attempt state');
      },
    },
  };
}
