/**
 * The picture a hybrid drawing is composed on top of, generated and placed.
 *
 * ## Why this lives here and not in the planner
 *
 * Same seam and the same argument as `draw-preview.ts`. Making an underlay means an image
 * provider (`@inkcast/visuals`), the vectoriser that measures where its ink actually is
 * (the same package), and Chromium to draw the result (`@inkcast/render`). The planner
 * depends on none of them, deliberately — it is the stage that has to work on a machine
 * with no browser and no key — so the caller that already has all three passes a function
 * down, and this is the only implementation of it.
 *
 * ## What the drawing author is handed, and why it is not the raster
 *
 * The raster would be the obvious thing to send and it is the wrong thing. A text-to-image
 * model returns its subject inside a wide white margin — the anatomical heart this lane was
 * built for traces to 496x798 of a 1024 square — and the board draws the *ink*, scaled to
 * fill the space it is given. So the picture the author would be reasoning about and the
 * picture the viewer ends up seeing are at different scales and different offsets, and
 * every coordinate the author reads off the image is wrong by the difference.
 *
 * What goes to the author instead is **the board**: that ink, traced, drawn at the box it
 * will really occupy, on a blank canvas of exactly the size it is composing on. A feature
 * it can see a third of the way across the picture is at x = a third of the canvas, because
 * the picture *is* the canvas. That removes the arithmetic that produced the one measured
 * failure of the experiment behind this lane — 8 of 22 marks outside the canvas, the bundle
 * branches running to y=720 on a board 560 tall, from a model reasoning in fractions of an
 * image and scaling them wrong.
 *
 * The raster itself is what gets placed, rather than the traced outlines re-drawn: the
 * trace is a reading of those very pixels, and what is being established here is *where the
 * ink is*, not what the pen does to it. Roughening moves nothing by more than a stroke's
 * width and the board's own hand is not the thing under test.
 */
import { DRAW_H, DRAW_W, logger } from '@inkcast/core';
import { loadImages, loadUnderlay } from './stages.js';

const log = logger('pipeline:draw-underlay');

/**
 * Mirrored from `@inkcast/planner`'s `DrawUnderlay` rather than imported, for the reason
 * every stage signature in `stages.ts` is mirrored: nothing here may pull a stage package
 * in eagerly.
 */
export type DrawUnderlay = (
  prompt: string,
) => Promise<{ png: Uint8Array; inkBox: number[] } | undefined>;

export type DrawUnderlayHandle = {
  /** Pass to the lesson stage as `drawUnderlay`. */
  underlay: DrawUnderlay;
  /** Releases Chromium. Safe to call when nothing was generated. */
  close(): Promise<void>;
};

/** The board's paper, so the author's view is the colour the film is. */
const PAPER = '#fcfbf9';

/**
 * A lazily-opened underlay generator.
 *
 * `dir` is the project directory, so a generated raster lands in the project's own
 * `assets/illustrations` as well as the machine cache — which is what lets the visuals
 * stage find *this* picture later instead of asking the provider for another one. A
 * generator is not a function: asked twice for "a human heart" it returns two different
 * hearts, and the marks were aimed at the first.
 *
 * Everything is lazy and nothing is fatal. No key, no vectoriser, no Chromium, a provider
 * error: the caller gets `undefined` and the beat is drawn in marks alone.
 */
export function openDrawUnderlay(dir: string): DrawUnderlayHandle {
  type Browser = { newPage(o: unknown): Promise<Page>; close(): Promise<void> };
  type Page = {
    setContent(html: string): Promise<void>;
    screenshot(o: { path?: string }): Promise<Buffer>;
    close(): Promise<void>;
  };
  let browser: Browser | undefined;
  let opened = false;

  const chrome = async (): Promise<Browser | undefined> => {
    if (opened) return browser;
    opened = true;
    try {
      // Reached the same way `still.ts` reaches it, and for the same reason: a static
      // import of Playwright anywhere in this package pulls it into every `inkcast list`.
      const { chromium } = (await import('playwright')) as unknown as {
        chromium: { launch(): Promise<Browser> };
      };
      browser = await chromium.launch();
    } catch (err) {
      log.info(
        'no Chromium, so a drawing cannot be composed on top of a generated picture — ' +
          'pnpm exec playwright install chromium',
      );
      log.debug('could not launch a browser for the underlay', err);
    }
    return browser;
  };

  const underlay: DrawUnderlay = async (prompt: string) => {
    const [images, place] = await Promise.all([loadImages(), loadUnderlay()]);
    const asset = place.underlayAsset(prompt);

    // Generated under the id, prompt and seed the compiler will mint for this asset, so
    // the visuals stage resolves to this very picture from the cache rather than paying
    // for a different one. See `planner/src/underlay.ts`.
    const raster = await images.illustrationRaster({
      id: asset.id,
      prompt: asset.prompt,
      dir,
      seed: place.assetSeed(asset.id),
    });
    if (!raster) {
      log.debug(`no image came back for the underlay "${prompt.slice(0, 60)}"`);
      return undefined;
    }

    // Measured from the same trace the board will draw from, so the box the marks are
    // aimed at and the box the ink lands in are one number, not two.
    const ink = await images.tracedInkBox(raster.png);
    if (!ink || ink.w <= 0 || ink.h <= 0) {
      log.warn(`the underlay "${prompt.slice(0, 60)}" could not be traced — drawing marks alone`);
      return undefined;
    }
    const box = place.underlayInkBox(ink);

    const page = await view(raster.png, ink, box);
    if (!page) return undefined;
    return { png: page, inkBox: [box.x, box.y, box.w, box.h] };
  };

  /** The board as the author will see it: this image's ink, at `box`, on a blank canvas. */
  const view = async (
    png: Buffer,
    ink: { x: number; y: number; w: number; h: number },
    box: { x: number; y: number; w: number; h: number },
  ): Promise<Uint8Array | undefined> => {
    const b = await chrome();
    if (!b) return undefined;
    // The raster is placed by its *ink* box, not its frame: scaled so the ink fills `box`
    // and offset so the margin falls outside it. `overflow: hidden` on the canvas keeps a
    // stray speck in the margin from drawing outside the board.
    const s = box.w / ink.w;
    const html =
      `<body style="margin:0;background:${PAPER}">` +
      `<div style="position:relative;width:${DRAW_W}px;height:${DRAW_H}px;overflow:hidden;background:${PAPER}">` +
      `<img src="data:image/png;base64,${Buffer.from(png).toString('base64')}" ` +
      `style="position:absolute;left:${box.x - ink.x * s}px;top:${box.y - ink.y * s}px;` +
      `width:${imageWidth(png) * s}px"/>` +
      '</div></body>';
    let page: Page | undefined;
    try {
      page = await b.newPage({
        viewport: { width: DRAW_W, height: DRAW_H },
        deviceScaleFactor: 2,
      });
      await page.setContent(html);
      return await page.screenshot({});
    } catch (err) {
      log.warn('could not draw the underlay for the author to look at', err);
      return undefined;
    } finally {
      await page?.close().catch(() => undefined);
    }
  };

  return {
    underlay,
    async close() {
      await browser?.close().catch(() => undefined);
      browser = undefined;
      opened = true;
    },
  };
}

/**
 * A PNG's pixel width, straight out of its IHDR.
 *
 * Sixteen bytes into a fixed header, and it saves depending on an image library to learn
 * something the file states in the clear: signature (8), chunk length (4), `IHDR` (4),
 * then width. The fallback is the size every provider here returns.
 */
function imageWidth(png: Buffer): number {
  return png.length >= 20 ? png.readUInt32BE(16) : 1024;
}
