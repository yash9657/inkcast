/// <reference path="./vendor.d.ts" />
/**
 * The diagram lane.
 *
 * The reference on line 1 carries the ambient `@dagrejs/dagre` declaration into
 * whichever program imports this file — see the note in `geometry.ts` for why
 * `include: ["src"]` is not enough once `@inkcast/pipeline` compiles these
 * sources itself.
 *
 * `flow`, `tree` and `graph` go through dagre (synchronous, centre-based
 * coordinates, maintained fork `@dagrejs/dagre`). `sequence`, `stack` and `grid`
 * have deterministic hand-rolled layouts, because a layered graph algorithm
 * gives all three of them the wrong answer — a sequence diagram needs fixed
 * actor columns and time flowing down, a stack needs strict vertical order, a
 * grid needs equal cells.
 *
 * Everything is laid out in natural units first, then uniformly scaled and
 * centred so it **fits inside the element's box**. Overflowing the box is worse
 * than being slightly small: it collides with whatever else is on the canvas.
 */
import * as dagreNs from '@dagrejs/dagre';
import { logger } from '@inkcast/core';
import type { DrawContext, InkPath } from './geometry.js';
import { inkPaths, polylineArrowPaths } from './geometry.js';
import type { FontMetrics } from '@inkcast/core';
import type { InkStyle } from './style.js';
import { roleFontSize } from './style.js';
import type { Box, Pt } from './svg.js';
import { boxCentre, clipToBox, pointsBBox, unionBox } from './svg.js';
import type { TextLayout } from './text.js';
import { layoutText, scaleTextLayout } from './text.js';
import type { InkItem } from './writer.js';
import { pathItem, textItem } from './writer.js';

const log = logger('visuals:diagram');

/** CJS/ESM interop: some loaders nest the whole dagre API under `.default`. */
const dagre = dagreNs.default ?? dagreNs;

export type DiagramKind = 'flow' | 'tree' | 'graph' | 'sequence' | 'stack' | 'grid';

export type DiagramNodeSpec = { id: string; label: string };
export type DiagramEdgeSpec = { from: string; to: string; label?: string };

export type DiagramNodeLayout = { id: string; label: string; box: Box; text: TextLayout };
export type DiagramEdgeLayout = {
  from: string;
  to: string;
  label?: string;
  points: Pt[];
  text?: TextLayout;
};
export type Lifeline = { x: number; y1: number; y2: number };

export type DiagramLayout = {
  kind: DiagramKind;
  nodes: DiagramNodeLayout[];
  edges: DiagramEdgeLayout[];
  /** Sequence diagrams only. */
  lifelines: Lifeline[];
  /** The box the laid-out diagram occupies, always inside the element box. */
  bounds: Box;
  /** Uniform scale applied to fit the element box. */
  scale: number;
};

export type LayoutDiagramOptions = {
  box: Box;
  kind: DiagramKind;
  nodes: DiagramNodeSpec[];
  edges: DiagramEdgeSpec[];
  style: InkStyle;
  font: FontMetrics;
  canvasHeight?: number;
  /** Never blow a small diagram up more than this. */
  maxUpscale?: number;
};

type Measured = { id: string; label: string; w: number; h: number };

/** Cap on how upscaled a tiny diagram gets, so two nodes do not fill a wall. */
const DEFAULT_MAX_UPSCALE = 1.3;

export function layoutDiagram(opts: LayoutDiagramOptions): DiagramLayout {
  const { style, font } = opts;
  const canvasHeight = opts.canvasHeight ?? 1080;
  const fs = roleFontSize('label', canvasHeight);
  const padX = fs * 0.75;
  const padY = fs * 0.5;
  const maxTextW = fs * 9;
  const minW = fs * 3;
  const minH = fs * 2.1;

  const measured: Measured[] = opts.nodes.map((node) => {
    const probe = layoutText(node.label, {
      box: { x: 0, y: 0, w: maxTextW, h: fs * 8 },
      style,
      font,
      role: 'label',
      fontSize: fs,
      align: 'left',
      minScale: 1,
    });
    const textW = probe.lines.reduce((a, l) => Math.max(a, l.width), 0);
    const textH = probe.lines.length * probe.lineHeight;
    return {
      id: node.id,
      label: node.label,
      w: Math.max(minW, Math.min(maxTextW + padX * 2, textW + padX * 2)),
      h: Math.max(minH, textH + padY * 2),
    };
  });

  const placed =
    opts.kind === 'sequence'
      ? sequenceLayout(measured, opts.edges, fs)
      : opts.kind === 'stack'
        ? stackLayout(measured, opts.edges, fs)
        : opts.kind === 'grid'
          ? gridLayout(measured, opts.edges, fs)
          : dagreLayout(measured, opts.edges, opts.kind, fs);

  // ---- natural bounds, then fit into the element box -----------------------
  const natural = unionBox([
    ...placed.boxes.map((b) => b.box),
    ...placed.edges.map((e) => pointsBBox(e.points)),
    ...placed.lifelines.map((l) => ({ x: l.x, y: l.y1, w: 0, h: l.y2 - l.y1 })),
  ]);
  const bw = Math.max(1e-6, natural.w);
  const bh = Math.max(1e-6, natural.h);
  const maxUp = opts.maxUpscale ?? DEFAULT_MAX_UPSCALE;
  const scale = Math.min(opts.box.w / bw, opts.box.h / bh, maxUp);
  const dx = opts.box.x + (opts.box.w - bw * scale) / 2 - natural.x * scale;
  const dy = opts.box.y + (opts.box.h - bh * scale) / 2 - natural.y * scale;
  const sb = (b: Box): Box => ({
    x: b.x * scale + dx,
    y: b.y * scale + dy,
    w: b.w * scale,
    h: b.h * scale,
  });
  const sp = (p: Pt): Pt => ({ x: p.x * scale + dx, y: p.y * scale + dy });

  const nodes: DiagramNodeLayout[] = placed.boxes.map((nb) => {
    const box = sb(nb.box);
    const inner = {
      x: box.x + padX * scale * 0.5,
      y: box.y + padY * scale * 0.4,
      w: Math.max(1, box.w - padX * scale),
      h: Math.max(1, box.h - padY * scale * 0.8),
    };
    return {
      id: nb.id,
      label: nb.label,
      box,
      text: layoutText(nb.label, {
        box: inner,
        style,
        font,
        role: 'label',
        fontSize: fs * scale,
        align: 'center',
        valign: 'middle',
        minScale: 0.62,
      }),
    };
  });

  const byId = new Map(nodes.map((nd) => [nd.id, nd]));
  // Sequence messages already start and end exactly on their lifelines; pulling
  // them back to the actor header would turn a horizontal message into a
  // diagonal line to the top of the diagram.
  const clipEnds = opts.kind !== 'sequence';
  const edges: DiagramEdgeLayout[] = placed.edges.map((e) => {
    const pts = e.points.map(sp);
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    // Land the arrow on the node border, not inside the box.
    if (clipEnds && from && pts.length >= 2) pts[0] = clipToBox(from.box, pts[1] as Pt);
    if (clipEnds && to && pts.length >= 2) {
      pts[pts.length - 1] = clipToBox(to.box, pts[pts.length - 2] as Pt);
    }
    const layout: DiagramEdgeLayout = { from: e.from, to: e.to, points: pts };
    if (e.label) {
      const mid = pts.length % 2 === 1 ? (pts[(pts.length - 1) / 2] as Pt) : midpoint(pts);
      const w = Math.max(
        fs * 4 * scale,
        Math.abs((pts[pts.length - 1] as Pt).x - (pts[0] as Pt).x) * 0.9,
      );
      layout.label = e.label;
      layout.text = layoutText(e.label, {
        box: { x: mid.x - w / 2, y: mid.y - fs * 1.5 * scale, w, h: fs * 1.3 * scale },
        style,
        font,
        role: 'caption',
        fontSize: fs * 0.78 * scale,
        align: 'center',
        valign: 'bottom',
        colour: style.muted,
        minScale: 0.6,
      });
    }
    return layout;
  });

  const lifelines: Lifeline[] = placed.lifelines.map((l) => ({
    x: l.x * scale + dx,
    y1: l.y1 * scale + dy,
    y2: l.y2 * scale + dy,
  }));

  const bounds = unionBox([
    ...nodes.map((nd) => nd.box),
    ...edges.map((e) => pointsBBox(e.points)),
    ...lifelines.map((l) => ({ x: l.x, y: l.y1, w: 0, h: l.y2 - l.y1 })),
  ]);

  return { kind: opts.kind, nodes, edges, lifelines, bounds, scale };
}

function midpoint(pts: Pt[]): Pt {
  const a = pts[0] as Pt;
  const b = pts[pts.length - 1] as Pt;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

type Placed = {
  boxes: Array<{ id: string; label: string; box: Box }>;
  edges: Array<{ from: string; to: string; label?: string; points: Pt[] }>;
  lifelines: Lifeline[];
};

/* ------------------------------------------------------------------- dagre */

function dagreLayout(
  measured: Measured[],
  edgeSpecs: DiagramEdgeSpec[],
  kind: DiagramKind,
  fs: number,
): Placed {
  if (measured.length === 0) return { boxes: [], edges: [], lifelines: [] };
  try {
    const g = new dagre.graphlib.Graph({ directed: true, multigraph: true });
    g.setGraph({
      // `flow` reads left-to-right like a sentence; hierarchies read downwards.
      rankdir: kind === 'flow' ? 'LR' : 'TB',
      nodesep: fs * 1.5,
      ranksep: fs * 2.4,
      edgesep: fs * 0.8,
      marginx: fs * 0.5,
      marginy: fs * 0.5,
      ranker: kind === 'tree' ? 'tight-tree' : 'network-simplex',
    });
    g.setDefaultEdgeLabel(() => ({}));
    for (const m of measured) g.setNode(m.id, { width: m.w, height: m.h, label: m.label });
    for (const e of edgeSpecs) {
      if (g.hasNode(e.from) && g.hasNode(e.to)) g.setEdge(e.from, e.to);
    }
    dagre.layout(g);

    const boxes = measured.map((m) => {
      const nd = g.node(m.id);
      // dagre reports centres.
      const box: Box = nd
        ? { x: nd.x - nd.width / 2, y: nd.y - nd.height / 2, w: nd.width, h: nd.height }
        : { x: 0, y: 0, w: m.w, h: m.h };
      return { id: m.id, label: m.label, box };
    });
    const byId = new Map(boxes.map((b) => [b.id, b.box]));
    const edges = edgeSpecs.flatMap((e) => {
      const a = byId.get(e.from);
      const b = byId.get(e.to);
      if (!a || !b) return [];
      const routed = g.edge(e.from, e.to)?.points;
      const points =
        routed && routed.length >= 2
          ? routed.map((p) => ({ x: p.x, y: p.y }))
          : [boxCentre(a), boxCentre(b)];
      const out: Pt[] = [boxCentre(a), ...points.slice(1, -1), boxCentre(b)];
      const entry: { from: string; to: string; label?: string; points: Pt[] } = {
        from: e.from,
        to: e.to,
        points: out,
      };
      if (e.label !== undefined) entry.label = e.label;
      return [entry];
    });
    return { boxes, edges, lifelines: [] };
  } catch (err) {
    log.warn('dagre layout failed — falling back to a grid', err);
    return gridLayout(measured, edgeSpecs, fs);
  }
}

/* ------------------------------------------------- deterministic hand layouts */

/** Actors in fixed columns across the top, time running downwards. */
function sequenceLayout(measured: Measured[], edgeSpecs: DiagramEdgeSpec[], fs: number): Placed {
  const colW = measured.reduce((a, m) => Math.max(a, m.w), fs * 3);
  const headerH = measured.reduce((a, m) => Math.max(a, m.h), fs * 2);
  const gapX = fs * 2.2;
  const step = fs * 2.4;
  const boxes = measured.map((m, i) => ({
    id: m.id,
    label: m.label,
    box: { x: i * (colW + gapX), y: 0, w: colW, h: headerH },
  }));
  const centreOf = (id: string): number => {
    const idx = measured.findIndex((m) => m.id === id);
    return (idx < 0 ? 0 : idx) * (colW + gapX) + colW / 2;
  };
  const edges = edgeSpecs.map((e, i) => {
    const y = headerH + step * (i + 1);
    const x1 = centreOf(e.from);
    const x2 = centreOf(e.to);
    const points: Pt[] =
      e.from === e.to
        ? [
            { x: x1, y },
            { x: x1 + colW * 0.42, y: y + step * 0.35 },
            { x: x1 + fs * 0.2, y: y + step * 0.7 },
          ]
        : [
            { x: x1, y },
            { x: x2, y },
          ];
    const entry: { from: string; to: string; label?: string; points: Pt[] } = {
      from: e.from,
      to: e.to,
      points,
    };
    if (e.label !== undefined) entry.label = e.label;
    return entry;
  });
  const bottom = headerH + step * (edgeSpecs.length + 1);
  const lifelines = boxes.map((b) => ({
    x: b.box.x + b.box.w / 2,
    y1: b.box.y + b.box.h,
    y2: bottom,
  }));
  return { boxes, edges, lifelines };
}

/** Strict vertical order, equal widths — a layer cake. */
function stackLayout(measured: Measured[], edgeSpecs: DiagramEdgeSpec[], fs: number): Placed {
  const w = measured.reduce((a, m) => Math.max(a, m.w), fs * 3);
  const gap = fs * 0.9;
  let y = 0;
  const boxes = measured.map((m) => {
    const box = { x: 0, y, w, h: m.h };
    y += m.h + gap;
    return { id: m.id, label: m.label, box };
  });
  return { boxes, edges: directEdges(boxes, edgeSpecs), lifelines: [] };
}

/** Near-square grid of equal cells, filled row by row. */
function gridLayout(measured: Measured[], edgeSpecs: DiagramEdgeSpec[], fs: number): Placed {
  const count = Math.max(1, measured.length);
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  const cellW = measured.reduce((a, m) => Math.max(a, m.w), fs * 3);
  const cellH = measured.reduce((a, m) => Math.max(a, m.h), fs * 2);
  const gap = fs * 0.9;
  const boxes = measured.map((m, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    return {
      id: m.id,
      label: m.label,
      box: { x: c * (cellW + gap), y: r * (cellH + gap), w: cellW, h: cellH },
    };
  });
  return { boxes, edges: directEdges(boxes, edgeSpecs), lifelines: [] };
}

/**
 * Edges the hand layouts do not route themselves: straight centre-to-centre,
 * later clipped to the node borders by `layoutDiagram`.
 */
function directEdges(
  boxes: Array<{ id: string; box: Box }>,
  edgeSpecs: DiagramEdgeSpec[],
): Placed['edges'] {
  const byId = new Map(boxes.map((b) => [b.id, b.box]));
  return edgeSpecs.flatMap((e) => {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b || e.from === e.to) return [];
    const entry: { from: string; to: string; label?: string; points: Pt[] } = {
      from: e.from,
      to: e.to,
      points: [boxCentre(a), boxCentre(b)],
    };
    if (e.label !== undefined) entry.label = e.label;
    return [entry];
  });
}

/* ------------------------------------------------------------------ drawing */

/**
 * Draw order: each node's box then its label (how a person builds a diagram),
 * then lifelines, then every edge with its label. Text and strokes interleave so
 * the renderer can write a label immediately after drawing its box.
 */
export function diagramItems(layout: DiagramLayout, ctx: DrawContext): InkItem[] {
  const items: InkItem[] = [];
  const boxCtx: DrawContext = { ...ctx, colour: ctx.colour ?? ctx.style.ink };
  const edgeCtx: DrawContext = { ...ctx, colour: ctx.style.secondary, weight: 'light' };
  const lifeCtx: DrawContext = { ...ctx, colour: ctx.style.muted, weight: 'hairline' };

  layout.nodes.forEach((node, i) => {
    const paths = inkPaths({ ...boxCtx, group: `node:${node.id}` }, 40 + i, (o) =>
      boxCtx.gen.rectangle(node.box.x, node.box.y, node.box.w, node.box.h, o),
    );
    for (const p of paths) items.push(pathItem(p));
    items.push(textItem(node.text));
  });

  layout.lifelines.forEach((l, i) => {
    const paths = inkPaths(
      { ...lifeCtx, group: `lifeline:${i}` },
      60 + i,
      (o) => lifeCtx.gen.line(l.x, l.y1, l.x, l.y2, o),
      { strokeLineDash: [8, 10] },
    ).map((p) => ({ ...p, opacity: p.opacity * 0.7 }));
    for (const p of paths) items.push(pathItem(p));
  });

  layout.edges.forEach((e, i) => {
    const paths: InkPath[] = polylineArrowPaths(e.points, {
      ...edgeCtx,
      seed: edgeCtx.seed + i * 131,
      group: `edge:${e.from}->${e.to}`,
    });
    for (const p of paths) items.push(pathItem(p));
    if (e.text) items.push(textItem(e.text));
  });

  return items;
}

/** Layout + draw in one call, for the common case. */
export function resolveDiagram(
  opts: LayoutDiagramOptions,
  ctx: DrawContext,
): { layout: DiagramLayout; items: InkItem[] } {
  const layout = layoutDiagram(opts);
  return { layout, items: diagramItems(layout, ctx) };
}
