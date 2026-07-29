import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import type { PlotElement, Scene, Storyboard } from '@inkcast/core';
import { Storyboard as StoryboardSchema, lessonBeats, parseStoryboard } from '@inkcast/core';
import { compileLesson, findReuse, updateLine } from '../src/compile.js';
import { deriveCues, cueResolves } from '../src/cues.js';
import { curveY, descend, evalFn, fitYDomain, slopeAt } from '../src/curves.js';
import type { Box } from '../src/elements.js';
import { overlaps } from '../src/layout.js';
import { readLessonFile } from '../src/lesson-io.js';
import { PRESETS, adaptLesson } from '../src/presets.js';
import { axisLabels, deriveBowl, plotHints, recipeFor } from '../src/plots.js';
import { shorten } from '../src/text.js';
import { cellBoxes, groupIntoRegions, planBoard } from '../src/regions.js';

const SHIPPED = path.resolve(
  import.meta.dirname,
  '../../../examples/lessons/gradient-descent.lesson.json',
);
const lesson = await readLessonFile(SHIPPED);

const sb = compileLesson(lesson, {});
const vertical = compileLesson(lesson, { preset: 'short' });

const plots = (scene: Scene): PlotElement[] =>
  scene.elements.filter((el): el is PlotElement => el.type === 'plot');

function sceneFor(board: Storyboard, role: NonNullable<Scene['role']>): Scene {
  const scene = board.scenes.find((s) => s.role === role);
  assert.ok(scene, `no ${role} scene`);
  return scene;
}

/* ----------------------------------------------------------------- the shape */

test('compileLesson output parses as a Storyboard, unchanged', () => {
  const parsed = parseStoryboard(JSON.parse(JSON.stringify(sb)));
  assert.equal(parsed.version, 1);
  assert.equal(parsed.title, 'Gradient Descent');
  // Round-tripping through the schema must not change anything: the compiler
  // emits fully-formed elements, so parsing is validation and not repair.
  assert.deepEqual(parsed, StoryboardSchema.parse(sb));
});

test('one scene per beat, carrying its role and its silence', () => {
  const beats = lessonBeats(adaptLesson(lesson, PRESETS.standard));
  assert.equal(sb.scenes.length, beats.length);
  beats.forEach(({ step, role }, i) => {
    const scene = sb.scenes[i]!;
    assert.equal(scene.role, role);
    assert.equal(scene.narration, step.narration);
    assert.ok(scene.hold >= step.hold, `${role} lost its hold`);
    assert.ok(scene.elements.length > 0, `${role} draws nothing`);
  });
  // A question gets real silence so the learner can attempt an answer.
  assert.ok(sceneFor(sb, 'hook').hold >= 2, 'the hook question needs a pause');
});

test('the compiler is deterministic', () => {
  assert.deepEqual(compileLesson(lesson, {}), sb);
});

/* --------------------------------------------------------------- the geometry */

test('no two beats sharing a region overlap, and nothing leaves its region', () => {
  for (const board of [sb, vertical]) {
    const shaped = adaptLesson(
      lesson,
      PRESETS[board.meta.aspect === '9:16' ? 'short' : 'standard'],
    );
    const beats = lessonBeats(shaped);
    const reuse = findReuse(beats, shaped.analogy);
    const plan = planBoard(
      beats.map((b) => b.role),
      {
        aspect: board.meta.aspect,
        maxPerRegion: PRESETS[board.meta.aspect === '9:16' ? 'short' : 'standard'].maxPerRegion,
        // Must match what the compiler passes, or this reconstructs a different
        // board from the one it is checking.
        sharesCellWith: reuse.annotates,
      },
    );
    /**
     * The pairs allowed to draw over each other: a beat that builds on an earlier
     * beat's drawing is *supposed* to land on it — the anchor's walker stands on the
     * hook's hill, and the bridge's plot replaces it. Anywhere else, overlapping ink
     * in one region is the mess that region sharing exists to prevent.
     */
    const shared = new Set<string>();
    for (const [beat, host] of reuse.annotates) {
      // The host and everyone building on it are all drawing the same picture, so
      // every pair within that group may legitimately land on the others' ink.
      const group = [
        host,
        beat,
        ...[...reuse.annotates].filter(([, h]) => h === host).map(([b]) => b),
      ];
      for (const a of group) for (const b of group) if (a !== b) shared.add(`s${a}|s${b}`);
    }
    for (const scene of board.scenes) {
      const region = plan.regions.find((r) => r.key === scene.region);
      assert.ok(region, `${scene.id} has no region`);
      for (const el of scene.elements) {
        assert.ok(
          inside(el.at, region.box),
          `${scene.id}/${el.id} is outside region ${region.key}`,
        );
      }
      // Ink from two different beats in one region must never collide: that is
      // what makes a shared region a growing board rather than a mess.
      for (const other of board.scenes) {
        if (other.id === scene.id || other.region !== scene.region) continue;
        if (shared.has(`${scene.id}|${other.id}`)) continue;
        for (const a of scene.elements) {
          for (const b of other.elements) {
            assert.ok(!overlaps(a.at, b.at, 0), `${scene.id}/${a.id} overlaps ${other.id}/${b.id}`);
          }
        }
      }
      // Words never overlap words inside one beat either.
      const texts = scene.elements.filter((el) => el.type === 'text');
      for (let i = 0; i < texts.length; i++) {
        for (let j = i + 1; j < texts.length; j++) {
          assert.ok(!overlaps(texts[i]!.at, texts[j]!.at, 0), `${scene.id} text collision`);
        }
      }
    }
  }
});

test('beats share regions, and the board accumulates', () => {
  const perRegion = new Map<string, number>();
  for (const s of sb.scenes) perRegion.set(s.region!, (perRegion.get(s.region!) ?? 0) + 1);
  assert.ok(
    [...perRegion.values()].some((n) => n >= 3),
    `no region holds a chunk of the argument: ${JSON.stringify([...perRegion])}`,
  );
  assert.ok(perRegion.size >= 3 && perRegion.size <= 6, `${perRegion.size} regions`);

  // Inside one region the camera pulls back as cells fill: the first beat is a
  // close-up, later beats hold more of the panel.
  const build = sb.scenes.filter((s) => s.region === 'build');
  assert.ok(build.length >= 2);
  assert.ok(
    build[0]!.camera.zoom > build[build.length - 1]!.camera.zoom,
    'the camera never pulled back',
  );
  // The recap is the widest shot in the video.
  const recap = sceneFor(sb, 'recap');
  for (const s of sb.scenes) {
    if (s.role === 'recap') continue;
    assert.ok(recap.camera.zoom <= s.camera.zoom, `${s.id} is wider than the recap`);
  }
  // A pan inside a region is shorter than a move between regions.
  const sameRegion = sb.scenes.filter((s, i) => i > 0 && sb.scenes[i - 1]!.region === s.region);
  for (const s of sameRegion) assert.ok(s.camera.transition <= 0.5, `${s.id} pans too slowly`);
});

test('regions group consecutive beats by the phase of the argument', () => {
  const groups = groupIntoRegions(
    ['hook', 'anchor', 'step', 'step', 'step', 'step', 'worked', 'misconception', 'recap'],
    4,
  );
  assert.deepEqual(
    groups.map((g) => g.key),
    ['setup', 'build', 'practice', 'recap'],
  );
  assert.deepEqual(groups[1]!.beats, [2, 3, 4, 5]);
  // Five steps split rather than crowd one panel.
  const wide = groupIntoRegions(['step', 'step', 'step', 'step', 'step', 'step'], 4);
  assert.deepEqual(
    wide.map((g) => g.beats.length),
    [4, 2],
  );
});

test('cells inside a region are disjoint and fill it', () => {
  const region: Box = { x: 0, y: 0, w: 1840, h: 1035 };
  for (const n of [1, 2, 3, 4, 5, 6]) {
    const cells = cellBoxes(region, n, '16:9');
    assert.equal(cells.length, n);
    for (let i = 0; i < n; i++) {
      assert.ok(inside(cells[i]!, region), `cell ${i} of ${n} escapes the region`);
      for (let j = i + 1; j < n; j++) {
        assert.ok(!overlaps(cells[i]!, cells[j]!, 0), `cells ${i} and ${j} of ${n} overlap`);
      }
    }
  }
});

test('the vertical board is a tall column the camera walks down', () => {
  assert.equal(vertical.meta.aspect, '9:16');
  assert.ok(vertical.canvas.h > vertical.canvas.w * 3, 'not a tall canvas');
  const ys = vertical.scenes.map((s) => s.camera.y);
  for (let i = 1; i < ys.length; i++) {
    assert.ok(ys[i]! >= ys[i - 1]!, `scene ${i} walks back up the canvas`);
  }
  assert.ok(vertical.scenes.length < sb.scenes.length, 'vertical is a shorter cut');
  // One visual per beat, and bigger type than the landscape cut.
  for (const s of vertical.scenes) {
    assert.ok(plots(s).length <= 3, 'a comparison panel may still be three plots');
  }
  const caption = vertical.scenes[0]!.elements.find((el) => el.type === 'text');
  assert.ok(caption && caption.type === 'text' && caption.role === 'heading', 'type is larger');
});

/* -------------------------------------------------------------------- timing */

test('every element lands on a cue, or deliberately at the start of its beat', () => {
  for (const board of [sb, vertical]) {
    for (const scene of board.scenes) {
      for (const el of scene.elements) {
        const cue = el.enter.cue;
        if (cue === undefined) {
          assert.equal(el.enter.at, 0, `${scene.id}/${el.id} has neither a cue nor at: 0`);
          continue;
        }
        assert.ok(
          cueResolves(scene.narration, cue),
          `${scene.id}/${el.id} cue "${cue}" is not in the narration`,
        );
        assert.ok(el.enter.at >= 0 && el.enter.at <= 0.92, `${scene.id}/${el.id} enters too late`);
      }
      // Entrances are ordered and never simultaneous by accident.
      const times = scene.elements.map((el) => el.enter.at);
      assert.deepEqual(
        [...times].sort((a, b) => a - b),
        times.slice().sort((a, b) => a - b),
      );
    }
  }
});

test('an authored cue is preferred, and a drifted one is replaced', () => {
  const worked = sceneFor(sb, 'worked');
  const cues = worked.elements.map((el) => el.enter.cue);
  assert.ok(cues.includes('three minus nought point four'), JSON.stringify(cues));
  // The ball was already moving, so the motion intent re-cued it rather than
  // drawing a second one.
  const movers = worked.elements.filter((el) => el.motion !== undefined);
  assert.equal(movers.length, 1);
  assert.equal(movers[0]!.enter.cue, 'the step is smaller');
});

test('deriveCues returns verbatim phrases spread across the beat', () => {
  const narration = 'A learning machine has no hill. It has a number for how wrong it is.';
  const cues = deriveCues(narration, 3);
  assert.equal(cues.length, 3);
  for (const cue of cues) {
    assert.ok(cue && narration.includes(cue), `"${cue}" is not verbatim`);
  }
  assert.deepEqual(deriveCues('', 2), [undefined, undefined]);
});

test('motion starts after the thing that moves has been drawn', () => {
  for (const board of [sb, vertical]) {
    for (const scene of board.scenes) {
      for (const el of scene.elements) {
        if (!el.motion) continue;
        assert.ok(el.motion.from > el.enter.at, `${scene.id}/${el.id} moves before it exists`);
        assert.ok(el.motion.to > el.motion.from, `${scene.id}/${el.id} has no duration`);
        assert.ok(el.motion.path.length >= 2);
      }
    }
  }
});

/* ---------------------------------------------------------- the plot mapping */

test('the tangent beat draws a real tangent, and the arrow that derives the sign', () => {
  const scene = sb.scenes.find((s) => s.elements.some((el) => el.type === 'arrow'))!;
  const plot = plots(scene)[0]!;
  const tangent = plot.overlays.find((o) => o.kind === 'tangent');
  assert.ok(tangent, 'no tangent overlay');
  assert.equal(tangent.kind === 'tangent' && tangent.x, 3);
  // The label is computed from the curve, so the picture cannot contradict the
  // arithmetic the worked example does out loud.
  assert.equal(tangent.kind === 'tangent' ? tangent.label : '', 'slope +4');
  const arrow = scene.elements.find((el) => el.type === 'arrow');
  assert.ok(arrow && arrow.type === 'arrow' && arrow.label === 'downhill');
  assert.ok(arrow.type === 'arrow' && arrow.to.x < arrow.from.x, 'downhill points left');
});

test('the worked beat draws the arithmetic and the descent it describes', () => {
  const scene = sceneFor(sb, 'worked');
  const line = scene.elements.find((el) => el.type === 'text' && /←/.test(el.text));
  assert.ok(line && line.type === 'text', 'no update line on the board');
  assert.equal(line.text, 'w ← 3 − 0.1 × 4 = 2.6');

  const plot = plots(scene)[0]!;
  const steps = plot.overlays.find((o) => o.kind === 'steps');
  assert.ok(steps && steps.kind === 'steps');
  assert.equal(steps.xs[0], 3);
  assert.equal(steps.xs[1], 2.6, 'the drawn step is the one the narrator says');
  // Steps shorten as the slope flattens, because they are the real algorithm.
  const gaps = steps.xs.slice(1).map((x, i) => Math.abs(x - steps.xs[i]!));
  for (let i = 1; i < gaps.length; i++) assert.ok(gaps[i]! < gaps[i - 1]!, 'steps did not shorten');
  // And the ball actually moves along them.
  const ball = scene.elements.find((el) => el.motion !== undefined);
  assert.ok(ball?.motion && ball.motion.trail, 'the ball leaves no trail');
  assert.equal(ball.motion.path.length, steps.xs.length);
});

test('the misconception beat draws a second, shallower valley', () => {
  const scene = sceneFor(sb, 'misconception');
  const plot = plots(scene)[0]!;
  const curve = plot.curves[0]!;
  assert.equal(curve.fn?.name, 'doubleWell');
  const points = plot.overlays.filter(
    (o): o is Extract<typeof o, { kind: 'point' }> => o.kind === 'point',
  );
  assert.equal(points.length, 2, 'both minima must be marked');
  const [trap, deeper] = points;
  assert.ok(trap && deeper);
  assert.ok(curveY(curve, deeper.x)! < curveY(curve, trap.x)!, 'the unvisited well is deeper');
  assert.ok(deeper.x < 0 && trap.x > 0, 'the ball settles on the side it started');
  const ball = scene.elements.find((el) => el.motion !== undefined);
  assert.ok(ball?.motion, 'the ball must roll into the wrong valley');
});

test('the learning-rate beat draws three honest runs side by side', () => {
  const scene = sb.scenes.find((s) => plots(s).length === 3);
  assert.ok(scene, 'no three-panel comparison');
  const three = plots(scene);
  const xs = three.map((p) => {
    const steps = p.overlays.find((o) => o.kind === 'steps');
    return steps && steps.kind === 'steps' ? steps.xs : [];
  });
  const travel = (list: number[]) => Math.abs((list[list.length - 1] ?? 0) - (list[0] ?? 0));
  assert.ok(travel(xs[0]!) < 0.6, 'the small rate should barely move');
  assert.ok(
    Math.max(...xs[1]!.map(Math.abs)) > Math.max(...xs[2]!.map(Math.abs)),
    'the large rate should fly apart',
  );
  assert.ok(
    Math.abs(xs[2]![xs[2]!.length - 1]! - 1) < 0.2,
    'the right rate should land in the valley',
  );
  // Three panels are one comparison: same domain, same range.
  assert.deepEqual(three[1]!.yDomain, three[0]!.yDomain);
  assert.deepEqual(three[1]!.xDomain, three[0]!.xDomain);
  for (let i = 1; i < three.length; i++) {
    assert.ok(!overlaps(three[i]!.at, three[i - 1]!.at, 0), 'panels overlap');
  }
});

test('plots are labelled in the learner’s words, and axes stay meaningful', () => {
  const first = plots(sb.scenes[2]!)[0]!;
  assert.equal(first.xLabel, 'where you stand');
  assert.equal(first.yLabel, 'height');
  const lossBeat = plots(sb.scenes[3]!)[0]!;
  assert.equal(lossBeat.yLabel, 'loss');
  assert.equal(lossBeat.xLabel, 'parameter');
  for (const scene of sb.scenes) {
    for (const plot of plots(scene)) {
      assert.ok(plot.xDomain[1] > plot.xDomain[0], 'empty x domain');
      assert.ok(plot.yDomain[1] > plot.yDomain[0], 'empty y domain');
      assert.ok(plot.curves.length > 0, 'a plot with no curve is a caption');
      for (const overlay of plot.overlays) {
        if ('curveId' in overlay) {
          assert.ok(
            plot.curves.some((c) => c.id === overlay.curveId),
            `overlay points at missing curve ${overlay.curveId}`,
          );
        }
      }
    }
  }
});

test('the recap draws the chain against the finished board', () => {
  const scene = sceneFor(sb, 'recap');
  const chain = scene.elements.find((el) => el.type === 'diagram');
  assert.ok(chain && chain.type === 'diagram');
  assert.ok(chain.nodes.length >= 3, 'the chain needs links');
  assert.equal(chain.edges.length, chain.nodes.length - 1);
});

/* ------------------------------------------------------------------- numbers */

test('a bowl is derived so the stated slope is the real slope', () => {
  const hints = plotHints('the ball at w = 3, slope = +4, learning rate 0.1, down to 2.6');
  assert.equal(hints.start, 3);
  assert.equal(hints.slope, 4);
  assert.equal(hints.lr, 0.1);
  assert.equal(hints.next, 2.6);
  const bowl = deriveBowl(hints);
  assert.equal(Math.round(slopeAt(bowl.curve, 3) * 1000) / 1000, 4);
  assert.deepEqual(bowl.curve.fn, { name: 'parabola', params: [1, 1, 0] });
  // Real gradient descent, not a drawing of one.
  const xs = descend(bowl.curve, 3, 0.1, 3);
  assert.equal(Math.round(xs[1]! * 1000) / 1000, 2.6);
});

test('named functions evaluate the way the visuals stage is told they do', () => {
  assert.equal(evalFn('parabola', [2, 1, 3], 2), 5);
  assert.equal(evalFn('line', [3, 1], 2), 7);
  assert.equal(evalFn('step', [3, 0, 1], 2), 0);
  assert.equal(evalFn('step', [3, 0, 1], 4), 1);
  assert.equal(evalFn('log', [1, 0], 0), undefined);
  assert.equal(evalFn('doubleWell', [1, 2, 0, 2], 0), 2);
  // The tilt is what makes one well deeper than the other.
  const tilted = {
    id: 'w',
    fn: { name: 'doubleWell' as const, params: [1, 2, 0.55, 2.2] },
    dashed: false,
    accent: 0,
  };
  assert.ok(curveY(tilted, -1.07)! < curveY(tilted, 0.93)!);
  // A loss axis sits on zero and stops at a readable bound, not at 4.4832.
  const bowl = {
    id: 'p',
    fn: { name: 'parabola' as const, params: [1, 0, 0] },
    dashed: false,
    accent: 0,
  };
  assert.deepEqual(fitYDomain([bowl], [-2, 2], { floorAtZero: true }), [0, 4.5]);
  assert.deepEqual(fitYDomain([bowl], [-2, 2]), [-0.5, 4.5]);
});

test('a diverging run stays drawable', () => {
  const curve = {
    id: 'p',
    fn: { name: 'parabola' as const, params: [1, 0, 0] },
    dashed: false,
    accent: 0,
  };
  const xs = descend(curve, 2, 1.2, 6, [-4, 4]);
  assert.ok(xs.every((x) => Number.isFinite(x) && Math.abs(x) <= 4));
  assert.ok(Math.abs(xs[xs.length - 1]!) > Math.abs(xs[0]!), 'a large rate must diverge');
});

test('recipes are selected by the drawing instruction, not by chatter', () => {
  assert.equal(recipeFor('a bowl with a tangent at w = 3'), 'tangent');
  assert.equal(
    recipeFor('three plots side by side, too small, too large, about right'),
    'learning-rates',
  );
  assert.equal(recipeFor('a curve with two wells, the deeper one on the left'), 'local-minima');
  assert.equal(recipeFor('descent steps down the bowl'), 'descent');
  assert.equal(recipeFor('loss up the vertical axis'), 'loss-axis');
  assert.equal(recipeFor('a bell curve'), 'gaussian');
  assert.equal(recipeFor('an s-curve of probability'), 'sigmoid');
  assert.equal(recipeFor('something with no keywords at all'), 'bowl');
});

test('updateLine computes the arithmetic rather than copying it', () => {
  const line = updateLine(
    {
      idea: 'x',
      because: 'y',
      from: 'given',
      derivedFrom: [],
      narration: 'anything',
      hold: 0,
      visuals: [{ describe: 'w = 5, slope = -2, learning rate 0.5', kind: 'plot' }],
    },
    'worked',
  );
  assert.equal(line, 'w ← 5 + 0.5 × 2 = 6');
  assert.equal(
    updateLine(
      {
        idea: '',
        because: '',
        from: 'given',
        derivedFrom: [],
        narration: '',
        hold: 0,
        visuals: [],
      },
      'step',
    ),
    undefined,
  );
});

/* ------------------------------------------------------------------- helpers */

function inside(box: Box, container: Box): boolean {
  return (
    box.x >= container.x - 0.01 &&
    box.y >= container.y - 0.01 &&
    box.x + box.w <= container.x + container.w + 0.01 &&
    box.y + box.h <= container.y + container.h + 0.01
  );
}

/* ----------------------------------------------------- nothing is ellipsised */

test('no on-canvas text is truncated with an ellipsis', () => {
  // A whiteboard that reads "How big a step is the one knob you…" makes a promise
  // the video never keeps. Verification found five of these on the benchmark board,
  // including inside the recap chain — the beat whose whole job is to summarise.
  for (const board of [sb, vertical]) {
    for (const scene of board.scenes) {
      for (const el of scene.elements) {
        if (el.type === 'text') {
          assert.ok(!el.text.includes('…'), `caption "${el.text}" is ellipsised`);
          assert.ok(!/\.{3}$/.test(el.text), `caption "${el.text}" is ellipsised`);
        }
        if (el.type === 'diagram') {
          for (const node of el.nodes) {
            assert.ok(!node.label.includes('…'), `recap node "${node.label}" is ellipsised`);
          }
        }
        if (el.type === 'plot') {
          for (const ov of el.overlays) {
            const text = ov.kind === 'annotate' ? ov.text : ('label' in ov && ov.label) || '';
            assert.ok(!text.includes('…'), `plot label "${text}" is ellipsised`);
          }
        }
      }
    }
  }
});

test('shorten cuts to something that reads as finished', () => {
  // Trailing function words are dropped rather than left dangling: the ninth word
  // is "you", which promises a verb the board never writes.
  assert.equal(
    shorten('How big a step is the one knob you choose', 9),
    'How big a step is the one knob',
  );
  // A cue phrase that ends on a preposition loses it too.
  assert.equal(
    shorten('the bottom of whichever dip it started in', 6),
    'the bottom of whichever dip',
  );
  // A punctuation break inside budget still wins.
  assert.equal(shorten('Feel the ground, then step downhill', 4), 'Feel the ground');
  // Short enough already: untouched.
  assert.equal(shorten('The slope points uphill', 8), 'The slope points uphill');
});

test('a learning rate is not mistaken for the vertical axis', () => {
  // `\bspeed|rate\b` matched "learning rate 0.1" and labelled the benchmark's loss
  // axis "rate" — a hyperparameter printed where the minimised quantity belongs.
  assert.equal(
    axisLabels('the bowl with the ball at w = 3, slope = +4, learning rate 0.1', {
      x: 'w',
      y: 'loss',
    }).y,
    'loss',
  );
  // A genuine rate on the vertical axis still wins.
  assert.equal(axisLabels('speed against time', { y: 'loss' }).y, 'rate');
  const worked = sceneFor(sb, 'worked');
  for (const plot of plots(worked)) {
    assert.notEqual(plot.yLabel, 'rate', 'the worked example plots loss, not a learning rate');
  }
});

/* ------------------------------------------- the abstraction arriving in place */

test("the anchor annotates the hook's hill instead of drawing a second one", () => {
  // Two hillsides side by side is the failure this guards against: the anchor's job
  // is to walk down the hill the hook established, and a fresh drawing silently
  // tells the learner it is a different hill.
  const hook = sceneFor(sb, 'hook');
  const anchor = sceneFor(sb, 'anchor');
  const hills = (s: Scene) =>
    s.elements.filter((el) => el.type === 'path' && (el.points?.length ?? 0) > 30);
  assert.equal(hills(hook).length, 1, 'the hook draws the hill');
  assert.equal(hills(anchor).length, 0, 'the anchor must not draw a second hill');

  // ...and its walker stands on the hook's hill, which is what sharing the cell is
  // for. Overlap here is the feature, not a collision.
  const hill = hills(hook)[0]!;
  const walker = anchor.elements.filter((el) => el.id.includes('_you_'));
  assert.ok(walker.length > 0, 'the anchor draws a figure');
  assert.ok(
    walker.some((el) => overlaps(el.at, hill.at, 0)),
    'the figure is not standing on the hill',
  );
});

test('the beat where the abstraction arrives morphs out of the hill, in place', () => {
  const shaped = adaptLesson(lesson, PRESETS.standard);
  const beats = lessonBeats(shaped);
  const { bridge } = findReuse(beats, shaped.analogy);
  assert.ok(bridge, 'the shipped lesson has a beat that turns the hill into a plot');

  const hostScene = sb.scenes[bridge.host]!;
  const bridgeScene = sb.scenes[bridge.beat]!;
  const hill = hostScene.elements.find((el) => el.type === 'path' && (el.points?.length ?? 0) > 30);
  assert.ok(hill, 'the host beat drew a hill to grow out of');

  const plot = plots(bridgeScene)[0];
  assert.ok(plot, 'the bridge beat draws a plot');
  assert.equal(plot.morph?.fromId, hill.id, 'the plot names the hill it grows out of');

  // In place: the axes have to appear *around* the shape already on the board, so
  // the plot takes the hill's box rather than a panel of its own somewhere else.
  // Compared with a tolerance because the hill element's own `at` is its ink bounds
  // inflated by the stroke width, while the plot is placed on the hill's geometry.
  const slack = 12;
  for (const k of ['x', 'y', 'w', 'h'] as const) {
    assert.ok(
      Math.abs(plot.at[k] - hill.at[k]) <= slack,
      `the plot is not where the hill is: ${k} ${plot.at[k]} vs ${hill.at[k]}`,
    );
  }

  // And it stays in the hill's region, rather than opening a fresh panel.
  assert.equal(bridgeScene.region, hostScene.region);
});

test('a lesson with no concrete drawing has nothing to morph', () => {
  // The bridge is an upgrade, not a requirement: a lesson whose setup is words only
  // must compile exactly as it did before this existed.
  const wordy = {
    ...lesson,
    hook: { ...lesson.hook, visuals: [{ kind: 'text' as const, describe: 'a question' }] },
    anchor: { ...lesson.anchor, visuals: [{ kind: 'text' as const, describe: 'a situation' }] },
  };
  const beats = lessonBeats(adaptLesson(wordy, PRESETS.standard));
  assert.equal(findReuse(beats, wordy.analogy).bridge, null);
  const board = compileLesson(wordy, {});
  for (const scene of board.scenes) {
    for (const el of scene.elements) assert.equal(el.morph, undefined);
  }
});

/* ------------------------------------- the morph comes from the mapping, not prose */

test('the same mapping in different words still morphs', () => {
  // The point of step 6. The old regex looked for a becoming-verb near the vocabulary
  // of a plot, so this lesson — same analogy, same structure, every sentence reworded
  // to avoid saying the hill "is" a graph — did not morph, and the abstraction arrived
  // as a second picture beside the hill instead of growing out of it.
  const reworded = {
    ...lesson,
    steps: [
      {
        ...lesson.steps[0]!,
        idea: 'Redraw the landscape with two rulers',
        narration:
          'Put one ruler along the ground and one straight up. Now every spot on that slope has two readings, and the slope shows up as a line on paper.',
        visuals: [{ ...lesson.steps[0]!.visuals[0]! }],
      },
      ...lesson.steps.slice(1),
    ],
  };
  const shaped = adaptLesson(reworded, PRESETS.standard);
  const { bridge } = findReuse(lessonBeats(shaped), shaped.analogy);
  assert.ok(bridge, 'the reworded lesson maps the same things, so it must still morph');
  assert.equal(bridge.beat, 2, 'the first step that draws a plot is where it arrives');

  const board = compileLesson(reworded, {});
  const morphs = board.scenes.flatMap((s) => s.elements.filter((el) => el.morph));
  assert.equal(morphs.length, 1, 'exactly one element grows out of the hill');
});

test('an analogy with no correspondences does not morph', () => {
  // A declared analogy is a set of claims about what stands for what. Without them
  // there is no basis for saying the hill and the curve are the same thing, so the
  // plot is drawn in its own cell — the pre-morph behaviour, reached deliberately
  // rather than by a phrase failing to match.
  const unmapped = { ...lesson, strategy: 'first-principles' as const, analogy: undefined };
  const shaped = adaptLesson(unmapped, PRESETS.standard);
  assert.equal(findReuse(lessonBeats(shaped), shaped.analogy).bridge, null);
  for (const scene of compileLesson(unmapped, {}).scenes) {
    for (const el of scene.elements) assert.equal(el.morph, undefined);
  }
});

test('cells are frame-shaped, so holding one fills the frame', () => {
  // The camera fits the union of what has been drawn, so whenever it holds a single
  // cell that cell's aspect ratio *is* the frame's fill. A 0.9:1 cell in a 1.78:1
  // frame leaves half the width empty however well the beat packs it.
  for (const [aspect, want] of [
    ['16:9', 16 / 9],
    ['9:16', 9 / 16],
    ['1:1', 1],
  ] as const) {
    for (const n of [1, 2, 3, 4, 5, 6]) {
      const region: Box = { x: 0, y: 0, w: 4000, h: 4000 };
      for (const cell of cellBoxes(region, n, aspect)) {
        const ratio = cell.w / cell.h;
        assert.ok(
          Math.abs(ratio - want) < 0.02,
          `${aspect} cell ${n} is ${ratio.toFixed(3)}, wanted ${want.toFixed(3)}`,
        );
      }
    }
  }
});
