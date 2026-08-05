/**
 * One frame of a storyboard, as pixels, without encoding a video.
 *
 * `render()` is the only way to get a finished film, and it costs a full encode. But a
 * *still* is what several things want: a poster, a review sheet, and — the reason this
 * file exists — the drawing lane showing a composed picture back to the model that
 * composed it. The literature is unambiguous that canvas feedback is what fixes geometry
 * (`docs/research/drawing.md` §3), and canvas feedback means a real render: the sketch
 * pass rewrites the geometry, a fill is hachured rather than flooded, and text is wrapped
 * against the handwriting's own metrics. A tidy preview drawn some other way would show
 * the model a drawing nobody will ever see, and hide the exact defects it is being asked
 * to fix.
 *
 * `openStills` holds one Chromium across many captures, because launching one costs more
 * than every capture in a lesson put together. `captureStill` is the one-shot form.
 */
import type { Storyboard } from '@inkcast/core';
import type { Browser } from 'playwright';
import { chromiumAvailable, launchChromium, openCapture } from './browser.js';
import { compilePlan } from './compile.js';
import { resolveFont } from './font.js';
import { buildPageHtml } from './html.js';

export type StillOptions = {
  /**
   * When to look, in seconds. Defaults to just before the end, which is the only time
   * everything the storyboard draws is guaranteed to be on the board.
   */
  t?: number;
};

export type StillSession = {
  /** A PNG of `sb` at `opts.t`. The project directory holds its fonts and assets. */
  capture(sb: Storyboard, dir: string, opts?: StillOptions): Promise<Buffer>;
  close(): Promise<void>;
};

/**
 * A still session, or `undefined` when Chromium is not installed.
 *
 * `undefined` rather than a throw: every caller of this has something reasonable to do
 * without pixels, and a missing browser must never be the reason a video fails to build.
 */
export async function openStills(): Promise<StillSession | undefined> {
  if (!chromiumAvailable()) return undefined;
  let browser: Browser;
  try {
    browser = await launchChromium();
  } catch {
    return undefined;
  }
  return {
    async capture(sb, dir, opts = {}) {
      const font = resolveFont(sb.meta.style, dir);
      const plan = compilePlan(sb, dir, { fontFamily: font.family });
      const html = buildPageHtml(plan, { mode: 'capture', fontCss: font.css, title: sb.title });
      const cap = await openCapture(browser, plan.frame, html);
      try {
        await cap.seek(opts.t ?? Math.max(0, plan.duration * 0.97));
        return await cap.frame();
      } finally {
        await cap.close();
      }
    },
    async close() {
      await browser.close().catch(() => undefined);
    },
  };
}

/** One still, browser and all. Use `openStills` when there is more than one to take. */
export async function captureStill(
  sb: Storyboard,
  dir: string,
  opts: StillOptions = {},
): Promise<Buffer | undefined> {
  const session = await openStills();
  if (!session) return undefined;
  try {
    return await session.capture(sb, dir, opts);
  } finally {
    await session.close();
  }
}
