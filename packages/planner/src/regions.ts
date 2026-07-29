/**
 * The board: how beats share regions, and where the camera looks.
 *
 * The MVP gave every scene its own region and framed the camera on exactly that
 * region. The result was a slideshow with ~80% whitespace, because nothing was
 * ever on screen except the thing that had just been drawn. Two changes fix it:
 *
 * 1. **Consecutive beats share a region.** A region holds one coherent chunk of
 *    the argument — the setup, a run of steps, the worked example — laid out as a
 *    grid of cells, one cell per beat. Nothing is wiped, so the region fills up.
 * 2. **The camera frames what has been drawn so far**, not the whole region. Beat
 *    one is a close-up; by beat four the camera has pulled back to hold the whole
 *    panel, and the recap pulls back over the entire board. The accumulated board
 *    *is* the summary — which is the only reason to use a whiteboard over slides.
 */
import type { Camera, Scene, StoryboardMeta } from '@inkcast/core';
import type { Box } from './elements.js';
import { frameSpan } from './layout.js';

export type BeatRole = NonNullable<Scene['role']>;

/** Gap between regions — deliberate whitespace on the shared canvas. */
const REGION_GAP = 200;
/** Padding inside a region, before its cells start. */
const REGION_PAD = 60;
/** Gap between cells inside a region. */
const CELL_GAP = 44;

export type RegionSpec = {
  /** Value written to `scene.region`. */
  key: string;
  /** Beat indices that draw into this region, in order. */
  beats: number[];
  box: Box;
};

export type BoardOptions = {
  aspect: StoryboardMeta['aspect'];
  /** Most beats one region may hold. 3–5 reads as a panel; 2 suits vertical. */
  maxPerRegion?: number;
  /** Breathing room when framing, in canvas units. */
  margin?: number;
};

export type Board = {
  canvas: Box;
  regions: RegionSpec[];
  regionOf(beat: number): RegionSpec;
  /** The cell this beat draws into, inside its region. */
  cellOf(beat: number): Box;
  /** Camera framing everything drawn in this beat's region up to and including it. */
  cameraFor(beat: number, role: BeatRole): Camera;
};

/* ------------------------------------------------------------- region groups */

/** Which chunk of the argument a role belongs to. */
export function phaseOf(role: BeatRole): 'setup' | 'build' | 'practice' | 'recap' {
  switch (role) {
    case 'hook':
    case 'anchor':
      return 'setup';
    case 'worked':
    case 'misconception':
      return 'practice';
    case 'recap':
      return 'recap';
    default:
      return 'build';
  }
}

/**
 * Group consecutive beats into regions.
 *
 * A region breaks when the argument changes phase — setup to steps, steps to
 * worked example — or when it is full. Phase boundaries matter more than filling
 * every cell: three learning-rate plots deserve a panel to themselves, and the
 * recap always gets its own.
 */
export function groupIntoRegions(
  roles: BeatRole[],
  maxPerRegion = 4,
): { key: string; beats: number[] }[] {
  const max = Math.max(1, maxPerRegion);
  const groups: { phase: string; beats: number[] }[] = [];
  roles.forEach((role, i) => {
    const phase = phaseOf(role);
    const current = groups[groups.length - 1];
    if (!current || current.phase !== phase || current.beats.length >= max) {
      groups.push({ phase, beats: [i] });
      return;
    }
    current.beats.push(i);
  });

  const perPhase = new Map<string, number>();
  for (const g of groups) perPhase.set(g.phase, (perPhase.get(g.phase) ?? 0) + 1);
  const seen = new Map<string, number>();
  return groups.map((g) => {
    const n = (seen.get(g.phase) ?? 0) + 1;
    seen.set(g.phase, n);
    const key = (perPhase.get(g.phase) ?? 1) > 1 ? `${g.phase}-${n}` : g.phase;
    return { key, beats: g.beats };
  });
}

/* ------------------------------------------------------------------ geometry */

function regionSize(aspect: StoryboardMeta['aspect']): { rw: number; rh: number } {
  switch (aspect) {
    case '9:16':
      // A tall region the camera can hold whole, stacked into a column it walks
      // down. Wider than the frame's 1080 so type can be large and still fit.
      return { rw: 1240, rh: 2140 };
    case '1:1':
      return { rw: 1400, rh: 1400 };
    default:
      return { rw: 1840, rh: 1035 };
  }
}

/** Columns of regions. Vertical output is a single column, by definition. */
function regionCols(count: number, aspect: StoryboardMeta['aspect']): number {
  if (aspect === '9:16') return 1;
  return Math.max(1, Math.min(count, Math.ceil(Math.sqrt(count))));
}

/** Cells inside a region, chosen so a plot never ends up in a letterbox. */
export function cellGrid(
  count: number,
  aspect: StoryboardMeta['aspect'],
): { cols: number; rows: number } {
  const n = Math.max(1, count);
  if (aspect === '9:16') {
    if (n <= 3) return { cols: 1, rows: n };
    return { cols: 2, rows: Math.ceil(n / 2) };
  }
  switch (n) {
    case 1:
      return { cols: 1, rows: 1 };
    case 2:
      return { cols: 2, rows: 1 };
    case 3:
      return { cols: 3, rows: 1 };
    case 4:
      return { cols: 2, rows: 2 };
    default:
      return { cols: 3, rows: Math.ceil(n / 3) };
  }
}

/** Cell boxes in reading order, with the last, short row centred. */
export function cellBoxes(region: Box, count: number, aspect: StoryboardMeta['aspect']): Box[] {
  const { cols, rows } = cellGrid(count, aspect);
  const content: Box = {
    x: region.x + REGION_PAD,
    y: region.y + REGION_PAD,
    w: region.w - REGION_PAD * 2,
    h: region.h - REGION_PAD * 2,
  };
  const cw = (content.w - CELL_GAP * (cols - 1)) / cols;
  const ch = (content.h - CELL_GAP * (rows - 1)) / rows;
  const out: Box[] = [];
  for (let i = 0; i < Math.max(1, count); i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const inRow = Math.min(cols, Math.max(1, count) - r * cols);
    const rowW = inRow * cw + (inRow - 1) * CELL_GAP;
    const x0 = content.x + (content.w - rowW) / 2;
    out.push({
      x: round(x0 + c * (cw + CELL_GAP)),
      y: round(content.y + r * (ch + CELL_GAP)),
      w: round(cw),
      h: round(ch),
    });
  }
  return out;
}

export function unionBox(boxes: Box[]): Box {
  if (!boxes.length) return { x: 0, y: 0, w: 1, h: 1 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

/**
 * Lay the board out and hand back the geometry every stage after this one needs.
 *
 * Regions walk a serpentine grid, so region *i* and region *i + 1* always share
 * an edge and the camera pans a short distance instead of teleporting. Vertical
 * output collapses that to a single column, which is the whole trick of the 9:16
 * format: one tall canvas, one continuous downward walk.
 */
export function planBoard(roles: BeatRole[], opts: BoardOptions): Board {
  const aspect = opts.aspect;
  const margin = opts.margin ?? 80;
  const groups = groupIntoRegions(roles, opts.maxPerRegion ?? (aspect === '9:16' ? 2 : 4));
  const { rw, rh } = regionSize(aspect);
  const cols = regionCols(groups.length, aspect);
  const rows = Math.ceil(groups.length / cols);
  const canvas: Box = {
    x: 0,
    y: 0,
    w: cols * rw + (cols + 1) * REGION_GAP,
    h: rows * rh + (rows + 1) * REGION_GAP,
  };

  const regions: RegionSpec[] = groups.map((g, i) => {
    const r = Math.floor(i / cols);
    const iCol = i % cols;
    // Serpentine: even rows left to right, odd rows right to left.
    const c = r % 2 === 0 ? iCol : cols - 1 - iCol;
    return {
      key: g.key,
      beats: g.beats,
      box: {
        x: REGION_GAP + c * (rw + REGION_GAP),
        y: REGION_GAP + r * (rh + REGION_GAP),
        w: rw,
        h: rh,
      },
    };
  });

  const byBeat = new Map<number, { region: RegionSpec; cell: Box; index: number }>();
  for (const region of regions) {
    const cells = cellBoxes(region.box, region.beats.length, aspect);
    region.beats.forEach((beat, k) => {
      byBeat.set(beat, { region, cell: cells[k] ?? region.box, index: k });
    });
  }

  const span = frameSpan(canvas.w, canvas.h, aspect);
  const wholeBoard = unionBox(regions.map((r) => r.box));

  function frame(box: Box, transition: number): Camera {
    const fitRegion = Math.min(span.w / (rw + margin * 2), span.h / (rh + margin * 2));
    const wanted = Math.min(span.w / (box.w + margin * 2), span.h / (box.h + margin * 2));
    // Zoom in for detail, but never so far that a single caption fills the frame.
    const zoom = Math.min(Math.max(1, wanted), Math.max(1, fitRegion * 2.1));
    const visW = span.w / zoom;
    const visH = span.h / zoom;
    return {
      x: round(clamp(box.x + box.w / 2, visW / 2, canvas.w - visW / 2), 2),
      y: round(clamp(box.y + box.h / 2, visH / 2, canvas.h - visH / 2), 2),
      zoom: round(zoom, 4),
      transition,
    };
  }

  return {
    canvas,
    regions,
    regionOf(beat) {
      return byBeat.get(beat)?.region ?? regions[0]!;
    },
    cellOf(beat) {
      return byBeat.get(beat)?.cell ?? regions[0]!.box;
    },
    cameraFor(beat, role) {
      const entry = byBeat.get(beat);
      if (!entry) return frame(wholeBoard, 0.9);
      const drawn = entry.region.beats
        .slice(0, entry.index + 1)
        .map((b) => byBeat.get(b)?.cell)
        .filter((b): b is Box => b !== undefined);
      // The recap earns the widest shot in the video: in landscape it holds the
      // whole board at once, which is the payoff for never having wiped it. In
      // vertical the board is a tall column, so pulling all the way back would
      // make it unreadable — the camera stays on the recap panel instead.
      const box =
        role === 'recap' && aspect !== '9:16'
          ? wholeBoard
          : unionBox(drawn.length ? drawn : [entry.cell]);
      return frame(box, 0.9);
    },
  };
}

function clamp(v: number, lo: number, hi: number): number {
  if (hi < lo) return (lo + hi) / 2;
  return Math.min(hi, Math.max(lo, v));
}

function round(v: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}
