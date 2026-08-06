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
  /**
   * Beats that draw into an earlier beat's cell instead of claiming their own,
   * as `beat -> host beat`.
   *
   * This exists for the one move that cannot be laid out beat-locally: an
   * abstraction arriving *out of* the concrete drawing the learner already
   * accepted. The hillside becoming the loss curve has to happen where the
   * hillside is, so that beat shares the anchor's cell and stays in the anchor's
   * region rather than opening a fresh panel somewhere else on the board.
   *
   * A sharing beat also does not count against `maxPerRegion` — it adds no ink of
   * its own, it reshapes ink that is already there.
   */
  sharesCellWith?: ReadonlyMap<number, number>;
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
  joining: ReadonlySet<number> = new Set(),
): { key: string; beats: number[] }[] {
  const max = Math.max(1, maxPerRegion);
  const groups: { phase: string; beats: number[] }[] = [];
  /** Beats in this group that hold a cell of their own. */
  const owned = (g: { beats: number[] }): number => g.beats.filter((b) => !joining.has(b)).length;
  roles.forEach((role, i) => {
    const current = groups[groups.length - 1];
    // A joining beat reshapes ink an earlier beat drew, so it belongs to that
    // beat's region whatever phase its own role would put it in — the whole point
    // is that it happens where the earlier drawing already is.
    if (current && joining.has(i)) {
      current.beats.push(i);
      return;
    }
    const phase = phaseOf(role);
    if (!current || current.phase !== phase || owned(current) >= max) {
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

/**
 * A cell is one frame-shaped panel, and that shape is the whole point.
 *
 * The camera fits the *union of what has been drawn*, so whenever it is holding a
 * single cell the cell's aspect ratio is the frame's fill: a 0.9:1 cell shown in a
 * 1.78:1 frame leaves half the width empty however well the cell itself is packed,
 * and no amount of work inside the beat can recover it. Verification of the
 * benchmark found exactly that — "beats with one figure in a two-cell region leave
 * a visibly empty half" — because a two-beat region was tiled as two tall halves.
 *
 * So the cell size is fixed at the frame's ratio and the *region* is sized to hold
 * however many cells it needs, rather than a fixed region being divided into cells
 * of whatever shape falls out. Widths are chosen so type quoted for the frame stays
 * legible at the zoom that holds one cell.
 */
function cellSize(aspect: StoryboardMeta['aspect']): { cw: number; ch: number } {
  switch (aspect) {
    case '9:16':
      return { cw: 1000, ch: round((1000 * 16) / 9) };
    case '1:1':
      return { cw: 1080, ch: 1080 };
    default:
      return { cw: 880, ch: round((880 * 9) / 16) };
  }
}

/** Columns of regions. Vertical output is a single column, by definition. */
function regionCols(count: number, aspect: StoryboardMeta['aspect']): number {
  if (aspect === '9:16') return 1;
  return Math.max(1, Math.min(count, Math.ceil(Math.sqrt(count))));
}

/**
 * Cells inside a region.
 *
 * Square-ish for landscape and square output, because a square grid of
 * frame-shaped cells has a frame-shaped *union* — so the shot that holds the
 * finished panel is as full as the shots that built it. Vertical output is one
 * column instead: a tall canvas the camera walks down is the whole trick of the
 * 9:16 format, and cells side by side would make it pan sideways in a frame that
 * has no width to spare.
 */
export function cellGrid(
  count: number,
  aspect: StoryboardMeta['aspect'],
): { cols: number; rows: number } {
  const n = Math.max(1, count);
  if (aspect === '9:16') return { cols: 1, rows: n };
  const cols = Math.ceil(Math.sqrt(n));
  return { cols, rows: Math.ceil(n / cols) };
}

/** The region box that holds `count` frame-shaped cells. */
export function regionBoxFor(
  count: number,
  aspect: StoryboardMeta['aspect'],
): { w: number; h: number } {
  const { cols, rows } = cellGrid(count, aspect);
  const { cw, ch } = cellSize(aspect);
  return {
    w: round(cols * cw + (cols - 1) * CELL_GAP + REGION_PAD * 2),
    h: round(rows * ch + (rows - 1) * CELL_GAP + REGION_PAD * 2),
  };
}

/**
 * Cell boxes in reading order, each exactly frame-shaped, with the last short row
 * centred.
 *
 * `region` is expected to have been sized by `regionBoxFor(count, aspect)`. A
 * region larger than that (they are laid out on a uniform pitch, so the smaller
 * ones have slack) leaves the extra space around the grid rather than stretching
 * cells out of shape — which is the one thing this must not do.
 */
export function cellBoxes(region: Box, count: number, aspect: StoryboardMeta['aspect']): Box[] {
  const n = Math.max(1, count);
  const { cols, rows } = cellGrid(n, aspect);
  const { cw: idealW, ch: idealH } = cellSize(aspect);
  const avail: Box = {
    x: region.x + REGION_PAD,
    y: region.y + REGION_PAD,
    w: region.w - REGION_PAD * 2,
    h: region.h - REGION_PAD * 2,
  };
  // Shrink to fit a region smaller than the grid wants, but keep the ratio: the
  // aspect is the reason this function exists.
  const k = Math.min(
    1,
    (avail.w - CELL_GAP * (cols - 1)) / (cols * idealW),
    (avail.h - CELL_GAP * (rows - 1)) / (rows * idealH),
  );
  const cw = idealW * k;
  const ch = idealH * k;
  const gridH = rows * ch + (rows - 1) * CELL_GAP;
  const top = avail.y + (avail.h - gridH) / 2;
  const out: Box[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const inRow = Math.min(cols, n - r * cols);
    const rowW = inRow * cw + (inRow - 1) * CELL_GAP;
    const x0 = avail.x + (avail.w - rowW) / 2;
    out.push({
      x: round(x0 + c * (cw + CELL_GAP)),
      y: round(top + r * (ch + CELL_GAP)),
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
  const shares = opts.sharesCellWith ?? new Map<number, number>();
  const groups = groupIntoRegions(
    roles,
    opts.maxPerRegion ?? (aspect === '9:16' ? 2 : 4),
    new Set(shares.keys()),
  );
  // Each region is sized to the cells it actually needs, so a two-beat panel is not
  // a four-beat panel with a hole in it. They are then laid out on a *uniform*
  // pitch — the largest region's size — which keeps the serpentine walk simple and
  // keeps neighbouring regions a predictable distance apart.
  const owned = groups.map((g) => g.beats.filter((b) => !shares.has(b)).length);
  const sizes = owned.map((n) => regionBoxFor(Math.max(1, n), aspect));
  const rw = Math.max(...sizes.map((s) => s.w));
  const rh = Math.max(...sizes.map((s) => s.h));
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
    const size = sizes[i] as { w: number; h: number };
    const slotX = REGION_GAP + c * (rw + REGION_GAP);
    const slotY = REGION_GAP + r * (rh + REGION_GAP);
    return {
      key: g.key,
      beats: g.beats,
      box: {
        // Centred in its slot, so the slack a small region leaves is shared with
        // its neighbours rather than piled up on one side of the board.
        x: round(slotX + (rw - size.w) / 2),
        y: round(slotY + (rh - size.h) / 2),
        w: size.w,
        h: size.h,
      },
    };
  });

  const byBeat = new Map<number, { region: RegionSpec; cell: Box; index: number }>();
  for (const region of regions) {
    // Only beats that draw ink of their own get a cell; the grid is sized to them,
    // so a sharing beat does not shrink everyone else's panel to hold an empty box.
    const owners = region.beats.filter((b) => !shares.has(b));
    const cells = cellBoxes(region.box, owners.length, aspect);
    const cellOfOwner = new Map(owners.map((b, k) => [b, cells[k] ?? region.box]));
    region.beats.forEach((beat, k) => {
      const host = shares.get(beat);
      const cell =
        (host === undefined ? cellOfOwner.get(beat) : cellOfOwner.get(host)) ?? region.box;
      byBeat.set(beat, { region, cell, index: k });
    });
  }

  const span = frameSpan(canvas.w, canvas.h, aspect);
  const wholeBoard = unionBox(regions.map((r) => r.box));

  const { cw, ch } = cellSize(aspect);

  function frame(box: Box, transition: number): Camera {
    const wanted = Math.min(span.w / (box.w + margin * 2), span.h / (box.h + margin * 2));
    // One cell is the tightest shot there is. That is a real limit rather than a
    // taste one: a cell is frame-shaped, so holding exactly one fills the frame,
    // and zooming past it would crop a beat's own ink to make a caption enormous.
    const fitCell = Math.min(span.w / (cw + margin * 2), span.h / (ch + margin * 2));
    const zoom = Math.min(Math.max(1, wanted), Math.max(1, fitCell));
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
    /**
     * One beat, one card — and the recap over everything.
     *
     * This used to frame the union of every cell drawn so far in the region, so a beat
     * four of four was shown at a quarter size with three finished cells around it. The
     * argument for it was that the accumulated board *is* the summary. That argument is
     * sound and it was being applied to the wrong shots: a viewer following beat four
     * needs to read beat four, and the board as summary is a thing you want **once**, at
     * the end, when there is a summary to look at.
     *
     * Measured against Golpo (`docs/research/golpo-video-craft.md`), which wipes between
     * scenes and holds two to four big things centred on each one: ours was 23% frame
     * fill with elements too small to read, and the pulled-back shots were where the
     * whitespace was. Holding one cell is what makes a beat a card — the title at the
     * top, the picture beneath it, filling the frame.
     *
     * **Recall is kept, and it is kept where it was actually earned.** A beat that
     * annotates an earlier beat's drawing draws *into that beat's cell*, so framing "its
     * own cell" frames the host's finished picture with the new ink arriving on top —
     * the hillside becoming the loss curve still happens on screen, in one shot. Nothing
     * is wiped either: the board still accumulates, the recap still pulls back over all
     * of it, and that shot is now the only wide one in the film, which is what makes it
     * land.
     */
    cameraFor(beat, role) {
      const entry = byBeat.get(beat);
      if (!entry) return frame(wholeBoard, 0.9);
      // The recap earns the widest shot in the video: in landscape it holds the
      // whole board at once, which is the payoff for never having wiped it. In
      // vertical the board is a tall column, so pulling all the way back would
      // make it unreadable — the camera stays on the recap panel instead.
      if (role === 'recap') {
        return frame(aspect !== '9:16' ? wholeBoard : unionBox([entry.region.box]), 0.9);
      }
      return frame(entry.cell, 0.94);
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
