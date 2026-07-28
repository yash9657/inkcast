/**
 * Turns resolved strokes + text blocks into the on-disk SVG the renderer loads.
 *
 * The file is not decoration: it is the animation script. Every path carries its
 * measured length and its draw order, and every text line carries a named clip
 * rectangle. A renderer can therefore reveal the element without re-measuring
 * anything (`getTotalLength()` on an offscreen node is slow and needs layout).
 */
import type { InkPath } from './geometry.js';
import type { InkStyle } from './style.js';
import type { Attrs, Box, SvgNode } from './svg.js';
import { el, n, padBox, pathBBox, svgDocument, unionBox } from './svg.js';
import type { TextLayout } from './text.js';
import { textSvg } from './text.js';

/** One item in an element's draw sequence — a stroke or a written block. */
export type InkItem = { kind: 'path'; path: InkPath } | { kind: 'text'; text: TextLayout };

export function pathItem(path: InkPath): InkItem {
  return { kind: 'path', path };
}
export function textItem(text: TextLayout): InkItem {
  return { kind: 'text', text };
}
export function pathItems(paths: InkPath[]): InkItem[] {
  return paths.map(pathItem);
}

/** Serialisable stroke record for `visuals.json`. */
export type InkStroke = {
  d: string;
  length: number;
  stroke: string;
  strokeWidth: number;
  fill: string;
  fillRule?: 'nonzero' | 'evenodd';
  opacity: number;
  /** Index in the element's draw sequence. */
  order: number;
  group?: string;
};

export function sanitiseId(id: string): string {
  const s = id.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return s.length > 0 ? s : 'x';
}

export type WriteElementResult = {
  svg: string;
  /** The box the SVG's viewBox covers (content ∪ declared box). */
  viewBox: Box;
  strokes: InkStroke[];
  texts: TextLayout[];
};

/**
 * Build the SVG document for one element or asset.
 *
 * `space: 'canvas'` keeps absolute storyboard coordinates so the renderer can
 * drop the markup straight onto the persistent canvas. `space: 'local'` is for
 * reusable asset entities, whose own box starts at the origin.
 */
export function writeElementSvg(opts: {
  id: string;
  items: InkItem[];
  box: Box;
  style: InkStyle;
  space: 'canvas' | 'local';
  /** Relative href for the handwriting font, if any text is present. */
  fontHref?: string;
  fontFamily?: string;
  attrs?: Attrs;
}): WriteElementResult {
  const prefix = `ink-${sanitiseId(opts.id)}`;
  const strokes: InkStroke[] = [];
  const texts: TextLayout[] = [];
  const boxes: Box[] = [];
  const defs: SvgNode[] = [];
  const nodes: SvgNode[] = [];

  opts.items.forEach((item, order) => {
    if (item.kind === 'path') {
      const p = item.path;
      strokes.push({ ...p, order });
      boxes.push(padBox(pathBBox(p.d), Math.max(1, p.strokeWidth)));
      nodes.push(
        el('path', {
          d: p.d,
          fill: p.fill,
          'fill-rule': p.fillRule,
          stroke: p.stroke === 'none' ? undefined : p.stroke,
          'stroke-width': p.stroke === 'none' ? undefined : n(p.strokeWidth, 3),
          'stroke-linecap': p.stroke === 'none' ? undefined : opts.style.linecap,
          'stroke-linejoin': p.stroke === 'none' ? undefined : opts.style.linejoin,
          opacity: p.opacity < 1 ? n(p.opacity, 3) : undefined,
          'data-ink-order': order,
          'data-ink-len': n(p.length, 2),
          'data-ink-group': p.group,
        }),
      );
    } else {
      const layout: TextLayout = { ...item.text, order };
      texts.push(layout);
      boxes.push(layout.bounds);
      const built = textSvg(layout, `${prefix}-t${texts.length - 1}`);
      defs.push(...built.defs);
      nodes.push(...built.nodes);
    }
  });

  const content = unionBox(boxes);
  const viewBox =
    content.w > 0 && content.h > 0
      ? unionBox([content, opts.box])
      : { ...opts.box, w: Math.max(1, opts.box.w), h: Math.max(1, opts.box.h) };

  // Variable fonts ship as `Caveat[wght].ttf`; brackets are unsafe in a URL, so
  // the href is percent-encoded (path separators kept intact).
  const href = opts.fontHref
    ? opts.fontHref
        .split('/')
        .map((part) => encodeURIComponent(part))
        .join('/')
    : undefined;
  const css =
    href && opts.fontFamily && texts.length > 0
      ? `@font-face{font-family:'${opts.fontFamily}';src:url('${href}');font-display:block}`
      : undefined;

  const svg = svgDocument({
    viewBox,
    defs,
    css,
    children: [
      el(
        'g',
        {
          'data-ink-id': opts.id,
          'data-ink-space': opts.space,
          'data-ink-strokes': strokes.length,
          'data-ink-texts': texts.length,
          fill: 'none',
        },
        nodes,
      ),
    ],
    attrs: {
      'data-ink-space': opts.space,
      'data-ink-style': opts.style.name,
      'data-ink-box': `${n(opts.box.x)} ${n(opts.box.y)} ${n(opts.box.w)} ${n(opts.box.h)}`,
      ...opts.attrs,
    },
  });

  return { svg, viewBox, strokes, texts };
}

/** Sum of every stroke's length — the natural denominator for a draw-on. */
export function totalStrokeLength(strokes: InkStroke[]): number {
  return strokes.reduce((a, s) => a + s.length, 0);
}
