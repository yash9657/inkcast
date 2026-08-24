/**
 * `LessonStep.sourceRef` end to end — plan item 5.2, audit S0-b.
 *
 * The audit's finding was that the link between a claim and the document it came from is
 * severed at the lesson boundary: `source.json` is written, then used only as a cache
 * fingerprint, and `Lesson` has no field that could point back into it. So no check —
 * human or machine — can hold a sentence of narration up against the text it is supposed
 * to be a claim about.
 *
 * These tests are the no-key half, and that is deliberate rather than a compromise. The
 * *model* author is prompted for refs (`SOURCE_REF_RULE`), and verifying that costs a key
 * and a generation. The *heuristic* author does not summarise a document, it lifts
 * sentences out of it — so the section each beat came from is a fact it already holds, and
 * the mechanism is measurable against `examples/*.md` with no key, no network and no
 * generation at all. What is asserted here is the contract every ref has to satisfy
 * whoever wrote it: it names a real heading, or it is absent.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { critiqueLesson, lessonBeats } from '@inkcast/core';
import { buildDoc } from '../src/ingest.js';
import { deriveLesson } from '../src/lesson-derive.js';
import { PRESETS } from '../src/presets.js';

const DOCS = ['gradient-descent.md', 'photosynthesis.md', 'product-onboarding.md'];

function example(name: string) {
  const file = path.resolve(import.meta.dirname, '../../../examples', name);
  return buildDoc(readFileSync(file, 'utf8'), 'markdown', file);
}

test('every ref a document lesson carries names a real section of that document', () => {
  for (const name of DOCS) {
    const doc = example(name);
    const lesson = deriveLesson(doc, {}, PRESETS.standard);
    const headings = doc.sections.map((s) => s.heading);
    // The critique's own check, which is the one that matters: a ref naming no heading is
    // the same class of failure as a `derivedFrom` naming no beat.
    assert.deepEqual(
      critiqueLesson(lesson, { sections: headings }).filter((p) =>
        /sourceRef|source section/.test(p),
      ),
      [],
      `${name}: a ref points at no section`,
    );
    // And the refs are real rather than absent-and-therefore-vacuous.
    const refs = lessonBeats(lesson)
      .map((b) => b.step.sourceRef)
      .filter((r): r is string => r !== undefined);
    assert.ok(refs.length >= 4, `${name}: only ${refs.length} beats point home`);
    for (const ref of refs) assert.ok(headings.includes(ref), `${name}: "${ref}" is not a heading`);
  }
});

test('a document lesson points home on at least 80% of the beats that can', () => {
  // The plan's done-bar, with the one exclusion the design forces. `recap` retraces beats
  // the lesson has already said and adds nothing — the brief tells the model to leave its
  // ref out, and this author does — so it is not a beat that *can* cite a section. What is
  // left is measured: 6 of 7 on all three example documents (86%).
  //
  // The single remaining miss on each is honest and worth naming, because it is not the
  // mechanism failing: the passage was lifted from the lead paragraphs *before the first
  // heading*, where there is no section to name. A ref pointing at the nearest heading
  // instead would be exactly the untestable citation this field exists to avoid.
  for (const name of DOCS) {
    const doc = example(name);
    const lesson = deriveLesson(doc, {}, PRESETS.standard);
    const citable = lessonBeats(lesson).filter(
      (b) => b.step.from === 'given' && b.role !== 'recap',
    );
    const sourced = citable.filter((b) => b.step.sourceRef !== undefined);
    const share = sourced.length / citable.length;
    assert.ok(
      share >= 0.8,
      `${name}: ${sourced.length}/${citable.length} beats point home (${Math.round(share * 100)}%)`,
    );
  }
});

test('a bad ref fails critique, and an unverifiable one does not', () => {
  const doc = example('gradient-descent.md');
  const lesson = deriveLesson(doc, {}, PRESETS.standard);
  const headings = doc.sections.map((s) => s.heading);

  const wrong = structuredClone(lesson);
  wrong.steps[0]!.sourceRef = 'The Loss Surfaces';
  const problems = critiqueLesson(wrong, { sections: headings });
  assert.ok(
    problems.some((p) => /cites source section "The Loss Surfaces"/.test(p)),
    `a heading that does not exist must be reported: ${problems.join(' | ')}`,
  );

  // Case and surrounding whitespace are forgiven, because a heading copied out of an
  // outline is the same heading. Nothing else is.
  const cased = structuredClone(lesson);
  cased.steps[0]!.sourceRef = '  the loss surface  ';
  assert.deepEqual(
    critiqueLesson(cased, { sections: headings }).filter((p) => /source section/.test(p)),
    [],
  );

  // With no sections handed over there is nothing to check against, and "cannot check"
  // must not read as "everything is wrong" — `lesson-edit` and `critiqueFor` hold a lesson
  // and no document, and a wall of false failures there is how a gate gets switched off.
  assert.deepEqual(
    critiqueLesson(wrong).filter((p) => /source section/.test(p)),
    [],
  );

  // An empty string is neither a citation nor an absence, so it is reported as the
  // mistake it is rather than silently treated as unsourced.
  const blank = structuredClone(lesson);
  blank.steps[0]!.sourceRef = '   ';
  assert.ok(critiqueLesson(blank, { sections: headings }).some((p) => /empty sourceRef/.test(p)));
});
