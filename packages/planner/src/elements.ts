/**
 * Element builders and text metrics.
 *
 * The Storyboard IR's zod schema has defaults for most element fields; these
 * builders fill them in explicitly so the planner always produces fully-formed
 * elements (and so `Storyboard.parse` is a validation step, not a repair step).
 *
 * `at` boxes are *measured*: the planner knows how big a piece of text is at its
 * own type scale, which is what makes collision-free layout possible. The
 * renderer owns the exact typeface, so it should fit text to the box rather than
 * assume a font size.
 */
import type {
  ArrowElement,
  AssetElement,
  DiagramElement,
  Element,
  EmphasisElement,
  ShapeElement,
  TextElement,
} from '@inkcast/core';
import { words } from './text.js';

/**
 * `@inkcast/core` exports `Box` as a zod schema but not as a type, and an
 * element's `at` is exactly that shape — so derive it rather than restating it.
 */
export type Box = Element['at'];

type Z = { x: number; y: number };
type Role = TextElement['role'];

/** Canvas units per role. Matches the renderer's type scale by convention. */
export const FONT: Record<Role, number> = {
  title: 76,
  heading: 50,
  body: 34,
  label: 27,
  caption: 22,
};

const LINE_HEIGHT = 1.34;
/** Mean glyph advance as a fraction of the font size, for Latin prose. */
const ADVANCE = 0.52;

export function charWidth(role: Role): number {
  return FONT[role] * ADVANCE;
}

/** Greedy word wrap at a pixel width. Returns the laid-out lines. */
export function wrapText(text: string, role: Role, maxWidth: number): string[] {
  const cw = charWidth(role);
  const maxChars = Math.max(8, Math.floor(maxWidth / cw));
  const out: string[] = [];
  let line = '';
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (!line) {
      line = w;
      continue;
    }
    if (line.length + 1 + w.length <= maxChars) line = `${line} ${w}`;
    else {
      out.push(line);
      line = w;
    }
  }
  if (line) out.push(line);
  return out.length ? out : [''];
}

/** Tight box for a piece of text, wrapped to at most `maxWidth`. */
export function measureText(text: string, role: Role, maxWidth: number): { w: number; h: number } {
  const lines = wrapText(text, role, maxWidth);
  const cw = charWidth(role);
  const widest = lines.reduce((m, l) => Math.max(m, l.length), 0);
  return {
    w: Math.min(maxWidth, Math.max(80, Math.round(widest * cw))),
    h: Math.round(lines.length * FONT[role] * LINE_HEIGHT),
  };
}

const box = (w: number, h: number, at?: Z): Box => ({ x: at?.x ?? 0, y: at?.y ?? 0, w, h });

export type EnterInit = { at?: number; duration?: number; style?: Element['enter']['style'] };

function enter(init: EnterInit | undefined, fallback: Element['enter']['style']) {
  return {
    at: init?.at ?? 0,
    duration: init?.duration ?? 0.8,
    style: init?.style ?? fallback,
  };
}

export function makeText(
  id: string,
  text: string,
  role: Role,
  o: { maxWidth?: number; align?: TextElement['align']; persist?: boolean; enter?: EnterInit } = {},
): TextElement {
  const maxWidth = o.maxWidth ?? 900;
  const m = measureText(text, role, maxWidth);
  return {
    id,
    type: 'text',
    text,
    role,
    align: o.align ?? 'left',
    at: box(m.w, m.h),
    enter: enter(o.enter, 'write'),
    persist: o.persist ?? true,
  };
}

export function makeShape(
  id: string,
  shape: ShapeElement['shape'],
  w: number,
  h: number,
  o: { fill?: boolean; persist?: boolean; enter?: EnterInit } = {},
): ShapeElement {
  return {
    id,
    type: 'shape',
    shape,
    fill: o.fill ?? false,
    at: box(w, h),
    enter: enter(o.enter, 'draw'),
    persist: o.persist ?? true,
  };
}

export function makeAsset(
  id: string,
  assetId: string,
  size = 200,
  o: { flipX?: boolean; persist?: boolean; enter?: EnterInit } = {},
): AssetElement {
  return {
    id,
    type: 'asset',
    assetId,
    flipX: o.flipX ?? false,
    at: box(size, size),
    enter: enter(o.enter, 'draw'),
    persist: o.persist ?? true,
  };
}

export function makeDiagram(
  id: string,
  layout: DiagramElement['layout'],
  nodes: { id: string; label: string }[],
  edges: { from: string; to: string; label?: string }[] = [],
  o: { w?: number; h?: number; persist?: boolean; enter?: EnterInit } = {},
): DiagramElement {
  const size = diagramSize(layout, nodes);
  return {
    id,
    type: 'diagram',
    layout,
    nodes,
    edges,
    at: box(o.w ?? size.w, o.h ?? size.h),
    enter: enter(o.enter, 'draw'),
    persist: o.persist ?? true,
  };
}

export function makeArrow(
  id: string,
  o: {
    from?: Z;
    to?: Z;
    curve?: number;
    label?: string;
    persist?: boolean;
    enter?: EnterInit;
  } = {},
): ArrowElement {
  const from = o.from ?? { x: 0, y: 0 };
  const to = o.to ?? { x: 100, y: 0 };
  const el: ArrowElement = {
    id,
    type: 'arrow',
    from,
    to,
    curve: o.curve ?? 0.2,
    at: {
      x: Math.min(from.x, to.x),
      y: Math.min(from.y, to.y),
      w: Math.max(24, Math.abs(to.x - from.x)),
      h: Math.max(24, Math.abs(to.y - from.y)),
    },
    enter: enter(o.enter, 'draw'),
    persist: o.persist ?? true,
  };
  if (o.label !== undefined) el.label = o.label;
  return el;
}

export function makeEmphasis(
  id: string,
  targetId: string,
  effect: EmphasisElement['effect'],
  o: { persist?: boolean; enter?: EnterInit } = {},
): EmphasisElement {
  return {
    id,
    type: 'emphasis',
    targetId,
    effect,
    at: box(120, 120),
    enter: enter(o.enter, 'draw'),
    // Annotations are transient by nature: the circle comes off the board, the
    // thing it circled stays.
    persist: o.persist ?? false,
  };
}

/** Intrinsic size for a diagram, generous enough for the visuals stage. */
export function diagramSize(
  layout: DiagramElement['layout'],
  nodes: { id: string; label: string }[],
): { w: number; h: number } {
  const n = Math.max(1, nodes.length);
  const longest = nodes.reduce((m, x) => Math.max(m, x.label.length), 4);
  const nodeW = Math.min(420, Math.max(180, longest * 13 + 48));
  const nodeH = 92;
  switch (layout) {
    case 'stack':
      return { w: nodeW + 40, h: n * (nodeH + 26) };
    case 'flow':
    case 'sequence': {
      const perRow = Math.max(1, Math.min(n, Math.floor(1400 / (nodeW + 90))));
      const rows = Math.ceil(n / perRow);
      return { w: Math.min(n, perRow) * (nodeW + 90) - 90, h: rows * (nodeH + 70) - 70 };
    }
    case 'tree': {
      const leaves = Math.max(2, n - 1);
      return { w: Math.min(1500, leaves * (nodeW * 0.8)), h: 3 * (nodeH + 80) };
    }
    case 'grid': {
      const cols = Math.ceil(Math.sqrt(n));
      return { w: cols * (nodeW + 40) - 40, h: Math.ceil(n / cols) * (nodeH + 40) - 40 };
    }
    case 'graph':
    default:
      return { w: Math.min(1400, 320 + n * 120), h: Math.min(760, 260 + n * 40) };
  }
}

/** Re-measure an element after layout assigns it a width. */
export function refit(el: Element, width: number): void {
  if (el.type === 'text') {
    const m = measureText(el.text, el.role, width);
    el.at.w = m.w;
    el.at.h = m.h;
    return;
  }
  if (el.type === 'diagram') {
    const s = diagramSize(el.layout, el.nodes);
    if (s.w <= width) {
      el.at.w = s.w;
      el.at.h = s.h;
      return;
    }
    // Squeezed horizontally, a diagram gets taller: its rows wrap.
    const k = Math.max(0.3, width / s.w);
    el.at.w = width;
    el.at.h = Math.round(s.h / Math.sqrt(k));
    return;
  }
  if (el.at.w > width) {
    const k = width / el.at.w;
    el.at.w = width;
    el.at.h = Math.max(40, Math.round(el.at.h * k));
  }
}

/** Number of words an element puts on the board — used for pacing sanity. */
export function elementWords(el: Element): number {
  if (el.type === 'text') return words(el.text).length;
  if (el.type === 'diagram') return el.nodes.reduce((n, x) => n + words(x.label).length, 0);
  if (el.type === 'arrow') return el.label ? words(el.label).length : 0;
  return 0;
}
