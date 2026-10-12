import test from 'node:test';
import assert from 'node:assert/strict';
import { fireworksClient, type ModelRequest } from '../src/model-client.js';
import { textProvider, textModel, FIREWORKS_DEFAULT_MODEL } from '../src/model-provider.js';
const body: ModelRequest = {
  model: FIREWORKS_DEFAULT_MODEL,
  max_tokens: 1000,
  system: 'teach accurately',
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'review this' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } },
      ],
    },
  ],
  tools: [{ name: 'emit', description: 'structured output', input_schema: { type: 'object' } }],
  tool_choice: { type: 'tool', name: 'emit' },
};
test('Fireworks transports images, forced tools and usage without enabling persistent conversations', async () => {
  let payload: any;
  const client = fireworksClient('not-a-real-key', (async (url, init) => {
    assert.equal(url, 'https://api.fireworks.ai/inference/v1/chat/completions');
    payload = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: 'tool_calls',
            message: { tool_calls: [{ function: { name: 'emit', arguments: '{"answer":42}' } }] },
          },
        ],
        usage: { prompt_tokens: 41, completion_tokens: 9 },
      }),
    );
  }) as typeof fetch);
  const reply = await client.messages.create(body);
  assert.deepEqual(payload.tool_choice, { type: 'function', function: { name: 'emit' } });
  assert.equal(payload.messages[1].content[1].image_url.url, 'data:image/png;base64,aGVsbG8=');
  assert.equal(payload.store, undefined);
  assert.deepEqual(reply.content[0].input, { answer: 42 });
  assert.deepEqual(reply.usage, { input_tokens: 41, output_tokens: 9 });
});
test('Fireworks failures do not expose response bodies or fall through to another cloud provider', async () => {
  const client = fireworksClient(
    'secret',
    (async () => new Response('secret customer document', { status: 402 })) as typeof fetch,
  );
  const result = await client.messages.create(body);
  assert.equal(result.failure, 'Fireworks HTTP 402: account credits required');
  assert.equal(JSON.stringify(result).includes('secret'), false);
});
test('provider and model selection agree, including explicit local and cloud pins', () => {
  const keys = { FIREWORKS_API_KEY: 'fw', ANTHROPIC_API_KEY: 'ant' };
  assert.equal(textProvider(keys), 'fireworks');
  assert.equal(textModel('claude-opus-5', keys), FIREWORKS_DEFAULT_MODEL);
  assert.equal(textProvider(keys, 'anthropic'), 'anthropic');
  assert.equal(textModel('claude-opus-5', keys, 'anthropic'), 'claude-opus-5');
  assert.equal(textProvider({ ...keys, INKCAST_PLANNER: 'local' }), 'heuristic');
  assert.equal(
    textProvider({ ANTHROPIC_API_KEY: 'ant', INKCAST_PLANNER: 'fireworks' }),
    'heuristic',
  );
});

function mockCompletion(reason: string, argumentsText = '{"answer":42}') {
  return new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: reason,
          message: { tool_calls: [{ function: { name: 'emit', arguments: argumentsText } }] },
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 200 },
    }),
  );
}
test('lesson and drawing budgets allow large outputs, with one retry and summed billed usage', async () => {
  for (const [tool, initial] of [
    ['emit_lesson', 65_536],
    ['emit_drawing', 32_768],
  ] as const) {
    const requests: any[] = [];
    const client = fireworksClient('secret', (async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return requests.length === 1
        ? mockCompletion('length', '{"partial":')
        : mockCompletion('tool_calls');
    }) as typeof fetch);
    const result = await client.messages.create({
      ...body,
      tool_choice: { type: 'tool', name: tool },
    });
    assert.deepEqual(
      requests.map((r) => r.max_tokens),
      [initial, 131_072],
    );
    assert.equal(requests[0].context_length_exceeded_behavior, 'error');
    assert.deepEqual(requests[0].messages, requests[1].messages);
    assert.deepEqual(result.usage, { input_tokens: 200, output_tokens: 400 });
    assert.deepEqual(result.content[0].input, { answer: 42 });
    assert.equal(result.failure, undefined);
  }
});
test('exhausted ceiling rejects even valid-looking partial tools without retrying forever', async () => {
  let attempts = 0;
  const client = fireworksClient('secret', (async () => {
    attempts++;
    return mockCompletion('length');
  }) as typeof fetch);
  const result = await client.messages.create(body);
  assert.equal(attempts, 2);
  assert.deepEqual(result.content, []);
  assert.match(result.failure!, /131072 tokens, 2 attempts/);
  assert.deepEqual(result.usage, { input_tokens: 200, output_tokens: 400 });
});
test('retry transport failure preserves initial billed usage and redacts response text', async () => {
  let attempts = 0;
  const client = fireworksClient('secret', (async () =>
    ++attempts === 1
      ? mockCompletion('length')
      : new Response('private source text', { status: 429 })) as typeof fetch);
  const result = await client.messages.create(body);
  assert.equal(result.failure, 'Fireworks HTTP 429: rate or quota limit');
  assert.deepEqual(result.usage, { input_tokens: 100, output_tokens: 200 });
});
test('unrecognized model overrides are not assigned an unverified output ceiling', async () => {
  let attempts = 0;
  const client = fireworksClient('secret', (async () => {
    attempts++;
    return mockCompletion('length');
  }) as typeof fetch);
  const result = await client.messages.create({ ...body, model: 'accounts/example/models/other' });
  assert.equal(attempts, 1);
  assert.match(result.failure!, /8192 tokens, 1 attempt/);
});
test('malformed tool JSON keeps usage but never echoes customer content', async () => {
  const client = fireworksClient('secret', (async () =>
    mockCompletion('tool_calls', '{"private":')) as typeof fetch);
  const result = await client.messages.create(body);
  assert.equal(result.failure, 'Fireworks returned malformed tool arguments');
  assert.deepEqual(result.usage, { input_tokens: 100, output_tokens: 200 });
});
