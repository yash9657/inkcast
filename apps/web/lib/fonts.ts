import localFont from 'next/font/local';

/**
 * Typography, wired through `next/font`.
 *
 * The stack is Inter for UI, JetBrains Mono for figures, Space Grotesk for
 * display and headings, Shantell Sans for ink accents — loaded with
 * `next/font/local` from vendored files in `assets/fonts/` rather than with
 * `next/font/google`.
 *
 * That is deliberate. `next/font/google` downloads from fonts.gstatic.com at
 * BUILD time, and docs/CONTRACT.md requires the project to work with zero
 * network. The vendored files are the latin-subset variable woff2 payloads
 * (22–79 KB each), all OFL-licensed with their licence files alongside, so
 * nothing about the design decision changes — only where the bytes come from.
 * `next/font` still handles subsetting metadata, `size-adjust` fallback
 * metrics, and self-hosting with no layout shift.
 *
 * The three UI faces were re-vendored on 2026-08-21 (plan item C2) by
 * installing `@fontsource-variable/{inter,jetbrains-mono,space-grotesk}` as dev
 * dependencies and copying one file out of each `files/` directory. The
 * packages stay in devDependencies as provenance and so a human can re-vendor
 * with `cp` instead of hunting for a download; nothing imports them, and the
 * build reads only the committed woff2 files.
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

/**
 * UI. Variable 100–900, so `font-medium`/`semibold`/`bold` are real weights
 * rather than synthesised ones — which matters because the base layer sets
 * `font-synthesis-weight: none`, so a missing weight would silently render as
 * the nearest one it has instead of getting faked.
 *
 * This is the `wght`-only cut of Inter, not the `opsz` variable cut. Inter's
 * optical-size axis interpolates toward a display design above 14px, and this
 * app sets its display type in Space Grotesk; carrying a second axis we never
 * vary would cost bytes on the one face that is preloaded on every route.
 */
export const fontSans = localFont({
  src: [
    { path: '../../../assets/fonts/ui/Inter-Variable.woff2', weight: '100 900', style: 'normal' },
  ],
  variable: '--font-inter',
  display: 'swap',
  preload: true,
  fallback: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
});

/**
 * Figures, timecodes, IDs, CLI-flavoured UI. Pair with the `tabular` utility.
 * Variable 100–800.
 */
export const fontMono = localFont({
  src: [
    {
      path: '../../../assets/fonts/ui/JetBrainsMono-Variable.woff2',
      weight: '100 800',
      style: 'normal',
    },
  ],
  variable: '--font-jetbrains-mono',
  display: 'swap',
  preload: false,
  fallback: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
});

/**
 * Display AND headings — every `h1`–`h6`, plus `font-display` wherever a block
 * of type should read as a heading without being one.
 *
 * The face this replaces, Instrument Serif, came with a hard rule: 48px and up,
 * marketing surfaces only, never prose, because a high-contrast condensed serif
 * is editorial at hero size and illegible at body size. Space Grotesk has no
 * such floor — it is a grotesk, it holds at 20px, and that is the whole reason
 * for the swap. Headings from a card title to the hero claim are now one voice.
 *
 * Variable 300–700. Note the ceiling: the wght axis stops at 700, which is why
 * the theme's weight ramp tops out at 700 rather than the 650 it used to use.
 */
export const fontDisplay = localFont({
  src: [
    {
      path: '../../../assets/fonts/ui/SpaceGrotesk-Variable.woff2',
      weight: '300 700',
      style: 'normal',
    },
  ],
  variable: '--font-space-grotesk',
  display: 'swap',
  preload: false,
  fallback: ['ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
});

/**
 * The whiteboard's own hand, for ink accents in chrome — an annotation label, a
 * hand-drawn callout, the wordmark's flourish. This is the same typeface the
 * renderer writes on the canvas with `meta.style: 'marker'`, which is the point:
 * the UI quotes the artefact. It survived the C2 swap for exactly that reason —
 * it is the one face in the stack that is ours rather than borrowed.
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
