import localFont from 'next/font/local';

/**
 * Typography, wired through `next/font`.
 *
 * The faces are the ones docs/research/design-stack.md picked — Geist for UI,
 * Geist Mono for figures, Instrument Serif for display, Shantell Sans for ink
 * accents — but they are loaded with `next/font/local` from vendored files in
 * `assets/fonts/` rather than with `next/font/google`.
 *
 * That is deliberate. `next/font/google` downloads from fonts.gstatic.com at
 * BUILD time, and docs/CONTRACT.md requires the project to work with zero
 * network. The vendored files are the exact latin-subset woff2 payloads Google
 * serves (28–79 KB each), all OFL-licensed with their licence files alongside,
 * so nothing about the design decision changes — only where the bytes come
 * from. `next/font` still handles subsetting metadata, `size-adjust` fallback
 * metrics, and self-hosting with no layout shift.
 *
 * Only the UI sans is preloaded. Every face is imported by `app/layout.tsx` to
 * publish its CSS variable, and `preload: true` on all four would emit four
 * blocking preload links on every route for fonts most routes never paint.
 */

/*
 * Every `path` below is written out as a literal, and has to be.
 * `next/font/local` is a compile-time transform: the SWC plugin statically
 * evaluates this options object and rewrites the call into a generated CSS
 * module. It cannot follow a `${FONTS_DIR}` template literal, so a shared base
 * constant does not fail loudly — it silently drops `path` and the build dies
 * with `data did not match any variant of untagged enum SrcRequest`.
 *
 * The paths are relative to this file: `../../../` is the repo root.
 */

/** UI. Variable 100–900, so `font-medium`/`semibold`/`bold` are real weights. */
export const fontSans = localFont({
  src: [
    { path: '../../../assets/fonts/ui/Geist-Variable.woff2', weight: '100 900', style: 'normal' },
  ],
  variable: '--font-geist',
  display: 'swap',
  preload: true,
  fallback: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
});

/** Figures, timecodes, IDs, CLI-flavoured UI. Pair with the `tabular` utility. */
export const fontMono = localFont({
  src: [
    {
      path: '../../../assets/fonts/ui/GeistMono-Variable.woff2',
      weight: '100 900',
      style: 'normal',
    },
  ],
  variable: '--font-geist-mono',
  display: 'swap',
  preload: false,
  fallback: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
});

/**
 * Display only, 48px and up (`text-5xl`+). High-contrast and condensed: it is
 * editorial at hero size and illegible at body size. Never set prose in it.
 */
export const fontDisplay = localFont({
  src: [
    {
      path: '../../../assets/fonts/ui/InstrumentSerif-Regular.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: '../../../assets/fonts/ui/InstrumentSerif-Italic.woff2',
      weight: '400',
      style: 'italic',
    },
  ],
  variable: '--font-instrument-serif',
  display: 'swap',
  preload: false,
  fallback: ['ui-serif', 'Georgia', 'Times New Roman', 'serif'],
});

/**
 * The whiteboard's own hand, for ink accents in chrome — an annotation label, a
 * hand-drawn callout, the wordmark's flourish. This is the same typeface the
 * renderer writes on the canvas with `meta.style: 'marker'`, which is the point:
 * the UI quotes the artefact.
 *
 * Use it in small doses. It is not a heading face.
 */
export const fontHand = localFont({
  src: [
    {
      path: '../../../assets/fonts/hand/ShantellSans-Variable.woff2',
      weight: '300 800',
      style: 'normal',
    },
  ],
  variable: '--font-shantell-sans',
  display: 'swap',
  preload: false,
  fallback: ['Segoe Print', 'Bradley Hand', 'cursive'],
});

/**
 * All four `--font-*` variables, ready for `<html className={...}>`.
 * `app/layout.tsx` is the only place this should be used.
 */
export const fontVariables = [
  fontSans.variable,
  fontMono.variable,
  fontDisplay.variable,
  fontHand.variable,
].join(' ');
