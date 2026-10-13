/**
 * The determinism suite. This is the test that matters most: if `seek(t)` is not
 * a pure function of `t`, frames captured out of order by four concurrent workers
 * will not agree, and the video flickers.
 *
 * Skipped with a clear message when Playwright's Chromium is not installed.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Browser } from 'playwright';
import { parseStoryboard } from '@inkcast/core';
import {
  chromiumAvailable,
  launchChromium,
  openCapture,
  openStagePage,
  seekPage,
  snapshotPage,
} from './browser.js';
import { realizedTextViolations } from './boardcheck.js';
import { compilePlan } from './compile.js';
import { fixtureStoryboard, lessonStoryboard, planWithVisuals, wipeStoryboard } from './fixture.js';
import { buildPageHtml, buildPreviewHtml } from './html.js';

const SKIP = chromiumAvailable()
  ? false
  : 'Playwright chromium is not installed — run `pnpm exec playwright install chromium`';

const DIR = '/tmp/inkcast-page-test';
const sb = fixtureStoryboard();
const plan = await planWithVisuals(sb, { grid: true });
const html = buildPageHtml(plan, { mode: 'capture', fontCss: '', title: 'determinism' });

/** The lesson-engine board: regions, holds, a plot, a path and a rolling ball. */
const lesson = lessonStoryboard();
const lessonPlan = await planWithVisuals(lesson, { grid: true });
const lessonHtml = buildPageHtml(lessonPlan, {
  mode: 'capture',
  fontCss: '',
  title: 'lesson determinism',
});

/** The same board wiping: one card at a time, and ink that goes out with the words. */
const wiped = wipeStoryboard();
const wipedPlan = await planWithVisuals(wiped, { grid: true });
const wipedDoc = {
  frame: wipedPlan.frame,
  html: buildPageHtml(wipedPlan, { mode: 'capture', fontCss: '', title: 'wipe' }),
};

async function withPage<T>(
  browser: Browser,
  fn: (page: Awaited<ReturnType<typeof openStagePage>>['page']) => Promise<T>,
  doc: { frame: { w: number; h: number }; html: string } = { frame: plan.frame, html },
): Promise<T> {
  const { page, context } = await openStagePage(browser, doc.frame, doc.html);
  try {
    return await fn(page);
  } finally {
    await context.close();
  }
}

function attr(
  page: Awaited<ReturnType<typeof openStagePage>>['page'],
  selector: string,
  name: string,
): Promise<string | null> {
  return page.evaluate(
    ({ selector: s, name: n }: { selector: string; name: string }) => {
      const el = document.querySelector(s);
      return el ? el.getAttribute(n) : null;
    },
    { selector, name },
  );
}

test('seek(t) is a pure function of t', { skip: SKIP }, async () => {
  const browser = await launchChromium();
  try {
    await withPage(browser, async (page) => {
      await seekPage(page, 0.62);
      const first = await snapshotPage(page);
      const again = await snapshotPage(page);
      assert.equal(first, again, 'snapshotting twice must not change anything');

      // Wander all over the timeline, including the ends, then come back.
      for (const t of [1.4, 0.1, 1.99, 0, 2.4, 0.9]) await seekPage(page, t);
      await seekPage(page, 0.62);
      assert.equal(await snapshotPage(page), first, 'state at t=0.62 must be reproducible');

      await seekPage(page, 0.63);
      assert.notEqual(await snapshotPage(page), first, 'a different t must look different');
    });
  } finally {
    await browser.close();
  }
});

test('the same frame renders to identical pixels, in any context', { skip: SKIP }, async () => {
  const browser = await launchChromium();
  try {
    const shoot = async (
      page: Awaited<ReturnType<typeof openStagePage>>['page'],
      t: number,
    ): Promise<Buffer> => {
      await seekPage(page, t);
      return page.screenshot({ type: 'png' });
    };

    const a = await withPage(browser, async (page) => {
      const one = await shoot(page, 1.05);
      await shoot(page, 0.2);
      const two = await shoot(page, 1.05);
      assert.ok(one.equals(two), 'same page, same t, after seeking away');
      return one;
    });

    // A second context is exactly what a second capture worker is.
    const b = await withPage(browser, (page) => shoot(page, 1.05));
    assert.ok(a.equals(b), 'a different browser context must produce the same frame');
    assert.ok(a.byteLength > 20_000, 'the frame should contain real ink');
  } finally {
    await browser.close();
  }
});

test('the camera eases between scenes instead of cutting', { skip: SKIP }, async () => {
  const browser = await launchChromium();
  try {
    await withPage(browser, async (page) => {
      const view = async (t: number): Promise<number[]> => {
        await seekPage(page, t);
        const vb = await attr(page, '#inkcast-board', 'viewBox');
        assert.ok(vb);
        return vb.split(' ').map(Number);
      };
      const s2 = plan.scenes[1];
      assert.ok(s2);
      const start = await view(s2.start);
      const mid = await view(s2.start + s2.camera.transition / 2);
      const end = await view(s2.start + s2.camera.transition + 0.01);
      const settled = await view(s2.start + s2.camera.transition + 0.2);

      const cx = (v: number[]): number => (v[0] ?? 0) + (v[2] ?? 0) / 2;
      assert.ok(cx(start) < cx(mid) && cx(mid) < cx(end), 'the camera pans across');
      assert.deepEqual(end, settled, 'and then holds the scene camera');
      assert.ok(Math.abs(cx(settled) - s2.camera.x) < 1, 'landing on the authored centre');
      // Zoom 1.8 on a 2400-wide canvas: the visible width shrinks accordingly.
      assert.ok((settled[2] ?? 0) < (start[2] ?? 0));
    });
  } finally {
    await browser.close();
  }
});

test(
  'the pen rides the active stroke and lifts when nothing is drawing',
  { skip: SKIP },
  async () => {
    const browser = await launchChromium();
    try {
      await withPage(browser, async (page) => {
        const penAt = async (
          t: number,
        ): Promise<{ opacity: string | null; transform: string | null }> => {
          await seekPage(page, t);
          return {
            opacity: await attr(page, '#inkcast-pen', 'opacity'),
            transform: await attr(page, '#inkcast-pen', 'transform'),
          };
        };
        // Part-way through the title being written, clear of the 0.1s lift-in.
        const writing = await penAt(0.1);
        assert.ok(Number(writing.opacity) > 0.5, 'pen is down while writing');
        assert.match(String(writing.transform), /^translate\([-\d.]+,[-\d.]+\) rotate/);

        const later = await penAt(0.15);
        assert.notEqual(later.transform, writing.transform, 'the nib travels with the ink');

        // The outro: everything is drawn, nothing is animating.
        const idle = await penAt(plan.duration);
        assert.equal(Number(idle.opacity), 0, 'pen lifts off the board');
      });
    } finally {
      await browser.close();
    }
  },
);

test('the board persists, and persist:false fades with its scene', { skip: SKIP }, async () => {
  const browser = await launchChromium();
  try {
    await withPage(browser, async (page) => {
      const opacity = async (id: string): Promise<number> =>
        Number(await attr(page, `[data-id="${id}"]`, 'opacity'));

      await seekPage(page, plan.duration);
      assert.equal(await opacity('title'), 1, 'scene 1 title is still on the board at the end');
      assert.equal(await opacity('flow'), 1, 'so is the diagram');
      assert.equal(await opacity('note'), 0, 'the non-persistent note has faded out');

      // ...and it was visible during its own scene.
      await seekPage(page, 1.2);
      assert.ok((await opacity('note')) > 0.9);
    });
  } finally {
    await browser.close();
  }
});

test('text is wrapped, measured, and revealed word by word', { skip: SKIP }, async () => {
  const browser = await launchChromium();
  try {
    await withPage(browser, async (page) => {
      const lines = await page.evaluate(
        () => document.querySelectorAll('[data-id="note"] text').length,
      );
      assert.ok(lines >= 2, `long body copy should wrap onto several lines, got ${lines}`);

      const widths = async (t: number): Promise<number[]> => {
        await seekPage(page, t);
        return page.evaluate(() =>
          [...document.querySelectorAll('clipPath rect')].map((r) =>
            Number(r.getAttribute('width') ?? 0),
          ),
        );
      };
      const early = await widths(0.05);
      const late = await widths(0.44);
      const sum = (v: number[]): number => v.reduce((a, b) => a + b, 0);
      assert.ok(sum(early) < sum(late), 'the reveal advances with time');
      assert.ok(sum(early) >= 0);
    });
  } finally {
    await browser.close();
  }
});

/* ------------------------------------------------ the lesson vocabulary */

const lessonDoc = { frame: lessonPlan.frame, html: lessonHtml };

test(
  'seek(t) stays pure with motion, trails, sweeps and plots on the board',
  { skip: SKIP },
  async () => {
    const browser = await launchChromium();
    try {
      await withPage(
        browser,
        async (page) => {
          const at = async (t: number): Promise<string> => {
            await seekPage(page, t);
            return snapshotPage(page);
          };
          // Mid-roll of the ball, mid-sweep of the tangent, and mid-recap.
          const marks = [2.0, 5.05, 6.5];
          const first = await Promise.all(marks.map(at));
          // Wander everywhere, forwards and backwards, then come back.
          for (const t of [0, 7.9, 3.3, 1.1, 5.9, 0.4, 6.9]) await seekPage(page, t);
          const again = await Promise.all(marks.map(at));
          assert.deepEqual(again, first, 'every frame must be reproducible from t alone');
          assert.notEqual(await at(2.05), first[0], 'and a different t must differ');
        },
        lessonDoc,
      );
    } finally {
      await browser.close();
    }
  },
);

test(
  'an element moves along its path, evenly, and leaves a trail behind it',
  { skip: SKIP },
  async () => {
    const browser = await launchChromium();
    try {
      await withPage(
        browser,
        async (page) => {
          const ball = lessonPlan.items.find((i) => i.id === 'ball');
          assert.ok(ball?.motion);
          const { start, end } = ball.motion;

          const shift = async (t: number): Promise<[number, number]> => {
            await seekPage(page, t);
            const tr = await attr(page, '[data-id="ball"]', 'transform');
            const m = /^translate\(([-\d.]+),([-\d.]+)\)/.exec(String(tr));
            return m ? [Number(m[1]), Number(m[2])] : [0, 0];
          };

          const before = await shift(start - 0.05);
          assert.deepEqual(
            before,
            [ball.motion.samples[0]![0], ball.motion.samples[0]![1]],
            'the ball is drawn already sitting on the path, so it never jumps',
          );

          const samples: [number, number][] = [];
          for (let i = 0; i <= 8; i++) samples.push(await shift(start + ((end - start) * i) / 8));
          for (let i = 1; i < samples.length; i++) {
            assert.ok(samples[i]![0] > samples[i - 1]![0], 'it travels forwards along the path');
          }
          const last = await shift(end + 0.2);
          assert.deepEqual(
            last,
            [ball.motion.samples.at(-1)![0], ball.motion.samples.at(-1)![1]],
            'and stays where it arrived',
          );

          // Beads appear behind it, in order, as it passes them.
          const beads = async (t: number): Promise<number> => {
            await seekPage(page, t);
            return page.evaluate(
              () =>
                [...document.querySelectorAll('[data-id="ball~trail"] > *')].filter(
                  (el) => Number(el.getAttribute('opacity') ?? 0) > 0.5,
                ).length,
            );
          };
          const early = await beads(start + (end - start) * 0.25);
          const mid = await beads(start + (end - start) * 0.6);
          const done = await beads(end);
          assert.ok(
            early > 0 && early < mid && mid < done,
            `trail grows: ${early} < ${mid} < ${done}`,
          );
          assert.equal(await beads(start - 0.05), 0, 'and nothing is laid down before it moves');
        },
        lessonDoc,
      );
    } finally {
      await browser.close();
    }
  },
);

test('a tangent sweeps into place and settles at its true angle', { skip: SKIP }, async () => {
  const browser = await launchChromium();
  try {
    await withPage(
      browser,
      async (page) => {
        const item = lessonPlan.items.find((i) => i.sweep);
        assert.ok(item?.sweep, 'the lesson board has a tangent to swing');
        const rotation = async (t: number): Promise<number> => {
          await seekPage(page, t);
          const tr = await attr(page, `[data-id="${item.id}"]`, 'transform');
          const m = /rotate\(([-\d.]+)/.exec(String(tr));
          return m ? Number(m[1]) : 0;
        };
        const early = await rotation(item.start + item.dur * 0.1);
        const halfway = await rotation(item.start + item.dur * 0.5);
        const settled = await rotation(item.start + item.dur + 0.1);
        assert.ok(Math.abs(early) > Math.abs(halfway), 'the swing eases out');
        assert.equal(settled, 0, 'and lands on the slope it is measuring');
      },
      lessonDoc,
    );
  } finally {
    await browser.close();
  }
});

test(
  'an accumulating board never wipes: every region of it is still there at the end',
  { skip: SKIP },
  async () => {
    const browser = await launchChromium();
    try {
      await withPage(
        browser,
        async (page) => {
          await seekPage(page, lessonPlan.duration);
          const faded = await page.evaluate(() =>
            [...document.querySelectorAll('#inkcast-content > g[data-id]')]
              .filter((g) => Number(g.getAttribute('opacity') ?? 0) < 0.9)
              .map((g) => g.getAttribute('data-id')),
          );
          assert.deepEqual(faded, [], 'a persistent board never wipes');

          // The recap frames all of it: every drawn group is inside the viewBox.
          const outside = await page.evaluate(() => {
            const board = document.getElementById('inkcast-board');
            const vb = (board?.getAttribute('viewBox') ?? '0 0 0 0').split(' ').map(Number);
            const [vx, vy, vw, vh] = vb as [number, number, number, number];
            const out: string[] = [];
            for (const g of document.querySelectorAll('#inkcast-content > g[data-id]')) {
              const box = (g as SVGGraphicsElement).getBBox();
              if (box.width === 0 && box.height === 0) continue;
              if (
                box.x < vx - 1 ||
                box.y < vy - 1 ||
                box.x + box.width > vx + vw + 1 ||
                box.y + box.height > vy + vh + 1
              ) {
                out.push(g.getAttribute('data-id') ?? '?');
              }
            }
            return out;
          });
          assert.deepEqual(outside, [], 'the recap pull-back shows the whole board');
        },
        lessonDoc,
      );
    } finally {
      await browser.close();
    }
  },
);

test('a wiped board is empty at every card boundary', { skip: SKIP }, async () => {
  // The other half of the assertion above, and the one the accumulate mode cannot
  // make: with `meta.board: 'wipe'` the board carries one card at a time. The three
  // things that have to hold together, because any two of them pass with the fade
  // in the wrong place: nothing dies mid-sentence, everything is gone before the
  // next card cuts in, and a card several beats draw together survives all of them.
  const fades = new Map<string, { fadeAt: number; anchor: number; drawn: number }>();
  const staying: string[] = [];
  const sceneIndex = new Map(wipedPlan.scenes.map((s, i) => [s.id, i]));
  for (const item of wipedPlan.items) {
    // The closing card is the one thing a wiping board keeps — nothing follows it.
    if (item.persist) {
      assert.equal(item.fadeAt, undefined, `${item.id} persists and was scheduled to fade`);
      staying.push(item.id);
      continue;
    }
    assert.ok(item.fadeAt !== undefined, `${item.id} has no wipe schedule`);
    // One element becomes several items — a plot's phases, a motion's trail — and
    // they carry the element's id with a `~suffix`. They all belong to its card.
    const owner = item.id.split('~')[0];
    const held = wiped.scenes[item.scene]?.elements.find((el) => el.id === owner)?.persistUntil;
    const anchor = held === undefined ? item.scene : (sceneIndex.get(held) ?? item.scene);
    fades.set(item.id, { fadeAt: item.fadeAt, anchor, drawn: item.start + item.dur });
  }
  assert.ok(staying.length > 0, 'the fixture ends on a card');

  const browser = await launchChromium();
  try {
    await withPage(
      browser,
      async (page) => {
        const board = async (t: number): Promise<Map<string, number>> => {
          await seekPage(page, t);
          const rows = await page.evaluate(() =>
            [...document.querySelectorAll('#inkcast-content > g[data-id]')].map(
              (g) =>
                [g.getAttribute('data-id') ?? '?', Number(g.getAttribute('opacity') ?? 0)] as const,
            ),
          );
          return new Map(rows);
        };

        // 1. Nothing dies while it is being talked about. Sampled at the last instant
        //    of the narration its card belongs to, every mark on that card is solid.
        for (const [id, f] of fades) {
          const scene = wipedPlan.scenes[f.anchor];
          assert.ok(scene, `${id} has an anchor scene`);
          const speaking = Math.max(f.drawn + 0.02, scene.start + scene.speech - 0.02);
          const at = await board(speaking);
          assert.ok(
            (at.get(id) ?? 0) > 0.9,
            `${id} was at ${(at.get(id) ?? 0).toFixed(2)} while its scene was still speaking`,
          );
        }

        // 2. And it is gone by the time the fade window closes — inside the hold,
        //    not after it, so the silence is a blank board rather than a death.
        for (const [id, f] of fades) {
          const at = await board(f.fadeAt + 0.02);
          assert.equal(at.get(id), 0, `${id} was still up after its fade completed`);
        }

        // 3. At every boundary the board carries the new card and nothing else. Two
        //    of these boundaries are blank frames (the benchmark's at 41s); the other
        //    two are mid-card, where `persistUntil` is the only thing keeping the ink
        //    alive — a wipe that fades at its own scene's end passes 1 and 2 and
        //    fails here, with the next beat morphing a shape whose alpha is zero.
        let blank = 0;
        let carried = 0;
        for (let i = 1; i < wipedPlan.scenes.length; i++) {
          const start = (wipedPlan.scenes[i] as (typeof wipedPlan.scenes)[number]).start;
          const at = await board(start - 0.02);
          const alive = [...at].filter(([, o]) => o > 0.05).map(([id]) => id);
          for (const id of alive) {
            const f = fades.get(id);
            assert.ok(f, `${id} is a known item`);
            assert.ok(
              f.anchor >= i,
              `${id} belongs to card ${f.anchor} and is still on the board at scene ${i}`,
            );
          }
          if (alive.length === 0) blank++;
          else carried++;
        }
        assert.ok(blank >= 2, `only ${blank} of the boundaries wiped to an empty board`);
        assert.ok(carried >= 1, `no boundary carried a card — persistUntil is untested`);

        // 4. And the film does not end on the blank board it keeps cutting to: the
        //    closing card is still up through the outro, because there is nothing
        //    after it to make room for.
        const end = await board(wipedPlan.duration);
        for (const id of staying) {
          assert.equal(end.get(id), 1, `${id} faded out of the film's last frame`);
        }
      },
      wipedDoc,
    );
  } finally {
    await browser.close();
  }
});

test('a hold keeps the visual on screen through the silence', { skip: SKIP }, async () => {
  const browser = await launchChromium();
  try {
    await withPage(
      browser,
      async (page) => {
        // Scene 1 narrates for 1.2s and then holds for 0.3s.
        const scene = lessonPlan.scenes[0];
        assert.ok(scene && scene.hold > 0);
        const inkAt = async (t: number): Promise<number> => {
          await seekPage(page, t);
          return page.evaluate(() =>
            [...document.querySelectorAll('#inkcast-content > g[data-id]')].reduce(
              (n, g) => n + Number(g.getAttribute('opacity') ?? 0),
              0,
            ),
          );
        };
        const speaking = await inkAt(scene.start + scene.speech - 0.01);
        const silent = await inkAt(scene.start + scene.dur - 0.01);
        assert.ok(silent >= speaking, 'nothing disappears during the deliberate pause');
        assert.ok(silent > 1.5, 'and the board is full while it is quiet');
      },
      lessonDoc,
    );
  } finally {
    await browser.close();
  }
});

test('long copy wraps by measurement and never loses a word', { skip: SKIP }, async () => {
  const browser = await launchChromium();
  try {
    await withPage(browser, async (page) => {
      const rendered = await page.evaluate(() =>
        [...document.querySelectorAll('[data-id="note"] text')]
          .map((t) => t.textContent ?? '')
          .join(' '),
      );
      const expected =
        'follow the slope downhill, one small step at a time, until the gradient goes quiet';
      assert.equal(rendered.replace(/\s+/g, ' ').trim(), expected);
      assert.ok(!rendered.includes('…') && !rendered.includes('...'), 'nothing is ellipsised');

      // Every line fits the box it was measured against, at the size chosen for it.
      const overflow = await page.evaluate(() => {
        const box = { x: 1300, y: 760, w: 900, h: 220 };
        return [...document.querySelectorAll('[data-id="note"] text')]
          .map((t) => (t as SVGTextElement).getComputedTextLength())
          .filter((w) => w > box.w + 1).length;
      });
      assert.equal(overflow, 0, 'no line is wider than its box');
    });
  } finally {
    await browser.close();
  }
});

test('preview reuses the identical animation code and adds a clock', { skip: SKIP }, async () => {
  const previewHtml = buildPreviewHtml(sb, DIR, { audioSrc: null });
  // The capture page and the preview page embed the same runtime, verbatim.
  const marker = 'window.seek = seek;';
  assert.ok(html.includes(marker) && previewHtml.includes(marker));
  assert.ok(previewHtml.includes('inkcastPreview'), 'preview adds transport controls');
  assert.ok(!html.includes('inkcastPreview'), 'capture does not');

  const browser = await launchChromium();
  try {
    const context = await browser.newContext({ viewport: { width: 900, height: 600 } });
    const page = await context.newPage();
    await page.setContent(previewHtml, { waitUntil: 'load' });
    await page.waitForFunction(
      () => (window as unknown as { __INKCAST_READY__?: boolean }).__INKCAST_READY__ === true,
    );
    type Preview = { seek(t: number): void; time(): number; playing(): boolean };
    const state = await page.evaluate(() => {
      const p = (window as unknown as { inkcastPreview?: Preview }).inkcastPreview;
      if (!p) return null;
      p.seek(1.25);
      return { time: p.time(), playing: p.playing(), bar: !!document.querySelector('.ic-bar') };
    });
    assert.deepEqual(state, { time: 1.25, playing: false, bar: true });
    await context.close();
  } finally {
    await browser.close();
  }
});

test(
  'an artificially narrowed box fails from the realized report, not the estimate',
  { skip: SKIP },
  async () => {
    // The done-bar for plan 2.7: the solver reserves at role sizes and this board
    // looks fine to every compile-time check — the clipping only exists after the
    // browser's shrink-to-fit, which is exactly what the realized report carries back.
    const narrow = parseStoryboard({
      version: 1,
      title: 'narrow',
      scenes: [
        {
          id: 's',
          narration: 'a sentence about a box',
          durationSec: 4,
          camera: { x: 960, y: 540, zoom: 1 },
          elements: [
            // Enough real content that the fill floor is not the thing being tested.
            { id: 'ground', type: 'shape', shape: 'rect', at: { x: 140, y: 100, w: 1100, h: 500 } },
            {
              id: 'squeezed',
              type: 'text',
              text: 'a sentence far too long to fit a box this small without shrinking to nothing',
              role: 'body',
              at: { x: 1400, y: 700, w: 120, h: 46 },
            },
          ],
        },
      ],
    });
    const nPlan = compilePlan(narrow, DIR);
    assert.ok(
      !(nPlan.problems ?? []).some((p) => p.includes('legibility') || p.includes('fit its box')),
      'the estimate must believe this board is fine — that is the seam being closed',
    );
    const nHtml = buildPageHtml(nPlan, { mode: 'capture', fontCss: '', title: 'narrow' });
    const browser = await launchChromium();
    try {
      const cap = await openCapture(browser, nPlan.frame, nHtml);
      try {
        const report = await cap.realizedLayout();
        const mine = report.find((r) => r.id === 'squeezed');
        assert.ok(mine, 'the page reports realized layout for the squeezed text');
        assert.ok(mine.size < mine.asked, 'the browser had to shrink it');
        const violations = realizedTextViolations(report, nPlan);
        assert.ok(
          violations.some((v) => v.message.includes('"squeezed"')),
          `the realized sweep must flag it: ${JSON.stringify(violations)}`,
        );
      } finally {
        await cap.close();
      }
    } finally {
      await browser.close();
    }
  },
);
