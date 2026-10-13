/**
 * The renderer's window onto the visuals stage.
 *
 * `@inkcast/visuals` is authoritative for geometry: it owns the frame, the gutters, the
 * sampling, the label solver and the ink. This module is how the renderer obtains that
 * geometry instead of deriving a second copy of it — the thing root cause 1 named.
 *
 * ## `visuals.json` is now read, not recomputed
 *
 * This module used to call `resolvePlot()` itself, and the reason was real: the visuals
 * stage had **no camera**. It sized type as a fraction of the whole canvas while the
 * renderer frames a region and quotes type in output pixels — on the benchmark board
 * 13.3 canvas units where the stage assumed 69.8, a factor of five. That is not a
 * cosmetic difference, because in the plot lane the caption size *is* the unit of
 * measurement: gutters are `caption * 2.1`, a tick `caption * 0.26`, an arrowhead
 * `caption * 0.42`, a marked point's radius `caption * 0.2`. Consuming the recorded
 * geometry on a zoomed board did not merely mis-size labels, it put a dot on the curve
 * four times too wide, and no rescaling afterwards could undo numbers already baked
 * into path data. So the renderer resolved every plot a second time.
 *
 * `boardMetrics()` in `@inkcast/core` closed that. Both stages now derive the camera,
 * the scale, the pen weight and the type sizes from one function, so the stage resolves
 * plots at the size they will actually be drawn and this module simply reads them. One
 * implementation, invoked once, recorded once.
 *
 * The ink is numbered by `writeElementSvg`, and `PlotPartRecord.from`/`to` index into
 * *that* numbering — which is precisely why reading the sidecar is safe now and copying
 * the numbering by hand never was.
 *
 * ## What happens when the sidecar is missing
 *
 * `plotFor` returns `undefined`, and the caller draws the plot's box as an honest
 * labelled frame rather than a wrong picture. That is a real degradation and it is
 * meant to be visible: a project whose visuals stage has not run has no geometry, and
 * inventing some here would put the second implementation straight back.
 *
 * ## Equations, unchanged
 *
 * Read from the sidecar since step 3, and for an additional reason that still holds:
 * typesetting is an async import of a large module and `compilePlan` is synchronous, so
 * for equations the sidecar was never a convenience but the only mechanism.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { logger } from '@inkcast/core';
import type { CodeElement, EquationElement, PlotElement, Storyboard } from '@inkcast/core';
import { MANIFEST_PATH, MANIFEST_VERSION } from '@inkcast/visuals';
import type {
  CodeLayout,
  EquationLayout,
  InkStroke,
  PlotLayout,
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

/**
 * One equation's typeset geometry, read straight from the sidecar.
 *
 * `strokes` are the glyph outlines in reveal order — see the note on reading the
 * sidecar in the module header for why this lane, unlike plots, can consume the
 * recorded geometry verbatim.
 */
export type EquationSource = {
  layout: EquationLayout;
  strokes: InkStroke[];
};

/**
 * One listing's set geometry, read straight from the sidecar.
 *
 * `strokes` are the glyph outlines in document order and `layout.parts` carries the ink
 * runs as index ranges into them — the same shared numbering plots use, and the reason
 * the renderer can colour a keyword without knowing anything about grammars. The tone is
 * what travels, never a colour: the film's palette belongs to the renderer.
 */
export type CodeSource = {
  layout: CodeLayout;
  strokes: InkStroke[];
};

export type VisualsBridge = {
  /**
   * Recorded geometry for one plot element, or `undefined` when the sidecar has none.
   *
   * The caller draws an honest labelled frame in that case. It used to be impossible
   * for this to fail, because the renderer resolved the plot itself — which is exactly
   * the second implementation this stopped being.
   */
  plotFor(el: PlotElement): PlotSource | undefined;
  /**
   * Typeset geometry for one equation element, or `undefined` when the sidecar has
   * none — a project whose visuals stage has not run, or an equation that would not
   * set. The caller is expected to fall back to drawing the TeX source as text.
   */
  equationFor(el: EquationElement): EquationSource | undefined;
  /**
   * Set geometry for one listing, or `undefined` when the sidecar has none — an un-run
   * visuals stage, or a listing that could not be set. The caller is expected to gate:
   * the fallback for code is handwriting, which is the defect the lane exists to end.
   */
  codeFor(el: CodeElement): CodeSource | undefined;
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
/**
 * Open the visuals lane for a project.
 *
 * No style, no font, no type sizes: this reads recorded geometry and resolves nothing,
 * so the font parsing and ink-style plumbing that used to live here — solely to feed a
 * second `resolvePlot()` — is gone with it.
 */
export function openVisuals(sb: Storyboard, dir: string): VisualsBridge {
  const manifest = readManifest(dir);
  if (!manifest) {
    log.debug(`no readable ${MANIFEST_PATH} in ${dir} — the visuals stage may not have run`);
  }

  let warnedPlots = 0;

  return {
    hasManifest: manifest !== undefined,

    plotFor(el: PlotElement): PlotSource | undefined {
      const visual = manifest?.elements[el.id];
      if (!visual?.plot || visual.strokes.length === 0) {
        // Once per plot, because a project with no sidecar has one per plot and the
        // useful signal is "run the visuals stage", not eight copies of it.
        if (warnedPlots++ === 0) {
          log.warn(
            `plot "${el.id}" has no recorded geometry — drawing a labelled frame. ` +
              `Run the visuals stage; the renderer no longer resolves plots itself.`,
          );
        }
        return undefined;
      }
      return { layout: visual.plot, strokes: visual.strokes, texts: visual.texts ?? [] };
    },

    equationFor(el: EquationElement): EquationSource | undefined {
      const visual = manifest?.elements[el.id];
      if (!visual?.equation || visual.strokes.length === 0) return undefined;
      return { layout: visual.equation, strokes: visual.strokes };
    },

    codeFor(el: CodeElement): CodeSource | undefined {
      const visual = manifest?.elements[el.id];
      if (!visual?.code || visual.strokes.length === 0) return undefined;
      return { layout: visual.code, strokes: visual.strokes };
    },
  };
}
