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
import {
  chromiumAvailable,
  launchChromium,
  openStagePage,
  seekPage,
  snapshotPage,
} from './browser.js';
import { compilePlan } from './compile.js';
import { fixtureStoryboard } from './fixture.js';
import { buildPageHtml, buildPreviewHtml } from './html.js';

const SKIP = chromiumAvailable()
  ? false
  : 'Playwright chromium is not installed — run `pnpm exec playwright install chromium`';

const DIR = '/tmp/inkcast-page-test';
const sb = fixtureStoryboard();
const plan = compilePlan(sb, DIR, { grid: true });
const html = buildPageHtml(plan, { mode: 'capture', fontCss: '', title: 'determinism' });

async function withPage<T>(
  browser: Browser,
  fn: (page: Awaited<ReturnType<typeof openStagePage>>['page']) => Promise<T>,
): Promise<T> {
  const { page, context } = await openStagePage(browser, plan.frame, html);
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
