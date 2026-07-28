import assert from 'node:assert/strict';
import test from 'node:test';
import type { Element, Storyboard } from '@inkcast/core';
import { frameSize, parseStoryboard } from '@inkcast/core';
import { buildDoc } from '../src/ingest.js';
import type { Box } from '../src/elements.js';
import { makeDiagram, makeText } from '../src/elements.js';
import { heuristicPlan } from '../src/heuristic.js';
import { frameSpan, layoutStoryboard, overlaps, regionBox, regionGrid } from '../src/layout.js';
import { GRADIENT_DESCENT } from './fixture.js';

const sb = heuristicPlan(buildDoc(GRADIENT_DESCENT, 'markdown'));

/** Which region of the grid a box's centre falls in. */
function regionOf(box: Box, grid: ReturnType<typeof regionGrid>, count: number): number {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  for (let i = 0; i < count; i++) {
    const r = regionBox(i, grid);
    if (cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) return i;
  }
  return -1;
}

/**
 * Recover the region grid the planner used: it is the one whose canvas is
 * exactly the canvas in the storyboard.
 */
function regionsOf(board: Storyboard): { grid: ReturnType<typeof regionGrid>; count: number } {
  let found: { grid: ReturnType<typeof regionGrid>; count: number } | undefined;
  for (let count = 1; count <= board.scenes.length; count++) {
    const grid = regionGrid(count, board.meta.aspect);
    // Several counts share a grid shape; take the largest so every region the
    // planner could have used is checked.
    if (grid.canvasW === board.canvas.w && grid.canvasH === board.canvas.h) found = { grid, count };
  }
  if (!found) throw new Error(`no region grid matches canvas ${board.canvas.w}x${board.canvas.h}`);
  return found;
}

test('no two persistent elements in the same region overlap', () => {
  const { grid, count } = regionsOf(sb);
  const buckets = new Map<number, Element[]>();
  for (const scene of sb.scenes) {
    for (const el of scene.elements) {
      // Emphasis elements deliberately sit on top of what they annotate.
      if (el.type === 'emphasis' || !el.persist) continue;
      const r = regionOf(el.at, grid, count);
      assert.notEqual(r, -1, `${el.id} landed outside every region: ${JSON.stringify(el.at)}`);
      const list = buckets.get(r) ?? [];
      list.push(el);
      buckets.set(r, list);
    }
  }
  assert.ok(buckets.size > 1, 'the plan should use more than one region of the canvas');
  for (const [region, els] of buckets) {
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        const a = els[i]!;
        const b = els[j]!;
        assert.ok(
          !overlaps(a.at, b.at, 1),
          `region ${region}: ${a.id} ${JSON.stringify(a.at)} overlaps ${b.id} ${JSON.stringify(b.at)}`,
        );
      }
    }
  }
});

test('every element sits inside the canvas', () => {
  for (const scene of sb.scenes) {
    for (const el of scene.elements) {
      assert.ok(el.at.x >= sb.canvas.x - 1, `${el.id} off the left edge`);
      assert.ok(el.at.y >= sb.canvas.y - 1, `${el.id} off the top edge`);
      assert.ok(el.at.x + el.at.w <= sb.canvas.x + sb.canvas.w + 1, `${el.id} off the right edge`);
      assert.ok(el.at.y + el.at.h <= sb.canvas.y + sb.canvas.h + 1, `${el.id} off the bottom edge`);
      assert.ok(el.at.w > 0 && el.at.h > 0, `${el.id} has no size`);
    }
  }
});

test('the canvas grows past one frame and the camera tours it', () => {
  const frame = frameSize(sb.meta.aspect);
  assert.ok(sb.canvas.w > frame.w, 'the canvas should be wider than one frame');
  const seen = new Set(sb.scenes.map((s) => `${s.camera.x},${s.camera.y}`));
  assert.ok(seen.size >= 4, `camera only visited ${seen.size} places`);
  // The viewport comes from `frameSpan`, not `canvas / zoom`: the renderer fits the
  // canvas into the frame, so at zoom 1 only the binding axis matches the canvas.
  const span = frameSpan(sb.canvas.w, sb.canvas.h, sb.meta.aspect);
  for (const s of sb.scenes) {
    assert.ok(s.camera.zoom > 1, `${s.id} never zooms in`);
    const visW = span.w / s.camera.zoom;
    const visH = span.h / s.camera.zoom;
    assert.ok(s.camera.x - visW / 2 >= -1, `${s.id} frames off-canvas on the left`);
    assert.ok(s.camera.x + visW / 2 <= sb.canvas.w + 1, `${s.id} frames off-canvas on the right`);
    assert.ok(s.camera.y - visH / 2 >= -1, `${s.id} frames off-canvas on the top`);
    assert.ok(s.camera.y + visH / 2 <= sb.canvas.h + 1, `${s.id} frames off-canvas at the bottom`);
  }
  assert.equal(sb.scenes[0]!.camera.transition, 0, 'the first scene should not pan in');
});

test('the camera frames one region, whatever the canvas aspect ratio', () => {
  // Short films are where the canvas looks least like the frame: two 16:9 scenes
  // make a 2x1 grid, so a 3920x1380 canvas against a 1.78 frame. The camera must
  // still sit on its own region and show roughly one region's worth of board — it
  // used to show the entire canvas width with the first scene half off-screen.
  for (const scenes of [1, 2, 3, 4, 6, 9]) {
    const board = layoutStoryboard(
      parseStoryboard({
        version: 1,
        title: 'framing',
        scenes: Array.from({ length: scenes }, (_, i) => ({
          id: `s${i}`,
          narration: `Beat number ${i}.`,
          camera: { x: 0, y: 0 },
          elements: [makeText(`t${i}`, `Heading number ${i}`, 'heading')],
        })),
      }),
    );
    const { grid, count } = regionsOf(board);
    const span = frameSpan(board.canvas.w, board.canvas.h, board.meta.aspect);
    board.scenes.forEach((s, i) => {
      const visW = span.w / s.camera.zoom;
      const visH = span.h / s.camera.zoom;
      // No more than ~35% slack over the region it is framing, on either axis.
      assert.ok(
        visW <= grid.rw * 1.35 && visH <= grid.rh * 1.35,
        `${scenes} scenes: viewport ${Math.round(visW)}x${Math.round(visH)} dwarfs the ${grid.rw}x${grid.rh} region`,
      );
      // And it is looking at the region this scene's own element was placed in.
      const el = s.elements[0];
      assert.ok(el);
      const region = regionBox(Math.max(0, regionOf(el.at, grid, count)), grid);
      assert.ok(
        Math.abs(s.camera.x - (region.x + region.w / 2)) <= visW / 2 &&
          Math.abs(s.camera.y - (region.y + region.h / 2)) <= visH / 2,
        `${scenes} scenes: scene ${i} is not looking at its own region`,
      );
    });
  }
});

test('prose attached under a short heading keeps its measure', () => {
  // A body paragraph used to be capped at its heading's width, which turned a short
  // title plus one sentence into a narrow column of one-word lines.
  const board = layoutStoryboard(
    parseStoryboard({
      version: 1,
      title: 'measure',
      scenes: [
        {
          id: 's0',
          narration: 'Water moves across a membrane.',
          camera: { x: 0, y: 0 },
          elements: [
            makeText('head', 'Osmosis', 'title'),
            makeText(
              'body',
              'Water moves across a membrane from low solute concentration to high solute concentration.',
              'body',
            ),
          ],
        },
      ],
    }),
    { hints: { head: { span: 'full' }, body: { span: 'full', below: 'head' } } },
  );
  const els = new Map(board.scenes[0]!.elements.map((e) => [e.id, e.at]));
  const head = els.get('head');
  const body = els.get('body');
  assert.ok(head && body);
  assert.ok(body.w > head.w * 2, `body ${body.w} was squeezed towards the head's ${head.w}`);
  assert.ok(body.h < 200, `body wrapped into a tall column (${body.h} units)`);
});

test('consecutive regions are adjacent, so the camera pans rather than jumps', () => {
  for (const count of [2, 3, 5, 8, 9, 12, 17]) {
    const grid = regionGrid(count, '16:9');
    for (let i = 0; i + 1 < count; i++) {
      const a = regionBox(i, grid);
      const b = regionBox(i + 1, grid);
      const dx = Math.abs(a.x - b.x) / (grid.rw + 240);
      const dy = Math.abs(a.y - b.y) / (grid.rh + 240);
      assert.ok(
        Math.abs(dx + dy - 1) < 1e-6,
        `regions ${i} and ${i + 1} of ${count} are not neighbours (dx=${dx}, dy=${dy})`,
      );
    }
  }
});

test('consecutive scenes never pan more than one region', () => {
  const { grid, count } = regionsOf(sb);
  const step = Math.max(grid.rw, grid.rh) + 240;
  for (let i = 1; i < sb.scenes.length; i++) {
    const a = sb.scenes[i - 1]!.camera;
    const b = sb.scenes[i]!.camera;
    const dist = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    assert.ok(dist <= step + 1, `scene ${i} pans ${dist} units (> ${step})`);
  }
  assert.ok(count >= 1);
});

test('layout repairs a storyboard whose elements all sit on top of each other', () => {
  const stacked = (id: string, text: string): Element => {
    const el = makeText(id, text, 'body');
    el.at = { x: 100, y: 100, w: 600, h: 200 };
    return el;
  };
  const draft: Storyboard = parseStoryboard({
    version: 1,
    title: 'Collision city',
    scenes: [
      {
        id: 's0',
        narration: 'Three claims land on the board, one after another, in the same spot.',
        camera: { x: 0, y: 0, zoom: 1, transition: 0 },
        elements: [
          stacked('a', 'The first claim goes here'),
          stacked('b', 'The second claim goes here'),
          stacked('c', 'The third claim goes here and it is a good deal longer than the others'),
          makeDiagram('d', 'stack', [
            { id: 'n0', label: 'one' },
            { id: 'n1', label: 'two' },
          ]),
        ],
      },
      {
        id: 's1',
        narration: 'Now we circle the first claim to show it again.',
        camera: { x: 0, y: 0, zoom: 1, transition: 0.9 },
        elements: [
          {
            id: 'e',
            type: 'emphasis',
            targetId: 'a',
            effect: 'circle',
            at: { x: 0, y: 0, w: 10, h: 10 },
          },
        ],
      },
    ],
  });

  const laid = layoutStoryboard(draft, { aspect: '16:9' });
  parseStoryboard(laid);

  const els = laid.scenes[0]!.elements;
  for (let i = 0; i < els.length; i++) {
    for (let j = i + 1; j < els.length; j++) {
      assert.ok(!overlaps(els[i]!.at, els[j]!.at, 1), `${els[i]!.id} still overlaps ${els[j]!.id}`);
    }
  }

  // The annotation scene stays in the region it annotates: same camera, short pan.
  assert.deepEqual(
    { x: laid.scenes[1]!.camera.x, y: laid.scenes[1]!.camera.y },
    { x: laid.scenes[0]!.camera.x, y: laid.scenes[0]!.camera.y },
  );
  assert.ok(laid.scenes[1]!.camera.transition < 0.9);
  const mark = laid.scenes[1]!.elements[0]!;
  const target = els.find((e) => e.id === 'a')!;
  assert.ok(mark.at.w > target.at.w, 'the circle should enclose its target');
  assert.ok(mark.at.x < target.at.x && mark.at.y < target.at.y);
});

test('layout adapts to a vertical aspect ratio', () => {
  const vertical = heuristicPlan(buildDoc(GRADIENT_DESCENT, 'markdown'), { aspect: '9:16' });
  parseStoryboard(vertical);
  assert.ok(vertical.canvas.h > vertical.canvas.w, 'a portrait plan should be taller than wide');
  for (const scene of vertical.scenes) {
    for (const el of scene.elements) {
      assert.ok(
        el.at.x + el.at.w <= vertical.canvas.w + 1 && el.at.y + el.at.h <= vertical.canvas.h + 1,
        `${el.id} escaped the portrait canvas`,
      );
    }
  }
});
