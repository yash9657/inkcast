import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { Lesson, Mark, lessonBeats } from '@inkcast/core';
import { adaptLesson, PRESETS } from '../src/presets.js';
import { applyScriptDraft, scriptReviewProblems, fitScript } from '../src/fit-script.js';
import { labelTargetProblems, resolveLabelAnchors } from '../src/label-anchors.js';
import { callTool, type Client } from '../src/anthropic.js';

const fixture = Lesson.parse(
  JSON.parse(
    await readFile(
      new URL('../../../examples/lessons/gradient-descent.lesson.json', import.meta.url),
      'utf8',
    ),
  ),
);

test('a short preset retains the causal sentence after a demonstration setup', () => {
  const lesson = structuredClone(fixture);
  lesson.anchor.narration =
    'Put a ball on a table and shine a lamp at it. Light travels in straight lines, so it only reaches the side facing the lamp. The far side is in the ball’s own shadow.';
  const result = adaptLesson(lesson, PRESETS.explainer);
  assert.equal(result.anchor.narration, lesson.anchor.narration);
  assert.ok(result.anchor.narration.includes('shadow'));
});

test('script rewrites are complete and atomic, never a partially applied edit', () => {
  const beats = lessonBeats(fixture).map(({ id, step }) => ({ id, narration: step.narration }));
  assert.throws(() => applyScriptDraft(fixture, { beats: beats.slice(1) }), /every original beat/);
  assert.throws(
    () => applyScriptDraft(fixture, { beats: [...beats.slice(1), beats[1]] }),
    /every original beat/,
  );
  const draft = structuredClone(beats);
  draft[0]!.narration = 'A complete revised opening.';
  assert.equal(applyScriptDraft(fixture, { beats: draft }).hook.narration, draft[0]!.narration);
  assert.notEqual(fixture.hook.narration, draft[0]!.narration);
});

test('review requires every beat, and rejects lost reasoning or invented claims', () => {
  const beats = lessonBeats(fixture).map(({ id }) => ({
    id,
    preservesMeaning: true,
    introducesUnsupportedClaim: false,
    reason: '',
  }));
  assert.deepEqual(scriptReviewProblems(fixture, { beats }), []);
  assert.equal(scriptReviewProblems(fixture, { beats: beats.slice(1) }).length, 1);
  beats[1]!.preservesMeaning = false;
  beats[1]!.reason = 'The reason for the result was removed.';
  assert.match(scriptReviewProblems(fixture, { beats })[0]!, /reason/);
});

test('a rejected semantic rewrite retains the original script and records why', async () => {
  const beats = lessonBeats(fixture).map(({ id }) => ({ id, narration: 'The slope matters.' }));
  const review = {
    beats: beats.map(({ id }) => ({
      id,
      preservesMeaning: false,
      introducesUnsupportedClaim: false,
      reason: 'Missing mechanism.',
    })),
  };
  let calls = 0;
  const client = {
    messages: {
      create: async (body: { tools: { name: string }[] }) => ({
        content: [
          {
            type: 'tool_use',
            name: body.tools[0]!.name,
            input: calls++ === 0 ? { beats } : review,
          },
        ],
      }),
    },
  } as Client;
  const problems: string[] = [];
  const result = await fitScript(
    fixture,
    { maxSeconds: 40, onProblem: (p) => problems.push(p) },
    'test-model',
    client,
  );
  assert.equal(result, fixture);
  assert.match(problems.join(' '), /retained the complete original/);
  assert.equal(calls, 2);
});

test('a bound label follows its intended part after geometry changes', () => {
  const marks = [
    Mark.parse({ id: 'receiver', kind: 'rect', x: 400, y: 200, w: 80, h: 160 }),
    Mark.parse({
      id: 'name',
      kind: 'label',
      text: 'Receiver',
      x: 150,
      y: 280,
      target: { partId: 'receiver', anchor: 'left' },
    }),
  ];
  const first = resolveLabelAnchors(marks);
  assert.deepEqual(first.at(-1)!.points!.at(-1), [400, 280]);
  const moved = structuredClone(first);
  moved[0]!.x = 600;
  const second = resolveLabelAnchors(moved);
  assert.deepEqual(second.at(-1)!.points!.at(-1), [600, 280]);
  assert.equal(second.filter((m) => m.id.endsWith('--target-leader')).length, 1);
  assert.deepEqual(resolveLabelAnchors(second), second);
});

test('dangling or ambiguous part identities fail instead of drawing a plausible wrong leader', () => {
  const label = Mark.parse({
    id: 'name',
    kind: 'label',
    text: 'Receiver',
    x: 50,
    y: 50,
    target: { partId: 'missing' },
  });
  assert.throws(() => resolveLabelAnchors([label]), /not a drawable part/);
  assert.ok(labelTargetProblems([label, label]).some((s) => s.includes('duplicate')));
});

test('failed model output is billed before the sanitized failure reaches the caller', async () => {
  const client: Client = {
    messages: {
      create: async () => ({
        content: [],
        failure: 'Fireworks output limit reached; incomplete output rejected',
        usage: { input_tokens: 123, output_tokens: 456 },
      }),
    },
  };
  const spend: unknown[] = [];
  await assert.rejects(
    callTool(client, 'model', 'system', [], {}, undefined, 1000, (value) => spend.push(value)),
    /incomplete output rejected/,
  );
  assert.deepEqual(spend, [{ model: 'model', inTokens: 123, outTokens: 456 }]);
});

test('source review rejects omissions and invented evidence, and invalidates after an edit', async () => {
  const { sourceReviewProblems, attachSourceReview } = await import('../src/source-review.js');
  const { lessonSourceCheck } = await import('@inkcast/core');
  const source = 'The negative gradient points downhill.';
  const beats = lessonBeats(fixture).map(({ id }) => ({
    id,
    supported: true,
    quotes: [source],
    reason: 'Follows the source.',
  }));
  assert.deepEqual(sourceReviewProblems(fixture, source, { beats, issues: [] }).problems, []);
  assert.match(
    sourceReviewProblems(fixture, source, { beats: beats.slice(1), issues: [] }).problems.join(' '),
    /every beat/,
  );
  const invented = structuredClone(beats);
  invented[0]!.quotes = ['An invented citation.'];
  assert.match(
    sourceReviewProblems(fixture, source, { beats: invented, issues: [] }).problems.join(' '),
    /verbatim/,
  );
  const lesson = structuredClone(fixture);
  attachSourceReview(lesson, { title: 'Test', text: source, sections: [] }, 'test-model', beats);
  assert.equal(lessonSourceCheck(lesson).status, 'pass');
  lesson.recap.narration += ' An unreviewed claim.';
  assert.equal(lessonSourceCheck(lesson).status, 'fail');
});

test('range circles pass through their shared point by construction and survive repeated preparation', async () => {
  const { resolveGeometryConstraints, geometryConstraintProblems } =
    await import('../src/geometry-constraints.js');
  const marks = [
    Mark.parse({ id: 'point', kind: 'ellipse', x: 295, y: 295, w: 10, h: 10 }),
    Mark.parse({ id: 'a', kind: 'ellipse', x: 50, y: 50, w: 100, h: 100, circleThrough: 'point' }),
    Mark.parse({ id: 'b', kind: 'ellipse', x: 450, y: 50, w: 100, h: 100, circleThrough: 'point' }),
  ];
  const solved = resolveGeometryConstraints(marks);
  for (const circle of solved.slice(1)) {
    assert.ok(
      Math.abs(
        Math.hypot(circle.x! + circle.w! / 2 - 300, circle.y! + circle.h! / 2 - 300) -
          circle.w! / 2,
      ) < 1e-8,
    );
  }
  assert.deepEqual(resolveGeometryConstraints(solved), solved);
  marks[1]!.circleThrough = 'missing';
  assert.ok(geometryConstraintProblems(marks).length);
});

test('drawing correction preserves the speech and geometric bindings of each mark', async () => {
  const { preserveMarkBindings } = await import('../src/draw-critic.js');
  const before = [
    Mark.parse({
      id: 'circle',
      kind: 'ellipse',
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      circleThrough: 'point',
      cue: 'one range',
    }),
    Mark.parse({ id: 'point', kind: 'ellipse', x: 48, y: 0, w: 4, h: 4, cue: 'possible position' }),
    Mark.parse({
      id: 'label',
      kind: 'label',
      x: 100,
      y: 100,
      text: 'candidate',
      cue: 'possible position',
      target: { partId: 'point', anchor: 'center' },
    }),
  ];
  const moved = before.map(({ cue, circleThrough, target, ...m }) => ({ ...m, x: 120 }));
  const after = preserveMarkBindings(before, moved);
  assert.equal(after[0]!.circleThrough, 'point');
  assert.deepEqual(after[2]!.target, { partId: 'point', anchor: 'center' });
  assert.deepEqual(
    after.map((m) => m.cue),
    before.map((m) => m.cue),
  );
  assert.equal(after[2]!.x, 120);
});

test('composed diagram labels do not get a duplicate vocabulary footer', async () => {
  const { planVocabulary } = await import('../src/compile.js');
  const step = structuredClone(fixture.steps[0]!);
  step.title = 'Timing errors';
  step.narration = 'The clock offset changes the range error.';
  step.terms = ['clock offset', 'range error'];
  step.visuals = [
    {
      kind: 'draw',
      describe: 'A labelled clock',
      marks: [
        Mark.parse({ id: 'label', kind: 'label', x: 100, y: 100, text: 'clock offset', size: 32 }),
      ],
    },
  ];
  assert.deepEqual(planVocabulary([{ step, role: 'step' }], PRESETS.explainer), [['range error']]);
});

test('newly authored lesson steps require concise titles in the model schema', async () => {
  const { lessonJsonSchema } = await import('../src/schema.js');
  const schema = (await lessonJsonSchema()) as any;
  assert.ok(schema.properties.hook.required.includes('title'));
  assert.ok(schema.properties.steps.items.required.includes('title'));
  assert.ok(schema.properties.recap.required.includes('title'));
});

test('simple generated formula commands recover one extra JSON escape layer', async () => {
  const { normalizeGeneratedTex } = await import('../src/tex.js');
  assert.equal(normalizeGeneratedTex(String.raw`300\\ \\mathrm{m}`), String.raw`300\ \mathrm{m}`);
  assert.equal(normalizeGeneratedTex(String.raw`\times`), String.raw`\times`);
  assert.equal(
    normalizeGeneratedTex(String.raw`\begin{matrix}a\\b\end{matrix}`),
    String.raw`\begin{matrix}a\\b\end{matrix}`,
  );
  assert.equal(normalizeGeneratedTex(String.raw`a\\b`), String.raw`a\\b`);
});
