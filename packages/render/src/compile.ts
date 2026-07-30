/**
 * Storyboard IR -> RenderPlan.
 *
 * This is where fractional scene timings become absolute seconds, semantic roles
 * become ink and type sizes, and shapes/curves/paths become hand-drawn path data
 * from a seeded PRNG. Nothing here touches a DOM or a clock, so it is synchronous,
 * pure (given the same storyboard and directory) and unit-testable.
 *
 * Four things this stage owns, in the order they matter:
 *
 * 1. **Time.** Scene lengths come from `sceneLength()`/`sceneOffsets()` in core, so
 *    `Scene.hold` — deliberate silence with the visual still up — is part of the
 *    scene rather than dead air the renderer invents. Element timings stay
 *    fractions of the *narration*, which is what `Enter.cue` resolves against.
 * 2. **Framing.** `camera.ts` turns regions into an accumulating board.
 * 3. **Vocabulary.** A `plot` becomes many independently timed items (axes, then
 *    curves, then overlays); `path` becomes one hand-drawn stroke; `motion` becomes
 *    a baked arc-length table so the browser has no maths left to get wrong.
 * 4. **Scale.** Type and stroke weight are quoted in output pixels and converted
 *    through the *camera*, never through the canvas size.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { logger } from '@inkcast/core';
import type {
  ArrowElement,
  AssetElement,
  DiagramElement,
  Element,
  EmphasisElement,
  EquationElement,
  PathElement,
  PlotElement,
  Scene,
  ShapeElement,
  Storyboard,
  StoryboardMeta,
  TextElement,
} from '@inkcast/core';
import { frameSize, sceneLength, sceneOffsets, totalDuration } from '@inkcast/core';
import { MANIFEST_PATH } from '@inkcast/visuals';
import { boardMetrics, contentFill, reportFill, safeInsets } from '@inkcast/core';
import type { SceneFraming } from '@inkcast/core';
import { cumulativeLengths, easeFn, flattenPathData, pointAtLength, rectContains } from './geom.js';
import type { Pt as GPt } from './geom.js';
import { layoutDiagram } from './layout.js';
import { TYPE_SCALE, inkStyle, paletteFor, penArt } from './palette.js';
import type { Palette, TextRole } from './palette.js';
import { curveTrace, plotArea, plotPhases } from './plot.js';
import type { PlotPhase } from './plot.js';
import { dotPrim, geom, geoms, textPrim } from './prims.js';
import {
  Rng,
  hachureEllipse,
  hachurePolygon,
  rectPoly,
  seedOf,
  sketchAlong,
  sketchArrowHead,
  sketchBracket,
  sketchCurve,
  sketchEllipse,
  sketchLine,
  sketchRect,
} from './sketch.js';
import type { Pt, SketchStyle } from './sketch.js';
import type {
  GeomPrim,
  MorphTrack,
  MotionTrack,
  PlanItem,
  PlanPrim,
  PlanScene,
  Rect,
  RenderPlan,
} from './types.js';
import { openVisuals } from './visuals.js';
import type { PlotSource, VisualsBridge } from './visuals.js';

const log = logger('render:compile');

export type CompileOptions = {
  /** Draw the faint board grid. Default true. */
  grid?: boolean;
  /** CSS font-family list for on-canvas text. */
  fontFamily?: string;
};

/** Words-per-second used only when the voice stage has not measured a scene. */
const WPS = 2.6;

/** Measured narration length, or an honest estimate when voice has not run. */
export function sceneDuration(scene: Scene): number {
  if (scene.durationSec && scene.durationSec > 0) return scene.durationSec;
  const words = scene.narration.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1.8, words / WPS + 0.6);
}

/* ------------------------------------------------------------------ helpers */

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

function center(box: Rect): [number, number] {
  return [box.x + box.w / 2, box.y + box.h / 2];
}

function inflate(box: Rect, padX: number, padY = padX): Rect {
  return { x: box.x - padX, y: box.y - padY, w: box.w + padX * 2, h: box.h + padY * 2 };
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/**
 * Fixed precision for progress fractions.
 *
 * Positions round to a thousandth of a canvas unit — far below a pixel — but
 * progress is a 0–1 fraction sampled once per frame, so three decimals quantise it
 * to steps of 0.001 against increments of ~0.008 and the "even speed" the arc-length
 * bake exists to provide is thrown away as ±6% jitter.
 */
function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

/** Data-URI any relative `<image href>` so the page needs no file access. */
function inlineImages(svg: string, dir: string): string {
  return svg.replace(
    /((?:xlink:)?href\s*=\s*)(["'])([^"']+)\2/g,
    (whole, lead: string, quote: string, url: string) => {
      if (/^(data:|https?:|#)/i.test(url)) return whole;
      try {
        const abs = path.resolve(dir, url);
        const buf = readFileSync(abs);
        const ext = path.extname(abs).toLowerCase();
        const mime =
          ext === '.png'
            ? 'image/png'
            : ext === '.jpg' || ext === '.jpeg'
              ? 'image/jpeg'
              : ext === '.webp'
                ? 'image/webp'
                : ext === '.svg'
                  ? 'image/svg+xml'
                  : 'application/octet-stream';
        return `${lead}${quote}data:${mime};base64,${buf.toString('base64')}${quote}`;
      } catch {
        log.warn(`asset image not readable, dropping: ${url}`);
        return `${lead}${quote}${quote}`;
      }
    },
  );
}

/* --------------------------------------------------------------------- cues */

const CUE_STRIP = /[^\p{L}\p{N}']+/gu;

function cueTokens(text: string): string[] {
  return text.toLowerCase().replace(CUE_STRIP, ' ').split(' ').filter(Boolean);
}

/**
 * Resolve `Enter.cue` against the voice stage's word timings.
 *
 * The voice stage normally does this and overwrites `enter.at`. This is the
 * fallback for when it could not (no aligner, a provider without word timings on
 * the first pass, a hand-edited storyboard): if the words are on the scene and the
 * fraction was never set, the renderer can still land the visual on the phrase
 * that names it. Beat-level sync is not enough for teaching — audio can be
 * perfectly aligned while a diagram arrives seconds before the sentence about it,
 * which a learner experiences as drift.
 */
export function cueFraction(
  cue: string,
  words: NonNullable<Scene['words']>,
  durationSec: number,
): number | null {
  const needle = cueTokens(cue);
  if (needle.length === 0 || words.length === 0 || !(durationSec > 0)) return null;
  const hay = words.map((w) => cueTokens(w.word).join(' '));
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      const start = words[i]?.start;
      if (typeof start !== 'number') return null;
      return clamp(start / durationSec, 0, 1);
    }
  }
  // A single-word cue may be spoken as part of a longer token ("downhill." vs
  // "downhill"), so fall back to a substring hit before giving up.
  const joined = hay.join(' ');
  const phrase = needle.join(' ');
  const idx = joined.indexOf(phrase);
  if (idx >= 0) {
    const wordIndex = joined.slice(0, idx).split(' ').filter(Boolean).length;
    const start = words[Math.min(wordIndex, words.length - 1)]?.start;
    if (typeof start === 'number') return clamp(start / durationSec, 0, 1);
  }
  return null;
}

function enterFraction(el: Element, scene: Scene, missing: string[]): number {
  const at = clamp(el.enter.at, 0, 1);
  const cue = el.enter.cue;
  if (!cue) return at;
  if (at > 0) return at; // already resolved by the voice stage
  const words = scene.words;
  if (!words || words.length === 0 || !scene.durationSec) {
    missing.push(cue);
    return at;
  }
  // Word timings on the scene mean the voice stage ran and already resolved every
  // cue it could, so `at` is its answer and a failed re-resolve here is not news.
  // It happens routinely: a cue on the opening words of a beat resolves to
  // exactly 0, which is indistinguishable from "never set", and this matcher is
  // stricter about contractions than the voice stage's. Warning here told the
  // user to "run the voice stage" immediately after the voice stage had reported
  // placing that very cue word-exactly — advice that is both wrong and
  // trust-eroding. The warning belongs only to the branch above, where there
  // genuinely is no measured audio to resolve against.
  return cueFraction(cue, words, scene.durationSec) ?? at;
}

/* ------------------------------------------------------------------ compile */

type Ctx = {
  pal: Palette;
  st: SketchStyle;
  /** Base stroke width in canvas units. */
  sw: number;
  /** Canvas units per output pixel, for geometry. */
  scale: number;
  /** Canvas units per output pixel, for type. */
  type: number;
  dir: string;
  assets: Map<string, string | undefined>;
  boxes: Map<string, Rect>;
  /**
   * Every element in the storyboard by id, across all scenes.
   *
   * A morph names the element it grows out of, which was usually drawn by an
   * *earlier* scene and persisted, so resolving it needs the whole board rather
   * than the scene being compiled.
   */
  elements: Map<string, Element>;
  /** Owning scene id per element, which the visuals seed is derived from. */
  sceneOf: Map<string, string>;
  alpha: number | undefined;
  /** Plot frames and curves already on the board, so they are not re-inked. */
  drawn: Set<string>;
  /** Plot geometry from the visuals stage. */
  visuals: VisualsBridge;
  /** Resolved once per element: on the computed path this is real work. */
  plots: Map<string, PlotSource | undefined>;
};

/**
 * The visuals stage's geometry for one plot, memoised.
 *
 * A plot is asked for up to three times while compiling one scene — its own phases,
 * the area an element riding it is rebased onto, and the trace a morph bends into —
 * and when the manifest is absent each of those would otherwise re-resolve it.
 */
function plotSourceOf(el: PlotElement, ctx: Ctx): PlotSource | undefined {
  const cached = ctx.plots.get(el.id);
  if (cached !== undefined || ctx.plots.has(el.id)) return cached;
  const src = ctx.visuals.plotFor(el);
  ctx.plots.set(el.id, src);
  return src;
}

type SceneTiming = {
  index: number;
  start: number;
  /** Measured narration length — what every `enter.at` fraction is a fraction of. */
  speech: number;
  /** Narration plus `hold`: how long the scene owns the screen. */
  length: number;
  end: number;
};

/** Fill in estimated durations so core's timing helpers can own the arithmetic. */
function withMeasuredDurations(sb: Storyboard): Storyboard {
  let missing = 0;
  const scenes = sb.scenes.map((s) => {
    if (s.durationSec && s.durationSec > 0) return s;
    missing += 1;
    return { ...s, durationSec: sceneDuration(s) };
  });
  if (missing > 0) {
    log.warn(
      `${missing}/${sb.scenes.length} scenes have no measured durationSec — estimating from the narration. Run the voice stage for synced timing.`,
    );
  }
  return { ...sb, scenes };
}

export function compilePlan(sb: Storyboard, dir: string, opts: CompileOptions = {}): RenderPlan {
  const canvas: Rect = { ...sb.canvas };
  const timed = withMeasuredDurations(sb);

  // How big everything on this board is, derived once in `@inkcast/core` so the
  // visuals stage can ask the same question and get the same answer. The renderer
  // used to own this arithmetic, which is why the visuals stage had no camera and its
  // recorded geometry was unusable — see `core/src/camera.ts` and root cause 1.
  const board = boardMetrics(timed);
  const frame = board.frame;
  const framing: SceneFraming[] = board.framing;
  const gain = board.gain;
  const scale = board.scale;
  const pal = paletteFor(sb.meta.palette);
  const ink = inkStyle(sb.meta.style);
  const st: SketchStyle = {
    roughness: ink.roughness,
    bowing: ink.bowing,
    passes: ink.passes,
    scale,
  };
  const sw = board.strokeWidth;

  const offsets = sceneOffsets(timed);
  const scenes: PlanScene[] = timed.scenes.map((scene, i) => {
    const speech = scene.durationSec ?? 0;
    const length = sceneLength(scene);
    const start = offsets[i] ?? 0;
    const cam = (framing[i] as SceneFraming).camera;
    return {
      id: scene.id,
      start,
      dur: length,
      speech,
      hold: scene.hold,
      camera: { x: cam.x, y: cam.y, zoom: cam.zoom, transition: cam.transition },
      ...(scene.region ? { region: scene.region } : {}),
      ...(scene.role ? { role: scene.role } : {}),
    };
  });
  const duration = totalDuration(timed);

  const ctx: Ctx = {
    pal,
    st,
    sw,
    scale,
    type: scale * gain,
    dir,
    assets: new Map(sb.assets.map((a) => [a.id, a.svg])),
    boxes: new Map(),
    elements: new Map(),
    sceneOf: new Map(),
    alpha: ink.opacity < 1 ? ink.opacity : undefined,
    drawn: new Set<string>(),
    // Recorded geometry only. The stage resolved these at `boardMetrics`' scale — the
    // same numbers this function is drawing at — so there is nothing left to pass and
    // nothing left to re-derive.
    visuals: openVisuals(sb, dir),
    plots: new Map(),
  };
  for (const scene of timed.scenes) {
    for (const el of scene.elements) {
      ctx.boxes.set(el.id, el.at);
      ctx.elements.set(el.id, el);
      ctx.sceneOf.set(el.id, scene.id);
    }
  }

  const items: PlanItem[] = [];
  const unresolvedCues: string[] = [];
  let seq = 0;
  for (let si = 0; si < timed.scenes.length; si++) {
    const scene = timed.scenes[si] as Scene;
    const ps = scenes[si] as PlanScene;
    const timing: SceneTiming = {
      index: si,
      start: ps.start,
      speech: ps.speech,
      length: ps.dur,
      end: ps.start + ps.dur,
    };
    const hosts = scene.elements.filter((e) => e.type === 'plot');
    for (const raw of scene.elements) {
      const el = rebaseOntoPlot(raw, hosts, ctx);
      const fraction = enterFraction(el, scene, unresolvedCues);
      for (const item of itemsFor(el, fraction, timing, ctx, sb.meta.fps)) {
        item.order = [el.z ?? 0, seq++];
        items.push(item);
      }
    }
  }
  if (unresolvedCues.length > 0) {
    log.warn(
      `${unresolvedCues.length} enter cue${unresolvedCues.length === 1 ? '' : 's'} could not be placed on a word ` +
        `(e.g. "${unresolvedCues[0] ?? ''}") — falling back to enter.at. Run the voice stage so cues resolve to real timestamps.`,
    );
  }
  items.sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1]);

  const fill = contentFill(framing, canvas, frame).map(round3);
  reportFill(fill, timed);

  return {
    version: 1,
    fps: sb.meta.fps,
    duration,
    frame,
    aspect: sb.meta.aspect,
    canvas,
    paper: pal.paper,
    ink: pal.ink,
    grid: opts.grid === false ? null : pal.grid,
    gridStep: 72 * scale,
    style: sb.meta.style,
    fontFamily: opts.fontFamily ?? 'InkcastHand, cursive',
    scale,
    typeScale: ctx.type,
    safe: safeInsets(sb.meta.aspect, frame),
    fill,
    scenes,
    items,
    pen: penArt(sb.meta.style, pal.accent),
  };
}

/* -------------------------------------------------------------------- items */

function baseItem(
  id: string,
  el: Element,
  start: number,
  dur: number,
  timing: SceneTiming,
  prims: PlanPrim[],
  origin: [number, number],
): PlanItem {
  return {
    id,
    scene: timing.index,
    order: [0, 0],
    start,
    dur,
    style: el.enter.style,
    persist: el.persist,
    sceneEnd: timing.end,
    center: origin,
    prims,
  };
}

/**
 * One element becomes one plan item — except a plot, which becomes one per phase.
 *
 * Splitting a plot is what makes its build order teachable: the axes, each curve
 * and every overlay get their own start time, so a tangent can arrive eight
 * seconds after the curve it measures, and a descent can step one move at a time.
 */
function itemsFor(
  el: Element,
  fraction: number,
  timing: SceneTiming,
  ctx: Ctx,
  fps: number,
): PlanItem[] {
  const startLocal = clamp(fraction, 0, 1) * timing.speech;
  const start = timing.start + startLocal;
  const room = Math.max(0.14, timing.length - startLocal);
  const dur = Math.max(0.08, Math.min(el.enter.duration, room));
  const motion = bakeMotion(el, timing, fps);

  const items: PlanItem[] =
    el.type === 'plot'
      ? plotItems(el, start, timing, ctx)
      : [baseItem(el.id, el, start, dur, timing, primsFor(el, ctx), center(el.at))];

  if (el.type === 'emphasis') {
    const first = items[0];
    if (first) {
      if (el.effect === 'pulse') first.pulseTarget = el.targetId;
      if (el.effect === 'dim-others') first.dimOthers = el.targetId;
    }
  }

  if (motion) {
    for (const item of items) item.motion = motion;
    const trail = trailItem(el, motion, timing, ctx);
    if (trail) items.unshift(trail);
  }

  const morph = bakeMorph(el, timing, ctx, fps);
  if (morph) {
    // The morph attaches to the ink whose *shape* it becomes, which for a plot is
    // the curve and not the axes: the axes are drawn around the reshaping curve, so
    // the two happen together rather than one replacing the other.
    // The plot's curve phase is keyed by curve id, and it is the *first* curve the
    // morph targets — later curves are comparisons drawn against it.
    const wanted = el.type === 'plot' ? `${el.id}~curve-${el.curves[0]?.id ?? ''}` : null;
    const target = wanted === null ? items[0] : items.find((it) => it.id === wanted);
    if (target) {
      target.morph = morph;
      // The morph *is* this item's entry, so the item's own ink takes over where the
      // morph ends — and takes over by fading, not by being drawn. A dash-reveal
      // here would re-draw, stroke by stroke, the curve the viewer just watched bend
      // into place. The two shapes are roughened from different seeds, so a short
      // crossfade is what makes the handoff invisible.
      target.start = morph.end;
      target.style = 'fade';
      target.dur = MORPH_HANDOFF;
    } else {
      log.warn(`element "${el.id}" wants to morph but produced no ink to morph into`);
    }
  }
  return items;
}

/* -------------------------------------------------------------------- morph */

/** Points to interpolate for an element, in canvas space, or null when it has none. */
function morphGeometry(el: Element, ctx: Ctx): GPt[] | null {
  if (el.type === 'path') {
    if (el.points && el.points.length >= 2) return el.points.map((p) => [p.x, p.y] as GPt);
    if (el.d) {
      const runs = flattenPathData(el.d);
      const first = runs[0];
      return first && first.length >= 2 ? first.map((p) => [p[0], p[1]] as GPt) : null;
    }
    return null;
  }
  if (el.type === 'plot') {
    // The first curve is the shape the abstraction *is*; later curves are
    // comparisons drawn against it and have nothing to morph out of.
    const curve = el.curves[0];
    if (!curve) return null;
    const src = plotSourceOf(el, ctx);
    if (!src) return null;
    // The visuals stage already resampled the curve's longest visible run to even
    // arc length — a curve clipped by the plot band arrives in pieces, and that is
    // the piece the hillside should become.
    return curveTrace(src, curve.id);
  }
  return null;
}

/** Resample a polyline to exactly `n` points, evenly spaced by arc length. */
function resampleTo(pts: readonly GPt[], n: number): GPt[] {
  const cum = cumulativeLengths(pts);
  const total = cum[cum.length - 1] ?? 0;
  if (!(total > 0)) return Array.from({ length: n }, () => (pts[0] ?? [0, 0]) as GPt);
  const out: GPt[] = [];
  for (let i = 0; i < n; i++) out.push(pointAtLength(pts, cum, (i / (n - 1)) * total));
  return out;
}

/** How many points the in-flight shape is drawn from. Enough for a smooth curve. */
const MORPH_SAMPLES = 72;

/**
 * Seconds of crossfade from the morphed shape to the item's own ink.
 *
 * Short enough to read as a handoff rather than a dissolve, long enough to hide
 * that the two are roughened from different seeds.
 */
const MORPH_HANDOFF = 0.18;

/**
 * Bake the frames of `el` being reshaped out of the element it names.
 *
 * Both shapes are resampled to the same number of points **by arc length** before
 * they are interpolated, and that is the whole trick: matching by index instead
 * would pair the dense end of one polyline with the sparse end of the other, and
 * the hill would appear to slide sideways as it flattened rather than settle onto
 * the curve. Even spacing means every point travels the short way to where it
 * belongs.
 *
 * One `Rng` seed is held across every frame so the hand-drawn wobble stays put.
 * Re-seeding per frame makes the stroke boil, which reads as noise rather than as
 * one line being bent.
 */
function bakeMorph(el: Element, timing: SceneTiming, ctx: Ctx, fps: number): MorphTrack | null {
  const spec = el.morph;
  if (!spec) return null;

  const source = ctx.elements.get(spec.fromId);
  if (!source) {
    log.warn(`element "${el.id}" morphs from "${spec.fromId}", which is not on the board`);
    return null;
  }
  const from = morphGeometry(source, ctx);
  const to = morphGeometry(el, ctx);
  if (!from || !to) {
    log.warn(
      `cannot morph "${spec.fromId}" (${source.type}) into "${el.id}" (${el.type}) — ` +
        `one of them has no interpolable geometry`,
    );
    return null;
  }

  const a = clamp(spec.from, 0, 1) * timing.speech;
  const b = clamp(spec.to, 0, 1) * timing.speech;
  const startLocal = Math.min(a, b);
  let endLocal = Math.max(a, b);
  // A morph shorter than this is a cut, not a transformation.
  if (endLocal - startLocal < 0.35) endLocal = Math.min(timing.length, startLocal + 0.35);
  const span = Math.max(0.2, endLocal - startLocal);

  const src = resampleTo(from, MORPH_SAMPLES);
  const dst = resampleTo(to, MORPH_SAMPLES);
  const ease = easeFn(spec.easing);
  const steps = Math.max(2, Math.min(240, Math.round(span * Math.max(1, fps))));
  // One seed for the whole morph: the wobble must not change from frame to frame.
  const seed = seedOf(el.id, 'morph');
  const frames: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const u = clamp(ease(i / steps), 0, 1);
    const blend: Pt[] = src.map((p, k) => {
      const q = dst[k] as GPt;
      return [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u] as Pt;
    });
    frames.push(sketchAlong(new Rng(seed), ctx.st, blend, { amp: 0.9 }));
  }

  const weight = el.type === 'path' ? el.weight : 1;
  return {
    start: round3(timing.start + startLocal),
    end: round3(timing.start + startLocal + span),
    frames,
    stroke: ctx.pal.ink,
    strokeWidth: round3(ctx.sw * weight),
    ...(() => {
      const gone = [...(spec.retire ? [spec.fromId] : []), ...spec.retires];
      return gone.length > 0 ? { retire: gone } : {};
    })(),
  };
}

/**
 * Time the phases of a plot.
 *
 * Unpinned phases run back to back from the element's entry; a phase with an
 * author-pinned `at` starts on that fraction of the narration, never before the
 * axes exist. If the whole build would run past the end of the scene it is
 * compressed to fit rather than being cut off mid-curve.
 */
function plotItems(el: PlotElement, start: number, timing: SceneTiming, ctx: Ctx): PlanItem[] {
  const src = plotSourceOf(el, ctx);
  if (!src) {
    // The plot is the centre of its beat, so drawing nothing leaves a caption in a
    // void — the failure this pipeline is least willing to ship. An honest labelled
    // frame is the same degradation an unresolved asset gets, and it says on the board
    // what the log says: the visuals stage has not run.
    log.warn(
      `plot "${el.id}" has no geometry from the visuals stage — drawing a labelled ` +
        `frame. Run the visuals stage.`,
    );
    const rng = new Rng(seedOf(el.id, 'plot'));
    const size = TYPE_SCALE.label * ctx.type;
    return [
      baseItem(
        el.id,
        el,
        start,
        Math.max(0.4, el.enter.duration),
        timing,
        [
          ...geoms(sketchRect(rng, ctx.st, el.at), ctx.pal.inkSoft, ctx.sw * 0.7, 0.75),
          textPrim(el.id, el.at, size, ctx.pal.inkSoft, 'center'),
        ],
        center(el.at),
      ),
    ];
  }
  const all: PlotPhase[] = plotPhases(el, src, { pal: ctx.pal, alpha: ctx.alpha });
  // A later beat annotating this plot re-declares its frame and curves, because an
  // overlay needs the curve definition to know where a tangent goes. Draw that ink
  // once: the board accumulates, so it is still there to be annotated.
  const phases = all.filter((phase) => {
    if (!phase.sig) return true;
    if (ctx.drawn.has(phase.sig)) {
      log.debug(`plot "${el.id}" phase ${phase.key} is already on the board — annotating it`);
      return false;
    }
    if (el.persist) ctx.drawn.add(phase.sig);
    return true;
  });
  if (phases.length === 0) return [];

  const base = Math.max(0.18, el.enter.duration);
  const planned: { phase: PlotPhase; start: number; dur: number }[] = [];
  let cursor = start;
  for (const phase of phases) {
    const pinned = phase.at === null ? null : timing.start + clamp(phase.at, 0, 1) * timing.speech;
    // A pinned overlay lands on its cue, but never before the ink it annotates
    // exists: the axes come first whatever fraction the author wrote.
    const at = pinned === null ? cursor : Math.max(pinned, cursor);
    const span = base * phase.weight;
    planned.push({ phase, start: at, dur: span });
    cursor = at + span;
  }

  const available = Math.max(0.2, timing.end - start);
  const needed = cursor - start;
  const k = needed > available ? available / needed : 1;
  if (k < 1) {
    log.debug(
      `plot "${el.id}" wants ${needed.toFixed(2)}s of build but the scene has ${available.toFixed(2)}s — compressing`,
    );
  }

  return planned.map(({ phase, start: at, dur }) => {
    const s = start + (at - start) * k;
    const d = Math.max(0.1, dur * k);
    const item = baseItem(
      phase.key === 'axes' ? el.id : `${el.id}~${phase.key}`,
      el,
      s,
      Math.min(d, Math.max(0.1, timing.end - s)),
      timing,
      phase.prims,
      phase.center,
    );
    if (phase.sweep) item.sweep = phase.sweep;
    return item;
  });
}

/* ------------------------------------------------- riding on top of a plot */

/**
 * Correct an element that is positioned relative to a plot it sits on.
 *
 * The IR says a plot occupies its `at` box, and that is the only information an
 * author — the lesson compiler, an LLM, or a person writing JSON — has for working
 * out where a point on the curve lands. So they all map data space across the full
 * box. The plot is not drawn there: the visuals stage insets the box by gutters sized
 * from the type scale, to leave room for the axis names and ticks. Those gutters are
 * a layout decision the IR never exposes.
 *
 * The consequence was visible and silently wrong. The benchmark's descending ball
 * was authored on the curve at w = 3 and rendered *below and left* of it, ending up
 * sitting on the x-axis while the drawn staircase — which the renderer places with
 * its own mapping — stepped down the curve correctly a few dozen units away. Two
 * pictures of the same descent, disagreeing, in the one beat where the numbers are
 * supposed to be checkable.
 *
 * So anything living inside a plot's box gets its box-relative coordinates carried
 * through the same inset the curve got — read from the plot's resolved layout, so
 * there is one answer to "where is the plotting area" rather than two.
 */
function rebaseOntoPlot(el: Element, hosts: readonly Element[], ctx: Ctx): Element {
  if (el.type === 'plot' || hosts.length === 0) return el;
  const host = hosts.find(
    (h) => h.type === 'plot' && h.id !== el.id && rectContains(h.at, el.at, 1),
  );
  if (!host || host.type !== 'plot') return el;
  const src = plotSourceOf(host, ctx);
  if (!src) return el;
  const area = plotArea(src);
  const box = host.at;
  if (!(box.w > 0) || !(box.h > 0)) return el;
  const map = (p: { x: number; y: number }): { x: number; y: number } => ({
    x: area.x + ((p.x - box.x) / box.w) * area.w,
    y: area.y + ((p.y - box.y) / box.h) * area.h,
  });
  const corner = map({ x: el.at.x, y: el.at.y });
  const next: Element = {
    ...el,
    at: {
      x: corner.x,
      y: corner.y,
      w: (el.at.w / box.w) * area.w,
      h: (el.at.h / box.h) * area.h,
    },
  };
  // A `path` carries its own geometry, which has to travel with the box.
  if (next.type === 'path' && next.points) next.points = next.points.map(map);
  if (el.motion) next.motion = { ...el.motion, path: el.motion.path.map(map) };
  return next;
}

/* ------------------------------------------------------------------- motion */

/**
 * Bake `Motion` into a table of offsets, one per output frame.
 *
 * The maths that matters is arc length: interpolating the waypoint index makes an
 * element sprint across long segments and crawl across short ones, so a ball
 * descending a curve would stutter instead of rolling. Resolving every position by
 * distance travelled — and doing it here in Node rather than in the page — keeps
 * the browser side a lookup and keeps this testable without a browser.
 *
 * The offset is held at its first value before the motion starts, so an element
 * whose `at` box is not centred on the path is *drawn* in the right place instead
 * of jumping there when the motion begins.
 */
function bakeMotion(el: Element, timing: SceneTiming, fps: number): MotionTrack | null {
  const motion = el.motion;
  if (!motion) return null;
  const pts: GPt[] = motion.path.map((p) => [p.x, p.y]);
  if (pts.length < 2) return null;
  const cum = cumulativeLengths(pts);
  const total = cum[cum.length - 1] ?? 0;
  if (!(total > 0)) return null;

  const a = clamp(motion.from, 0, 1) * timing.speech;
  const b = clamp(motion.to, 0, 1) * timing.speech;
  const startLocal = Math.min(a, b);
  let endLocal = Math.max(a, b);
  if (endLocal - startLocal < 0.2) endLocal = Math.min(timing.length, startLocal + 0.2);
  const span = Math.max(0.1, endLocal - startLocal);
  const ease = easeFn(motion.easing);
  const steps = Math.max(1, Math.min(600, Math.round(span * Math.max(1, fps))));
  const [cx, cy] = center(el.at);
  const samples: [number, number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const p = i / steps;
    const u = clamp(ease(p), 0, 1);
    const q = pointAtLength(pts, cum, u * total);
    samples.push([round3(q[0] - cx), round3(q[1] - cy), round6(u)]);
  }
  return {
    start: round3(timing.start + startLocal),
    end: round3(timing.start + startLocal + span),
    samples,
  };
}

/** The dotted route a moving element leaves behind, bead by bead as it passes. */
function trailItem(
  el: Element,
  motion: MotionTrack,
  timing: SceneTiming,
  ctx: Ctx,
): PlanItem | null {
  if (!el.motion?.trail) return null;
  const pts: GPt[] = el.motion.path.map((p) => [p.x, p.y]);
  const cum = cumulativeLengths(pts);
  const total = cum[cum.length - 1] ?? 0;
  if (!(total > 0)) return null;
  const spacing = Math.max(30 * ctx.scale, ctx.sw * 4.5);
  const beads = Math.max(4, Math.min(60, Math.round(total / spacing)));
  const prims: PlanPrim[] = [];
  const trailAt: number[] = [];
  for (let k = 1; k < beads; k++) {
    const u = k / beads;
    const q = pointAtLength(pts, cum, u * total);
    prims.push(dotPrim(q[0], q[1], ctx.sw * 0.62, ctx.pal.accent, ctx.sw * 0.2));
    trailAt.push(round6(u));
  }
  if (prims.length === 0) return null;
  const item = baseItem(
    `${el.id}~trail`,
    el,
    motion.start,
    Math.max(0.1, motion.end - motion.start),
    timing,
    prims,
    center(el.at),
  );
  item.style = 'fade';
  item.motion = motion;
  item.trailAt = trailAt;
  // The pen is drawing the element, not laying beads behind it.
  item.noPen = true;
  return item;
}

/* -------------------------------------------------------------------- prims */

function primsFor(el: Element, ctx: Ctx): PlanPrim[] {
  const rng = new Rng(seedOf(el.id, el.type));
  const alpha = ctx.alpha;
  switch (el.type) {
    case 'text':
      return textPrims(el, ctx);
    case 'equation':
      return equationPrims(el, ctx);
    case 'shape':
      return shapePrims(el, ctx, rng, alpha);
    case 'arrow':
      return arrowPrims(el, ctx, rng, alpha);
    case 'asset':
      return assetPrims(el, ctx, rng);
    case 'diagram':
      return diagramPrims(el, ctx, rng, alpha);
    case 'emphasis':
      return emphasisPrims(el, ctx, rng, alpha);
    case 'path':
      return pathPrims(el, ctx, rng, alpha);
    default:
      return [];
  }
}

function textPrims(el: TextElement, ctx: Ctx): PlanPrim[] {
  const role: TextRole = el.role;
  const size = TYPE_SCALE[role] * ctx.type;
  const color = role === 'caption' ? ctx.pal.inkSoft : ctx.pal.ink;
  return [textPrim(el.text, el.at, size, color, el.align, 'middle')];
}

/**
 * Typeset mathematics, straight from the sidecar.
 *
 * One prim per glyph, in the order the visuals stage recorded them, which is left to
 * right. That ordering is the whole animation: the page gives every part of an item a
 * slice of its timeline proportional to how much ink it is, in order, so the equation
 * writes itself across the board without this lane scheduling anything.
 *
 * Each glyph keeps its fill *and* a thin stroke. The stroke is what the runtime
 * dash-reveals, and it fades the fill in over the same window — so a symbol arrives as
 * ink being laid down rather than as type being switched on.
 */
function equationPrims(el: EquationElement, ctx: Ctx): PlanPrim[] {
  const src = ctx.visuals.equationFor(el);
  if (!src) {
    // No recorded geometry: an un-run visuals stage, or TeX that would not set. Put
    // the source on the board — poor, but a blank space where the worked example
    // belongs is worse, and this is the case the whole fallback chain exists for.
    log.warn(
      `equation "${el.id}" has no typeset geometry in ${MANIFEST_PATH} — ` +
        'drawing its TeX source as text. Re-run the visuals stage.',
    );
    return [textPrim(el.tex, el.at, TYPE_SCALE.body * ctx.type, ctx.pal.ink, el.align, 'middle')];
  }
  // No fill-rule is set because `nonzero` is already the SVG default, and nonzero is
  // exactly what a glyph needs: TeX outlines wind a counter against the outer contour,
  // so the hole in an "o" stays a hole.
  return src.strokes
    .filter((s) => s.d.length > 0)
    .map((s) => geom(s.d, ctx.pal.ink, s.strokeWidth, { fill: ctx.pal.ink }));
}

/**
 * A freeform stroke — the escape hatch for any shape the vocabulary lacks.
 *
 * `points` are roughened here so a hillside looks drawn rather than plotted; raw
 * `d` is trusted verbatim, because whatever produced it (the visuals stage's
 * vectoriser, a hand-authored storyboard) has already decided how it should look
 * and re-roughening would smear it.
 */
function pathPrims(el: PathElement, ctx: Ctx, rng: Rng, alpha: number | undefined): PlanPrim[] {
  const width = ctx.sw * el.weight;
  const out: PlanPrim[] = [];
  let poly: Pt[] = [];

  if (el.points && el.points.length >= 2) {
    poly = el.points.map((p) => [p.x, p.y] as Pt);
    if (el.closed) {
      const head = poly[0] as Pt;
      poly = [...poly, [head[0], head[1]]];
    }
  } else if (el.d) {
    const subs = flattenPathData(el.d);
    poly = (subs[0] ?? []).map((p) => [p[0], p[1]] as Pt);
  }

  if (el.fill && poly.length >= 3) {
    const gap = Math.max(width * 3.4, 18 * ctx.scale);
    for (const d of hachurePolygon(rng, ctx.st, poly, gap)) {
      out.push(geom(d, ctx.pal.accent, width * 0.5, { opacity: 0.26, noDash: true }));
    }
  }

  if (el.points && el.points.length >= 2) {
    const d = sketchAlong(rng, ctx.st, poly, { amp: 0.9, closed: el.closed });
    if (d) out.push(...geoms([d], ctx.pal.ink, width, alpha));
  } else if (el.d) {
    out.push(...geoms([el.d], ctx.pal.ink, width, alpha));
  } else {
    log.warn(`path "${el.id}" has neither points nor d — nothing to draw`);
  }
  return out;
}

function shapePrims(el: ShapeElement, ctx: Ctx, rng: Rng, alpha: number | undefined): PlanPrim[] {
  const { st, sw } = ctx;
  const accent = ctx.pal.accent;
  const box = el.at;
  const stroke = el.shape === 'circle-highlight' ? accent : ctx.pal.ink;
  const out: PlanPrim[] = [];

  // Hachure fill first so the outline lands on top of it.
  if (el.fill) {
    const gap = sw * 3.4;
    const hatch =
      el.shape === 'ellipse' || el.shape === 'circle-highlight'
        ? hachureEllipse(rng, st, box.x + box.w / 2, box.y + box.h / 2, box.w / 2, box.h / 2, gap)
        : hachurePolygon(rng, st, rectPoly(box), gap);
    for (const d of hatch) {
      out.push(geom(d, accent, sw * 0.5, { opacity: 0.28, noDash: true }));
    }
  }

  switch (el.shape) {
    case 'rect':
      out.push(...geoms(sketchRect(rng, st, box), stroke, sw, alpha));
      break;
    case 'ellipse':
      out.push(
        ...geoms(
          sketchEllipse(rng, st, box.x + box.w / 2, box.y + box.h / 2, box.w / 2, box.h / 2),
          stroke,
          sw,
          alpha,
        ),
      );
      break;
    case 'circle-highlight': {
      const b = inflate(box, box.w * 0.07 + 10 * ctx.scale, box.h * 0.14 + 10 * ctx.scale);
      out.push(
        ...geoms(
          sketchEllipse(rng, st, b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 2),
          accent,
          sw * 0.9,
          alpha,
        ),
      );
      break;
    }
    case 'line':
      out.push(
        ...geoms(
          sketchLine(rng, st, [box.x, box.y], [box.x + box.w, box.y + box.h]),
          stroke,
          sw,
          alpha,
        ),
      );
      break;
    case 'underline': {
      const y = box.y + box.h;
      const pad = box.w * 0.02;
      out.push(
        ...geoms(
          sketchLine(rng, st, [box.x - pad, y], [box.x + box.w + pad, y], 2),
          stroke,
          sw * 0.85,
          alpha,
        ),
      );
      break;
    }
    case 'bracket':
      out.push(...geoms(sketchBracket(rng, st, box), stroke, sw * 0.85, alpha));
      break;
  }
  return out;
}

function arrowGeometry(
  rng: Rng,
  ctx: Ctx,
  from: Pt,
  to: Pt,
  curve: number,
  stroke: string,
  width: number,
  alpha: number | undefined,
): GeomPrim[] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy) || 1;
  const bulge = curve * len * 0.22;
  const mid: Pt = [
    from[0] + dx * 0.5 + (-dy / len) * bulge,
    from[1] + dy * 0.5 + (dx / len) * bulge,
  ];
  const head = Math.max(14 * ctx.scale, Math.min(len * 0.22, 46 * ctx.scale));
  // Stop the shaft just short of the tip so the head reads as a separate mark.
  const shaftEnd: Pt = [to[0] - (dx / len) * head * 0.25, to[1] - (dy / len) * head * 0.25];
  const dir = Math.atan2(to[1] - mid[1], to[0] - mid[0]);
  return [
    ...geoms(sketchCurve(rng, ctx.st, [from, mid, shaftEnd]), stroke, width, alpha),
    ...geoms(sketchArrowHead(rng, ctx.st, to, dir, head), stroke, width, alpha),
  ];
}

/** The quadratic control point the shaft is actually drawn through. */
function controlPoint(from: Pt, to: Pt, curve: number): Pt {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy) || 1;
  const bulge = curve * len * 0.22;
  return [from[0] + dx * 0.5 + (-dy / len) * bulge, from[1] + dy * 0.5 + (dx / len) * bulge];
}

/** Midpoint of the drawn curve, not of the straight line — labels sit on the ink. */
function curveMidpoint(from: Pt, to: Pt, curve: number): Pt {
  const [cx, cy] = controlPoint(from, to, curve);
  return [(from[0] + 2 * cx + to[0]) / 4, (from[1] + 2 * cy + to[1]) / 4];
}

/**
 * Where a label sits relative to the line it names, as an offset from the curve's
 * midpoint.
 *
 * A fixed "two lines above the midpoint" is right for a level line and wrong for
 * everything else. On a sloped or strongly bowed shaft the ink climbs into the
 * box from the side and the caption reads struck through — three labels in one
 * frame of the hand-authored sample were crossed out this way. So the offset
 * clears the bow as well as the stroke, and on a steep line it steps sideways,
 * because "above" is where the line already is.
 */
function labelOffset(from: Pt, to: Pt, control: Pt, gap: number): Pt {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  // Signed reach of the bow: how far the control point sits off the chord.
  const bow = (control[0] - (from[0] + dx / 2)) * nx + (control[1] - (from[1] + dy / 2)) * ny;
  const clear = gap + Math.abs(bow);
  if (Math.abs(dx) >= Math.abs(dy)) return [0, -clear];
  const side = bow >= 0 ? 1 : -1;
  return [nx * side * clear, ny * side * clear];
}

function arrowPrims(el: ArrowElement, ctx: Ctx, rng: Rng, alpha: number | undefined): PlanPrim[] {
  const from: Pt = [el.from.x, el.from.y];
  const to: Pt = [el.to.x, el.to.y];
  const out: PlanPrim[] = arrowGeometry(
    rng,
    ctx,
    from,
    to,
    el.curve,
    ctx.pal.ink,
    ctx.sw * 0.9,
    alpha,
  );
  if (el.label) {
    const size = TYPE_SCALE.caption * ctx.type;
    const [mx, my] = curveMidpoint(from, to, el.curve);
    const w = Math.max(160 * ctx.type, el.label.length * size * 0.6);
    const [ox, oy] = labelOffset(from, to, controlPoint(from, to, el.curve), size + ctx.sw);
    out.push(
      textPrim(
        el.label,
        { x: mx + ox - w / 2, y: my + oy - size * 0.8, w, h: size * 1.6 },
        size,
        ctx.pal.inkSoft,
        'center',
      ),
    );
  }
  return out;
}

/**
 * An asset's resolved artwork, as markup.
 *
 * `Asset.svg` is documented as the vector content, but the contract also says
 * stages keep **relative paths** in the storyboard so a project directory stays
 * portable — and `@inkcast/visuals` takes it at its word, writing
 * `assets/<id>.svg` there and the markup to disk. Accept both: a value that is
 * not markup is treated as a project-relative file. Without this every `asset`
 * element reached the page as an unparseable string, `DOMParser` failed, and the
 * icon silently drew nothing at all.
 */
function assetMarkup(value: string, dir: string, assetId: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('<')) return trimmed;
  try {
    const abs = path.resolve(dir, trimmed);
    const text = readFileSync(abs, 'utf8');
    return text.includes('<svg') ? text : null;
  } catch {
    log.warn(`asset "${assetId}" points at ${trimmed}, which is not readable`);
    return null;
  }
}

function assetPrims(el: AssetElement, ctx: Ctx, rng: Rng): PlanPrim[] {
  const raw = ctx.assets.get(el.assetId);
  const svg = raw === undefined ? null : assetMarkup(raw, ctx.dir, el.assetId);
  if (svg) {
    return [
      {
        kind: 'svg',
        svg: inlineImages(svg, ctx.dir),
        box: el.at,
        flipX: el.flipX,
        stroke: ctx.pal.ink,
      },
    ];
  }
  // Graceful degradation: the visuals stage has not resolved this asset yet, so
  // draw an honest labelled frame rather than nothing at all.
  log.warn(`asset "${el.assetId}" has no svg — drawing a placeholder frame`);
  const size = TYPE_SCALE.label * ctx.type;
  return [
    ...geoms(sketchRect(rng, ctx.st, el.at), ctx.pal.inkSoft, ctx.sw * 0.7, 0.75),
    textPrim(el.assetId, el.at, size, ctx.pal.inkSoft, 'center'),
  ];
}

function diagramPrims(
  el: DiagramElement,
  ctx: Ctx,
  rng: Rng,
  alpha: number | undefined,
): PlanPrim[] {
  const laid = layoutDiagram(el);
  const out: PlanPrim[] = [];
  const order = new Map(laid.nodes.map((nd, i) => [nd.id, i]));
  const drawn = new Set<string>();
  const pending = [...laid.edges];
  const labelSize = Math.max(
    14 * ctx.type,
    Math.min(TYPE_SCALE.label * ctx.type, (laid.nodes[0]?.box.h ?? 60) * 0.42),
  );
  const nodeBoxes = new Map(laid.nodes.map((nd) => [nd.id, nd.box]));
  const boxOf = (id: string): Rect | undefined => nodeBoxes.get(id);
  /** Lifted labels already placed for a node pair, so a there-and-back pair stacks. */
  const lifted = new Map<string, number>();

  const emitEdge = (e: (typeof laid.edges)[number]): void => {
    const pts = e.points;
    const a = pts[0] as Pt;
    const mid = (pts[1] ?? pts[0]) as Pt;
    const b = (pts[pts.length - 1] ?? pts[0]) as Pt;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const head = Math.max(10 * ctx.scale, Math.min(len * 0.26, 30 * ctx.scale));
    const dir = Math.atan2(b[1] - mid[1], b[0] - mid[0]);
    out.push(...geoms(sketchCurve(rng, ctx.st, [a, mid, b]), ctx.pal.inkSoft, ctx.sw * 0.7, alpha));
    out.push(
      ...geoms(sketchArrowHead(rng, ctx.st, b, dir, head), ctx.pal.inkSoft, ctx.sw * 0.7, alpha),
    );
    if (e.label) {
      const size = labelSize * 0.72;
      const w = Math.max(120 * ctx.type, e.label.length * size * 0.62);
      // Same rule as an arrow's label: clear the bow, and step sideways rather
      // than up when the edge is steep. `mid` is the bow's waypoint, so it is
      // also the control point the drawn curve passes through.
      const [ox, oy] = labelOffset(a, b, mid, size + ctx.sw * 0.7);
      let x = mid[0] + ox - w / 2;
      let y = mid[1] + oy - size * 0.75;
      // An edge between neighbouring nodes is only as long as the gap between
      // them, which is never as wide as a caption. Nudging such a label "above
      // the edge" leaves it level with the boxes, so it lands *inside* them —
      // "hit: 3 cycles" was printed across two nodes and its own arrow. Lift it
      // clear of the row instead, which is where a person would write it.
      const from = boxOf(e.from);
      const into = boxOf(e.to);
      if (from && into && w > len * 0.85 && Math.abs(b[1] - a[1]) <= Math.abs(b[0] - a[0])) {
        // Two nodes can be joined both ways ("miss" out, "fill" back); stack the
        // second caption above the first rather than printing them on each other.
        const pair = [e.from, e.to].sort().join(' ');
        const rank = lifted.get(pair) ?? 0;
        lifted.set(pair, rank + 1);
        y = Math.min(from.y, into.y) - size * (1.7 + rank * 1.55);
      }
      out.push(
        textPrim(
          e.label,
          { x, y, w, h: size * 1.5 },
          size,
          ctx.pal.inkSoft,
          'center',
          'middle',
          false,
        ),
      );
    }
  };

  // Build order: a node, then every edge that lands on the next node. Reads like
  // someone explaining the diagram rather than a wall of boxes appearing.
  for (const node of laid.nodes) {
    for (let i = pending.length - 1; i >= 0; i--) {
      const e = pending[i];
      if (!e) continue;
      const toIdx = order.get(e.to);
      if (toIdx !== order.get(node.id)) continue;
      if (!drawn.has(e.from)) continue;
      emitEdge(e);
      pending.splice(i, 1);
    }
    out.push(...geoms(sketchRect(rng, ctx.st, node.box), ctx.pal.ink, ctx.sw * 0.8, alpha));
    out.push(
      textPrim(
        node.label,
        inflate(node.box, -node.box.w * 0.06, -node.box.h * 0.1),
        labelSize,
        ctx.pal.ink,
        'center',
      ),
    );
    drawn.add(node.id);
  }
  for (const e of pending) emitEdge(e);
  return out;
}

function emphasisPrims(
  el: EmphasisElement,
  ctx: Ctx,
  rng: Rng,
  alpha: number | undefined,
): PlanPrim[] {
  const accent = ctx.pal.accent;
  const target = ctx.boxes.get(el.targetId);
  if (!target) {
    log.warn(`emphasis "${el.id}" targets unknown element "${el.targetId}" — skipped`);
    return [];
  }
  const { st, sw } = ctx;
  switch (el.effect) {
    case 'circle': {
      const b = inflate(target, target.w * 0.06 + 14 * ctx.scale, target.h * 0.16 + 12 * ctx.scale);
      return geoms(
        sketchEllipse(rng, st, b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 2),
        accent,
        sw * 0.9,
        alpha,
      );
    }
    case 'underline': {
      const y = target.y + target.h + 10 * ctx.scale;
      const pad = target.w * 0.03;
      return geoms(
        sketchLine(rng, st, [target.x - pad, y], [target.x + target.w + pad, y], 2),
        accent,
        sw * 0.85,
        alpha,
      );
    }
    case 'arrow-to': {
      const from: Pt = center(el.at);
      const tc: Pt = center(target);
      // Land on the target's border, not its centre.
      const dx = tc[0] - from[0];
      const dy = tc[1] - from[1];
      const sx = dx === 0 ? Infinity : target.w / 2 / Math.abs(dx);
      const sy = dy === 0 ? Infinity : target.h / 2 / Math.abs(dy);
      const s = Math.min(sx, sy, 1);
      const pad = 12 * ctx.scale;
      const len = Math.hypot(dx, dy) || 1;
      const to: Pt = [tc[0] - dx * s - (dx / len) * pad, tc[1] - dy * s - (dy / len) * pad];
      return arrowGeometry(rng, ctx, from, to, 0.24, accent, sw * 0.9, alpha);
    }
    default:
      // `pulse` and `dim-others` are pure behaviours, handled by the runtime.
      return [];
  }
}
