/**
 * Diagram layout, dependency-free and deterministic.
 *
 * `DiagramElement` carries nodes and edges but no coordinates, so the renderer
 * has to place them. A layered longest-path ranking covers `flow`, `tree`,
 * `stack` and `sequence`; `grid` and `graph` get their own trivial placements.
 * Everything is scaled to fill the element's box exactly, so the author's
 * composition on the persistent canvas is respected.
 */
import type { DiagramElement } from '@inkcast/core';
import type { Rect } from './types.js';

export type LaidNode = { id: string; label: string; box: Rect };
export type LaidEdge = {
  from: string;
  to: string;
  label?: string;
  /** Waypoints from source border to target border, in canvas units. */
  points: [number, number][];
};
export type LaidDiagram = { nodes: LaidNode[]; edges: LaidEdge[] };

type Layout = DiagramElement['layout'];

/** Longest-path ranking with back-edges ignored, so cycles cannot hang us. */
function rank(nodeIds: string[], edges: { from: string; to: string }[]): number[] {
  const index = new Map(nodeIds.map((id, i) => [id, i]));
  const out: number[][] = nodeIds.map(() => []);
  for (const e of edges) {
    const a = index.get(e.from);
    const b = index.get(e.to);
    if (a === undefined || b === undefined || a === b) continue;
    (out[a] as number[]).push(b);
  }
  const ranks = nodeIds.map(() => 0);
  const state = nodeIds.map(() => 0); // 0 = unvisited, 1 = on stack, 2 = done
  const visit = (i: number): void => {
    if (state[i] === 1 || state[i] === 2) return;
    state[i] = 1;
    for (const j of out[i] as number[]) {
      visit(j);
      // Only forward edges push a node down a rank; back-edges are ignored.
      if (state[j] === 2) ranks[i] = Math.max(ranks[i] as number, (ranks[j] as number) + 1);
    }
    state[i] = 2;
  };
  for (let i = 0; i < nodeIds.length; i++) visit(i);
  // Ranks above count *depth from the sinks*; flip so sources come first.
  const max = ranks.reduce((m, r) => Math.max(m, r), 0);
  return ranks.map((r) => max - r);
}

function borderPoint(box: Rect, toward: [number, number]): [number, number] {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const dx = toward[0] - cx;
  const dy = toward[1] - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const sx = dx === 0 ? Infinity : box.w / 2 / Math.abs(dx);
  const sy = dy === 0 ? Infinity : box.h / 2 / Math.abs(dy);
  const s = Math.min(sx, sy);
  return [cx + dx * s, cy + dy * s];
}

export function layoutDiagram(el: DiagramElement): LaidDiagram {
  if (el.nodes.length === 0) return { nodes: [], edges: [] };
  const ids = el.nodes.map((nd) => nd.id);
  const labels = new Map(el.nodes.map((nd) => [nd.id, nd.label]));
  const box = el.at;
  const layout: Layout = el.layout;
  const count = Math.max(1, ids.length);

  // ---- assign a (col, row) grid cell per node ----
  let cols = 1;
  let rows = 1;
  const cell = new Map<string, [number, number]>();

  if (layout === 'stack') {
    // A stack is a column, by definition — one node per row, in declaration
    // order. It cannot go through the ranking below: an edgeless stack (which is
    // what the planner emits for a bullet list or a recap) ranks every node 0,
    // and a single rank on the cross axis becomes a single *row*. Five recap
    // items then shared one row of a 406-unit-wide box: 60×38-unit nodes with
    // 16-unit labels spilling out of them. Nothing about that read as a stack.
    cols = 1;
    rows = count;
    ids.forEach((id, i) => cell.set(id, [0, i]));
  } else if (layout === 'grid') {
    cols = Math.max(1, Math.ceil(Math.sqrt(count)));
    rows = Math.max(1, Math.ceil(count / cols));
    ids.forEach((id, i) => cell.set(id, [i % cols, Math.floor(i / cols)]));
  } else if (layout === 'graph') {
    // Ring placement: no crossing-minimisation, but honest and readable. One cell
    // of slack past the square grid keeps the nodes big enough to label.
    cols = Math.max(2, Math.ceil(Math.sqrt(count)) + 1);
    rows = cols;
    ids.forEach((id, i) => {
      const a = (i / count) * Math.PI * 2 - Math.PI / 2;
      const cx = (cols - 1) / 2;
      const cy = (rows - 1) / 2;
      const r = Math.max(cx, cy);
      cell.set(id, [cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    });
  } else {
    // `flow` reads left to right, so an edgeless flow is a row of peers, not the
    // single column that one shared rank would otherwise produce. Giving each
    // node its own rank matches how the planner sized the box.
    const ranks =
      layout === 'flow' && el.edges.length === 0 ? ids.map((_, i) => i) : rank(ids, el.edges);
    const perRank = new Map<number, string[]>();
    ids.forEach((id, i) => {
      const r = ranks[i] as number;
      const list = perRank.get(r) ?? [];
      list.push(id);
      perRank.set(r, list);
    });
    const rankCount = Math.max(...ranks) + 1;
    const widest = Math.max(...[...perRank.values()].map((l) => l.length));
    const horizontal = layout === 'flow';
    cols = horizontal ? rankCount : widest;
    rows = horizontal ? widest : rankCount;
    for (const [r, list] of perRank) {
      // Centre each rank across the cross axis.
      const span = horizontal ? rows : cols;
      const offset = (span - list.length) / 2;
      list.forEach((id, i) => {
        const cross = offset + i;
        cell.set(id, horizontal ? [r, cross] : [cross, r]);
      });
    }
  }

  // ---- turn cells into boxes that fill `box` ----
  // Gaps are a fraction of the node, not of the whole box, so edges always have
  // room to be seen and labelled however many nodes there are.
  const nodeW = box.w / (cols + 0.42 * (cols - 1));
  const gapX = cols > 1 ? (box.w - nodeW * cols) / (cols - 1) : 0;
  const nodeH = Math.min(box.h / (rows + 0.35 * (rows - 1)), nodeW * 0.62);
  const gapY = rows > 1 ? (box.h - nodeH * rows) / (rows - 1) : 0;
  const usedH = nodeH * rows + gapY * (rows - 1);
  const padY = (box.h - usedH) / 2;

  const nodes: LaidNode[] = ids.map((id) => {
    const [cx, cy] = cell.get(id) ?? [0, 0];
    return {
      id,
      label: labels.get(id) ?? id,
      box: {
        x: box.x + cx * (nodeW + gapX),
        y: box.y + padY + cy * (nodeH + gapY),
        w: nodeW,
        h: nodeH,
      },
    };
  });

  const byId = new Map(nodes.map((nd) => [nd.id, nd]));
  const edges: LaidEdge[] = [];
  for (const e of el.edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b || a === b) continue;
    const ac: [number, number] = [a.box.x + a.box.w / 2, a.box.y + a.box.h / 2];
    const bc: [number, number] = [b.box.x + b.box.w / 2, b.box.y + b.box.h / 2];
    const start = borderPoint(a.box, bc);
    const end = borderPoint(b.box, ac);
    const mx = (start[0] + end[0]) / 2;
    const my = (start[1] + end[1]) / 2;
    // A gentle perpendicular bulge keeps parallel edges from overlapping.
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const len = Math.hypot(dx, dy) || 1;
    const bulge = Math.min(len * 0.08, nodeH * 0.35);
    const points: [number, number][] = [
      start,
      [mx + (-dy / len) * bulge, my + (dx / len) * bulge],
      end,
    ];
    edges.push({ from: e.from, to: e.to, ...(e.label ? { label: e.label } : {}), points });
  }

  return { nodes, edges };
}
