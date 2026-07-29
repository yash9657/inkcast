import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseStoryboard, type Storyboard } from '@inkcast/core';
import { loadVisualManifest } from '../src/manifest.js';
import { resolveVisuals } from '../src/resolve.js';
import { containsBox, n, padBox, pathBBox, unionBox } from '../src/svg.js';

/** A storyboard that exercises every element type and every lane. */
function fixture(over: Record<string, unknown> = {}): Storyboard {
  return parseStoryboard({
    version: 1,
    title: 'Gradient descent',
    meta: { style: 'marker', palette: 'color' },
    canvas: { x: 0, y: 0, w: 1920, h: 1080 },
    assets: [
      { id: 'brain', kind: 'icon', prompt: 'a brain thinking' },
      { id: 'database', kind: 'illustration', prompt: 'a database' },
      {
        id: 'inline-mark',
        kind: 'image',
        svg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L10 10"/></svg>',
      },
    ],
    scenes: [
      {
        id: 's1',
        narration: 'Gradient descent walks downhill.',
        camera: { x: 480, y: 270, zoom: 1 },
        elements: [
          {
            id: 'title',
            type: 'text',
            text: 'Gradient descent walks downhill on the loss surface',
            role: 'title',
            at: { x: 120, y: 90, w: 900, h: 240 },
            enter: { at: 0, duration: 1.2, style: 'write' },
          },
          {
            id: 'box',
            type: 'shape',
            shape: 'rect',
            at: { x: 1100, y: 120, w: 400, h: 220 },
          },
          {
            id: 'brain-el',
            type: 'asset',
            assetId: 'brain',
            at: { x: 200, y: 420, w: 220, h: 220 },
          },
          {
            id: 'brain-flipped',
            type: 'asset',
            assetId: 'brain',
            flipX: true,
            at: { x: 500, y: 420, w: 220, h: 220 },
          },
          {
            id: 'missing-asset',
            type: 'asset',
            assetId: 'rocket-ship',
            at: { x: 800, y: 420, w: 200, h: 200 },
          },
          {
            id: 'link',
            type: 'arrow',
            at: { x: 440, y: 300, w: 650, h: 220 },
            from: { x: 440, y: 520 },
            to: { x: 1090, y: 300 },
            curve: 0.35,
            label: 'feeds',
          },
          {
            id: 'flow',
            type: 'diagram',
            layout: 'flow',
            at: { x: 120, y: 700, w: 1000, h: 320 },
            nodes: [
              { id: 'a', label: 'Sample a batch' },
              { id: 'b', label: 'Compute the gradient' },
              { id: 'c', label: 'Step downhill' },
            ],
            edges: [
              { from: 'a', to: 'b', label: 'loss' },
              { from: 'b', to: 'c' },
              { from: 'c', to: 'a', label: 'repeat' },
            ],
          },
          {
            id: 'mark-it',
            type: 'emphasis',
            targetId: 'box',
            effect: 'circle',
            at: { x: 1100, y: 120, w: 400, h: 220 },
            enter: { at: 0.6, duration: 0.6, style: 'draw' },
          },
          {
            id: 'ghost',
            type: 'emphasis',
            targetId: 'does-not-exist',
            effect: 'underline',
            at: { x: 1200, y: 900, w: 300, h: 60 },
          },
        ],
      },
    ],
    ...over,
  });
}

async function run(over?: Record<string, unknown>) {
  const dir = await mkdtemp(path.join(tmpdir(), 'inkcast-visuals-'));
  const sb = fixture(over);
  const out = await resolveVisuals(sb, dir);
  const manifest = await loadVisualManifest(dir);
  assert.ok(manifest, 'the manifest must be written');
  return { dir, sb, out, manifest };
}

test('every asset in the library gets a resolved svg on disk', async () => {
  const { dir, out, manifest } = await run();
  assert.equal(out.assets.length, 4, 'the unknown assetId must be synthesised into the library');
  for (const asset of out.assets) {
    assert.ok(asset.svg, `asset ${asset.id} has no svg`);
    assert.match(asset.svg ?? '', /^assets\/[\w-]+\.svg$/, 'the svg must be a relative path');
    const svg = await readFile(path.resolve(dir, asset.svg ?? ''), 'utf8');
    assert.match(svg, /^<svg /);
    assert.ok(typeof asset.seed === 'number', 'a seed must be locked in for reproducibility');
    const record = manifest.assets[asset.id];
    assert.ok(record, `no manifest record for ${asset.id}`);
    assert.equal(record.svg, asset.svg);
  }
});

test('with no API key, illustrations come from the icon lane', async () => {
  assert.equal(process.env.REPLICATE_API_TOKEN, undefined);
  assert.equal(process.env.FAL_KEY, undefined);
  const { manifest } = await run();
  assert.equal(manifest.assets.brain?.lane, 'icon');
  assert.equal(manifest.assets.brain?.icon?.slug, 'brain');
  // `kind: illustration` degrades to an icon rather than failing.
  assert.equal(manifest.assets.database?.lane, 'icon');
  assert.equal(manifest.assets.database?.icon?.slug, 'database');
  // A user-supplied inline svg is passed through untouched.
  assert.equal(manifest.assets['inline-mark']?.lane, 'inline');
  assert.equal(manifest.assets['rocket-ship']?.icon?.slug, 'rocket');
});

test('an asset id that names an icon wins over its prose prompt', async () => {
  // The planner's vocabulary is real lucide slugs, so the id is the exact answer.
  // Matching the prompt first sent `trending-down` ("a downward trending arrow")
  // to `log-in`, `mountain` ("a mountain peak") to `zodiac-capricorn` and
  // `briefcase` ("a briefcase") to `spell-check` — four wrong icons out of nine
  // in the sample film, and not one of them announced itself.
  const slugs = ['trending-down', 'mountain', 'briefcase', 'sliders-horizontal', 'cpu'];
  const prompts = [
    'a downward trending arrow',
    'a mountain peak',
    'a briefcase',
    'three slider controls',
    'a CPU chip seen from above, square with pins, hand-drawn',
  ];
  const { manifest } = await run({
    assets: slugs.map((id, i) => ({ id, kind: 'icon', prompt: prompts[i] })),
    scenes: [
      {
        id: 's1',
        narration: 'Four icons.',
        camera: { x: 480, y: 270, zoom: 1 },
        elements: slugs.map((id, i) => ({
          id: `el-${id}`,
          type: 'asset',
          assetId: id,
          at: { x: 100 + i * 240, y: 100, w: 200, h: 200 },
        })),
      },
    ],
  });
  for (const slug of slugs) {
    assert.equal(manifest.assets[slug]?.icon?.slug, slug, `${slug} should draw itself`);
  }

  // An id that is not itself an icon still goes through the keyword table before
  // the prompt: `ram` is not a lucide slug, but it is a keyword for memory-stick.
  // Read off the prompt instead it landed on `cpu`, because the prose says "chips".
  const other = await run({
    assets: [{ id: 'ram', kind: 'icon', prompt: 'a stick of RAM, a long board with chips on it' }],
  });
  assert.equal(other.manifest.assets.ram?.icon?.slug, 'memory-stick');
});

test('every element gets measured, ordered stroke geometry', async () => {
  const { dir, manifest } = await run();
  const ids = [
    'title',
    'box',
    'brain-el',
    'brain-flipped',
    'missing-asset',
    'link',
    'flow',
    'mark-it',
    'ghost',
  ];
  for (const id of ids) {
    const visual = manifest.elements[id];
    assert.ok(visual, `no geometry for ${id}`);
    assert.equal(visual.space, 'canvas');
    assert.equal(visual.sceneId, 's1');
    const svg = await readFile(path.resolve(dir, visual.svg), 'utf8');
    assert.match(svg, /^<svg /);
    assert.match(svg, new RegExp(`data-ink-element="${id}"`));

    const texts = visual.texts ?? [];
    assert.ok(visual.strokes.length > 0 || texts.length > 0, `${id} produced nothing to draw`);

    // `order` is the element's whole draw sequence, so strokes and written text
    // interleave (a diagram draws a box, writes its label, then the next box).
    const sequence = [...visual.strokes.map((s) => s.order), ...texts.map((t) => t.order)].sort(
      (a, b) => a - b,
    );
    assert.deepEqual(
      sequence,
      sequence.map((_, i) => i),
      `${id} draw order is not a contiguous sequence`,
    );

    let prevOrder = -1;
    visual.strokes.forEach((s, i) => {
      assert.ok(s.order > prevOrder, `${id} stroke ${i} is out of order`);
      prevOrder = s.order;
      assert.ok(s.length > 0, `${id} stroke ${i} has no length`);
      assert.match(s.d, /^M/);
      assert.ok(
        svg.includes(`data-ink-len="${n(s.length, 2)}"`),
        `${id} stroke ${i} length ${s.length} is missing from the svg`,
      );
    });
    assert.equal(
      visual.totalLength,
      visual.strokes.reduce((a, s) => a + s.length, 0),
    );
  }
});

test('text elements carry per-line reveal masks and per-word breakpoints', async () => {
  const { manifest } = await run();
  const title = manifest.elements.title;
  assert.ok(title?.texts);
  const layout = title.texts[0];
  assert.ok(layout);
  assert.equal(title.reveal, 'write');
  assert.ok(layout.lines.length > 1, 'a long title must wrap');
  for (const line of layout.lines) {
    assert.ok(line.mask.w > 0 && line.mask.h > 0, 'every line needs a reveal rectangle');
    assert.ok(line.words.length > 0, 'every line needs word breakpoints');
    assert.ok(line.width <= title.box.w + 1e-6, 'the line escaped the box width');
  }
  const last = layout.lines[layout.lines.length - 1];
  assert.ok(last && Math.abs(last.endFrac - 1) < 1e-9, 'the last line must finish at p=1');
});

test('diagram geometry is recorded and stays inside the element box', async () => {
  const { manifest } = await run();
  const flow = manifest.elements.flow;
  assert.ok(flow?.diagram);
  assert.equal(flow.diagram.nodes.length, 3);
  for (const node of flow.diagram.nodes) {
    assert.ok(containsBox(flow.box, node.box, 1), `${node.id} escaped the diagram box`);
  }
  assert.ok(flow.diagram.edges.length >= 2);
});

test('an asset placed twice is generated once and transformed per placement', async () => {
  const { manifest } = await run();
  const a = manifest.elements['brain-el'];
  const b = manifest.elements['brain-flipped'];
  assert.ok(a && b);
  assert.equal(a.asset?.id, 'brain');
  assert.equal(b.asset?.id, 'brain');
  assert.equal(a.asset?.svg, b.asset?.svg, 'both placements reference one entity');
  assert.equal(b.asset?.flipX, true);
  assert.equal(a.strokes.length, b.strokes.length);
  assert.notEqual(a.strokes[0]?.d, b.strokes[0]?.d, 'the mirrored copy must differ');
  // The placed copy is measured in canvas units, not the entity's local space.
  const entity = manifest.assets.brain;
  assert.ok(entity);
  assert.notEqual(a.totalLength, entity.totalLength);
  assert.ok(
    containsBox(
      padBox(a.box, style_pad),
      { x: a.viewBox[0], y: a.viewBox[1], w: a.viewBox[2], h: a.viewBox[3] },
      2,
    ),
  );
});

/** Roughened strokes wander a little outside the box they were fitted to. */
const style_pad = 40;

test('emphasis resolves its target box, and survives a missing target', async () => {
  const { manifest } = await run();
  const marked = manifest.elements['mark-it'];
  assert.ok(marked?.emphasis);
  assert.equal(marked.emphasis.resolved, true);
  assert.deepEqual(marked.emphasis.targetBox, manifest.elements.box?.box);
  assert.equal(marked.enterAt, 0.6);

  const ghost = manifest.elements.ghost;
  assert.ok(ghost?.emphasis);
  assert.equal(ghost.emphasis.resolved, false, 'a missing target must be reported, not crash');
  assert.ok(ghost.strokes.length > 0, 'it should still draw something');
});

test('a second run is fully cached and rewrites nothing', async () => {
  const { dir, sb } = await run();
  const before = await snapshot(dir);
  await new Promise((r) => setTimeout(r, 12));
  await resolveVisuals(sb, dir);
  const after = await snapshot(dir);
  assert.deepEqual(after, before, 'nothing should have been regenerated');
});

test('changing the ink style invalidates the cache', async () => {
  const { dir, sb } = await run();
  const first = await readFile(path.resolve(dir, 'assets/el-box.svg'), 'utf8');
  const restyled = parseStoryboard({ ...sb, meta: { ...sb.meta, style: 'pencil' } });
  await resolveVisuals(restyled, dir);
  const second = await readFile(path.resolve(dir, 'assets/el-box.svg'), 'utf8');
  assert.notEqual(first, second, 'switching marker → pencil must redraw');
  const manifest = await loadVisualManifest(dir);
  assert.equal(manifest?.style.name, 'pencil');
  assert.equal(manifest?.font.family !== undefined, true);
});

test('resolveVisuals is a pure enrichment: it does not mutate its input', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'inkcast-visuals-'));
  const sb = fixture();
  const before = JSON.stringify(sb);
  await resolveVisuals(sb, dir);
  assert.equal(JSON.stringify(sb), before);
});

test('progress is reported and monotonic', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'inkcast-visuals-'));
  const pcts: number[] = [];
  await resolveVisuals(fixture(), dir, {
    onProgress: (p) => {
      assert.equal(p.stage, 'visuals');
      pcts.push(p.pct);
    },
  });
  assert.ok(pcts.length > 5);
  for (let i = 1; i < pcts.length; i++) assert.ok((pcts[i] ?? 0) >= (pcts[i - 1] ?? 0));
  assert.equal(pcts[pcts.length - 1], 100);
});

async function snapshot(dir: string): Promise<Record<string, string>> {
  const manifest = await loadVisualManifest(dir);
  assert.ok(manifest);
  const files = [
    ...Object.values(manifest.assets).map((a) => a.svg),
    ...Object.values(manifest.elements).map((e) => e.svg),
  ];
  const out: Record<string, string> = {};
  for (const rel of files) {
    const s = await stat(path.resolve(dir, rel));
    out[rel] = `${s.size}:${s.mtimeMs}`;
  }
  return out;
}

/* ------------------------------------- plot, path and motion, end to end --- */

/** The gradient-descent picture the MVP's IR could not express at all. */
function teachingFixture(): Storyboard {
  return parseStoryboard({
    version: 1,
    title: 'Gradient descent',
    canvas: { x: 0, y: 0, w: 1920, h: 1080 },
    scenes: [
      {
        id: 'anchor',
        narration: 'You are on a foggy hillside and you want the valley.',
        camera: { x: 960, y: 540, zoom: 1 },
        region: 'hill',
        role: 'anchor',
        hold: 0.8,
        elements: [
          {
            id: 'hill',
            type: 'path',
            at: { x: 140, y: 160, w: 700, h: 520 },
            points: [
              { x: 140, y: 640 },
              { x: 300, y: 420 },
              { x: 470, y: 220 },
              { x: 640, y: 400 },
              { x: 820, y: 660 },
            ],
            weight: 1.3,
            enter: { at: 0, duration: 1.4, style: 'draw' },
          },
          {
            id: 'walker',
            type: 'shape',
            shape: 'ellipse',
            at: { x: 448, y: 196, w: 46, h: 46 },
            fill: true,
            motion: {
              path: [
                { x: 471, y: 219 },
                { x: 640, y: 400 },
                { x: 760, y: 560 },
                { x: 820, y: 655 },
              ],
              from: 0.35,
              to: 0.95,
              easing: 'ease-out',
              trail: true,
            },
          },
        ],
      },
      {
        id: 'step',
        narration: 'That hillside is a graph, and the slope tells you which way is down.',
        camera: { x: 1400, y: 500, zoom: 1.2 },
        region: 'plot',
        role: 'step',
        elements: [
          {
            id: 'loss',
            type: 'plot',
            at: { x: 980, y: 140, w: 820, h: 640 },
            xDomain: [-3, 3],
            yDomain: [0, 10],
            xLabel: 'weight w',
            yLabel: 'loss',
            grid: true,
            ticks: true,
            enter: { at: 0.05, duration: 1.6, style: 'draw' },
            curves: [
              { id: 'L', fn: { name: 'parabola', params: [1, 0, 0.5] }, label: 'loss' },
              { id: 'flat', fn: { name: 'line', params: [0, 0.5] }, dashed: true, accent: 4 },
            ],
            overlays: [
              { kind: 'point', curveId: 'L', x: 2, label: 'w = 2', at: 0.3 },
              { kind: 'tangent', curveId: 'L', x: 2, span: 1.1, label: 'slope +4', at: 0.55 },
              { kind: 'dropline', curveId: 'L', x: 2, to: 'both', at: 0.6 },
              {
                kind: 'steps',
                curveId: 'L',
                xs: [2, 1.2, 0.72, 0.43],
                label: 'each step',
                at: 0.8,
              },
              {
                kind: 'annotate',
                x: -2,
                y: 8,
                text: 'downhill is left',
                leaderTo: { x: -1.2, y: 1.9 },
                at: 0.9,
              },
              { kind: 'shade', curveId: 'L', fromX: -0.8, toX: 0.8, at: 0.95 },
            ],
          },
        ],
      },
    ],
  });
}

async function runTeaching() {
  const dir = await mkdtemp(path.join(tmpdir(), 'inkcast-teach-'));
  const out = await resolveVisuals(teachingFixture(), dir);
  const manifest = await loadVisualManifest(dir);
  assert.ok(manifest);
  return { dir, out, manifest };
}

test('a plot element resolves into revealable parts with per-overlay timing', async () => {
  const { dir, manifest } = await runTeaching();
  const plot = manifest.elements.loss;
  assert.ok(plot, 'no manifest record for the plot');
  assert.equal(plot.type, 'plot');
  assert.ok(plot.plot, 'the plot geometry must be recorded for the renderer');
  assert.ok(plot.strokes.length > 20, `only ${plot.strokes.length} strokes for a whole plot`);
  assert.ok((plot.texts?.length ?? 0) > 5, 'axis, tick and overlay labels must all be written');

  // The frame maps the declared domain into the element box.
  assert.deepEqual(plot.plot.xDomain, [-3, 3]);
  assert.deepEqual(plot.plot.yDomain, [0, 10]);
  assert.ok(containsBox(plot.box, plot.plot.area));

  // Every part points at a real slice of the draw sequence.
  const total = plot.strokes.length + (plot.texts?.length ?? 0);
  const kinds = new Set(plot.plot.parts.map((p) => p.kind));
  for (const want of ['grid', 'axis', 'ticks', 'axis-label', 'curve', 'point', 'tangent']) {
    assert.ok(kinds.has(want as never), `no ${want} part`);
  }
  for (const part of plot.plot.parts) {
    assert.ok(part.from >= 0 && part.to < total, `part ${part.id} indexes outside the sequence`);
    assert.ok(part.at >= 0 && part.at <= 1, `part ${part.id} has an out-of-range at`);
  }
  // Overlays keep the fractions the author wrote; the frame inherits the element's.
  const byKind = (k: string) => plot.plot?.parts.find((p) => p.kind === k);
  assert.equal(byKind('axis')?.at, 0.05);
  assert.equal(byKind('point')?.at, 0.3);
  assert.equal(byKind('tangent')?.at, 0.55);
  assert.equal(byKind('steps')?.at, 0.8);

  // The tangent's slope is the analytic derivative of x² + 0.5 at x = 2.
  const tangent = plot.plot.marks.find((m) => m.kind === 'tangent');
  assert.ok(tangent?.slope !== undefined);
  assert.ok(Math.abs((tangent.slope as number) - 4) < 1e-6, `slope was ${tangent.slope}`);

  // Curve traces are canvas-space and even, so a ball can ride them.
  assert.deepEqual(plot.plot.curves.map((c) => c.id).sort(), ['L', 'flat']);
  const trace = plot.plot.curves.find((c) => c.id === 'L');
  assert.ok(trace && trace.points.length > 40);

  const svg = await readFile(path.resolve(dir, plot.svg), 'utf8');
  assert.match(svg, /data-ink-type="plot"/);
  assert.match(svg, /data-ink-group="plot:tangent:overlay:1"/);
});

test('a path element records the smooth curve a motion can follow', async () => {
  const { dir, manifest } = await runTeaching();
  const hill = manifest.elements.hill;
  assert.ok(hill?.path, 'the path geometry must be recorded');
  assert.equal(hill.path.from, 'points');
  assert.equal(hill.path.closed, false);
  assert.match(hill.path.d, /^M/);
  assert.ok(hill.path.d.includes('C'), 'waypoints must be smoothed, not a polyline');
  assert.ok(hill.path.length > 0);
  assert.ok(hill.strokes.length > 0);
  const bounds = unionBox(hill.strokes.map((s) => pathBBox(s.d)));
  assert.ok(containsBox(padBox(hill.box, 12), bounds), 'the stroke left its box');
  const svg = await readFile(path.resolve(dir, hill.svg), 'utf8');
  assert.match(svg, /data-ink-type="path"/);
});

test('motion resolves to arc-length-even positions and centre-relative offsets', async () => {
  const { manifest } = await runTeaching();
  const walker = manifest.elements.walker;
  assert.ok(walker?.motion, 'motion must be recorded for the renderer');
  assert.equal(walker.motion.from, 0.35);
  assert.equal(walker.motion.to, 0.95);
  assert.equal(walker.motion.easing, 'ease-out');
  assert.equal(walker.motion.trail, true);
  assert.ok(walker.motion.length > 0);
  assert.equal(walker.motion.points.length, walker.motion.offsets.length);

  const gaps: number[] = [];
  for (let i = 1; i < walker.motion.points.length; i++) {
    const a = walker.motion.points[i - 1];
    const b = walker.motion.points[i];
    assert.ok(a && b);
    gaps.push(Math.hypot(b.x - a.x, b.y - a.y));
  }
  assert.ok(Math.max(...gaps) - Math.min(...gaps) < Math.max(...gaps) * 0.05, 'uneven spacing');

  // The offsets are deltas from the element's own centre.
  const centre = { x: walker.box.x + walker.box.w / 2, y: walker.box.y + walker.box.h / 2 };
  const first = walker.motion.points[0];
  const firstOffset = walker.motion.offsets[0];
  assert.ok(first && firstOffset);
  assert.ok(Math.abs(first.x - centre.x - firstOffset.x) < 1e-6);

  // The trail is not part of the element's own draw-on.
  assert.ok(walker.strokes.every((s) => s.group !== 'trail'));
});

test('plots and paths are cached and reproduced byte-for-byte', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'inkcast-teach-'));
  await resolveVisuals(teachingFixture(), dir);
  const first = await readFile(path.resolve(dir, 'assets/el-loss.svg'), 'utf8');
  const firstPath = await readFile(path.resolve(dir, 'assets/el-hill.svg'), 'utf8');

  await resolveVisuals(teachingFixture(), dir);
  assert.equal(await readFile(path.resolve(dir, 'assets/el-loss.svg'), 'utf8'), first);
  assert.equal(await readFile(path.resolve(dir, 'assets/el-hill.svg'), 'utf8'), firstPath);

  // A forced rerun must also be deterministic — the seed comes from the ids.
  await resolveVisuals(teachingFixture(), dir, { force: true });
  assert.equal(await readFile(path.resolve(dir, 'assets/el-loss.svg'), 'utf8'), first);
});

test('a path element with neither points nor d warns and draws nothing', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'inkcast-teach-'));
  const sb = parseStoryboard({
    version: 1,
    title: 'empty',
    scenes: [
      {
        id: 's',
        narration: 'n',
        camera: { x: 0, y: 0 },
        elements: [{ id: 'nothing', type: 'path', at: { x: 0, y: 0, w: 100, h: 100 } }],
      },
    ],
  });
  const out = await resolveVisuals(sb, dir);
  const manifest = await loadVisualManifest(dir);
  assert.ok(manifest);
  assert.equal(manifest.elements.nothing?.strokes.length, 0);
  assert.equal(manifest.elements.nothing?.path, undefined);
  assert.equal(out.scenes.length, 1, 'the pipeline must survive it');
});
