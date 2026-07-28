/**
 * Layout and camera choreography.
 *
 * The IR's core idea is one big persistent canvas that the camera tours, not a
 * deck of slides. That only works if layout is deliberate, so this module:
 *
 *  1. assigns each scene a **region** of the canvas, walking a serpentine grid
 *     so consecutive scenes are always physically adjacent (the camera pans a
 *     short distance instead of teleporting);
 *  2. grows the canvas to fit however many regions are needed;
 *  3. packs each scene's elements inside its region with a shelf/box packer and
 *     a collision-repair pass, so **no two elements ever overlap**;
 *  4. points annotations (`emphasis`) at the box they annotate, which is why
 *     annotated elements must persist;
 *  5. frames each region with the camera, with margin, and shortens the
 *     transition when a scene stays in the region it is annotating;
 *  6. distributes `enter.at` across the beat so elements arrive on the word
 *     that introduces them.
 *
 * Nothing here needs the voice stage to have run: timings are fractions.
 */
import { frameSize } from '@inkcast/core';
import type { Element, Scene, Storyboard, StoryboardMeta } from '@inkcast/core';
import type { Box } from './elements.js';
import { refit } from './elements.js';
import { mentionFraction } from './narration.js';
import { words } from './text.js';

export type Span = 'full' | 'half' | 'third' | 'block';

export type PlacementHint = {
  /** Fraction of the region width this element may occupy. */
  span?: Span;
  /** Stack directly beneath another element of the same scene. */
  below?: string;
  /** Take another element's box verbatim — used by annotations. */
  cover?: string;
  /** Start a new row before placing this element. */
  breakBefore?: boolean;
  /** Anchor an arrow between two elements (either may be in an earlier scene). */
  fromId?: string;
  toId?: string;
};

export type Hints = Record<string, PlacementHint>;

export type LayoutOptions = {
  aspect?: StoryboardMeta['aspect'];
  hints?: Hints;
  /** Canvas units of breathing room when framing a region. Default 70. */
  margin?: number;
};

/* ---------------------------------------------------------------- geometry */

const GAP = 240; // between regions — visible whitespace on the shared canvas
const PAD = 90; // inside a region
const ROW_GAP = 40; // between packed rows
const COL_GAP = 48; // between packed columns
const STACK_GAP = 18; // between an element and something attached below it

export type Grid = {
  cols: number;
  rows: number;
  rw: number;
  rh: number;
  canvasW: number;
  canvasH: number;
};

function regionSize(aspect: StoryboardMeta['aspect']): { rw: number; rh: number } {
  switch (aspect) {
    case '9:16':
      return { rw: 940, rh: 1670 };
    case '1:1':
      return { rw: 1200, rh: 1200 };
    default:
      return { rw: 1600, rh: 900 };
  }
}

/** Grid of regions big enough for `count` scenes. */
export function regionGrid(count: number, aspect: StoryboardMeta['aspect']): Grid {
  const n = Math.max(1, count);
  const { rw, rh } = regionSize(aspect);
  // A square *grid* of regions keeps the whole canvas at roughly the output
  // aspect ratio (cols·rw / rows·rh ≈ rw/rh when cols ≈ rows), so the zoomed-out
  // overview of the finished board reads well in any orientation.
  const cols = Math.max(1, Math.min(n, Math.ceil(Math.sqrt(n))));
  const rows = Math.ceil(n / cols);
  return {
    cols,
    rows,
    rw,
    rh,
    canvasW: cols * rw + (cols + 1) * GAP,
    canvasH: rows * rh + (rows + 1) * GAP,
  };
}

/**
 * Serpentine (boustrophedon) placement: row 0 left→right, row 1 right→left, …
 * so region i and region i+1 always share an edge.
 */
export function regionBox(index: number, grid: Grid): Box {
  const r = Math.floor(index / grid.cols);
  const i = index % grid.cols;
  const c = r % 2 === 0 ? i : grid.cols - 1 - i;
  return {
    x: GAP + c * (grid.rw + GAP),
    y: GAP + r * (grid.rh + GAP),
    w: grid.rw,
    h: grid.rh,
  };
}

/**
 * Canvas units the frame spans at `zoom: 1`, across and down.
 *
 * The renderer fits the canvas into the frame (`min` of the two ratios, like
 * `preserveAspectRatio="meet"`), so at zoom 1 only the *binding* axis matches the
 * canvas — the other one shows more canvas than exists. Deriving the camera from
 * `canvas.w / zoom` and `canvas.h / zoom` instead assumes both axes fit exactly,
 * which is only true when the canvas happens to share the output's aspect ratio.
 *
 * It usually does not. Two scenes in 16:9 produce a 2×1 grid of regions, so a
 * 3920×1380 canvas against a 1.78 frame: the old maths chose zoom 1.33 where 2.12
 * was correct, the viewport came out 2954×1662 for a 1600×900 region, the
 * horizontal clamp pinned both cameras to the canvas centre, and both scenes were
 * framed at once with one of them half off-screen. Sharing the renderer's own
 * `frameSize` keeps the two models identical by construction.
 */
export function frameSpan(
  canvasW: number,
  canvasH: number,
  aspect: StoryboardMeta['aspect'],
): { w: number; h: number } {
  const frame = frameSize(aspect);
  const base = Math.min(frame.w / Math.max(1, canvasW), frame.h / Math.max(1, canvasH));
  return base > 0 ? { w: frame.w / base, h: frame.h / base } : { w: canvasW, h: canvasH };
}

export function overlaps(a: Box, b: Box, tolerance = 0): boolean {
  return (
    a.x + a.w - tolerance > b.x &&
    b.x + b.w - tolerance > a.x &&
    a.y + a.h - tolerance > b.y &&
    b.y + b.h - tolerance > a.y
  );
}

/* ------------------------------------------------------------------ layout */

export function layoutStoryboard(input: Storyboard, opts: LayoutOptions = {}): Storyboard {
  const sb: Storyboard = structuredClone(input);
  const hints: Hints = opts.hints ?? {};
  const aspect = opts.aspect ?? sb.meta.aspect;
  const margin = opts.margin ?? 70;

  /* --- 1. which region does each scene live in? --- */
  const elementRegion = new Map<string, number>();
  const sceneRegion: number[] = [];
  let nextRegion = 0;

  sb.scenes.forEach((scene, i) => {
    const annotationOnly =
      scene.elements.length > 0 &&
      scene.elements.every((el) => el.type === 'emphasis' || hints[el.id]?.cover !== undefined);
    const reused = annotationOnly
      ? scene.elements
          .map((el) => (el.type === 'emphasis' ? el.targetId : hints[el.id]?.cover))
          .map((id) => (id === undefined ? undefined : elementRegion.get(id)))
          .find((r) => r !== undefined)
      : undefined;
    const r = reused ?? nextRegion++;
    sceneRegion[i] = r;
    for (const el of scene.elements) if (!elementRegion.has(el.id)) elementRegion.set(el.id, r);
  });

  const grid = regionGrid(nextRegion, aspect);
  sb.canvas = { x: 0, y: 0, w: grid.canvasW, h: grid.canvasH };

  /* --- 2. place elements, region by region --- */
  const boxes = new Map<string, Box>();
  sb.scenes.forEach((scene, i) => {
    const region = regionBox(sceneRegion[i] ?? 0, grid);
    const order = placeScene(scene, region, hints, boxes);
    scheduleEntrances(scene, order);
  });

  /* --- 3. camera: frame each region, pan short distances --- */
  const span = frameSpan(grid.canvasW, grid.canvasH, aspect);
  sb.scenes.forEach((scene, i) => {
    const region = regionBox(sceneRegion[i] ?? 0, grid);
    const zoom = Math.max(
      1,
      Math.min(span.w / (region.w + margin * 2), span.h / (region.h + margin * 2)),
    );
    const visW = span.w / zoom;
    const visH = span.h / zoom;
    const cx = region.x + region.w / 2;
    const cy = region.y + region.h / 2;
    const sameAsPrev = i > 0 && sceneRegion[i - 1] === sceneRegion[i];
    scene.camera = {
      x: clamp(cx, visW / 2, grid.canvasW - visW / 2),
      y: clamp(cy, visH / 2, grid.canvasH - visH / 2),
      zoom: round(zoom, 4),
      transition: i === 0 ? 0 : sameAsPrev ? 0.45 : 0.9,
    };
  });

  return sb;
}

/* ----------------------------------------------------------- scene packing */

type Group = { head: Element; children: Element[]; span: Span; breakBefore: boolean };

/**
 * Pack one scene into its region. Returns the elements in placement order,
 * which is also the order their entrances are scheduled in.
 */
function placeScene(scene: Scene, region: Box, hints: Hints, boxes: Map<string, Box>): Element[] {
  const content: Box = {
    x: region.x + PAD,
    y: region.y + PAD,
    w: region.w - PAD * 2,
    h: region.h - PAD * 2,
  };

  const byId = new Map(scene.elements.map((el) => [el.id, el] as const));
  const attached = new Set<string>();
  const covers: Element[] = [];
  const arrows: Element[] = [];
  const flow: Element[] = [];

  for (const el of scene.elements) {
    const hint = hints[el.id];
    if (el.type === 'emphasis' || hint?.cover !== undefined) {
      covers.push(el);
      continue;
    }
    if (el.type === 'arrow' && (hint?.fromId ?? hint?.toId)) {
      arrows.push(el);
      continue;
    }
    if (hint?.below !== undefined && byId.has(hint.below)) {
      attached.add(el.id);
      continue;
    }
    flow.push(el);
  }

  const ordered = orderFlow(flow, hints);

  const groups: Group[] = ordered.map((head) => {
    const children = scene.elements.filter(
      (c) => hints[c.id]?.below === head.id && attached.has(c.id),
    );
    const hint = hints[head.id];
    return {
      head,
      children,
      span: hint?.span ?? deriveSpan(head, scene),
      breakBefore: hint?.breakBefore ?? false,
    };
  });

  /* size every group at its span width */
  const sized = groups.map((g) => {
    const w = spanWidth(g.span, content.w);
    refit(g.head, w);
    for (const c of g.children) {
      // A decoration attached under a head — a rule, a bracket, an underline —
      // should be as wide as the thing it decorates. Prose must not be: capping a
      // paragraph at the head's width turned "Osmosis" plus its body into a
      // 254-unit column of one-word lines on a 1420-unit shelf. Text and diagrams
      // get the whole span and `refit` measures them back down to what they need.
      const cap =
        c.type === 'text' || c.type === 'diagram' ? w : Math.min(w, Math.max(g.head.at.w, 160));
      refit(c, cap);
    }
    const width = Math.max(g.head.at.w, ...g.children.map((c) => c.at.w), 60);
    const height = g.head.at.h + g.children.reduce((h, c) => h + c.at.h + STACK_GAP, 0);
    return { ...g, width, height };
  });

  /* shelf pack: fill a row, wrap, then centre each row */
  type Row = { items: typeof sized; width: number; height: number };
  const rows: Row[] = [];
  let row: Row = { items: [], width: 0, height: 0 };
  for (const g of sized) {
    const extra = row.items.length ? COL_GAP : 0;
    if (row.items.length && (g.breakBefore || row.width + extra + g.width > content.w)) {
      rows.push(row);
      row = { items: [], width: 0, height: 0 };
    }
    row.items.push(g);
    row.width += (row.items.length > 1 ? COL_GAP : 0) + g.width;
    row.height = Math.max(row.height, g.height);
  }
  if (row.items.length) rows.push(row);

  const totalH = rows.reduce((h, r) => h + r.height, 0) + Math.max(0, rows.length - 1) * ROW_GAP;
  const scale = totalH > content.h ? content.h / totalH : 1;

  let y = content.y + Math.max(0, (content.h - totalH * scale) / 2);
  const placed: Element[] = [];
  for (const r of rows) {
    const rowW = r.width * scale;
    let x = content.x + Math.max(0, (content.w - rowW) / 2);
    for (const g of r.items) {
      const gw = g.width * scale;
      const headW = g.head.at.w * scale;
      setBox(g.head, {
        x: x + (gw - headW) / 2,
        y,
        w: headW,
        h: g.head.at.h * scale,
      });
      placed.push(g.head);
      let cy = y + g.head.at.h + STACK_GAP * scale;
      for (const c of g.children) {
        const cw = c.at.w * scale;
        setBox(c, { x: x + (gw - cw) / 2, y: cy, w: cw, h: c.at.h * scale });
        cy += c.at.h + STACK_GAP * scale;
        placed.push(c);
      }
      x += gw + COL_GAP * scale;
    }
    y += r.height * scale + ROW_GAP * scale;
  }

  repairCollisions(placed, content);
  for (const el of placed) boxes.set(el.id, { ...el.at });

  /* annotations sit exactly on what they annotate */
  for (const el of covers) {
    const targetId = el.type === 'emphasis' ? el.targetId : hints[el.id]?.cover;
    const target = targetId === undefined ? undefined : boxes.get(targetId);
    const base = target ?? centreBox(content, 320, 200);
    const grow = el.type === 'emphasis' && el.effect === 'circle' ? 26 : 12;
    setBox(el, {
      x: base.x - grow,
      y: base.y - grow,
      w: base.w + grow * 2,
      h: base.h + grow * 2,
    });
    boxes.set(el.id, { ...el.at });
  }

  /* arrows are pure geometry between two anchors */
  for (const el of arrows) {
    if (el.type !== 'arrow') continue;
    const hint = hints[el.id];
    const a = hint?.fromId === undefined ? undefined : boxes.get(hint.fromId);
    const b = hint?.toId === undefined ? undefined : boxes.get(hint.toId);
    if (!a || !b) continue;
    const horizontal = Math.abs(centre(b).x - centre(a).x) >= Math.abs(centre(b).y - centre(a).y);
    const from = horizontal
      ? { x: b.x > a.x ? a.x + a.w : a.x, y: a.y + a.h / 2 }
      : { x: a.x + a.w / 2, y: b.y > a.y ? a.y + a.h : a.y };
    const to = horizontal
      ? { x: b.x > a.x ? b.x : b.x + b.w, y: b.y + b.h / 2 }
      : { x: b.x + b.w / 2, y: b.y > a.y ? b.y : b.y + b.h };
    el.from = { x: round(from.x, 2), y: round(from.y, 2) };
    el.to = { x: round(to.x, 2), y: round(to.y, 2) };
    setBox(el, {
      x: Math.min(from.x, to.x),
      y: Math.min(from.y, to.y),
      w: Math.max(24, Math.abs(to.x - from.x)),
      h: Math.max(24, Math.abs(to.y - from.y)),
    });
    boxes.set(el.id, { ...el.at });
  }

  return [...placed, ...arrows, ...covers];
}

/**
 * Push overlapping boxes apart. The packer should not produce overlaps, but
 * rounding, attached children and re-measured text can conspire — so this runs
 * as a guarantee rather than a hope.
 */
function repairCollisions(placed: Element[], content: Box): void {
  for (let pass = 0; pass < 60; pass++) {
    let moved = false;
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i]!.at;
        const b = placed[j]!.at;
        if (!overlaps(a, b, 1)) continue;
        const push = a.y + a.h - b.y + 12;
        b.y += push;
        moved = true;
      }
    }
    if (!moved) break;
  }
  // Nothing may leave its region: compress vertically if the repair overflowed.
  const bottom = placed.reduce((m, el) => Math.max(m, el.at.y + el.at.h), content.y);
  const overflow = bottom - (content.y + content.h);
  if (overflow > 0 && placed.length) {
    const k = content.h / (bottom - content.y);
    // Uniform vertical compression preserves gaps, so it cannot create a new
    // overlap: if a ended before b started, k·a still ends before k·b starts.
    for (const el of placed) {
      el.at.y = content.y + (el.at.y - content.y) * k;
      el.at.h = el.at.h * k;
    }
  }
  for (const el of placed) {
    el.at.x = round(el.at.x, 2);
    el.at.y = round(el.at.y, 2);
    el.at.w = round(el.at.w, 2);
    el.at.h = round(el.at.h, 2);
  }
}

function spanWidth(span: Span, contentW: number): number {
  switch (span) {
    case 'full':
      return contentW;
    case 'half':
      return (contentW - COL_GAP) / 2;
    case 'third':
      return (contentW - COL_GAP * 2) / 3;
    default:
      return Math.round(contentW * 0.62);
  }
}

/**
 * Without explicit hints (e.g. a storyboard authored by the LLM adapter) infer
 * the span from how wide the element was drawn relative to its scene.
 */
function deriveSpan(el: Element, scene: Scene): Span {
  if (el.type === 'text' && el.role === 'title') return 'full';
  if (el.type === 'diagram') return 'full';
  const bounds = sceneBounds(scene);
  if (bounds.w > 0) {
    const ratio = el.at.w / bounds.w;
    if (ratio > 0.72) return 'full';
    if (ratio > 0.42) return 'half';
    if (ratio > 0.28) return 'third';
  }
  return 'block';
}

/** Reading order — rows top to bottom, then left to right within a row. */
function orderFlow(flow: Element[], hints: Hints): Element[] {
  const explicit = flow.some((el) => hints[el.id]?.span !== undefined);
  if (explicit) return flow; // the planner already declared the order it wants
  const rowHeight = 120;
  return [...flow]
    .map((el, i) => ({ el, i }))
    .sort((a, b) => {
      const ra = Math.floor(a.el.at.y / rowHeight);
      const rb = Math.floor(b.el.at.y / rowHeight);
      return ra - rb || a.el.at.x - b.el.at.x || a.i - b.i;
    })
    .map((x) => x.el);
}

function sceneBounds(scene: Scene): Box {
  if (!scene.elements.length) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const el of scene.elements) {
    x0 = Math.min(x0, el.at.x);
    y0 = Math.min(y0, el.at.y);
    x1 = Math.max(x1, el.at.x + el.at.w);
    y1 = Math.max(y1, el.at.y + el.at.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function setBox(el: Element, b: Box): void {
  el.at = { x: round(b.x, 2), y: round(b.y, 2), w: round(b.w, 2), h: round(b.h, 2) };
}

function centre(b: Box) {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

function centreBox(content: Box, w: number, h: number): Box {
  return { x: content.x + (content.w - w) / 2, y: content.y + (content.h - h) / 2, w, h };
}

function clamp(v: number, lo: number, hi: number): number {
  if (hi < lo) return (lo + hi) / 2;
  return Math.min(hi, Math.max(lo, v));
}

function round(v: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

/* ------------------------------------------------------------ entrance time */

/** Words that identify an element, for matching against the narration. */
function elementTerm(el: Element, scene: Scene): string {
  switch (el.type) {
    case 'text':
      return el.text;
    case 'diagram':
      return el.nodes.map((n) => n.label).join(' ');
    case 'asset':
      return el.assetId.replace(/-/g, ' ');
    case 'arrow':
      return el.label ?? '';
    case 'emphasis': {
      const target = scene.elements.find((x) => x.id === el.targetId);
      return target && target.type === 'text' ? target.text : '';
    }
    default:
      return '';
  }
}

function enterDuration(el: Element): number {
  switch (el.type) {
    case 'text':
      return round(clamp(0.45 + words(el.text).length * 0.05, 0.5, 1.5), 2);
    case 'diagram':
      return round(clamp(0.6 + el.nodes.length * 0.18, 0.8, 2.4), 2);
    case 'asset':
      return 0.9;
    case 'emphasis':
      return 0.6;
    default:
      return 0.7;
  }
}

function enterStyle(el: Element): Element['enter']['style'] {
  if (el.type === 'text') return 'write';
  if (el.enter.style === 'write') return 'draw';
  if (el.type === 'emphasis' && el.effect === 'pulse') return 'pop';
  return el.enter.style === 'draw' ? 'draw' : el.enter.style;
}

/**
 * Spread entrances across the beat, anchored to the narration where possible:
 * if the narration says "the encoder" 40% of the way through, the encoder is
 * drawn at 0.4. Everything else falls back to an even distribution, and a
 * minimum spacing keeps the board from popping in all at once.
 */
export function scheduleEntrances(scene: Scene, order: Element[]): void {
  const list = order.length ? order : scene.elements;
  const n = list.length;
  if (!n) return;
  const spread = 0.66;
  let prev = -1;
  list.forEach((el, k) => {
    const mention = mentionFraction(scene.narration, elementTerm(el, scene));
    const even = n === 1 ? 0 : 0.04 + (k * spread) / (n - 1);
    let at = k === 0 ? 0 : (mention ?? even) * 0.94;
    if (at < prev + 0.05) at = prev + 0.05;
    at = clamp(at, 0, 0.9);
    prev = at;
    el.enter = {
      at: round(at, 3),
      duration: enterDuration(el),
      style: enterStyle(el),
    };
  });
}

/** All element boxes of a scene, keyed by id — handy for tests and the studio. */
export function sceneBoxes(scene: Scene): Map<string, Box> {
  return new Map(scene.elements.map((el) => [el.id, el.at] as const));
}
