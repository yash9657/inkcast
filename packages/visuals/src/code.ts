/**
 * The code lane — a source listing as a real monospace quotation (plan item 6.2).
 *
 * What this replaces is the reason it exists, and it is the same sentence the equation
 * lane opens with. Code used to reach the board as a `text` element: a listing lettered
 * in a handwriting face and wrapped at proportional advances. That destroys the two
 * things a listing *is*. Indentation carries the block structure of the program, and
 * proportional advances mean two lines indented by the same four spaces do not line up —
 * so the body of a loop stops being visibly inside it. And nothing distinguishes the
 * language's words from the author's, so a reader has to parse a picture of code with
 * none of the help every editor they have ever opened gives them for free.
 *
 * This lane is `equation.ts`'s contract, one lane over, and the four load-bearing
 * properties there hold here verbatim:
 *
 * 1. **The tokeniser runs in pure Node.** Shiki is the same class of dependency MathJax
 *    is: a real implementation of something we must not reimplement. TextMate grammars
 *    are what every editor in the world highlights with, they are deterministic, and the
 *    module is imported lazily so a storyboard with no code pays nothing for it.
 *
 * 2. **The output surface is provably tiny.** Shiki hands back lines of `{content,
 *    color}` and nothing else — no HTML to parse, no CSS to resolve. The `color` is a
 *    sentinel from `TONE_THEME` below rather than a real colour, which is the trick that
 *    keeps this lane inside the palette.
 *
 * 3. **Glyphs are filled outlines, so the reveal is per glyph, in document order.** The
 *    marks are emitted line by line, left to right, and the page gives every part of an
 *    item a slice of the timeline proportional to its ink, in order — so ordering the
 *    marks *is* the animation, and the listing types itself onto the board with no new
 *    renderer capability.
 *
 * 4. **`ink: 'crisp'`, and here it matters twice over.** A wobbled integral sign is a
 *    different integral sign; a wobbled `l` is a `1`, a wobbled `{` is a `(`, and a
 *    listing whose punctuation is up for interpretation is not a program. The paths go
 *    through the same `roughenPathData` funnel as everything else, which at crisp returns
 *    them verbatim.
 *
 * ## Two decisions that are this lane's own
 *
 * **The palette highlights, not a theme.** Every editor theme has a dozen hues; this
 * board has one accent and one contrast, on purpose (`core/src/palette.ts` — cycling a
 * hue per scene is how competing tools end up with a rainbow). So the grammar's scopes
 * are collapsed onto the four `Tone` values the IR already has, and the *renderer* turns
 * those into ink from the film's own palette. Four roles is not a poor approximation of
 * twelve: keyword / literal / comment / everything-else is the distinction that actually
 * helps a reader find the shape of a line, and the remaining eight are decoration.
 *
 * **Nothing is re-flowed.** A listing too wide for its box is set smaller, never wrapped
 * and never re-indented, because re-flowing code changes what it says. When it cannot be
 * set legibly at all the lane refuses and says why — `resolveCode` returns `undefined`
 * and the caller gates, exactly as it does for TeX that will not typeset. Handwriting is
 * never the fallback here; handwriting is the defect.
 */
import {
  CODE_LINE_HEIGHT,
  codeCellEm,
  codeGrid,
  logger,
  monoMetrics,
  type FontMetrics,
  type Tone,
} from '@inkcast/core';
import type { DrawContext, InkPath } from './geometry.js';
import { roughenPathData } from './geometry.js';
import type { InkStyle } from './style.js';
import type { Box, Matrix } from './svg.js';
import { multiply, n, scaleM, transformPath, translateM } from './svg.js';
import type { InkItem } from './writer.js';
import { pathItems } from './writer.js';

const log = logger('visuals:code');

export type CodeSpec = {
  /** The listing, verbatim. */
  code: string;
  /** A Shiki grammar id, or `text` for none. */
  lang: string;
  /** The box to fit the listing into. */
  box: Box;
  align: 'left' | 'center' | 'right';
};

/**
 * One run of glyphs that share an ink, as a range into the element's draw sequence.
 *
 * The same shared-index-space contract `PlotLayout.parts` uses, and for the same reason:
 * it lets the renderer colour and time parts of one element without knowing how any of it
 * was drawn. `tone` rather than a colour because the film's palette is the renderer's, not
 * this stage's — recorded colours from the visuals stage have reached no pixel since plan
 * item 2.2.
 */
export type CodePart = {
  tone: Tone;
  /** Zero-based source line, so a consumer can talk about "the third line". */
  line: number;
  /** Inclusive start and exclusive end index into the element's marks. */
  from: number;
  to: number;
};

export type CodeLayout = {
  /** The element's declared box. */
  box: Box;
  /** Where the listing actually landed — the fitted character grid. */
  bounds: Box;
  /** Em size the listing was set at, in canvas units. Drives the stroke weight. */
  emSize: number;
  /** Advance of one character cell, in canvas units. */
  cellWidth: number;
  /** Baseline-to-baseline distance, in canvas units. */
  lineHeight: number;
  /** Lines and columns of the grid the listing was set on. */
  lines: number;
  cols: number;
  /** Marks in reveal order, one per drawn glyph (a space draws none). */
  marks: number;
  /** The grammar actually used — `text` when the asked-for one was not available. */
  lang: string;
  /** What the element asked for, when that differs from `lang`. */
  langAsked?: string;
  /** Ink runs, in draw order, covering every mark exactly once. */
  parts: CodePart[];
  /** The listing itself, so a consumer can show it when geometry is missing. */
  code: string;
};

export type ResolvedCode = { items: InkItem[]; layout: CodeLayout };

export type ResolveCodeOptions = {
  style: InkStyle;
  /**
   * The smallest em this listing may be set at, in canvas units.
   *
   * Not a taste threshold: below it the lane refuses rather than shrinking further, so a
   * twelve-line function in a small cell is a named problem instead of an unreadable grey
   * rectangle. Callers pass the board's own caption size — if code has to be smaller than
   * the smallest text the film writes, it does not fit.
   */
  minEm?: number;
  /**
   * The largest em, in canvas units. A two-line snippet must not be set at 90 units just
   * because its box is empty; callers pass the board's body size.
   */
  maxEm?: number;
  /** Padding inside `box`, in canvas units. Defaults to 2% of the smaller side. */
  inset?: number;
};

/* ------------------------------------------------------------------- engine */

/**
 * The four inks a listing is allowed, as a TextMate theme.
 *
 * A theme is how Shiki is *asked* about scopes: it resolves the grammar's scope stack to
 * one `foreground` per token, which is precisely the collapse this lane wants, and it does
 * it with the same precedence rules every editor uses instead of a scope-prefix table
 * maintained here. So the theme's colours are sentinels — `#000002` means "the accent",
 * not a colour — and `TONE_OF` reads them back. No hex from this table ever reaches a
 * pixel; `render/src/compile.ts` maps the tone onto the film's palette.
 *
 * The scope lists are deliberately short. Each one has to earn itself by helping a reader
 * find the shape of a line at a glance:
 *
 *  - **accent** — the language's own words: keywords, storage, operators. These are the
 *    skeleton; marking them is what makes an `if` inside a `for` visible from across a
 *    room.
 *  - **contrast** — the literals: strings, numbers, `true`, `None`. The author's data, as
 *    against the language's grammar, and the pair reads as a pair for the reason
 *    `Palette.contrast` documents (warm against cool, legible in greyscale and to a
 *    viewer who cannot see red against green).
 *  - **muted** — comments. Prose inside code, and the one run a reader is *allowed* to
 *    skip, which is exactly what the soft ink already means everywhere else on the board.
 *  - **ink** — everything else: identifiers, punctuation, whitespace. The default, and
 *    most of the listing, because a board where most words are marked marks nothing.
 */
const TONE_THEME = {
  name: 'inkcast-tones',
  type: 'light' as const,
  colors: { 'editor.foreground': '#000001' },
  settings: [
    { settings: { foreground: '#000001' } },
    {
      scope: ['comment', 'punctuation.definition.comment', 'string.comment'],
      settings: { foreground: '#000004' },
    },
    {
      scope: [
        'keyword',
        'storage',
        'storage.type',
        'storage.modifier',
        'keyword.control',
        'keyword.operator',
        'entity.name.tag',
        'variable.language',
      ],
      settings: { foreground: '#000002' },
    },
    {
      scope: [
        'string',
        'string.quoted',
        'constant.numeric',
        'constant.language',
        'constant.character',
        'support.constant',
      ],
      settings: { foreground: '#000003' },
    },
  ],
};

const TONE_OF: Record<string, Tone> = {
  '#000001': 'ink',
  '#000002': 'accent',
  '#000003': 'contrast',
  '#000004': 'muted',
};

type Token = { content: string; color?: string };
type Highlighter = {
  codeToTokens(code: string, opts: { lang: string; theme: string }): { tokens: Token[][] };
  loadLanguage(lang: string): Promise<void>;
  getLoadedLanguages(): string[];
};

/**
 * Loaded once per process, and *not* retried on failure.
 *
 * One highlighter is reused across conversions, and grammars are loaded into it on
 * demand: Shiki bundles 346 of them and a film that shows one Python function must not
 * compile the other 345. Verified deterministic — tokenising A, then B, then A again
 * yields identical output for A — which matters because the storyboard is cached on a
 * fingerprint and a listing that drifted between runs would invalidate it forever.
 */
let engineOnce: Promise<Highlighter | undefined> | undefined;
/** Grammar ids known to this build, for the "is that a language?" question. */
let knownLangs: Set<string> | undefined;

async function loadEngine(): Promise<Highlighter | undefined> {
  const { createHighlighter, bundledLanguages } = await import('shiki');
  knownLangs = new Set(Object.keys(bundledLanguages));
  const hl = await createHighlighter({ langs: [], themes: [TONE_THEME] });
  return hl as unknown as Highlighter;
}

function engine(): Promise<Highlighter | undefined> {
  engineOnce ??= loadEngine().catch((err: unknown) => {
    log.warn(
      `the syntax highlighter could not be loaded (${String(err)}) — ` +
        'a listing cannot be set without it',
    );
    return undefined;
  });
  return engineOnce;
}

/** Whether the lane can set a listing at all, without committing to one. */
export async function codeEngineReady(): Promise<boolean> {
  return (await engine()) !== undefined && monoMetrics() !== undefined;
}

/* --------------------------------------------------------------- the grid */

/**
 * Which grammar to tokenise with, and what to say when it is not the one asked for.
 *
 * A grammar this build does not carry falls back to `text` rather than failing the
 * render, because an unhighlighted listing in the right face with the right indentation
 * is already most of what this lane is for — while highlighting a snippet as the *wrong*
 * language marks the wrong words, which is worse than marking none.
 */
async function grammar(hl: Highlighter, asked: string): Promise<string> {
  const want = asked.trim().toLowerCase();
  if (want === '' || want === 'text' || want === 'plaintext' || want === 'txt') return 'text';
  if (knownLangs && !knownLangs.has(want)) {
    log.warn(
      `no syntax grammar for "${asked}" in this build — setting the listing unhighlighted. ` +
        'Use a Shiki language id (python, typescript, sql, …).',
    );
    return 'text';
  }
  if (!hl.getLoadedLanguages().includes(want)) {
    try {
      await hl.loadLanguage(want);
    } catch (err) {
      log.warn(`grammar "${asked}" would not load (${String(err)}) — setting it unhighlighted`);
      return 'text';
    }
  }
  return want;
}

/* ------------------------------------------------------------------ resolve */

type Cell = { ch: string; line: number; col: number; tone: Tone };

/** Every drawable character, in document order, with the ink its scope earned it. */
function cells(tokens: Token[][], lines: readonly string[]): Cell[] {
  const out: Cell[] = [];
  for (const [lineIndex, line] of lines.entries()) {
    const lineTokens = tokens[lineIndex] ?? [{ content: line }];
    let col = 0;
    for (const token of lineTokens) {
      const tone = TONE_OF[token.color ?? ''] ?? 'ink';
      // The tokeniser was handed the tab-expanded lines, so a token's characters and the
      // grid's columns are the same count — which is the reason to expand before
      // tokenising rather than after.
      for (const ch of token.content) {
        if (ch !== ' ') out.push({ ch, line: lineIndex, col, tone });
        col++;
      }
    }
  }
  return out;
}

/**
 * Set `spec.code` and resolve it into ordered, revealable glyph geometry.
 *
 * Returns `undefined` — for the caller to gate on, never to fall back to handwriting —
 * when the highlighter or the monospace face is unavailable, when the listing is empty,
 * when a character has no glyph in the face, or when the listing cannot be set at
 * `minEm` in its box.
 */
export async function resolveCode(
  spec: CodeSpec,
  ctx: DrawContext,
  opts: ResolveCodeOptions,
): Promise<ResolvedCode | undefined> {
  const { lines, cols } = codeGrid(spec.code);
  if (lines.length === 0 || cols === 0) return undefined;

  const mono = monoMetrics();
  if (!mono) return undefined; // `monoMetrics` has already said why.
  const hl = await engine();
  if (!hl) return undefined;

  const lang = await grammar(hl, spec.lang);
  let tokens: Token[][];
  try {
    tokens = hl.codeToTokens(lines.join('\n'), { lang, theme: TONE_THEME.name }).tokens;
  } catch (err) {
    log.warn(`could not tokenise the listing as ${lang} (${String(err)})`);
    return undefined;
  }

  const grid = cells(tokens, lines);
  if (grid.length === 0) {
    log.warn('the listing is entirely whitespace — nothing to set');
    return undefined;
  }
  const missing = uncovered(grid, mono);
  if (missing) {
    // The S4-b defect in monospace: a code point the face cannot draw would be laid out
    // at the cell width and painted by nothing at all. Naming it is the whole job.
    log.warn(
      `the listing contains "${missing.char}" (U+${missing.cp.toString(16).toUpperCase().padStart(4, '0')}), ` +
        `which ${mono.familyName} has no glyph for — it would be set as a blank cell`,
    );
    return undefined;
  }

  /* ---- fit the grid into the box, preserving the cell's aspect ---- */
  const advanceEm = codeCellEm(); // monospace: every cell is this wide
  const inset = opts.inset ?? Math.min(spec.box.w, spec.box.h) * 0.02;
  const availW = Math.max(1e-6, spec.box.w - inset * 2);
  const availH = Math.max(1e-6, spec.box.h - inset * 2);
  const wanted = Math.min(availW / (cols * advanceEm), availH / (lines.length * CODE_LINE_HEIGHT));
  const emSize = Math.min(wanted, opts.maxEm ?? wanted);
  if (opts.minEm !== undefined && emSize < opts.minEm) {
    log.warn(
      `a ${lines.length}-line, ${cols}-column listing needs to be set at ${n(emSize)} canvas ` +
        `units to fit its ${n(spec.box.w)}×${n(spec.box.h)} box, below the ${n(opts.minEm)} floor — ` +
        'show fewer lines, shorten them, or give the beat a bigger cell',
    );
    return undefined;
  }

  const cellWidth = advanceEm * emSize;
  const lineHeight = CODE_LINE_HEIGHT * emSize;
  const drawnW = cols * cellWidth;
  const drawnH = lines.length * lineHeight;
  const slack = availW - drawnW;
  const offX = spec.align === 'left' ? 0 : spec.align === 'right' ? slack : slack / 2;
  const originX = spec.box.x + inset + Math.max(0, offX);
  const originY = spec.box.y + inset + Math.max(0, (availH - drawnH) / 2);

  /* ---- one mark per glyph, in document order ---- */
  const colour = ctx.style.ink;
  // 3% of the em, as in the equation lane: a marker's touch at this size, and it is what
  // the runtime dash-reveals so the glyph arrives as ink rather than as type.
  const strokeWidth = Math.max(0.4, emSize * 0.03);
  const scale = emSize / mono.unitsPerEm;
  const paths: InkPath[] = [];
  const parts: CodePart[] = [];
  let markIndex = 0;
  for (const cell of grid) {
    const raw = mono.outline(cell.ch.codePointAt(0) as number);
    if (!raw) continue; // covered but empty: a non-breaking space, a soft hyphen
    // The glyph's own origin: its cell's left edge, on its line's baseline. `scale(s, -s)`
    // is the one flip in this lane — font units run y-up and the canvas runs y-down.
    const place: Matrix = multiply(
      translateM(
        originX + cell.col * cellWidth,
        originY + cell.line * lineHeight + mono.ascent * emSize,
      ),
      scaleM(scale, -scale),
    );
    const d = transformPath(raw, place);
    if (!d) continue;
    const drawn = roughenPathData({ ...ctx, ink: 'crisp' }, d, markIndex, {
      stroke: colour,
      strokeWidth,
    });
    const from = markIndex;
    for (const p of drawn) {
      paths.push({
        ...p,
        fill: colour,
        // TrueType winds a counter against the outer contour, which is what nonzero is
        // for: the hole in an "o" stays a hole.
        fillRule: 'nonzero',
        group: `code:${cell.line}`,
      });
      markIndex++;
    }
    if (markIndex > from) {
      const last = parts[parts.length - 1];
      // Runs merge while the ink and the line hold, so a thirty-character identifier is
      // one part rather than thirty.
      if (last && last.tone === cell.tone && last.line === cell.line && last.to === from) {
        last.to = markIndex;
      } else {
        parts.push({ tone: cell.tone, line: cell.line, from, to: markIndex });
      }
    }
  }
  if (paths.length === 0) return undefined;

  return {
    items: pathItems(paths),
    layout: {
      box: spec.box,
      bounds: { x: originX, y: originY, w: drawnW, h: drawnH },
      emSize: n(emSize),
      cellWidth: n(cellWidth),
      lineHeight: n(lineHeight),
      lines: lines.length,
      cols,
      marks: paths.length,
      lang,
      ...(lang === spec.lang ? {} : { langAsked: spec.lang }),
      parts,
      code: lines.join('\n'),
    },
  };
}

/** The first code point in the listing the face cannot draw, if there is one. */
function uncovered(
  grid: readonly Cell[],
  mono: FontMetrics,
): { char: string; cp: number } | undefined {
  const seen = new Set<number>();
  for (const cell of grid) {
    const cp = cell.ch.codePointAt(0);
    if (cp === undefined || seen.has(cp)) continue;
    seen.add(cp);
    if (!mono.covers(cp)) return { char: cell.ch, cp };
  }
  return undefined;
}
