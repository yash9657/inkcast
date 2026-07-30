/**
 * Board accumulation, the camera that frames it, and the scale everything is drawn at.
 *
 * This is the file that decides whether the video reads as a whiteboard or as a
 * slideshow. The MVP gave every scene its own patch of canvas and pointed the
 * camera at exactly that patch: correct, and a slideshow at roughly 80%
 * whitespace. Scenes that share `Scene.region` now draw onto ONE board, and the
 * camera frames the union of everything drawn in that region *so far* — so the
 * frame is full of ink, later beats annotate earlier ones, and the board at the
 * end of a region is the summary of it.
 *
 * Three rules fall out of that:
 *
 * - **Only ever pull wider.** The framing is fitted to the union with margin, so
 *   ink can never be cropped. Every clamp in here reduces zoom (shows more), and
 *   none of them increases it.
 * - **Legibility beats completeness.** A region that keeps growing would shrink
 *   its own ink to nothing. Past a per-aspect pull-out limit the camera stops
 *   zooming out and starts *walking* — it frames the newest ink plus as much
 *   history as still fits. On a tall 9:16 canvas that is literally the camera
 *   walking down the board.
 * - **A recap pulls back over everything it can still read.** `role: 'recap'`
 *   frames every piece of ink on the board, across all regions — but it is subject
 *   to the same pull-out limit as any other beat, because a summary nobody can
 *   read is not a summary. On 16:9 the whole board fits inside the limit and the
 *   recap is the wide shot the persistent canvas exists for. On a tall 9:16 canvas
 *   it geometrically cannot: verification of the vertical benchmark found the
 *   exempted recap fitting a 1640x9560 board into a 9:16 frame, which rendered the
 *   entire lesson as a 90-pixel-wide ribbon of illegible marks. It now walks back
 *   over as much as stays legible instead.
 *
 * A scene with no `region` keeps its authored camera untouched: hand-written
 * storyboards and the older planner compose their own shots, and silently
 * overruling them would be a regression, not a fix.
 *
 * ## Why this is in `@inkcast/core` and not in the renderer
 *
 * It used to be in `packages/render`, and that placement was the last live piece of
 * root cause 1. The visuals stage is declared authoritative for geometry, but it had
 * no camera — so it sized type as a fraction of the whole canvas while the renderer
 * framed a region and quoted type in output pixels. On the benchmark board that is a
 * factor of five, and in the plot lane the caption size *is* the unit of measurement:
 * gutters are `caption * 2.1`, a tick `caption * 0.26`, a marked point's radius
 * `caption * 0.2`. So the geometry the stage recorded was not merely mis-sized, it was
 * unusable, and the renderer had to resolve plots a second time to get numbers it
 * could draw.
 *
 * Nothing here is render-specific. Every function below is arithmetic over the
 * Storyboard IR and an output frame size, which is precisely why it can live at the
 * bottom of the dependency graph where both stages can reach it. `boardMetrics()` at
 * the end is the one call either stage makes: *given this storyboard, how big is
 * everything going to be?*
 */

import { logger } from './log.js';
import type { Element, Scene, Storyboard, StoryboardMeta } from './storyboard.js';
import { frameSize } from './storyboard.js';
import {
  boundsOfPoints,
  flattenPathData,
  inflateRect,
  unionAll,
  unionArea,
  unionRects,
} from './rect.js';
import type { Pt, Rect } from './rect.js';

const log = logger('core:camera');

export type FrameSize = { w: number; h: number };
export type ResolvedCamera = { x: number; y: number; zoom: number; transition: number };
export type Insets = { top: number; right: number; bottom: number; left: number };

export type SceneFraming = {
  camera: ResolvedCamera;
  /** True when the framing was computed from the board rather than authored. */
  derived: boolean;
  /** The rect the camera was asked to hold, before margins. */
  target: Rect | null;
  /** Every piece of ink on screen during this scene, for the fill metric. */
  visible: Rect[];
};

/**
 * Both limits below are relative to the film's **median framing**, because that is
 * exactly what the type scale is derived from (see `unitsPerPixel`). Handwriting is
 * one physical size on a real board; the camera moves. So a beat framed far tighter
 * than the median would render its letters oversize, and a beat framed far wider
 * would render them unreadably small — in each case by the ratio to the median.
 */

/**
 * How far below the median framing a region may go before the camera stops zooming
 * out and starts *walking* the board instead: it frames the newest ink plus as much
 * history as still fits. Vertical is tighter, because a phone has far less room to
 * spare before handwriting stops being legible.
 */
const PULL_OUT: Record<StoryboardMeta['aspect'], number> = { '16:9': 2.5, '9:16': 1.5, '1:1': 2.2 };

/**
 * How far above the median framing a single beat may zoom in. Clamping the close-up
 * costs a little whitespace in the rare one-element beat and keeps every letter on
 * the board the same size. Only ever widens the shot, so ink is never cropped.
 */
const MAX_CLOSEUP = 1.9;

/* ------------------------------------------------------------------- bounds */

function boxOf(pts: Pt[]): Rect | null {
  return boundsOfPoints(pts);
}

/** Where a path element's ink actually lands, from `points` or from raw `d`. */
export function pathBounds(el: Extract<Element, { type: 'path' }>): Rect | null {
  if (el.points && el.points.length >= 2) return boxOf(el.points.map((p) => [p.x, p.y] as Pt));
  if (el.d) {
    const subs = flattenPathData(el.d);
    return unionAll(subs.map((s) => boxOf(s)));
  }
  return null;
}

/**
 * The ink footprint of an element in canvas units.
 *
 * `at` is the author's box, which is right for text, shapes and plots but wrong
 * for the elements whose geometry lives elsewhere: an arrow's `at` is a hint
 * while its ink runs from `from` to `to`, a path may be authored with a nominal
 * box, an emphasis draws around another element entirely, and anything with
 * `motion` sweeps a corridor the size of itself along its path.
 */
export function elementBounds(el: Element, boxes?: Map<string, Rect>): Rect {
  let box: Rect | null = { ...el.at };
  if (el.type === 'arrow') {
    box = unionRects(
      box,
      boxOf([
        [el.from.x, el.from.y],
        [el.to.x, el.to.y],
      ]),
    );
  } else if (el.type === 'path') {
    box = pathBounds(el) ?? box;
  } else if (el.type === 'emphasis') {
    const target = boxes?.get(el.targetId);
    if (target) box = unionRects(box, inflateRect(target, target.w * 0.08, target.h * 0.18));
  }
  const base = box ?? { ...el.at };
  if (el.motion) {
    // The element's centre follows the path, so the swept region is the path
    // fattened by half the element in each direction.
    const along = boxOf(el.motion.path.map((p) => [p.x, p.y] as Pt));
    const swept = along ? inflateRect(along, base.w / 2, base.h / 2) : null;
    return unionRects(base, swept) ?? base;
  }
  return base;
}

/* -------------------------------------------------------------------- fitting */

/** Safe margins in output pixels. 9:16 is composed for a phone, not cropped to one. */
export function safeInsets(aspect: StoryboardMeta['aspect'], frame: FrameSize): Insets {
  if (aspect === '9:16') {
    // Generous top and bottom: short-form players put chrome, captions and a
    // handle over both ends of the frame, and ink under a caption is ink lost.
    return {
      left: frame.w * 0.075,
      right: frame.w * 0.075,
      top: frame.h * 0.09,
      bottom: frame.h * 0.13,
    };
  }
  if (aspect === '1:1') {
    return {
      left: frame.w * 0.065,
      right: frame.w * 0.065,
      top: frame.h * 0.07,
      bottom: frame.h * 0.07,
    };
  }
  return {
    left: frame.w * 0.055,
    right: frame.w * 0.055,
    top: frame.h * 0.065,
    bottom: frame.h * 0.075,
  };
}

/** Pixels per canvas unit at `zoom: 1` — the whole canvas fitted to the frame. */
export function basePxPerUnit(canvas: Rect, frame: FrameSize): number {
  const bw = canvas.w > 0 ? frame.w / canvas.w : 1;
  const bh = canvas.h > 0 ? frame.h / canvas.h : 1;
  return Math.min(bw, bh) || 1;
}

/** The canvas rect a camera makes visible. */
export function viewRect(
  cam: { x: number; y: number; zoom: number },
  canvas: Rect,
  frame: FrameSize,
): Rect {
  const px = basePxPerUnit(canvas, frame) * (cam.zoom > 0 ? cam.zoom : 1);
  const w = frame.w / px;
  const h = frame.h / px;
  return { x: cam.x - w / 2, y: cam.y - h / 2, w, h };
}

/**
 * The camera that holds `target` inside the safe area, as tightly as the frame
 * allows. The centre is offset by the inset asymmetry so the ink sits in the
 * middle of the *safe* rect, not of the raw frame.
 */
export function fitCamera(
  target: Rect,
  canvas: Rect,
  frame: FrameSize,
  insets: Insets,
  zoomOverride?: number,
): { x: number; y: number; zoom: number } {
  const base = basePxPerUnit(canvas, frame);
  const availW = Math.max(1, frame.w - insets.left - insets.right);
  const availH = Math.max(1, frame.h - insets.top - insets.bottom);
  const wantW = Math.max(target.w, 1e-6);
  const wantH = Math.max(target.h, 1e-6);
  const fitPx = Math.min(availW / wantW, availH / wantH);
  const zoom = Math.max(0.02, Math.min(60, zoomOverride ?? fitPx / base));
  const px = base * zoom;
  return {
    x: target.x + target.w / 2 + (insets.right - insets.left) / (2 * px),
    y: target.y + target.h / 2 + (insets.bottom - insets.top) / (2 * px),
    zoom,
  };
}

/** How much target rect fits inside the safe area at a given zoom. */
function safeSpan(canvas: Rect, frame: FrameSize, insets: Insets, zoom: number): FrameSize {
  const px = basePxPerUnit(canvas, frame) * zoom;
  return {
    w: Math.max(1, frame.w - insets.left - insets.right) / px,
    h: Math.max(1, frame.h - insets.top - insets.bottom) / px,
  };
}

/**
 * The newest ink plus as much history as still fits — the sliding window that
 * turns an over-full region into a camera walking the board.
 */
function walkWindow(history: readonly Rect[], own: Rect | null, span: FrameSize): Rect | null {
  let target = own ? { ...own } : null;
  for (let i = history.length - 1; i >= 0; i--) {
    const grown = unionRects(target, history[i] as Rect);
    if (!grown) continue;
    if (target && (grown.w > span.w || grown.h > span.h)) break;
    target = grown;
  }
  return target;
}

export function medianOf(values: readonly number[]): number {
  const v = [...values].filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (v.length === 0) return 1;
  const mid = v.length >> 1;
  return v.length % 2 === 1
    ? (v[mid] as number)
    : ((v[mid - 1] as number) + (v[mid] as number)) / 2;
}

/**
 * Canvas units per output pixel, at the camera's typical framing.
 *
 * `TYPE_SCALE`, stroke widths and the grid step are quoted in *output pixels*;
 * the board is measured in canvas units, and how large a canvas unit lands on
 * screen is decided entirely by the camera. Taking the multiplier from the canvas
 * size is the obvious guess and it is wrong for every storyboard whose camera
 * tours a canvas bigger than one frame — it once made every title six times
 * taller than the box the planner had measured for it.
 *
 * The median framing rather than the mean, so one deliberately wide establishing
 * shot cannot shrink the ink for the whole film.
 */
export function unitsPerPixel(canvas: Rect, frame: FrameSize, zooms: readonly number[]): number {
  const px = basePxPerUnit(canvas, frame) * medianOf(zooms);
  if (!(px > 0)) return 1;
  return Math.max(0.05, Math.min(24, 1 / px));
}

/* ------------------------------------------------------------------ framing */

function persistingBounds(scene: Scene, boxes: Map<string, Rect>): Rect[] {
  return scene.elements.filter((el) => el.persist).map((el) => elementBounds(el, boxes));
}

/**
 * Resolve one camera per scene: authored where the scene has no region, fitted to
 * the accumulated board where it has one.
 */
export function resolveFraming(sb: Storyboard, frame: FrameSize): SceneFraming[] {
  const canvas: Rect = { ...sb.canvas };
  const insets = safeInsets(sb.meta.aspect, frame);
  const pullOut = PULL_OUT[sb.meta.aspect];
  const boxes = new Map<string, Rect>();
  for (const scene of sb.scenes) for (const el of scene.elements) boxes.set(el.id, el.at);

  /* Pass 1: what each scene has to hold in frame. */
  const regionHistory = new Map<string, Rect[]>();
  const boardHistory: Rect[] = [];
  type Shot = {
    scene: Scene;
    /** Ink already on this scene's board, oldest first. */
    history: Rect[];
    own: Rect | null;
    target: Rect | null;
    recap: boolean;
    visible: Rect[];
  };
  const shots: Shot[] = [];

  for (const scene of sb.scenes) {
    const own = scene.elements.map((el) => elementBounds(el, boxes));
    const ownUnion = unionAll(own);
    const key = scene.region ?? null;
    const recap = scene.role === 'recap';
    const history = [
      ...(recap ? boardHistory : key === null ? [] : (regionHistory.get(key) ?? [])),
    ];
    const visible = [...history, ...own];
    // A narration-only beat on a board we have not drawn into yet has nothing to
    // frame, so `target` stays null and the author's camera stands.
    const target = key === null && !recap ? null : unionRects(unionAll(history), ownUnion);
    shots.push({
      scene,
      history,
      own: ownUnion,
      target: target && (target.w > 0 || target.h > 0) ? target : null,
      recap,
      visible,
    });

    const keep = persistingBounds(scene, boxes);
    if (key !== null) {
      const list = regionHistory.get(key) ?? [];
      list.push(...keep);
      regionHistory.set(key, list);
    }
    boardHistory.push(...keep);
  }

  /* Pass 2: the median framing, which both limits are measured against. */
  const raw = shots.map((s) =>
    s.target ? fitCamera(s.target, canvas, frame, insets).zoom : s.scene.camera.zoom,
  );
  const median = medianOf(raw);
  const ceiling = median * MAX_CLOSEUP;
  const floor = median / pullOut;

  const out: SceneFraming[] = shots.map((shot, i) => {
    if (!shot.target) {
      return {
        camera: { ...shot.scene.camera },
        derived: false,
        target: null,
        visible: shot.visible,
      };
    }
    let target = shot.target;
    let zoom = raw[i] as number;
    if (zoom < floor) {
      // Too wide to read: hold the newest ink and let the oldest scroll off. This
      // applies to a recap too — see the note at the top of this file.
      const walked = walkWindow(shot.history, shot.own, safeSpan(canvas, frame, insets, floor));
      if (walked) {
        target = walked;
        zoom = fitCamera(target, canvas, frame, insets).zoom;
      }
    }
    const cam = fitCamera(
      target,
      canvas,
      frame,
      insets,
      !shot.recap && zoom > ceiling ? ceiling : undefined,
    );
    return {
      camera: { ...cam, transition: shot.scene.camera.transition },
      derived: true,
      target,
      visible: shot.visible,
    };
  });

  // Pass 3: inside a region the board is continuous, so the camera must travel
  // rather than cut, and a recap needs room to breathe as it pulls back.
  for (let i = 1; i < out.length; i++) {
    const f = out[i] as SceneFraming;
    const scene = sb.scenes[i] as Scene;
    const prev = sb.scenes[i - 1] as Scene;
    if (!f.derived) continue;
    if (scene.role === 'recap') {
      f.camera.transition = Math.max(f.camera.transition, 1.1);
    } else if (scene.region && scene.region === prev.region) {
      f.camera.transition = Math.max(f.camera.transition, 0.45);
    }
  }

  return out;
}

/* --------------------------------------------------------------------- fill */

/**
 * Fraction of the frame carrying content, per scene.
 *
 * The brief for this renderer is "roughly half the frame carrying ink, never a
 * lone caption in a void". Element boxes overstate ink (a text box is mostly
 * paper between the letters), so this is a relative measure, not an absolute one:
 * it is here to catch the failure mode where the camera frames a huge empty
 * board, which is exactly what the MVP did.
 */
export function contentFill(
  framing: readonly SceneFraming[],
  canvas: Rect,
  frame: FrameSize,
): number[] {
  return framing.map((f) => {
    const view = viewRect(f.camera, canvas, frame);
    const area = view.w * view.h;
    if (!(area > 0) || f.visible.length === 0) return 0;
    return Math.min(1, unionArea(f.visible) / area);
  });
}

export function reportFill(fills: readonly number[], sb: Storyboard): void {
  if (fills.length === 0) return;
  const mean = fills.reduce((a, b) => a + b, 0) / fills.length;
  const empty = fills.filter((v) => v < 0.14).length;
  const detail = `mean content fill ${(mean * 100).toFixed(0)}% of frame across ${fills.length} scenes`;
  if (mean < 0.25 || empty > fills.length / 3) {
    log.warn(
      `${detail} — the board is mostly whitespace. Group consecutive beats into one \`region\` ` +
        `so the camera frames an accumulating board instead of one element per shot.`,
    );
  } else {
    log.debug(detail);
  }
  const named = sb.scenes.filter((s) => s.region).length;
  if (named === 0 && sb.scenes.length > 3) {
    log.warn(
      `no scene sets \`region\` — every beat gets its own shot, which reads as a slideshow. ` +
        `The lesson stage should group consecutive steps onto one board.`,
    );
  }
}

/* ------------------------------------------------------- the board's scale */

/**
 * Type scale in canvas units, for a 1920x1080-class canvas.
 *
 * Here rather than in the renderer's palette because it is one of the two numbers the
 * plot lane measures *everything else* against — see the file header. The renderer
 * still owns colour, the pen sprites and the sketch parameters; what moved is only
 * what decides how big things are.
 */
export const TYPE_SCALE = {
  title: 96,
  heading: 62,
  body: 42,
  label: 32,
  caption: 26,
} as const;

export type TextRole = keyof typeof TYPE_SCALE;

/** Stroke width multiplier against the 6-unit base, per ink personality. */
const PEN_WIDTH: Record<StoryboardMeta['style'], number> = {
  marker: 1.0,
  pencil: 0.55,
  chalk: 1.15,
  ink: 0.75,
};

/**
 * How much bigger type and ink are on a narrow frame.
 *
 * `TYPE_SCALE` is quoted for a 1920-wide frame. A 1080-wide vertical frame is watched
 * on a phone at arm's length, where the same *relative* type is too small to read and
 * the same relative stroke too thin to see — so 9:16 is composed with heavier ink and
 * larger letters rather than being a 16:9 board with the sides cut off. Ink grows less
 * than type: doubling stroke weight muddies detail.
 */
export function frameGain(aspect: StoryboardMeta['aspect']): number {
  if (aspect === '9:16') return 1.42;
  if (aspect === '1:1') return 1.18;
  return 1;
}

/**
 * Everything about how big this storyboard draws, derived once.
 *
 * The single call that closes root cause 1's remaining half. Both stages need these
 * numbers and neither may compute its own: the renderer draws at them, and the visuals
 * stage has to *resolve geometry* at them or it records path data nobody can consume.
 * Before this existed the visuals stage simply did not know them, which is why its
 * plot geometry was dead output and the renderer resolved plots a second time.
 *
 * Pure and cheap — framing arithmetic over the IR, no I/O, no fonts, no ink — so
 * calling it from both stages costs nothing and guarantees they agree by construction
 * rather than by two people keeping two formulas in step.
 */
export type BoardMetrics = {
  /** Output frame size for the storyboard's aspect. */
  frame: FrameSize;
  /** One camera per scene, in scene order. */
  framing: SceneFraming[];
  /** Canvas units per output pixel, at the camera's median framing. */
  scale: number;
  /** The narrow-frame type and ink gain. */
  gain: number;
  /** Base pen weight in canvas units — what a `strokeWidth: 1` stroke draws at. */
  strokeWidth: number;
  /**
   * Type sizes in canvas units, by role, with the gain applied.
   *
   * The plot lane needs `caption` and `label`; the rest are here because a stage that
   * lays out text needs the same answer the renderer will use, and offering two of
   * the five would invite someone to re-derive the others.
   */
  type: Record<TextRole, number>;
};

export function boardMetrics(sb: Storyboard): BoardMetrics {
  const frame = frameSize(sb.meta.aspect);
  const framing = resolveFraming(sb, frame);
  const scale = unitsPerPixel(
    sb.canvas,
    frame,
    framing.map((f) => f.camera.zoom),
  );
  const gain = frameGain(sb.meta.aspect);
  // Ink grows less than type on a narrow frame — the 0.6 is the same damping the
  // renderer applied when it owned this, and moving it here is the point: there is
  // now one place where "how heavy is the pen on this board" is answered.
  const inkGain = 1 + (gain - 1) * 0.6;
  const strokeWidth = 6 * PEN_WIDTH[sb.meta.style] * scale * inkGain;

  const type = Object.fromEntries(
    (Object.keys(TYPE_SCALE) as TextRole[]).map((role) => [role, TYPE_SCALE[role] * scale * gain]),
  ) as Record<TextRole, number>;

  return { frame, framing, scale, gain, strokeWidth, type };
}
