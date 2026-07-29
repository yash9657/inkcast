/**
 * The renderer's window onto the visuals stage.
 *
 * `@inkcast/visuals` is authoritative for plot geometry: it owns the frame, the
 * gutters, the sampling, the label solver and the ink. This module is how the renderer
 * obtains that geometry instead of deriving a second copy of it, which is what it used
 * to do — two implementations of the same arithmetic that had to agree by hand, where
 * the better one was the dead one (see `docs/PIPELINE.md`, root cause 1).
 *
 * ## Why this calls the resolver rather than reading `visuals.json`
 *
 * The sidecar records the geometry the stage drew its SVGs from, and the stage has no
 * camera: it sizes type as a fraction of the *whole canvas*. The renderer frames a
 * region, so it quotes type in output pixels through the camera — on the benchmark
 * board that is 13.3 canvas units where the stage assumed 69.8, a factor of five.
 *
 * That would be a cosmetic difference if type were only type. It is not: in the plot
 * lane the caption size *is* the unit of measurement. Gutters are `caption * 2.1`, a
 * tick is `caption * 0.26`, an arrowhead `caption * 0.42`, a marked point's radius
 * `caption * 0.2`. Consuming the recorded geometry on a zoomed board therefore does
 * not merely mis-size the labels; it puts a dot on the curve four times too wide and
 * gutters five times too deep, and no amount of rescaling afterwards can undo it
 * because the numbers are baked into the path data.
 *
 * So the renderer calls the same `resolvePlot()` the stage calls, passing the type
 * sizes it will actually draw at. There is still exactly one implementation of plot
 * geometry, which is the point of the exercise; what there is not, yet, is a single
 * type scale the two stages agree on. Unifying that — deriving the camera in a place
 * the visuals stage can reach, so the file itself becomes consumable — is the
 * follow-up, and it is what would let this module read the sidecar instead.
 *
 * The ink is numbered by `writeElementSvg`, because `PlotPartRecord.from`/`to` index
 * into *that* numbering. Reproducing the numbering by hand here would be a third copy
 * of an invariant that has already cost this codebase one dead subsystem.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { logger } from '@inkcast/core';
import type { PlotElement, Storyboard, StoryboardMeta } from '@inkcast/core';
import {
  MANIFEST_PATH,
  MANIFEST_VERSION,
  ctxFor,
  inkStyleFor,
  loadFontMetrics,
  resolvePlot,
  seedFrom,
  writeElementSvg,
} from '@inkcast/visuals';
import type {
  FontMetrics,
  InkStroke,
  InkStyle,
  PlotLayout,
  PlotTypeSizes,
  TextLayout,
  VisualManifest,
} from '@inkcast/visuals';

const log = logger('render:visuals');

/**
 * One plot's resolved geometry, in the shape the plan compiler consumes.
 *
 * `strokes` and `texts` share a single index space — the element's draw sequence —
 * and `layout.parts` carries `from`/`to` ranges into it. That shared numbering is
 * the whole contract: it is what lets the renderer split one plot into
 * independently timed phases without knowing how any of it was drawn.
 */
export type PlotSource = {
  layout: PlotLayout;
  strokes: InkStroke[];
  texts: TextLayout[];
};

export type VisualsBridge = {
  /** Resolved geometry for one plot element. */
  plotFor(el: PlotElement, sceneId: string): PlotSource;
  /** True when `assets/visuals.json` was read. */
  hasManifest: boolean;
};

function readManifest(dir: string): VisualManifest | undefined {
  const file = path.resolve(dir, MANIFEST_PATH);
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as VisualManifest;
    if (parsed.version !== MANIFEST_VERSION) {
      log.warn(
        `${MANIFEST_PATH} is version ${String(parsed.version)}, expected ${MANIFEST_VERSION} — ` +
          `recomputing plot geometry. Re-run the visuals stage.`,
      );
      return undefined;
    }
    if (!parsed.elements) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

/**
 * Open the visuals lane for a project, ready to answer plot queries.
 *
 * The style and font are resolved exactly as the visuals stage resolves them, so the
 * only thing that differs from what the stage would have written is the type scale the
 * caller asks for — and that difference is the reason this exists.
 */
export function openVisuals(
  sb: Storyboard,
  dir: string,
  opts: { fontPath?: string; typeSizes: PlotTypeSizes; strokeWidth: number },
): VisualsBridge {
  const manifest = readManifest(dir);
  const meta: StoryboardMeta = sb.meta;
  const canvasHeight = sb.canvas.h;

  // Built on first use: a storyboard with no plots should not pay for font parsing.
  let style: InkStyle | undefined;
  let font: FontMetrics | undefined;
  const ensure = (): { style: InkStyle; font: FontMetrics } => {
    // The style's own `strokeWidth` is a fixed canvas number, chosen for a standalone
    // SVG that fills its viewBox. It is not only the pen weight: a marked point's
    // radius is `strokeWidth * 1.45` and an axis arrowhead `strokeWidth * 2.6`, so
    // leaving it alone puts a dot on the curve half again too wide on a framed board.
    // Substituting the board's own base weight rescales the pen and everything
    // measured off it together.
    if (!style) style = { ...inkStyleFor(meta), strokeWidth: opts.strokeWidth };
    if (!font) {
      font = loadFontMetrics({
        style: style.name,
        preferred: style.fontFiles,
        fontFamily: style.fontFamily,
        ...(opts.fontPath ? { fontPath: opts.fontPath } : {}),
      });
    }
    return { style, font };
  };

  if (!manifest) {
    log.debug(`no readable ${MANIFEST_PATH} in ${dir} — the visuals stage may not have run`);
  }

  return {
    hasManifest: manifest !== undefined,

    plotFor(el: PlotElement, sceneId: string): PlotSource {
      return computePlot(el, sceneId, canvasHeight, opts.typeSizes, ensure());
    },
  };
}

/**
 * Resolve a plot with the visuals stage's own resolver.
 *
 * The seed matches `resolveVisuals`' (`seedFrom('element', id, sceneId)`) so the
 * hand this draws with is the hand the stage would have drawn with.
 */
function computePlot(
  el: PlotElement,
  sceneId: string,
  canvasHeight: number,
  typeSizes: PlotTypeSizes,
  deps: { style: InkStyle; font: FontMetrics },
): PlotSource {
  const { style, font } = deps;
  const resolved = resolvePlot(el, ctxFor(style, seedFrom('element', el.id, sceneId)), {
    style,
    font,
    canvasHeight,
    typeSizes,
    baseAt: el.enter.at,
  });
  // Numbered by the same writer the visuals stage numbers with, so `parts[].from`/`to`
  // mean here exactly what they mean in the sidecar. The SVG string is discarded.
  const written = writeElementSvg({
    id: el.id,
    items: resolved.items,
    box: el.at,
    style,
    space: 'canvas',
  });
  return { layout: resolved.layout, strokes: written.strokes, texts: written.texts };
}
