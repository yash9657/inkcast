/**
 * The character grid a listing is set on — the code lane's one measurement (plan 6.2).
 *
 * It lives in core for the reason `fontmetrics.ts` does, and it is the same reason: two
 * stages have to agree. The planner reserves a box for a listing before anything has been
 * set, and the visuals stage then fits the real grid into whatever box the layout solver
 * hands it. If those two counted columns differently — one expanding tabs and the other
 * not, one measuring the widest line and the other the last — the reservation would be
 * the wrong shape and the listing would be set smaller than it needed to be, or would
 * overrun. That is the `empty stac` class of defect (audit A-4) transposed one lane over,
 * and the fix is the same: one function, imported by both.
 *
 * Everything here is *columns and rows*, never pixels. The size a listing is set at is a
 * function of the box it lands in, which only the visuals stage knows.
 */
import { monoMetrics } from './fontmetrics.js';

/**
 * Line advance as a multiple of the em, and it is measured rather than chosen.
 *
 * JetBrains Mono reports ascent 1.02 and descent 0.30, so its own line boxes stack at
 * 1.32 em with nothing between them — a descender touching the next line's capitals. 1.45
 * puts 0.13 em of leading in, which is the low end of the 1.4–1.6 every editor defaults to
 * and the right end for a board: a listing on a whiteboard is read in one glance, and
 * loose leading makes eight lines look like eight unrelated things.
 */
export const CODE_LINE_HEIGHT = 1.45;

/**
 * Columns a tab advances to.
 *
 * Four, because that is what the listings in this repo's own docs use, and because a
 * listing's indentation is the only record of its block structure — see `codeGrid`.
 */
export const CODE_TAB_STOP = 4;

/**
 * The nominal cell width, in em, for a reservation made with no font file present.
 *
 * JetBrains Mono's real advance is 0.6 em and `codeCellEm()` reads it out of the face.
 * This number exists only so a planner running in a tree whose `assets/fonts/code/` is
 * missing can still reserve a box — and a listing in that tree is about to be refused by
 * the lane and gated, so the reservation it feeds is never drawn. It is not a fallback
 * measurement; it is a placeholder for a beat that is already failing.
 */
const NOMINAL_CELL_EM = 0.6;

/**
 * The largest listing a board holds, and it is a *legibility* budget rather than a taste.
 *
 * The lane fits a listing by shrinking it and refuses below the board's caption size, so
 * these two numbers are where that refusal starts: on a 16:9 board a full-span cell is
 * roughly 900 × 300 canvas units, and 8 × 64 cells is the largest grid that still sets at
 * or above the smallest text the film writes. Past it the listing is legible only to
 * someone who can pause.
 *
 * They bind in two different ways, on purpose. For an **authored** lesson they are advice
 * — the brief quotes them, the lane still tries, and a listing that overruns is set
 * smaller and then refused with a message naming the fix, because an author who insisted
 * has a reason and deserves to be told rather than overruled. For the **heuristic**
 * document path they are a hard filter (`beats.ts`), because there is no author to warn:
 * a 200-column line in an ingested README would refuse under the strict gate and fail a
 * render that used to succeed, so a block that will not set is simply not made a beat.
 */
export const CODE_MAX_LINES = 8;
export const CODE_MAX_COLS = 64;

/** Width of one character cell, in em, from the vendored monospace face. */
export function codeCellEm(): number {
  // 'M' rather than a space: in a monospace face they are equal, and if the face ever
  // turns out not to be monospace, an 'M' is the one that cannot be narrow.
  return monoMetrics()?.advance(0x4d) ?? NOMINAL_CELL_EM;
}

export type CodeGrid = {
  /** The listing's lines, tabs expanded, trailing blank lines dropped. */
  lines: string[];
  /** Columns in the widest line. */
  cols: number;
};

/**
 * A listing as the grid it will be set on.
 *
 * Tabs are expanded here and nowhere else, because a tab is a *column* instruction and
 * every measurement downstream counts columns: a listing indented with tabs and one
 * indented with spaces must reserve the same box and be tokenised against the same
 * string. Trailing blank lines go and leading ones stay — a listing that opens on a blank
 * line was probably pasted deliberately, and one that ends on three was definitely sliced
 * out of a file.
 *
 * Nothing is wrapped and nothing is re-indented, ever. Re-flowing code changes what it
 * says: the body of a loop that has lost its indentation is no longer inside the loop.
 */
export function codeGrid(code: string): CodeGrid {
  const raw = code.replace(/\r\n?/g, '\n').split('\n');
  while (raw.length > 0 && (raw[raw.length - 1] as string).trim() === '') raw.pop();
  const lines = raw.map((line) => {
    let out = '';
    for (const ch of line) {
      if (ch === '\t') out += ' '.repeat(CODE_TAB_STOP - (out.length % CODE_TAB_STOP));
      else out += ch;
    }
    return out;
  });
  return { lines, cols: lines.reduce((w, line) => Math.max(w, [...line].length), 0) };
}

/**
 * The box a listing needs at `size`, and the size it actually gets.
 *
 * `size` is a ceiling, not a request: a listing 60 columns wide cannot be set at body size
 * inside 900 units, so the width clamp decides and the height follows from *that* size
 * rather than from the one asked for. Getting that order wrong reserves a box of the wrong
 * aspect, and the lane then letterboxes a listing inside its own reservation.
 */
export function codeBox(
  code: string,
  size: number,
  maxWidth: number,
): { w: number; h: number; size: number; cols: number; lines: number } {
  const { lines, cols } = codeGrid(code);
  const cell = codeCellEm();
  const rows = Math.max(1, lines.length);
  const fitted = Math.min(size, maxWidth / Math.max(1, cols * cell));
  return {
    w: Math.max(1, Math.round(cols * cell * fitted)),
    h: Math.max(1, Math.round(rows * CODE_LINE_HEIGHT * fitted)),
    size: fitted,
    cols,
    lines: rows,
  };
}
