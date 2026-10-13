import type { Mark } from '@inkcast/core';
import { markBounds } from './draw-geom.js';

/** Circle membership is arithmetic, never a model's estimate of an intersection. */
export function geometryConstraintProblems(marks: readonly Mark[]): string[] {
  return marks.flatMap((mark) => {
    if (!mark.circleThrough) return [];
    const target = marks.find((m) => m.id === mark.circleThrough);
    if (mark.kind !== 'ellipse' || !markBounds(mark))
      return [`${mark.id}: circleThrough requires an ellipse box`];
    if (
      !target ||
      target.id === mark.id ||
      target.circleThrough ||
      !['ellipse', 'rect', 'dots'].includes(target.kind) ||
      !markBounds(target)
    )
      return [`${mark.id}: circleThrough must name an unconstrained point marker`];
    return [];
  });
}

export function resolveGeometryConstraints(marks: Mark[]): Mark[] {
  const problems = geometryConstraintProblems(marks);
  if (problems.length) throw new Error(`Invalid geometric constraints: ${problems.join('; ')}`);
  return marks.map((mark) => {
    if (!mark.circleThrough) return mark;
    const point = markBounds(marks.find((m) => m.id === mark.circleThrough)!)!;
    const box = markBounds(mark)!;
    const cx = box.x + box.w / 2,
      cy = box.y + box.h / 2;
    const radius = Math.hypot(point.x + point.w / 2 - cx, point.y + point.h / 2 - cy);
    return { ...mark, x: cx - radius, y: cy - radius, w: radius * 2, h: radius * 2 };
  });
}
