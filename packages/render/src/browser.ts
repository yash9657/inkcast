/**
 * Headless Chromium, set up so that a frame is a function of nothing but `t`.
 *
 * The mechanism is `window.seek(t)` being pure (see `page/runtime.js`); the flags
 * and context options here are hardening on top of it — no subpixel text, one
 * colour profile, no scrollbars, no caret, and CSS animation disabled twice over.
 */
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import type { Browser, BrowserContext, CDPSession, Page } from 'playwright';

export const CHROMIUM_HINT =
  "Playwright's Chromium is not installed. Run:\n" +
  '  pnpm exec playwright install chromium\n' +
  '(about a 150 MB download; set PLAYWRIGHT_BROWSERS_PATH to relocate it.)';

/**
 * Presence check that does not pay the cost of a launch. `executablePath()`
 * throws rather than returning empty when no build is registered.
 */
export function chromiumAvailable(): boolean {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

export async function launchChromium(): Promise<Browser> {
  if (!chromiumAvailable()) throw new Error(CHROMIUM_HINT);
  return chromium.launch({
    args: [
      '--disable-lcd-text',
      '--force-color-profile=srgb',
      '--hide-scrollbars',
      '--font-render-hinting=none',
      '--disable-dev-shm-usage',
      '--mute-audio',
    ],
  });
}

const KILL_CSS =
  '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';

export type StagePage = { page: Page; context: BrowserContext };

/** A page holding the render document, ready for the first `seek`. */
export async function openStagePage(
  browser: Browser,
  size: { w: number; h: number },
  html: string,
): Promise<StagePage> {
  const context = await browser.newContext({
    viewport: { width: size.w, height: size.h },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    colorScheme: 'light',
    forcedColors: 'none',
  });
  const page = await context.newPage();
  // `load` covers the data-URI images an asset SVG may embed.
  await page.setContent(html, { waitUntil: 'load' });
  await page.addStyleTag({ content: KILL_CSS });
  await waitForReady(page);
  return { page, context };
}

type ReadyWindow = { inkcastReady?: Promise<boolean> };
type SeekWindow = { seek?: (t: number) => number };
type SnapshotWindow = { inkcast?: { snapshot: () => string } };

/** Text metrics need the handwriting font, so the page tells us when it is laid out. */
export async function waitForReady(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as ReadyWindow).inkcastReady ?? null);
  await page.waitForFunction(
    () => (window as unknown as { __INKCAST_READY__?: boolean }).__INKCAST_READY__ === true,
    undefined,
    { timeout: 30_000 },
  );
}

/** Set the page's entire visual state to time `t`. */
export async function seekPage(page: Page, t: number): Promise<void> {
  await page.evaluate((time: number) => {
    const w = window as unknown as SeekWindow;
    if (!w.seek) throw new Error('inkcast: window.seek is missing');
    w.seek(time);
  }, t);
}

/** Serialised board state — the determinism test's ground truth. */
export async function snapshotPage(page: Page): Promise<string> {
  return page.evaluate(() => {
    const w = window as unknown as SnapshotWindow;
    return w.inkcast ? w.inkcast.snapshot() : '';
  });
}

/* --------------------------------------------------------------- capturing */

export type FrameFormat = { type: 'png' } | { type: 'jpeg'; quality: number };

/**
 * A page plus a raw CDP session, used for the capture loop only.
 *
 * Going straight to `Runtime.evaluate` + `Page.captureScreenshot` instead of
 * through `page.evaluate` + `page.screenshot` measured 76 ms/frame against
 * 133 ms/frame at 1920×1080 on this machine — the same pixels, in 43% less time,
 * which is the difference between a 60-second film taking 40 s and 70 s to render.
 * The two commands are still strictly sequential, so the frame can never be
 * captured before its seek has been applied.
 */
export type FrameCapturer = {
  page: Page;
  context: BrowserContext;
  seek(t: number): Promise<void>;
  /** One frame, in the configured pipe format. */
  frame(): Promise<Buffer>;
  /** A PNG straight to disk, for the poster. */
  savePng(file: string): Promise<void>;
  close(): Promise<void>;
};

/**
 * The subset of `Page.captureScreenshot` parameters we use. Written out rather
 * than imported, because playwright-core's `types/protocol` is not reachable
 * through its exports map — and this shape has been stable in CDP for years.
 */
type ShotParams = {
  format?: 'jpeg' | 'png' | 'webp';
  quality?: number;
  optimizeForSpeed?: boolean;
};

export async function openCapture(
  browser: Browser,
  size: { w: number; h: number },
  html: string,
  format: FrameFormat = { type: 'png' },
): Promise<FrameCapturer> {
  const { page, context } = await openStagePage(browser, size, html);
  const cdp: CDPSession = await context.newCDPSession(page);
  // `optimizeForSpeed` selects a fast PNG encoder (bigger bytes, same pixels).
  // Chromium has had it since 111, but fall back rather than fail if it is rejected.
  let fastPng = true;

  const capture = async (opts: ShotParams): Promise<Buffer> => {
    const res = await cdp.send('Page.captureScreenshot', opts);
    return Buffer.from(res.data, 'base64');
  };

  const shoot = async (fmt: FrameFormat): Promise<Buffer> => {
    const base: ShotParams =
      fmt.type === 'jpeg' ? { format: 'jpeg', quality: fmt.quality } : { format: 'png' };
    if (fmt.type === 'png' && fastPng) {
      try {
        return await capture({ ...base, optimizeForSpeed: true });
      } catch {
        fastPng = false;
      }
    }
    return capture(base);
  };

  return {
    page,
    context,
    async seek(t) {
      const time = Number(t);
      if (!Number.isFinite(time)) throw new Error(`inkcast: refusing to seek to ${String(t)}`);
      await cdp.send('Runtime.evaluate', { expression: `window.seek(${time})` });
    },
    frame: () => shoot(format),
    async savePng(file) {
      await writeFile(file, await shoot({ type: 'png' }));
    },
    async close() {
      await cdp.detach().catch(() => undefined);
      await context.close().catch(() => undefined);
    },
  };
}
