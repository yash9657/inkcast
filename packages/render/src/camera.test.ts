/**
 * Board accumulation: does the camera frame a growing board, and does the frame
 * carry ink?
 *
 * These are the tests for the product thesis. A slideshow passes every other test
 * in this package — correct geometry, deterministic frames, synced narration — and
 * still teaches nothing, because each beat gets its own empty patch of canvas.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { frameSize, parseStoryboard } from '@inkcast/core';
import type { Storyboard } from '@inkcast/core';
import {
  boardMetrics,
  contentFill,
  elementBounds,
  fitCamera,
  resolveFraming,
  safeInsets,
  unitsPerPixel,
  viewRect,
} from '@inkcast/core';
import { compilePlan } from './compile.js';
import {
  fixtureStoryboard,
  lessonStoryboard,
  planWithVisuals,
  verticalStoryboard,
  wipeStoryboard,
} from './fixture.js';
import { rectContains } from './geom.js';
import type { Rect } from './types.js';

const DIR = '/tmp/inkcast-camera-test';
const FRAME = frameSize('16:9');

/**
 * Beats packed onto one board the way a planner lays out a region: two columns
 * filling downwards, each beat extending the union it shares with the last.
 */
function board(
  opts: {
    region?: string;
    beats?: number;
    aspect?: '16:9' | '9:16';
    canvas?: Rect;
    recapLast?: boolean;
  } = {},
): Storyboard {
  const beats = opts.beats ?? 4;
  const scenes = [];
  for (let i = 0; i < beats; i++) {
    scenes.push({
      id: `s${i}`,
      narration: `beat ${i}`,
      durationSec: 2,
      ...(opts.region === undefined ? {} : { region: opts.region }),
      ...(opts.recapLast && i === beats - 1 ? { role: 'recap' as const } : {}),
      camera: { x: 1600, y: 900, zoom: 1, transition: 0 },
      elements: [
        {
          id: `e${i}`,
          type: 'text',
          text: `beat ${i}`,
          at: { x: 200 + (i % 2) * 600, y: 300 + Math.floor(i / 2) * 280, w: 560, h: 240 },
        },
      ],
    });
  }
  return parseStoryboard({
    version: 1,
    title: 'board',
    meta: { aspect: opts.aspect ?? '16:9' },
    canvas: opts.canvas ?? { x: 0, y: 0, w: 3200, h: 1800 },
    scenes,
  });
}

test('element bounds follow the ink, not just the authored box', () => {
  const sb = parseStoryboard({
    version: 1,
    title: 'bounds',
    scenes: [
      {
        id: 's',
        narration: 'a',
        durationSec: 1,
        camera: { x: 0, y: 0 },
        elements: [
          {
            id: 'arrow',
            type: 'arrow',
            from: { x: 100, y: 100 },
            to: { x: 900, y: 700 },
            at: { x: 100, y: 100, w: 40, h: 40 },
          },
          {
            id: 'path',
            type: 'path',
            points: [
              { x: 50, y: 800 },
              { x: 400, y: 1000 },
              { x: 700, y: 1100 },
            ],
            at: { x: 0, y: 0, w: 10, h: 10 },
          },
          {
            id: 'curly',
            type: 'path',
            d: 'M10 10 C 200 10, 200 300, 400 300',
            at: { x: 0, y: 0, w: 1, h: 1 },
          },
          {
            id: 'mover',
            type: 'shape',
            shape: 'ellipse',
            at: { x: 0, y: 0, w: 100, h: 100 },
            motion: {
              path: [
                { x: 50, y: 50 },
                { x: 1400, y: 600 },
              ],
            },
          },
        ],
      },
    ],
  });
  const els = sb.scenes[0]?.elements ?? [];
  const arrow = elementBounds(els[0]!);
  assert.ok(arrow.w >= 800 && arrow.h >= 600, 'an arrow spans from its tail to its tip');

  const path = elementBounds(els[1]!);
  assert.deepEqual(path, { x: 50, y: 800, w: 650, h: 300 });

  const curly = elementBounds(els[2]!);
  assert.ok(
    curly.w > 380 && curly.h > 280,
    `raw path data is measured, got ${JSON.stringify(curly)}`,
  );
  assert.ok(curly.x >= 9 && curly.y >= 9, 'and starts where the path starts');

  // The centre follows the path, so the swept corridor is the path fattened by
  // half the element — otherwise a moving ball leaves the frame it was fitted to.
  const mover = elementBounds(els[3]!);
  assert.ok(mover.x <= 0 && mover.y <= 0);
  assert.ok(mover.x + mover.w >= 1450 && mover.y + mover.h >= 650);
});

test('a region accumulates: the camera frames the union so far and eases wider', () => {
  const sb = board({ region: 'board', beats: 4 });
  const framing = resolveFraming(sb, FRAME);
  assert.equal(framing.length, 4);
  assert.ok(
    framing.every((f) => f.derived),
    'every scene in a region gets a derived camera',
  );

  const views = framing.map((f) => viewRect(f.camera, sb.canvas, FRAME));
  const drawn: Rect[] = [];
  for (let i = 0; i < framing.length; i++) {
    drawn.push(elementBounds(sb.scenes[i]!.elements[0]!));
    const view = views[i]!;
    // Nothing already on this board may be cropped out of shot.
    for (let k = 0; k < drawn.length; k++) {
      assert.ok(rectContains(view, drawn[k]!), `scene ${i} must still show element ${k}`);
    }
    if (i > 0) {
      // The board never shrinks, so the shot never tightens; it widens whenever the
      // new beat lands outside what was already framed.
      assert.ok(
        framing[i]!.camera.zoom <= framing[i - 1]!.camera.zoom + 1e-9,
        `scene ${i} must not tighten mid-region`,
      );
      assert.ok(view.w >= views[i - 1]!.w - 1e-9, 'the visible board never shrinks');
    }
  }
  assert.ok(
    framing.at(-1)!.camera.zoom < framing[0]!.camera.zoom * 0.9,
    'and it has eased wider by the end of the region',
  );
});

test('a scene with no region keeps the camera its author composed', () => {
  const sb = board({ beats: 3 });
  const framing = resolveFraming(sb, FRAME);
  for (let i = 0; i < framing.length; i++) {
    assert.equal(framing[i]?.derived, false);
    assert.deepEqual(framing[i]?.camera, { ...sb.scenes[i]!.camera });
  }
  // The classic fixture composes its own shots, so the plan must not overrule it.
  const plan = compilePlan(fixtureStoryboard(), DIR);
  assert.equal(plan.scenes[1]?.camera.x, 1700);
  assert.equal(plan.scenes[1]?.camera.zoom, 1.8);
});

test('a recap pulls back over everything drawn, across every region', () => {
  const sb = lessonStoryboard();
  const framing = resolveFraming(sb, FRAME);
  const recap = framing.at(-1);
  assert.ok(recap?.derived, 'the recap camera is derived even without a region of its own');
  const view = viewRect(recap.camera, sb.canvas, FRAME);

  const everything: Rect[] = [];
  for (const scene of sb.scenes) {
    for (const el of scene.elements) if (el.persist) everything.push(elementBounds(el));
  }
  for (const box of everything) {
    assert.ok(rectContains(view, box), `the recap must show ${JSON.stringify(box)}`);
  }
  // ...and it is genuinely wider than the beats it summarises.
  for (const f of framing.slice(0, -1)) {
    assert.ok(recap.camera.zoom <= f.camera.zoom, 'the recap is the widest shot in the film');
  }
});

test('a wiped board frames one card and forgets the last one', () => {
  // The inverse of the test above, and the half of `wipe` without which the phase
  // changes nothing: `resolveFraming` re-derives every camera from accumulated ink
  // and overwrites whatever the planner composed, so a board that wipes has to be
  // able to say that ink is *gone*. Otherwise the frame keeps widening for marks the
  // renderer has already faded out.
  const sb = wipeStoryboard();
  const framing = resolveFraming(sb, FRAME);
  const views = framing.map((f) => viewRect(f.camera, sb.canvas, FRAME));
  const boxOf = (id: string): Rect => {
    for (const scene of sb.scenes) {
      const el = scene.elements.find((e) => e.id === id);
      if (el) return elementBounds(el);
    }
    throw new Error(`no element ${id}`);
  };

  // A card that several beats draw together is still on the board for the last of
  // them — the hook draws the hillside, the anchor rolls a ball down it.
  assert.ok(rectContains(views[1] as Rect, boxOf('hill')), 'the held hillside is still framed');

  // And it is gone by the recap, which under `wipe` frames only what it drew itself.
  const recap = framing.at(-1);
  assert.ok(recap?.derived, 'the recap camera is still derived');
  const recapView = views.at(-1) as Rect;
  for (const id of ['hill', 'ball', 'loss', 'tan']) {
    assert.ok(!rectContains(recapView, boxOf(id)), `${id} was wiped — the recap must not frame it`);
  }
  const own = sb.scenes.at(-1)!.elements.map((el) => elementBounds(el));
  for (const box of own) {
    assert.ok(rectContains(recapView, box), 'the recap frames the summary it drew');
  }

  // Not a pull-back over the board any more: it is a card, framed like every other
  // card and clamped by the same close-up ceiling, because there is no board behind
  // it to pull back over. The accumulating fixture is the control — same geometry,
  // same recap, and there the shot is the widest in the film (the test above).
  //
  // `>=`, and the equals is the case the real product lands in. Measured on
  // gradient-descent at the standard preset under `wipe`, the derived zooms are
  // 1.678 1.678 1.678 then 1.620 six times: the median *is* the recap's own shot, so a
  // strict `>` is false there and passed here only because this fixture's ink sits
  // differently. An assertion that holds on the fixture and fails on the thing we ship
  // is measuring the fixture.
  //
  // Nor is it a law, and the next person should not read it as one: `longitude` wiped
  // frames its recap at 1.620 against a 1.702 median, because that recap's summary
  // carries more ink than its beats do. What both lessons *do* share is the line
  // below — the same recap, accumulating, pulls back several times as wide.
  const zooms = framing.map((f) => f.camera.zoom);
  const median = [...zooms].sort((a, b) => a - b)[zooms.length >> 1] as number;
  assert.ok(recap.camera.zoom >= median - 1e-9, 'a wiped recap is no wider than the median shot');
  assert.ok(recap.camera.zoom <= median * 1.9 + 1e-9, 'and still inside the close-up ceiling');
  const accumulated = resolveFraming(lessonStoryboard(), FRAME).at(-1);
  assert.ok(accumulated, 'the control fixture has a recap too');
  assert.ok(
    recap.camera.zoom > accumulated.camera.zoom * 1.5,
    `the same recap pulls back to ${accumulated.camera.zoom.toFixed(2)} when the board accumulates`,
  );

  // The slow pull-back goes with it: 1.1s of crossfade between two shots of the same
  // empty cell is the boundary dead air Phase 3 has to spend elsewhere.
  assert.equal(recap.camera.transition, sb.scenes.at(-1)!.camera.transition);
  assert.ok(accumulated.camera.transition >= 1.1, 'the accumulating recap still eases wide');
});

test('region framing fills the frame where authored cameras leave a void', () => {
  const withRegion = board({ region: 'board', beats: 4 });
  const without = board({ beats: 4 });
  const mean = (v: number[]): number => v.reduce((a, b) => a + b, 0) / v.length;

  const grouped = mean(contentFill(resolveFraming(withRegion, FRAME), withRegion.canvas, FRAME));
  const authored = mean(contentFill(resolveFraming(without, FRAME), without.canvas, FRAME));
  assert.ok(
    grouped > authored * 2,
    `grouping should fill far more of the frame (${grouped} vs ${authored})`,
  );
  assert.ok(grouped > 0.4, `expected roughly half the frame carrying ink, got ${grouped}`);

  // The real lesson shape: roughly half the frame carries content, every beat.
  const plan = compilePlan(lessonStoryboard(), DIR);
  assert.equal(plan.fill.length, plan.scenes.length);
  assert.ok(
    plan.fill.every((v) => v > 0.25),
    `no beat may be a caption in a void: ${plan.fill.join(', ')}`,
  );
  assert.ok(mean(plan.fill) > 0.4, `mean fill ${mean(plan.fill)}`);
});

test('9:16 adapts framing, safe margins and type scale rather than cropping', () => {
  const vFrame = frameSize('9:16');
  assert.deepEqual(vFrame, { w: 1080, h: 1920 });

  const flat = safeInsets('16:9', FRAME);
  const tall = safeInsets('9:16', vFrame);
  assert.ok(tall.bottom > tall.top, 'a phone player puts more chrome at the bottom');
  assert.ok(
    tall.left / vFrame.w > flat.left / FRAME.w,
    'narrow frames need proportionally more side margin',
  );

  const sb = verticalStoryboard();
  const plan = compilePlan(sb, DIR);
  assert.deepEqual(plan.frame, vFrame);
  assert.equal(plan.aspect, '9:16');
  assert.ok(
    plan.typeScale > plan.scale * 1.3,
    'type is enlarged for a phone, not merely scaled down',
  );

  const framing = resolveFraming(sb, vFrame);
  const insets = safeInsets('9:16', vFrame);
  for (let i = 0; i < framing.length; i++) {
    const f = framing[i]!;
    if (!f.derived) continue;
    const view = viewRect(f.camera, sb.canvas, vFrame);
    const px = vFrame.w / view.w;
    const safe: Rect = {
      x: view.x + insets.left / px,
      y: view.y + insets.top / px,
      w: view.w - (insets.left + insets.right) / px,
      h: view.h - (insets.top + insets.bottom) / px,
    };
    for (const box of f.visible) {
      assert.ok(rectContains(safe, box, 1), `scene ${i} keeps ink clear of the phone's safe area`);
    }
  }
});

test('a tall region walks the canvas instead of shrinking its own ink', () => {
  const vFrame = frameSize('9:16');
  const sb = board({
    region: 'column',
    beats: 7,
    aspect: '9:16',
    canvas: { x: 0, y: 0, w: 1080, h: 5200 },
  });
  // Stack the beats down the column rather than across it.
  const stacked = parseStoryboard({
    ...sb,
    scenes: sb.scenes.map((s, i) => ({
      ...s,
      elements: [{ ...s.elements[0]!, at: { x: 110, y: 200 + i * 620, w: 860, h: 420 } }],
    })),
  });
  const framing = resolveFraming(stacked, vFrame);
  const zooms = framing.map((f) => f.camera.zoom);
  const views = framing.map((f) => viewRect(f.camera, stacked.canvas, vFrame));

  // It stops zooming out well before the ink becomes unreadable, and holds there.
  const tail = zooms.slice(-3);
  assert.ok(
    Math.max(...tail) - Math.min(...tail) < 1e-6,
    `the zoom should plateau once it starts walking: ${zooms.join(', ')}`,
  );
  assert.ok(
    Math.min(...zooms) > Math.max(...zooms) / 3,
    `and never shrink without limit: ${zooms.join(', ')}`,
  );
  // Once it stops zooming out, it travels: the window moves down the board.
  const centres = views.map((v) => v.y + v.h / 2);
  assert.ok(centres.at(-1)! > centres[0]! + 1500, 'the camera walks down the tall canvas');
  for (let i = 1; i < views.length; i++) {
    assert.ok(centres[i]! >= centres[i - 1]! - 1e-6, 'and never walks back up');
    // Whatever is being drawn now is always in shot, however full the board is.
    assert.ok(
      rectContains(views[i]!, elementBounds(stacked.scenes[i]!.elements[0]!), 1),
      `scene ${i} must show its own ink`,
    );
  }
  // The oldest ink is what scrolls away, not the newest.
  const lastTarget = framing.at(-1)!.target!;
  assert.ok(lastTarget.y > 200, 'the walk window drops the top of the board');

  // And the ink that scrolled away stops counting as fill. This is the shot the
  // clipping correction in `contentFill` exists for: a window onto something larger
  // used to be credited with every box on the board, whether or not the camera was
  // pointed at it, so it scored best at the exact moment it showed least — the
  // flattery that made "clamp minimum content fill" (PLAN-LAUNCH A4.3) unreadable as a
  // floor. The extreme case measured was `longitude` at the `short` preset, whose recap
  // reported a perfect 100% while holding a six-beat board inside one phone frame; that
  // is a planner-level lesson and not reachable from this package, so what is pinned
  // here is the mechanism rather than that number. The walk has just been asserted to
  // drop the top of the board, so ink is provably off screen, and the clipped measure
  // must therefore come in strictly under the measure that ignores the frame. Asserting
  // the mechanism is the durable half anyway: the 100% only appears once enough of the
  // board is off screen, and a fixture tuned to reach it would pin the arithmetic of
  // this fixture instead of the rule.
  const walked = framing.at(-1)!;
  const view = views.at(-1)!;
  const unclipped = walked.visible.reduce((a, r) => a + r.w * r.h, 0) / (view.w * view.h);
  const fill = contentFill(framing, stacked.canvas, vFrame).at(-1)!;
  assert.ok(
    fill < unclipped,
    `the scrolled-away ink still counts: ${fill} against ${unclipped.toFixed(2)} unclipped`,
  );
  assert.ok(fill < 0.8, `fill counts only what is on screen, got ${fill}`);
  assert.ok(fill > 0.2, `and it does count what is on screen, got ${fill}`);
});

test('no derived shot is tighter than its own fit, so a fill clamp would have to crop', () => {
  // The measurement PLAN-LAUNCH A4.3's "clamp minimum content fill at 55%" died on, kept
  // as a test because the next person to want that clamp will reach for a crop. Every
  // derived camera here is already the tight fit of what it holds — the resolved zoom is
  // never *above* `fitCamera`'s — so the only frame left to reclaim belongs to the safe
  // area or to the paper between an authored beat's own marks. Raising fill past that
  // means cutting ink out of the shot, which is the one thing this file never does.
  const insets = { '16:9': safeInsets('16:9', FRAME) };
  for (const sb of [lessonStoryboard(), wipeStoryboard(), board({ region: 'board', beats: 6 })]) {
    for (const [i, f] of resolveFraming(sb, FRAME).entries()) {
      if (!f.derived || f.target === null) continue;
      const tight = fitCamera(f.target, sb.canvas, FRAME, insets['16:9']).zoom;
      assert.ok(
        f.camera.zoom <= tight + 1e-9,
        `scene ${i} was framed at ${f.camera.zoom} against a tight fit of ${tight}`,
      );
    }
  }
});

test('the unit scale follows the resolved camera, not the authored one', () => {
  // Region framing replaces the authored zoom, so the type scale has to be taken
  // from what the camera actually does. Sizing off `camera.zoom: 1` here would make
  // every letter 2-3x oversize.
  const sb = board({ region: 'board', beats: 4 });
  const framing = resolveFraming(sb, FRAME);
  const zooms = framing.map((f) => f.camera.zoom);
  assert.ok(
    zooms.every((z) => z > 1.2),
    `the derived cameras zoom in: ${zooms.join(', ')}`,
  );
  const plan = compilePlan(sb, DIR);
  assert.ok(Math.abs(plan.scale - unitsPerPixel(sb.canvas, FRAME, zooms)) < 1e-12);
  assert.ok(plan.scale < 1, 'a canvas unit is smaller than a pixel at these framings');
});

test('a recap that cannot be read pulls back only as far as it stays legible', () => {
  // The vertical benchmark: on a 1640x9560 canvas the whole board is 1:5.8 while the
  // frame is 1:1.78, so fitting all of it made the entire lesson a ~90px-wide ribbon
  // of illegible marks. Legibility beats completeness — the rule this file already
  // states for every other beat, now applied to the recap too.
  const beats = 9;
  const scenes = [];
  for (let i = 0; i < beats; i++) {
    scenes.push({
      id: `s${i}`,
      narration: `beat ${i}`,
      durationSec: 2,
      region: 'board',
      ...(i === beats - 1 ? { role: 'recap' } : {}),
      camera: { x: 820, y: 500 + i * 1000, zoom: 1, transition: 0 },
      elements: [
        {
          id: `e${i}`,
          type: 'text',
          text: `beat ${i}`,
          at: { x: 200, y: 300 + i * 1000, w: 1100, h: 700 },
        },
      ],
    });
  }
  const tall = parseStoryboard({
    version: 1,
    title: 'tall',
    meta: { aspect: '9:16' },
    canvas: { x: 0, y: 0, w: 1640, h: 9560 },
    scenes,
  });
  const frame = frameSize('9:16');
  const framing = resolveFraming(tall, frame);
  const zooms = framing.map((f) => f.camera.zoom);
  const median = [...zooms].sort((a, b) => a - b)[zooms.length >> 1] as number;
  const recap = framing.at(-1);
  assert.ok(recap, 'there is a last shot');

  // Non-vacuous: the accumulated board really is far too tall to fit this frame.
  const board = framing.at(-2)!;
  assert.ok(board.target, 'the beat before the recap framed a board');
  assert.ok(
    recap.target!.h < 8000,
    `the recap still framed ${Math.round(recap.target!.h)} units of a 8900-unit board`,
  );
  // Still the widest shot in the film, but within a factor of the film's framing.
  assert.ok(recap.camera.zoom <= median, 'the recap is still the widest shot');
  assert.ok(
    recap.camera.zoom >= median / 2,
    `recap ink is ${(recap.camera.zoom / median).toFixed(2)}x the median — unreadable`,
  );

  // On 16:9 the whole board does fit inside the limit, so that case is unchanged.
  const wideSb = lessonStoryboard();
  const view = viewRect(resolveFraming(wideSb, FRAME).at(-1)!.camera, wideSb.canvas, FRAME);
  for (const scene of wideSb.scenes) {
    for (const el of scene.elements) {
      if (el.persist) {
        assert.ok(rectContains(view, elementBounds(el)), 'the wide recap still shows everything');
      }
    }
  }
});

/* --------------------------------------------------------- one board, one scale */

test('boardMetrics is the single answer to how big everything draws', async () => {
  // Root cause 1's blocker was that this arithmetic lived in the renderer, so the
  // visuals stage could not know it and recorded geometry nobody could consume. It is
  // in `@inkcast/core` now, and these are the invariants that make it usable from both
  // ends rather than merely reachable.
  const sb = lessonStoryboard();
  const board = boardMetrics(sb);

  // Derived, not guessed: the scale follows the *resolved* cameras, so a storyboard
  // whose camera tours a canvas larger than one frame does not get canvas-sized type.
  assert.equal(board.framing.length, sb.scenes.length);
  assert.ok(
    Math.abs(
      board.scale -
        unitsPerPixel(
          sb.canvas,
          frameSize(sb.meta.aspect),
          board.framing.map((f) => f.camera.zoom),
        ),
    ) < 1e-12,
  );

  // Pure: two calls agree exactly, which is what lets two stages call it separately
  // and still draw the same board.
  assert.deepEqual(boardMetrics(sb), board);

  // And what the renderer actually plans with is what it reports.
  const plan = await planWithVisuals(sb);
  assert.ok(Math.abs(plan.scale - board.scale) < 1e-12, 'the plan drew at a different scale');
  assert.ok(Math.abs(plan.typeScale - board.scale * board.gain) < 1e-12);
});

test('a vertical board is composed heavier, not cropped', () => {
  // The gain is the reason 9:16 is a composition rather than a crop, and it now has to
  // be readable by the visuals stage too — a plot resolved without it would be typed
  // for a desktop frame and drawn on a phone.
  const wide = boardMetrics(lessonStoryboard());
  const tall = boardMetrics(verticalStoryboard());
  assert.equal(wide.gain, 1);
  assert.ok(tall.gain > 1.3, `vertical gain was ${tall.gain}`);
  // Ink grows, but less than type: doubling stroke weight muddies detail.
  assert.ok(tall.strokeWidth / tall.scale > wide.strokeWidth / wide.scale);
  assert.ok(tall.type.caption / tall.scale > wide.type.caption / wide.scale);
});
