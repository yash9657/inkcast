import { hash } from './project.js';
import { lessonBeats, type Lesson } from './lesson.js';
import type { QcCheck } from './qc.js';

/** The reviewed content, excluding generated marks and the review itself. */
export function lessonReviewHash(lesson: Lesson): string {
  return hash(
    lesson.topic,
    lesson.objective,
    lesson.coreInsight,
    lessonBeats(lesson).map(({ id, step }) => ({
      id,
      idea: step.idea,
      title: step.title,
      because: step.because,
      narration: step.narration,
      terms: step.terms,
      visuals: step.visuals.map((v) => ({
        kind: v.kind,
        describe: v.describe,
        underlay: v.underlay?.prompt,
      })),
    })),
  );
}

/** A cached verdict cannot bless a subsequently edited script. */
export function lessonSourceCheck(lesson?: Lesson): QcCheck {
  const review = lesson?.sourceReview;
  if (!lesson || !review)
    return {
      id: 'semantic-explanation',
      tier: 2,
      status: 'skip',
      findings: [],
      note: 'No source-grounded script review is recorded.',
    };
  const ids = lessonBeats(lesson).map((b) => b.id);
  const complete =
    review.checkedBeats.length === ids.length &&
    new Set(review.checkedBeats).size === ids.length &&
    ids.every((id) => review.checkedBeats.includes(id));
  if (!complete || review.contentHash !== lessonReviewHash(lesson))
    return {
      id: 'semantic-explanation',
      tier: 2,
      status: 'fail',
      findings: [
        'Script or visual instructions changed after source review; regenerate the review.',
      ],
    };
  return review.grounded
    ? {
        id: 'semantic-explanation',
        tier: 2,
        status: 'pass',
        findings: [],
        note: `Model review against supplied source (${review.model}); not independent fact verification or rendered-diagram verification.`,
      }
    : {
        id: 'semantic-explanation',
        tier: 2,
        status: 'skip',
        findings: [],
        note: 'Internal consistency reviewed, but a bare topic provides no source evidence.',
      };
}
