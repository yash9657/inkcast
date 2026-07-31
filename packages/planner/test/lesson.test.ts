import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  CADENCE,
  Lesson,
  cadenceFor,
  critiqueLesson,
  findTerms,
  holdForCadence,
  lessonBeats,
  resolveEmphasis,
  resolveTerms,
  technicalTerms,
} from '@inkcast/core';
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
      'cadence',
      'emphasis',
      'terms',
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

/* --------------------------------------------------------------------- cast */

const NARRATIVE = path.resolve(
  import.meta.dirname,
  '../../../examples/lessons/longitude.lesson.json',
);
const narrative = await readLessonFile(NARRATIVE);

test('the shipped narrative lesson passes critiqueLesson with zero problems', () => {
  // The second acceptance lesson, and the one that exercises the parts a derivation
  // never touches: a declared cast, poses named per beat, and `kind: narrative`.
  assert.deepEqual(critiqueLesson(narrative, { maxSeconds: PRESETS.standard.maxSeconds }), []);
  assert.equal(narrative.kind, 'narrative');
});

test('every beat of the narrative lesson survives the standard budget', () => {
  // A dropped beat is a dropped pose, and the whole point of the lesson is that one
  // person is drawn four ways. `adaptLesson` trims to fit, so the lesson has to fit.
  const adapted = adaptLesson(narrative, PRESETS.standard);
  assert.equal(lessonBeats(adapted).length, lessonBeats(narrative).length);
});

test('a lesson written before `cast` existed still parses', async () => {
  // The reason `cast` is defaulted rather than required: every `lesson.json` already
  // on disk predates it, and the schema stays at version 1 — the cache invalidates
  // through the stage version instead of through a schema break.
  const onDisk = JSON.parse(await readFile(SHIPPED, 'utf8'));
  assert.equal('cast' in onDisk, false, 'the shipped lesson should not have been rewritten');
  const parsed = Lesson.parse(onDisk);
  assert.deepEqual(parsed.cast, []);
  // And an intent written before `character` existed keeps parsing too.
  assert.equal(parsed.hook.visuals[0]?.character, undefined);
});

test('a character reference that names nobody in the cast is a critique failure', () => {
  // Same class as a `derivedFrom` naming no beat: it resolves to no library path, so
  // it draws nothing rather than drawing the wrong thing. Worth catching before it
  // costs a render.
  const l = structuredClone(narrative);
  l.steps[0]!.visuals[0]!.character = { id: 'nobody' };
  assert.ok(
    critiqueLesson(l).some((p) => /character "nobody", who is not in the cast/.test(p)),
    'a dangling character reference passed critique',
  );
});

test('a narrative lesson with no cast is a critique failure', () => {
  // `kind` was accepted, prompted for, and read by nothing. This is the first rule
  // that branches on it, and it mirrors the analogy rule: a lesson that declares
  // itself carried by characters and names none is not one.
  const l = structuredClone(narrative);
  l.cast = [];
  for (const beat of lessonBeats(l)) for (const v of beat.step.visuals) delete v.character;
  assert.ok(
    critiqueLesson(l).some((p) => /carried by characters but declares no cast/.test(p)),
    'a cast-less narrative lesson passed critique',
  );
  // And the same lesson called a derivation is fine, so the rule is about `kind`.
  assert.deepEqual(
    critiqueLesson({ ...l, kind: 'stem' as const }).filter((p) => /cast/.test(p)),
    [],
  );
});

/* ------------------------------------------------------------------- pacing */

/** A minimal beat, so a cadence rule can be tested without a whole lesson. */
function beat(narration: string, extra: Partial<Parameters<typeof cadenceFor>[0]> = {}) {
  return {
    idea: 'x',
    because: 'y',
    from: 'given' as const,
    derivedFrom: [],
    emphasis: [],
    terms: [],
    narration,
    hold: 0.4,
    visuals: [],
    ...extra,
  };
}

test('cadence is read off what the beat is doing', () => {
  const body =
    'The slope under your feet tells you which way the ground falls away from here, ' +
    'and that is the only thing you need in order to take a sensible step downhill.';
  // A question is slow, whatever role it plays: the silence afterwards is the point.
  assert.equal(cadenceFor(beat('So what do you do?'), 'step'), 'slow_deliberate');
  assert.equal(cadenceFor(beat('So what do you do?'), 'hook'), 'slow_deliberate');
  // Arithmetic and corrections have to be followed.
  assert.equal(cadenceFor(beat(body), 'worked'), 'slow_deliberate');
  assert.equal(cadenceFor(beat(body), 'misconception'), 'slow_deliberate');
  // A hook that is not a question has five seconds to earn attention.
  assert.equal(cadenceFor(beat(body), 'hook'), 'punchy');
  // A genuinely short beat is an aside.
  assert.equal(cadenceFor(beat('That is the whole idea.'), 'step'), 'punchy');
  // Everything else builds — the recap included.
  assert.equal(cadenceFor(beat(body), 'step'), 'building_energy');
  assert.equal(cadenceFor(beat(body), 'recap'), 'building_energy');
  // An author who states a cadence is taken at their word, rules or no rules.
  assert.equal(cadenceFor(beat('So what do you do?', { cadence: 'punchy' }), 'hook'), 'punchy');
});

test('a punchy beat cannot be given a long silence, however much is asked for', () => {
  // The guarantee the whole mechanism exists for. Before this, `hold` was set in the
  // compiler and the speech rate in the voice stage from a global setting, so a beat
  // written as a quick aside could be followed by two seconds of dead air and nothing
  // could notice the two were fighting.
  const greedy = beat('That is the whole idea.', { hold: 3 });
  const paced = holdForCadence(greedy, 'step', 1);
  assert.equal(paced.cadence, 'punchy');
  assert.equal(paced.hold, CADENCE.punchy.maxHold);
  assert.ok(paced.hold <= 0.8, `punchy held ${paced.hold}s`);

  // A slow beat may have the pause, and the same greedy request is honoured there.
  const slow = holdForCadence(beat('Is that right?', { hold: 3 }), 'step', 1);
  assert.equal(slow.cadence, 'slow_deliberate');
  assert.ok(slow.hold > 0.8 && slow.hold <= CADENCE.slow_deliberate.maxHold);

  // And the cadence's own baseline is a floor, so a lesson that never thought about
  // silence still gets a considered pause rather than none.
  assert.equal(holdForCadence(beat('Is that right?', { hold: 0 }), 'step').hold, 0.9);
});

test('every cadence speaks inside the 140-160 wpm teaching band', () => {
  // The band is a considered decision the MVP's 193 wpm is the counterexample to. A
  // cadence that leaves it is the pacing feature quietly breaking the pacing rule.
  for (const [name, spec] of Object.entries(CADENCE)) {
    const wpm = 150 * spec.rate;
    assert.ok(wpm >= 139.5 && wpm <= 160.5, `${name} speaks at ${wpm.toFixed(1)} wpm`);
  }
  assert.ok(CADENCE.punchy.rate > CADENCE.building_energy.rate);
  assert.ok(CADENCE.building_energy.rate > CADENCE.slow_deliberate.rate);
  assert.ok(CADENCE.punchy.maxHold < CADENCE.slow_deliberate.maxHold);
});

test('emphasis has to be findable in the words it emphasises', () => {
  const step = beat('The slope points uphill, and we want to go down.', {
    emphasis: ['points uphill', 'go DOWN', 'nowhere in this text'],
  });
  const { found, missing } = resolveEmphasis(step);
  // Matching is case-insensitive, because an author quoting their own narration
  // should not be defeated by capitalisation.
  assert.deepEqual(found, ['points uphill', 'go DOWN']);
  assert.deepEqual(missing, ['nowhere in this text']);

  const l = structuredClone(shipped);
  l.steps[0]!.emphasis = ['a phrase that is not there'];
  assert.ok(
    critiqueLesson(l).some((p) => /emphasises "a phrase that is not there"/.test(p)),
    'unfindable emphasis passed critique',
  );
});

/* -------------------------------------------------------------- the vocabulary */

test('technicalTerms names the vocabulary and leaves the prose alone', () => {
  // Three rules, and the initialism is the one that matters most: the voice stage
  // spells ATP out letter by letter, so a listener cannot recover the word unless the
  // board also writes it.
  assert.deepEqual(
    technicalTerms('It runs in the stroma, spending the ATP and NADPH stage one made.', 2),
    ['ATP', 'NADPH'],
  );
  // A name pairs with the noun it qualifies, but only inside an article — otherwise the
  // next word is as likely to be a verb.
  assert.deepEqual(findTerms('The second stage is the Calvin cycle.')[0], {
    text: 'Calvin cycle',
    kind: 'name',
    at: 24,
  });
  assert.deepEqual(
    findTerms('So wait for noon, and if London says three you are three hours behind.').map(
      (t) => t.text,
    ),
    ['London'],
  );
  // A long content word counts; everyday English, inflections and descriptive
  // compounds do not.
  assert.deepEqual(technicalTerms('The thylakoid membranes are studded with chlorophyll.', 3), [
    'thylakoid',
    'membranes',
    'chlorophyll',
  ]);
  assert.deepEqual(
    technicalTerms('The one-line version is actually more interesting than the summary suggests.'),
    [],
  );
  // Two forms of one word are one term: a board that writes both has written nothing
  // twice.
  assert.deepEqual(technicalTerms('Six molecules become one molecule of glucose.', 3), [
    'molecules',
    'glucose',
  ]);
  // A sentence-initial capital is how sentences start, not a name.
  assert.deepEqual(findTerms('Measure the slope. Repeat that and you reach the bottom.'), []);
});

test('a term has to be findable in the narration that says it', () => {
  const step = beat('It runs in the stroma, spending the ATP that stage one made.', {
    terms: ['ATP', 'atp', 'NADPH'],
  });
  const { found, missing } = resolveTerms(step);
  // Case-insensitive, deduplicated, and in the order the words are spoken — which is
  // the order the board writes them in.
  assert.deepEqual(found, ['ATP']);
  assert.deepEqual(missing, ['NADPH']);

  const l = structuredClone(shipped);
  l.steps[0]!.terms = ['a term nobody says'];
  assert.ok(
    critiqueLesson(l).some((p) => /writes the term "a term nobody says"/.test(p)),
    'an unfindable term passed critique',
  );
});

test('an initialism spoken and never written anywhere is a critique failure', () => {
  const l = structuredClone(shipped);
  l.steps[0]!.narration = 'The gradient is what a GPU spends its whole day computing.';
  l.steps[0]!.emphasis = [];
  assert.ok(
    critiqueLesson(l).some((p) => /says "GPU" and no beat writes it/.test(p)),
    'a spoken initialism that nothing writes passed critique',
  );

  // Naming it fixes it — and so does a caption that already carries it, because the
  // board never wipes and the word is up there either way.
  const named = structuredClone(l);
  named.steps[0]!.terms = ['GPU'];
  assert.deepEqual(critiqueLesson(named), []);
  const captioned = structuredClone(l);
  captioned.steps[0]!.idea = 'A GPU spends its day on this';
  assert.deepEqual(critiqueLesson(captioned), []);

  // A recap is never asked for vocabulary: it retraces what earlier beats introduced,
  // and their words are still on the board.
  const recapped = structuredClone(shipped);
  recapped.recap.narration = 'And that is what a GPU does all day, one small step at a time.';
  recapped.steps[0]!.terms = ['gradient'];
  recapped.steps[0]!.narration = `${recapped.steps[0]!.narration} The gradient says which way.`;
  assert.ok(
    critiqueLesson(recapped).some((p) => /recap says "GPU"/.test(p)),
    'the recap may introduce nothing, but it must not say a word no cell carries',
  );
});
