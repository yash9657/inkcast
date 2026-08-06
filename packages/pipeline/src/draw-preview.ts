/**
 * The renderer, handed to the drawing author so it can look at what it drew.
 *
 * ## Why this lives here and not in the planner
 *
 * A drawing is corrected by rendering it and showing it back to the model that composed
 * it (`docs/research/drawing.md` §3, `planner/src/draw-critic.ts`). Rendering means the
 * visuals stage and the render stage — roughjs, real font metrics, Chromium — and the
 * planner depends on neither, deliberately: it is the stage that has to work on a machine
 * with no browser. The pipeline is the one package that already has all three, so the
 * seam is a function passed down (`DrawPreview`), and this is the only implementation of
 * it. Same shape as `illustrations`: the caller that knows what is available tells the
 * stage that cannot find out for itself.
 *
 * ## What it renders
 *
 * The drawing alone, filling a frame, drawn by the same pen as the film — because the
 * defects being looked for are the renderer's own. A label breaks a word in half because
 * the *handwriting* is wider than the planner's estimate; hatching reads as a solid block
 * because roughjs drew it. A tidier preview would hide exactly what it was built to show.
 *
 * Everything is lazy and nothing is fatal. Chromium is launched on the first drawing that
 * actually needs correcting — often none in a run — and if it is not installed, or the
 * render throws, the critic gets `undefined` and works from the measurements alone.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { StoryboardMeta } from '@inkcast/core';
import { logger, parseStoryboard } from '@inkcast/core';
import { type StillSession, loadDrawing, loadRender, loadVisuals } from './stages.js';

const log = logger('pipeline:draw-preview');

/**
 * Renders a drawing's marks as the board will draw them.
 *
 * Mirrored from `@inkcast/planner`'s `DrawPreview` rather than imported, for the reason
 * every other stage signature in `stages.ts` is mirrored: nothing here may pull a stage
 * package in eagerly.
 */
export type DrawPreview = (
  marks: unknown[],
  opts?: { underlay?: boolean },
) => Promise<Uint8Array | undefined>;

/**
 * The frame the drawing is previewed in, and the box it is fitted into.
 *
 * A 16:9 frame with a small margin, so the drawing is scaled up about 1.5× — close to the
 * largest a beat's cell ever gives it, which is the scale at which its labels are most
 * likely to wrap. Previewing it small would make every label look comfortable.
 */
const CANVAS = { x: 0, y: 0, w: 1920, h: 1080 };
const BOX = { x: 110, y: 70, w: 1700, h: 940 };

/**
 * Narration long enough that every mark has finished being drawn by the time we look.
 *
 * The board reveals marks across the beat, the last of them at 0.72, and each takes 0.8s
 * — so a beat shorter than about 3.2s is still being drawn at the moment of capture. The
 * scene's length is estimated from this text, which is the only lever there is.
 */
const NARRATION =
  'Here is the drawing on its own, every mark of it, drawn by the same hand and the same ' +
  'pen that draws the film, so that what is on this board is what a viewer would see.';

export type DrawPreviewHandle = {
  /** Pass to the lesson stage as `drawPreview`. */
  preview: DrawPreview;
  /** Releases Chromium and the scratch directory. Safe to call when nothing was rendered. */
  close(): Promise<void>;
};

/**
 * A lazily-opened preview renderer.
 *
 * `style` and `palette` come from the film being made, because the pen is part of what is
 * being judged: chalk on a dark board wraps text differently from a marker on white.
 */
export function openDrawPreview(meta: Partial<StoryboardMeta> = {}): DrawPreviewHandle {
  type Kit = { still: StillSession; dir: string; build: Awaited<ReturnType<typeof loadDrawing>> };
  let kit: Kit | undefined;
  let opened = false;
  let n = 0;

  /** One shared browser and scratch directory, opened on the first drawing that needs it. */
  const open = async (): Promise<Kit | undefined> => {
    if (opened) return kit;
    opened = true;
    try {
      const [render, build] = await Promise.all([loadRender(), loadDrawing()]);
      const still = await render.openStills();
      if (!still) {
        log.info(
          'no Chromium, so drawings will be corrected from their measurements rather than ' +
            'from a render — pnpm exec playwright install chromium',
        );
        return undefined;
      }
      kit = { still, build, dir: await mkdtemp(path.join(tmpdir(), 'inkcast-drawpreview-')) };
    } catch (err) {
      log.debug('could not open the drawing preview', err);
    }
    return kit;
  };

  const preview: DrawPreview = async (marks: unknown[], opts = {}) => {
    const ready = await open();
    if (!ready) return undefined;
    const { still, dir, build } = ready;
    // An annotated drawing is previewed against the whole authoring canvas, the way the
    // compiler will lay it out — fitting it by its own content instead would show the
    // critic a picture in a different coordinate space from the one the marks annotate,
    // and the two images it is handed could not be read against each other.
    const elements = build.buildDrawing(marks, {
      id: 'd',
      box: BOX,
      ...(opts.underlay ? { underlay: true } : {}),
    });
    if (!elements.length) return undefined;

    // Its own subdirectory per drawing: four of these run at once, the visuals stage
    // writes resolved geometry into the project it is given, and two concurrent
    // resolutions sharing a directory would be writing the same filenames.
    const projectDir = path.join(dir, `p${n++}`);
    const sb = parseStoryboard({
      version: 1,
      title: 'drawing preview',
      meta: {
        ...(meta.style === undefined ? {} : { style: meta.style }),
        ...(meta.palette === undefined ? {} : { palette: meta.palette }),
      },
      canvas: CANVAS,
      scenes: [
        {
          id: 's1',
          narration: NARRATION,
          camera: { x: CANVAS.w / 2, y: CANVAS.h / 2, zoom: 1 },
          // The drawing is the whole board here, so nothing else claims a cue, a reveal
          // or a share of the beat, and the reveal order is the author's mark order.
          elements,
        },
      ],
    });

    try {
      const visuals = await loadVisuals();
      const resolved = await visuals.resolveVisuals(sb, projectDir, { images: 'off' });
      return await still.capture(resolved, projectDir);
    } catch (err) {
      log.debug('could not render a drawing for review', err);
      return undefined;
    }
  };

  return {
    preview,
    async close() {
      if (kit) {
        await kit.still.close().catch(() => undefined);
        await rm(kit.dir, { recursive: true, force: true }).catch(() => undefined);
      }
      kit = undefined;
      opened = true;
    },
  };
}
