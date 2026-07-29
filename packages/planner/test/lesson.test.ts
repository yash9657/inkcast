import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Lesson, critiqueLesson, lessonBeats } from '@inkcast/core';
import { buildDoc } from '../src/ingest.js';
import { anthropicLesson, anthropicLessonEdit } from '../src/lesson-anthropic.js';
import { lessonJsonSchema } from '../src/schema.js';
import { compileLesson } from '../src/compile.js';
import { deriveLesson } from '../src/lesson-derive.js';
import { editLesson, editLessonDetailed } from '../src/lesson-edit.js';
import { readLessonFile } from '../src/lesson-io.js';
import { resolveLessonAdapter, teachLesson } from '../src/lesson.js';
import {
  PRESETS,
  adaptLesson,
  clampNarration,
  lessonSeconds,
  resolvePreset,
} from '../src/presets.js';
import { wordCount } from '../src/text.js';
import { GRADIENT_DESCENT } from './fixture.js';

const SHIPPED = path.resolve(
  import.meta.dirname,
  '../../../examples/lessons/gradient-descent.lesson.json',
);

const shipped = await readLessonFile(SHIPPED);

/* ------------------------------------------------------------- the benchmark */

test('the shipped gradient-descent lesson passes critiqueLesson with zero problems', () => {
  // This is the acceptance test for the whole engine: the lesson we ship as proof
  // must satisfy the same critique the model's output has to survive.
  assert.deepEqual(critiqueLesson(shipped, { maxSeconds: 120 }), []);
  assert.deepEqual(critiqueLesson(shipped, { maxSeconds: PRESETS.standard.maxSeconds }), []);
  assert.deepEqual(critiqueLesson(shipped), []);
});

test('the shipped lesson has the shape the benchmark asks for', () => {
  const roles = lessonBeats(shipped).map((b) => b.role);
  assert.deepEqual(roles, [
    'hook',
    'anchor',
    'step',
    'step',
    'step',
    'step',
    'worked',
    'misconception',
    'recap',
  ]);
  // A hook is a question or a surprise, never a plan of the video.
  assert.match(shipped.hook.narration, /\?$/);
  // The worked example must carry real numbers a learner can check.
  assert.match(shipped.worked!.narration, /three minus nought point four is two point six/i);
  assert.match(shipped.worked!.visuals[0]!.describe, /w = 3.*slope = \+4.*learning rate 0\.1/);
  // The misconception is the specific wrong belief, not a generic caveat.
  assert.match(shipped.misconception!.idea, /\ba minimum, not the minimum\b/i);
  // Jargon is declared and kept out of the hook.
  assert.ok(shipped.jargonBudget.includes('learning rate'));
  assert.ok(!/learning rate/i.test(shipped.hook.narration));
  // Every beat but the recap has something to look at, and every reason is stated.
  for (const { step, role } of lessonBeats(shipped)) {
    if (role !== 'recap') assert.ok(step.visuals.length > 0, `${role} has no visual`);
    if (role !== 'recap' && role !== 'hook') assert.ok(step.because.trim().length > 20, role);
  }
});

/* ------------------------------------------------ the pedagogy is on the record */

test('the shipped lesson records how it teaches, and every derivation resolves', () => {
  assert.equal(shipped.kind, 'stem');
  assert.equal(shipped.strategy, 'analogy');
  assert.ok(shipped.coreInsight.length > 40, 'the core insight is a sentence, not a label');

  // Every part of the hill the lesson leans on maps to something, in the plain words
  // the narration actually uses rather than the jargon it is avoiding.
  const maps = shipped.analogy?.maps ?? [];
  assert.ok(maps.length >= 3, 'the analogy carries its correspondences');
  for (const m of maps) {
    assert.ok(m.from.trim() && m.to.trim(), 'a correspondence with an empty side maps nothing');
    for (const term of shipped.jargonBudget) {
      assert.ok(
        !m.to.toLowerCase().includes(term.toLowerCase()),
        `the mapping leans on unearned jargon: "${term}"`,
      );
    }
  }

  // `derivedFrom` names real, earlier beats — the property the validator enforces,
  // asserted here against the lesson we ship as proof.
  const beats = lessonBeats(shipped);
  const seen = new Set<string>();
  for (const { step, id, role } of beats) {
    if (step.from === 'derived') {
      assert.ok(step.derivedFrom.length > 0, `${role} is derived from nothing`);
      for (const ref of step.derivedFrom) {
        assert.ok(seen.has(ref), `${role} derives from "${ref}", which is not an earlier beat`);
      }
    }
    seen.add(id);
  }
  // The first step earns its place on the anchor, which is what makes it the bridge.
  assert.deepEqual(shipped.steps[0]!.derivedFrom, ['anchor']);
});

test('critiqueLesson rejects what the new fields exist to catch', () => {
  // A first-principles lesson that asserts is not one, and no budget or beat count
  // makes it acceptable. This is the rule `from` exists for.
  const asserted = {
    ...shipped,
    strategy: 'first-principles' as const,
    analogy: undefined,
    steps: [
      { ...shipped.steps[0]!, from: 'asserted' as const, derivedFrom: [] },
      ...shipped.steps.slice(1),
    ],
  };
  assert.ok(
    critiqueLesson(asserted).some((p) => /is asserted, and a first-principles lesson/.test(p)),
    'an asserted step in a first-principles lesson must be rejected',
  );
  // ...and the same lesson taught by analogy is allowed to assert, so the rule is
  // the strategy's and not a blanket one.
  assert.equal(
    critiqueLesson({ ...asserted, strategy: 'analogy', analogy: shipped.analogy }).some((p) =>
      /is asserted/.test(p),
    ),
    false,
  );

  // A forward reference is an ordering bug, and it reads differently from a typo.
  const forward = {
    ...shipped,
    steps: [
      { ...shipped.steps[0]!, from: 'derived' as const, derivedFrom: ['step4'] },
      ...shipped.steps.slice(1),
    ],
  };
  assert.ok(critiqueLesson(forward).some((p) => /which comes later/.test(p)));
  const unknown = {
    ...shipped,
    steps: [
      { ...shipped.steps[0]!, from: 'derived' as const, derivedFrom: ['step9'] },
      ...shipped.steps.slice(1),
    ],
  };
  assert.ok(critiqueLesson(unknown).some((p) => /is not a beat in this lesson/.test(p)));
  const nothing = {
    ...shipped,
    steps: [
      { ...shipped.steps[0]!, from: 'derived' as const, derivedFrom: [] },
      ...shipped.steps.slice(1),
    ],
  };
  assert.ok(critiqueLesson(nothing).some((p) => /names nothing it derives from/.test(p)));

  // An analogy is its correspondences; without them the learner is told two things
  // are alike and left to guess in what respect.
  assert.ok(
    critiqueLesson({ ...shipped, analogy: { concrete: 'a hill', maps: [] } }).some((p) =>
      /names no correspondences/.test(p),
    ),
  );
  assert.ok(
    critiqueLesson({ ...shipped, analogy: undefined }).some((p) =>
      /teaches by analogy but does not record one/.test(p),
    ),
  );
  assert.ok(
    critiqueLesson({ ...shipped, coreInsight: '  ' }).some((p) =>
      /does not name the one insight/.test(p),
    ),
  );
});

test('a lesson written before these fields existed still parses', () => {
  // `parseLesson` reads saved projects. If the new fields were required without
  // defaults, every lesson.json on disk would start failing to load.
  const old = JSON.parse(JSON.stringify(shipped)) as Record<string, unknown>;
  for (const k of ['kind', 'strategy', 'coreInsight', 'analogy']) delete old[k];
  for (const beat of ['hook', 'anchor', 'recap']) {
    const step = old[beat] as Record<string, unknown>;
    delete step.from;
    delete step.derivedFrom;
  }
  const parsed = Lesson.parse(old);
  assert.equal(parsed.kind, 'stem');
  assert.equal(parsed.strategy, 'first-principles');
  assert.equal(parsed.hook.from, 'given');
  assert.deepEqual(parsed.hook.derivedFrom, []);
});

test('the shipped lesson runs at teaching pace, around ninety seconds', () => {
  const seconds = lessonSeconds(shipped, 2.5);
  assert.ok(seconds > 80 && seconds < 115, `${seconds}s`);
  for (const { step, role } of lessonBeats(shipped)) {
    const words = wordCount(step.narration);
    assert.ok(words >= 14 && words <= 42, `${role}: ${words} words`);
    // Sentence-boundary narration only: no beat may end mid-clause.
    assert.match(step.narration.trim(), /[.!?]$/, role);
  }
});

test('every cue in the shipped lesson is verbatim in its own narration', () => {
  for (const { step, role } of lessonBeats(shipped)) {
    for (const v of step.visuals) {
      if (!v.cue) continue;
      assert.ok(
        step.narration.toLowerCase().includes(v.cue.toLowerCase()),
        `${role}: cue "${v.cue}" is not in its narration`,
      );
    }
  }
});

/* -------------------------------------------------------------------- presets */

test('the short preset is a different lesson, not a crop', () => {
  const long = adaptLesson(shipped, PRESETS.standard);
  const short = adaptLesson(shipped, PRESETS.short);
  assert.ok(lessonBeats(short).length < lessonBeats(long).length, 'vertical drops beats');
  const seconds = lessonSeconds(short, PRESETS.short.wordsPerSecond);
  assert.ok(seconds >= 40 && seconds <= 60, `${seconds}s is outside the 45–60s window`);
  for (const { step, role } of lessonBeats(short)) {
    assert.ok(step.visuals.length <= 1, `${role} draws ${step.visuals.length} visuals`);
  }
  // The two beats that must survive intact: the question, and the arithmetic.
  assert.match(short.hook.narration, /\?$/);
  assert.match(short.worked!.narration, /two point six/i);
  // Trimming never cuts mid-sentence.
  for (const { step } of lessonBeats(short)) assert.match(step.narration.trim(), /[.!?]$/);
});

test('dropping a beat does not leave a derivation pointing at the wrong one', () => {
  // Beat ids are positional, so dropping a step renumbers the survivors. Left alone
  // that does not merely dangle, it lies: before this was handled, the shipped lesson
  // at the `short` preset had its surviving third step renumbered to `step1` and its
  // reference to the old `step1` therefore pointed at itself.
  for (const name of ['standard', 'short'] as const) {
    const shaped = adaptLesson(shipped, PRESETS[name]);
    const beats = lessonBeats(shaped);
    const seen = new Set<string>();
    for (const { step, id, role } of beats) {
      assert.ok(!step.derivedFrom.includes(id), `${name}: ${id} (${role}) derives from itself`);
      for (const ref of step.derivedFrom) {
        assert.ok(
          seen.has(ref),
          `${name}: ${id} (${role}) derives from "${ref}", not an earlier beat`,
        );
      }
      // A beat whose antecedents were all cut is no longer a derived beat.
      if (step.from === 'derived') assert.ok(step.derivedFrom.length > 0, `${name}: ${id}`);
      seen.add(id);
    }
    // And the adapted lesson still passes the validator that checks exactly this.
    assert.deepEqual(critiqueLesson(shaped, { maxSeconds: PRESETS[name].maxSeconds }), []);
  }
});

test('a dropped beat is spliced out of the chain, not forgotten', () => {
  // If B follows from A and A is cut, B follows from whatever A followed from. The
  // chain stays honest at whatever length the budget allows.
  const four = {
    ...shipped,
    steps: [
      { ...shipped.steps[0]!, from: 'given' as const, derivedFrom: [] },
      { ...shipped.steps[1]!, from: 'derived' as const, derivedFrom: ['step1'] },
      { ...shipped.steps[2]!, from: 'derived' as const, derivedFrom: ['step2'] },
      { ...shipped.steps[3]!, from: 'derived' as const, derivedFrom: ['step3'] },
    ],
  };
  const short = adaptLesson(four, PRESETS.short);
  const kept = short.steps.length;
  assert.ok(kept < 4, 'the vertical preset drops steps, or this proves nothing');
  // Whatever survived, the last surviving step still traces back to the first one.
  const last = short.steps[kept - 1]!;
  if (kept > 1) assert.deepEqual(last.derivedFrom, [`step${kept - 1}`]);
});

test('an explicit aspect overrides the preset it implies', () => {
  assert.equal(resolvePreset({}).name, 'standard');
  assert.equal(resolvePreset({ aspect: '9:16' }).name, 'short');
  assert.equal(resolvePreset({ aspect: '1:1' }).name, 'square');
  const forced = resolvePreset({ preset: 'short', aspect: '16:9' });
  assert.equal(forced.aspect, '16:9');
  assert.equal(forced.vertical, false);
});

test('clampNarration only ever cuts at a sentence boundary', () => {
  const text = 'One two three four. Five six seven eight nine. Ten eleven twelve.';
  assert.equal(clampNarration(text, 6), 'One two three four.');
  assert.equal(clampNarration(text, 10), 'One two three four. Five six seven eight nine.');
  assert.equal(clampNarration(text, 99), text);
  // A single sentence over budget survives whole rather than becoming a fragment.
  assert.equal(
    clampNarration('A very long single sentence that cannot be cut.', 3),
    'A very long single sentence that cannot be cut.',
  );
});

/* ----------------------------------------------------- the zero-key derivation */

const doc = buildDoc(GRADIENT_DESCENT, 'markdown');

test('a lesson derived from a document is a real, valid, renderable lesson', () => {
  const derived = deriveLesson(doc, {}, PRESETS.standard);
  assert.deepEqual(Lesson.parse(derived), derived, 'derived lessons are already valid');
  assert.equal(derived.topic, 'Gradient Descent');
  assert.ok(derived.steps.length >= 2);
  // The honest fallback still has to pass its own critique.
  assert.deepEqual(critiqueLesson(derived, { maxSeconds: PRESETS.standard.maxSeconds }), []);
  // And it must compile to something drawable.
  const sb = compileLesson(derived, {});
  assert.equal(sb.scenes.length, lessonBeats(adaptLesson(derived, PRESETS.standard)).length);
  assert.ok(sb.scenes.every((s) => s.elements.length > 0));
});

test('a bare topic string needs no document', () => {
  const derived = deriveLesson('Osmosis', {}, PRESETS.standard);
  assert.equal(derived.topic, 'Osmosis');
  assert.deepEqual(critiqueLesson(derived, { maxSeconds: PRESETS.standard.maxSeconds }), []);
});

test('teachLesson with no key derives, validates and caches', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'inkcast-lesson-'));
  const first = await teachLesson(doc, { adapter: 'heuristic', dir });
  const second = await teachLesson(doc, { adapter: 'heuristic', dir });
  assert.deepEqual(second, first, 'the second call comes from lesson.json');
  const onDisk = await readLessonFile(path.join(dir, 'lesson.json'));
  assert.deepEqual(onDisk, first);
});

/* -------------------------------------------------- the forced tool call shape */

test('the Lesson tool schema makes the shape of a lesson non-optional', async () => {
  const schema = (await lessonJsonSchema()) as {
    required: string[];
    properties: Record<string, { properties?: Record<string, unknown> }>;
  };
  assert.ok(schema, 'zod-to-json-schema must be available for the cloud path');
  // A model forced through this tool cannot hand back a summary with a title on
  // it: the hook, the anchor, the ordered steps and the recap are all required.
  for (const field of ['version', 'topic', 'objective', 'hook', 'anchor', 'steps', 'recap']) {
    assert.ok(schema.required.includes(field), `${field} must be required`);
  }
  for (const beat of ['hook', 'anchor', 'recap', 'worked', 'misconception']) {
    assert.deepEqual(Object.keys(schema.properties[beat]!.properties ?? {}), [
      'idea',
      'because',
      'from',
      'derivedFrom',
      'narration',
      'visuals',
      'hold',
    ]);
  }
  // The pedagogy fields have to reach the model, or it cannot be asked to choose
  // them — and the mapping table is what the storyboard compiler reads to decide
  // where the abstraction arrives on the board.
  for (const field of ['kind', 'strategy', 'coreInsight', 'analogy']) {
    assert.ok(schema.properties[field], `${field} must be offered to the model`);
  }
});

test('with no key the cloud path declines cleanly instead of crashing', async () => {
  assert.equal(process.env.ANTHROPIC_API_KEY, undefined, 'this suite runs with no key');
  assert.equal(resolveLessonAdapter({}), 'heuristic');
  // Asking for the cloud author explicitly warns and degrades; it never throws.
  assert.equal(resolveLessonAdapter({ adapter: 'anthropic' }), 'heuristic');
  assert.equal(await anthropicLesson('anything at all', {}), undefined);
  assert.equal(await anthropicLessonEdit(shipped, 'make it better', {}), undefined);
});

/* ------------------------------------------------------------------- editing */

test('editLesson revises the teaching without a key', async () => {
  const dropped = await editLessonDetailed(shipped, 'drop the misconception', {
    adapter: 'heuristic',
  });
  assert.equal(dropped.lesson.misconception, undefined);
  assert.equal(dropped.report.applied.length, 1);
  assert.deepEqual(dropped.report.problems, []);
  // The original is untouched: edits never mutate their input.
  assert.ok(shipped.misconception);

  const slower = await editLesson(shipped, 'slower', { adapter: 'heuristic' });
  assert.ok(slower.recap.hold > shipped.recap.hold, 'silence grew');

  const objective = await editLesson(shipped, 'objective: explain the minus sign', {
    adapter: 'heuristic',
  });
  assert.equal(objective.objective, 'explain the minus sign');

  const jargon = await editLesson(shipped, 'avoid the words tensor, epoch', {
    adapter: 'heuristic',
  });
  assert.ok(jargon.jargonBudget.includes('tensor') && jargon.jargonBudget.includes('epoch'));

  const dropStep = await editLesson(shipped, 'remove the second step', { adapter: 'heuristic' });
  assert.equal(dropStep.steps.length, shipped.steps.length - 1);
  assert.equal(dropStep.steps[1]!.idea, shipped.steps[2]!.idea);

  const vertical = await editLesson(shipped, 'make it vertical', { adapter: 'heuristic' });
  assert.ok(lessonBeats(vertical).length < lessonBeats(shipped).length);
});

test('editLesson says what it cannot do rather than pretending', async () => {
  const { lesson, report } = await editLessonDetailed(
    shipped,
    'rewrite the hook to be funnier; make it slower',
    { adapter: 'heuristic' },
  );
  assert.deepEqual(report.needsKey, ['rewrite the hook to be funnier']);
  assert.equal(report.applied.length, 1);
  assert.equal(lesson.hook.narration, shipped.hook.narration, 'prose is left alone');

  const nonsense = await editLessonDetailed(shipped, 'flurb the bandersnatch', {
    adapter: 'heuristic',
  });
  assert.deepEqual(nonsense.report.unsupported, ['flurb the bandersnatch']);
});
