/**
 * Who wrote the lesson, as opposed to who was going to write it.
 *
 * `resolveLessonAdapter` answers "which adapter would run in this environment". Everything
 * downstream — the `providers lesson …` line, the lesson cost line, `pipeline.json` — used
 * that as if it were the answer to "who wrote this", and on the run that is now the common
 * case they are different: the key is set, so the adapter resolves to `anthropic`, the
 * request comes back **402 Payment Required**, and `deriveLesson` writes the lesson. The
 * measured result is `projects/qc53-doc` — `providers lesson anthropic` and ~$0.04 booked
 * against a model that never saw the topic.
 *
 * The fallback lives *inside* the stage, so no caller can observe it by any other means:
 * `teachLesson` returns a bare `Lesson` and a derived one is shaped exactly like a written
 * one. `onAuthor` is the observation, and this file is where it is pinned.
 *
 * **Both directions are exercised here, and neither costs anything.** The client's base URL
 * is an environment variable, so a local server standing in for the API is a real client
 * making a real request against a real HTTP response — the 402 case is the bug, and the
 * 200 case is the guard against fixing it by declaring every lesson heuristic. What is
 * *not* tested is a real Anthropic response: this repo has had no credit since before the
 * fallback was found, and a fixture is not a substitute for that.
 */
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import test from 'node:test';
import type { Lesson } from '@inkcast/core';
import { readLessonFile } from '../src/lesson-io.js';
import { resolveLessonAdapter, teachLesson } from '../src/lesson.js';

const SHIPPED = path.resolve(
  import.meta.dirname,
  '../../../examples/lessons/gradient-descent.lesson.json',
);

/**
 * A stand-in for the Messages API, on loopback.
 *
 * Nothing here mocks the SDK: the client is constructed for real and reads its base URL
 * from the environment, so what the stage does with a 402 is what it would do with a 402
 * from Anthropic. `calls` is asserted on, because a test that silently made no request at
 * all would pass every assertion below for the wrong reason.
 */
async function fakeApi(
  reply: (n: number) => { status: number; body: unknown },
): Promise<{ url: string; calls: () => number; close: () => Promise<void> }> {
  let calls = 0;
  const server: Server = createServer((req, res) => {
    calls += 1;
    const { status, body } = reply(calls);
    req.resume();
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    calls: () => calls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Run `fn` with a key and a base URL, and put the environment back afterwards. */
async function withKeyedApi<T>(url: string, fn: () => Promise<T>): Promise<T> {
  const key = process.env.ANTHROPIC_API_KEY;
  const base = process.env.ANTHROPIC_BASE_URL;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-no-credit';
  process.env.ANTHROPIC_BASE_URL = url;
  try {
    return await fn();
  } finally {
    if (key === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = key;
    if (base === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = base;
  }
}

test('a key with no credit reports the author that actually wrote the lesson', async () => {
  const api = await fakeApi(() => ({
    status: 402,
    body: { type: 'error', error: { type: 'billing_error', message: 'Payment Required' } },
  }));
  const authors: string[] = [];
  const lesson = await withKeyedApi(api.url, async () => {
    // The premise of the bug: with a key present the environment resolves to the cloud
    // author, and this is the value every caller used to report.
    assert.equal(resolveLessonAdapter({}), 'anthropic');
    return teachLesson('Osmosis', {
      adapter: 'anthropic',
      onAuthor: (a) => authors.push(a),
    });
  });
  await api.close();

  assert.ok(api.calls() > 0, 'the stage must really have asked the API');
  // What the run has to report. Not `anthropic`, which is what it said before.
  assert.deepEqual(authors, ['heuristic']);
  // And it is a real lesson: the point is that the fallback works and says so, not that
  // the run failed.
  assert.ok(lesson.topic.length > 0);
  assert.ok(lesson.steps.length > 0);
});

test('a lesson the model really wrote is still reported as the model’s', async () => {
  // The other half, and the one a careless fix breaks: reporting `heuristic` for
  // everything would pass the test above and under-bill every keyed run.
  const shipped: Lesson = await readLessonFile(SHIPPED);
  const api = await fakeApi(() => ({
    status: 200,
    body: {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5',
      content: [{ type: 'tool_use', id: 'tu_1', name: 'emit_lesson', input: shipped }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 1200, output_tokens: 3400 },
    },
  }));
  const authors: string[] = [];
  const lesson = await withKeyedApi(api.url, () =>
    teachLesson('Gradient descent', {
      adapter: 'anthropic',
      onAuthor: (a) => authors.push(a),
    }),
  );
  await api.close();

  assert.ok(api.calls() > 0, 'the stage must really have asked the API');
  assert.deepEqual(authors, ['anthropic']);
  assert.equal(lesson.objective, shipped.objective);
});

test('with no key at all the resolved adapter and the observed author agree', async () => {
  // The case that was never wrong, kept because the fix must not move it: nothing resolves
  // to the cloud author, nothing is billed, and the report says `heuristic` for the honest
  // reason rather than by accident.
  const key = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  const authors: string[] = [];
  try {
    assert.equal(resolveLessonAdapter({}), 'heuristic');
    await teachLesson('Osmosis', { onAuthor: (a) => authors.push(a) });
  } finally {
    if (key !== undefined) process.env.ANTHROPIC_API_KEY = key;
  }
  assert.deepEqual(authors, ['heuristic']);
});

test('the author is reported exactly once per authored lesson', async () => {
  // A cached lesson reports nothing, because this stage cannot know who wrote a file it
  // found on disk — which is why the pipeline records the author beside the lesson rather
  // than asking again on the second run. See `LessonSummary.author`.
  const authors: string[] = [];
  await teachLesson('Osmosis', { adapter: 'heuristic', onAuthor: (a) => authors.push(a) });
  assert.deepEqual(authors, ['heuristic']);
});
