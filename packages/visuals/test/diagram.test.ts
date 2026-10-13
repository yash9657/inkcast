import assert from 'node:assert/strict';
import test from 'node:test';
import { diagramItems, layoutDiagram, type DiagramKind } from '../src/diagram.js';
import { builtinMetrics } from '@inkcast/core';
import { ctxFor } from '../src/geometry.js';
import { inkStyleFor } from '../src/style.js';
import { containsBox, padBox, pathBBox, pointsBBox, unionBox } from '../src/svg.js';

const style = inkStyleFor({ style: 'marker', palette: 'color' });
const font = builtinMetrics('Test Hand');
const KINDS: DiagramKind[] = ['flow', 'tree', 'graph', 'sequence', 'stack', 'grid'];

function nodes(count: number) {
  const labels = [
    'Client',
    'API gateway',
    'Queue',
    'Worker pool',
    'Primary database',
    'Cache',
    'Object storage',
    'Notifier',
    'A really quite long node label that has to wrap',
  ];
  return Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    label: labels[i % labels.length] ?? `Node ${i}`,
  }));
}

function chain(count: number) {
  return Array.from({ length: Math.max(0, count - 1) }, (_, i) => ({
    from: `n${i}`,
    to: `n${i + 1}`,
    label: i === 0 ? 'sends' : undefined,
  }));
}

for (const kind of KINDS) {
  for (const count of [1, 2, 4, 7]) {
    test(`${kind} layout with ${count} nodes keeps every node inside the element box`, () => {
      const box = { x: 120, y: 80, w: 900, h: 520 };
      const layout = layoutDiagram({
        box,
        kind,
        nodes: nodes(count),
        edges: chain(count),
        style,
        font,
      });
      assert.equal(layout.nodes.length, count);
      assert.ok(layout.scale > 0 && Number.isFinite(layout.scale));

      for (const node of layout.nodes) {
        assert.ok(
          containsBox(box, node.box, 0.75),
          `${kind}/${count}: node ${node.id} ${JSON.stringify(node.box)} escaped ${JSON.stringify(box)}`,
        );
        assert.ok(node.box.w > 0 && node.box.h > 0);
        // The label must fit inside its own box, not just the element.
        assert.ok(
          containsBox(padBox(node.box, 2), node.text.bounds, 1),
          `${kind}/${count}: label of ${node.id} overflows its box`,
        );
        assert.ok(node.text.lines.length > 0);
      }

      for (const edge of layout.edges) {
        assert.ok(
          containsBox(padBox(box, 1), pointsBBox(edge.points), 1),
          `${kind}/${count}: edge ${edge.from}->${edge.to} left the box`,
        );
      }

      assert.ok(containsBox(padBox(box, 1), layout.bounds, 1), `${kind}/${count}: bounds escaped`);
    });
  }
}

test('a diagram is never blown up beyond the upscale cap', () => {
  const box = { x: 0, y: 0, w: 1800, h: 1000 };
  const layout = layoutDiagram({
    box,
    kind: 'flow',
    nodes: nodes(2),
    edges: chain(2),
    style,
    font,
  });
  assert.ok(layout.scale <= 1.3 + 1e-9, `scale was ${layout.scale}`);
});

test('a diagram far too big for its box is scaled down, not clipped', () => {
  const box = { x: 10, y: 10, w: 320, h: 180 };
  const layout = layoutDiagram({
    box,
    kind: 'flow',
    nodes: nodes(7),
    edges: chain(7),
    style,
    font,
  });
  assert.ok(layout.scale < 1, `scale was ${layout.scale}`);
  for (const node of layout.nodes) assert.ok(containsBox(box, node.box, 0.75));
});

test('flow runs left to right and tree runs top to bottom', () => {
  const box = { x: 0, y: 0, w: 900, h: 900 };
  const flow = layoutDiagram({ box, kind: 'flow', nodes: nodes(3), edges: chain(3), style, font });
  const tree = layoutDiagram({ box, kind: 'tree', nodes: nodes(3), edges: chain(3), style, font });
  const fx = flow.nodes.map((n) => n.box.x);
  const ty = tree.nodes.map((n) => n.box.y);
  assert.ok((fx[0] ?? 0) < (fx[2] ?? 0), 'flow should advance rightwards');
  assert.ok((ty[0] ?? 0) < (ty[2] ?? 0), 'tree should advance downwards');
});

test('stack is strictly ordered top to bottom with equal widths', () => {
  const layout = layoutDiagram({
    box: { x: 0, y: 0, w: 600, h: 600 },
    kind: 'stack',
    nodes: nodes(4),
    edges: [],
    style,
    font,
  });
  const w = layout.nodes[0]?.box.w ?? 0;
  for (let i = 0; i < layout.nodes.length; i++) {
    const cur = layout.nodes[i];
    assert.ok(cur);
    assert.ok(Math.abs(cur.box.w - w) < 1e-6, 'stack layers must share a width');
    if (i > 0) {
      const prev = layout.nodes[i - 1];
      assert.ok(prev);
      assert.ok(cur.box.y >= prev.box.y + prev.box.h - 1e-6, 'stack layers must not overlap');
    }
  }
});

test('grid is near-square and non-overlapping', () => {
  const layout = layoutDiagram({
    box: { x: 0, y: 0, w: 800, h: 800 },
    kind: 'grid',
    nodes: nodes(9),
    edges: [],
    style,
    font,
  });
  const xs = new Set(layout.nodes.map((n) => Math.round(n.box.x)));
  const ys = new Set(layout.nodes.map((n) => Math.round(n.box.y)));
  assert.equal(xs.size, 3, 'nine nodes should form three columns');
  assert.equal(ys.size, 3, 'nine nodes should form three rows');
});

test('sequence gets one lifeline per actor, and messages run between them', () => {
  const layout = layoutDiagram({
    box: { x: 0, y: 0, w: 900, h: 600 },
    kind: 'sequence',
    nodes: nodes(3),
    edges: [
      { from: 'n0', to: 'n1', label: 'request' },
      { from: 'n1', to: 'n2' },
      { from: 'n2', to: 'n2' },
      { from: 'n1', to: 'n0', label: 'reply' },
    ],
    style,
    font,
  });
  assert.equal(layout.lifelines.length, 3);
  for (const l of layout.lifelines) assert.ok(l.y2 > l.y1, 'a lifeline must have length');
  const first = layout.edges[0];
  const second = layout.edges[1];
  assert.ok(first && second);
  assert.ok(
    (second.points[0]?.y ?? 0) > (first.points[0]?.y ?? 0),
    'later messages must sit lower down',
  );
  assert.ok(layout.edges[2]?.points.length === 3, 'a self-message should loop');
});

test('edges stop on the node border so the arrowhead is visible', () => {
  const layout = layoutDiagram({
    box: { x: 0, y: 0, w: 900, h: 400 },
    kind: 'flow',
    nodes: nodes(2),
    edges: [{ from: 'n0', to: 'n1' }],
    style,
    font,
  });
  const edge = layout.edges[0];
  const target = layout.nodes[1];
  assert.ok(edge && target);
  const tip = edge.points[edge.points.length - 1];
  assert.ok(tip);
  const onBorder =
    Math.abs(tip.x - target.box.x) < 1.5 ||
    Math.abs(tip.x - (target.box.x + target.box.w)) < 1.5 ||
    Math.abs(tip.y - target.box.y) < 1.5 ||
    Math.abs(tip.y - (target.box.y + target.box.h)) < 1.5;
  assert.ok(onBorder, `tip ${JSON.stringify(tip)} is not on ${JSON.stringify(target.box)}`);
});

test('labels on edges are laid out and kept in the box', () => {
  const box = { x: 0, y: 0, w: 900, h: 500 };
  const layout = layoutDiagram({
    box,
    kind: 'flow',
    nodes: nodes(3),
    edges: [
      { from: 'n0', to: 'n1', label: 'reads from' },
      { from: 'n1', to: 'n2', label: 'writes to' },
    ],
    style,
    font,
  });
  const labelled = layout.edges.filter((e) => e.text);
  assert.equal(labelled.length, 2);
  for (const e of labelled) {
    assert.ok(e.text);
    assert.ok(e.text.lines.length > 0);
    assert.ok(containsBox(padBox(box, 8), e.text.bounds, 1), 'an edge label escaped the box');
  }
});

test('diagramItems interleaves strokes and written labels in draw order', () => {
  const layout = layoutDiagram({
    box: { x: 0, y: 0, w: 900, h: 500 },
    kind: 'flow',
    nodes: nodes(3),
    edges: chain(3),
    style,
    font,
  });
  const items = diagramItems(layout, ctxFor(style, 12));
  assert.ok(items.length > layout.nodes.length * 2);
  assert.equal(items[0]?.kind, 'path', 'a box is drawn before its label is written');
  assert.equal(items.filter((i) => i.kind === 'text').length, layout.nodes.length + 1);
  for (const item of items) {
    if (item.kind !== 'path') continue;
    assert.match(item.path.d, /^M/);
    assert.ok(item.path.length > 0);
  }
  const strokeBounds = unionBox(
    items
      .filter((i) => i.kind === 'path')
      .map((i) => pathBBox((i as { path: { d: string } }).path.d)),
  );
  assert.ok(strokeBounds.w > 0 && strokeBounds.h > 0);
});

test('an empty diagram does not throw', () => {
  const layout = layoutDiagram({
    box: { x: 0, y: 0, w: 400, h: 300 },
    kind: 'flow',
    nodes: [],
    edges: [],
    style,
    font,
  });
  assert.equal(layout.nodes.length, 0);
  assert.deepEqual(diagramItems(layout, ctxFor(style, 1)), []);
});

test('edges naming unknown nodes are dropped rather than crashing', () => {
  const layout = layoutDiagram({
    box: { x: 0, y: 0, w: 600, h: 400 },
    kind: 'flow',
    nodes: nodes(2),
    edges: [{ from: 'n0', to: 'nowhere' }],
    style,
    font,
  });
  assert.equal(layout.edges.length, 0);
  assert.equal(layout.nodes.length, 2);
});
