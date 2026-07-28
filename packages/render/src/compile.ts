/**
 * Storyboard IR -> RenderPlan.
 *
 * This is where fractional scene timings become absolute seconds, semantic roles
 * become ink and type sizes, and shapes/arrows/diagrams become hand-drawn path
 * data from a seeded PRNG. Nothing here touches a DOM or a clock, so it is
 * synchronous, pure (given the same storyboard and directory) and unit-testable.
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
  Scene,
  ShapeElement,
  Storyboard,
  TextElement,
} from '@inkcast/core';
import { frameSize } from '@inkcast/core';
import { layoutDiagram } from './layout.js';
import { TYPE_SCALE, inkStyle, paletteFor, penArt } from './palette.js';
import type { Palette, TextRole } from './palette.js';
import {
  Rng,
  hachureEllipse,
  hachurePolygon,
  rectPoly,
  seedOf,
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
  PlanItem,
  PlanPrim,
  PlanScene,
  Rect,
  RenderPlan,
  TextPrim,
} from './types.js';

const log = logger('render:compile');

export type CompileOptions = {
  /** Draw the faint board grid. Default true. */
  grid?: boolean;
  /** CSS font-family list for on-canvas text. */
  fontFamily?: string;
};

/** Words-per-second used only when the voice stage has not measured a scene. */
const WPS = 2.6;

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

function geom(d: string, stroke: string, strokeWidth: number, extra?: Partial<GeomPrim>): GeomPrim {
  return { kind: 'geom', d, stroke, strokeWidth, fill: 'none', ...extra };
}

function geoms(ds: string[], stroke: string, strokeWidth: number, opacity?: number): GeomPrim[] {
  return ds.map((d) =>
    opacity === undefined
      ? geom(d, stroke, strokeWidth)
      : geom(d, stroke, strokeWidth, { opacity }),
  );
}

function textPrim(
  text: string,
  box: Rect,
  size: number,
  color: string,
  align: TextPrim['align'],
  vAlign: TextPrim['vAlign'] = 'middle',
  shrink = true,
): TextPrim {
  return { kind: 'text', text, box, size, align, vAlign, color, shrink };
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

/* ------------------------------------------------------------------ compile */

type Ctx = {
  pal: Palette;
  st: SketchStyle;
  /** Base stroke width in canvas units. */
  sw: number;
  scale: number;
  dir: string;
  assets: Map<string, string | undefined>;
  boxes: Map<string, Rect>;
};

/**
 * Canvas units per output pixel, at the camera's typical framing.
 *
 * `TYPE_SCALE`, stroke widths and the grid step are quoted in *output pixels*;
 * the board is measured in canvas units, and how large a canvas unit lands on
 * screen is decided entirely by the camera. Taking the multiplier from the
 * canvas size (`canvas.w / 1920`) is the obvious guess and it is wrong for every
 * storyboard whose camera tours a canvas bigger than one frame: the planner packs
 * 24 scenes onto a 9440×5940 canvas and then zooms 5.4× into each region, so one
 * canvas unit is ≈1 px, not ≈5. Sizing type off the canvas made every title six
 * times taller than the box the planner had measured for it — text overflowed the
 * frame and consecutive elements drew on top of each other.
 *
 * The median zoom rather than the mean, so a single deliberately wide
 * establishing shot cannot shrink the ink for the whole film.
 */
function unitsPerPixel(canvas: Rect, frame: { w: number; h: number }, scenes: Scene[]): number {
  const base = Math.min(frame.w / canvas.w, frame.h / canvas.h);
  const zooms = scenes.map((s) => (s.camera.zoom > 0 ? s.camera.zoom : 1)).sort((a, b) => a - b);
  const n = zooms.length;
  const median =
    n === 0
      ? 1
      : n % 2 === 1
        ? (zooms[(n - 1) / 2] as number)
        : ((zooms[n / 2 - 1] as number) + (zooms[n / 2] as number)) / 2;
  const pxPerUnit = base * median;
  return pxPerUnit > 0 ? clamp(1 / pxPerUnit, 0.05, 24) : 1;
}

export function compilePlan(sb: Storyboard, dir: string, opts: CompileOptions = {}): RenderPlan {
  const frame = frameSize(sb.meta.aspect);
  const canvas: Rect = { ...sb.canvas };
  const scale = unitsPerPixel(canvas, frame, sb.scenes);
  const pal = paletteFor(sb.meta.palette);
  const ink = inkStyle(sb.meta.style);
  const st: SketchStyle = {
    roughness: ink.roughness,
    bowing: ink.bowing,
    passes: ink.passes,
    scale,
  };
  const sw = 6 * ink.width * scale;

  const missing = sb.scenes.filter((s) => !s.durationSec).length;
  if (missing > 0) {
    log.warn(
      `${missing}/${sb.scenes.length} scenes have no measured durationSec — estimating from the narration. Run the voice stage for synced timing.`,
    );
  }

  const scenes: PlanScene[] = [];
  let t = 0;
  for (const scene of sb.scenes) {
    const dur = sceneDuration(scene);
    scenes.push({
      id: scene.id,
      start: t,
      dur,
      camera: {
        x: scene.camera.x,
        y: scene.camera.y,
        zoom: scene.camera.zoom,
        transition: scene.camera.transition,
      },
    });
    t += dur;
  }
  const duration = t + sb.meta.outroSec;

  const ctx: Ctx = {
    pal,
    st,
    sw,
    scale,
    dir,
    assets: new Map(sb.assets.map((a) => [a.id, a.svg])),
    boxes: new Map(),
  };
  for (const scene of sb.scenes) for (const el of scene.elements) ctx.boxes.set(el.id, el.at);

  const items: PlanItem[] = [];
  let seq = 0;
  for (let si = 0; si < sb.scenes.length; si++) {
    const scene = sb.scenes[si] as Scene;
    const ps = scenes[si] as PlanScene;
    for (const el of scene.elements) {
      const startLocal = clamp(el.enter.at, 0, 1) * ps.dur;
      const room = Math.max(0.14, ps.dur - startLocal);
      const dur = Math.max(0.08, Math.min(el.enter.duration, room));
      const item: PlanItem = {
        id: el.id,
        scene: si,
        order: [el.z ?? 0, seq++],
        start: ps.start + startLocal,
        dur,
        style: el.enter.style,
        persist: el.persist,
        sceneEnd: ps.start + ps.dur,
        center: center(el.at),
        prims: primsFor(el, ctx, ink.opacity),
      };
      if (el.type === 'emphasis') {
        if (el.effect === 'pulse') item.pulseTarget = el.targetId;
        if (el.effect === 'dim-others') item.dimOthers = el.targetId;
      }
      items.push(item);
    }
  }
  items.sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1]);

  return {
    version: 1,
    fps: sb.meta.fps,
    duration,
    frame,
    canvas,
    paper: pal.paper,
    ink: pal.ink,
    grid: opts.grid === false ? null : pal.grid,
    gridStep: 72 * scale,
    style: sb.meta.style,
    fontFamily: opts.fontFamily ?? 'InkcastHand, cursive',
    scale,
    scenes,
    items,
    pen: penArt(sb.meta.style, pal.accent),
  };
}

/* -------------------------------------------------------------------- prims */

function primsFor(el: Element, ctx: Ctx, opacity: number): PlanPrim[] {
  const rng = new Rng(seedOf(el.id, el.type));
  const alpha = opacity < 1 ? opacity : undefined;
  switch (el.type) {
    case 'text':
      return textPrims(el, ctx);
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
    default:
      return [];
  }
}

function textPrims(el: TextElement, ctx: Ctx): PlanPrim[] {
  const role: TextRole = el.role;
  const size = TYPE_SCALE[role] * ctx.scale;
  const color = role === 'caption' ? ctx.pal.inkSoft : ctx.pal.ink;
  return [textPrim(el.text, el.at, size, color, el.align, 'middle')];
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
    const size = TYPE_SCALE.caption * ctx.scale;
    const [mx, my] = curveMidpoint(from, to, el.curve);
    const w = Math.max(160 * ctx.scale, el.label.length * size * 0.6);
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
  const size = TYPE_SCALE.label * ctx.scale;
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
    14 * ctx.scale,
    Math.min(TYPE_SCALE.label * ctx.scale, (laid.nodes[0]?.box.h ?? 60) * 0.42),
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
      const w = Math.max(120 * ctx.scale, e.label.length * size * 0.62);
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
        const pair = [e.from, e.to].sort().join(' ');
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
