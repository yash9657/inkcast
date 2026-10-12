import { Mark as MarkSchema, type Mark } from '@inkcast/core';
import { labelFootprint, markBounds, TYPICAL_FIT } from './draw-geom.js';

const leaderId = (id: string) => `${id}--target-leader`;

/** Fail closed for declared bindings. This validates identity, not domain facts. */
export function labelTargetProblems(marks: readonly Mark[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const mark of marks) {
    if (ids.has(mark.id)) problems.push(`duplicate part id ${mark.id}`);
    ids.add(mark.id);
  }
  for (const mark of marks) {
    if (!mark.target) continue;
    const target = marks.find((m) => m.id === mark.target!.partId);
    if (mark.kind !== 'label') problems.push(`${mark.id}: only labels can declare a target`);
    if (!target || target.kind === 'label' || target.kind === 'arrow' || !markBounds(target)) {
      problems.push(`${mark.id}: target ${mark.target.partId} is not a drawable part`);
    }
  }
  return problems;
}

/** Recompute leaders after label repair so moving text never changes what it names. */
export function resolveLabelAnchors(marks: Mark[], scale = TYPICAL_FIT): Mark[] {
  if (!marks.some((m) => m.target)) return marks;
  const problems = labelTargetProblems(marks);
  if (problems.length) throw new Error(`Invalid label bindings: ${problems.join('; ')}`);
  const generated = new Set(marks.filter((m) => m.target).map((m) => leaderId(m.id)));
  const out = marks.filter((m) => !generated.has(m.id));
  for (const label of out.filter((m) => m.target)) {
    const part = out.find((m) => m.id === label.target!.partId)!;
    const b = markBounds(part)!;
    const to = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    switch (label.target!.anchor) {
      case 'top':
        to.y = b.y;
        break;
      case 'bottom':
        to.y = b.y + b.h;
        break;
      case 'left':
        to.x = b.x;
        break;
      case 'right':
        to.x = b.x + b.w;
        break;
    }
    const text = labelFootprint(label, scale);
    const cx = text.x + text.w / 2,
      cy = text.y + text.h / 2;
    const dx = to.x - cx,
      dy = to.y - cy;
    const fraction =
      1 / Math.max(Math.abs(dx) / (text.w / 2 + 8), Math.abs(dy) / (text.h / 2 + 8), 1);
    // A name printed inside its part needs no leader through the name itself.
    if (fraction >= 1) continue;
    out.push(
      MarkSchema.parse({
        id: leaderId(label.id),
        kind: 'arrow',
        ...(label.cue ? { cue: label.cue } : {}),
        points: [
          [cx + dx * fraction, cy + dy * fraction],
          [to.x, to.y],
        ],
        ...(label.tone ? { tone: label.tone } : {}),
      }),
    );
  }
  return out;
}
