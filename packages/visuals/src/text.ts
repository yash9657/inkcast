/**
 * The handwriting lane.
 *
 * The flaw we are beating: tools that trace glyph outlines and reveal the whole
 * word (or the whole line) at once. That reads as "text appeared", never as
 * "someone wrote this". So we do **not** touch outlines. We lay the string out
 * in the vendored OFL handwriting face using real advance widths, then emit
 * per-line clip rectangles in reading order together with per-word breakpoints.
 * The renderer grows one rectangle left-to-right at the pace of the narration
 * and the letters appear under the moving edge exactly like a pen.
 *
 * Everything here is measured, not guessed: wrapping is done against the
 * element's box width, and the type size shrinks to fit the box height.
 */
import type { FontMetrics } from '@inkcast/core';
import type { InkStyle, TextRole } from './style.js';
import { roleFontSize } from './style.js';
import type { Box, SvgNode } from './svg.js';
import { clamp, el, n } from './svg.js';

export type WordSpan = {
  text: string;
  /** Absolute x of the word's left edge, in canvas units. */
  x: number;
  w: number;
  /** Progress window for this word within the whole block, 0–1. */
  startFrac: number;
  endFrac: number;
};

export type LineLayout = {
  index: number;
  text: string;
  /** Left edge after alignment. */
  x: number;
  /** Baseline y — where the pen actually sits. */
  baseline: number;
  width: number;
  words: WordSpan[];
  /** Full-line reveal rectangle; the renderer animates its width 0 → w. */
  mask: Box;
  startFrac: number;
  endFrac: number;
};

export type TextLayout = {
  text: string;
  role: TextRole;
  align: 'left' | 'center' | 'right';
  fontFamily: string;
  /** Font stack string, ready for the SVG `font-family` attribute. */
  fontStack: string;
  fontSize: number;
  lineHeight: number;
  tracking: number;
  colour: string;
  opacity: number;
  /** The box we were asked to fit. */
  box: Box;
  /** The box the text actually occupies (mask union). */
  bounds: Box;
  /** Padding baked into every mask rect, so partial reveals stay exact. */
  maskPad: number;
  lines: LineLayout[];
  /** Total advance width across all lines — the pacing denominator. */
  inkWidth: number;
  /** Position in the owning element's draw sequence. */
  order: number;
};

export type LayoutTextOptions = {
  box: Box;
  style: InkStyle;
  font: FontMetrics;
  role?: TextRole;
  align?: 'left' | 'center' | 'right';
  /** Explicit size in canvas units; otherwise derived from `role`. */
  fontSize?: number;
  /** Canvas height, which the role type scale is relative to. */
  canvasHeight?: number;
  colour?: string;
  opacity?: number;
  valign?: 'top' | 'middle' | 'bottom';
  /** Shrink-to-fit floor as a fraction of the starting size. */
  minScale?: number;
  order?: number;
};

function fontStackFor(family: string): string {
  const quoted = /\s/.test(family) ? `'${family}'` : family;
  return `${quoted}, 'Shantell Sans', 'Caveat', 'Patrick Hand', 'Gaegu', 'Comic Sans MS', cursive`;
}

/** Split a paragraph into words, collapsing runs of whitespace. */
function words(paragraph: string): string[] {
  return paragraph.split(/\s+/).filter((w) => w.length > 0);
}

function wrapParagraph(
  para: string,
  font: FontMetrics,
  fontSize: number,
  tracking: number,
  maxWidth: number,
): string[] {
  const ws = words(para);
  if (ws.length === 0) return [''];
  const lines: string[] = [];
  let cur = '';
  // Candidates are always measured whole rather than accumulated: letter
  // tracking is a per-gap cost, so summing word widths under-reports the line
  // and lets it creep past the box edge.
  const fits = (s: string): boolean => font.measure(s, fontSize, tracking) <= maxWidth;

  for (const w of ws) {
    const candidate = cur === '' ? w : `${cur} ${w}`;
    if (fits(candidate)) {
      cur = candidate;
      continue;
    }
    if (cur !== '') {
      lines.push(cur);
      cur = '';
    }
    if (fits(w)) {
      cur = w;
      continue;
    }
    // A single word wider than the box: break it by character rather than let
    // it bleed out of the element.
    let chunk = '';
    for (const ch of w) {
      if (chunk !== '' && !fits(chunk + ch)) {
        lines.push(chunk);
        chunk = ch;
      } else {
        chunk += ch;
      }
    }
    cur = chunk;
  }
  if (cur !== '') lines.push(cur);
  return lines;
}

/**
 * Lay out a string inside `box`, shrinking the type until it fits.
 *
 * Returns reveal geometry, not outlines: one clip rectangle per line in reading
 * order plus word-level progress windows.
 */
export function layoutText(text: string, opts: LayoutTextOptions): TextLayout {
  const { box, style, font } = opts;
  const role: TextRole = opts.role ?? 'body';
  const align = opts.align ?? 'left';
  const canvasHeight = opts.canvasHeight ?? 1080;
  const tracking = style.tracking;
  const maxWidth = Math.max(1, box.w);
  const startSize = opts.fontSize ?? roleFontSize(role, canvasHeight);
  const floor = startSize * (opts.minScale ?? 0.5);

  let fontSize = startSize;
  let lineTexts: string[] = [];
  let lineHeight = 0;
  for (let i = 0; i < 14; i++) {
    const paragraphs = text.split(/\r?\n/);
    lineTexts = paragraphs.flatMap((p) => wrapParagraph(p, font, fontSize, tracking, maxWidth));
    lineHeight = Math.max(
      fontSize * 1.12,
      (font.ascent + font.descent + font.lineGap) * fontSize * 1.02,
    );
    const blockH = lineTexts.length * lineHeight;
    if (blockH <= box.h || fontSize <= floor) break;
    fontSize = Math.max(floor, fontSize * 0.92);
  }

  const blockH = lineTexts.length * lineHeight;
  const valign = opts.valign ?? 'top';
  const slack = box.h - blockH;
  const top = valign === 'middle' ? box.y + slack / 2 : valign === 'bottom' ? box.y + slack : box.y;

  const maskPad = fontSize * 0.14;
  const widths = lineTexts.map((t) => font.measure(t, fontSize, tracking));
  const inkWidth = widths.reduce((a, b) => a + b, 0) || 1;

  const lines: LineLayout[] = [];
  let cum = 0;
  lineTexts.forEach((t, i) => {
    const width = widths[i] ?? 0;
    const x =
      align === 'center'
        ? box.x + (box.w - width) / 2
        : align === 'right'
          ? box.x + box.w - width
          : box.x;
    const baseline = top + font.ascent * fontSize + i * lineHeight;
    const startFrac = cum / inkWidth;

    const spaceW = font.measure(' ', fontSize, tracking);
    const spans: WordSpan[] = [];
    let wx = x;
    let wcum = cum;
    const parts = words(t);
    parts.forEach((w, wi) => {
      const ww = font.measure(w, fontSize, tracking);
      spans.push({
        text: w,
        x: wx,
        w: ww,
        startFrac: wcum / inkWidth,
        endFrac: (wcum + ww) / inkWidth,
      });
      wx += ww + spaceW;
      wcum += ww + (wi === parts.length - 1 ? 0 : spaceW);
    });

    cum += width;
    lines.push({
      index: i,
      text: t,
      x,
      baseline,
      width,
      words: spans,
      mask: {
        x: x - maskPad,
        y: baseline - font.ascent * fontSize - maskPad * 0.5,
        w: width + maskPad * 2,
        h: (font.ascent + font.descent) * fontSize + maskPad,
      },
      startFrac,
      endFrac: cum / inkWidth,
    });
  });

  const bounds =
    lines.length === 0
      ? { ...box }
      : {
          x: Math.min(...lines.map((l) => l.mask.x)),
          y: Math.min(...lines.map((l) => l.mask.y)),
          w:
            Math.max(...lines.map((l) => l.mask.x + l.mask.w)) -
            Math.min(...lines.map((l) => l.mask.x)),
          h:
            Math.max(...lines.map((l) => l.mask.y + l.mask.h)) -
            Math.min(...lines.map((l) => l.mask.y)),
        };

  return {
    text,
    role,
    align,
    fontFamily: font.familyName,
    fontStack: fontStackFor(font.familyName),
    fontSize,
    lineHeight,
    tracking,
    colour: opts.colour ?? style.ink,
    opacity: opts.opacity ?? style.textOpacity,
    box,
    bounds,
    maskPad,
    lines,
    inkWidth,
    order: opts.order ?? 0,
  };
}

/**
 * Reveal rectangles for a block at progress `p` (0–1), in reading order.
 *
 * Lines already written return their full mask; the line being written returns a
 * partial rectangle whose right edge sits just past the pen. Word boundaries are
 * available on `line.words` for renderers that prefer to snap.
 */
export function revealMaskAt(layout: TextLayout, p: number): Box[] {
  const t = clamp(p, 0, 1);
  const out: Box[] = [];
  for (const line of layout.lines) {
    if (t >= line.endFrac - 1e-9) {
      out.push({ ...line.mask });
      continue;
    }
    if (t <= line.startFrac) continue;
    const span = Math.max(1e-9, line.endFrac - line.startFrac);
    const local = (t - line.startFrac) / span;
    const lead = layout.fontSize * 0.08;
    out.push({
      ...line.mask,
      w: Math.min(line.mask.w, layout.maskPad + local * line.width + lead),
    });
  }
  return out;
}

/** The word being written at progress `p`, or undefined outside the block. */
export function wordAt(layout: TextLayout, p: number): WordSpan | undefined {
  const t = clamp(p, 0, 1);
  for (const line of layout.lines) {
    for (const w of line.words) {
      if (t >= w.startFrac && t <= w.endFrac) return w;
    }
  }
  return undefined;
}

/** Uniformly scale + translate a layout (diagram fitting does this). */
export function scaleTextLayout(l: TextLayout, s: number, dx: number, dy: number): TextLayout {
  const sb = (b: Box): Box => ({ x: b.x * s + dx, y: b.y * s + dy, w: b.w * s, h: b.h * s });
  return {
    ...l,
    fontSize: l.fontSize * s,
    lineHeight: l.lineHeight * s,
    maskPad: l.maskPad * s,
    inkWidth: l.inkWidth * s,
    box: sb(l.box),
    bounds: sb(l.bounds),
    lines: l.lines.map((line) => ({
      ...line,
      x: line.x * s + dx,
      baseline: line.baseline * s + dy,
      width: line.width * s,
      mask: sb(line.mask),
      words: line.words.map((w) => ({ ...w, x: w.x * s + dx, w: w.w * s })),
    })),
  };
}

/**
 * SVG for one text block: a clip path per line plus the `<text>` runs.
 *
 * The rects carry stable ids (`<prefix>-mask-<line>`) and `data-ink-*`
 * attributes so the renderer can drive them per frame without re-deriving any
 * geometry.
 */
export function textSvg(layout: TextLayout, prefix: string): { defs: SvgNode[]; nodes: SvgNode[] } {
  const defs: SvgNode[] = [];
  const runs: SvgNode[] = [];
  layout.lines.forEach((line) => {
    const clipId = `${prefix}-clip-${line.index}`;
    defs.push(
      el('clipPath', { id: clipId, clipPathUnits: 'userSpaceOnUse' }, [
        el('rect', {
          id: `${prefix}-mask-${line.index}`,
          x: n(line.mask.x),
          y: n(line.mask.y),
          width: n(line.mask.w),
          height: n(line.mask.h),
          'data-ink-mask-line': line.index,
          'data-ink-full-width': n(line.mask.w),
        }),
      ]),
    );
    const run: SvgNode = {
      tag: 'text',
      attrs: {
        x: n(line.x),
        y: n(line.baseline),
        // Our measurement is authoritative: the reveal mask was cut to this
        // width, so if the handwriting face fails to load the browser must fit
        // the fallback into the same run instead of overflowing (and getting
        // its tail clipped). `spacing` adjusts the gaps only, leaving the
        // letterforms alone.
        textLength: n(line.width),
        lengthAdjust: 'spacing',
        'data-ink-line': line.index,
        'data-ink-start': n(line.startFrac, 4),
        'data-ink-end': n(line.endFrac, 4),
        'data-ink-words': JSON.stringify(
          line.words.map((w) => [n(w.x), n(w.w), n(w.startFrac, 4), n(w.endFrac, 4)]),
        ),
        'xml:space': 'preserve',
      },
      text: line.text,
    };
    runs.push(el('g', { 'clip-path': `url(#${clipId})`, 'data-ink-line': line.index }, [run]));
  });

  const group = el(
    'g',
    {
      'data-ink-kind': 'handwriting',
      'data-ink-role': layout.role,
      'data-ink-order': layout.order,
      'data-ink-font': layout.fontFamily,
      'data-ink-lines': layout.lines.length,
      'font-family': layout.fontStack,
      'font-size': n(layout.fontSize),
      'letter-spacing': n(layout.tracking * layout.fontSize, 3),
      fill: layout.colour,
      'fill-opacity': n(layout.opacity, 3),
      stroke: 'none',
    },
    runs,
  );
  return { defs, nodes: [group] };
}
